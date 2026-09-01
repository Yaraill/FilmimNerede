const fs =
    require('fs');

const path =
    require('path');

const {
    handler
} =
    require(
        '../netlify/functions/omdb'
    );

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

async function runTest() {
    const originalFetch =
        global.fetch;

    const originalApiKey =
        process.env
            .OMDB_API_KEY;

    const originalSetTimeout =
        global.setTimeout;

    try {
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
            ),
            'Service worker does not bypass OMDb Function cache'
        );

        // -------------------------------------------------
        // Unsupported method
        // -------------------------------------------------
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

        // -------------------------------------------------
        // Upstream HTTP failure
        // -------------------------------------------------
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

        console.log(
            `[INFO] browser source files scanned: ${browserScan.files.length}`
        );

        console.log(
            '[PASS] OMDb proxy regression tests passed'
        );
    } finally {
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