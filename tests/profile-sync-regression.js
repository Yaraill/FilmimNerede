const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { afterEach, beforeEach, test } = require('node:test');
const puppeteer = require('puppeteer');
const profileSync = require('../netlify/functions/profile-sync');
const storeModule = require('../netlify/functions/lib/profile-sync-store');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENDPOINT = '/.netlify/functions/profile-sync';
const backup = {
    app: 'FilmimNerede',
    version: 2,
    exportedAt: '2026-11-26T00:00:00.000Z',
    data: {
        watchlist: [{ id: 501, title: 'Aktarım Filmi', media_type: 'movie' }],
        ratedMovies: [{ id: 502, title: 'Puanlı Film', media_type: 'movie' }],
        movieRatings: { 'movie:502': 8.5 },
        favoriteActors: [{ id: 503, name: 'Oyuncu' }],
        recentlyViewed: [{ id: 504, title: 'Son Bakılan', media_type: 'tv' }],
        userSubscribedProviders: [8, 119],
        tvEpisodeProgress: { 'tv:505': { id: 505, media_type: 'tv' } },
        savedSharedLists: [{ id: 'list-1', title: 'Seçkim' }]
    }
};

beforeEach(() => {
    profileSync._resetRateLimit();
    profileSync._setStoreForTests(storeModule.createMemoryProfileSyncStore());
});

afterEach(() => {
    profileSync._setStoreForTests(null);
    profileSync._resetRateLimit();
});

function assertUncached(response, statusCode) {
    assert.equal(response.statusCode, statusCode);
    assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['Cache-Control'], 'no-store');
    return JSON.parse(response.body);
}

function post(payload, extra = {}) {
    return profileSync.handler({
        httpMethod: 'POST',
        body: JSON.stringify(payload),
        headers: { 'x-nf-client-connection-ip': '192.0.2.1' },
        ...extra
    });
}

test('one-time create/redeem round-trips backup v2 and consumes its code', async () => {
    const created = assertUncached(await post({ action: 'create', backup }), 201);
    assert.match(created.code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    assert.match(created.formattedCode, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/);
    assert.equal(created.ttlSeconds, 600);

    assert.deepEqual(assertUncached(await post({ action: 'redeem', code: created.formattedCode }), 200), {
        backup
    });
    assert.equal(assertUncached(await post({ action: 'redeem', code: created.code }), 404).error,
        'Kod geçersiz, kullanılmış veya süresi dolmuş.');
});

test('one-time redemption atomically allows only one concurrent claimant', async () => {
    const memoryStore = storeModule.createMemoryProfileSyncStore();
    const created = await storeModule.saveOneTimeSyncRecord(memoryStore, backup);
    const racyStore = {
        async get(code) {
            await Promise.resolve();
            return memoryStore.get(code);
        },
        setIfAbsent: memoryStore.setIfAbsent,
        delete: memoryStore.delete
    };

    const results = await Promise.all([
        storeModule.redeemOneTimeSyncRecord(racyStore, created.formattedCode),
        storeModule.redeemOneTimeSyncRecord(racyStore, created.formattedCode)
    ]);

    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(results.filter(result => !result.ok && result.statusCode === 404).length, 1);
});

test('sync code normalization and format validation reject ambiguous characters', async () => {
    assert.equal(storeModule.normalizeSyncCode(' k7m 4px '), 'K7M4PX');
    assert.equal(storeModule.formatSyncCode('K7M4PX'), 'K7M-4PX');
    assert.equal(storeModule.formatSyncCode('K7M'), '');
    for (const code of ['0AAAAA', 'OAAAAA', '1AAAAA', 'IAAAAA', 'LAAAAA', 'AAAAA', 'AAAAAAA']) {
        assert.equal(storeModule.normalizeSyncCode(code), null);
        assert.equal(assertUncached(await post({ action: 'redeem', code }), 400).error,
            'Geçersiz aktarım kodu biçimi.');
    }
});

test('expired records are deleted on redemption', async () => {
    const memoryStore = storeModule.createMemoryProfileSyncStore();
    let deletedCode = null;
    const store = {
        get: memoryStore.get,
        setIfAbsent: memoryStore.setIfAbsent,
        async delete(code) {
            deletedCode = code;
            await memoryStore.delete(code);
        }
    };
    await store.setIfAbsent('K7M4PX', {
        v: 1,
        createdAt: 0,
        expiresAt: 600_000,
        backup
    });
    const result = await storeModule.redeemOneTimeSyncRecord(store, 'K7M-4PX', () => 600_000);
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 404);
    assert.equal(deletedCode, 'K7M4PX');
    assert.equal(await memoryStore.get('K7M4PX'), null);
});

test('all method, payload, body-size, and store-error responses remain uncached', async () => {
    const getResponse = await profileSync.handler({ httpMethod: 'GET' });
    assert.equal(assertUncached(getResponse, 405).error, 'Method Not Allowed');
    assert.equal(getResponse.headers.Allow, 'POST');

    assert.equal(assertUncached(await post({ action: 'create', backup: { ...backup, version: 3 } }), 400).error.length > 0, true);
    assertUncached(await post({ action: 'invalid' }), 400);
    assertUncached(await profileSync.handler({ httpMethod: 'POST', body: '{' }), 400);
    assertUncached(await profileSync.handler({ httpMethod: 'POST', body: 'x'.repeat(1_500_001) }), 413);
    assertUncached(await profileSync.handler({
        httpMethod: 'POST',
        body: Buffer.from('x'.repeat(1_500_001)).toString('base64'),
        isBase64Encoded: true
    }), 413);

    profileSync._setStoreForTests({
        async get() { throw new Error('store unavailable'); },
        async setIfAbsent() { throw new Error('store unavailable'); },
        async delete() { throw new Error('store unavailable'); }
    });
    assertUncached(await post({ action: 'create', backup }), 503);
});

test('backup validation enforces known list and map bounds', async () => {
    const tooManyItems = {
        ...backup,
        data: { ...backup.data, watchlist: Array(5001).fill({ id: 1 }) }
    };
    assertUncached(await post({ action: 'create', backup: tooManyItems }), 400);
    const invalidMap = {
        ...backup,
        data: { ...backup.data, movieRatings: [] }
    };
    assertUncached(await post({ action: 'create', backup: invalidMap }), 400);
    for (const value of [null, [], Object.create({ app: 'FilmimNerede' })]) {
        assert.equal(storeModule.validateProfileSyncBackup(value).ok, false);
    }
});

test('create and redeem rate limits are independent and recover after their window', async () => {
    let now = 1000;
    profileSync._resetRateLimit({ now: () => now });
    profileSync._setStoreForTests(storeModule.createMemoryProfileSyncStore());
    for (let index = 0; index < 5; index += 1) {
        assertUncached(await post({ action: 'create', backup }), 201);
    }
    const createLimited = await post({ action: 'create', backup });
    assertUncached(createLimited, 429);
    assert.ok(Number(createLimited.headers['Retry-After']) > 0);

    for (let index = 0; index < 10; index += 1) {
        assertUncached(await post({ action: 'redeem', code: 'K7M4PX' }), 404);
    }
    const redeemLimited = await post({ action: 'redeem', code: 'K7M4PX' });
    assertUncached(redeemLimited, 429);
    assert.ok(Number(redeemLimited.headers['Retry-After']) > 0);

    now += 60_000;
    assertUncached(await post({ action: 'create', backup }), 201);
    assertUncached(await post({ action: 'redeem', code: 'K7M4PX' }), 404);
});

test('non-string client headers are safely ignored', async () => {
    const response = await profileSync.handler({
        httpMethod: 'POST',
        body: JSON.stringify({ action: 'create', backup }),
        headers: {
            'x-nf-client-connection-ip': 42,
            'x-forwarded-for': ['192.0.2.2']
        }
    });
    assertUncached(response, 201);
});

test('Netlify Blobs Lambda connection uses the profile sync store and failures return 503', async () => {
    const originalLoad = Module._load;
    let connectedEvent;
    let storeName;
    let options;
    const fakeStore = {
        async get() { return null; },
        async setJSON(code, value, writeOptions) {
            options = { code, value, writeOptions };
            return { modified: true };
        },
        async delete() {}
    };
    Module._load = function load(request, parent, isMain) {
        if (request === '@netlify/blobs') {
            return {
                connectLambda(event) { connectedEvent = event; },
                getStore(name) {
                    storeName = name;
                    return fakeStore;
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        profileSync._setStoreForTests(null);
        const event = {
            httpMethod: 'POST',
            body: JSON.stringify({ action: 'create', backup }),
            blobs: { token: 'runtime-context' }
        };
        assertUncached(await profileSync.handler(event), 201);
        assert.equal(connectedEvent, event);
        assert.equal(storeName, storeModule.PROFILE_SYNC_STORE_NAME);
        assert.equal(options.writeOptions.onlyIfNew, true);

        fakeStore.setJSON = async () => { throw new Error('blob outage'); };
        assertUncached(await profileSync.handler(event), 503);
    } finally {
        Module._load = originalLoad;
    }
});

function createServer() {
    const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "font-src 'self' https://cdnjs.cloudflare.com data:",
        "img-src 'self' data: blob: https://image.tmdb.org https://upload.wikimedia.org",
        "connect-src 'self' https://image.tmdb.org https://www.youtube-nocookie.com",
        'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
        "form-action 'self'"
    ].join('; ');
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon'
    };
    const server = http.createServer((request, response) => {
        let urlPath;
        try {
            urlPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
            response.writeHead(400).end();
            return;
        }
        const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);
        const filePath = path.resolve(ROOT_DIR, relativePath);
        if (!filePath.startsWith(`${ROOT_DIR}${path.sep}`) && filePath !== path.join(ROOT_DIR, 'index.html')) {
            response.writeHead(403).end();
            return;
        }
        fs.readFile(filePath, (error, contents) => {
            if (error) {
                response.writeHead(404).end('Not found');
                return;
            }
            const extension = path.extname(filePath).toLowerCase();
            response.writeHead(200, {
                'Content-Type': mimeTypes[extension] || 'application/octet-stream',
                ...(extension === '.html' ? { 'Content-Security-Policy': csp } : {})
            });
            response.end(contents);
        });
    });
    return server;
}

test('Puppeteer sync flow, CSP, one-time behavior, Escape, and mobile light theme', async () => {
    const server = createServer();
    let browser;
    const tempStore = storeModule.createMemoryProfileSyncStore();
    profileSync._setStoreForTests(tempStore);
    const endpointCalls = [];
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        page.setDefaultTimeout(10000);
        await page.setViewport({ width: 1280, height: 900 });
        await page.setBypassServiceWorker(true);
        await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write']);
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.evaluateOnNewDocument(() => {
            window.__cspViolations = [];
            document.addEventListener('securitypolicyviolation', event => {
                window.__cspViolations.push(event.violatedDirective);
            });
        });
        await page.setRequestInterception(true);
        page.on('request', async request => {
            const url = new URL(request.url());
            if (url.pathname === ENDPOINT) {
                const rawBody = request.postData() || '';
                let eventBody;
                try {
                    eventBody = JSON.parse(rawBody);
                } catch {
                    request.respond({ status: 400, contentType: 'application/json', body: '{"error":"Geçersiz JSON verisi."}' });
                    return;
                }
                endpointCalls.push(eventBody.action);
                const result = await profileSync.handler({
                    httpMethod: request.method(),
                    body: rawBody,
                    headers: { 'x-nf-client-connection-ip': '198.51.100.10' }
                });
                request.respond({
                    status: result.statusCode,
                    headers: result.headers,
                    body: result.body
                });
                return;
            }
            if (url.pathname.startsWith('/.netlify/functions/')) {
                request.respond({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({ results: [], genres: [], providers: [] })
                });
                return;
            }
            if (url.origin === origin) {
                request.continue();
                return;
            }
            request.abort();
        });

        await page.goto(`${origin}/#profile`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#profile.active-tab', { timeout: 10000 });
        await page.waitForFunction(() => document.getElementById('profile-sync-create-btn')?.dataset.bound === 'true');
        await page.evaluate(() => {
            const movie = { id: 8101, title: 'Aktarılan Film', media_type: 'movie' };
            const rated = { id: 8102, title: 'Aktarılan Puan', media_type: 'movie' };
            const show = {
                id: 8103, media_type: 'tv', name: 'Aktarılan Dizi', poster_path: '/show.jpg',
                totalSeasons: 1, totalEpisodes: 2, avgEpisodeRuntime: 45,
                watched: ['S1E1'], episodeRuntimes: { S1E1: 45 }, updatedAt: 100
            };
            const listItem = { id: 8104, title: 'Seçki Filmi', media_type: 'movie' };
            const savedList = {
                id: 'sync-e2e-list',
                title: 'Aktarılan Seçki',
                items: [listItem],
                route: buildSharedListRoute('Aktarılan Seçki', [listItem]),
                updatedAt: 200,
                shortId: 'SyncList1'
            };
            const values = {
                watchlist: [movie],
                ratedMovies: [rated],
                movieRatings: { 'movie:8102': 9 },
                favoriteActors: [],
                recentlyViewed: [],
                userSubscribedProviders: [8, 119],
                tvEpisodeProgress: { 'tv:8103': show },
                savedSharedLists: [savedList]
            };
            localStorage.clear();
            Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
            loadProfile();
        });

        await page.click('#profile-sync-open-btn');
        await page.click('#profile-sync-create-btn');
        await page.waitForFunction(() => {
            const code = document.getElementById('profile-sync-code-display')?.textContent || '';
            return /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{3}$/.test(code);
        }, { timeout: 10000 });
        const formattedCode = await page.$eval('#profile-sync-code-display', element => element.textContent);
        assert.match(await page.$eval('#profile-sync-countdown', element => element.textContent), /^Kalan süre: \d{2}:\d{2}$/);
        await page.click('#profile-sync-copy-btn');
        await page.waitForFunction(() => document.getElementById('profile-sync-status')?.textContent.includes('panoya kopyalandı'));
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), formattedCode);

        await page.evaluate(() => {
            localStorage.clear();
            loadProfile();
        });
        await page.evaluate(code => {
            document.getElementById('profile-sync-code-input').value = code;
        }, formattedCode);
        await page.click('#profile-sync-redeem-btn');
        await page.waitForFunction(() =>
            document.getElementById('profile-sync-status')?.dataset.state === 'success'
        );
        const restored = await page.evaluate(() => ({
            watchlist: JSON.parse(localStorage.getItem('watchlist') || '[]'),
            ratedMovies: JSON.parse(localStorage.getItem('ratedMovies') || '[]'),
            movieRatings: JSON.parse(localStorage.getItem('movieRatings') || '{}'),
            userSubscribedProviders: JSON.parse(localStorage.getItem('userSubscribedProviders') || '[]'),
            tvEpisodeProgress: JSON.parse(localStorage.getItem('tvEpisodeProgress') || '{}'),
            savedSharedLists: JSON.parse(localStorage.getItem('savedSharedLists') || '[]'),
            watchlistUi: document.getElementById('watchlist-grid')?.textContent || ''
        }));
        assert.equal(restored.watchlist[0].id, 8101);
        assert.equal(restored.ratedMovies[0].id, 8102);
        assert.equal(restored.movieRatings['movie:8102'], 9);
        assert.deepEqual(restored.userSubscribedProviders, [8, 119]);
        assert.deepEqual(restored.tvEpisodeProgress['tv:8103'].watched, ['S1E1']);
        assert.equal(restored.savedSharedLists[0].id, 'sync-e2e-list');
        assert.match(restored.watchlistUi, /Aktarılan Film/);

        await page.click('#profile-sync-redeem-btn');
        await page.waitForFunction(() =>
            document.getElementById('profile-sync-status')?.dataset.state === 'error'
        );
        assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('watchlist'))))[0].id, 8101);

        await page.click('#profile-sync-create-btn');
        await page.waitForFunction(previousCode => {
            const box = document.getElementById('profile-sync-code-box');
            const code = document.getElementById('profile-sync-code-display')?.textContent;
            return box && !box.hidden && code && code !== previousCode;
        }, {}, formattedCode);
        const cancelCode = await page.$eval('#profile-sync-code-display', element => element.textContent);
        await page.select('#profile-sync-mode', 'replace');
        await page.$eval('#profile-sync-code-input', (input, value) => { input.value = value; }, cancelCode);
        const callsBeforeCancel = endpointCalls.length;
        await page.evaluate(() => { window.__nativeConfirm = window.confirm; window.confirm = () => false; });
        await page.click('#profile-sync-redeem-btn');
        await page.waitForFunction(() => document.getElementById('profile-sync-status')?.textContent === 'Profil aktarımı iptal edildi.');
        assert.equal(endpointCalls.length, callsBeforeCancel, 'Canceling replace must not consume a code');
        await page.evaluate(() => { window.confirm = window.__nativeConfirm; });
        await page.select('#profile-sync-mode', 'merge');
        await page.click('#profile-sync-redeem-btn');
        await page.waitForFunction(() => document.getElementById('profile-sync-status')?.dataset.state === 'success');

        await page.evaluate(() => closeProfileSyncModal(null, true));
        assert.equal(await page.evaluate(() => profileSyncCountdownTimer), null);
        await page.evaluate(() => openProfileSyncModal());
        const resumedCountdown = await page.$eval('#profile-sync-countdown', element => element.textContent);
        assert.match(resumedCountdown, /^Kalan süre: \d{2}:\d{2}$/);
        await page.waitForFunction(previous => {
            return document.getElementById('profile-sync-countdown')?.textContent !== previous;
        }, { timeout: 3000 }, resumedCountdown);

        await page.evaluate(() => {
            lastGeneratedSyncExpiresAt = Date.now() + 500;
            closeProfileSyncModal(null, true);
        });
        await new Promise(resolve => setTimeout(resolve, 700));
        await page.evaluate(() => openProfileSyncModal());
        assert.equal(await page.$eval('#profile-sync-countdown', element => element.textContent), 'Süre doldu');
        assert.equal(await page.$eval('#profile-sync-status', element => element.dataset.state), 'error');

        await page.keyboard.press('Escape');
        await page.waitForFunction(() =>
            !document.getElementById('profile-sync-modal').classList.contains('active')
        );
        const escapeState = await page.evaluate(() => ({
            modalInert: document.getElementById('profile-sync-modal').inert,
            mainInert: document.getElementById('main-content').inert,
            stackHasModal: window.ModalManager.stack.some(entry => entry.id === 'profile-sync-modal')
        }));
        assert.equal(escapeState.modalInert, true);
        assert.equal(escapeState.mainInert, false);
        assert.equal(escapeState.stackHasModal, false);

        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate(() => document.body.classList.add('light-theme'));
        await page.click('#profile-sync-open-btn');
        const mobile = await page.evaluate(() => ({
            background: getComputedStyle(document.querySelector('.profile-sync-modal-content')).backgroundColor,
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            closeRect: (() => {
                const rect = document.querySelector('#profile-sync-modal .close-btn').getBoundingClientRect();
                return { top: rect.top, right: rect.right, width: rect.width, height: rect.height };
            })(),
            modalRect: (() => {
                const rect = document.querySelector('.profile-sync-modal-content').getBoundingClientRect();
                return { top: rect.top, right: rect.right };
            })()
        }));
        assert.equal(mobile.background, 'rgb(255, 255, 255)');
        assert.equal(mobile.scrollWidth, mobile.clientWidth);
        assert.ok(mobile.closeRect.width >= 36 && mobile.closeRect.height >= 36);
        assert.ok(mobile.closeRect.top >= 0 && mobile.closeRect.right <= 390);
        assert.ok(mobile.closeRect.top >= mobile.modalRect.top && mobile.closeRect.right <= mobile.modalRect.right);

        assert.deepEqual(pageErrors, [], `Unexpected pageerror: ${pageErrors.join('; ')}`);
        assert.deepEqual(await page.evaluate(() => window.__cspViolations), [], 'CSP violations must remain empty');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
