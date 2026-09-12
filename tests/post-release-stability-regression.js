'use strict';
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');
const urlMod = require('url');

const PORT = 3007;

const MOCK_MOVIES = [
    { id: 1001, title: 'Test Aksiyon', media_type: 'movie', genre_ids: [28], poster_path: '/dummy.jpg' },
    { id: 1002, name: 'Test Dram', media_type: 'tv', genre_ids: [18], poster_path: '/dummy.jpg' },
    { id: 1003, title: 'Test Bos Genre', media_type: 'movie', genre_ids: [], poster_path: '/dummy.jpg' }
];

const server = http.createServer((req, res) => {
    const parsedUrl = urlMod.parse(req.url);
    let pathname = parsedUrl.pathname || '/';
    if (pathname === '/') pathname = '/index.html';
    const extname = String(path.extname(pathname)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2',
        '.woff': 'font/woff', '.ico': 'image/x-icon'
    };
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    const absolutePath = path.join(__dirname, '..', pathname);
    fs.readFile(absolutePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + pathname);
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

function mockApi(request) {
    const reqUrl = request.url();
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };

    if (!reqUrl.includes('api.themoviedb.org')) return null;

    if (reqUrl.includes('/discover/movie') || reqUrl.includes('/discover/tv') ||
        reqUrl.match(/\/search\/multi/) || reqUrl.match(/\/search\/person/)) {
        return { page: 1, results: MOCK_MOVIES, total_pages: 1, total_results: MOCK_MOVIES.length };
    }
    if (reqUrl.includes('/videos')) {
        return { id: 1001, results: [{ key: 'dQw4w9WgXcQ', type: 'Trailer', site: 'YouTube', official: true }] };
    }
    if (reqUrl.includes('/genre/movie/list')) {
        return { genres: [{ id: 28, name: 'Aksiyon' }] };
    }
    if (reqUrl.includes('/genre/tv/list')) {
        return { genres: [{ id: 18, name: 'Dram' }] };
    }
    if (reqUrl.includes('/watch/providers')) {
        return { results: { TR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/logo.png' }] } } };
    }
    if (reqUrl.match(/\/movie\/1001/)) {
        return { id: 1001, title: 'Test Aksiyon', genres: [{ id: 28, name: 'Aksiyon' }], runtime: 120, vote_average: 7.5, release_date: '2020-01-01', original_language: 'en', overview: 'Test' };
    }
    if (reqUrl.match(/\/tv\/1002/)) {
        return { id: 1002, name: 'Test Dram', genres: [{ id: 18, name: 'Dram' }], episode_run_time: [45], vote_average: 8.0, first_air_date: '2020-01-01', original_language: 'tr', overview: 'Test' };
    }
    if (reqUrl.match(/\/movie\/1003/)) {
        return { id: 1003, title: 'Test Bos', genres: [], runtime: 90, vote_average: 6.0, release_date: '2021-01-01', original_language: 'en', overview: 'Test' };
    }
    // Default fallback
    return {};
}

async function runTest() {
    let browser;
    try {
        await new Promise((res, rej) => {
            server.listen(PORT, () => res());
            server.on('error', rej);
        });

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900', '--disable-gpu']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });
        await page.setBypassServiceWorker(true);

        await page.setRequestInterception(true);
        page.on('request', request => {
            if (request.method() === 'OPTIONS') {
                request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' } });
                return;
            }
            const reqUrl = request.url();
            // Block external images/fonts/CORS calls
            if (reqUrl.includes('image.tmdb.org') || reqUrl.includes('fonts.googleapis.com') ||
                reqUrl.includes('placehold.co') || reqUrl.includes('flagcdn.com')) {
                request.respond({ status: 200, contentType: 'image/gif', body: Buffer.alloc(1) });
                return;
            }
            // YouTube iframe - respond with empty page to avoid load
            if (reqUrl.includes('youtube.com') || reqUrl.includes('ytimg.com')) {
                request.respond({ status: 200, contentType: 'text/html', body: '<html><body>YT mock</body></html>' });
                return;
            }
            const mockData = mockApi(request);
            if (mockData !== null) {
                request.respond({
                    status: 200,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' },
                    body: JSON.stringify(mockData)
                });
                return;
            }
            request.continue();
        });

        page.on('console', msg => {
            console.log('RAW BROWSER [' + msg.type() + ']:', msg.text());
            if (msg.type() === 'error' || msg.text().includes('[FAIL]') || msg.text().includes('openModal') || msg.text().includes('TypeError')) {
                console.log('BROWSER ' + msg.type().toUpperCase() + ':', msg.text());
            }
        });
        page.on('pageerror', err => {
            console.log('PAGE JS ERROR:', err.message);
        });

        console.log('Loading app...');
        await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        // Wait for app to initialize
        await page.waitForFunction(() => typeof window.ModalManager !== 'undefined' && typeof window.searchMovie !== 'undefined', { timeout: 10000 });
        await new Promise(r => setTimeout(r, 500));

        // Navigate to search page and trigger a search
        await page.evaluate(() => { window.location.hash = '#search?q=test'; });
        await new Promise(r => setTimeout(r, 500));
        await page.evaluate(async () => { if (window.searchMovie) await window.searchMovie(true); });
        await page.waitForFunction(() => document.querySelectorAll('.movie-card, .movie-title-btn').length > 0, { timeout: 8000 });

        // ============================================================
        // 1. 10-CYCLE FREEZE TEST
        // ============================================================
        console.log('Running 10-cycle freeze test...');
        for (let i = 0; i < 10; i++) {
            // Open details modal
            await page.evaluate(() => {
                const btn = document.querySelector('.movie-title-btn');
                if (btn) btn.click();
            });
            await new Promise(r => setTimeout(r, 600));

            // Wait for details modal to be active
            const detailsOpen = await page.evaluate(() =>
                document.getElementById('details-modal') &&
                document.getElementById('details-modal').classList.contains('active')
            );

            if (detailsOpen) {
                // Click trailer button if visible
                const hasTrailerBtn = await page.evaluate(() => {
                    const btns = document.querySelectorAll('#details-modal .btn-watchlist');
                    for (const b of btns) {
                        if (b.getAttribute('onclick') && b.getAttribute('onclick').includes('openTrailer')) {
                            b.click();
                            return true;
                        }
                    }
                    return false;
                });
                if (hasTrailerBtn) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            // Close everything based on cycle
            if (i % 3 === 0) {
                await page.keyboard.press('Escape');
                await new Promise(r => setTimeout(r, 300));
                await page.keyboard.press('Escape');
            } else if (i % 3 === 1) {
                await page.evaluate(() => {
                    const tm = document.getElementById('trailer-modal');
                    const dm = document.getElementById('details-modal');
                    if (tm && tm.classList.contains('active')) {
                        const cb = tm.querySelector('.close-btn');
                        if (cb) cb.click();
                    }
                });
                await new Promise(r => setTimeout(r, 300));
                await page.evaluate(() => {
                    const dm = document.getElementById('details-modal');
                    if (dm && dm.classList.contains('active')) {
                        const cb = dm.querySelector('.close-btn');
                        if (cb) cb.click();
                    }
                });
            } else {
                await page.evaluate(() => {
                    const tm = document.getElementById('trailer-modal');
                    if (tm && tm.classList.contains('active')) tm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                });
                await new Promise(r => setTimeout(r, 300));
                await page.evaluate(() => {
                    const dm = document.getElementById('details-modal');
                    if (dm && dm.classList.contains('active')) dm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                });
            }

            await new Promise(r => setTimeout(r, 400));

            const state = await page.evaluate(() => ({
                mainInert: !!(document.getElementById('main-content') && document.getElementById('main-content').inert),
                hasActiveModal: !!(window.ModalManager && window.ModalManager.hasActiveModal()),
                activeModals: document.querySelectorAll('.modal.active').length,
                bodyOverflow: document.body.style.overflow
            }));

            if (state.mainInert || state.hasActiveModal || state.activeModals > 0 || state.bodyOverflow === 'hidden') {
                throw new Error('Freeze test FAIL on cycle ' + i + ': ' + JSON.stringify(state));
            }
        }
        console.log('[PASS] 10-cycle freeze test passed');

        // ============================================================
        // 2. TRAILER VISIBILITY ASSERTION
        // ============================================================
        console.log('Running trailer visibility test...');

        // Ensure we are on search page with visible movie cards before testing trailer
        await page.evaluate(() => { window.location.hash = '#search?q=test'; });
        await new Promise(r => setTimeout(r, 400));
        await page.evaluate(async () => { if (window.searchMovie) await window.searchMovie(true); });
        await page.waitForFunction(() => document.querySelectorAll('.movie-title-btn').length > 0, { timeout: 8000 });
        await new Promise(r => setTimeout(r, 300));

        const pageStateBeforeTrailer = await page.evaluate(() => ({
            hash: window.location.hash,
            cards: document.querySelectorAll('.movie-title-btn').length,
            detailsActive: document.getElementById('details-modal').classList.contains('active')
        }));
        console.log('State before trailer test:', JSON.stringify(pageStateBeforeTrailer));

        // Open details modal
        const clickResult = await page.evaluate(() => {
            const btn = document.querySelector('.movie-title-btn');
            if (!btn) return { found: false };
            const onclick = btn.getAttribute('onclick');
            btn.click();
            return { found: true, onclick, hash: window.location.hash, mainInert: document.getElementById('main-content').inert };
        });
        console.log('Click result:', JSON.stringify(clickResult));
        await new Promise(r => setTimeout(r, 1000));
        const afterClickState = await page.evaluate(() => ({
            hash: window.location.hash,
            detailsActive: document.getElementById('details-modal').classList.contains('active'),
            mainInert: document.getElementById('main-content').inert
        }));
        console.log('1s after click:', JSON.stringify(afterClickState));
        await page.waitForFunction(() => document.getElementById('details-modal').classList.contains('active'), { timeout: 5000 });
        await new Promise(r => setTimeout(r, 600));



        // Click trailer button
        const trailerBtnFound = await page.evaluate(() => {
            const btns = document.querySelectorAll('#details-modal .btn-watchlist');
            for (const b of btns) {
                if (b.getAttribute('onclick') && b.getAttribute('onclick').includes('openTrailer')) {
                    b.click();
                    return true;
                }
            }
            return false;
        });

        if (!trailerBtnFound) {
            throw new Error('Trailer button not found in details modal');
        }

        // Wait for trailer modal to become active
        await page.waitForFunction(() => {
            const tm = document.getElementById('trailer-modal');
            return tm && tm.classList.contains('active');
        }, { timeout: 5000 });

        // Wait for iframe to be injected (openTrailer fetches /videos asynchronously)
        await page.waitForFunction(() => {
            const container = document.getElementById('video-container');
            return container && (container.querySelector('iframe') !== null || container.querySelector('video') !== null);
        }, { timeout: 5000 });

        const trailerState = await page.evaluate(() => {
            const t = document.getElementById('trailer-modal');
            const d = document.getElementById('details-modal');
            const iframe = document.querySelector('#video-container iframe, #video-container video');
            const ts = window.getComputedStyle(t);
            const ds = window.getComputedStyle(d);
            const tRect = t.getBoundingClientRect();
            const iRect = iframe ? iframe.getBoundingClientRect() : null;
            return {
                active: t.classList.contains('active'),
                display: ts.display,
                visibility: ts.visibility,
                opacity: parseFloat(ts.opacity),
                tRectW: tRect.width,
                tRectH: tRect.height,
                iRectW: iRect ? iRect.width : 0,
                iRectH: iRect ? iRect.height : 0,
                tZIndex: parseInt(ts.zIndex) || 0,
                dZIndex: parseInt(ds.zIndex) || 0
            };
        });

        if (!trailerState.active) throw new Error('Trailer modal not active');
        if (trailerState.display === 'none') throw new Error('Trailer display:none');
        if (trailerState.visibility === 'hidden') throw new Error('Trailer visibility:hidden');

        if (trailerState.tRectW <= 0 || trailerState.tRectH <= 0) throw new Error('Trailer rect is 0');
        if (trailerState.iRectW <= 0 || trailerState.iRectH <= 0) throw new Error('Trailer iframe rect is 0');
        if (trailerState.tZIndex > 0 && trailerState.dZIndex > 0 && trailerState.tZIndex <= trailerState.dZIndex) {
            throw new Error('Trailer z-index (' + trailerState.tZIndex + ') not > details z-index (' + trailerState.dZIndex + ')');
        }
        console.log('[PASS] Trailer visibility test passed');

        // Close trailer + details
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 300));
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 400));

        // ============================================================
        // 3. AUTOCOMPLETE BOUNDS ASSERTION
        // ============================================================
        console.log('Running autocomplete bounds test...');
        // actor1-input is in the advanced search section â€” navigate to search and ensure it's visible
        await page.evaluate(() => {
            const advBtn = document.getElementById('advanced-search-btn') || document.querySelector('[onclick*="advanced"]');
            if (advBtn) advBtn.click();
        });
        await new Promise(r => setTimeout(r, 300));

        const actor1Visible = await page.evaluate(() => {
            const el = document.getElementById('actor1-input');
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0;
        });

        if (actor1Visible) {
            // Scroll to bottom so autocomplete would normally clip
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 200));

            await page.click('#actor1-input');
            await page.type('#actor1-input', 'Tom');
            await new Promise(r => setTimeout(r, 400));

            const acState = await page.evaluate(() => {
                const box = document.getElementById('actor1-autocomplete');
                if (!box) return null;
                const bRect = box.getBoundingClientRect();
                return {
                    top: bRect.top,
                    bottom: bRect.bottom,
                    windowHeight: window.innerHeight,
                    hasItems: box.children.length > 0
                };
            });

            if (acState && acState.hasItems) {
                if (acState.bottom > acState.windowHeight + 5) {
                    throw new Error('Autocomplete clipped below viewport: bottom=' + acState.bottom + ' vh=' + acState.windowHeight);
                }
                if (acState.top < -5) {
                    throw new Error('Autocomplete clipped above viewport: top=' + acState.top);
                }
            }
            // Clear
            await page.evaluate(() => { document.getElementById('actor1-input').value = ''; });
        }
        console.log('[PASS] Autocomplete bounds test passed');

        // ============================================================
        // 4. GENRE TEST
        // ============================================================
        console.log('Running genre test...');
        // Navigate to search results
        await page.evaluate(() => { window.location.hash = '#search?q=test'; });
        await new Promise(r => setTimeout(r, 500));
        await page.evaluate(async () => { if (window.searchMovie) await window.searchMovie(true); });
        await page.waitForFunction(() => document.querySelectorAll('.movie-title-btn').length >= 3, { timeout: 8000 });

        // Movie with Aksiyon genre
        await page.evaluate(() => document.querySelectorAll('.movie-title-btn')[0].click());
        await page.waitForFunction(() => document.getElementById('details-modal').classList.contains('active'), { timeout: 5000 });
        // Wait for meta to be populated
        await page.waitForFunction(() => {
            const m = document.getElementById('details-meta');
            return m && m.innerText.trim().length > 0;
        }, { timeout: 5000 });
        const genreM = await page.evaluate(() => document.getElementById('details-meta').innerText);
        if (!genreM.includes('Aksiyon')) throw new Error('Movie genre missing Aksiyon: "' + genreM + '"');
        if (genreM.includes('|  |')) throw new Error('Movie genre has double pipe: "' + genreM + '"');
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 400));

        // TV with Dram genre
        await page.evaluate(() => document.querySelectorAll('.movie-title-btn')[1].click());
        await page.waitForFunction(() => document.getElementById('details-modal').classList.contains('active'), { timeout: 5000 });
        await page.waitForFunction(() => {
            const m = document.getElementById('details-meta');
            return m && m.innerText.trim().length > 0;
        }, { timeout: 5000 });
        const genreT = await page.evaluate(() => document.getElementById('details-meta').innerText);
        if (!genreT.includes('Dram')) throw new Error('TV genre missing Dram: "' + genreT + '"');
        if (genreT.includes('|  |')) throw new Error('TV genre has double pipe: "' + genreT + '"');
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 400));

        // Movie with empty genre
        await page.evaluate(() => document.querySelectorAll('.movie-title-btn')[2].click());
        await page.waitForFunction(() => document.getElementById('details-modal').classList.contains('active'), { timeout: 5000 });
        await new Promise(r => setTimeout(r, 600));
        const genreE = await page.evaluate(() => document.getElementById('details-meta').innerText);
        if (genreE.includes(' | ')) throw new Error('Empty genre has pipe separator: "' + genreE + '"');
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 400));
        console.log('[PASS] Genre test passed');

        // ============================================================
        // 5. SCROLL TEST
        // ============================================================
        console.log('Running scroll test...');
        await page.evaluate(() => { window.location.hash = '#home'; });
        await new Promise(r => setTimeout(r, 800));
        await page.evaluate(() => window.scrollTo(0, 200));
        await new Promise(r => setTimeout(r, 200));
        const beforeScroll = await page.evaluate(() => window.scrollY);

        await page.evaluate(() => {
            const btn = document.querySelector('.movie-title-btn');
            if (btn) btn.click();
        });
        await page.waitForFunction(() => document.getElementById('details-modal').classList.contains('active'), { timeout: 5000 });
        const duringScroll = await page.evaluate(() => window.scrollY);

        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 400));
        const afterScroll = await page.evaluate(() => window.scrollY);

        if (Math.abs(beforeScroll - duringScroll) > 10) {
            throw new Error('Scroll jumped on open: before=' + beforeScroll + ' during=' + duringScroll);
        }
        if (Math.abs(beforeScroll - afterScroll) > 10) {
            throw new Error('Scroll jumped on close: before=' + beforeScroll + ' after=' + afterScroll);
        }
        console.log('[PASS] Scroll test passed');

        // ============================================================
        // 6. SEARCH/PLATFORM ROUTE RESET
        // ============================================================
        console.log('Running search/platform test...');
        await page.evaluate(() => {
            const si = document.getElementById('searchInput');
            if (si) si.value = 'Test Value';
        });
        await page.evaluate(() => { window.location.hash = '#platform'; });
        await new Promise(r => setTimeout(r, 500));

        const platformState = await page.evaluate(() => {
            const psa = document.getElementById('platform-selection-area');
            return {
                hash: window.location.hash,
                searchVal: (document.getElementById('searchInput') || {}).value || '',
                areaVisible: psa ? window.getComputedStyle(psa).display !== 'none' : false
            };
        });
        if (platformState.hash !== '#platform') throw new Error('Platform hash wrong: ' + platformState.hash);
        if (platformState.searchVal !== '') throw new Error('searchInput not cleared on platform route: "' + platformState.searchVal + '"');
        if (!platformState.areaVisible) throw new Error('Platform selection area not visible');
        console.log('[PASS] Search/platform test passed');

        console.log('\n[PASS] All post-release stability tests passed!');
        process.exitCode = 0;

    } catch (e) {
        console.error('\n[FAIL]', e.stack || e.message);
        process.exitCode = 1;
    } finally {
        if (browser) {
            try { await browser.close(); } catch (_) {}
        }
        server.close();
    }
}

runTest();
