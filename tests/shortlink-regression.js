const assert = require('node:assert/strict');
const fs = require('node:fs');
const { beforeEach, afterEach, test } = require('node:test');
const vm = require('node:vm');
const shortlink = require('../netlify/functions/shortlink');
const {
    SHORTLINK_STORE_NAME,
    SHORTLINK_MAX_BODY_BYTES,
    SHORTLINK_MAX_ITEMS,
    SHORTLINK_MAX_TITLE_LENGTH,
    normalizeShortlinkPayload,
    computeShortlinkId,
    createMemoryShortlinkStore,
    saveIdempotentShortlink
} = require('../netlify/functions/lib/shortlink-store');

const payload = {
    title: '  İstanbul’da İzlenecekler  ',
    items: [{ id: 550, media_type: 'movie' }, 't1396', { id: 550, mediaType: 'movie' }, 'm1396']
};
const canonicalRecord = { v: 1, t: 'İstanbul’da İzlenecekler', i: ['m550', 't1396', 'm1396'] };
const shortId = 'AbCd1234';
const endpoint = '/.netlify/functions/shortlink';
const frontendItems = [{ id: 550, media_type: 'movie' }, { id: 1396, media_type: 'tv' }];

beforeEach(() => {
    shortlink._resetRateLimit();
    shortlink._setStoreForTests(createMemoryShortlinkStore());
});

afterEach(() => {
    shortlink._setStoreForTests(null);
    shortlink._resetRateLimit();
});

function post(body = payload, options = {}) {
    return shortlink.handler({ httpMethod: 'POST', body: JSON.stringify(body), ...options });
}

function get(id, headers) {
    return shortlink.handler({ httpMethod: 'GET', queryStringParameters: { id }, headers });
}

function assertUncached(response, statusCode) {
    assert.equal(response.statusCode, statusCode);
    assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['Netlify-CDN-Cache-Control'], undefined);
    return JSON.parse(response.body);
}

function loadFrontend({ fetch, protocol = 'https:' } = {}) {
    const context = vm.createContext({
        window: { location: { hash: '', protocol } },
        history: {},
        AbortController,
        fetch,
        setTimeout,
        clearTimeout
    });
    for (const script of ['security.js', 'router.js', 'profile.js']) {
        const filename = require.resolve(`../js/runtime/${script}`);
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    }
    return context;
}

test('POST and GET round-trip a Turkish title and compact tokens with zero duplicate writes', async () => {
    const store = createMemoryShortlinkStore();
    let writes = 0;
    shortlink._setStoreForTests({
        get: store.get,
        setIfAbsent(id, record) {
            writes += 1;
            return store.setIfAbsent(id, record);
        }
    });

    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const created = assertUncached(await post(payload, { body: encoded, isBase64Encoded: true }), 201);
    assert.match(created.id, /^[0-9A-Za-z]{8}$/);
    assert.equal(created.route, `s/${created.id}`);
    assert.deepEqual(await store.get(created.id), canonicalRecord);

    const repeated = await post({ title: canonicalRecord.t, items: canonicalRecord.i });
    assert.deepEqual(assertUncached(repeated, 200), created);
    assert.equal(writes, 1);

    const response = await get(created.id);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'public, max-age=3600, s-maxage=86400');
    assert.equal(response.headers['Netlify-CDN-Cache-Control'], 'public, s-maxage=2592000, durable');
    assert.deepEqual(JSON.parse(response.body), {
        v: 1,
        id: created.id,
        title: canonicalRecord.t,
        items: [
            { id: 550, media_type: 'movie' },
            { id: 1396, media_type: 'tv' },
            { id: 1396, media_type: 'movie' }
        ]
    });
});

test('normalization handles optional titles, 15-digit IDs and title character limits', () => {
    for (const title of [undefined, null, '', ' \t ']) {
        assert.deepEqual(normalizeShortlinkPayload({ title, items: ['m1'] }), {
            ok: true,
            record: { v: 1, t: '', i: ['m1'] }
        });
    }
    const title = 'ş'.repeat(SHORTLINK_MAX_TITLE_LENGTH);
    assert.deepEqual(normalizeShortlinkPayload({ title: ` ${title} `, items: [
        { id: 999_999_999_999_999, mediaType: 'tv' }, 'm999999999999999'
    ] }), {
        ok: true,
        record: { v: 1, t: title, i: ['t999999999999999', 'm999999999999999'] }
    });
    if (typeof String.prototype.toWellFormed === 'function') {
        assert.equal(normalizeShortlinkPayload({ title: '\uD800', items: ['t1'] }).record.t, '\uFFFD');
    }
});

test('POST enforces the decoded UTF-8 byte limit before parsing and avoids storage on invalid inputs', async () => {
    shortlink._resetRateLimit({ limits: { write: 50 } });
    shortlink._setStoreForTests({ get: assert.fail, setIfAbsent: assert.fail });
    const body = JSON.stringify({ title: 'ş'.repeat(1020), items: ['m1'] });
    assert.ok(body.length < SHORTLINK_MAX_BODY_BYTES);
    assert.ok(Buffer.byteLength(body) > SHORTLINK_MAX_BODY_BYTES);
    assertUncached(await post(payload, { body }), 413);
    assertUncached(await post(payload, { body: Buffer.from(body).toString('base64'), isBase64Encoded: true }), 413);

    for (const rawBody of [null, '', '  ', '{', 'null', '[]']) {
        assertUncached(await post(payload, { body: rawBody }), 400);
    }
    const invalidPayloads = [
        { items: [] },
        { items: 'm1' },
        { items: Array(SHORTLINK_MAX_ITEMS + 1).fill('m1') },
        { title: 42, items: ['m1'] },
        { title: 'x'.repeat(SHORTLINK_MAX_TITLE_LENGTH + 1), items: ['m1'] },
        ...[
            null, 'm01', 'm0', 'm1\n', 'm1000000000000000', 'x42',
            { id: '1', mediaType: 'movie' }, { id: 0, mediaType: 'tv' },
            { id: 1.5, mediaType: 'tv' }, { id: 1_000_000_000_000_000, mediaType: 'tv' },
            { id: Number.MAX_SAFE_INTEGER + 1, mediaType: 'tv' }, { id: 1, mediaType: 'person' }
        ].map(item => ({ items: ['m1', item] }))
    ];
    for (const invalid of invalidPayloads) {
        const response = await post(invalid);
        assert.equal(typeof assertUncached(response, 400).error, 'string');
    }

    shortlink._setStoreForTests(createMemoryShortlinkStore());
    const boundaryBody = JSON.stringify(payload);
    const paddedBody = boundaryBody + ' '.repeat(SHORTLINK_MAX_BODY_BYTES - Buffer.byteLength(boundaryBody));
    assertUncached(await post(payload, { body: Buffer.from(paddedBody).toString('base64'), isBase64Encoded: true }), 201);
});

test('POST rejects an oversized base64 body before decoding', async t => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64') + ' '.repeat(SHORTLINK_MAX_BODY_BYTES * 2);
    const originalFrom = Buffer.from;
    let decodeCalls = 0;
    t.mock.method(Buffer, 'from', (value, ...args) => {
        if (value === body && args[0] === 'base64') decodeCalls += 1;
        return originalFrom(value, ...args);
    });

    assertUncached(await post(payload, { body, isBase64Encoded: true }), 413);
    assert.equal(decodeCalls, 0);
});

test('IDs are deterministic and collisions preserve each existing record', async () => {
    const store = createMemoryShortlinkStore();
    const id = computeShortlinkId(canonicalRecord);
    assert.equal(computeShortlinkId({ i: [...canonicalRecord.i], t: canonicalRecord.t, v: 1 }), id);
    assert.notEqual(computeShortlinkId({ ...canonicalRecord, i: [...canonicalRecord.i].reverse() }), id);

    const otherRecord = { v: 1, t: '', i: ['t1'] };
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await store.setIfAbsent(computeShortlinkId(canonicalRecord, attempt), otherRecord);
    }
    const expectedId = computeShortlinkId(canonicalRecord, 5);
    assert.deepEqual(await saveIdempotentShortlink(store, canonicalRecord), {
        id: expectedId, record: canonicalRecord, created: true
    });
    assert.deepEqual(await saveIdempotentShortlink(store, canonicalRecord), {
        id: expectedId, record: canonicalRecord, created: false
    });
    assert.deepEqual(await store.get(id), otherRecord);
});

test('conditional-write races reuse an identical record and probe past different contents', async () => {
    const store = createMemoryShortlinkStore();
    const results = await Promise.all([
        saveIdempotentShortlink(store, canonicalRecord),
        saveIdempotentShortlink(store, canonicalRecord)
    ]);
    assert.equal(results[0].id, results[1].id);
    assert.deepEqual(results.map(result => result.created).sort(), [false, true]);

    const collisionStore = createMemoryShortlinkStore();
    const firstId = computeShortlinkId(canonicalRecord);
    const winner = { v: 1, t: '', i: ['t1'] };
    const racingStore = {
        get: collisionStore.get,
        async setIfAbsent(id, record) {
            if (id === firstId) {
                await collisionStore.setIfAbsent(id, winner);
            }
            return collisionStore.setIfAbsent(id, record);
        }
    };
    const result = await saveIdempotentShortlink(racingStore, canonicalRecord);
    assert.equal(result.id, computeShortlinkId(canonicalRecord, 1));
    assert.deepEqual(await collisionStore.get(firstId), winner);
});

test('a retry reuses the original ID after the conditional-write winner becomes readable', async () => {
    const attempts = [];
    const originalId = computeShortlinkId(canonicalRecord);
    let winnerVisible = false;
    shortlink._setStoreForTests({
        get: async id => winnerVisible && id === originalId ? canonicalRecord : null,
        async setIfAbsent(id) {
            attempts.push(id);
            return { modified: false };
        }
    });
    assertUncached(await post(), 503);
    winnerVisible = true;
    assert.deepEqual(assertUncached(await post(), 200), { id: originalId, route: `s/${originalId}` });
    assert.deepEqual(attempts, [originalId]);
});

test('read and write rate limits are independent, per IP, and expire after 60 seconds', async () => {
    let now = 10_000;
    shortlink._resetRateLimit({ now: () => now });
    const headers = { 'X-Nf-Client-Connection-Ip': ' 192.0.2.1 ', 'X-Forwarded-For': '192.0.2.9' };
    const created = assertUncached(await post(payload, { headers }), 201);
    for (let index = 1; index < 15; index += 1) {
        assertUncached(await post(payload, { headers }), 200);
    }
    const throttled = await shortlink.handler({
        httpMethod: 'POST',
        headers: { 'x-forwarded-for': '192.0.2.1, 192.0.2.2' },
        get body() { assert.fail('A throttled request accessed the body'); }
    });
    assertUncached(throttled, 429);
    assert.equal(throttled.headers['Retry-After'], '60');
    assertUncached(await post(payload, { headers: { 'x-forwarded-for': '192.0.2.9' } }), 200);

    for (let index = 0; index < 120; index += 1) {
        assert.equal((await get(created.id, headers)).statusCode, 200);
    }
    now += 59_500;
    const throttledRead = await get(created.id, headers);
    assertUncached(throttledRead, 429);
    assert.equal(throttledRead.headers['Retry-After'], '1');
    now += 500;
    assert.equal((await get(created.id, headers)).statusCode, 200);
    assertUncached(await post(payload, { headers }), 200);
});

test('invalid IDs, missing or malformed records, methods and store outages return uncached errors', async () => {
    const missing = { error: 'Kısa bağlantı bulunamadı.' };
    assert.deepEqual(assertUncached(await get('Absent8'), 404), missing);
    for (const id of [undefined, 'short', 'longerthan12c', 'abc-123', ' Valid8', 123456, ['Valid8']]) {
        assertUncached(await get(id), 400);
    }

    for (const record of [
        { v: 2, t: '', i: ['m1'] }, { v: 1, t: null, i: ['m1'] },
        { v: 1, t: '', i: [] }, { v: 1, t: '', i: ['t01'] }, { v: 1, t: '', i: ['m1', 'm1'] }
    ]) {
        shortlink._setStoreForTests({ get: async () => record });
        assert.deepEqual(assertUncached(await get('Valid8'), 404), missing);
    }
    shortlink._setStoreForTests({ get: async () => JSON.parse('{') });
    assert.deepEqual(assertUncached(await get('Valid8'), 404), missing);

    const unavailable = Object.assign(new Error('Private storage details'), { name: 'MissingBlobsEnvironmentError' });
    shortlink._setStoreForTests({ get: async () => { throw unavailable; } });
    assert.match(assertUncached(await get('Valid8'), 503).error, /servisine/);
    assert.match(assertUncached(await post(), 503).error, /servisine/);

    const unsupported = await shortlink.handler({ httpMethod: 'PUT' });
    assert.deepEqual(assertUncached(unsupported, 405), { error: 'Method Not Allowed' });
    assert.equal(unsupported.headers.Allow, 'GET, POST');
});

test('the Netlify Blobs adapter connects Functions v1 before opening the store', async () => {
    const filename = require.resolve('../netlify/functions/lib/shortlink-store');
    const loadStore = vm.compileFunction(fs.readFileSync(filename, 'utf8'), ['require', 'module'], { filename });
    const storeModule = { exports: {} };
    const event = { blobs: 'test-event-context' };
    const calls = [];
    const mockBlobs = {
        connectLambda(lambdaEvent) { calls.push(['connectLambda', lambdaEvent]); },
        getStore(name) {
            calls.push(['getStore', name]);
            return {
                async get(id, options) {
                    calls.push(['get', id, options]);
                    return canonicalRecord;
                },
                async setJSON(id, record, options) {
                    calls.push(['setJSON', id, record, options]);
                    return { modified: false };
                }
            };
        }
    };
    loadStore(name => name === '@netlify/blobs' ? mockBlobs : require(name), storeModule);

    const { createNetlifyShortlinkStore, getShortlinkStore, _setStoreForTests } = storeModule.exports;
    const store = createNetlifyShortlinkStore(event);
    assert.deepEqual(calls, [['connectLambda', event], ['getStore', SHORTLINK_STORE_NAME]]);
    assert.deepEqual(await store.get('Valid8'), canonicalRecord);
    assert.deepEqual(await store.setIfAbsent('Valid8', canonicalRecord), { modified: false });
    assert.deepEqual(calls.slice(2), [
        ['get', 'Valid8', { type: 'json' }],
        ['setJSON', 'Valid8', canonicalRecord, { onlyIfNew: true }]
    ]);

    calls.length = 0;
    _setStoreForTests(store);
    assert.equal(getShortlinkStore(event), store);
    assert.deepEqual(calls, []);
    _setStoreForTests(null);
    getShortlinkStore({});
    assert.deepEqual(calls, [['getStore', SHORTLINK_STORE_NAME]]);
});

test('short hashes parse as shared lists and keep their route context current', () => {
    const runtime = loadFrontend();
    const renders = [];
    runtime.document = { getElementById: () => null, body: { style: {} } };
    runtime.renderSection = (page, context) => renders.push({ page, context });
    let previousContext;

    for (const [hash, expectedId] of [[`#s/${shortId}`, shortId], [`#s/${shortId}/`, shortId], ['#s', '']]) {
        runtime.window.location.hash = hash;
        assert.deepEqual({ ...runtime.parseRoute() }, {
            page: 'list', listQuery: '', listPath: '', shortId: expectedId
        });
        runtime.handleRoute();
        const { page, context } = renders.at(-1);
        assert.equal(page, 'list');
        assert.equal(context.shortId, expectedId);
        assert.equal(runtime.isRouteContextCurrent(context, 'list'), true, hash);
        assert.equal(runtime.isRouteContextCurrent(context, 'home'), false, hash);
        if (previousContext) assert.equal(runtime.isRouteContextCurrent(previousContext, 'list'), false, hash);
        previousContext = context;
    }
    assert.equal(renders.length, 3);
});

test('creating a short route sends one POST and caches the result', async t => {
    const fetch = t.mock.fn(async () => Response.json({ id: shortId, route: `s/${shortId}` }, { status: 201 }));
    const { createShortSharedListRoute } = loadFrontend({ fetch });
    const createRoute = () => createShortSharedListRoute(payload.title, frontendItems);

    assert.deepEqual(await Promise.all([createRoute(), createRoute()]), [`s/${shortId}`, `s/${shortId}`]);
    assert.equal(await createRoute(), `s/${shortId}`);
    assert.equal(fetch.mock.callCount(), 1);
    const [url, options] = fetch.mock.calls[0].arguments;
    assert.equal(url, endpoint);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { title: canonicalRecord.t, items: frontendItems });
});

for (const status of [404, 429, 500]) {
    test(`creating a short route falls back to the full shared-list route on HTTP ${status}`, async t => {
        const fetch = t.mock.fn(async () => new Response(null, { status }));
        const { createShortSharedListRoute, buildSharedListRoute } = loadFrontend({ fetch });
        const fallbackRoute = buildSharedListRoute(payload.title, frontendItems);

        assert.match(fallbackRoute, /^secki\//);
        assert.equal(await createShortSharedListRoute(payload.title, frontendItems), fallbackRoute);
        assert.equal(fetch.mock.callCount(), 1);
    });
}

test('creating a short route falls back on a network error or a file: page', async t => {
    const fetch = t.mock.fn(async () => { throw new TypeError('Network request failed'); });

    for (const [protocol, expectedCalls] of [['https:', 1], ['file:', 0]]) {
        fetch.mock.resetCalls();
        const { createShortSharedListRoute, buildSharedListRoute } = loadFrontend({ fetch, protocol });
        const fallbackRoute = buildSharedListRoute(payload.title, frontendItems);

        assert.match(fallbackRoute, /^secki\//);
        assert.equal(await createShortSharedListRoute(payload.title, frontendItems), fallbackRoute, protocol);
        assert.equal(fetch.mock.callCount(), expectedCalls, protocol);
    }
});

test('resolving a short route decodes the GET response and caches the list', async t => {
    const fetch = t.mock.fn(async () => Response.json({ v: 1, id: shortId, title: payload.title, items: frontendItems }));
    const { resolveShortSharedList } = loadFrontend({ fetch });
    const signal = new AbortController().signal;
    const expected = {
        ok: true,
        title: canonicalRecord.t,
        hasCustomTitle: true,
        items: [
            { id: 550, mediaType: 'movie', key: 'movie:550', token: 'm550' },
            { id: 1396, mediaType: 'tv', key: 'tv:1396', token: 't1396' }
        ]
    };

    assert.deepEqual(structuredClone(await resolveShortSharedList(shortId, signal)), expected);
    assert.deepEqual(structuredClone(await resolveShortSharedList(shortId)), expected);
    assert.equal(fetch.mock.callCount(), 1);
    const [url, options] = fetch.mock.calls[0].arguments;
    assert.equal(url, `${endpoint}?id=${shortId}`);
    assert.equal(options.method ?? 'GET', 'GET');
    assert.equal(options.signal, signal);
});

test('resolving a missing short route returns notFound', async t => {
    const fetch = t.mock.fn(async () => new Response(null, { status: 404 }));
    const { resolveShortSharedList } = loadFrontend({ fetch });

    assert.deepEqual({ ...await resolveShortSharedList(shortId) }, { ok: false, notFound: true });
    assert.equal(fetch.mock.callCount(), 1);
});

test('invalid short IDs are rejected locally or fall back when returned by POST', async t => {
    const invalidId = 'abc-123';
    const fetch = t.mock.fn(async () => Response.json({ id: invalidId }, { status: 201 }));
    const { resolveShortSharedList, createShortSharedListRoute, buildSharedListRoute } = loadFrontend({ fetch });

    for (const value of [undefined, '', 'short', invalidId, 'longerthan12c', 123456]) {
        assert.deepEqual({ ...await resolveShortSharedList(value) }, { notFound: true, invalid: true });
    }
    assert.equal(fetch.mock.callCount(), 0);

    const fallbackRoute = buildSharedListRoute(payload.title, frontendItems);
    assert.match(fallbackRoute, /^secki\//);
    assert.equal(await createShortSharedListRoute(payload.title, frontendItems, invalidId), fallbackRoute);
    assert.equal(fetch.mock.callCount(), 1);
});
