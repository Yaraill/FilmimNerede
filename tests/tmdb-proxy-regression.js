const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const puppeteer = require('puppeteer');

const tmdbFunction = require('../netlify/functions/tmdb');

const ROOT_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Geçerli 1x1 şeffaf PNG baytları
const VALID_1X1_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function getBrowserExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.platform === 'win32') {
        const defaultChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        if (fs.existsSync(defaultChrome)) {
            return defaultChrome;
        }
    }
    return undefined;
}

function createMockTmdbApiPayload(upstreamPath) {
    if (upstreamPath.includes('/genre/movie/list')) {
        return {
            genres: [
                { id: 28, name: 'Aksiyon' },
                { id: 18, name: 'Dram' }
            ]
        };
    }

    if (upstreamPath.includes('/genre/tv/list')) {
        return {
            genres: [
                { id: 18, name: 'Dram' },
                { id: 80, name: 'Suç' }
            ]
        };
    }

    if (upstreamPath.includes('/watch/providers')) {
        return {
            id: 550,
            results: {
                TR: {
                    flatrate: [
                        {
                            provider_id: 8,
                            provider_name: 'Netflix',
                            logo_path: '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg'
                        }
                    ]
                }
            }
        };
    }

    if (upstreamPath.includes('/person/popular')) {
        return {
            page: 1,
            results: [
                {
                    id: 819,
                    name: 'Edward Norton',
                    known_for_department: 'Acting',
                    profile_path: '/8nytsqL59SFJTVYVrN72k6qkGgJ.jpg',
                    known_for: []
                }
            ]
        };
    }

    if (upstreamPath.includes('/collection/')) {
        return {
            id: 10,
            name: 'Örnek Koleksiyon',
            overview: 'Test koleksiyonu',
            poster_path: '/testPoster.jpg',
            backdrop_path: '/testBackdrop.jpg',
            parts: [
                {
                    id: 550,
                    title: 'Dövüş Kulübü',
                    media_type: 'movie',
                    poster_path: '/testPoster.jpg',
                    release_date: '1999-10-15',
                    vote_average: 8.4,
                    genre_ids: [18]
                }
            ]
        };
    }

    return {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
            {
                id: 550,
                title: 'Dövüş Kulübü',
                original_title: 'Fight Club',
                media_type: 'movie',
                poster_path: '/testPoster.jpg',
                backdrop_path: '/testBackdrop.jpg',
                release_date: '1999-10-15',
                vote_average: 8.4,
                genre_ids: [18]
            },
            {
                id: 1396,
                name: 'Breaking Bad',
                original_name: 'Breaking Bad',
                media_type: 'tv',
                poster_path: '/testPosterTv.jpg',
                backdrop_path: '/testBackdrop.jpg',
                first_air_date: '2008-01-20',
                vote_average: 8.9,
                genre_ids: [18, 80]
            }
        ]
    };
}

async function runHandlerUnitTests() {
    console.log('1) Running netlify/functions/tmdb.js unit & security tests...');

    const securityContext = vm.createContext({ URL });
    vm.runInContext(
        fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/security.js'), 'utf8'),
        securityContext
    );
    for (const [query, expectedPath] of [
        ['api_key=CLIENT&language=tr-TR', '/3/movie/1?language=tr-TR'],
        ['page=2&api_key=CLIENT&language=tr-TR&api_key=OTHER&page=3', '/3/movie/1?page=2&language=tr-TR&page=3'],
        ['api_key=CLIENT', '/3/movie/1']
    ]) {
        const proxyUrl = new URL(
            securityContext.buildTmdbProxyUrl('api', `https://api.themoviedb.org/3/movie/1?${query}`),
            'https://example.com'
        );
        assert(proxyUrl.searchParams.get('path') === expectedPath, 'Proxy yolu anahtarı kaldırmalı, diğer parametrelerin sırasını korumalı');
        assert(!proxyUrl.href.includes('api_key') && !proxyUrl.href.includes('CLIENT'), 'İstemci anahtarı proxy URL içinde bulunmamalı');
    }

    // Sinkhole ve IPv4 doğrulama
    assert(tmdbFunction.isSinkholeIp('127.0.0.1'), '127.0.0.1 sinkhole olarak işaretlenmeli');
    assert(tmdbFunction.isSinkholeIp('::1'), '::1 sinkhole olarak işaretlenmeli');
    assert(tmdbFunction.isSinkholeIp('0.0.0.0'), '0.0.0.0 sinkhole olarak işaretlenmeli');
    assert(tmdbFunction.isSinkholeIp('10.0.0.1'), '10/8 özel IP sinkhole olarak işaretlenmeli');
    assert(tmdbFunction.isSinkholeIp('192.168.1.1'), '192.168/16 özel IP sinkhole olarak işaretlenmeli');
    assert(tmdbFunction.isSinkholeIp('::ffff:10.0.0.1'), '::ffff:10/8 sinkhole olarak işaretlenmeli');
    assert(!tmdbFunction.isSinkholeIp('3.160.57.74'), 'Genel IP sinkhole olmamalı');
    assert(tmdbFunction.isValidPublicIpv4('79.127.134.129'), 'Genel IPv4 geçerli olmalı');
    assert(!tmdbFunction.isValidPublicIpv4('127.0.0.1'), 'Loopback IPv4 reddedilmeli');
    assert(!tmdbFunction.isValidPublicIpv4('999.1.1.1'), 'Bozuk IPv4 reddedilmeli');

    const nonPublicIpv4List = [
        '0.0.0.0',
        '0.10.0.1',
        '10.0.0.1',
        '10.255.255.254',
        '100.64.0.1',
        '100.127.255.254',
        '127.0.0.1',
        '127.12.34.56',
        '169.254.0.1',
        '169.254.169.254',
        '172.16.0.1',
        '172.31.255.254',
        '192.168.0.1',
        '192.168.255.254',
        '224.0.0.1',
        '240.0.0.1',
        '255.255.255.255'
    ];
    for (const ip of nonPublicIpv4List) {
        assert(!tmdbFunction.isValidPublicIpv4(ip), `Özel/ayrılmış IPv4 reddedilmeliydi: ${ip}`);
    }

    const boundaryPublicIpv4List = [
        '100.63.255.254',
        '100.128.0.1',
        '172.15.255.254',
        '172.32.0.1',
        '192.167.1.1',
        '223.255.255.254'
    ];
    for (const ip of boundaryPublicIpv4List) {
        assert(tmdbFunction.isValidPublicIpv4(ip), `Sınır genel IPv4 kabul edilmeliydi: ${ip}`);
    }

    // Path ve target whitelist doğrulama
    const allowedApiPaths = [
        '/3/movie/popular?language=tr-TR',
        '/3/movie/550/watch/providers',
        '/3/tv/1396/season/1?language=tr-TR',
        '/3/person/819/combined_credits?language=tr-TR',
        '/3/search/multi?query=matrix',
        '/3/discover/movie?sort_by=popularity.desc',
        '/3/trending/all/week?language=tr-TR',
        '/3/genre/movie/list?language=tr-TR',
        '/3/collection/10?language=tr-TR',
        '/3/watch/providers/movie?language=tr-TR'
    ];
    for (const apiPath of allowedApiPaths) {
        const validApi = tmdbFunction.validateTmdbTargetAndPath('api', apiPath);
        assert(
            validApi.valid && validApi.host === 'api.themoviedb.org',
            `İzin verilen /3/ API yolu onaylanmalıydı: ${apiPath}`
        );
    }

    const validImage = tmdbFunction.validateTmdbTargetAndPath('image', '/t/p/w500/abc_123.jpg');
    assert(validImage.valid && validImage.host === 'image.tmdb.org', 'Geçerli /t/p/w500 görsel yolu onaylanmalı');

    const invalidCases = [
        ['other', '/3/movie/1'],
        ['api', ''],
        ['api', '//evil.com/3/movie/1'],
        ['api', '/3/../secret'],
        ['api', '/3/movie/../account'],
        ['api', '/3/movie/%2e%2e/account'],
        ['api', '/3/account'],
        ['api', '/3/authentication/token/new'],
        ['api', '/3/configuration'],
        ['api', '/3/list/1'],
        ['api', '/3/movie/'],
        ['api', '/4/movie/1'],
        ['image', '/t/p/w999/a.jpg'],
        ['image', '/t/p/w500/bad path.jpg']
    ];
    for (const [target, rawPath] of invalidCases) {
        const res = tmdbFunction.validateTmdbTargetAndPath(target, rawPath);
        assert(!res.valid, `Geçersiz yol reddedilmeliydi: target=${target}, path=${rawPath}`);
    }

    for (const disallowedPath of ['/3/account', '/3/authentication/token/new', '/3/movie/../account']) {
        const disallowedRes = await tmdbFunction.handler({
            httpMethod: 'GET',
            queryStringParameters: { target: 'api', path: disallowedPath }
        });
        assert(
            disallowedRes.statusCode === 400,
            `İzin verilmeyen TMDB yolu 400 dönmeli (${disallowedPath}), gelen: ${disallowedRes.statusCode}`
        );
    }

    // HTTP method ve probe kontrolleri
    const postRes = await tmdbFunction.handler({ httpMethod: 'POST', queryStringParameters: {} });
    assert(postRes.statusCode === 405, `POST isteği 405 dönmeli, gelen: ${postRes.statusCode}`);
    assert(postRes.headers?.Allow === 'GET', '405 yanıtında Allow: GET başlığı olmalı');

    const probeRes = await tmdbFunction.handler({
        httpMethod: 'GET',
        queryStringParameters: { probe: '1' }
    });
    assert(probeRes.statusCode === 200, `Probe 200 dönmeli, gelen: ${probeRes.statusCode}`);
    const probeJson = JSON.parse(probeRes.body);
    assert(probeJson.ok === true && probeJson.service === 'tmdb-proxy', 'Probe JSON beklenen yapıda değil');

    // Eksik veya boş sunucu anahtarı API'yi durdurmalı; görseller anahtarsız çalışmalı.
    const configuredApiKey = process.env.TMDB_API_KEY;
    const originalConsoleError = console.error;
    const configurationErrors = [];
    try {
        console.error = (...args) => configurationErrors.push(args);
        for (const missingKey of [undefined, '   ']) {
            if (missingKey === undefined) delete process.env.TMDB_API_KEY;
            else process.env.TMDB_API_KEY = missingKey;
            const missingKeyRes = await tmdbFunction.handler({
                httpMethod: 'GET',
                queryStringParameters: { target: 'api', path: '/3/movie/1?api_key=CLIENT' }
            }, {
                lookupImpl: async () => { throw new Error('Anahtarsız upstream çağrılmamalı'); }
            });
            assert(missingKeyRes.statusCode === 500, 'Eksik TMDB_API_KEY için API 500 dönmeli');
            assert(JSON.parse(missingKeyRes.body).error === 'TMDB servisi yapılandırılmamış.', 'Yapılandırma hatası güvenli Türkçe mesaj içermeli');
        }
        assert(configurationErrors.length === 2 && configurationErrors.every(
            args => args.length === 1 && args[0] === 'TMDB_API_KEY tanımlı değil.'
        ), 'Eksik anahtar için yalnızca sabit yapılandırma hatası günlüğe yazılmalı');

        delete process.env.TMDB_API_KEY;
        const imageWithoutKeyRes = await tmdbFunction.handler({
            httpMethod: 'GET',
            queryStringParameters: { target: 'image', path: '/t/p/w500/poster.png' }
        }, {
            lookupImpl: async () => [{ address: '79.127.134.129', family: 4 }],
            fetchImpl: async requestedUrl => {
                assert(requestedUrl === 'https://image.tmdb.org/t/p/w500/poster.png', 'Görsel upstream URL değişmemeli');
                return {
                    status: 200,
                    headers: { get: () => 'image/png' },
                    arrayBuffer: async () => VALID_1X1_PNG
                };
            }
        });
        assert(imageWithoutKeyRes.statusCode === 200 && imageWithoutKeyRes.isBase64Encoded, 'Görsel proxy TMDB_API_KEY olmadan çalışmalı');
        assert(Buffer.from(imageWithoutKeyRes.body, 'base64').equals(VALID_1X1_PNG), 'Anahtarsız görsel baytları korunmalı');
    } finally {
        process.env.TMDB_API_KEY = configuredApiKey;
        console.error = originalConsoleError;
    }

    const badReqRes = await tmdbFunction.handler({
        httpMethod: 'GET',
        queryStringParameters: { target: 'image', path: '/t/p/w999/a.jpg' }
    });
    assert(badReqRes.statusCode === 400, `Geçersiz görsel boyutu 400 dönmeli, gelen: ${badReqRes.statusCode}`);

    // Normal DNS üzerinden JSON passthrough
    let directFetchUrl = null;
    const jsonRes = await tmdbFunction.handler(
        {
            httpMethod: 'GET',
            queryStringParameters: {
                target: 'api',
                path: '/3/genre/movie/list?api_key=CLIENT&language=tr-TR&api_key=OTHER'
            }
        },
        {
            lookupImpl: async () => [{ address: '3.160.57.74', family: 4 }],
            fetchImpl: async (requestedUrl) => {
                directFetchUrl = requestedUrl;
                return {
                    status: 200,
                    headers: { get: () => 'application/json; charset=utf-8' },
                    arrayBuffer: async () => Buffer.from('{"genres":[{"id":28,"name":"Aksiyon"}]}')
                };
            }
        }
    );
    assert(jsonRes.statusCode === 200, `API passthrough 200 dönmeli, gelen: ${jsonRes.statusCode}`);
    assert(
        directFetchUrl === 'https://api.themoviedb.org/3/genre/movie/list?language=tr-TR&api_key=SERVER_TEST_KEY',
        'Normal upstream URL yalnızca kırpılmış sunucu anahtarını ve diğer parametreleri içermeli'
    );
    assert(JSON.parse(jsonRes.body).genres?.[0]?.id === 28, 'API JSON gövdesi korunmalı');

    // AbortError -> 504
    const timeoutRes = await tmdbFunction.handler(
        {
            httpMethod: 'GET',
            queryStringParameters: { target: 'api', path: '/3/movie/550' }
        },
        {
            lookupImpl: async () => [{ address: '3.160.57.74', family: 4 }],
            fetchImpl: async () => {
                const err = new Error('TMDB timed out');
                err.name = 'AbortError';
                throw err;
            }
        }
    );
    assert(timeoutRes.statusCode === 504, `AbortError 504 dönmeli, gelen: ${timeoutRes.statusCode}`);

    // Image binary base64 + non-image MIME rejection
    const imgRes = await tmdbFunction.handler(
        {
            httpMethod: 'GET',
            queryStringParameters: { target: 'image', path: '/t/p/w500/poster.png' }
        },
        {
            lookupImpl: async () => [{ address: '79.127.134.129', family: 4 }],
            fetchImpl: async () => ({
                status: 200,
                headers: { get: () => 'image/png; charset=binary' },
                arrayBuffer: async () => VALID_1X1_PNG
            })
        }
    );
    assert(imgRes.statusCode === 200 && imgRes.isBase64Encoded === true, 'Görsel yanıtı base64 kodlu 200 dönmeli');
    assert(imgRes.headers['Content-Type'] === 'image/png', 'Görsel Content-Type korunmalı');
    assert(Buffer.from(imgRes.body, 'base64').equals(VALID_1X1_PNG), 'Görsel baytları birebir korunmalı');

    const badMimeImgRes = await tmdbFunction.handler(
        {
            httpMethod: 'GET',
            queryStringParameters: { target: 'image', path: '/t/p/w500/poster.png' }
        },
        {
            lookupImpl: async () => [{ address: '79.127.134.129', family: 4 }],
            fetchImpl: async () => ({
                status: 200,
                headers: { get: () => 'text/html' },
                arrayBuffer: async () => Buffer.from('<html>not image</html>')
            })
        }
    );
    assert(badMimeImgRes.statusCode === 502, `image/* olmayan MIME 502 dönmeli, gelen: ${badMimeImgRes.statusCode}`);

    // Loopback DNS sinkhole (127.0.0.1) -> DoH + directIpRequest fallback
    tmdbFunction._resetDohCache();
    let dohCalls = 0;
    let directIpCalls = 0;
    const sinkholeRes = await tmdbFunction.handler(
        {
            httpMethod: 'GET',
            queryStringParameters: { target: 'api', path: '/3/movie/popular?api_key=CLIENT&language=tr-TR&api_key=OTHER' }
        },
        {
            lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
            fetchImpl: async () => {
                throw new Error('Sinkholed DNS durumunda doğrudan fetchImpl çağrılmamalıydı');
            },
            dohResolver: async (hostname) => {
                dohCalls += 1;
                assert(hostname === 'api.themoviedb.org', `DoH beklenmeyen host aldı: ${hostname}`);
                return '3.160.57.74';
            },
            directIpRequest: async (ip, host, upstreamPath, acceptHeader) => {
                directIpCalls += 1;
                assert(ip === '3.160.57.74', `Beklenen DoH IP 3.160.57.74, gelen: ${ip}`);
                assert(host === 'api.themoviedb.org', `Beklenen Host header api.themoviedb.org, gelen: ${host}`);
                assert(upstreamPath === '/3/movie/popular?language=tr-TR&api_key=SERVER_TEST_KEY', 'DoH upstream yolu istemci anahtarlarını kaldırıp sunucu anahtarını içermeli');
                assert(acceptHeader === 'application/json', `Beklenen Accept application/json, gelen: ${acceptHeader}`);
                return {
                    statusCode: 200,
                    contentType: 'application/json',
                    bodyBuffer: Buffer.from('{"results":[{"id":550}]}')
                };
            }
        }
    );
    assert(sinkholeRes.statusCode === 200, `Sinkhole fallback 200 dönmeli, gelen: ${sinkholeRes.statusCode}`);
    assert(dohCalls === 1 && directIpCalls === 1, 'Sinkhole durumunda DoH ve SNI directIpRequest 1 kez çalışmalı');
    assert(JSON.parse(sinkholeRes.body).results?.[0]?.id === 550, 'Sinkhole fallback verisi dönmeli');

    // DoH önbelleği ve sinkhole Answer kaydını atlama testi
    tmdbFunction._resetDohCache();
    let dohFetchCount = 0;
    const dohMockFetch = async () => {
        dohFetchCount += 1;
        return {
            ok: true,
            json: async () => ({
                Answer: [
                    { type: 1, TTL: 120, data: '127.0.0.1' },
                    { type: 1, TTL: 120, data: '10.0.0.5' },
                    { type: 1, TTL: 120, data: '169.254.169.254' },
                    { type: 1, TTL: 120, data: '192.168.1.10' },
                    { type: 1, TTL: 120, data: '100.64.0.1' },
                    { type: 1, TTL: 120, data: '3.160.57.74' }
                ]
            })
        };
    };
    const resolved1 = await tmdbFunction.resolveUpstreamIpViaDoh('api.themoviedb.org', dohMockFetch);
    const resolved2 = await tmdbFunction.resolveUpstreamIpViaDoh('api.themoviedb.org', dohMockFetch);
    assert(resolved1 === '3.160.57.74' && resolved2 === '3.160.57.74', 'DoH genel IP döndürmeli');
    assert(dohFetchCount === 1, 'İkinci DoH çağrısı bellek içi önbellekten dönmeli');

    console.log('✓ Unit & handler tests passed.');
}

async function createTestServer() {
    const trackedProxyRequests = [];

    const mockDeps = {
        lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
        dohResolver: async (hostname) =>
            hostname === 'image.tmdb.org' ? '79.127.134.129' : '3.160.57.74',
        directIpRequest: async (_ip, host, upstreamPath) => {
            if (host === 'image.tmdb.org') {
                return {
                    statusCode: 200,
                    contentType: 'image/png',
                    bodyBuffer: VALID_1X1_PNG
                };
            }
            return {
                statusCode: 200,
                contentType: 'application/json; charset=utf-8',
                bodyBuffer: Buffer.from(JSON.stringify(createMockTmdbApiPayload(upstreamPath)))
            };
        }
    };

    const server = http.createServer(async (req, res) => {
        const parsed = new URL(req.url, 'http://127.0.0.1');
        const query = Object.fromEntries(parsed.searchParams.entries());

        if (parsed.pathname === '/.netlify/functions/tmdb') {
            trackedProxyRequests.push({
                path: parsed.pathname,
                query
            });
            const out = await tmdbFunction.handler(
                {
                    httpMethod: req.method,
                    queryStringParameters: query,
                    headers: req.headers
                },
                mockDeps
            );
            res.writeHead(out.statusCode || 200, out.headers || { 'Content-Type': 'application/json' });
            if (out.isBase64Encoded) {
                res.end(Buffer.from(out.body || '', 'base64'));
            } else {
                res.end(out.body || '');
            }
            return;
        }

        if (parsed.pathname === '/.netlify/functions/omdb') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ Response: 'False', Error: 'Test stub' }));
            return;
        }

        const cleanPath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
        const filePath = path.join(ROOT_DIR, decodeURIComponent(cleanPath));
        if (!filePath.startsWith(ROOT_DIR)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, {
                'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
                'Cache-Control': 'no-cache'
            });
            res.end(content);
        });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
        server,
        port: server.address().port,
        trackedProxyRequests
    };
}

async function createIsolatedPage(browser) {
    const context =
        typeof browser.createBrowserContext === 'function'
            ? await browser.createBrowserContext()
            : await browser.createIncognitoBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    return { context, page };
}

async function runBrowserIntegrationTests() {
    console.log('2) Running Puppeteer TMDB Smart Fallback integration tests...');
    const { server, port, trackedProxyRequests } = await createTestServer();
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: getBrowserExecutablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        // (a) Doğrudan TMDB erişilebilirken fallback proxy sıfır ek yük oluşturmalı
        {
            trackedProxyRequests.length = 0;
            const { context, page } = await createIsolatedPage(browser);
            await page.setRequestInterception(true);
            page.on('request', req => {
                const reqUrl = req.url();
                if (reqUrl.startsWith('https://api.themoviedb.org/')) {
                    if (req.method() === 'OPTIONS') {
                        req.respond({
                            status: 204,
                            headers: {
                                'Access-Control-Allow-Origin': '*',
                                'Access-Control-Allow-Methods': 'GET, OPTIONS'
                            }
                        });
                        return;
                    }
                    const parsed = new URL(reqUrl);
                    req.respond({
                        status: 200,
                        headers: { 'Access-Control-Allow-Origin': '*' },
                        contentType: 'application/json',
                        body: JSON.stringify(createMockTmdbApiPayload(`${parsed.pathname}${parsed.search}`))
                    });
                    return;
                }
                if (reqUrl.startsWith('https://image.tmdb.org/')) {
                    req.respond({
                        status: 200,
                        headers: { 'Access-Control-Allow-Origin': '*' },
                        contentType: 'image/png',
                        body: VALID_1X1_PNG
                    });
                    return;
                }
                if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) {
                    req.continue();
                    return;
                }
                req.abort();
            });

            await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle2' });
            await page.waitForSelector('.movie-card', { timeout: 10000 });

            const state = await page.evaluate(() => window.getTmdbFallbackState());
            assert(!state.apiActive && !state.imageActive, 'Normal ağda TMDB fallback kapalı kalmalı');
            assert(
                trackedProxyRequests.length === 0,
                `Normal ağda /.netlify/functions/tmdb çağrısı 0 olmalıydı, gelen: ${trackedProxyRequests.length}`
            );

            // (c) Kullanıcı/UI kaynaklı AbortError fallback tetiklememeli
            const abortName = await page.evaluate(async () => {
                const controller = new AbortController();
                const req = fetch('https://api.themoviedb.org/3/movie/550?api_key=test', {
                    signal: controller.signal
                });
                controller.abort();
                try {
                    await req;
                    return null;
                } catch (err) {
                    return err.name;
                }
            });
            assert(abortName === 'AbortError', `AbortController testi AbortError üretmeli, gelen: ${abortName}`);
            const stateAfterAbort = await page.evaluate(() => window.getTmdbFallbackState());
            assert(!stateAfterAbort.apiActive && !stateAfterAbort.imageActive, 'AbortError proxy modunu açmamalı');
            assert(trackedProxyRequests.length === 0, 'AbortError probe isteği atmamalı');

            await context.close();
            console.log('✓ Scenario (a) zero-overhead direct path & Scenario (c) AbortError isolation passed.');
        }

        // (b) GoodbyeDPI sinkhole simülasyonu (connectionrefused) -> probe once -> api & image fallback aktif
        {
            trackedProxyRequests.length = 0;
            const { context, page } = await createIsolatedPage(browser);
            await page.setRequestInterception(true);
            page.on('request', req => {
                const reqUrl = req.url();
                if (
                    reqUrl.startsWith('https://api.themoviedb.org/') ||
                    reqUrl.startsWith('https://image.tmdb.org/')
                ) {
                    req.abort('connectionrefused');
                    return;
                }
                if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) {
                    req.continue();
                    return;
                }
                req.abort();
            });

            await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(
                () => {
                    const state = window.getTmdbFallbackState?.();
                    const cards = document.querySelectorAll('.movie-card');
                    const poster = cards[0]?.querySelector('img');
                    const logos = Array.from(document.querySelectorAll('img')).filter(img => {
                        const raw = img.getAttribute('src') || '';
                        return (
                            !img.closest('.movie-card') &&
                            decodeURIComponent(raw).includes('/t/p/original/')
                        );
                    });
                    return (
                        state?.apiActive === true &&
                        state?.imageActive === true &&
                        cards.length > 0 &&
                        poster &&
                        poster.src.includes('/.netlify/functions/tmdb') &&
                        poster.complete &&
                        poster.naturalWidth > 0 &&
                        logos.length >= 3 &&
                        logos.every(
                            img =>
                                img.src.includes('/.netlify/functions/tmdb?target=image') &&
                                img.complete &&
                                img.naturalWidth > 0
                        )
                    );
                },
                { timeout: 15000 }
            );

            // Statik platform logolarının da yeniden yazıldığını ve yüklendiğini doğrula
            const staticLogoCheck = await page.evaluate(() => {
                const logos = Array.from(document.querySelectorAll('img')).filter(img => {
                    const raw = img.getAttribute('src') || '';
                    return (
                        !img.closest('.movie-card') &&
                        decodeURIComponent(raw).includes('/t/p/original/')
                    );
                });
                return {
                    count: logos.length,
                    allProxiedAndLoaded:
                        logos.length >= 3 &&
                        logos.every(
                            img =>
                                img.src.includes('/.netlify/functions/tmdb?target=image') &&
                                img.complete &&
                                img.naturalWidth > 0
                        )
                };
            });
            assert(staticLogoCheck.count >= 3, 'Statik platform logo görselleri bulunmalı');
            assert(
                staticLogoCheck.allProxiedAndLoaded,
                'Statik platform logoları da fallback proxy üzerinden yüklenmiş olmalı'
            );

            const probeCalls = trackedProxyRequests.filter(r => r.query?.probe === '1');
            const apiCalls = trackedProxyRequests.filter(r => r.query?.target === 'api');
            const imageCalls = trackedProxyRequests.filter(r => r.query?.target === 'image');

            assert(probeCalls.length === 1, `Probe tam olarak 1 kez çağrılmalıydı, gelen: ${probeCalls.length}`);
            assert(apiCalls.length > 0, 'API çağrıları /.netlify/functions/tmdb üzerinden yapılmalıydı');
            assert(apiCalls.every(r => !new URL(r.query.path, 'https://api.themoviedb.org').searchParams.has('api_key')), 'Tarayıcı proxy isteklerinde api_key bulunmamalı');
            assert(imageCalls.length > 0, 'Görsel çağrıları /.netlify/functions/tmdb üzerinden yapılmalıydı');

            await context.close();
            console.log('✓ Scenario (b) sinkhole detection, single probe, API & image proxy fallback passed.');
        }
    } finally {
        if (browser) {
            await browser.close();
        }
        server.close();
    }
}

(async () => {
    const originalApiKey = process.env.TMDB_API_KEY;
    try {
        process.env.TMDB_API_KEY = '  SERVER_TEST_KEY  ';
        await runHandlerUnitTests();
        await runBrowserIntegrationTests();
        console.log('ALL TMDB PROXY REGRESSION TESTS PASSED.');
    } catch (error) {
        console.error('TMDB PROXY REGRESSION TEST FAILED:', error);
        process.exitCode = 1;
    } finally {
        if (originalApiKey === undefined) delete process.env.TMDB_API_KEY;
        else process.env.TMDB_API_KEY = originalApiKey;
    }
})();
