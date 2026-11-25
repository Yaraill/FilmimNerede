const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const puppeteer = require('puppeteer');
const tmdbFunction = require('../netlify/functions/tmdb');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

/**
 * Node zlib.deflateRawSync kullanarak Stored veya Deflate ZIP arşivi üretir.
 */
function buildTestZipBuffer(entries) {
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        crcTable[i] = c >>> 0;
    }
    const crc32 = buf => {
        let c = 0xffffffff;
        for (let i = 0; i < buf.length; i++) {
            c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
        }
        return (c ^ 0xffffffff) >>> 0;
    };

    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const rawBuf = Buffer.from(entry.content, 'utf8');
        const method = entry.store ? 0 : 8;
        const compBuf = method === 0 ? rawBuf : zlib.deflateRawSync(rawBuf);
        const crc = crc32(rawBuf);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(compBuf.length, 18);
        localHeader.writeUInt32LE(rawBuf.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localChunks.push(localHeader, nameBuf, compBuf);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(method, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(compBuf.length, 20);
        centralHeader.writeUInt32LE(rawBuf.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralChunks.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + compBuf.length;
    }

    const centralDirBuf = Buffer.concat(centralChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localChunks, centralDirBuf, eocd]);
}

function loadImporterVm(overrides = {}) {
    const context = vm.createContext({
        window: { movieCache: {}, location: { hash: '', origin: 'http://127.0.0.1' } },
        BASE_URL: 'https://api.themoviedb.org/3',
        IMAGE_BASE: 'https://image.tmdb.org/t/p/w500',
        AbortController,
        URLSearchParams,
        TextDecoder,
        DecompressionStream,
        setTimeout,
        clearTimeout,
        fetch: overrides.fetch || (async () => { throw new Error('Mock fetch not configured'); }),
        ...overrides
    });
    for (const script of ['security.js', 'profile.js', 'importer.js']) {
        const filename = require.resolve(`../js/runtime/${script}`);
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    }
    return context;
}

function readCspHeader() {
    const toml = fs.readFileSync(path.join(ROOT_DIR, 'netlify.toml'), 'utf8');
    const match = toml.match(/Content-Security-Policy\s*=\s*"""([\s\S]*?)"""/);
    assert.ok(match, 'netlify.toml içinde CSP bulunmalı');
    return match[1].replace(/\\[ \t]*\r?\n[ \t\r\n]*/g, '').replace(/^\r?\n/, '').trim();
}

function createMockTmdbResponse(upstreamPath) {
    const parsed = new URL(upstreamPath, 'https://api.themoviedb.org');

    if (parsed.pathname === '/3/find/tt0137523') {
        return {
            movie_results: [{
                id: 550,
                title: 'Dövüş Kulübü',
                original_title: 'Fight Club',
                release_date: '1999-10-15',
                poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
                vote_average: 8.4,
                genre_ids: [18]
            }],
            tv_results: []
        };
    }

    if (parsed.pathname === '/3/find/tt0903747') {
        return {
            movie_results: [],
            tv_results: [{
                id: 1396,
                name: 'Breaking Bad',
                original_name: 'Breaking Bad',
                first_air_date: '2008-01-20',
                poster_path: '/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
                vote_average: 8.9,
                genre_ids: [18, 80]
            }]
        };
    }

    if (parsed.pathname === '/3/find/tt9999999') {
        return { movie_results: [], tv_results: [] };
    }

    if (parsed.pathname === '/3/search/movie') {
        const query = (parsed.searchParams.get('query') || '').toLowerCase();
        const year = parsed.searchParams.get('primary_release_year');
        if (query === 'the matrix' && year === '1999') {
            return {
                results: [{
                    id: 603,
                    title: 'Matrix',
                    original_title: 'The Matrix',
                    release_date: '1999-03-31',
                    poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
                    vote_average: 8.2,
                    vote_count: 25000,
                    genre_ids: [28, 878]
                }]
            };
        }
        return { results: [] };
    }

    if (parsed.pathname === '/3/search/multi') {
        const query = (parsed.searchParams.get('query') || '').toLowerCase();
        if (query === 'chernobyl') {
            return {
                results: [{
                    id: 87108,
                    media_type: 'tv',
                    name: 'Chernobyl',
                    original_name: 'Chernobyl',
                    first_air_date: '2019-05-06',
                    poster_path: '/hlLXt2tOPT6RRnjiUmoxyG1LTFi.jpg',
                    vote_average: 8.7,
                    vote_count: 6500,
                    genre_ids: [18, 36]
                }]
            };
        }
        if (query === 'parasite') {
            const lang = parsed.searchParams.get('language');
            if (lang === 'en-US') {
                return {
                    results: [{
                        id: 496243,
                        media_type: 'movie',
                        title: 'Parasite',
                        original_title: 'Gisaengchung',
                        release_date: '2019-05-30',
                        poster_path: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
                        vote_average: 8.5,
                        vote_count: 18000,
                        genre_ids: [35, 53, 18]
                    }]
                };
            }
            return {
                results: [
                    {
                        id: 999123,
                        media_type: 'movie',
                        title: 'Parasites',
                        original_title: 'Parasites',
                        release_date: '2019-01-01',
                        poster_path: '/wrong.jpg',
                        vote_average: 4.5,
                        vote_count: 20,
                        genre_ids: [27]
                    },
                    {
                        id: 496243,
                        media_type: 'movie',
                        title: 'Parazit',
                        original_title: 'Gisaengchung',
                        release_date: '2019-05-30',
                        poster_path: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg',
                        vote_average: 8.5,
                        vote_count: 18000,
                        genre_ids: [35, 53, 18]
                    }
                ]
            };
        }
        if (query === 'suspiria') {
            return {
                results: [
                    {
                        id: 11906,
                        media_type: 'movie',
                        title: 'Suspiria',
                        original_title: 'Suspiria',
                        release_date: '1977-02-01',
                        poster_path: '/5Ya3H8J4D7E.jpg',
                        vote_average: 7.4,
                        vote_count: 3000,
                        genre_ids: [27]
                    },
                    {
                        id: 399360,
                        media_type: 'movie',
                        title: 'Suspiria',
                        original_title: 'Suspiria',
                        release_date: '2018-10-26',
                        poster_path: '/k2fP9H8J4D7E.jpg',
                        vote_average: 6.9,
                        vote_count: 2800,
                        genre_ids: [27, 9648]
                    }
                ]
            };
        }
        if (query === 'dövüş kulübü' || query === 'fight club') {
            return {
                results: [{
                    id: 550,
                    media_type: 'movie',
                    title: 'Dövüş Kulübü',
                    original_title: 'Fight Club',
                    release_date: '1999-10-15',
                    poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
                    vote_average: 8.4,
                    vote_count: 29000,
                    genre_ids: [18]
                }]
            };
        }
        if (query === 'matrix') {
            return {
                results: [{
                    id: 603,
                    media_type: 'movie',
                    title: 'Matrix',
                    original_title: 'The Matrix',
                    release_date: '1999-03-31',
                    poster_path: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
                    vote_average: 8.2,
                    vote_count: 25000,
                    genre_ids: [28, 878]
                }]
            };
        }
        return { results: [] };
    }

    if (/^\/3\/genre\/(movie|tv)\/list$/.test(parsed.pathname)) {
        return { genres: [{ id: 18, name: 'Dram' }, { id: 878, name: 'Bilim Kurgu' }] };
    }

    if (parsed.pathname.endsWith('/watch/providers')) {
        return { results: { TR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png' }] } } };
    }

    if (parsed.pathname === '/3/movie/603' || parsed.pathname === '/3/movie/550') {
        return { id: parsed.pathname.endsWith('603') ? 603 : 550, runtime: 136 };
    }

    if (parsed.pathname === '/3/tv/1396' || parsed.pathname === '/3/tv/87108') {
        return { id: parsed.pathname.endsWith('1396') ? 1396 : 87108, episode_run_time: [50], number_of_episodes: 5 };
    }

    return { page: 1, total_pages: 1, results: [] };
}

async function runUnitTests() {
    console.log('1) Running CSV, ZIP, matching and rate-limit unit tests...');
    const runtime = loadImporterVm();

    // RFC 4180 CSV test (BOM + quotes + commas + escaped quotes + multiline + Turkish)
    const sampleCsv = '\uFEFFName,Year,Notes\r\n"Şölen, Büyük",2024,"Line 1 ""Alıntı""\r\nLine 2"\r\n\r\n"İstanbul",1999,Normal';
    const rows = structuredClone(runtime.parseCsvRows(sampleCsv));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], ['Name', 'Year', 'Notes']);
    assert.deepEqual(rows[1], ['Şölen, Büyük', '2024', 'Line 1 "Alıntı"\r\nLine 2']);
    assert.deepEqual(rows[2], ['İstanbul', '1999', 'Normal']);

    // ZIP extraction + Zip-Slip rejection + __MACOSX skip
    const zipBuf = buildTestZipBuffer([
        { name: '__MACOSX/._ratings.csv', content: 'junk' },
        { name: 'letterboxd-user/comments.csv', content: 'Comment\nhi' },
        { name: 'letterboxd-user/ratings.csv', content: 'Date,Name,Year,Letterboxd URI,Rating\n2026-01-01,The Matrix,1999,https://boxd.it/1,4.5' },
        { name: 'letterboxd-user/lists/favori-klasikler.csv', content: 'Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2026-01-01,Gece Seçkisi,,https://boxd.it/l,Test\n\nPosition,Name,Year,URL,Description\n1,The Matrix,1999,https://boxd.it/1,' }
    ]);
    const extracted = await runtime.extractZipCsvEntries(zipBuf.buffer.slice(zipBuf.byteOffset, zipBuf.byteOffset + zipBuf.byteLength));
    assert.equal(extracted.length, 2);
    assert.equal(extracted[0].name, 'ratings.csv');
    assert.equal(extracted[1].name, 'lists/favori-klasikler.csv');

    const evilZip = buildTestZipBuffer([{ name: '../evil.csv', content: 'x,y\n1,2' }]);
    await assert.rejects(
        () => runtime.extractZipCsvEntries(evilZip.buffer.slice(evilZip.byteOffset, evilZip.byteOffset + evilZip.byteLength)),
        /geçersiz yol segmenti|güvensiz/i
    );

    // Format parsing + dedup + rating conversion + 30-item list limit + tvEpisode skip
    const imdbRatingsCsv = [
        'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date',
        'tt0137523,9,2026-01-01,Dövüş Kulübü,Fight Club,https://imdb.com/title/tt0137523/,Movie,8.8,139,1999,Drama,2000000,1999-10-15',
        'tt0903747,10,2026-01-02,Breaking Bad,Breaking Bad,https://imdb.com/title/tt0903747/,TV Series,9.5,45,2008,Crime,2100000,2008-01-20',
        'tt0959621,8,2026-01-03,Ozymandias,Ozymandias,https://imdb.com/title/tt0959621/,TV Episode,10,47,2013,Drama,200000,2013-09-15'
    ].join('\n');
    const imdbWatchlistCsv = [
        'Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date',
        '1,tt0137523,2026-01-01,2026-01-01,,Dövüş Kulübü,Fight Club,https://imdb.com/title/tt0137523/,Movie,8.8,139,1999,Drama,2000000,1999-10-15'
    ].join('\n');
    const lbRatingsCsv = 'Date,Name,Year,Letterboxd URI,Rating\n2026-01-01,Half Star,2020,https://boxd.it/a,0.5\n2026-01-01,Three Half,2020,https://boxd.it/b,3.5';

    const parsed = runtime.parseImportFiles([
        { name: 'ratings.csv', text: imdbRatingsCsv },
        { name: 'watchlist.csv', text: imdbWatchlistCsv },
        { name: 'lb_ratings.csv', text: lbRatingsCsv }
    ]);
    assert.equal(parsed.stats.skippedEpisodes, 1, 'tvEpisode atlanmalı');
    assert.equal(parsed.items.length, 4, 'tt0137523 iki dosyada da olsa tek kayda birleşmeli');
    const fc = parsed.items.find(i => i.imdbId === 'tt0137523');
    assert.equal(fc.rating, 9);
    assert.equal(fc.imdbRating, '8.8', 'IMDb CSV IMDb Rating sütunu yakalanmalı');
    assert.equal(fc.inWatchlist, true);
    const half = parsed.items.find(i => i.title === 'Half Star');
    const threeHalf = parsed.items.find(i => i.title === 'Three Half');
    assert.equal(half.rating, 1);
    assert.equal(threeHalf.rating, 7);

    // 429 Retry-After recovery + AbortController cancellation test
    let attemptCount = 0;
    let waitCallbacks = 0;
    const retryRuntime = loadImporterVm({
        setTimeout: (fn, _ms) => {
            fn();
            return 1;
        },
        fetch: async url => {
            attemptCount += 1;
            if (attemptCount === 1) {
                return new Response(JSON.stringify({ error: 'rate limit' }), {
                    status: 429,
                    headers: { 'Retry-After': '1' }
                });
            }
            const parsedUrl = new URL(url);
            return Response.json(createMockTmdbResponse(parsedUrl.pathname + parsedUrl.search));
        }
    });
    const retriedResult = await retryRuntime.resolveImportEntry(
        { key: 'imdb:tt0137523', imdbId: 'tt0137523', title: 'Fight Club', year: 1999, mediaHint: 'movie' },
        new AbortController().signal,
        sec => { waitCallbacks += sec; }
    );
    assert.equal(attemptCount, 2);
    assert.equal(waitCallbacks, 1);
    assert.equal(retriedResult.status, 'matched');
    assert.equal(retriedResult.selectedKey, 'movie:550');

    const abortController = new AbortController();
    abortController.abort();
    await assert.rejects(
        () => retryRuntime.resolveImportEntry(
            { key: 'imdb:tt0903747', imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, mediaHint: 'tv' },
            abortController.signal
        ),
        { name: 'AbortError' }
    );

    // providers.js 429 Retry-After queue backoff & recovery test
    let providerCalls = 0;
    const provWindow = {
        movieCache: {},
        location: { hash: '#profile', origin: 'http://127.0.0.1' },
        innerHeight: 900,
        innerWidth: 1280
    };
    const provContext = vm.createContext({
        window: provWindow,
        BASE_URL: 'https://api.themoviedb.org/3',
        IMAGE_BASE: 'https://image.tmdb.org/t/p/w500',
        AbortController,
        URLSearchParams,
        document: {
            querySelectorAll: () => [],
            getElementById: () => null
        },
        normalizeTmdbId: v => Number(v) || null,
        normalizeMediaType: (v, f) => (v === 'movie' || v === 'tv' ? v : f || null),
        inferItemMediaType: (_it, f) => f || 'movie',
        getSafeTmdbImageUrl: p => p || 'assets/placeholder.svg',
        isRouteContextCurrent: () => true,
        parseRoute: () => ({ page: 'profile' }),
        isMyPlatformsModeActive: () => false,
        getSubscribedProviderIds: () => [],
        queueMicrotask: fn => Promise.resolve().then(fn),
        setTimeout: (fn, _ms) => {
            Promise.resolve().then(fn);
            return 1;
        },
        clearTimeout: () => {},
        fetch: async () => {
            providerCalls += 1;
            if (providerCalls === 1) {
                return new Response(JSON.stringify({ error: '429' }), {
                    status: 429,
                    headers: { 'Retry-After': '1' }
                });
            }
            return Response.json({
                id: 550,
                results: { TR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/nf.png' }] } }
            });
        }
    });
    const provFilename = require.resolve('../js/runtime/providers.js');
    vm.runInContext(fs.readFileSync(provFilename, 'utf8'), provContext, { filename: provFilename });
    const providerPayload = await provContext.enqueueProviderFetch(
        'movie:550',
        'https://api.themoviedb.org/3/movie/550/watch/providers',
        [],
        null
    );
    assert.equal(providerCalls, 2, 'providers.js 429 sonrası Retry-After ile tekrar denemeli');
    assert.equal(providerPayload.results.TR.flatrate[0].provider_id, 8);

    const hydrateCtx = vm.createContext({
        window: provWindow,
        BASE_URL: 'https://api.themoviedb.org/3',
        IMAGE_BASE: 'https://image.tmdb.org/t/p/w500',
        AbortController,
        URLSearchParams,
        document: {
            querySelectorAll: () => [],
            getElementById: () => null
        },
        normalizeTmdbId: v => Number(v) || null,
        normalizeMediaType: (v, f) => (v === 'movie' || v === 'tv' ? v : f || null),
        inferItemMediaType: (_it, f) => f || 'movie',
        getSafeTmdbImageUrl: p => p || 'assets/placeholder.svg',
        isRouteContextCurrent: () => true,
        parseRoute: () => ({ page: 'profile' }),
        isMyPlatformsModeActive: () => false,
        getSubscribedProviderIds: () => [],
        escapeHtml: v => String(v ?? ''),
        escapeAttr: v => String(v ?? ''),
        localStorage: {
            getItem: key => key === 'filmimnerede_provider_cache_v1'
                ? JSON.stringify({
                    v: 1,
                    entries: [['movie:550', Date.now(), { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/nf.png' }] }]]
                })
                : null,
            setItem: () => {}
        }
    });
    vm.runInContext(fs.readFileSync(provFilename, 'utf8'), hydrateCtx, { filename: provFilename });
    const syncHtml = hydrateCtx.getSyncCachedProvidersHtml(550, 'movie');
    assert.ok(typeof syncHtml === 'string' && syncHtml.includes('Netflix') && syncHtml.includes('provider-logo'), 'Persisted cache senkron logo HTML üretmeli');

    console.log('✓ Unit tests passed.');
}

async function runBrowserTests() {
    console.log('2) Running Puppeteer E2E import tests with enforced CSP...');
    const cspHeader = readCspHeader();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filmimnerede-import-'));
    let server;
    let browser;

    try {
        server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname === '/.netlify/functions/tmdb') {
                if (url.searchParams.get('probe') === '1') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ ok: true, service: 'tmdb-proxy' }));
                }
                if (url.searchParams.get('target') === 'image') {
                    res.writeHead(200, { 'Content-Type': 'image/png' });
                    return res.end(PIXEL);
                }
                const tmdbPath = url.searchParams.get('path') || '';
                const validation = tmdbFunction.validateTmdbTargetAndPath('api', tmdbPath);
                if (!validation.valid) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: validation.error }));
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify(createMockTmdbResponse(tmdbPath)));
            }
            if (url.pathname === '/.netlify/functions/omdb') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ imdbRating: '8.8' }));
            }
            if (url.pathname === '/favicon.ico') {
                res.writeHead(204);
                return res.end();
            }
            const rel = url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`;
            const file = path.resolve(ROOT_DIR, rel);
            const ext = path.extname(file).toLowerCase();
            if (!file.startsWith(ROOT_DIR + path.sep) || !MIME_TYPES[ext] || !fs.existsSync(file)) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, {
                ...(ext === '.html' ? { 'Content-Security-Policy': cspHeader } : {}),
                'Content-Type': MIME_TYPES[ext]
            });
            res.end(fs.readFileSync(file));
        });

        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        await page.setBypassServiceWorker(true);

        const pageErrors = [];
        const cspViolations = [];
        page.on('pageerror', err => pageErrors.push(err.message));
        await page.evaluateOnNewDocument(() => {
            window.__cspViolations = [];
            document.addEventListener('securitypolicyviolation', e => window.__cspViolations.push(e.violatedDirective));
        });

        await page.goto(`http://127.0.0.1:${port}/#profile`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#external-import-btn', { visible: true, timeout: 10000 });

        // 1) IMDb CSV import (with movie, tvSeries, tvEpisode skipped, and fallback-by-title)
        const imdbCsvPath = path.join(tempDir, 'imdb_ratings.csv');
        fs.writeFileSync(imdbCsvPath, [
            'Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date',
            'tt0137523,9,2026-01-01,Dövüş Kulübü,Fight Club,https://imdb.com/title/tt0137523/,Movie,8.8,139,1999,Drama,2000000,1999-10-15',
            'tt0903747,10,2026-01-02,Breaking Bad,Breaking Bad,https://imdb.com/title/tt0903747/,TV Series,9.5,45,2008,Crime,2100000,2008-01-20',
            'tt0959621,8,2026-01-03,Ozymandias,Ozymandias,https://imdb.com/title/tt0959621/,TV Episode,10,47,2013,Drama,200000,2013-09-15',
            'tt9999999,8,2026-01-04,The Matrix,The Matrix,https://imdb.com/title/tt9999999/,Movie,8.7,136,1999,Sci-Fi,2000000,1999-03-31'
        ].join('\n'), 'utf8');

        await (await page.$('#external-import-file')).uploadFile(imdbCsvPath);
        await page.waitForSelector('#external-import-modal.active #external-import-preview-section:not([hidden])', { timeout: 10000 });

        const imdbSummary = await page.$eval('#external-import-summary', el => el.textContent);
        const progressHiddenInPreview = await page.$eval(
            '#external-import-progress-section',
            el => getComputedStyle(el).display === 'none'
        );
        assert.equal(progressHiddenInPreview, true, 'Önizleme açıkken ilerleme bölümü CSS ile gizlenmeli');
        assert.match(imdbSummary, /3/);
        assert.match(imdbSummary, /tvEpisode.*atlandı/i);

        await page.click('#external-import-confirm-btn');
        await page.waitForSelector('#external-import-modal.active', { hidden: true, timeout: 5000 });

        const afterImdb = await page.evaluate(() => ({
            ratings: JSON.parse(localStorage.getItem('movieRatings') || '{}'),
            ratedMovies: JSON.parse(localStorage.getItem('ratedMovies') || '[]'),
            status: document.getElementById('external-import-status')?.textContent || ''
        }));
        assert.equal(afterImdb.ratings['movie:550'], 9);
        assert.equal(afterImdb.ratings['tv:1396'], 10);
        assert.equal(afterImdb.ratings['movie:603'], 8);
        assert.equal(afterImdb.ratedMovies.length, 3);
        assert.match(afterImdb.status, /3 puan/);

        // 2) Letterboxd ZIP import (DeflateStream, 3 stages, ambiguous 2018 selection, watched without fake rating, lists->Seçkilerim, keep vs overwrite)
        const lbZipPath = path.join(tempDir, 'letterboxd-export.zip');
        const lbZipBuffer = buildTestZipBuffer([
            {
                name: 'letterboxd-export/ratings.csv',
                content: [
                    'Date,Name,Year,Letterboxd URI,Rating',
                    '2026-01-01,The Matrix,1999,https://boxd.it/1,5',
                    '2026-01-02,Chernobyl,2018,https://boxd.it/2,4.5',
                    '2026-01-03,Suspiria,1990,https://boxd.it/3,4',
                    '2026-01-04,Böyle Bir Film Hiç Yok,1922,https://boxd.it/4,3'
                ].join('\n')
            },
            {
                name: 'letterboxd-export/watchlist.csv',
                content: 'Date,Name,Year,Letterboxd URI\n2026-01-05,Parasite,2019,https://boxd.it/5'
            },
            {
                name: 'letterboxd-export/watched.csv',
                content: 'Date,Name,Year,Letterboxd URI\n2026-01-06,Parasite,2019,https://boxd.it/5'
            },
            {
                name: 'letterboxd-export/lists/gece-seckisi.csv',
                content: [
                    'Letterboxd list export v7',
                    'Date,Name,Tags,URL,Description',
                    '2026-01-07,Gece Seçkisi,,https://boxd.it/list,Deneme',
                    '',
                    'Position,Name,Year,URL,Description',
                    '1,The Matrix,1999,https://boxd.it/1,',
                    '2,Parasite,2019,https://boxd.it/5,'
                ].join('\n')
            }
        ]);
        fs.writeFileSync(lbZipPath, lbZipBuffer);

        await (await page.$('#external-import-file')).uploadFile(lbZipPath);
        await page.waitForSelector('#external-import-modal.active #external-import-preview-section:not([hidden])', { timeout: 10000 });

        // Keep mode default: The Matrix stays 8 (from IMDb), hover ambiguous Suspiria poster preview, then select 2018 (399360)
        await page.evaluate(() => {
            const label = document.querySelector('#external-import-ambiguous-list .external-import-candidate-option:not(.is-skip)');
            if (label) {
                label.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            }
        });
        const previewState = await page.evaluate(() => {
            const box = document.getElementById('external-import-poster-preview');
            const img = box?.querySelector('img');
            return {
                hidden: box?.hidden,
                src: img?.getAttribute('src') || '',
                text: box?.textContent || ''
            };
        });
        assert.equal(previewState.hidden, false, 'Belirsiz aday hover edilince büyük afiş kutusu açılmalı');
        assert.match(previewState.src, /w342/, 'Büyütülen afiş w342 yüksek çözünürlüklü olmalı');
        assert.match(previewState.text, /Suspiria/i);

        await page.evaluate(() => {
            const target = document.querySelector('#external-import-ambiguous-list input[type="radio"][value="movie:399360"]');
            if (target) {
                target.click();
            }
        });

        await page.click('#external-import-confirm-btn');
        await page.waitForSelector('#external-import-modal.active', { hidden: true, timeout: 5000 });

        const afterKeep = await page.evaluate(() => ({
            ratings: JSON.parse(localStorage.getItem('movieRatings') || '{}'),
            watchlist: JSON.parse(localStorage.getItem('watchlist') || '[]'),
            ratedMovies: JSON.parse(localStorage.getItem('ratedMovies') || '[]'),
            savedLists: JSON.parse(localStorage.getItem('savedSharedLists') || '[]'),
            validBackup: (() => {
                window.validateProfileBackupPayload(window.createProfileBackupPayload());
                return true;
            })()
        }));

        assert.equal(afterKeep.ratings['movie:603'], 8, 'keep modu mevcut 8 puanı korumalı');
        assert.equal(afterKeep.ratings['movie:399360'], 8, 'Belirsiz listeden seçilen Suspiria (2018) puanı eklenmeli');
        assert.equal(afterKeep.ratings['tv:87108'], 9, 'Chernobyl (±1 yıl & mini dizi) TV olarak aktarılmalı');
        assert.equal(afterKeep.ratings['movie:496243'], undefined, 'Puansız watched öğesi için sahte puan yazılmamalı');
        assert.ok(afterKeep.watchlist.some(w => w.id === 496243), 'Parasite watchlist’e eklenmeli');
        assert.ok(afterKeep.ratedMovies.some(r => r.id === 496243), 'Puansız watched öğesi ratedMovies geçmişine eklenmeli');
        assert.equal(afterKeep.savedLists.length, 1);
        assert.equal(afterKeep.savedLists[0].title, 'Gece Seçkisi');
        assert.equal(afterKeep.savedLists[0].items.length, 2);
        assert.equal(afterKeep.validBackup, true);

        // Overwrite mode + mobile 390px + light theme + Escape modal close
        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate(() => {
            if (typeof syncThemeState === 'function') syncThemeState(true);
        });
        await (await page.$('#external-import-file')).uploadFile(lbZipPath);
        await page.waitForSelector('#external-import-modal.active #external-import-preview-section:not([hidden])', { timeout: 10000 });

        const overflowCheck = await page.evaluate(() => ({
            docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            modalBg: getComputedStyle(document.querySelector('#external-import-modal .external-import-modal-content')).backgroundColor
        }));
        assert.equal(overflowCheck.docOverflow, false, '390px mobilde yatay taşma olmamalı');
        assert.equal(overflowCheck.modalBg, 'rgb(255, 255, 255)', 'Light theme modal zemini opak beyaz olmalı');

        await page.select('#external-import-conflict-mode', 'overwrite');
        await page.click('#external-import-confirm-btn');
        await page.waitForSelector('#external-import-modal.active', { hidden: true, timeout: 5000 });

        const afterOverwrite = await page.evaluate(() => JSON.parse(localStorage.getItem('movieRatings') || '{}'));
        assert.equal(afterOverwrite['movie:603'], 10, 'overwrite modu The Matrix puanını 10 yapmalı');

        // Reopen briefly and close with Escape to test ModalManager inert cleanup
        await (await page.$('#external-import-file')).uploadFile(imdbCsvPath);
        await page.waitForSelector('#external-import-modal.active', { timeout: 10000 });
        await page.keyboard.press('Escape');
        await page.waitForSelector('#external-import-modal.active', { hidden: true, timeout: 5000 });
        const modalAria = await page.$eval('#external-import-modal', el => ({
            inert: el.inert,
            hidden: el.getAttribute('aria-hidden')
        }));
        assert.equal(modalAria.inert, true);
        assert.equal(modalAria.hidden, 'true');

        // 3) Profile toolbar: 28-item pagination, search, media filter, sort & inactive tab defer
        await page.setViewport({ width: 1280, height: 900 });
        await page.evaluate(() => {
            const items = [];
            for (let i = 1; i <= 35; i++) {
                items.push({
                    id: 7000 + i,
                    media_type: i % 5 === 0 ? 'tv' : 'movie',
                    title: i === 12 ? 'Özel Arama Hedefi' : `Test Yapım ${i}`,
                    name: i === 12 ? 'Özel Arama Hedefi' : `Test Yapım ${i}`,
                    release_date: `${1990 + (i % 30)}-05-01`,
                    first_air_date: i % 5 === 0 ? `${1990 + (i % 30)}-05-01` : '',
                    poster_path: '/testPoster.jpg',
                    vote_average: 7.5
                });
            }
            localStorage.setItem('watchlist', JSON.stringify(items));
            if (typeof loadProfile === 'function') loadProfile();
        });

        const initialPageCount = await page.$$eval('#watchlist-grid .movie-card', cards => cards.length);
        assert.equal(initialPageCount, 28, 'Watchlist ilk açılışta en fazla 28 kart göstermeli');
        const profileTabsLayout = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('.profile-tabs .profile-tab-btn'));
            const tops = btns.map(btn => Math.round(btn.getBoundingClientRect().top));
            return {
                tab0Text: btns[0]?.textContent?.trim() || '',
                rowSpreadPx: tops.length ? Math.max(...tops) - Math.min(...tops) : 999,
                hasScoreSort: Boolean(document.querySelector('#watchlist-sort-select option[value="score-desc"]')),
                hasOldTmdbOption: Boolean(document.querySelector('#watchlist-sort-select option[value="tmdb-desc"]'))
            };
        });
        assert.equal(profileTabsLayout.tab0Text, 'İzleme Listesi (35)', 'İlk sekme İzleme Listesi olmalı');
        assert.ok(profileTabsLayout.rowSpreadPx <= 2, `1280px masaüstünde tüm profil sekmeleri tek satırda kalmalı (fark=${profileTabsLayout.rowSpreadPx})`);
        assert.equal(profileTabsLayout.hasScoreSort, true, 'IMDb / Genel Puan sıralaması bulunmalı');
        assert.equal(profileTabsLayout.hasOldTmdbOption, false, 'Eski tmdb-desc seçeneği kaldırılmalı');

        // Persistent TR provider cache sync render test (7034 is a movie in recent top 28)
        const syncProviderCheck = await page.evaluate(() => {
            if (typeof setCachedProviderData === 'function') {
                setCachedProviderData('movie:7034', {
                    results: { TR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/nf.png' }] } }
                });
            }
            if (typeof loadProfile === 'function') loadProfile();
            const cachedProv = document.querySelector('#watchlist-grid .movie-card .providers-movie-7034');
            return {
                hasLogo: Boolean(cachedProv && cachedProv.querySelector('img.provider-logo')),
                hasSearchText: Boolean(cachedProv && cachedProv.textContent.includes('Platformlar aranıyor'))
            };
        });
        assert.equal(syncProviderCheck.hasLogo, true, 'Önbellekteki provider senkron şekilde logosuyla çizilmeli');
        assert.equal(syncProviderCheck.hasSearchText, false, 'Önbellekteki kartta aranıyor yazısı görünmemeli');
        const loadMoreHiddenInitial = await page.$eval('#watchlist-load-more-btn', el => el.hidden);
        assert.equal(loadMoreHiddenInitial, false, '35 öğede Daha Fazla Göster butonu görünür olmalı');

        await page.click('#watchlist-load-more-btn');
        const expandedCount = await page.$$eval('#watchlist-grid .movie-card', cards => cards.length);
        assert.equal(expandedCount, 35, 'Daha Fazla Göster sonrası tüm 35 kart yüklenmeli');
        assert.equal(await page.$eval('#watchlist-load-more-btn', el => el.hidden), true);

        await page.click('.profile-toolbar-pill[data-profile-section="watchlist"][data-profile-media="tv"]');
        const tvOnlyCount = await page.$$eval('#watchlist-grid .movie-card', cards => cards.length);
        assert.equal(tvOnlyCount, 7, 'Diziler filtresi 7 dizi göstermeli');

        await page.click('#watchlist-filter-reset-btn');
        await page.type('#watchlist-search-input', 'Özel Arama');
        await page.waitForFunction(() => document.querySelectorAll('#watchlist-grid .movie-card').length === 1);
        assert.match(await page.$eval('#watchlist-grid', el => el.textContent), /Özel Arama Hedefi/);

        const violations = await page.evaluate(() => window.__cspViolations || []);
        cspViolations.push(...violations);
        assert.deepEqual(pageErrors, [], `Beklenmeyen pageerror: ${pageErrors.join('; ')}`);
        assert.deepEqual(cspViolations, [], `CSP ihlali olmamalı: ${cspViolations.join(', ')}`);

        console.log('✓ Browser E2E import tests passed.');
    } finally {
        if (browser) await browser.close();
        if (server) await new Promise(resolve => server.close(resolve));
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

(async () => {
    await runUnitTests();
    await runBrowserTests();
    console.log('All import regression tests PASSED!');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
