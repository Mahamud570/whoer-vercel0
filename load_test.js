/**
 * Whoer.live - V1 API DDoS & Rate Limit Stress Tester
 * 
 * This script will spawn multiple asynchronous asynchronous loops to heavily bombard 
 * the free `/api/bulk-scan` endpoint.
 *
 * Expected Result:
 * The first 60 requests should return 200 OK.
 * Every request after the 60th should instantly return 429 Too Many Requests (Rate Limited).
 */

const axios = require('axios');

const TARGET_URL = 'https://www.whoer.live/api/bulk-scan';
const TOTAL_REQUESTS = 200; // Total number of requests to fire
const CONCURRENCY = 20;     // How many requests to fire simultaneously

async function ddosAttack(id, totalPerThread) {
    let successCount = 0;
    let rateLimitCount = 0;
    let errorCount = 0;

    for (let i = 0; i < totalPerThread; i++) {
        try {
            const res = await axios.post(
                TARGET_URL,
                { ips: ["8.8.8.8"] }, // Dummy payload
                {
                    headers: {
                        // We must spoof the Origin since our backend drops anything not from whoer.live
                        'Origin': 'https://www.whoer.live',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LoadTester/1.0',
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000 // 10 second timeout
                }
            );

            if (res.status === 200) successCount++;
        } catch (error) {
            if (error.response && error.response.status === 429) {
                rateLimitCount++;
            } else if (error.response && error.response.status === 403) {
                console.log(`[!] Thread ${id} hit a 403 Forbidden (Origin/Bot block)!`);
                errorCount++;
            } else {
                errorCount++;
            }
        }
    }
    return { successCount, rateLimitCount, errorCount };
}

async function startStressTest() {
    console.log(`[🚀] INITIALIZING LOAD TEST AGAINST: ${TARGET_URL}`);
    console.log(`[+] Total Requests Planned: ${TOTAL_REQUESTS}`);
    console.log(`[+] Concurrency: ${CONCURRENCY} simultaneous threads\n`);

    const requestsPerThread = Math.floor(TOTAL_REQUESTS / CONCURRENCY);
    const threads = [];

    const startTime = Date.now();

    // Spawn the attack threads
    for (let i = 0; i < CONCURRENCY; i++) {
        threads.push(ddosAttack(i, requestsPerThread));
    }

    console.log(`[🔥] FIRING SCRIPT... Please wait.\n`);

    const results = await Promise.all(threads);

    const endTime = Date.now();
    const durationStr = ((endTime - startTime) / 1000).toFixed(2);

    // Aggregate results
    let totalSuccess = 0;
    let totalRateLimited = 0;
    let totalErrors = 0;

    for (const res of results) {
        totalSuccess += res.successCount;
        totalRateLimited += res.rateLimitCount;
        totalErrors += res.errorCount;
    }

    console.log(`========================================`);
    console.log(`         STRESS TEST RESULTS            `);
    console.log(`========================================`);
    console.log(`Time Taken:        ${durationStr} seconds`);
    console.log(`Total Sent:        ${TOTAL_REQUESTS} requests`);
    console.log(`Total 200 OK:      ${totalSuccess} (Requests allowed)`);
    console.log(`Total 429 BLOCKS:  ${totalRateLimited} (Requests stopped by Rate Limiter)`);
    console.log(`Other Errors:      ${totalErrors}`);
    console.log(`========================================\n`);

    if (totalSuccess <= 60 && totalRateLimited > 0) {
        console.log(`[✅] VERDICT: DDoS Protection is WORKING PERFECTLY. The Rate Limiter successfully caught the attack after ~60 requests.`);
    } else {
        console.log(`[❌] VERDICT: WARNING! Protection failed or limits are misconfigured. Site absorbed too much traffic.`);
    }
}

startStressTest();
