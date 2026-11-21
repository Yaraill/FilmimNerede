const fs =
    require('fs');

const path =
    require('path');

const http = require('http');
const os = require('os');
const zlib = require('zlib');

const {
    handler,
    _resetRateLimit,
    _resetIndexCache,
    _setIndexPathForTests,
    _setIndexBufferForTests
} =
    require(
        '../netlify/functions/omdb'
    );

const {
    encodeRatingsBinary,
    lookupImdbRatingInBuffer,
    parseRatingsTsvToBinaryBuffer,
    validateIndexBuffer
} = require('../netlify/functions/lib/imdb-ratings-index');
const { buildImdbRatingsIndex } = require('../scripts/update-imdb-ratings');

const ROOT_DIR =
    path.resolve(
        __dirname,
        '..'
    );

function assert(
    condition,
    message
) {
    if (!condition) {
        throw new Error(
            message
        );
    }
}

function parseBody(
    response
) {
    return JSON.parse(
        response.body
    );
}

function createUpstreamResponse(
    body,
    {
        ok = true,
        status = 200
    } = {}
) {
    return {
        ok,
        status,
        json:
            async () =>
                body
    };
}

function collectBrowserSourceFiles() {
    const files = [
        path.join(
            ROOT_DIR,
            'index.html'
        ),
        path.join(
            ROOT_DIR,
            'app.js'
        ),
        path.join(
            ROOT_DIR,
            'service-worker.js'
        )
    ];

    const jsRoot =
        path.join(
            ROOT_DIR,
            'js'
        );

    const ignoredDirectoryNames =
        new Set([
            'node_modules',
            '.git'
        ]);

    const walk =
        directory => {
            if (
                !fs.existsSync(
                    directory
                )
            ) {
                return;
            }

            const entries =
                fs.readdirSync(
                    directory,
                    {
                        withFileTypes:
                            true
                    }
                );

            entries.forEach(
                entry => {
                    if (
                        ignoredDirectoryNames
                            .has(
                                entry.name
                            )
                    ) {
                        return;
                    }

                    const fullPath =
                        path.join(
                            directory,
                            entry.name
                        );

                    if (
                        entry
                            .isDirectory()
                    ) {
                        walk(
                            fullPath
                        );

                        return;
                    }

                    if (
                        entry
                            .isFile() &&
                        entry.name
                            .toLowerCase()
                            .endsWith(
                                '.js'
                            )
                    ) {
                        files.push(
                            fullPath
                        );
                    }
                }
            );
        };

    walk(
        jsRoot
    );

    return Array.from(
        new Set(
            files
                .filter(filePath =>
                    fs.existsSync(
                        filePath
                    )
                )
                .map(filePath =>
                    path.resolve(
                        filePath
                    )
                )
        )
    );
}

function scanBrowserSourcesForOmdbSecrets() {
    const files =
        collectBrowserSourceFiles();

    const blockers = [];

    const patterns = [
        {
            label:
                'direct omdbapi.com reference',
            pattern:
                /omdbapi\.com/i
        },
        {
            label:
                'OMDB_API_KEY server env name',
            pattern:
                /\bOMDB_API_KEY\b/
        },
        {
            // TMDB uses api_key with underscore.
            // Bare "apikey" is therefore treated
            // as OMDb-style browser credential
            // construction/passthrough.
            label:
                'OMDb-style apikey token/query',
            pattern:
                /\bapikey\b/i
        }
    ];

    files.forEach(
        filePath => {
            const source =
                fs.readFileSync(
                    filePath,
                    'utf8'
                );

            patterns.forEach(
                ({
                    label,
                    pattern
                }) => {
                    if (
                        pattern.test(
                            source
                        )
                    ) {
                        blockers.push({
                            file:
                                path.relative(
                                    ROOT_DIR,
                                    filePath
                                ),
                            label
                        });
                    }
                }
            );
        }
    );

    return {
        files,
        blockers
    };
}

const RATINGS_TSV = [
    'tconst\taverageRating\tnumVotes',
    'tt4294967295\t10.0\t300',
    'tt0000001\t8.0\t100',
    'tt1234567\t8.4\t200',
    'tt1234567\t7.1\t200',
    'tt1234567\t11.0\t200',
    'tt0000002\t7.2\t9',
    'tt0000003\t\\N\t200',
    'tt0000004\t8.4\t-1',
    'tt0000005\t0.0\t200',
    'tt0000006\t8.4\tNaN',
    'tt0000007\t8.4\t0',
    'tt0000008\t8.4\t\\N',
    'tt0000009\t8.4\t200\textra',
    'tt9999999999\t9.0\t200'
].join('\r\n');

const PUBLIC_RATINGS_CACHE = 'public, max-age=3600, s-maxage=86400';
const DURABLE_RATINGS_CACHE = 'public, s-maxage=604800, durable';

function testIndexCodec() {
    const generatedAtSec = 1_700_000_000;
    const buffer = parseRatingsTsvToBinaryBuffer(RATINGS_TSV, { minVotes: 100, generatedAtSec });
    assert(validateIndexBuffer(buffer), 'TSV should encode to a valid binary index');
    assert(buffer.toString('ascii', 0, 4) === 'FNR1', 'Unexpected index magic');
    assert(buffer.readUInt16LE(4) === 1 && buffer.readUInt16LE(6) === 5, 'Unexpected record format');
    assert(buffer.readUInt32LE(8) === 3 && buffer.length === 31, 'Filtered index should have three records');
    assert(buffer.readUInt32LE(12) === generatedAtSec, 'Unexpected index timestamp');
    assert(lookupImdbRatingInBuffer(buffer, 'tt0000001') === '8.0', 'First record should retain one decimal');
    assert(lookupImdbRatingInBuffer(buffer, 'tt1234567') === '8.4', 'Middle record should retain highest rating');
    assert(lookupImdbRatingInBuffer(buffer, 'tt4294967295') === '10.0', 'Last record should support max uint32 ID');
    assert(lookupImdbRatingInBuffer(buffer, 'tt0000002') === null, 'Minimum vote filter should exclude low votes');
    assert(lookupImdbRatingInBuffer(buffer, 'tt1234568') === null, 'Absent ID should return null');
    assert(lookupImdbRatingInBuffer(buffer, 'tt0000000') === null, 'Zero is not a valid IMDb ID');
    assert(lookupImdbRatingInBuffer(buffer, 'tt9999999999') === null, 'Overflowing IMDb ID should return null');

    const unfiltered = parseRatingsTsvToBinaryBuffer(RATINGS_TSV);
    assert(unfiltered.readUInt32LE(8) === 4, 'Default vote filter should still skip malformed rows');
    assert(lookupImdbRatingInBuffer(unfiltered, 'tt0000002') === '7.2', 'Default filter should allow positive votes');

    const objectBuffer = encodeRatingsBinary([
        { idNum: 2, ratingTenths: 91 },
        { idNum: 1, ratingTenths: 80 },
        { idNum: 2, ratingTenths: 85 }
    ], generatedAtSec);
    const typedBuffer = encodeRatingsBinary({
        idNums: Uint32Array.of(2, 1, 2, 3),
        ratingTenths: Uint8Array.of(91, 80, 85, 90),
        length: 3
    }, generatedAtSec);
    assert(objectBuffer.equals(typedBuffer), 'Object and typed entries should encode identically');
    assert(lookupImdbRatingInBuffer(typedBuffer, 'tt0000002') === '9.1', 'Duplicate should retain highest rating');
    assert(lookupImdbRatingInBuffer(typedBuffer, 'tt0000003') === null, 'Unused typed capacity should be ignored');

    const invalidMagic = Buffer.from(buffer);
    invalidMagic[0] |= 0x80;
    for (const invalid of [null, invalidMagic, buffer.subarray(0, 15), buffer.subarray(0, 30)]) {
        assert(!validateIndexBuffer(invalid), 'Invalid index header or length should be rejected');
        assert(lookupImdbRatingInBuffer(invalid, 'tt0000001') === null, 'Invalid index should return null');
    }
    return buffer;
}

function requestRating(imdbId) {
    return handler({
        httpMethod: 'GET',
        queryStringParameters: { i: imdbId },
        headers: { 'X-Nf-Client-Connection-Ip': '192.0.2.30' }
    });
}

function assertPublicRatingsCache(response) {
    assert(response.headers['Cache-Control'] === PUBLIC_RATINGS_CACHE, 'Unexpected public ratings cache header');
    assert(response.headers['Netlify-CDN-Cache-Control'] === DURABLE_RATINGS_CACHE, 'Durable CDN header is missing');
}

async function testLocalIndex(buffer) {
    _resetRateLimit({ now: () => 0 });
    _setIndexBufferForTests(buffer);
    delete process.env.OMDB_API_KEY;
    let fetchCalls = 0;
    global.fetch = async () => {
        fetchCalls += 1;
        throw new Error('Local index hits should never call OMDb');
    };

    let response = await requestRating('tt1234567');
    const body = parseBody(response);
    assert(response.statusCode === 200 && body.Response === 'True', 'Local hit should succeed without an API key');
    assert(body.imdbID === 'tt1234567' && body.imdbRating === '8.4', 'Incorrect local IMDb ID or rating');
    assert(body.source === 'imdb-dataset', 'Local hit should report imdb-dataset source');
    assertPublicRatingsCache(response);

    for (let request = 1; request < 30; request += 1) {
        response = await requestRating('tt1234567');
        assert(response.statusCode === 200, 'The first 30 local hits should be allowed');
    }
    response = await requestRating('tt1234567');
    assert(response.statusCode === 429 && response.headers['Retry-After'] === '60', 'Local hits should be rate limited');
    assert(response.headers['Cache-Control'] === 'no-store', 'Rate-limited local hits should not be cached');
    assert(fetchCalls === 0, 'Local hits should bypass upstream');

    _resetRateLimit();
    process.env.OMDB_API_KEY = 'server-test-secret';
    global.fetch = async () => createUpstreamResponse({ Response: 'True', imdbRating: '7.6' });
    response = await requestRating('tt1234568');
    assert(response.statusCode === 200 && parseBody(response).imdbRating === '7.6', 'A local miss should reach OMDb');
    assertPublicRatingsCache(response);

    global.fetch = async () => createUpstreamResponse({ Response: 'False', Error: 'Movie not found!' });
    response = await requestRating('tt1234568');
    assert(response.statusCode === 200 && parseBody(response).Response === 'False', 'OMDb miss should retain payload');
    assert(response.headers['Cache-Control'] === 'no-store', 'OMDb miss should use no-store');
    assert(!('Netlify-CDN-Cache-Control' in response.headers), 'OMDb miss must omit the CDN cache header');
}

async function testIndexUpdater() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'filmimnerede-ratings-'));
    const outputPath = path.join(directory, 'imdb-ratings.bin.gz');
    const tmpPath = `${outputPath}.tmp`;
    const brokenPath = path.join(directory, 'broken.bin.gz');
    const server = http.createServer((request, response) => {
        response.setHeader('Connection', 'close');
        switch (request.url) {
            case '/redirect':
                response.writeHead(302, { Location: '/ratings' }).end();
                break;
            case '/ratings':
                response.end(zlib.gzipSync(RATINGS_TSV));
                break;
            case '/corrupt':
                response.end('not gzip');
                break;
            case '/empty':
                response.end(zlib.gzipSync('tconst\taverageRating\tnumVotes\n'));
                break;
            default:
                response.writeHead(500).end();
        }
    });

    try {
        _resetIndexCache();
        _resetRateLimit();
        _setIndexPathForTests(outputPath);
        global.fetch = async () => createUpstreamResponse({ Response: 'True', imdbRating: '7.6' });
        let response = await requestRating('tt1234567');
        assert(response.statusCode === 200 && parseBody(response).imdbRating === '7.6', 'Missing index should reach OMDb');

        _setIndexPathForTests(brokenPath);
        for (const bytes of ['not gzip', zlib.gzipSync('missing binary header')]) {
            fs.writeFileSync(brokenPath, bytes);
            response = await requestRating('tt1234567');
            assert(response.statusCode === 200 && parseBody(response).imdbRating === '7.6', 'Broken index should reach OMDb');
        }

        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const result = await buildImdbRatingsIndex({ url: `${baseUrl}/redirect`, outputPath, minVotes: 100 });
        assert(result.ok && result.count === 3, 'Updater should follow a 302 and write three valid ratings');
        assert(!fs.existsSync(tmpPath), 'Successful update should leave no temporary file');
        const savedIndex = fs.readFileSync(outputPath);

        _setIndexPathForTests(outputPath);
        delete process.env.OMDB_API_KEY;
        response = await requestRating('tt4294967295');
        const body = parseBody(response);
        assert(response.statusCode === 200 && body.source === 'imdb-dataset' && body.imdbRating === '10.0',
            'OMDb handler should read the index produced by the updater');

        for (const route of ['/corrupt', '/http-error', '/empty']) {
            fs.writeFileSync(tmpPath, 'old partial update');
            const stale = await buildImdbRatingsIndex({ url: baseUrl + route, outputPath, allowStale: true });
            assert(!stale.ok && stale.staleUsed && stale.error instanceof Error, `Expected stale fallback for ${route}`);
            assert(fs.readFileSync(outputPath).equals(savedIndex), `Failed update modified existing index for ${route}`);
            assert(!fs.existsSync(tmpPath), `Temporary file was left after ${route}`);
        }

        const missing = await buildImdbRatingsIndex({
            url: `${baseUrl}/http-error`,
            outputPath: brokenPath + '.missing',
            allowStale: true
        });
        assert(!missing.ok && !missing.staleUsed, 'Stale fallback should report when no prior index exists');
    } finally {
        if (server.listening) {
            await new Promise(resolve => server.close(resolve));
        }
        for (const file of [tmpPath, outputPath, brokenPath, brokenPath + '.missing', brokenPath + '.missing.tmp']) {
            fs.rmSync(file, { force: true });
        }
        fs.rmdirSync(directory);
    }
}

async function runTest() {
    const originalFetch =
        global.fetch;

    const originalApiKey =
        process.env
            .OMDB_API_KEY;

    const originalSetTimeout =
        global.setTimeout;

    try {
        _setIndexBufferForTests(null);

        // -------------------------------------------------
        // Browser/client current-tree secret scan
        // -------------------------------------------------
        const browserScan =
            scanBrowserSourcesForOmdbSecrets();

        assert(
            browserScan
                .files
                .some(
                    file =>
                        path.relative(
                            ROOT_DIR,
                            file
                        ) ===
                        'index.html'
                ),
            'Browser scan does not include index.html'
        );

        assert(
            browserScan
                .files
                .some(
                    file =>
                        path.relative(
                            ROOT_DIR,
                            file
                        ) ===
                        'app.js'
                ),
            'Browser scan does not include app.js'
        );

        assert(
            browserScan
                .files
                .some(
                    file =>
                        path.relative(
                            ROOT_DIR,
                            file
                        ) ===
                        'service-worker.js'
                ),
            'Browser scan does not include service-worker.js'
        );

        assert(
            browserScan
                .files
                .some(
                    file =>
                        path
                            .relative(
                                ROOT_DIR,
                                file
                            )
                            .startsWith(
                                `js${path.sep}`
                            )
                ),
            'Browser scan does not include js/**/*.js'
        );

        assert(
            browserScan
                .blockers
                .length ===
                0,
            `Browser-side OMDb blocker(s) found:\n${
                browserScan
                    .blockers
                    .map(
                        blocker =>
                            `${blocker.file}: ${blocker.label}`
                    )
                    .join('\n')
            }`
        );

        // -------------------------------------------------
        // Client must use local function endpoint
        // -------------------------------------------------
        const movieSource =
            fs.readFileSync(
                path.join(
                    ROOT_DIR,
                    'js',
                    'runtime',
                    'movie.js'
                ),
                'utf8'
            );

        assert(
            movieSource.includes(
                '/.netlify/functions/omdb'
            ),
            'movie.js does not use OMDb Netlify Function'
        );

        // -------------------------------------------------
        // Server-side source expectations
        // -------------------------------------------------
        const functionPath =
            path.join(
                ROOT_DIR,
                'netlify',
                'functions',
                'omdb.js'
            );

        const functionSource =
            fs.readFileSync(
                functionPath,
                'utf8'
            );

        assert(
            /omdbapi\.com/i.test(
                functionSource
            ),
            'OMDb upstream host missing from server-side Function'
        );

        assert(
            functionSource.includes(
                'process.env'
            ) &&
            functionSource.includes(
                'OMDB_API_KEY'
            ),
            'OMDb Function does not read OMDB_API_KEY from server env'
        );

        assert(
            functionSource.includes(
                'OMDB_TIMEOUT_MS'
            ) &&
            functionSource.includes(
                'controller.abort()'
            ),
            'OMDb Function timeout protection is missing'
        );

        // -------------------------------------------------
        // SW must bypass Function caching
        // -------------------------------------------------
        const swSource =
            fs.readFileSync(
                path.join(
                    ROOT_DIR,
                    'service-worker.js'
                ),
                'utf8'
            );

        assert(
            swSource.includes(
                '/.netlify/functions/omdb'
            ) || swSource.includes("startsWith('/.netlify/')"),
            'Service worker does not bypass OMDb Function cache'
        );

        // -------------------------------------------------
        // Unsupported method
        // -------------------------------------------------
        _resetRateLimit();
        process.env.OMDB_API_KEY =
            'server-test-secret';

        let response =
            await handler({
                httpMethod:
                    'POST',
                queryStringParameters: {
                    i:
                        'tt1234567'
                }
            });

        assert(
            response.statusCode ===
                405,
            'Unsupported method should return 405'
        );

        // -------------------------------------------------
        // Invalid IMDb ID
        // -------------------------------------------------
        _resetRateLimit();
        response =
            await handler({
                httpMethod:
                    'GET',
                queryStringParameters: {
                    i:
                        'javascript:alert(1)'
                }
            });

        assert(
            response.statusCode ===
                400,
            'Invalid IMDb ID should return 400'
        );

        // -------------------------------------------------
        // Missing server configuration
        // -------------------------------------------------
        _resetRateLimit();
        delete process.env
            .OMDB_API_KEY;

        response =
            await handler({
                httpMethod:
                    'GET',
                queryStringParameters: {
                    i:
                        'tt1234567'
                }
            });

        assert(
            response.statusCode ===
                500,
            'Missing OMDB_API_KEY should return 500'
        );

        const missingKeyBody =
            response.body;

        assert(
            !missingKeyBody.includes(
                'process.env'
            ) &&
            !missingKeyBody.includes(
                'stack'
            ),
            'Missing-key response leaked server internals'
        );

        // -------------------------------------------------
        // Valid request:
        // server secret injected,
        // client apikey and extra params ignored.
        // -------------------------------------------------
        _resetRateLimit();
        process.env.OMDB_API_KEY =
            'server-test-secret';

        let capturedUrl =
            null;

        global.fetch =
            async url => {
                capturedUrl =
                    String(url);

                return createUpstreamResponse({
                    Response:
                        'True',
                    imdbRating:
                        '8.4'
                });
            };

        response =
            await handler({
                httpMethod:
                    'GET',
                queryStringParameters: {
                    i:
                        'tt1234567',
                    apikey:
                        'attacker-client-key',
                    t:
                        'should-not-pass'
                }
            });

        assert(
            response.statusCode ===
                200,
            'Valid OMDb proxy request should return 200'
        );

        assert(
            response.headers?.[
                'Cache-Control'
            ] ===
                'public, max-age=3600, s-maxage=86400',
            'OMDb Response:True should use long Cache-Control header'
        );

        const upstreamUrl =
            new URL(
                capturedUrl
            );

        assert(
            upstreamUrl.hostname ===
                'www.omdbapi.com',
            'OMDb Function called unexpected upstream host'
        );

        assert(
            upstreamUrl
                .searchParams
                .get(
                    'apikey'
                ) ===
                'server-test-secret',
            'Server OMDb secret was not injected'
        );

        assert(
            upstreamUrl
                .searchParams
                .get(
                    'apikey'
                ) !==
                'attacker-client-key',
            'Client apikey was passed upstream'
        );

        assert(
            upstreamUrl
                .searchParams
                .get(
                    'i'
                ) ===
                'tt1234567',
            'Validated IMDb ID was not forwarded'
        );

        assert(
            !upstreamUrl
                .searchParams
                .has(
                    't'
                ),
            'Non-whitelisted client parameter was forwarded'
        );

        // -------------------------------------------------
        // OMDb Response:false application semantics
        // -------------------------------------------------
        _resetRateLimit();
        global.fetch =
            async () =>
                createUpstreamResponse({
                    Response:
                        'False',
                    Error:
                        'Movie not found!'
                });

        response =
            await handler({
                httpMethod:
                    'GET',
                queryStringParameters: {
                    i:
                        'tt7654321'
                }
            });

        assert(
            response.statusCode ===
                200,
            'OMDb Response:false should preserve HTTP 200 semantics'
        );

        const falseBody =
            parseBody(
                response
            );

        assert(
            falseBody.Response ===
                'False' &&
            falseBody.Error ===
                'Movie not found!',
            'OMDb Response:false payload semantics changed'
        );

        assert(
            response.headers?.[
                'Cache-Control'
            ] === 'no-store',
            'OMDb Response:false should return Cache-Control: no-store'
        );

        // Quota / key errors with Response:False must also return no-store
        for (const errorMessage of [
            'Request limit reached!',
            'Invalid API key!'
        ]) {
            _resetRateLimit();
            global.fetch =
                async () =>
                    createUpstreamResponse({
                        Response:
                            'False',
                        Error:
                            errorMessage
                    });

            response =
                await handler({
                    httpMethod:
                        'GET',
                    queryStringParameters: {
                        i:
                            'tt1234567'
                    }
                });

            assert(
                response.statusCode ===
                    200,
                `OMDb Response:false (${errorMessage}) should preserve HTTP 200`
            );

            assert(
                response.headers?.[
                    'Cache-Control'
                ] === 'no-store',
                `OMDb Response:false (${errorMessage}) must return Cache-Control: no-store`
            );

            const errorBody =
                parseBody(
                    response
                );

            assert(
                errorBody.Response ===
                    'False' &&
                errorBody.Error ===
                    errorMessage,
                `OMDb Response:false (${errorMessage}) payload changed`
            );
        }

        // -------------------------------------------------
        // Upstream HTTP failure
        // -------------------------------------------------
        _resetRateLimit();
        global.fetch =
            async () =>
                createUpstreamResponse(
                    {},
                    {
                        ok: false,
                        status: 503
                    }
                );

        response =
            await handler({
                httpMethod:
                    'GET',
                queryStringParameters: {
                    i:
                        'tt1234567'
                }
            });

        assert(
            response.statusCode ===
                502,
            'Upstream HTTP failure should return 502'
        );

        // -------------------------------------------------
        // Network failure:
        // raw internal message must not leak.
        // -------------------------------------------------
        _resetRateLimit();
        global.fetch =
            async () => {
                throw new Error(
                    'INTERNAL_NETWORK_SECRET'
                );
            };

        response =
            await handler({
                httpMethod:
                    'GET',
                queryStringParameters: {
                    i:
                        'tt1234567'
                }
            });

        assert(
            response.statusCode ===
                502,
            'Upstream network failure should return 502'
        );

        const networkFailureBody =
            response.body;

        assert(
            !networkFailureBody.includes(
                'INTERNAL_NETWORK_SECRET'
            ) &&
            !networkFailureBody.includes(
                'stack'
            ) &&
            !networkFailureBody.includes(
                'process.env'
            ),
            'Raw upstream error leaked in response body'
        );

        // -------------------------------------------------
        // ACTUAL TIMEOUT REGRESSION
        //
        // Production remains 9000ms. Only this test
        // temporarily accelerates setTimeout to 0ms.
        // -------------------------------------------------
        _resetRateLimit();
        const timeoutSecret =
            'INTERNAL_TIMEOUT_SECRET';

        global.setTimeout =
            callback =>
                originalSetTimeout(
                    callback,
                    0
                );

        global.fetch =
            (
                url,
                {
                    signal
                } = {}
            ) =>
                new Promise(
                    (
                        resolve,
                        reject
                    ) => {
                        const abort =
                            () => {
                                const error =
                                    new Error(
                                        timeoutSecret
                                    );

                                error.name =
                                    'AbortError';

                                reject(
                                    error
                                );
                            };

                        if (
                            signal?.aborted
                        ) {
                            abort();
                        } else {
                            signal
                                ?.addEventListener(
                                    'abort',
                                    abort,
                                    {
                                        once:
                                            true
                                    }
                                );
                        }
                    }
                );

        try {
            response =
                await handler({
                    httpMethod:
                        'GET',
                    queryStringParameters: {
                        i:
                            'tt1234567'
                    }
                });

            assert(
                response.statusCode ===
                    504,
                'Timed-out OMDb upstream request should return 504'
            );

            const timeoutBody =
                response.body;

            assert(
                !timeoutBody.includes(
                    timeoutSecret
                ) &&
                !timeoutBody.includes(
                    'stack'
                ) &&
                !timeoutBody.includes(
                    'process.env'
                ),
                'Timeout response leaked internal error details'
            );
        } finally {
            global.setTimeout =
                originalSetTimeout;
        }

        let now = 0;
        _resetRateLimit({ now: () => now });

        let upstreamCalls = 0;
        global.fetch = async () => {
            upstreamCalls += 1;
            return createUpstreamResponse({ Response: 'True' });
        };

        const rateLimitEvent = {
            httpMethod: 'GET',
            queryStringParameters: { i: 'tt1234567' },
            headers: { 'X-Nf-Client-Connection-Ip': '192.0.2.10' }
        };

        for (let request = 0; request < 30; request += 1) {
            response = await handler({
                ...rateLimitEvent,
                headers: {
                    ...rateLimitEvent.headers,
                    'X-Forwarded-For': `198.51.100.${request + 1}`
                }
            });
            assert(response.statusCode === 200, 'The first 30 requests should be allowed');
        }

        now = 1_250;
        response = await handler(rateLimitEvent);
        assert(response.statusCode === 429, 'The 31st request from the same IP should return 429');
        assert(response.headers['Retry-After'] === '59', 'Retry-After should round up the remaining seconds');
        assert(response.headers['Cache-Control'] === 'no-store', 'A 429 response should not be cached');
        assert(
            parseBody(response).error === 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.',
            'Unexpected rate limit error message'
        );
        assert(upstreamCalls === 30, 'A rate-limited request should not reach OMDb');

        response = await handler({
            ...rateLimitEvent,
            headers: { 'X-Forwarded-For': ' 192.0.2.10 , 192.0.2.20' }
        });
        assert(response.statusCode === 429, 'The trimmed first forwarded IP should use its existing limit');

        response = await handler({
            ...rateLimitEvent,
            headers: { 'X-Forwarded-For': ' 192.0.2.20 , 192.0.2.10' }
        });
        assert(response.statusCode === 200, 'A different IP should be allowed');

        now = 60_000;
        response = await handler(rateLimitEvent);
        assert(response.statusCode === 200, 'Requests should be allowed when the fixed window expires');

        await testLocalIndex(testIndexCodec());
        await testIndexUpdater();

        console.log(
            `[INFO] browser source files scanned: ${browserScan.files.length}`
        );

        console.log(
            '[PASS] OMDb proxy regression tests passed'
        );
    } finally {
        _resetIndexCache();
        _resetRateLimit();
        global.fetch =
            originalFetch;

        global.setTimeout =
            originalSetTimeout;

        if (
            originalApiKey ===
            undefined
        ) {
            delete process.env
                .OMDB_API_KEY;
        } else {
            process.env.OMDB_API_KEY =
                originalApiKey;
        }
    }
}

runTest()
    .then(
        () =>
            process.exit(0)
    )
    .catch(error => {
        console.error(
            '[FAIL] OMDb proxy regression:',
            error
        );

        process.exit(1);
    });
