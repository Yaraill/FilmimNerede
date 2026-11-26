const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const puppeteer = require('puppeteer');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

function loadProvidersVm(fetchImpl = async () => Response.json({ results: { TR: {} } })) {
    const context = vm.createContext({
        window: { movieCache: {}, location: { hash: '#profile', origin: 'http://127.0.0.1' } },
        BASE_URL: 'https://api.themoviedb.org/3',
        AbortController,
        DOMException,
        URLSearchParams,
        Response,
        Date,
        Math,
        Promise,
        Set,
        Map,
        WeakMap,
        Array,
        Number,
        String,
        Object,
        JSON,
        console,
        queueMicrotask,
        setTimeout,
        clearTimeout,
        localStorage: { getItem: () => null, setItem: () => {} },
        document: { querySelectorAll: () => [], getElementById: () => null },
        fetch: fetchImpl
    });
    for (const filename of ['security.js', 'providers.js']) {
        const fullPath = path.join(ROOT_DIR, 'js', 'runtime', filename);
        vm.runInContext(fs.readFileSync(fullPath, 'utf8'), context, { filename: fullPath });
    }
    return context;
}

function getCspHeader() {
    const toml = fs.readFileSync(path.join(ROOT_DIR, 'netlify.toml'), 'utf8');
    const match = toml.match(/Content-Security-Policy\s*=\s*"""([\s\S]*?)"""/);
    assert.ok(match, 'netlify.toml CSP policy is required');
    return match[1].replace(/\\[ \t]*\r?\n[ \t\r\n]*/g, '').replace(/^\r?\n/, '').trim();
}

function providerResponse(itemId) {
    const results = {
        1101: {
            flatrate: [{ provider_id: 8, provider_name: 'Netflix' }],
            rent: [{ provider_id: 119, provider_name: 'Amazon Prime' }]
        },
        1102: {
            free: [{ provider_id: 337, provider_name: 'Disney+' }]
        },
        1103: {
            rent: [{ provider_id: 8, provider_name: 'Netflix' }],
            buy: [{ provider_id: 1899, provider_name: 'HBO Max' }]
        }
    };
    return { results: { TR: results[itemId] || {} } };
}

async function runUnitTests() {
    let calls = [];
    const runtime = loadProvidersVm(async url => {
        calls.push(String(url));
        const id = Number(new URL(url).pathname.match(/\/(\d+)\/watch\/providers/)?.[1]);
        return Response.json(providerResponse(id));
    });

    await runtime.enqueueProviderFetch('movie:101', 'https://api.themoviedb.org/3/movie/101/watch/providers', [], null);
    runtime.setCachedProviderData('movie:102', {
        results: { TR: {
            flatrate: [{ provider_id: '8' }, { provider_id: '8' }],
            free: [{ provider_id: 337 }],
            ads: [{ provider_id: '2235' }],
            rent: [{ provider_id: 119 }],
            buy: [{ provider_id: '11' }]
        } }
    });
    runtime.setCachedProviderData('tv:103', { results: { TR: {} } });

    const ids = runtime.getCachedTrProviderIds(102, 'movie');
    assert.equal(ids.cached, true);
    assert.deepEqual([...ids.streamIds], [8, 337, 2235]);
    assert.deepEqual([...ids.allIds], [8, 337, 2235, 119, 11]);
    assert.equal(runtime.getCachedTrProviderIds(103, 'tv').cached, true);
    assert.deepEqual([...runtime.getCachedTrProviderIds(103, 'tv').streamIds], []);
    assert.equal(runtime.getCachedTrProviderIds(999, 'movie').cached, false);
    assert.equal(runtime.getCachedTrProviderIds('bad', 'unknown').cached, false);

    calls = [];
    const progress = [];
    const scanResult = await runtime.ensureProvidersCachedForItems([
        { item: { id: 101 }, mediaType: 'movie' },
        { item: { id: 102 }, mediaType: 'movie' },
        { item: { id: 101 }, mediaType: 'movie' },
        { item: { id: 201, name: 'Dizi' }, mediaType: 'tv' },
        { item: { id: 202 }, mediaType: 'movie' },
        { item: { id: 203 }, mediaType: 'movie' }
    ], null, { maxFetch: 2, onProgress: update => progress.push(update) });
    assert.equal(calls.length, 2, 'Only uncached unique entries up to maxFetch should be requested');
    assert.equal(scanResult.totalCount, 5);
    assert.equal(scanResult.fetchedCount, 2);
    assert.equal(scanResult.remainingUncached, 1);
    assert.ok(progress.length >= 2, 'Progress should report initialization and completed chunks');
    assert.equal(progress[0].targetCount, 2);
    assert.equal(progress.at(-1).fetchedCount, 2);

    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const beforeAbortCalls = calls.length;
    const aborted = await runtime.ensureProvidersCachedForItems([
        { item: { id: 301 }, mediaType: 'movie' }
    ], { signal: alreadyAborted.signal });
    assert.equal(aborted.aborted, true);
    assert.equal(calls.length, beforeAbortCalls, 'An already-aborted scan must not fetch');

    const betweenChunks = new AbortController();
    let abortFetchCount = 0;
    const abortRuntime = loadProvidersVm(async () => {
        abortFetchCount += 1;
        if (abortFetchCount === 6) betweenChunks.abort();
        return Response.json({ results: { TR: { flatrate: [{ provider_id: 8 }] } } });
    });
    const abortedBetweenChunks = await abortRuntime.ensureProvidersCachedForItems(
        Array.from({ length: 8 }, (_, index) => ({
            item: { id: 500 + index },
            mediaType: 'movie'
        })),
        { signal: betweenChunks.signal },
        { maxFetch: 8 }
    );
    assert.equal(abortedBetweenChunks.aborted, true);
    assert.equal(abortFetchCount, 6, 'Abort should be checked between bounded batches');

    let retryCalls = 0;
    const retryRuntime = loadProvidersVm(async () => {
        retryCalls += 1;
        if (retryCalls === 1) {
            return new Response(JSON.stringify({ error: 'rate limited' }), {
                status: 429,
                headers: { 'Retry-After': '1' }
            });
        }
        return Response.json({ results: { TR: { flatrate: [{ provider_id: 8 }] } } });
    });
    const retryResult = await retryRuntime.ensureProvidersCachedForItems([
        { item: { id: 777 }, mediaType: 'movie' }
    ]);
    assert.equal(retryCalls, 2, 'HTTP 429 should use the existing Retry-After queue retry');
    assert.equal(retryResult.fetchedCount, 1);
    assert.equal(retryRuntime.getCachedTrProviderIds(777, 'movie').streamIds.has(8), true);
}

async function runBrowserTests() {
    const cspHeader = getCspHeader();
    const discoverRequests = [];
    const providerRequests = [];
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/.netlify/functions/tmdb') {
            const requestPath = url.searchParams.get('path') || '';
            if (requestPath.includes('/watch/providers')) {
                const id = Number(requestPath.match(/\/(\d+)\/watch\/providers/)?.[1]);
                providerRequests.push(id);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(providerResponse(id)));
            }
            if (requestPath.includes('/discover/movie')) {
                discoverRequests.push(requestPath);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ total_pages: 1, results: [] }));
            }
            if (/\/(?:movie|tv)\/\d+/.test(requestPath)) {
                const [, mediaType, rawId] = requestPath.match(/\/(movie|tv)\/(\d+)/) || [];
                const id = Number(rawId);
                const titleById = { 1101: 'Netflix Filmi A', 1102: 'Dizi Disney', 1103: 'Netflix Filmi B' };
                const common = {
                    id,
                    media_type: mediaType,
                    overview: 'Test açıklaması',
                    poster_path: null,
                    backdrop_path: null,
                    vote_average: 7.5,
                    genres: [],
                    credits: { cast: [], crew: [] },
                    recommendations: { results: [] },
                    similar: { results: [] },
                    videos: { results: [] }
                };
                const item = mediaType === 'tv'
                    ? { ...common, name: titleById[id] || 'Test Dizi', first_air_date: '2020-01-01', seasons: [] }
                    : { ...common, title: titleById[id] || 'Test Film', release_date: '2020-01-01', runtime: 100 };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(item));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ results: [], total_pages: 1 }));
        }
        if (url.pathname === '/.netlify/functions/omdb') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ imdbRating: '8.0' }));
        }
        if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            return res.end();
        }

        const relative = url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`;
        const filename = path.resolve(ROOT_DIR, relative);
        const extension = path.extname(filename).toLowerCase();
        if (!filename.startsWith(ROOT_DIR + path.sep) || !MIME_TYPES[extension] || !fs.existsSync(filename)) {
            res.writeHead(404);
            return res.end();
        }
        res.writeHead(200, {
            ...(extension === '.html' ? { 'Content-Security-Policy': cspHeader } : {}),
            'Content-Type': MIME_TYPES[extension]
        });
        res.end(fs.readFileSync(filename));
    });

    let browser;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        await page.setBypassServiceWorker(true);
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.evaluateOnNewDocument(() => {
            window.__cspViolations = [];
            document.addEventListener('securitypolicyviolation', event => {
                window.__cspViolations.push(event.violatedDirective);
            });
            localStorage.setItem('watchlist', JSON.stringify([
                { id: 1101, media_type: 'movie', title: 'Netflix Filmi A', release_date: '2020-01-01' },
                { id: 1102, media_type: 'tv', name: 'Dizi Disney', first_air_date: '2021-01-01' },
                { id: 1103, media_type: 'movie', title: 'Netflix Filmi B', release_date: '2022-01-01' }
            ]));
            localStorage.setItem('userSubscribedProviders', JSON.stringify([]));
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/#profile`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await page.waitForSelector('#watchlist-provider-select', { visible: true, timeout: 15000 });
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 3, {
            timeout: 10000
        });

        assert.equal(await page.$$eval('#watchlist-grid .movie-card', cards => cards.length), 3);
        const providerRequestCountBeforeSubscribedFilter = providerRequests.length;
        await page.select('#watchlist-provider-select', 'subscribed');
        await page.waitForFunction(() =>
            document.querySelector('#watchlist-provider-scan-status')?.textContent.includes('Abonelik seçilmedi')
        );
        assert.equal(await page.$$eval('#watchlist-grid .movie-card', cards => cards.length), 0);
        assert.equal(
            providerRequests.length,
            providerRequestCountBeforeSubscribedFilter,
            'No provider requests should run without selected subscriptions'
        );

        await page.evaluate(() => localStorage.setItem('userSubscribedProviders', JSON.stringify([8])));
        await page.select('#watchlist-provider-select', 'all');
        await page.select('#watchlist-provider-select', 'subscribed');
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 2, {
            timeout: 8000
        });

        await page.select('#watchlist-provider-select', 'available');
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 2);
        await page.select('#watchlist-provider-select', '8');
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 2);
        await page.waitForFunction(() =>
            document.querySelector('#watchlist-provider-scan-status')?.textContent.includes('Tüm listedeki platformlar tarandı')
        );
        assert.ok(providerRequests.includes(1102), 'Uncached watchlist entries should be scanned');
        assert.equal(await page.$eval('#watchlist-filter-reset-btn', el => el.hidden), false);

        await page.click('#watchlist-filter-reset-btn');
        assert.equal(await page.$eval('#watchlist-provider-select', el => el.value), 'all');
        assert.equal(await page.$eval('#watchlist-provider-scan-bar', el => el.hidden), true);
        assert.equal(await page.$$eval('#watchlist-grid .movie-card', cards => cards.length), 3);

        await page.select('#watchlist-provider-select', '8');
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 2);
        await page.evaluate(() => {
            window.alert = () => { throw new Error('alert must not be used'); };
            const search = document.getElementById('watchlist-search-input');
            search.value = 'Does not exist';
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 0);
        await page.click('#watchlist-pick-random-btn');
        assert.match(
            await page.$eval('#watchlist-share-status', el => el.textContent),
            /Mevcut filtreye uygun seçilebilecek yapım yok/
        );
        await page.evaluate(() => {
            const search = document.getElementById('watchlist-search-input');
            search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 2);

        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate(() => document.body.classList.add('light-theme'));
        const mobileLayout = await page.evaluate(() => {
            const toolbar = document.querySelector('.profile-list-toolbar');
            const scanBar = document.getElementById('watchlist-provider-scan-bar');
            const box = element => {
                const rect = element.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: rect.width };
            };
            return {
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: document.documentElement.clientWidth,
                toolbar: box(toolbar),
                scanBar: box(scanBar),
                lightTheme: document.body.classList.contains('light-theme')
            };
        });
        assert.equal(mobileLayout.lightTheme, true);
        assert.equal(mobileLayout.documentWidth, mobileLayout.viewportWidth, '390px light-theme layout must not overflow');
        assert.ok(mobileLayout.toolbar.left >= 0 && mobileLayout.toolbar.right <= 390);
        assert.ok(mobileLayout.scanBar.left >= 0 && mobileLayout.scanBar.right <= 390);
        await page.setViewport({ width: 1280, height: 900 });

        await page.click('.profile-toolbar-pill[data-profile-section="watchlist"][data-profile-media="movie"]');
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 2);
        await page.evaluate(() => {
            const search = document.getElementById('watchlist-search-input');
            search.value = 'Netflix Filmi B';
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 1);
        const originIndex = await page.evaluate(() => history.state?.filmRehberiRouter?.index ?? 0);
        const waitForPickedDetails = async (selection, previousTitle = null) => {
            const pickedTitle = selection.replace('Seçilen yapım: ', '');
            await page.waitForFunction((expectedTitle, oldTitle) => {
                const title = document.getElementById('details-title')?.textContent || '';
                return document.getElementById('details-modal')?.classList.contains('active') &&
                    title.includes(expectedTitle) &&
                    (!oldTitle || title !== oldTitle);
            }, {}, pickedTitle, previousTitle);
        };
        await page.click('#watchlist-pick-random-btn');
        await page.waitForSelector('#details-modal.active', { timeout: 10000 });
        await page.waitForFunction(() => document.getElementById('random-next-container')?.style.display === 'block');
        const firstPick = await page.$eval('#watchlist-share-status', el => el.textContent);
        assert.equal(firstPick, 'Seçilen yapım: Netflix Filmi B', 'Search and movie filters must constrain random selection');
        await waitForPickedDetails(firstPick);
        await page.evaluate(() => {
            profileListState.watchlist.query = '';
            const search = document.getElementById('watchlist-search-input');
            search.value = '';
            renderProfileCollectionSection('watchlist');
        });
        await page.click('#next-random-btn');
        await page.waitForFunction(first => {
            const status = document.getElementById('watchlist-share-status')?.textContent || '';
            return status.startsWith('Seçilen yapım:') && status !== first;
        }, { timeout: 10000 }, firstPick);
        const secondPick = await page.$eval('#watchlist-share-status', el => el.textContent);
        assert.match(secondPick, /^Seçilen yapım: Netflix Filmi [AB]$/);
        assert.notEqual(secondPick, firstPick);
        await waitForPickedDetails(secondPick);
        const secondDetailTitle = await page.$eval('#details-title', el => el.textContent);
        const secondPickIndex = await page.evaluate(() => history.state?.filmRehberiRouter?.index ?? 0);

        await page.click('#next-random-btn');
        await page.waitForFunction(previous => {
            const status = document.getElementById('watchlist-share-status')?.textContent || '';
            return status.startsWith('Seçilen yapım:') && status !== previous;
        }, { timeout: 10000 }, secondPick);
        const thirdPick = await page.$eval('#watchlist-share-status', el => el.textContent);
        await waitForPickedDetails(thirdPick, secondDetailTitle);
        assert.ok(
            await page.evaluate(origin => history.state?.filmRehberiRouter?.index >= origin + 2, originIndex),
            'Chained watchlist picks must add movie entries to history'
        );

        await page.goBack({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(previousTitle =>
            /\/(?:film|dizi)\//.test(window.location.pathname) &&
            document.getElementById('details-modal')?.classList.contains('active') &&
            document.getElementById('details-title')?.textContent === previousTitle,
        {}, secondDetailTitle);
        assert.ok(
            await page.evaluate(index => history.state?.filmRehberiRouter?.index === index, secondPickIndex),
            'Browser Back must step back one movie in the chain'
        );

        let currentPick = await page.$eval('#watchlist-share-status', el => el.textContent);
        await page.click('#next-random-btn');
        await page.waitForFunction(previous => {
            const status = document.getElementById('watchlist-share-status')?.textContent || '';
            return status.startsWith('Seçilen yapım:') && status !== previous;
        }, { timeout: 10000 }, currentPick);
        currentPick = await page.$eval('#watchlist-share-status', el => el.textContent);
        const indexAfterNext = await page.evaluate(() => history.state?.filmRehberiRouter?.index ?? 0);
        if (indexAfterNext < originIndex + 2) {
            await page.click('#next-random-btn');
            await page.waitForFunction((previous, origin) => {
                const status = document.getElementById('watchlist-share-status')?.textContent || '';
                return status.startsWith('Seçilen yapım:') &&
                    status !== previous &&
                    history.state?.filmRehberiRouter?.index >= origin + 2;
            }, { timeout: 10000 }, currentPick, originIndex);
        }
        assert.ok(
            await page.evaluate(origin => history.state?.filmRehberiRouter?.index >= origin + 2, originIndex),
            'The close-button check must be at least two movie entries beyond the origin'
        );
        await page.click('#details-modal .close-btn');
        await page.waitForFunction(() =>
            window.location.pathname === '/profilim' &&
            !document.getElementById('details-modal')?.classList.contains('active'),
        { timeout: 10000 });

        await page.click('#watchlist-pick-random-btn');
        await page.waitForSelector('#details-modal.active', { timeout: 10000 });
        await page.waitForFunction(() => document.getElementById('random-next-container')?.style.display === 'block');
        await page.click('#next-random-btn');
        await page.waitForFunction(() =>
            document.getElementById('details-modal')?.classList.contains('active') &&
            /\/(?:film|dizi)\//.test(window.location.pathname)
        );
        const backdrop = await page.$('#details-modal');
        const backdropBounds = await backdrop.boundingBox();
        assert.ok(backdropBounds && backdropBounds.width > 10 && backdropBounds.height > 10);
        await page.mouse.click(backdropBounds.x + 5, backdropBounds.y + 5);
        await page.waitForFunction(() =>
            window.location.pathname === '/profilim' &&
            !document.getElementById('details-modal')?.classList.contains('active'),
        { timeout: 10000 });
        assert.equal(discoverRequests.length, 0, 'Watchlist next-pick must not call TMDB discover');

        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual(pageErrors, [], 'Browser page errors must remain empty');
        assert.deepEqual(await page.evaluate(() => window.__cspViolations), [], 'CSP violations must remain empty');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

(async () => {
    await runUnitTests();
    console.log('✓ Provider cache unit tests passed.');
    await runBrowserTests();
    console.log('✓ Watchlist filter and random-pick browser tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
