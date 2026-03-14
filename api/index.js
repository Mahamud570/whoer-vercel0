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

const app = express();

// ─── SECURITY & PERFORMANCE ──────────────────────────────────────────────────
app.set('trust proxy', 1); // Required for Vercel/Cloudflare real IPs

app.use(compression());
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// Rate limiting — best-effort on Vercel serverless (no shared state)
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    limit: 60,
    message: { error: 'Too many requests, please wait.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

app.use(bodyParser.json({ limit: '500kb' }));
app.use(bodyParser.urlencoded({ extended: true }));

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
  <url><loc>https://whoer.live/</loc><lastmod>${date}</lastmod><priority>1.0</priority></url>
</urlset>`);
});

// ─── MAIN ROUTES ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.render('scan'));

// WebRTC leak test — client posts discovered IPs
app.post('/api/webrtc-check', async (req, res) => {
    const { ips = [] } = req.body;
    const userIp = cleanIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    const leaked = ips.filter(ip => ip && ip !== userIp && !ip.startsWith('192.168') && !ip.startsWith('10.') && !ip.startsWith('172.'));
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

// ─── EXPORT (Vercel serverless — no app.listen) ───────────────────────────────
// For local dev, you can still run: node -e "require('./api/index').listen(3000)"
module.exports = app;

// Local dev convenience
if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Dev server running on http://localhost:${PORT}`));
}
