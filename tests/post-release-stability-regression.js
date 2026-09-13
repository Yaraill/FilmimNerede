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
    if (reqUrl.includes('/trending/all/week')) {
        return {
            page: 1,
            results: MOCK_MOVIES,
            total_pages: 1,
            total_results: MOCK_MOVIES.length
        };
    }

    if (reqUrl.includes('/movie/1001/recommendations')) {
        return {
            page: 1,
            results: [
                {
                    id: 2001,
                    title: 'Test Oneri',
                    media_type: 'movie',
                    genre_ids: [28],
                    poster_path: '/dummy.jpg',
                    vote_average: 8.2,
                    vote_count: 1500,
                    adult: false,
                    release_date: '2022-01-01'
                }
            ],
            total_pages: 1,
            total_results: 1
        };
    }

    if (reqUrl.includes('/movie/1003/watch/providers')) {
        return {
            results: {
                TR: {
                    flatrate: []
                }
            }
        };
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
        // 6. SEARCH / PLATFORM / PROVIDER CACHE TESTS (TUR A)
        // ============================================================
        console.log('Running Search / Platform / Cache flow tests...');

        // --- 6.A COLD CACHE PLATFORM CHECK ---
        await page.goto('http://127.0.0.1:' + PORT + '/#platform', { waitUntil: 'networkidle0' });

        // Wait for platform movies to render completely, including provider containers (avoids skeleton false pass)
        await page.waitForFunction(() =>
            document.querySelectorAll('#search-results .movie-card .providers-container').length >= 3,
            { timeout: 8000 }
        );

        const getProviderStates = async () => {
            return await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('#search-results .movie-card')).slice(0, 3);
                return cards.map(card => {
                    const container = card.querySelector('.providers-container');
                    return {
                        exists: Boolean(container),
                        loading: Boolean(container && container.textContent.includes('Platformlar aranıyor...')),
                        childCount: container ? container.children.length : 0
                    };
                });
            });
        };

        // Wait for providers to settle without blind sleep
        await page.waitForFunction(() => {
            const containers = Array.from(document.querySelectorAll('#search-results .movie-card .providers-container')).slice(0, 3);
            return (
                containers.length === 3 &&
                containers.every(container =>
                    !container.textContent.includes('Platformlar aranıyor...') &&
                    container.children.length > 0
                )
            );
        }, { timeout: 5000 });

        const platformProviders = await getProviderStates();
        for (let state of platformProviders) {
            if (!state.exists) throw new Error('Platform cold cache: Provider container missing');
            if (state.loading) throw new Error('Platform cold cache: Provider stuck on loading state');
            if (state.childCount === 0) throw new Error('Platform cold cache: Provider container rendered empty');
        }

        // --- 6.B REAL USER SEARCH (A1) ---
        await page.type('#searchInput', 'dune');
        await page.click(
            '#platform .search-box button[aria-label="Film veya Dizi Ara"]'
        );

        // Wait for search result cards
        await page.waitForFunction(() =>
            document.querySelectorAll('#search-results .movie-card .providers-container').length >= 3,
            { timeout: 8000 }
        );

        let currentHash = await page.evaluate(() => window.location.hash);
        let currentMode = await page.evaluate(() => typeof currentMode !== 'undefined' ? currentMode : 'undefined');
        let sInputVal = await page.evaluate(() => document.getElementById('searchInput').value);

        if (currentHash !== '#search?q=dune') throw new Error('Search button click did not route to #search?q=dune, got: ' + currentHash);
        if (currentMode !== 'search') throw new Error('Mode not search after search button, got: ' + currentMode);
        if (sInputVal !== 'dune') throw new Error('Input value lost: ' + sInputVal);

        // --- 6.C WARM CACHE SEARCH CHECK (A3) ---
        // Wait for providers to settle without blind sleep
        await page.waitForFunction(() => {
            const containers = Array.from(document.querySelectorAll('#search-results .movie-card .providers-container')).slice(0, 3);
            return (
                containers.length === 3 &&
                containers.every(container =>
                    !container.textContent.includes('Platformlar aranıyor...') &&
                    container.children.length > 0
                )
            );
        }, { timeout: 5000 });

        const searchProviders = await getProviderStates();
        for (let state of searchProviders) {
            if (!state.exists) throw new Error('Search warm cache: Provider container missing');
            if (state.loading) throw new Error('Search warm cache: Provider stuck on loading state due to sync DOM bug');
            if (state.childCount === 0) throw new Error('Search warm cache: Provider container rendered empty');
        }

        // --- 6.D ENTER KEY SEARCH (A1 duplicate flow) ---
        // Clear input, type test2, hit enter
        await page.evaluate(() => { document.getElementById('searchInput').value = ''; });
        await page.type('#searchInput', 'test2');
        await page.keyboard.press('Enter');
        await page.waitForFunction(
            () => window.location.hash === '#search?q=test2',
            { timeout: 5000 }
        );

        currentHash = await page.evaluate(() => window.location.hash);
        if (currentHash !== '#search?q=test2') throw new Error('Enter key did not route correctly, got: ' + currentHash);

        // --- 6.E REAL PLATFORM RESET (A2) ---
        // Click "Nerede İzlerim?" (Navbar)
        await page.click('.nav-links a[onclick*="platform"]');

        // Wait for UI to update without blind sleep
        await page.waitForFunction(() => {
            const psa =
                document.getElementById(
                    'platform-selection-area'
                );

            return (
                window.location.hash === '#platform' &&
                typeof currentMode !== 'undefined' &&
                currentMode === 'platform' &&
                document.getElementById('searchInput').value === '' &&
                psa &&
                getComputedStyle(psa).display !== 'none' &&
                document.querySelectorAll(
                    '#search-results .movie-card .providers-container'
                ).length >= 3
            );
        }, { timeout: 8000 });

        const pResetState = await page.evaluate(() => {
            const psa =
                document.getElementById(
                    'platform-selection-area'
                );

            return {
                hash: window.location.hash,
                mode:
                    typeof currentMode !== 'undefined'
                        ? currentMode
                        : 'undefined',
                searchVal:
                    document.getElementById(
                        'searchInput'
                    ).value,
                psaDisplay:
                    psa
                        ? getComputedStyle(psa).display
                        : 'null',
                providerContainersCount:
                    document.querySelectorAll(
                        '#search-results .movie-card .providers-container'
                    ).length
            };
        });

        if (pResetState.hash !== '#platform') throw new Error('Platform navbar link failed to reset hash, got: ' + pResetState.hash);
        if (pResetState.mode !== 'platform') throw new Error('currentMode did not revert to platform, got: ' + pResetState.mode);
        if (pResetState.searchVal !== '') throw new Error('searchInput not cleared, got: ' + pResetState.searchVal);
        if (
            pResetState.psaDisplay === 'none' ||
            pResetState.psaDisplay === 'null'
        ) throw new Error('platform-selection-area still display none or null');
        if (pResetState.providerContainersCount < 3) throw new Error('providerContainersCount < 3 after platform reset');

        console.log('[PASS] Search / Platform / Cache flow tests passed');

        // ============================================================
        // 7. FINAL PRE-DEPLOY REGRESSION
        // ============================================================
        console.log(
            'Running final pre-deploy regression tests...'
        );

        // ------------------------------------------------------------
        // 7.A PLATFORM HARD REFRESH MUST LOAD TOP 10
        // ------------------------------------------------------------
        await page.goto(
            'http://127.0.0.1:' +
                PORT +
                '/#platform',
            {
                waitUntil:
                    'domcontentloaded',
                timeout: 15000
            }
        );

        await page.waitForFunction(
            () =>
                document.querySelectorAll(
                    '#top10-grid .top10-card'
                ).length > 0,
            {
                timeout: 8000
            }
        );

        const hardRefreshState =
            await page.evaluate(() => ({
                hash:
                    window.location.hash,
                top10Count:
                    document
                        .querySelectorAll(
                            '#top10-grid .top10-card'
                        )
                        .length,
                top10Visible:
                    getComputedStyle(
                        document.getElementById(
                            'top10-section'
                        )
                    ).display !== 'none'
            }));

        if (
            hardRefreshState.hash !==
            '#platform'
        ) {
            throw new Error(
                'Platform hard refresh changed route: ' +
                hardRefreshState.hash
            );
        }

        if (
            !hardRefreshState
                .top10Visible ||
            hardRefreshState
                .top10Count < 1
        ) {
            throw new Error(
                'Top 10 did not load after direct #platform refresh: ' +
                JSON.stringify(
                    hardRefreshState
                )
            );
        }

        console.log(
            '[PASS] Platform hard refresh Top 10 regression passed'
        );

        // ------------------------------------------------------------
        // 7.B CLEAR FILTERS MUST RESET REAL + CUSTOM UI
        // ------------------------------------------------------------
        await page.waitForFunction(
            () =>
                typeof window
                    .syncPlatformSelect ===
                    'function' &&
                typeof window
                    .clearAllFilters ===
                    'function',
            {
                timeout: 5000
            }
        );

        await page.evaluate(() => {
            syncPlatformSelect(
                'yearFilter',
                '2026'
            );

            syncPlatformSelect(
                'ratingFilter',
                '8'
            );

            syncPlatformSelect(
                'providerFilter',
                '337'
            );

            syncPlatformSelect(
                'runtimeFilter',
                '150'
            );

            syncPlatformSelect(
                'sortByFilter',
                'vote_average.desc'
            );

            const mediaSelect =
                document.getElementById(
                    'mediaTypeFilter'
                );

            if (mediaSelect) {
                mediaSelect.value =
                    'movie';
            }

            document
                .querySelectorAll(
                    '.segment-btn'
                )
                .forEach(button =>
                    button.classList.remove(
                        'active'
                    )
                );

            const movieSegment =
                Array.from(
                    document.querySelectorAll(
                        '.segment-btn'
                    )
                ).find(button =>
                    button.textContent
                        .trim() ===
                    'Filmler'
                );

            if (movieSegment) {
                movieSegment
                    .classList
                    .add('active');
            }

            const genreFilter =
                document.getElementById(
                    'genreFilter'
                );

            if (genreFilter) {
                genreFilter.value =
                    '28|12|10759';
            }

            document
                .querySelectorAll(
                    '.genre-pill-btn'
                )
                .forEach(button =>
                    button.classList.remove(
                        'active'
                    )
                );

            const actionButton =
                Array.from(
                    document.querySelectorAll(
                        '.genre-pill-btn'
                    )
                ).find(button =>
                    button.textContent
                        .trim() ===
                    'Aksiyon'
                );

            if (actionButton) {
                actionButton
                    .classList
                    .add('active');
            }

            clearAllFilters();
        });

        const resetUiState =
            await page.evaluate(() => {
                const visibleValue =
                    id => {
                        const select =
                            document
                                .getElementById(
                                    id
                                );

                        const wrapper =
                            select
                                ?.nextElementSibling;

                        return wrapper
                            ?.querySelector(
                                '.custom-select-value'
                            )
                            ?.textContent
                            ?.trim() ||
                            '';
                    };

                return {
                    media:
                        document
                            .getElementById(
                                'mediaTypeFilter'
                            )?.value,
                    genre:
                        document
                            .getElementById(
                                'genreFilter'
                            )?.value,
                    year:
                        document
                            .getElementById(
                                'yearFilter'
                            )?.value,
                    rating:
                        document
                            .getElementById(
                                'ratingFilter'
                            )?.value,
                    provider:
                        document
                            .getElementById(
                                'providerFilter'
                            )?.value,
                    runtime:
                        document
                            .getElementById(
                                'runtimeFilter'
                            )?.value,
                    sort:
                        document
                            .getElementById(
                                'sortByFilter'
                            )?.value,

                    yearText:
                        visibleValue(
                            'yearFilter'
                        ),
                    ratingText:
                        visibleValue(
                            'ratingFilter'
                        ),
                    providerText:
                        visibleValue(
                            'providerFilter'
                        ),
                    runtimeText:
                        visibleValue(
                            'runtimeFilter'
                        ),
                    sortText:
                        visibleValue(
                            'sortByFilter'
                        ),

                    mediaActive:
                        document
                            .querySelector(
                                '.segment-btn.active'
                            )
                            ?.textContent
                            ?.trim(),

                    genreActive:
                        document
                            .querySelector(
                                '.genre-pill-btn.active'
                            )
                            ?.textContent
                            ?.trim(),

                    routeOnlyCount:
                        document
                            .querySelectorAll(
                                '.route-only-genre-pill'
                            )
                            .length
                };
            });

        if (
            resetUiState.media !==
                'all' ||
            resetUiState.genre !==
                '' ||
            resetUiState.year !==
                '' ||
            resetUiState.rating !==
                '0' ||
            resetUiState.provider !==
                '0' ||
            resetUiState.runtime !==
                '' ||
            resetUiState.sort !==
                'popularity.desc'
        ) {
            throw new Error(
                'Native filter state did not reset: ' +
                JSON.stringify(
                    resetUiState
                )
            );
        }

        if (
            resetUiState.yearText !==
                'Tüm Yıllar' ||
            resetUiState.ratingText !==
                'Tüm Puanlar' ||
            resetUiState.providerText !==
                'Tüm Platformlar' ||
            resetUiState.runtimeText !==
                'Tüm Süreler' ||
            resetUiState.sortText !==
                'En Popüler' ||
            resetUiState.mediaActive !==
                'Tümü' ||
            resetUiState.genreActive !==
                'Hepsi' ||
            resetUiState.routeOnlyCount !==
                0
        ) {
            throw new Error(
                'Custom filter UI did not reset: ' +
                JSON.stringify(
                    resetUiState
                )
            );
        }

        console.log(
            '[PASS] Filter UI reset regression passed'
        );

        // ------------------------------------------------------------
        // 7.C SEARCH PROVIDER LOGO FILTER MUST STAY IN SEARCH MODE
        // ------------------------------------------------------------
        await page.evaluate(() => {
            navigate(
                'search?q=test'
            );
        });

        await page.waitForFunction(
            () =>
                window.location.hash ===
                    '#search?q=test' &&
                document.querySelectorAll(
                    '#search-results .movie-card:not(.skeleton-card)'
                ).length >= 3,
            {
                timeout: 8000
            }
        );

        await page.evaluate(() => {
            handlePlatformButtonClick(
                337
            );
        });

        await page.waitForFunction(
            () =>
                document
                    .getElementById(
                        'providerFilter'
                    )
                    ?.value ===
                    '337' &&
                document
                    .querySelectorAll(
                        '#search-results .skeleton-card'
                    )
                    .length === 0,
            {
                timeout: 8000
            }
        );

        const providerFilteredState =
            await page.evaluate(() => ({
                hash:
                    window.location.hash,
                provider:
                    document
                        .getElementById(
                            'providerFilter'
                        )
                        ?.value,
                cards:
                    document
                        .querySelectorAll(
                            '#search-results .movie-card:not(.skeleton-card)'
                        )
                        .length
            }));

        if (
            providerFilteredState.hash !==
            '#search?q=test'
        ) {
            throw new Error(
                'Provider filtering left search route: ' +
                providerFilteredState
                    .hash
            );
        }

        if (
            providerFilteredState
                .provider !==
            '337'
        ) {
            throw new Error(
                'Provider state not preserved in search mode'
            );
        }

        if (
            providerFilteredState
                .cards !==
            0
        ) {
            throw new Error(
                'Disney+ mock filter should remove Netflix-only results, got cards=' +
                providerFilteredState
                    .cards
            );
        }

        await page.evaluate(() => {
            handlePlatformButtonClick(
                337
            );
        });

        await page.waitForFunction(
            () =>
                document
                    .getElementById(
                        'providerFilter'
                    )
                    ?.value ===
                    '0' &&
                document
                    .querySelectorAll(
                        '#search-results .movie-card:not(.skeleton-card)'
                    )
                    .length >= 3,
            {
                timeout: 8000
            }
        );

        const providerClearedHash =
            await page.evaluate(
                () =>
                    window.location.hash
            );

        if (
            providerClearedHash !==
            '#search?q=test'
        ) {
            throw new Error(
                'Clearing provider filter changed search route: ' +
                providerClearedHash
            );
        }

        console.log(
            '[PASS] Search provider filtering regression passed'
        );

        // ------------------------------------------------------------
        // 7.D EXACT GENRE ROUTE MUST RESTORE VISUAL FILTER STATE
        // ------------------------------------------------------------
        await page.evaluate(() => {
            navigate(
                'platform?genres=14'
            );
        });

        await page.waitForFunction(
            () =>
                window.location.hash ===
                    '#platform?genres=14' &&
                document
                    .getElementById(
                        'genreFilter'
                    )
                    ?.value ===
                    '14' &&
                Boolean(
                    document
                        .querySelector(
                            '.route-only-genre-pill.active'
                        )
                ),
            {
                timeout: 8000
            }
        );

        const genreRouteState =
            await page.evaluate(() => {
                const pill =
                    document
                        .querySelector(
                            '.route-only-genre-pill.active'
                        );

                return {
                    hash:
                        window.location.hash,
                    genre:
                        document
                            .getElementById(
                                'genreFilter'
                            )
                            ?.value,
                    pillText:
                        pill
                            ?.textContent
                            ?.trim() ||
                            ''
                };
            });

        if (
            genreRouteState.genre !==
            '14' ||
            !genreRouteState.pillText
        ) {
            throw new Error(
                'Exact genre route was not reflected in filter UI: ' +
                JSON.stringify(
                    genreRouteState
                )
            );
        }

        console.log(
            '[PASS] Exact genre route UI regression passed'
        );

        // ------------------------------------------------------------
        // 7.E LOGO MUST USE SPA NAVIGATION, NOT FULL RELOAD
        // ------------------------------------------------------------
        await page.evaluate(() => {
            navigate(
                'profile'
            );
        });

        await page.waitForFunction(
            () =>
                window.location.hash ===
                '#profile',
            {
                timeout: 5000
            }
        );

        await page.evaluate(() => {
            window.__logoSpaSentinel =
                'still-alive';
        });

        await page.click(
            '.navbar .logo'
        );

        await page.waitForFunction(
            () =>
                window.location.hash ===
                '#home',
            {
                timeout: 5000
            }
        );

        const logoState =
            await page.evaluate(() => ({
                hash:
                    window.location.hash,
                sentinel:
                    window
                        .__logoSpaSentinel
            }));

        if (
            logoState.hash !==
                '#home' ||
            logoState.sentinel !==
                'still-alive'
        ) {
            throw new Error(
                'Logo caused reload or failed SPA home navigation: ' +
                JSON.stringify(
                    logoState
                )
            );
        }

        console.log(
            '[PASS] Logo SPA navigation regression passed'
        );

        // ------------------------------------------------------------
        // 7.F SMART RECOMMENDATIONS PROVIDERS MUST SETTLE
        // ------------------------------------------------------------
        await page.evaluate(
            async () => {
                localStorage.setItem(
                    'ratedMovies',
                    JSON.stringify([
                        {
                            id: 1001,
                            title:
                                'Test Aksiyon',
                            media_type:
                                'movie',
                            poster_path:
                                '/dummy.jpg'
                        }
                    ])
                );

                localStorage.setItem(
                    'movieRatings',
                    JSON.stringify({
                        1001: 10
                    })
                );

                await loadSmartRecommendations();
            }
        );

        await page.waitForFunction(
            () =>
                document
                    .querySelectorAll(
                        '#smart-recommendations-list .providers-container'
                    )
                    .length > 0,
            {
                timeout: 8000
            }
        );

        await page.waitForFunction(
            () => {
                const containers =
                    Array.from(
                        document
                            .querySelectorAll(
                                '#smart-recommendations-list .providers-container'
                            )
                    );

                return (
                    containers.length >
                        0 &&
                    containers.every(
                        container =>
                            !container
                                .textContent
                                .includes(
                                    'Platformlar aranıyor...'
                                )
                    )
                );
            },
            {
                timeout: 8000
            }
        );

        const smartProviderState =
            await page.evaluate(() => {
                const containers =
                    Array.from(
                        document
                            .querySelectorAll(
                                '#smart-recommendations-list .providers-container'
                            )
                    );

                return {
                    count:
                        containers.length,
                    stuck:
                        containers.filter(
                            container =>
                                container
                                    .textContent
                                    .includes(
                                        'Platformlar aranıyor...'
                                    )
                        ).length
                };
            });

        if (
            smartProviderState.count <
                1 ||
            smartProviderState.stuck !==
                0
        ) {
            throw new Error(
                'Smart recommendation provider placeholder did not settle: ' +
                JSON.stringify(
                    smartProviderState
                )
            );
        }

        console.log(
            '[PASS] Smart recommendation provider regression passed'
        );

        console.log(
            '[PASS] Final pre-deploy regression tests passed'
        );

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
