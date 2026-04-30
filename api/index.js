const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const UAParser = require('ua-parser-js');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const dns = require('dns').promises;
const net = require('net');

// ─── LOAD DATA ───────────────────────────────────────────────────────────────
const vpnBrandsPath = path.join(__dirname, '..', 'data', 'vpn_brands.json');
const ispsPath = path.join(__dirname, '..', 'data', 'isps.json');
const geoDataPath = path.join(__dirname, '..', 'data', 'geo_data.json');

let VPN_BRANDS = {};
let ISP_DATA = {};
let GEO_DATA = {};

try {
    console.log('--- STARTING DATA LOAD ---');
    VPN_BRANDS = JSON.parse(fs.readFileSync(vpnBrandsPath, 'utf8'));
    ISP_DATA = JSON.parse(fs.readFileSync(ispsPath, 'utf8'));
    GEO_DATA = JSON.parse(fs.readFileSync(geoDataPath, 'utf8'));
    console.log(`Loaded ${Object.keys(VPN_BRANDS).length} VPNs, ${Object.keys(ISP_DATA).length} ISPs, ${Object.keys(GEO_DATA).length} Countries.`);
} catch (e) {
    console.error('CRITICAL DATA LOAD ERROR:', e.message);
}

// ─── TOOL LANDINGS DATA ──────────────────────────────────────────────────────
const TOOL_LANDINGS = {
    'ip-location-lookup': {
        title: 'IP Location Lookup — Find Geographic Location of Any IP | Whoer Live',
        h1: 'IP Location Lookup',
        description: 'Look up the geographic location, ISP, and owner of any IP address. Free IP geolocation tool with country, city, and ASN data.',
        intro: 'IP geolocation maps an IP address to a physical location. While not 100% precise, it can identify the country, city, ISP, and organization behind any IP address — useful for security, fraud detection, and network analysis.',
        searchVolume: '28,000',
        icon: '🌍',
        faqs: [
            { q: 'How accurate is IP geolocation?', a: 'IP geolocation is usually accurate at the country and city level, but rarely pinpoints a specific street address. It relies on databases mapping IP ranges to registered physical locations.' },
            { q: 'Can someone find my house with my IP?', a: 'Generally, no. Your IP address only identifies your ISP and the general area (city/region) where your connection originates. Only law enforcement with a warrant can get your exact address from your ISP.' }
        ]
    },
    'vpn-detector': {
        title: 'VPN Detector — Check If You Look Like a VPN User | Whoer Live',
        h1: 'VPN & Proxy Detector',
        description: 'Check if your IP is flagged as a VPN, proxy, datacenter, or TOR exit node. See exactly what ad networks and websites see when you connect.',
        intro: 'VPN detection services cross-reference your IP against massive databases of known VPN provider IPs, datacenter ranges, and proxy servers. If your IP is listed, websites may block you or show you different content.',
        searchVolume: '18,000',
        icon: '🛡️',
        faqs: [
            { q: 'How do websites detect my VPN?', a: 'Websites use IP intelligence databases that flag IPs belonging to known VPN providers and datacenters. They also check for WebRTC leaks and timezone mismatches.' },
            { q: 'Can I bypass VPN detection?', a: 'Using residential proxies or high-quality obfuscated VPN protocols can make detection much harder, as your IP will look like a standard home connection.' }
        ]
    },
    'browser-fingerprint-test': {
        title: 'Browser Fingerprint Test — How Unique Is Your Browser? | Whoer Live',
        h1: 'Browser Fingerprint Test',
        description: 'See how uniquely identifiable your browser is across the web. Test Canvas, WebGL, audio, and font fingerprints used by ad trackers.',
        intro: 'Browser fingerprinting is a tracking technique that identifies you by collecting unique characteristics of your browser — screen resolution, fonts, canvas rendering, WebGL renderer, and more — without using cookies.',
        searchVolume: '12,000',
        icon: '🔍',
        faqs: [
            { q: 'What is browser fingerprinting?', a: 'It is a method of tracking users by collecting a "fingerprint" of their browser settings and hardware configuration. Unlike cookies, it is very difficult to block or delete.' },
            { q: 'How can I prevent fingerprinting?', a: 'Using an anti-detect browser or specific browser extensions can help by "spoofing" or adding noise to your fingerprints, making you look like a different user.' }
        ]
    },
    'timezone-check': {
        title: 'Timezone Mismatch Checker — Detect VPN Location Inconsistency | Whoer Live',
        h1: 'Timezone Mismatch Check',
        description: 'Check if your browser timezone matches your IP address location. A timezone mismatch is a common VPN detection signal used by websites.',
        intro: 'Your browser reports its timezone via JavaScript. If your VPN shows an IP in Germany but your browser timezone is "Asia/Dhaka", anti-fraud systems will immediately flag this inconsistency. This tool checks for that mismatch.',
        searchVolume: '6,000',
        icon: '🕒',
        faqs: [
            { q: 'What is a timezone mismatch?', a: 'It occurs when your IP address indicates one location while your browser settings report a different timezone. This is a red flag for many security systems.' },
            { q: 'How do I fix a timezone mismatch?', a: 'You should manually change your system or browser timezone to match the location of your VPN server.' }
        ]
    },
    'webrtc-leak-test': {
        title: 'WebRTC Leak Test — Protect Your Real IP From Exposure | Whoer Live',
        h1: 'WebRTC Leak Test',
        description: 'Check if your browser is leaking your real IP address through WebRTC. Essential test for VPN and proxy users to ensure total anonymity.',
        intro: 'WebRTC is a browser feature for video calls that can bypass VPN tunnels and reveal your true IP address. Even if your IP says USA, WebRTC might leak your real home IP. Our tool detects this instantly.',
        searchVolume: '45,000',
        icon: '🔴',
        faqs: [
            { q: 'Does every VPN prevent WebRTC leaks?', a: 'No. Many VPNs do not block WebRTC by default. You often need to disable WebRTC in your browser settings or use a dedicated browser extension.' },
            { q: 'Is it safe to disable WebRTC?', a: 'Yes, but it may break some browser-based video calling services like Google Meet or Discord web. You can always re-enable it when needed.' }
        ]
    },
    'dns-leak-test': {
        title: 'DNS Leak Test — Verify Your VPN Is Not Leaking History | Whoer Live',
        h1: 'DNS Leak Test',
        description: 'Test if your DNS queries are leaking to your ISP. Ensure your browsing history is private and your VPN tunnel is secure.',
        intro: 'A DNS leak occurs when your browser sends DNS queries to your ISP instead of your VPN provider. This allows your ISP to track every website you visit. Our live test identifies these leaks in real-time.',
        searchVolume: '32,000',
        icon: '🟡',
        faqs: [
            { q: 'What causes a DNS leak?', a: 'It is often caused by incorrect OS network settings, router configurations, or a VPN that doesn’t have built-in DNS protection.' },
            { q: 'How do I stop DNS leaks?', a: 'Use a VPN with private DNS, or manually configure your device to use secure third-party DNS servers like Cloudflare (1.1.1.1) or Google (8.8.8.8).' }
        ]
    }
};

const app = express();

// ─── SECURITY & PERFORMANCE ──────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
const apiKeyValidator = async (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'api_key_required' });
    try {
        const kv = await getKV();
        const data = await kv.get(`apikey:${key}`);
        if (!data) return res.status(403).json({ error: 'invalid_api_key' });
        next();
    } catch (e) { next(); }
};

const bannedIPs = new Set();
app.use((req, res, next) => {
    const ip = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    if (bannedIPs.has(ip)) return res.status(403).send('Banned');
    next();
});

// ─── ROBOTS & SITEMAP ────────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://www.whoer.live/sitemap.xml');
});

// Redirect /sitemap and /api/sitemap to /sitemap.xml
app.get(['/sitemap', '/api/sitemap'], (req, res) => res.redirect('/sitemap.xml'));


app.get('/sitemap.xml', (req, res) => {
    const baseUrl = 'https://www.whoer.live';
    const lastMod = new Date().toISOString().split('T')[0];
    
    let urls = [
        { loc: '/', priority: '1.0' },
        { loc: '/bulk', priority: '0.8' },
        { loc: '/api-docs', priority: '0.7' },
        { loc: '/threat-map', priority: '0.7' },
        { loc: '/blacklist', priority: '0.7' },
        { loc: '/port-scanner', priority: '0.7' },
        { loc: '/ping', priority: '0.7' },
        { loc: '/guides', priority: '0.9' }
    ];

    Object.keys(TOOL_LANDINGS).forEach(slug => {
        urls.push({ loc: `/${slug}`, priority: '0.9' });
    });

    Object.keys(VPN_BRANDS).forEach(slug => {
        urls.push({ loc: `/vpn-test/${slug}`, priority: '0.8' });
    });

    Object.keys(ISP_DATA).forEach(slug => {
        urls.push({ loc: `/isp/${slug}`, priority: '0.7' });
    });

    Object.keys(GEO_DATA).forEach(country => {
        urls.push({ loc: `/proxy/${country}`, priority: '0.7' });
        GEO_DATA[country].forEach(city => {
            urls.push({ loc: `/proxy/${country}/${city}`, priority: '0.6' });
        });
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${baseUrl}${u.loc}</loc>
    <lastmod>${lastMod}</lastmod>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

// ─── STATIC CONFIG ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');

// ─── KV STORAGE (Vercel KV / Redis) ──────────────────────────────────────────
let kvStore = null;
async function getKV() {
    if (kvStore) return kvStore;
    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        const { kv } = require('@vercel/kv');
        kvStore = kv;
        return kv;
    }
    if (!global._devKV) global._devKV = new Map();
    return {
        set: async (k, v, opts) => global._devKV.set(k, v),
        get: async (k) => global._devKV.get(k) || null,
        del: async (k) => global._devKV.delete(k),
        incr: async (k) => { let v = (global._devKV.get(k) || 0) + 1; global._devKV.set(k, v); return v; },
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
    const keywords = ['amazon', 'google', 'digitalocean', 'microsoft', 'azure', 'hetzner', 'ovh', 'linode', 'vultr', 'm247', 'datacenter', 'vpn', 'proxy'];
    return keywords.some(key => isp.toLowerCase().includes(key));
}

function cleanIp(raw) {
    let ip = (raw || '').split(',')[0].trim();
    if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') return '';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7);
    return ip;
}

// ─── MAIN ROUTES ─────────────────────────────────────────────────────────────
app.get('/',            (req, res) => res.render('scan'));
app.get('/bulk',        (req, res) => res.render('bulk'));
app.get('/api-docs',    (req, res) => res.render('apidocs'));
app.get('/blacklist',   (req, res) => res.render('blacklist'));
app.get('/port-scanner',(req, res) => res.render('port_scanner'));
app.get('/ping',        (req, res) => res.render('ping_test'));
app.get('/guides',      (req, res) => res.render('guides'));
app.get('/threat-map',  (req, res) => res.render('threat_map'));

// ─── TOOL LANDING PAGES ──────────────────────────────────────────────────────
app.get('/ip-location-lookup',    (req, res) => res.render('tool_landing', { tool: TOOL_LANDINGS['ip-location-lookup'], slug: 'ip-location-lookup', year: new Date().getFullYear() }));
app.get('/vpn-detector',         (req, res) => res.render('tool_landing', { tool: TOOL_LANDINGS['vpn-detector'], slug: 'vpn-detector', year: new Date().getFullYear() }));
app.get('/browser-fingerprint-test', (req, res) => res.render('tool_landing', { tool: TOOL_LANDINGS['browser-fingerprint-test'], slug: 'browser-fingerprint-test', year: new Date().getFullYear() }));
app.get('/timezone-check',       (req, res) => res.render('tool_landing', { tool: TOOL_LANDINGS['timezone-check'], slug: 'timezone-check', year: new Date().getFullYear() }));
app.get('/webrtc-leak-test',     (req, res) => res.render('tool_landing', { tool: TOOL_LANDINGS['webrtc-leak-test'], slug: 'webrtc-leak-test', year: new Date().getFullYear() }));
app.get('/dns-leak-test',        (req, res) => res.render('tool_landing', { tool: TOOL_LANDINGS['dns-leak-test'], slug: 'dns-leak-test', year: new Date().getFullYear() }));

// ─── VPN BRAND TESTS ─────────────────────────────────────────────────────────
app.get('/vpn-test/:brand', (req, res) => {
    const brand = VPN_BRANDS[req.params.brand];
    if (!brand) return res.status(404).render('404');
    res.render('vpn_test', { brand, year: new Date().getFullYear() });
});

// ─── ISP CHECKER ─────────────────────────────────────────────────────────────
app.get('/isp/:slug', (req, res) => {
    const isp = ISP_DATA[req.params.slug];
    if (!isp) return res.status(404).render('404');
    res.render('isp', { isp, slug: req.params.slug, year: new Date().getFullYear() });
});

// ─── PROXY DOORWAY PAGES ─────────────────────────────────────────────────────
app.get('/proxy/:country/:city?', (req, res) => {
    const country = req.params.country || 'Global';
    const city = req.params.city || '';
    const format = (s) => s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    res.render('doorway', { country: format(country), city: city ? format(city) : '', year: new Date().getFullYear() });
});

// ─── BULK IP SCAN ─────────────────────────────────────────────────────────────
const handleBulkScan = async (req, res) => {
    try {
        const { ips = [] } = req.body;
        const cleaned = [...new Set(
            ips.map(ip => (ip || '').trim()).filter(ip => ip && /^[\d.:a-fA-F]+$/.test(ip))
        )].slice(0, 100);

        if (!cleaned.length) return res.json({ results: [] });

        async function lookupIP(ip) {
            try {
                const r = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 5000, headers: { 'User-Agent': 'whoer.live/4.0' } });
                const d = r.data;
                if (d && d.ip && !d.error) {
                    return { ip, country: d.country_name, countryCode: d.country_code, city: d.city, region: d.region, isp: d.org, timezone: d.timezone, is_vpn: isHosting(d.org || ''), error: false };
                }
            } catch (_) {}
            try {
                const r2 = await axios.get(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,timezone`, { timeout: 5000 });
                if (r2.data.status === 'success') {
                    const d = r2.data;
                    return { ip, country: d.country, countryCode: d.countryCode, city: d.city, region: d.regionName, isp: d.org || d.isp, timezone: d.timezone, is_vpn: isHosting(d.org || d.isp || ''), error: false };
                }
            } catch (_) {}
            return { ip, error: true };
        }

        const BATCH = 5, DELAY = 200;
        const results = [];
        for (let i = 0; i < cleaned.length; i += BATCH) {
            const batch = cleaned.slice(i, i + BATCH);
            results.push(...(await Promise.all(batch.map(lookupIP))));
            if (i + BATCH < cleaned.length) await new Promise(r => setTimeout(r, DELAY));
        }
        res.json({ results });
    } catch (err) { res.status(500).json({ error: 'server_error' }); }
};
app.post('/api/bulk-scan', handleBulkScan);
app.post('/api/v2/bulk-scan', apiKeyValidator, handleBulkScan);

// ─── DNS PROBE ────────────────────────────────────────────────────────────────
const dnsProbes = new Map();
app.get('/api/dns-probe/:token', (req, res) => {
    const token = (req.params.token || '').slice(0, 64);
    const ip = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    if (!token || !ip) return res.json({ ok: false });
    const list = dnsProbes.get(token) || [];
    list.push({ ip, ts: Date.now() });
    dnsProbes.set(token, list);
    setTimeout(() => dnsProbes.delete(token), 30000);
    res.json({ ok: true });
});

app.get('/api/dns-results/:token', (req, res) => {
    const token = (req.params.token || '').slice(0, 64);
    const list = dnsProbes.get(token) || [];
    const ips = [...new Set(list.map(e => e.ip))];
    res.json({ ips, count: list.length });
});

// ─── BLACKLIST CHECKER ───────────────────────────────────────────────────────
const handleBlacklistCheck = async (req, res) => {
    const { ip } = req.body;
    if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return res.status(400).json({ error: 'invalid_ipv4' });
    const reversed = ip.split('.').reverse().join('.');
    const lists = [{ host: 'zen.spamhaus.org', name: 'Spamhaus ZEN' }, { host: 'b.barracudacentral.org', name: 'Barracuda' }, { host: 'bl.spamcop.net', name: 'SpamCop' }];
    const results = await Promise.all(lists.map(async (list) => {
        try { await dns.resolve4(`${reversed}.${list.host}`); return { list: list.name, listed: true }; }
        catch (e) { return { list: list.name, listed: false }; }
    }));
    res.json({ ip, results });
};
app.post('/api/blacklist-check', handleBlacklistCheck);
app.post('/api/v2/blacklist-check', apiKeyValidator, handleBlacklistCheck);

// ─── PORT SCANNER ────────────────────────────────────────────────────────────
const handlePortScan = async (req, res) => {
    const { ip, ports } = req.body;
    if (!ip || !Array.isArray(ports)) return res.status(400).json({ error: 'invalid_request' });
    const results = await Promise.all(ports.slice(0, 20).map(port => {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(2000);
            socket.on('connect', () => { socket.destroy(); resolve({ port, status: 'open' }); });
            socket.on('timeout', () => { socket.destroy(); resolve({ port, status: 'filtered' }); });
            socket.on('error', () => { resolve({ port, status: 'closed' }); });
            socket.connect(Number(port), ip);
        });
    }));
    res.json({ ip, results });
};
app.post('/api/port-scan', handlePortScan);
app.post('/api/v2/port-scan', apiKeyValidator, handlePortScan);

// ─── WEBRTC CHECK ───────────────────────────────────────────────────────────
app.post('/api/webrtc-check', async (req, res) => {
    const { ips = [] } = req.body;
    const userIp = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    const leaked = ips.filter(ip => ip && ip !== userIp && !ip.startsWith('192.168') && !ip.startsWith('10.') && !ip.startsWith('172.') && !ip.startsWith('169.254') && ip !== '0.0.0.0');
    res.json({ leaked, count: leaked.length });
});

// ─── MAIN SCAN PROCESS ───────────────────────────────────────────────────────
app.post('/api/process-scan', async (req, res) => {
    try {
        const clientData = req.body;
        const userIp = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
        let ipInfo = {};
        try {
            const r = await axios.get(`https://ipapi.co/${userIp}/json/`, { timeout: 4000, headers: { 'User-Agent': 'whoer.live/4.0' } });
            const d = r.data;
            if (d && d.ip && !d.error) {
                ipInfo = { ip: d.ip, country: d.country_name, countryCode: d.country_code, region: d.region, city: d.city, zip: d.postal, isp: d.org, org: d.org, timezone: d.timezone, as: d.asn, latitude: d.latitude, longitude: d.longitude };
            } else throw new Error();
        } catch (e) {
            try {
                const r2 = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,country,countryCode,regionName,city,zip,timezone,isp,org,as,query,lat,lon`, { timeout: 3500 });
                if (r2.data.status === 'success') {
                    const d = r2.data;
                    ipInfo = { ip: d.query, country: d.country, countryCode: d.countryCode, region: d.regionName, city: d.city, zip: d.zip, isp: d.isp, org: d.org || d.isp, timezone: d.timezone, as: d.as, latitude: d.lat, longitude: d.lon };
                } else throw new Error();
            } catch (e2) {
                ipInfo = { ip: userIp || 'Unknown', isp: 'Unknown', org: 'Unknown', country: 'Unknown', countryCode: '', region: 'Unknown', city: 'Unknown', timezone: 'UTC', zip: '', as: 'N/A' };
            }
        }

        const isVpn = isHosting(ipInfo.isp || ipInfo.org || '');
        const parser = new UAParser(clientData.userAgent);
        const uaResult = parser.getResult();
        const sysTZ = clientData.timezone || 'UTC';
        const ipTZ = ipInfo.timezone || 'UTC';
        const timeMismatch = new Date().toLocaleString('en-US', { timeZone: ipTZ, hour: 'numeric' }) !== new Date().toLocaleString('en-US', { timeZone: sysTZ, hour: 'numeric' });

        let score = 100;
        let risks = [];
        if (isVpn) { score -= 30; risks.push({ id: 'vpn', label: 'VPN / Hosting IP', detail: ipInfo.isp }); }
        if (timeMismatch) { score -= 15; risks.push({ id: 'time', label: 'Timezone mismatch', detail: `${ipTZ} vs ${sysTZ}` }); }

        const report = { id: uuidv4(), score: Math.max(0, score), risks, ip_data: ipInfo, browser_data: { ...clientData, browser: uaResult.browser.name, os: uaResult.os.name }, timestamp: new Date().toISOString() };
        
        getKV().then(kv => {
            kv.set(`report:${report.id}`, JSON.stringify(report), { ex: 60 * 60 * 24 * 30 });
            kv.incr('visitor_count');
            kv.lpush('reports:list', report.id).then(() => kv.ltrim('reports:list', 0, 999));
        }).catch(()=>{});

        res.json({ success: true, report });
    } catch (error) { res.status(500).json({ error: 'server_error' }); }
});

// ─── LIVE THREAT FEED ────────────────────────────────────────────────────────
app.get('/api/live-threats', (req, res) => {
    const attacks = ['SQL Injection', 'SSH Brute Force', 'Port Scan', 'XSS Attempt', 'DDoS Probe'];
    const countries = ['CN', 'RU', 'US', 'NL', 'BR', 'IN'];
    const actions = ['BLOCKED', 'DROPPED', 'BANNED'];
    const events = Array.from({ length: Math.floor(Math.random() * 3) + 1 }, () => ({
        id: uuidv4().slice(0, 8), timestamp: new Date().toISOString(), ip: `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
        attack_type: attacks[Math.floor(Math.random() * attacks.length)], country: countries[Math.floor(Math.random() * countries.length)], action: actions[Math.floor(Math.random() * actions.length)]
    }));
    res.json({ events });
});

// ─── TELEGRAM BOT WEBHOOK ────────────────────────────────────────────────────
app.post('/api/telegram-webhook', async (req, res) => {
    res.send('ok');
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8699755123:AAFLqOjndyc29DJMIu0Bf_NijsxGXp75h34';
    const ADMIN_ID = process.env.ADMIN_CHAT_ID;
    const processCommand = async (chatId, command) => {
        if (ADMIN_ID && chatId !== ADMIN_ID) return;
        if (command === '/admin' || command === '/start') {
            await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, { chat_id: chatId, text: '👋 *Welcome Admin!*', parse_mode: 'Markdown' });
        }
    };
    if (req.body.message && req.body.message.text) await processCommand(req.body.message.chat.id.toString(), req.body.message.text.trim());
});

// ─── EXPORT ──────────────────────────────────────────────────────────────────
module.exports = app;
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Dev server running on http://localhost:${PORT}`));
}
