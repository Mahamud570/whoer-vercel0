/**
 * Whoer.live - 4G Airplane Mode CTR Bot
 * 
 * PREREQUISITES:
 * 1. Install ADB (Android Debug Bridge) on your Windows PC.
 * 2. Enable "Developer Options" -> "USB Debugging" on your physical Android phones.
 * 3. Plug both phones via USB and turn on Mobile Data (no WiFi).
 * 
 * NOTE ON MUMU: Emulators (like MuMu, BlueStacks, LDPlayer) use your PC's internet connection. 
 * They DO NOT have sim cards and cannot generate new 4G IPs. You MUST use real phones with mobile data plans.
 * 
 * INSTALL DEPENDENCIES:
 * npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { execSync } = require('child_process');
puppeteer.use(StealthPlugin());

const KEYWORD = 'free proxy list whoer live';
const TARGET_DOMAIN = 'whoer.live';

// Function to run ADB commands
function runAdb(command) {
    try {
        console.log(`[ADB] Executing: ${command}`);
        return execSync(command).toString().trim();
    } catch (e) {
        console.error(`[ADB ERROR] Ensure phones are plugged in and USB debugging is on. Details: ${e.message}`);
        return null;
    }
}

// Function to get connected device IDs
function getConnectedDevices() {
    const output = runAdb('adb devices');
    if (!output) return [];
    
    // Parse output to find actual device IDs (ignore the "List of devices attached" header)
    const lines = output.split('\n');
    const devices = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split('\t');
        if (parts.length === 2 && parts[1] === 'device') {
            devices.push(parts[0]);
        }
    }
    return devices;
}

// Function to toggle airplane mode to rotate IP
async function rotateIP(deviceId) {
    console.log(`\n[+] Rotating IP on device: ${deviceId}`);
    
    // Turn Airplane mode ON
    runAdb(`adb -s ${deviceId} shell cmd connectivity airplane-mode enable`);
    console.log(`[+] Airplane mode ENABLED. Waiting 5 seconds...`);
    await new Promise(r => setTimeout(r, 5000));
    
    // Turn Airplane mode OFF (assigns new mobile IP)
    runAdb(`adb -s ${deviceId} shell cmd connectivity airplane-mode disable`);
    console.log(`[+] Airplane mode DISABLED. Waiting 10 seconds for 4G connection...`);
    await new Promise(r => setTimeout(r, 10000));
    
    console.log(`[+] IP completely rotated!`);
}

// Main Google Search automation function
async function simulateSearch() {
    console.log(`\n[+] Launching Stealth Browser to simulate human search...`);
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false, // Must be false for some captchas
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1280,800'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        console.log(`[*] Connecting to Google...`);
        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log(`[*] Typing keyword: "${KEYWORD}"...`);
        await page.type('textarea[name="q"], input[name="q"]', KEYWORD, { delay: 180 });
        await page.keyboard.press('Enter');

        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log(`[*] Looking for ${TARGET_DOMAIN} in the results...`);
        const links = await page.$$('a > h3');
        let clicked = false;

        for (const link of links) {
            const parent = await link.evaluateHandle(el => el.parentElement);
            const href = await parent.evaluate(el => el.href);
            
            if (href && href.includes(TARGET_DOMAIN)) {
                console.log(`[>>>>>] Found target URL! Clicking...`);
                await parent.click();
                clicked = true;
                break;
            }
        }

        if (clicked) {
            console.log(`[+] Successfully clicked! Simulating 60 second dwell time...`);
            await new Promise(r => setTimeout(r, 60000));
            console.log(`[+] Dwell time completed.`);
        } else {
            console.log(`[-] Could not find ${TARGET_DOMAIN} on Page 1.`);
        }
        
    } catch (e) {
        console.log(`[-] Browser encountered an error: ${e.message}`);
    } finally {
        if (browser) await browser.close();
    }
}

// Master Loop
(async () => {
    console.log("=========================================");
    console.log("  Whoer.live - 4G Mobile CTR Bot v1.0    ");
    console.log("=========================================\n");

    const devices = getConnectedDevices();
    if (devices.length === 0) {
        console.log("[-] No phones detected! Please plug in your phones via USB and enable USB Debugging.");
        return;
    }

    console.log(`[+] Found ${devices.length} phone(s) connected: ${devices.join(', ')}`);
    console.log(`[!] MAKE SURE YOUR PC IS CONNECTED TO THE PHONE'S USB TETHERING (Not your home WiFi)!\n`);
    
    const TARGET_CLICKS_PER_PHONE = 5; // Change this to how many times you want it to loop

    for (let loop = 1; loop <= TARGET_CLICKS_PER_PHONE; loop++) {
        console.log(`\n--- Loop ${loop} of ${TARGET_CLICKS_PER_PHONE} ---`);
        
        for (const phoneId of devices) {
            // 1. Rotate the IP on the phone
            await rotateIP(phoneId);
            
            // 2. Do the search using the PC's connection (which is tethered to the newly rotated phone IP)
            await simulateSearch();
            
            console.log(`[+] Cooldown for 30 seconds before next action...`);
            await new Promise(r => setTimeout(r, 30000));
        }
    }
    
    console.log("\n[!!!] FINISHED ALL ROTATIONS!");
})();
