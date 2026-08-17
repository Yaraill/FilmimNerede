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
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => {
            errors.push(err);
        });

        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = request.url();
            console.log('Intercepted:', url);
            page.evaluate((u) => { window.networkRequests = window.networkRequests || []; window.networkRequests.push(u); }, url).catch(()=>{});
            if (request.method() === 'OPTIONS') {
                request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' } });
                return;
            }
            if (url.includes('api.themoviedb.org')) {
                if (url.includes('/movie/94997?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 94997, title: "Wrong Movie Collision Fixture" }) });
                } else if (url.includes('/tv/94997?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 94997, name: "House of the Dragon" }) });
                } else if (url.includes('/movie/12345?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 12345, title: "Generic Wrong Movie Fixture" }) });
                } else if (url.includes('/tv/12345?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 12345, name: "Generic TV Fixture" }) });
                } else if (url.includes('/movie/550?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 550, title: "Fight Club Fixture" }) });
                } else if (url.includes('/movie/999999?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ status_code: 34, status_message: 'Not found' }) });
                } else if (url.includes('/tv/999999?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 999999, name: "Legacy TV Fixture" }) });
                } else if (url.includes('/search/multi')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ results: [{ id: 12345, media_type: 'tv', name: 'Generic TV Fixture', poster_path: null }] }) });
                } else if (url.includes('/trending/all/week')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ results: [{ id: 23456, media_type: 'tv', name: 'Top10 TV Fixture', poster_path: null }] }) });
                } else if (url.includes('/movie/23456?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 23456, title: "Wrong Top10 Movie Fixture" }) });
                } else if (url.includes('/tv/23456?')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 23456, name: "Top10 TV Fixture" }) });
                } else if (url.includes('/genre/movie/list') || url.includes('/genre/tv/list')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ genres: [] }) });
                } else {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' }, contentType: 'application/json', body: JSON.stringify({ results: [], genres: [] }) });
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

        console.log('Running TV detail route assertions...');
        const tvResult = await page.evaluate(async () => {
            const msgs = [];
            let pass = true;

            function check(cond, msg) {
                if (!cond) { pass = false; msgs.push(msg); }
            }
            
            const waitRender = () => new Promise(r => setTimeout(r, 1000));
            const waitForTitle = async (expectedTitle) => {
                for (let i = 0; i < 20; i++) {
                    const el = document.getElementById('details-title');
                    if (el && el.innerText === expectedTitle) return;
                    await new Promise(r => setTimeout(r, 100));
                }
            };

            
            // SCENARIO 1 — createMovieCard TV click path (Test A)
            window.networkRequests = [];
            window.location.hash = "#home";
            await waitRender();
            document.body.innerHTML += `<div id="test-container"></div>`;
            const testContainer = document.getElementById('test-container');
            testContainer.innerHTML = window.createMovieCard({ id: 94997, media_type: 'tv', name: 'House of the Dragon', genre_ids: [] }, 'tv', '');
            
            const cardPoster = testContainer.querySelector('.movie-poster');
            cardPoster.click();
            await waitRender();
            
            check(window.location.hash === '#movie/94997/tv', 'S1: hash should be #movie/94997/tv but was ' + window.location.hash);
            await waitForTitle('House of the Dragon');
            const title1 = document.getElementById('details-title') ? document.getElementById('details-title').innerText : '';
            check(title1 === 'House of the Dragon', 'S1: Should render TV fixture, not movie collision, was: ' + title1);
            check(window.movieCache[94997] && window.movieCache[94997].media_type === 'tv', 'S1: Cache should be tv');
            
            const tvReqs1 = window.networkRequests.filter(u => u.includes('/tv/94997?'));
            const movieReqs1 = window.networkRequests.filter(u => u.includes('/movie/94997?'));
            check(tvReqs1.length > 0, 'S1: TV detail endpoint /tv/94997 was not requested');
            check(movieReqs1.length === 0, 'S1: Movie collision endpoint /movie/94997 should NOT be requested');

            document.getElementById('details-modal').style.display = 'none';
            testContainer.innerHTML = '';
            
            // SCENARIO 2 — REAL autocomplete TV suggestion click (Test C)
            window.networkRequests = [];
            window.location.hash = "#search";
            await waitRender();
            
            const searchInput = document.getElementById('searchInput');
            searchInput.value = "test";
            
            // trigger real autocomplete
            const oldHandle = window.handleSearchInput;
            window.handleSearchInput = async function(event) {
                const query = event.target.value.trim();
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    const res = await originalFetch(...args);
                    return res;
                };
                return oldHandle(event);
            };
            window.handleSearchInput({ target: searchInput });
            
            // wait for autocomplete box to render the suggestion
            for (let i = 0; i < 30; i++) {
                const box = document.getElementById('autocomplete-box');
                if (box && box.innerHTML.includes('Generic TV Fixture')) break;
                await new Promise(r => setTimeout(r, 100));
            }
            
            const suggestion = document.querySelector('.suggestion-item');
            suggestion.click();
            await waitRender();
            
            check(window.location.hash === '#movie/12345/tv', 'S2: hash should be #movie/12345/tv but was ' + window.location.hash);
            await waitForTitle('Generic TV Fixture');
            const title2 = document.getElementById('details-title') ? document.getElementById('details-title').innerText : '';
            check(title2 === 'Generic TV Fixture', 'S2: Should render TV fixture, was: ' + title2);
            check(window.movieCache[12345] && window.movieCache[12345].media_type === 'tv', 'S2: Cache should be tv');
            
            const tvReqs2 = window.networkRequests.filter(u => u.includes('/tv/12345?'));
            const movieReqs2 = window.networkRequests.filter(u => u.includes('/movie/12345?'));
            check(tvReqs2.length > 0, 'S2: /tv/12345 should be requested');
            check(movieReqs2.length === 0, 'S2: /movie/12345 should not be requested');
            
            document.getElementById('details-modal').style.display = 'none';

            // SCENARIO 3 - REAL Top10 TV card click (Test D)
            window.networkRequests = [];
            window.location.hash = "#home";
            await waitRender();
            
            await window.loadTop10Trending();
            await waitRender();
            
            const top10Grid = document.getElementById('top10-grid');
            const top10Card = top10Grid.querySelector('.top10-card');
            top10Card.click();
            await waitRender();
            
            check(window.location.hash === '#movie/23456/tv', 'S3: hash should be #movie/23456/tv but was ' + window.location.hash);
            await waitForTitle('Top10 TV Fixture');
            const title3 = document.getElementById('details-title') ? document.getElementById('details-title').innerText : '';
            check(title3 === 'Top10 TV Fixture', 'S3: Should render TV fixture, was: ' + title3);
            check(window.movieCache[23456] && window.movieCache[23456].media_type === 'tv', 'S3: Cache should be tv');
            
            const tvReqs3 = window.networkRequests.filter(u => u.includes('/tv/23456?'));
            const movieReqs3 = window.networkRequests.filter(u => u.includes('/movie/23456?'));
            check(tvReqs3.length > 0, 'S3: /tv/23456 should be requested');
            check(movieReqs3.length === 0, 'S3: /movie/23456 should not be requested');
            
            document.getElementById('details-modal').style.display = 'none';

            // SCENARIO 3.5 — explicit typed TV navigation (Test 2 standalone)
            window.networkRequests = [];
            window.openDetails(94997, 'tv');
            await waitRender();
            check(window.location.hash === '#movie/94997/tv', 'S3.5: hash should be #movie/94997/tv but was ' + window.location.hash);
            await waitForTitle('House of the Dragon');
            const title35 = document.getElementById('details-title') ? document.getElementById('details-title').innerText : '';
            check(title35 === 'House of the Dragon', 'S3.5: Should render TV fixture, was: ' + title35);
            check(window.movieCache[94997] && window.movieCache[94997].media_type === 'tv', 'S3.5: Cache should be tv');
            const tvReqs35 = window.networkRequests.filter(u => u.includes('/tv/94997?'));
            const movieReqs35 = window.networkRequests.filter(u => u.includes('/movie/94997?'));
            check(tvReqs35.length > 0, 'S3.5: /tv/94997 should be requested');
            check(movieReqs35.length === 0, 'S3.5: /movie/94997 should not be requested');
            document.getElementById('details-modal').style.display = 'none';

            // SCENARIO 4 — normal movie control
            window.openDetails(550, 'movie');
            await waitRender();
            check(window.location.hash === '#movie/550/movie', 'S4: hash should be #movie/550/movie');
            await waitForTitle('Fight Club Fixture');
            const title4 = document.getElementById('details-title') ? document.getElementById('details-title').innerText : '';
            check(title4 === 'Fight Club Fixture', 'S4: Should render movie fixture, was: ' + title4);
            document.getElementById('details-modal').style.display = 'none';
            
            // SCENARIO 5 — direct typed TV route
            window.location.hash = '#movie/94997/tv';
            await waitRender();
            await waitForTitle('House of the Dragon');
            const title5 = document.getElementById('details-title') ? document.getElementById('details-title').innerText : '';
            check(title5 === 'House of the Dragon', 'S5: Should render TV fixture from direct typed route, was: ' + title5);
            document.getElementById('details-modal').style.display = 'none';

            // SCENARIO 6 — legacy compatibility
            window.location.hash = '#movie/999999';
            await waitRender();
            await waitForTitle('Legacy TV Fixture');
            const title6 = document.getElementById('details-title') ? document.getElementById('details-title').innerText : '';
            check(title6 === 'Legacy TV Fixture', 'S6: Should fallback to TV if no type and movie not found, was: ' + title6);
            document.getElementById('details-modal').style.display = 'none';

            // SCENARIO 7 — malformed type (Test B)
            window.networkRequests = [];
            window.location.hash = '#movie/94997/not-a-type';
            await waitRender();
            const detailsDisplay = document.getElementById('details-modal') ? document.getElementById('details-modal').style.display : 'none';
            check(detailsDisplay === 'none' || detailsDisplay === '', 'S7: Details modal should not be displayed');
            
            const tvReqs7 = window.networkRequests.filter(u => u.includes('/tv/94997?'));
            const movieReqs7 = window.networkRequests.filter(u => u.includes('/movie/94997?'));
            check(tvReqs7.length === 0, 'S7: /tv/94997 should not be requested');
            check(movieReqs7.length === 0, 'S7: /movie/94997 should not be requested');
            
            return { pass, msgs };
        });
        
        if (!tvResult.pass) {
            throw new Error(`TV Route assertions failed: \n${tvResult.msgs.join('\n')}`);
        }
        console.log('[PASS] TV Route assertions succeeded');

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
