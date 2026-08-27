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
                // QA2A1 Mocks
                if (url.includes('query=STALE_SEARCH')) {
                    setTimeout(() => {
                        request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ page: 1, results: [{ id: 1001, title: 'Stale Search Result', media_type: 'movie' }], total_pages: 1 }) }).catch(()=>{});
                    }, 800);
                    return;
                }
                if (url.includes('query=FAST_SEARCH')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ page: 1, results: [{ id: 1002, title: 'Fast Search Result', media_type: 'movie' }], total_pages: 1 }) }).catch(()=>{});
                    return;
                }
                if (url.includes('query=AUTO_STALE')) {
                    setTimeout(() => {
                        request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ page: 1, results: [{ id: 1003, title: 'Stale Auto', media_type: 'movie' }], total_pages: 1 }) }).catch(()=>{});
                    }, 800);
                    return;
                }
                if (url.includes('query=AUTO_FAST')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ page: 1, results: [{ id: 1004, title: 'Fast Auto', media_type: 'movie' }], total_pages: 1 }) }).catch(()=>{});
                    return;
                }
                if (url.includes('query=SLOW_SCROLL')) {
                    const isPage2 = url.includes('page=2');
                    if (isPage2) {
                        setTimeout(() => {
                            request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ page: 2, results: [{ id: 1005, title: 'Page 2 Result', media_type: 'movie' }], total_pages: 5 }) }).catch(()=>{});
                        }, 800);
                    } else {
                        request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ page: 1, results: [{ id: 1005, title: 'Page 1 Result', media_type: 'movie' }], total_pages: 5 }) }).catch(()=>{});
                    }
                    return;
                }
                if (url.includes('query=FAIL_ROLLBACK')) {
                    const isPage2 = url.includes('page=2');
                    if (isPage2) {
                        if (!global.__rollbackFailedOnce) {
                            global.__rollbackFailedOnce = true;
                            request.respond({ status: 500, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) }).catch(()=>{});
                        } else {
                            request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ page: 2, results: [{ id: 1006, title: 'Page 2 Success', media_type: 'movie' }], total_pages: 5 }) }).catch(()=>{});
                        }
                    } else {
                        request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ page: 1, results: [{ id: 1006, title: 'Page 1 Result', media_type: 'movie' }], total_pages: 5 }) }).catch(()=>{});
                    }
                    return;
                }
                if (url.includes('/movie/88888')) {
                    setTimeout(() => {
                        request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 88888, title: 'Slow Movie Result', media_type: 'movie' }) }).catch(()=>{});
                    }, 800);
                    return;
                }
                if (url.includes('/movie/77777')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 77777, title: 'Fast Movie', media_type: 'movie' }) }).catch(()=>{});
                    return;
                }
                if (url.includes('/person/77777')) {
                    request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ id: 77777, name: 'Valid Actor' }) }).catch(()=>{});
                    return;
                }

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


        console.log('Running QA2A1 Route & Search Assertions...');
        const qaResult = await page.evaluate(async () => {
            const msgs = [];
            let pass = true;
            function check(cond, msg) { if (!cond) { pass = false; msgs.push(msg); } }
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const waitRender = () => wait(400); // give ample time for DOM updates

            // A) DIRECT ROUTE MATRIX
            window.location.hash = "#platform"; await waitRender();
            check(window.location.hash === '#platform', 'A1: hash #platform');
            check(document.getElementById('platform').classList.contains('active-tab'), 'A1: platform tab active');

            window.location.hash = "#search?q=TEST"; await waitRender();
            check(window.location.hash === '#search?q=TEST', 'A2: search hash active');
            check(document.getElementById('searchInput').value === 'TEST', 'A2: search input populated');
            check(document.getElementById('platform').classList.contains('active-tab'), 'A2: platform tab is used for search');

            window.location.hash = "#movie/77777/movie"; await waitRender();
            check(window.location.hash === '#movie/77777/movie', 'A3: movie direct hash');
            check(document.getElementById('details-modal').style.display === 'flex', 'A3: movie modal open');
            document.getElementById('details-modal').style.display = 'none';

            window.location.hash = "#actor/77777"; await waitRender();
            check(window.location.hash === '#actor/77777', 'A4: actor direct hash');
            check(document.getElementById('platform').classList.contains('active-tab'), 'A4: platform tab active for actor mode');
            check(document.getElementById('searchInput').value === 'Valid Actor', 'A4: searchInput got actor name');

            window.location.hash = "#movie/bad/movie"; await waitRender();
            check(window.location.hash === '#platform', 'A5: invalid movie ID normalizes to platform');
            check(document.getElementById('platform').classList.contains('active-tab'), 'A5: platform tab active');

            window.location.hash = "#film/77777"; await waitRender();
            check(window.location.hash === '#movie/77777', 'A6: legacy film route normalized without type');
            check(document.getElementById('details-modal').style.display === 'flex', 'A6: modal opened from legacy film route');
            document.getElementById('details-modal').style.display = 'none';

            window.location.hash = "#actor/bad"; await waitRender();
            check(window.location.hash === '', 'A7: invalid actor normalizes to empty/home hash');
            check(document.getElementById('now-playing').classList.contains('active-tab'), 'A7: now-playing (home) tab active');

            // B) REAL BACK/FORWARD NAVIGATION
            // 1. Establish stable baseline
            window.navigate("platform"); await waitRender();
            
            // Push next route
            window.navigate("movie/77777/movie"); await waitRender();
            
            // Push next route
            window.navigate("actor/77777"); await waitRender();
            
            // 2. No unintended extra history entry
            const initialIndex = history.state && history.state.filmRehberiRouter ? history.state.filmRehberiRouter.index : -1;
            check(initialIndex >= 2, 'B: Router index should reflect sequential pushes');
            
            // 3. FIRST REAL BACK
            history.back();
            for(let i=0; i<20; i++){
                if(window.location.hash === '#movie/77777/movie') break;
                await wait(100);
            }
            await waitRender(); // Wait for DOM condition/title
            check(window.location.hash === '#movie/77777/movie', 'B: First Back expected hash');
            check(document.getElementById('details-modal').style.display === 'flex', 'B: First Back modal open');
            check(document.getElementById('details-title').innerText === 'Fast Movie', 'B: First Back title restored');
            
            // 4. SECOND REAL BACK
            history.back();
            for(let i=0; i<20; i++){
                if(window.location.hash === '#platform') break;
                await wait(100);
            }
            await waitRender();
            check(window.location.hash === '#platform', 'B: Second Back expected hash');
            check(document.getElementById('platform').classList.contains('active-tab'), 'B: Second Back route DOM restored');
            check(document.getElementById('details-modal').style.display === 'none' || document.getElementById('details-modal').style.display === '', 'B: Second Back stale modal hidden');
            
            // 5. REAL FORWARD
            history.forward();
            for(let i=0; i<20; i++){
                if(window.location.hash === '#movie/77777/movie') break;
                await wait(100);
            }
            await waitRender();
            check(window.location.hash === '#movie/77777/movie', 'B: Forward expected hash restored');
            check(document.getElementById('details-title').innerText === 'Fast Movie', 'B: Forward title restored');
            const fwIndex = history.state && history.state.filmRehberiRouter ? history.state.filmRehberiRouter.index : -1;
            check(fwIndex === initialIndex - 1, 'B: Forward index matches expected entry');
            
            // 6. No loop / no phantom navigation
            await wait(1000); // settling period
            check(window.location.hash === '#movie/77777/movie', 'B: No phantom navigation after settle');
            const settleIndex = history.state && history.state.filmRehberiRouter ? history.state.filmRehberiRouter.index : -1;
            check(settleIndex === fwIndex, 'B: No state changes after settle');
            
            // 7. Stale overwrite safety
            window.navigate("movie/88888/movie"); // slow
            await wait(100); 
            history.back(); 
            for(let i=0; i<20; i++){
                if(window.location.hash === '#movie/77777/movie') break;
                await wait(100);
            }
            await wait(1000); // wait for slow to resolve
            check(window.location.hash === '#movie/77777/movie', 'B: Stale overwrite safety preserved hash');
            check(document.getElementById('details-title').innerText === 'Fast Movie', 'B: Stale overwrite safety preserved DOM');
            document.getElementById('details-modal').style.display = 'none';

            // C) ROUTE GENERATION + ABORT
            window.location.hash = "#movie/88888/movie"; // slow
            await wait(100); 
            window.location.hash = "#home"; // fast
            await waitRender();
            check(window.location.hash === '#home', 'C: hash is #home');
            await wait(1000); // Wait for slow route A to finish
            check(document.getElementById('details-modal').style.display === 'none' || document.getElementById('details-modal').style.display === '', 'C: aborted route did not open modal');
            check(window.location.hash === '#home', 'C: hash remained #home');

            // D) SEARCH A -> B LATEST-WINS
            window.location.hash = "#search"; await waitRender();
            const searchInput = document.getElementById('searchInput');
            searchInput.value = "STALE_SEARCH";
            window.searchMovie(true); // Triggers slow search
            await wait(200);
            searchInput.value = "FAST_SEARCH";
            window.searchMovie(true); // Triggers fast search
            await wait(1500); // wait for both to complete
            const searchHtml = document.getElementById('search-results').innerHTML;
            check(searchHtml.includes('Fast Search Result'), 'D: Fast search rendered');
            check(!searchHtml.includes('Stale Search Result'), 'D: Stale search did not overwrite');

            // E) AUTOCOMPLETE STALE RESPONSE
            window.location.hash = "#search"; await waitRender();
            searchInput.value = "AUTO_STALE";
            window.handleSearchInput({ target: searchInput });
            await wait(400); // wait for debounce (300ms) so fetch fires
            searchInput.value = "AUTO_FAST";
            window.handleSearchInput({ target: searchInput });
            await wait(1500); // wait for both
            const autoBox = document.getElementById('autocomplete-box');
            check(autoBox.innerHTML.includes('Fast Auto'), 'E: Fast auto rendered');
            check(!autoBox.innerHTML.includes('Stale Auto'), 'E: Stale auto ignored');

            // F) INFINITE-SCROLL DUPLICATE LOCK
            window.location.hash = "#search"; await waitRender();
            searchInput.value = "SLOW_SCROLL";
            window.searchMovie(true);
            await wait(500); // Let page 1 finish
            
            // clear out previous network request tracking to easily count page=2
            const preDoubleCallCount = window.networkRequests.filter(u => u.includes('query=SLOW_SCROLL') && u.includes('page=2')).length;
            check(preDoubleCallCount === 0, 'F: Precheck page 2 not requested yet');
            
            // Now call loadMoreResults twice
            window.loadMoreResults();
            window.loadMoreResults();
            await wait(1500); // wait for slow page 2 to return
            
            const resultsHtml = document.getElementById('search-results').innerHTML;
            const p2Count = (resultsHtml.match(/alt="Page 2 Result"/g) || []).length;
            check(p2Count === 1, `F: Page 2 DOM rendered exactly once despite duplicate call (was ${p2Count})`);
            
            const page2Reqs = window.networkRequests.filter(u => u.includes('query=SLOW_SCROLL') && u.includes('page=2'));
            check(page2Reqs.length === 1, 'F: Page 2 requested exactly once over network');
            
            check(!document.getElementById('loadMoreBtn').classList.contains('loading'), 'F: loadMoreBtn is not spinning');

            // G) SEARCH PAGINATION ROLLBACK
            window.location.hash = "#search"; await waitRender();
            searchInput.value = "FAIL_ROLLBACK";
            window.searchMovie(true);
            await wait(500); // page 1 finish
            
            window.loadMoreResults(); // trigger page 2 which will fail
            await wait(500);
            
            check(!document.getElementById('loadMoreBtn').classList.contains('loading'), 'G: loadMoreBtn stopped spinning after error');
            const gHtml = document.getElementById('search-results').innerHTML;
            check(gHtml.includes('Page 1 Result'), 'G: Page 1 DOM intact');
            check(!gHtml.includes('Page 2'), 'G: Page 2 not rendered yet');
            
            window.loadMoreResults(); // trigger page 2 again (success)
            await wait(500);
            
            const gHtml2 = document.getElementById('search-results').innerHTML;
            check(gHtml2.includes('Page 2 Success'), 'G: Page 2 DOM rendered after retry');
            const rollbackPage2Reqs = window.networkRequests.filter(u => u.includes('query=FAIL_ROLLBACK') && u.includes('page=2'));
            check(rollbackPage2Reqs.length >= 2, 'G: Page 2 was requested twice (1 fail, 1 success)');

            // H) MOVIE STALE ROUTE DOM OVERWRITE
            window.location.hash = "#movie/88888/movie"; // slow
            await wait(100);
            window.location.hash = "#platform";
            await wait(1000); // Wait for slow movie to resolve
            check(window.location.hash === '#platform', 'H: Hash is platform');
            check(document.getElementById('details-modal').style.display === 'none' || document.getElementById('details-modal').style.display === '', 'H: Details modal stayed closed');
            
            return { pass, msgs };
        });

        if (!qaResult.pass) {
            throw new Error('QA2A1 Assertions failed:\n' + qaResult.msgs.join('\n'));
        }
        console.log('[PASS] QA2A1 Assertions succeeded');

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
