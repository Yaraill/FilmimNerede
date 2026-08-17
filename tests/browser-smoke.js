const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function runTest() {
    let server;
    let browser;
    try {
        console.log('Starting local static HTTP server...');
        server = http.createServer((req, res) => {
            const urlPath = req.url.split('?')[0].split('#')[0];
            let filePath = path.join(ROOT_DIR, urlPath === '/' ? 'index.html' : urlPath);
            
            // Prevent directory traversal
            if (!filePath.startsWith(ROOT_DIR)) {
                res.writeHead(403);
                return res.end('Forbidden');
            }

            fs.readFile(filePath, (err, content) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                const ext = path.extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            });
        });

        await new Promise(resolve => {
            server.listen(0, '127.0.0.1', () => {
                resolve();
            });
        });
        const port = server.address().port;
        console.log(`Server listening on port ${port}`);

        console.log('Launching Puppeteer...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        const errors = [];
        page.on('pageerror', err => {
            errors.push(err);
        });

        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            if (url.includes('api.themoviedb.org')) {
                if (url.includes('/genre/movie/list') || url.includes('/genre/tv/list')) {
                    request.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ genres: [] })
                    });
                } else {
                    request.respond({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({ results: [], genres: [] })
                    });
                }
            } else {
                request.continue();
            }
        });

        console.log('Navigating to /#profile...');
        await page.goto(`http://127.0.0.1:${port}/#profile`, { waitUntil: 'domcontentloaded', timeout: 30000 });

        console.log('Waiting for application to initialize...');
        // Wait until #profile is active, meaning the router processed the hash
        await page.waitForSelector('#profile.active-tab', { timeout: 10000 });

        console.log('Running page-context assertions...');
        const pageResult = await page.evaluate(() => {
            const msgs = [];
            let pass = true;

            function check(cond, msg) {
                if (!cond) {
                    pass = false;
                    msgs.push(msg);
                }
            }

            check(document.querySelector('#profile'), '#profile should exist');
            check(document.querySelector('#profile').classList.contains('active-tab'), '#profile should have active-tab class');
            check(history.state && history.state.filmRehberiRouter, 'history.state.filmRehberiRouter should exist');

            const criticalFns = [
                'navigate',
                'handleRoute',
                'renderMovie',
                'renderActor',
                'searchMovie',
                'loadPlatformMovies',
                'openCollection',
                'renderRecentlyViewed',
                'executeDiscover'
            ];
            for (const fn of criticalFns) {
                check(typeof window[fn] === 'function', `window.${fn} should be a function`);
            }

            check(document.querySelectorAll('#details-modal').length === 1, '#details-modal count should be exactly 1');
            check(document.querySelectorAll('#random-modal').length === 1, '#random-modal count should be exactly 1');

            return { pass, msgs };
        });

        if (!pageResult.pass) {
            throw new Error(`Browser assertions failed: \n${pageResult.msgs.join('\n')}`);
        }
        
        if (errors.length > 0) {
            throw new Error(`Uncaught page errors detected: \n${errors.join('\n')}`);
        }

        console.log('[PASS] Browser assertions succeeded');
        console.log('[PASS] No uncaught pageerror');
        console.log('All browser smoke tests PASSED!');
    } catch (e) {
        console.error(`[FAIL] ${e.message}`);
        process.exitCode = 1;
    } finally {
        if (browser) {
            await browser.close();
            console.log('Browser closed.');
        }
        if (server) {
            server.close();
            console.log('Server closed.');
        }
    }
}

runTest();
