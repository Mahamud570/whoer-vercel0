// ─── Fingerprint + WebRTC Leak Collector ─────────────────────────────────────

async function collectDeviceMetrics() {
    const data = {};

    // ── Basic Navigator ───────────────────────────────────────────────────────
    data.userAgent          = navigator.userAgent;
    data.language           = navigator.language;
    data.languages          = Array.from(navigator.languages || []).join(',');
    data.platform           = navigator.platform;
    data.hardwareConcurrency = navigator.hardwareConcurrency || 0;
    data.deviceMemory       = navigator.deviceMemory || 'unknown';
    data.doNotTrack         = navigator.doNotTrack;
    data.cookiesEnabled     = navigator.cookieEnabled;
    data.timezone           = Intl.DateTimeFormat().resolvedOptions().timeZone;
    data.timezoneOffset     = new Date().getTimezoneOffset();

    // Antidetect / automation check
    data.webdriver = !!(navigator.webdriver);

    // Additional bot signals
    data.hasChrome        = !!(window.chrome);
    data.pluginCount      = navigator.plugins ? navigator.plugins.length : 0;
    data.mimeTypesCount   = navigator.mimeTypes ? navigator.mimeTypes.length : 0;

    // ── Screen ────────────────────────────────────────────────────────────────
    data.screen = {
        width:       screen.width,
        height:      screen.height,
        colorDepth:  screen.colorDepth,
        pixelRatio:  window.devicePixelRatio || 1,
    };

    // ── Canvas Fingerprint ────────────────────────────────────────────────────
    try {
        const canvas = document.createElement('canvas');
        canvas.width  = 240;
        canvas.height = 60;
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font         = "14px 'Arial'";
        ctx.fillStyle    = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle    = '#069';
        ctx.fillText('WhoerCheck ✓', 2, 15);
        ctx.fillStyle    = 'rgba(102,204,0,0.7)';
        ctx.fillText('WhoerCheck ✓', 4, 17);
        data.canvasHash  = hashCode(canvas.toDataURL());
    } catch (e) {
        data.canvasHash = 'error';
    }

    // ── WebGL ─────────────────────────────────────────────────────────────────
    try {
        const canvas = document.createElement('canvas');
        const gl     = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) {
                data.webglVendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
                data.webglRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
                data.webglHash     = hashCode(data.webglVendor + data.webglRenderer);
            }
            data.webglVersion = gl.getParameter(gl.VERSION);
        }
    } catch (e) {
        data.webglHash = null;
    }

    // ── Audio Fingerprint ─────────────────────────────────────────────────────
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            data.audioHash = await new Promise((res) => {
                try {
                    const ctx  = new AudioCtx();
                    const osc  = ctx.createOscillator();
                    const anal = ctx.createAnalyser();
                    const gain = ctx.createGain();
                    gain.gain.value = 0;
                    osc.connect(anal);
                    anal.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(0);
                    // Give the oscillator a tick to actually produce data
                    setTimeout(() => {
                        const buf = new Float32Array(anal.frequencyBinCount);
                        anal.getFloatFrequencyData(buf);
                        osc.stop();
                        ctx.close();
                        res(hashCode(buf.slice(0, 20).join(',')));
                    }, 50);
                } catch (e) { res(null); }
            });
        }
    } catch (e) {
        data.audioHash = null;
    }

    // ── Fonts (quick probe of a short list) ──────────────────────────────────
    try {
        const testFonts = ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana',
                           'Comic Sans MS', 'Impact', 'Tahoma', 'Trebuchet MS', 'Helvetica'];
        const baseline = measureText('mmmmmmmmmmlli', 'monospace');
        data.fonts = testFonts.filter(f => {
            const w = measureText('mmmmmmmmmmlli', `'${f}', monospace`);
            return w !== baseline;
        }).join(',');
    } catch (e) {
        data.fonts = '';
    }

    // ── Touch Support ─────────────────────────────────────────────────────────
    data.touchPoints = navigator.maxTouchPoints || 0;

    // ── WebRTC Leak Detection ─────────────────────────────────────────────────
    data.webrtcLeaked = false;
    data.webrtcIps    = [];
    try {
        const ips = await getWebRTCIPs();
        data.webrtcIps = ips;
        // Report leak if there are non-private IPs
        const publicIps = ips.filter(ip =>
            ip &&
            !ip.startsWith('192.168') &&
            !ip.startsWith('10.')     &&
            !ip.startsWith('172.')    &&
            !ip.startsWith('169.254') &&
            ip !== '0.0.0.0'
        );
        data.webrtcLeaked = publicIps.length > 0;
        data.webrtcPublicIps = publicIps;
    } catch (e) {
        // WebRTC not available or blocked
    }

    return data;
}

// ─── WebRTC IP Enumeration ────────────────────────────────────────────────────
function getWebRTCIPs() {
    return new Promise((resolve) => {
        const ips  = new Set();
        const RTCPeerConnection =
            window.RTCPeerConnection ||
            window.mozRTCPeerConnection ||
            window.webkitRTCPeerConnection;

        if (!RTCPeerConnection) return resolve([]);

        let pc;
        let resolved = false;
        function done() {
            if (resolved) return;
            resolved = true;
            try { pc.close(); } catch(e) {}
            resolve([...ips]);
        }

        try {
            pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        } catch (e) { return resolve([]); }

        pc.createDataChannel('');

        pc.onicecandidate = (e) => {
            if (!e.candidate) return done();
            const line = e.candidate.candidate;
            // Match IPv4 addresses
            const v4 = line.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
            if (v4) ips.add(v4[1]);
            // Match IPv6 addresses (including link-local fe80::)
            const v6 = line.match(/\b([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7})\b/i);
            if (v6 && v6[1].includes(':')) ips.add(v6[1]);
        };

        pc.createOffer()
          .then(o => pc.setLocalDescription(o))
          .catch(() => done());

        // Timeout after 3s
        setTimeout(done, 3000);
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function measureText(text, font) {
    const el = document.createElement('span');
    el.style.cssText = `font:72px ${font};position:absolute;left:-9999px;top:-9999px;`;
    el.textContent   = text;
    document.body.appendChild(el);
    const w = el.offsetWidth;
    document.body.removeChild(el);
    return w;
}

function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16);
}
