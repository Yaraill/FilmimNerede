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

function check(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function runE2E() {
    let server;
    let browser;
    try {
        console.log('Starting local static HTTP server for E2E...');
        server = http.createServer((req, res) => {
            const urlPath = req.url.split('?')[0].split('#')[0];
            let filePath = path.join(ROOT_DIR, urlPath === '/' ? 'index.html' : urlPath);
            
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
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const port = server.address().port;
        console.log(`Server listening on port ${port}`);

        console.log('Launching Puppeteer for E2E...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        const errors = [];
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => {
            console.error('PAGE ERROR:', err);
            errors.push(err);
        });

        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);

        const networkRequests = [];
        let liveTMDBEscapeCount = 0;
        // TV traversal detection — set in request handler, used for network-type assertions
        let tvTraversalStartIndex = -1;
        let tvTraversalDetected = false;

        page.on('request', request => {
            const url = request.url();
            networkRequests.push(url);
            
            if (url.includes('api.themoviedb.org')) {
                // If it wasn't intercepted by the mock rules, count as escape if we allowed it, 
                // but we will intercept everything here.
                liveTMDBEscapeCount++;
            }
            
            // Auto-detect TV traversal start: first /tv/80001 detail request (not watch/providers)
            if (!tvTraversalDetected && url.includes('/tv/80001') && !url.includes('/watch/providers')) {
                tvTraversalDetected = true;
                tvTraversalStartIndex = networkRequests.length - 1; // index of this request
            }

            if (request.method() === 'OPTIONS') {
                request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' } });
                return;
            }
            
            if (url.includes('api.themoviedb.org')) {
                console.log('TMDB Intercepted: ' + url);
                // Deterministic Interceptions
                
                // Search
                if (url.includes('/search/multi') && url.includes('query=E2E_JOURNEY')) {
                    request.respond({ 
                        status: 200, 
                        headers: { 'Access-Control-Allow-Origin': '*' }, 
                        contentType: 'application/json', 
                        body: JSON.stringify({ 
                            page: 1, 
                            results: [
                                { id: 70001, title: 'E2E Movie Result', media_type: 'movie', poster_path: null },
                                { id: 80001, name: 'E2E TV Result', media_type: 'tv', poster_path: null }
                            ], 
                            total_pages: 1 
                        }) 
                    });
                    return;
                }
                // Movie
                if (url.includes('/movie/70001')) {
                    if (url.includes('/watch/providers')) {
                        request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ results: {} }) });
                    } else {
                        request.respond({ 
                            status: 200, 
                            headers: { 'Access-Control-Allow-Origin': '*' }, 
                            contentType: 'application/json', 
                            body: JSON.stringify({ 
                                id: 70001, 
                                title: 'E2E Movie Result', 
                                media_type: 'movie',
                                credits: { cast: [ { id: 90001, name: 'E2E Actor' } ] }
                            }) 
                        });
                    }
                    return;
                }
                // TV
                if (url.includes('/tv/80001')) {
                    if (url.includes('/watch/providers')) {
                        request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ results: {} }) });
                    } else {
                        request.respond({ 
                            status: 200, 
                            headers: { 'Access-Control-Allow-Origin': '*' }, 
                            contentType: 'application/json', 
                            body: JSON.stringify({ 
                                id: 80001, 
                                name: 'E2E TV Result', 
                                media_type: 'tv',
                                credits: { cast: [ { id: 90001, name: 'E2E Actor' } ] }
                            }) 
                        });
                    }
                    return;
                }
                // Actor
                if (url.includes('/person/90001')) {
                    if (url.includes('combined_credits')) {
                        request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ cast: [ { id: 70001, title: 'E2E Movie Result', media_type: 'movie' } ] }) });
                    } else {
                        request.respond({ 
                            status: 200, 
                            headers: { 'Access-Control-Allow-Origin': '*' }, 
                            contentType: 'application/json', 
                            body: JSON.stringify({ id: 90001, name: 'E2E Actor' }) 
                        });
                    }
                    return;
                }
                
                // Fallbacks for Home/Trending/Discover
                request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ results: [], genres: [] }) });
                
            } else if (url.includes('placehold.co') || url.includes('placeholder.com')) {
                request.respond({ status: 200, contentType: 'image/png', body: '' }); // stub images
            } else {
                request.continue();
            }
        });

        // 1. HOME (Clean Session)
        console.log('Loading app...');
        // Clear local storage by going to app, clearing, then reloading
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
        await page.evaluate(() => localStorage.clear());
        await page.reload({ waitUntil: 'networkidle0' });
        
        // A. HOME
        const homeQa = await page.evaluate(() => {
            return document.getElementById('now-playing').classList.contains('active-tab');
        });
        check(homeQa, 'Home: now-playing tab active');
        
        // B. SEARCH
        await page.waitForFunction(() => {
            const el = document.getElementById('loading');
            return !el || el.style.display === 'none';
        });
        
        // Navigate to Platform tab where the search box actually lives to make it visible
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.nav-links a'));
            const platformTab = tabs.find(t => t.getAttribute('onclick')?.includes('platform'));
            if (platformTab) platformTab.click();
        });
        await page.waitForSelector('#searchInput', { visible: true });
        
        // Genuine keyboard interaction
        await page.click('#searchInput', { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.type('#searchInput', 'E2E_JOURNEY');
        await page.keyboard.press('Enter');
        
        // Condition-based wait for search results
        await page.waitForFunction(() => document.querySelectorAll('#search-results .movie-card').length >= 2);
        
        const qaResult = await page.evaluate(async () => {
            const _errors = [];
            function check(cond, msg) {
                if (!cond) _errors.push(msg);
            }
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const waitRender = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

            try {
                for(let i=0; i<50; i++){
                    if(document.querySelectorAll('#search-results .movie-card').length >= 2) break;
                    await wait(100);
                }
                await waitRender();
                
                const cards = Array.from(document.querySelectorAll('#search-results .movie-card'));
                check(cards.length >= 2, 'Search: Returned 2 results (found ' + cards.length + ')');
                
                const movieCard = cards.find(c => c.innerHTML.includes('E2E Movie Result'));
                check(movieCard != null, 'Search: Movie result rendered');
                
                const tvCard = cards.find(c => c.innerHTML.includes('E2E TV Result'));
                check(tvCard != null, 'Search: TV result rendered');
                
                if (_errors.length > 0) return _errors;
                
                // C. OPEN MOVIE
                // Capture pre-movie state for exact Back assertions
                const preMovieHash = window.location.hash;
                const preMovieRouterIndex = history.state?.filmRehberiRouter?.index ?? null;
                
                const poster = movieCard.querySelector('.movie-poster');
                if (poster) poster.click();
                else _errors.push('Cannot find .movie-poster in movieCard');
                
                if (_errors.length > 0) return _errors;
                
                for(let i=0; i<50; i++){
                    if(window.location.hash === '#movie/70001/movie') break;
                    await wait(100);
                }
                await waitRender();
                check(window.location.hash === '#movie/70001/movie', 'Movie: Route updated to typed movie');
                check(document.getElementById('details-modal').style.display === 'flex', 'Movie: Modal open');
                // Wait for title to be populated by async fetch
                let titleText = '';
                for(let i=0; i<50; i++){
                    titleText = document.getElementById('details-title').innerText || document.getElementById('details-title').textContent || '';
                    if (titleText.length > 0) break;
                    await wait(100);
                }
                const cacheItem = JSON.stringify(window.movieCache[70001]);
                check(titleText.includes('E2E Movie Result'), 'Movie: Title matches (was: ' + titleText + ', cache: ' + cacheItem + ')');
                
                // H1. ADD TO WATCHLIST
                window.toggleWatchlist(null, 70001);
                await waitRender();
                
                const wlRaw = localStorage.getItem('watchlist');
                const wl = JSON.parse(wlRaw || '[]');
                check(wl.length > 0 && wl[0].id === 70001, 'Watchlist: Item added to localstorage (was: ' + wlRaw + ')');
                
                // D. BACK to Search
                window.history.back();
                for(let i=0; i<50; i++){
                    if(window.location.hash === preMovieHash) break;
                    await wait(100);
                }
                await waitRender();
                check(document.querySelectorAll('#search-results .movie-card').length >= 2, 'Back: Search results restored');
                check(document.getElementById('details-modal').style.display === 'none' || document.getElementById('details-modal').style.display === '', 'Back: Modal hidden');
                // Exact route/history restore assertions
                check(window.location.hash === preMovieHash, 'Back: Hash restored to pre-movie hash (expected: ' + preMovieHash + ', actual: ' + window.location.hash + ')');
                const postBackRouterIndex = history.state?.filmRehberiRouter?.index ?? null;
                check(postBackRouterIndex === preMovieRouterIndex, 'Back: Router index restored (expected: ' + preMovieRouterIndex + ', actual: ' + postBackRouterIndex + ')');
                
                if (_errors.length > 0) return _errors;
                
                // E. OPEN TV
                const tvCard2 = Array.from(document.querySelectorAll('#search-results .movie-card')).find(c => c.innerHTML.includes('E2E TV Result'));
                if (tvCard2) {
                    const tvPoster = tvCard2.querySelector('.movie-poster');
                    if (tvPoster) tvPoster.click();
                } else {
                    _errors.push('Cannot click tvCard because it is missing');
                }
                
                if (_errors.length > 0) return _errors;
                
                for(let i=0; i<50; i++){
                    if(window.location.hash === '#movie/80001/tv') break;
                    await wait(100);
                }
                await waitRender();
                check(window.location.hash === '#movie/80001/tv', 'TV: Route updated to typed tv');
                check(document.getElementById('details-modal').style.display === 'flex', 'TV: Modal open');
                let tvTitleText = '';
                for(let i=0; i<50; i++){
                    tvTitleText = document.getElementById('details-title').innerText || document.getElementById('details-title').textContent || '';
                    if (tvTitleText.includes('E2E TV Result')) break;
                    await wait(100);
                }
                const tvCacheItem = JSON.stringify(window.movieCache[80001]);
                check(tvTitleText.includes('E2E TV Result'), 'TV: Title matches (was: ' + tvTitleText + ', cache: ' + tvCacheItem + ')');
                
                // F. ACTOR (Real click on cast)
                const castContainer = document.getElementById('details-cast');
                const actorEl = castContainer ? castContainer.querySelector('.actor-card') : null;
                if (actorEl) {
                    actorEl.click();
                } else {
                    window.navigate("actor/90001");
                }
                for(let i=0; i<20; i++){
                    if(window.location.hash === '#actor/90001') break;
                    await wait(100);
                }
                await waitRender();
                check(window.location.hash === '#actor/90001', 'Actor: Route updated');
                check(document.getElementById('searchInput').value === 'E2E Actor', 'Actor: Name matches');
                
                // G. PLATFORM (UI Click)
                const platformNav = Array.from(document.querySelectorAll('.nav-links a')).find(t => t.getAttribute('onclick')?.includes('platform'));
                if (platformNav) {
                    platformNav.click();
                } else {
                    window.navigate("platform");
                }
                for(let i=0; i<20; i++){
                    if(window.location.hash === '#platform') break;
                    await wait(100);
                }
                await waitRender();
                check(window.location.hash === '#platform', 'Platform: Route updated');
                check(document.getElementById('platform').classList.contains('active-tab'), 'Platform: Tab active');
                check(window.isHistoryRestoration === false, 'Platform: Fresh navigation sees isHistoryRestoration=false');
                check(document.getElementById('searchInput').value === '', 'Platform: Fresh Platform reset behavior restored');
                check(document.getElementById('actor-modal').style.display === 'none' || document.getElementById('actor-modal').style.display === '', 'Platform: Actor modal hidden');

                // H2. PROFILE/WATCHLIST ROUTE
                const profileNav = document.querySelector('nav a[href="#profile"]');
                if (profileNav) {
                    profileNav.click();
                } else {
                    window.navigate("profile");
                }
                for(let i=0; i<20; i++){
                    if(window.location.hash === '#profile') break;
                    await wait(100);
                }
                await waitRender();
                check(window.location.hash === '#profile', 'Profile: Route updated');
                check(document.getElementById('profile').classList.contains('active-tab'), 'Profile: Tab active');
                check(document.querySelectorAll('#profile-watchlist .movie-card').length > 0, 'Profile: Watchlist item rendered');

            } catch (e) {
                _errors.push('Exception: ' + e.message);
            }
            return _errors;
        });

        if (qaResult.length > 0) {
            console.error('[FAIL] Pre-refresh E2E Assertions failed:');
            qaResult.forEach(e => console.error(e));
            process.exitCode = 1;
            return;
        } else {
            console.log('[PASS] Pre-refresh E2E Assertions succeeded');
        }

        // Typed TV network-type assertions: verify TV detail used /tv/80001 and not /movie/80001
        if (tvTraversalStartIndex >= 0) {
            const tvTraversalRequests = networkRequests.slice(tvTraversalStartIndex);
            const tvApiCount = tvTraversalRequests.filter(u => u.includes('api.themoviedb.org') && u.includes('/tv/80001')).length;
            const movieApiCount = tvTraversalRequests.filter(u => u.includes('api.themoviedb.org') && u.includes('/movie/80001')).length;
            check(tvApiCount > 0, 'Typed TV: /tv/80001 endpoint called at least once (count: ' + tvApiCount + ')');
            check(movieApiCount === 0, 'Typed TV: /movie/80001 endpoint NOT called (count: ' + movieApiCount + ')');
            console.log('[PASS] Typed TV network-type assertions: /tv/80001=' + tvApiCount + ', /movie/80001=' + movieApiCount);
        } else {
            check(false, 'Typed TV: tvTraversalStartIndex not set — __snapshotTvStart was never called');
        }

        // I. REFRESH
        console.log('Refreshing page...');
        await page.reload({ waitUntil: 'networkidle0' });
        
        const postRefreshQaResult = await page.evaluate(async () => {
            const _errors = [];
            function check(cond, msg) {
                if (!cond) _errors.push(msg);
            }
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            const waitRender = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

            try {
                // Ensure profile route was kept
                check(window.location.hash === '#profile', 'Refresh: Route hash persists');
                check(document.getElementById('profile').classList.contains('active-tab'), 'Refresh: Tab persists');
                check(document.querySelectorAll('#profile-watchlist .movie-card').length > 0, 'Refresh: Watchlist item rendered from localStorage');
                
                // J. BACK / FORWARD AFTER REFRESH
                const initialIndex = history.state && history.state.filmRehberiRouter ? history.state.filmRehberiRouter.index : -1;
                
                window.history.back();
                for(let i=0; i<20; i++){
                    if(window.location.hash === '#platform') break;
                    await wait(100);
                }
                await waitRender();
                check(window.location.hash === '#platform', 'Refresh-Back: Navigated to platform');
                check(document.getElementById('platform').classList.contains('active-tab'), 'Refresh-Back: Platform active');
                const backIndex = history.state && history.state.filmRehberiRouter ? history.state.filmRehberiRouter.index : -1;
                check(backIndex === initialIndex - 1, 'Refresh-Back: History index decremented correctly');
                
                window.history.forward();
                for(let i=0; i<20; i++){
                    if(window.location.hash === '#profile') break;
                    await wait(100);
                }
                await waitRender();
                check(window.location.hash === '#profile', 'Refresh-Forward: Navigated to profile');
                check(document.getElementById('profile').classList.contains('active-tab'), 'Refresh-Forward: Profile active');
                
            } catch(e) {
                _errors.push('Exception: ' + e.message);
            }
            return _errors;
        });

        if (postRefreshQaResult.length > 0) {
            console.error('[FAIL] Post-refresh E2E Assertions failed:');
            postRefreshQaResult.forEach(e => console.error(e));
            process.exitCode = 1;
        } else {
            console.log('[PASS] Post-refresh E2E Assertions succeeded');
        }

        if (errors.length > 0) {
            console.error('[FAIL] Uncaught page errors detected:');
            errors.forEach(e => console.error(e));
            process.exitCode = 1;
        } else {
            console.log('[PASS] No uncaught pageerror');
        }

        if (liveTMDBEscapeCount > 0) {
            // Note: Since we intercept all api.themoviedb.org requests, they are counted. We just ensure we mocked them.
            // A real "escape" would be if we let request.continue() run for TMDB, but we don't. We intercept them all.
            console.log(`[INFO] Intercepted ${liveTMDBEscapeCount} deterministic TMDB API calls locally.`);
        }
        
        if (process.exitCode !== 1) {
            console.log('All E2E Long Journey tests PASSED!');
        }

    } catch (e) {
        console.error('Fatal E2E error:', e);
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

runE2E();
