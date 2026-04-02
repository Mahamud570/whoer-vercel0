/**
 * Whoer.live - CTR Search Bot (Proof of Concept)
 * Requires Node.js and Puppeteer to be installed:
 * npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth axios
 * 
 * WARNING: 99% of free scraped proxies are blacklisted by Google and will trigger
 * an unsolvable reCAPTCHA before you can even search. For this to actually work
 * in production, you must use premium Residential Proxies (e.g., BrightData, IPRoyal).
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
puppeteer.use(StealthPlugin());

const KEYWORD = 'free proxy list whoer live';
const TARGET_DOMAIN = 'whoer.live';

// 1. Scrape 10 Free Proxies (from a public API)
async function scrapeProxies() {
    try {
        console.log('[*] Fetching free proxies...');
        const res = await axios.get('https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt');
        const list = res.data.split('\n').filter(Boolean);
        return list.slice(0, 10); // Take first 10 for testing
    } catch (e) {
        console.error('[-] Failed to fetch proxies:', e.message);
        return [];
    }
}

// 2. Simulate Human Search and Click
async function runBot(proxy) {
    console.log(`\n[+] Launching Chrome on Proxy: ${proxy}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false, // Set to true to hide the browser globally
            args: [
                `--proxy-server=http://${proxy}`,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--ignore-certificate-errors',
                '--window-size=1280,800'
            ]
        });

        const page = await browser.newPage();
        
        // Emulate realistic viewport
        await page.setViewport({ width: 1280, height: 800 });
        
        // Emulate human User-Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        console.log(`[*] Connecting to Google...`);
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Slow human-typing emulation
        console.log(`[*] Typing keyword: "${KEYWORD}"...`);
        await page.type('textarea[name="q"], input[name="q"]', KEYWORD, { delay: 150 });
        await page.keyboard.press('Enter');

        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log(`[*] Looking for ${TARGET_DOMAIN} in the results...`);
        const links = await page.$$('a > h3');
        let clicked = false;

        for (const link of links) {
            const parent = await link.evaluateHandle(el => el.parentElement);
            const href = await parent.evaluate(el => el.href);
            
            if (href && href.includes(TARGET_DOMAIN)) {
                console.log(`[+] Found target URL! Clicking...`);
                await parent.click();
                clicked = true;
                break;
            }
        }

        if (clicked) {
            console.log(`[*] Successfully clicked the link! Holding Dwell Time for 60 seconds...`);
            // Wait 60 seconds to simulate a user actually reading your page
            await new Promise(r => setTimeout(r, 60000));
            console.log(`[+] Dwell time completed. Closing session.`);
        } else {
            console.log(`[-] Could not find ${TARGET_DOMAIN} on Page 1.`);
        }
        
    } catch (e) {
        console.log(`[-] Proxy failed or Google Captcha blocked us: ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

// 3. Initiate the Loop
(async () => {
    const proxies = await scrapeProxies();
    if (proxies.length === 0) return console.log('No proxies found.');

    console.log(`[+] Scraped ${proxies.length} proxies. Starting sequence...`);
    
    // Test the first 3
    for (let i = 0; i < 3; i++) {
        await runBot(proxies[i]);
    }
    
    console.log('\n[!] Script finished.');
})();
