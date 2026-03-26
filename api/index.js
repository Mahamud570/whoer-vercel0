const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const dns = require('dns').promises;
const net = require('net');

const app = express();

// ─── SECURITY & PERFORMANCE ──────────────────────────────────────────────────
app.set('trust proxy', 1); // Required for Vercel/Cloudflare real IPs

app.use(compression());
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());



app.use(bodyParser.json({ limit: '500kb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// ─── LAYER 7 DDoS PROTECTION & API LOCKDOWN ──────────────────────────────────

// 1. In-memory IP blacklist (resets on deploy — use KV for persistence)
const bannedIPs = new Set();

// 2. Middlewares: Origin Protector (V1) & API Key Validator (V2)
const originProtector = (req, res, next) => {
    const origin = req.headers.origin || req.headers.referer || req.headers.host || '';
    if (!origin.includes('whoer.live') && !origin.includes('localhost') && !origin.includes('vercel.app')) {
        return res.status(403).json({ error: 'Direct API access forbidden. Subscribe for a V2 API Key.' });
    }
    next();
};

const apiKeyValidator = async (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'Missing x-api-key header. Get one via Telegram Admin.' });
    const kv = await getKV();
    const isValid = await kv.get(`apikey:${key}`);
    if (!isValid) return res.status(403).json({ error: 'Invalid or expired API Key' });
    next();
};

// 3. Per-endpoint strict rate limiters
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 60,
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    message: { error: 'Too many requests, please wait.' },
    standardHeaders: true, legacyHeaders: false,
});
const bulkLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 5, // 5 bulk scans/min per IP
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    message: { error: 'Bulk scan rate limit exceeded. Max 5/minute.' },
    standardHeaders: true, legacyHeaders: false,
});
const heavyLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 10, // blacklist + port scan
    keyGenerator: (req) => req.headers['cf-connecting-ip'] || req.ip,
    message: { error: 'Too many requests on this endpoint.' },
    standardHeaders: true, legacyHeaders: false,
});

// Protect V1 API routes, allow unlimited access for V2 and webhook
app.use(/^\/api\/(?!v2|telegram-webhook).*/, limiter);

app.use('/api/bulk-scan',       originProtector, bulkLimiter);
app.use('/api/blacklist-check', originProtector, heavyLimiter);
app.use('/api/port-scan',       originProtector, heavyLimiter);
app.use('/api/process-scan',    originProtector);

// 4. Global middleware: block banned IPs + headless bot UAs
app.use((req, res, next) => {
    const ip = req.headers['cf-connecting-ip'] || req.ip || '';
    if (bannedIPs.has(ip)) {
        return res.status(429).json({ error: 'Banned.' });
    }
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const badAgents = ['python-requests','curl/','go-http-client','java/','scrapy','wget/',
                       'httpclient','libwww','masscan','zgrab','nmap','nikto','sqlmap'];
    if (badAgents.some(b => ua.includes(b))) {
        return res.status(403).json({ error: 'Forbidden.' });
    }
    next();
});

// 4. HONEYPOT TRAP — any bot that crawls hidden links gets their IP auto-banned
// (This path is hidden in scan.ejs inside display:none — real users never click it)
app.get('/api/ping-check', (req, res) => {
    const ip = req.headers['cf-connecting-ip'] || req.ip;
    bannedIPs.add(ip);
    console.warn(`[HONEYPOT] Banned bot IP: ${ip}`);
    // Return a fake 200 so bots don't know they've been caught
    res.status(200).json({ status: 'ok', latency: Math.floor(Math.random()*30)+5 });
});


// ─── SEO: ROBOTS & SITEMAP (must be before express.static) ─────────────────
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nAllow: /\nSitemap: https://whoer.live/sitemap.xml');
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    const today = new Date().toISOString().split('T')[0];
    const countries = ['usa','uk','canada','germany','france','brazil','india','australia',
                       'japan','russia','china','spain','italy','mexico','netherlands',
                       'indonesia','south-korea','turkey','sweden','switzerland','poland',
                       'argentina','south-africa','vietnam','thailand','egypt','pakistan'];
    const doorwayUrls = countries.map(c => `
    <url>
        <loc>https://whoer.live/proxy/${c}</loc>
        <lastmod>${today}</lastmod>
        <changefreq>hourly</changefreq>
        <priority>0.9</priority>
    </url>`).join('');

    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://whoer.live/</loc><lastmod>${today}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>
    <url><loc>https://whoer.live/bulk</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>
    <url><loc>https://whoer.live/api-docs</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>
    <url><loc>https://whoer.live/blacklist</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>
    <url><loc>https://whoer.live/port-scanner</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>
    <url><loc>https://whoer.live/ping</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>
    <url><loc>https://whoer.live/guides</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>${doorwayUrls}
</urlset>`);
});

// Static files — Vercel serves /public automatically but Express handles dev
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');

// ─── KV STORAGE (Vercel KV / Redis) ──────────────────────────────────────────
// Falls back to in-memory Map if KV env vars not set (local dev)
let kvStore = null;

async function getKV() {
    if (kvStore) return kvStore;
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        const { kv } = require('@vercel/kv');
        kvStore = kv;
        return kv;
    }
    // Local dev fallback — in-memory store
    if (!global._devKV) global._devKV = new Map();
    return {
        set: async (k, v, opts) => global._devKV.set(k, v),
        get: async (k) => global._devKV.get(k) || null,
        lrange: async (k, s, e) => {
            const list = global._devKV.get(k) || [];
            return list.slice(s, e === -1 ? undefined : e + 1);
        },
        lpush: async (k, ...vals) => {
            const list = global._devKV.get(k) || [];
            list.unshift(...vals);
            global._devKV.set(k, list);
            return list.length;
        },
        ltrim: async (k, s, e) => {
            const list = global._devKV.get(k) || [];
            global._devKV.set(k, list.slice(s, e + 1));
        },
    };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getTimeByZone(zone) {
    try {
        if (!zone) return 'Unknown';
        return new Date().toLocaleString('en-US', {
            timeZone: zone,
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false, timeZoneName: 'short',
        });
    } catch (e) { return 'Invalid Zone'; }
}

function getUtcOffset(zone) {
    try {
        const str = new Date().toLocaleString('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
        const match = str.match(/GMT([+-]\d{1,2}(:\d{2})?)/);
        return match ? 'UTC' + match[1] : 'UTC';
    } catch (e) { return ''; }
}

function isHosting(isp) {
    if (!isp) return false;
    const keywords = [
        'amazon', 'google', 'digitalocean', 'microsoft', 'azure',
        'hetzner', 'ovh', 'linode', 'vultr', 'alibaba', 'tencent',
        'oracle', 'host', 'datacenter', 'cdn', 'cloud', 'm247',
        'leaseweb', 'server', 'vpn', 'colocation', 'data packet',
        'contabo', 'choopa', 'psychz', 'multacom', 'quadranet',
    ];
    return keywords.some(key => isp.toLowerCase().includes(key));
}

function cleanIp(raw) {
    let ip = (raw || '').split(',')[0].trim();
    if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return '';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return ip;
}

// ─── SEO ROUTES ──────────────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nAllow: /\nSitemap: https://whoer.live/sitemap.xml');
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml');
    const date = new Date().toISOString().split('T')[0];
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://whoer.live/</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

// ─── MAIN ROUTES ─────────────────────────────────────────────────────────────
app.get('/',            (req, res) => res.render('scan'));
app.get('/bulk',        (req, res) => res.render('bulk'));
app.get('/api-docs',    (req, res) => res.render('apidocs'));
app.get('/blacklist',   (req, res) => res.render('blacklist'));
app.get('/port-scanner',(req, res) => res.render('port_scanner'));
app.get('/ping',        (req, res) => res.render('ping_test'));
app.get('/guides',      (req, res) => res.render('guides'));


// ─── PROGRAMMATIC SEO DOORWAY PAGES ──────────────────────────────────────────
// e.g. /proxy/brazil, /proxy/usa, /proxy/germany
app.get('/proxy/:country', (req, res) => {
    // Format "united-states" -> "United States"
    let country = req.params.country || 'Unknown';
    country = country.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    
    // We pass year and country to the EJS template to ensure title tags are perfectly optimized
    res.render('doorway', { 
        country, 
        year: new Date().getFullYear() 
    });
});

// ─── BULK IP SCAN ─────────────────────────────────────────────────────────────
// Free, no key required. Max 100 IPs. Batched to avoid rate limits.
const handleBulkScan = async (req, res) => {
    try {
        const { ips = [] } = req.body;
        const cleaned = [...new Set(
            ips.map(ip => (ip || '').trim()).filter(ip => ip && /^[\d.:a-fA-F]+$/.test(ip))
        )].slice(0, 100);

        if (!cleaned.length) return res.json({ results: [] });

        // Helper: look up a single IP with fallback
        async function lookupIP(ip) {
            // Primary: ipapi.co
            try {
                const r = await axios.get(`https://ipapi.co/${ip}/json/`, {
                    timeout: 5000, headers: { 'User-Agent': 'whoer.live/4.0' },
                });
                const d = r.data;
                if (d && d.ip && !d.error) {
                    return {
                        ip, country: d.country_name || '—', countryCode: d.country_code || '',
                        city: d.city || '—', region: d.region || '—',
                        isp: d.org || '—', timezone: d.timezone || '—',
                        is_vpn: isHosting(d.org || ''), error: false,
                    };
                }
            } catch (_) {}

            // Fallback: ip-api.com (free, no key)
            try {
                const r2 = await axios.get(
                    `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,timezone`,
                    { timeout: 5000 }
                );
                const d = r2.data;
                if (d && d.status === 'success') {
                    return {
                        ip, country: d.country || '—', countryCode: d.countryCode || '',
                        city: d.city || '—', region: d.regionName || '—',
                        isp: d.org || d.isp || '—', timezone: d.timezone || '—',
                        is_vpn: isHosting(d.org || d.isp || ''), error: false,
                    };
                }
            } catch (_) {}

            return { ip, error: true };
        }

        // Process in batches of 5 with 200ms pause → avoids rate limits
        const BATCH = 5, DELAY = 200;
        const results = [];
        for (let i = 0; i < cleaned.length; i += BATCH) {
            const batch = cleaned.slice(i, i + BATCH);
            const batchResults = await Promise.all(batch.map(lookupIP));
            results.push(...batchResults);
            if (i + BATCH < cleaned.length) {
                await new Promise(r => setTimeout(r, DELAY));
            }
        }

        res.json({ results });
    } catch (err) {
        console.error('bulk-scan error:', err);
        res.status(500).json({ error: 'server_error' });
    }
};
app.post('/api/bulk-scan', handleBulkScan);
app.post('/api/v2/bulk-scan', apiKeyValidator, handleBulkScan);

// ─── DNS PROBE ────────────────────────────────────────────────────────────────
// Frontend makes multiple requests with a session token.
// We record which IPs hit us — if they differ, that hints at split-routing.
const dnsProbes = new Map(); // token → [{ip, ts}]

app.get('/api/dns-probe/:token', (req, res) => {
    const token = (req.params.token || '').slice(0, 64);
    const ip = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    if (!token || !ip) return res.json({ ok: false });
    const list = dnsProbes.get(token) || [];
    list.push({ ip, ts: Date.now() });
    dnsProbes.set(token, list);
    setTimeout(() => dnsProbes.delete(token), 30000); // cleanup after 30s
    res.json({ ok: true });
});

app.get('/api/dns-results/:token', (req, res) => {
    const token = (req.params.token || '').slice(0, 64);
    const list = dnsProbes.get(token) || [];
    const ips  = [...new Set(list.map(e => e.ip))];
    res.json({ ips, count: list.length });
});

// ─── BLACKLIST CHECKER ───────────────────────────────────────────────────────
// Given an IP, reverses it and checks against common DNSBLs
const handleBlacklistCheck = async (req, res) => {
    const { ip } = req.body;
    if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
        return res.status(400).json({ error: 'invalid_ipv4' });
    }
    
    const reversed = ip.split('.').reverse().join('.');
    const lists = [
        { host: 'zen.spamhaus.org', name: 'Spamhaus ZEN' },
        { host: 'b.barracudacentral.org', name: 'Barracuda' },
        { host: 'bl.spamcop.net', name: 'SpamCop' },
        { host: 'dnsbl.sorbs.net', name: 'SORBS' },
        { host: 'cbl.abuseat.org', name: 'CBL' }
    ];

    const results = await Promise.all(lists.map(async (list) => {
        try {
            const addrs = await dns.resolve4(`${reversed}.${list.host}`);
            return { list: list.name, listed: true, details: addrs[0] };
        } catch (e) {
            return { list: list.name, listed: false };
        }
    }));

    res.json({ ip, results });
};
app.post('/api/blacklist-check', handleBlacklistCheck);
app.post('/api/v2/blacklist-check', apiKeyValidator, handleBlacklistCheck);

// ─── PORT SCANNER ────────────────────────────────────────────────────────────
// Attempts to open a TCP socket to a given IP and port, returns open/closed
const handlePortScan = async (req, res) => {
    const { ip, ports } = req.body;
    if (!ip || !Array.isArray(ports)) return res.status(400).json({ error: 'invalid_request' });

    const results = await Promise.all(ports.slice(0, 20).map(port => {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000); // 2 second timeout
            
            socket.on('connect', () => {
                socket.destroy();
                resolve({ port, status: 'open' });
            });
            socket.on('timeout', () => {
                socket.destroy();
                resolve({ port, status: 'filtered' }); // dropped/timeout
            });
            socket.on('error', () => {
                resolve({ port, status: 'closed' }); // actively rejected
            });
            socket.connect(Number(port), ip);
        });
    }));

    res.json({ ip, results });
};
app.post('/api/port-scan', handlePortScan);
app.post('/api/v2/port-scan', apiKeyValidator, handlePortScan);

// WebRTC leak test — client posts discovered IPs
app.post('/api/webrtc-check', async (req, res) => {
    const { ips = [] } = req.body;
    const userIp = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    const leaked = ips.filter(ip =>
        ip &&
        ip !== userIp &&
        !ip.startsWith('192.168') &&
        !ip.startsWith('10.')     &&
        !ip.startsWith('172.')    &&
        !ip.startsWith('169.254') &&
        ip !== '0.0.0.0'
    );
    res.json({ leaked, count: leaked.length });
});

// DNS leak test — client fetches several random subdomains of a test domain
// We just confirm the request arrived from a different IP than the user's
app.get('/api/dns-probe/:token', (req, res) => {
    const ip = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    res.json({ ok: true, resolved_from: ip, token: req.params.token });
});

// Main scan endpoint
app.post('/api/process-scan', async (req, res) => {
    try {
        const clientData = req.body;
        const userIp = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');

        let ipInfo = {};

        // Primary: ipapi.co — HTTPS, no key needed for moderate usage
        try {
            const r = await axios.get(
                `https://ipapi.co/${userIp}/json/`,
                { timeout: 4000, headers: { 'User-Agent': 'whoer.live/4.0' } }
            );
            const d = r.data;
            if (d && d.ip && !d.error) {
                ipInfo = {
                    query:       d.ip,
                    country:     d.country_name,
                    countryCode: d.country_code,
                    region:      d.region,
                    city:        d.city,
                    zip:         d.postal,
                    isp:         d.org,
                    org:         d.org,
                    timezone:    d.timezone,
                    as:          d.asn,
                    latitude:    d.latitude,
                    longitude:   d.longitude,
                };
            } else throw new Error('ipapi.co failed');
        } catch (e1) {
            // Fallback: ip-api.com — must use HTTPS (Pro) or HTTP only via their free tier
            // We use ip-api.com via HTTP as last resort (works from Vercel edge but may be blocked)
            try {
                const r2 = await axios.get(
                    `http://ip-api.com/json/${userIp}?fields=status,country,countryCode,regionName,city,zip,timezone,isp,org,as,query,lat,lon`,
                    { timeout: 3500 }
                );
                if (r2.data.status === 'success') {
                    const d = r2.data;
                    ipInfo = {
                        query:       d.query,
                        country:     d.country,
                        countryCode: d.countryCode,
                        region:      d.regionName,
                        city:        d.city,
                        zip:         d.zip,
                        isp:         d.isp,
                        org:         d.org || d.isp,
                        timezone:    d.timezone,
                        as:          d.as,
                        latitude:    d.lat,
                        longitude:   d.lon,
                    };
                } else throw new Error('ip-api failed');
            } catch (e2) {
                ipInfo = {
                    query: userIp || 'Unknown',
                    isp: 'Unknown', org: 'Unknown',
                    country: 'Unknown', countryCode: '',
                    region: 'Unknown', city: 'Unknown',
                    timezone: 'UTC', zip: '', as: 'N/A',
                };
            }
        }

        const isVpn = isHosting(ipInfo.isp || ipInfo.org || '');
        const parser = new UAParser(clientData.userAgent);
        const uaResult = parser.getResult();

        const browserFull = `${uaResult.browser.name || 'Unknown'} ${uaResult.browser.version || ''}`.trim();
        const osFull      = `${uaResult.os.name || 'Unknown'} ${uaResult.os.version || ''}`.trim();
        const deviceType  = uaResult.device.type || 'desktop';

        const isAutomation = !!(clientData.webdriver || uaResult.browser.name === undefined);

        const sysTZ       = clientData.timezone || 'UTC';
        const ipTZ        = ipInfo.timezone || 'UTC';
        const localTimeStr  = getTimeByZone(ipTZ);
        const systemTimeStr = getTimeByZone(sysTZ);
        const utcOffset   = getUtcOffset(ipTZ);

        const localHour = new Date().toLocaleString('en-US', { timeZone: ipTZ,  hour: 'numeric' });
        const sysHour   = new Date().toLocaleString('en-US', { timeZone: sysTZ, hour: 'numeric' });
        const timeMismatch = localHour !== sysHour;

        // Language mismatch — compare browser language country with IP country
        const browserLangCountry = (clientData.language || '').split('-')[1] || '';
        const langMismatch = browserLangCountry &&
            ipInfo.countryCode &&
            browserLangCountry.toUpperCase() !== ipInfo.countryCode.toUpperCase();

        // ── Scoring ──────────────────────────────────────────────────────────
        let score    = 100;
        let risks    = [];
        let warnings = [];

        if (isVpn)       { score -= 30; risks.push({ id: 'vpn',   label: 'VPN / Hosting IP',     detail: ipInfo.isp || '' }); }
        if (timeMismatch){ score -= 15; risks.push({ id: 'time',  label: 'Timezone mismatch',    detail: `IP: ${ipTZ} / Browser: ${sysTZ}` }); }
        if (isAutomation){ score -= 20; risks.push({ id: 'bot',   label: 'Antidetect / Bot',     detail: 'navigator.webdriver detected' }); }
        if (!clientData.canvasHash || clientData.canvasHash === 'error') {
            score -= 10;
            warnings.push({ id: 'canvas', label: 'Canvas blocked', detail: 'Fingerprint API restricted' });
        }
        if (langMismatch){ score -= 10; warnings.push({ id: 'lang', label: 'Language mismatch', detail: `${browserLangCountry} vs ${ipInfo.countryCode}` }); }
        if (clientData.webrtcLeaked){ score -= 15; risks.push({ id: 'webrtc', label: 'WebRTC IP leak', detail: clientData.webrtcIps?.join(', ') || '' }); }

        score = Math.max(0, score);

        const report = {
            id:        uuidv4(),
            score,
            risks,
            warnings,
            ip_data: {
                ip:          ipInfo.query,
                country:     ipInfo.country,
                countryCode: ipInfo.countryCode,
                region:      ipInfo.region,
                city:        ipInfo.city,
                zip:         ipInfo.zip,
                isp:         ipInfo.isp,
                org:         ipInfo.org || ipInfo.isp,
                asn:         ipInfo.as || 'N/A',
                timezone:    ipTZ,
                utc_offset:  utcOffset,
                local_time:  localTimeStr,
                is_hosting:  isVpn,
                latitude:    ipInfo.latitude,
                longitude:   ipInfo.longitude,
            },
            browser_data: {
                browser:      browserFull,
                os:           osFull,
                device:       deviceType,
                is_antidetect: isAutomation,
                timezone:     sysTZ,
                system_time:  systemTimeStr,
                time_mismatch: timeMismatch,
                lang_mismatch: langMismatch,
                ...clientData,
            },
            timestamp: new Date().toISOString(),
        };

        // ── Persist to KV (fire-and-forget, don't block response) ────────────
        getKV().then(kv => {
            const payload = JSON.stringify(report);
            kv.set(`report:${report.id}`, payload, { ex: 60 * 60 * 24 * 30 }) // 30 days TTL
              .catch(() => {});
            // Keep a list of recent report IDs (latest 1000)
            kv.lpush('reports:list', report.id)
              .then(() => kv.ltrim('reports:list', 0, 999))
              .catch(() => {});
        }).catch(() => {});

        res.json({ success: true, report });

    } catch (error) {
        console.error('process-scan error:', error);
        res.status(500).json({ error: 'server_error' });
    }
});

// ─── TELEGRAM ADMIN WEBHOOK ──────────────────────────────────────────────────
app.post('/api/telegram-webhook', async (req, res) => {
    res.send('ok'); // Always ack quickly to Telegram
    
    const message = req.body?.message;
    if (!message || !message.text) return;
    
    const chatId = message.chat.id.toString();
    const text = message.text.trim();
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8699755123:AAFLqOjndyc29DJMIu0Bf_NijsxGXp75h34';
    const ADMIN_ID = process.env.ADMIN_CHAT_ID;
    
    const sendMsg = async (msg) => {
        try {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                chat_id: chatId, text: msg, parse_mode: 'Markdown'
            });
        } catch (e) {
            console.error('Telegram reply error:', e.message);
        }
    };

    // Global /start (open to anyone so user can find their ID)
    if (text.startsWith('/start')) {
        await sendMsg(`👋 *Whoer.live Admin Bot*\n\nYour Telegram User ID is: \`${chatId}\`\n\nIf you are the admin, put this ID in Vercel as \`ADMIN_CHAT_ID\`.`);
        return;
    }

    // AUTHENTICATION BARRIER — Block unauthorized users
    if (ADMIN_ID && chatId !== ADMIN_ID) {
        await sendMsg('⛔ Unauthorized. You are not the admin.');
        return;
    }

    // If ADMIN_ID is not set yet, warn them
    if (!ADMIN_ID) {
        await sendMsg(`⚠️ WARNING: \`ADMIN_CHAT_ID\` is not set in Vercel environment variables. Anyone can use these commands right now. Your ID is \`${chatId}\`. Put it in Vercel to lock this bot down.`);
    }

    // /genkey [days]
    if (text.startsWith('/genkey')) {
        const parts = text.split(' ');
        const days = parseInt(parts[1]) || 30;
        const key = 'whr_' + uuidv4().replace(/-/g, '');
        
        try {
            const kv = await getKV();
            // Store key with TTL in seconds
            await kv.set(`apikey:${key}`, { created: Date.now(), days }, { ex: days * 24 * 60 * 60 });
            await sendMsg(`✅ *API Key Generated*\n\n\`${key}\`\n\nExpires in: ${days} days.\nSend this to your customer. They must use it as the \`x-api-key\` header on \`/api/v2/\` endpoints.`);
        } catch (e) {
            await sendMsg('❌ Failed to save key to KV. Ensure KV_REST_API_URL is set in Vercel. Error: ' + e.message);
        }
        return;
    }

    // /ban [ip]
    if (text.startsWith('/ban ')) {
        const ip = text.split(' ')[1];
        if (ip) {
            bannedIPs.add(ip);
            await sendMsg(`🔨 *BANNED:*\n\`${ip}\``);
        }
        return;
    }

    // /unban [ip]
    if (text.startsWith('/unban ')) {
        const ip = text.split(' ')[1];
        if (ip) {
            bannedIPs.delete(ip);
            await sendMsg(`🔓 *UNBANNED:*\n\`${ip}\``);
        }
        return;
    }

    // /clearban
    if (text === '/clearban') {
        bannedIPs.clear();
        await sendMsg(`🧹 *Banlist Cleared!*`);
        return;
    }

    // /stats
    if (text.startsWith('/stats')) {
        try {
            const kv = await getKV();
            let total = 0;
            try { total = (await kv.lrange('reports:list', 0, -1)).length; } catch(e){}
            await sendMsg(`📊 *System Stats*\n\n- Reports recorded: ${total}\n- In-Memory Banned Bot IPs (Honeypot): ${bannedIPs.size}`);
        } catch (e) {
            await sendMsg('❌ Failed to get stats: ' + e.message);
        }
    }
});

// ─── EXPORT (Vercel serverless — no app.listen) ───────────────────────────────
// For local dev, you can still run: node -e "require('./api/index').listen(3000)"
module.exports = app;

// Local dev convenience
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Dev server running on http://localhost:${PORT}`));
}
