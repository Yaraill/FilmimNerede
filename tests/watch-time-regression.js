const fs =
    require('fs');

const path =
    require('path');

const vm =
    require('vm');
const { toTmdbApiUrl } = require('./helpers/tmdb-proxy-shim');

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

function createLocalStorage() {
    const data =
        new Map();

    return {
        getItem(key) {
            return data.has(key)
                ? data.get(key)
                : null;
        },

        setItem(
            key,
            value
        ) {
            data.set(
                key,
                String(value)
            );
        },

        removeItem(key) {
            data.delete(
                key
            );
        }
    };
}

async function runTest() {
    const securitySource =
        fs.readFileSync(
            path.join(
                ROOT_DIR,
                'js',
                'runtime',
                'security.js'
            ),
            'utf8'
        );

    const profileSource =
        fs.readFileSync(
            path.join(
                ROOT_DIR,
                'js',
                'runtime',
                'profile.js'
            ),
            'utf8'
        );

    const context = {
        console,
        URL,
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout,
        BASE_URL:
            'https://api.themoviedb.org/3',
        localStorage:
            createLocalStorage(),
        document: {},
        fetch:
            async () => {
                throw new Error(
                    'fetch mock not installed'
                );
            }
    };

    context.window =
        context;

    vm.createContext(
        context
    );

    vm.runInContext(
        securitySource,
        context,
        {
            filename:
                'security.js'
        }
    );

    vm.runInContext(
        profileSource,
        context,
        {
            filename:
                'profile.js'
        }
    );

    assert(
        typeof context
            .calculateExactWatchTime ===
            'function',
        'calculateExactWatchTime was not loaded'
    );

    let activeRequests = 0;
    let maxActiveRequests = 0;

    const requestCounts =
        new Map();

    const responseData =
        new Map([
            [
                'movie:101',
                {
                    runtime: 100
                }
            ],
            [
                'tv:202',
                {
                    episode_run_time:
                        [50],
                    number_of_episodes:
                        10
                }
            ],
            [
                'movie:303',
                {
                    runtime:
                        'abc'
                }
            ],
            [
                'tv:505',
                {
                    episode_run_time:
                        [null],
                    number_of_episodes:
                        4
                }
            ]
        ]);

    context.fetch =
        (
            url,
            options = {}
        ) =>
            new Promise(
                (
                    resolve,
                    reject
                ) => {
                    const parsed =
                        new URL(toTmdbApiUrl(url));

                    const match =
                        parsed.pathname.match(
                            /\/3\/(movie|tv)\/(\d+)$/
                        );

                    if (!match) {
                        reject(
                            new Error(
                                `Unexpected URL: ${url}`
                            )
                        );

                        return;
                    }

                    const key =
                        `${match[1]}:${match[2]}`;

                    requestCounts.set(
                        key,
                        (
                            requestCounts.get(
                                key
                            ) ||
                            0
                        ) +
                        1
                    );

                    activeRequests++;

                    maxActiveRequests =
                        Math.max(
                            maxActiveRequests,
                            activeRequests
                        );

                    let settled = false;

                    const finish =
                        callback => {
                            if (settled) {
                                return;
                            }

                            settled =
                                true;

                            activeRequests =
                                Math.max(
                                    0,
                                    activeRequests -
                                        1
                                );

                            callback();
                        };

                    const timer =
                        setTimeout(
                            () => {
                                finish(
                                    () => {
                                        if (
                                            key === 'movie:404' || key === 'tv:606'
                                        ) {
                                            resolve({
                                                ok: false,
                                                status: 500,
                                                json:
                                                    async () =>
                                                        ({})
                                            });

                                            return;
                                        }

                                        resolve({
                                            ok: true,
                                            status: 200,
                                            json:
                                                async () =>
                                                    responseData.get(
                                                        key
                                                    ) ||
                                                    {}
                                        });
                                    }
                                );
                            },
                            60
                        );

                    const signal =
                        options.signal;

                    if (signal) {
                        const onAbort =
                            () => {
                                clearTimeout(
                                    timer
                                );

                                finish(
                                    () => {
                                        const error =
                                            new Error(
                                                'Aborted'
                                            );

                                        error.name =
                                            'AbortError';

                                        reject(
                                            error
                                        );
                                    }
                                );
                            };

                        if (
                            signal.aborted
                        ) {
                            onAbort();
                        } else {
                            signal
                                .addEventListener(
                                    'abort',
                                    onAbort,
                                    {
                                        once: true
                                    }
                                );
                        }
                    }
                }
            );

    const ratedMovies = [
        {
            id: 101,
            media_type:
                'movie'
        },
        {
            id: '101',
            media_type:
                'movie'
        },
        {
            id: 202,
            media_type:
                'tv'
        },
        {
            id: 303,
            media_type:
                'movie',
            exact_runtime_mins_v2:
                'not-a-number'
        },
        {
            id: 404,
            media_type:
                'movie'
        },
        {
            id: 505,
            media_type:
                'tv'
        },
        {
            id: true,
            media_type:
                'movie'
        }
    ];

    const totalMinutes =
        await context
            .calculateExactWatchTime(
                ratedMovies
            );

    assert(
        maxActiveRequests <=
            4,
        `Watch-time concurrency exceeded 4: ${maxActiveRequests}`
    );

    assert(
        maxActiveRequests > 1,
        'Watch-time fetches are still sequential'
    );

    assert(
        requestCounts.get(
            'movie:101'
        ) === 1,
        'Duplicate movie:101 generated duplicate network requests'
    );

    assert(
        Number.isFinite(
            totalMinutes
        ),
        'Watch-time result became NaN/Infinity'
    );

    // movie:101 appears twice:
    // 100 + 100
    //
    // tv:202:
    // 50 * 10 = 500
    //
    // movie:303:
    // invalid runtime => 120
    //
    // movie:404:
    // normal failure => 120
    //
    // tv:505:
    // invalid episode runtime => 45 * 4 = 180
    assert(
        totalMinutes ===
            1120,
        `Unexpected mixed watch-time total: ${totalMinutes}`
    );

    assert(
        requestCounts.get(
            'movie:404'
        ) === 1,
        'Failure test request was not executed'
    );

    const countRequests = () => [...requestCounts.values()].reduce((sum, count) => sum + count, 0);
    const requestsBeforeTracked = countRequests();
    const showWithEpisodeRuntimes = {
        id: 202,
        watched: ['S1E1', 'S1E2'],
        episodeRuntimes: { S1E1: 58, S1E2: 48 }
    };
    const trackedOnlyMinutes = await context.calculateExactWatchTime([], null, [
        showWithEpisodeRuntimes,
        { ...showWithEpisodeRuntimes, id: '202' }
    ]);
    assert(trackedOnlyMinutes === 106, `Unexpected tracked-only total: ${trackedOnlyMinutes}`);
    assert(countRequests() === requestsBeforeTracked, 'Known episode runtimes should require no fetch');

    const cachedTvRuntimes = new Map();
    context.updateTvShowAvgRuntime = (id, minutes) => cachedTvRuntimes.set(id, minutes);
    const showWithMissingRuntime = { id: 202, watched: ['S1E1', 'S1E2'], episodeRuntimes: { S1E1: 58 } };
    const previousTvRequests = requestCounts.get('tv:202');
    const fetchedTvMinutes = await context.calculateExactWatchTime([], null, [showWithMissingRuntime]);
    assert(fetchedTvMinutes === 108, `Unexpected total using a fetched series runtime: ${fetchedTvMinutes}`);
    assert(requestCounts.get('tv:202') === previousTvRequests + 1, 'Missing episode runtime should fetch /3/tv/202');
    assert(cachedTvRuntimes.get(202) === 50, 'Fetched series runtime was not cached');
    const cachedTvMinutes = await context.calculateExactWatchTime([], null, [{
        ...showWithMissingRuntime, avgEpisodeRuntime: cachedTvRuntimes.get(202)
    }]);
    assert(cachedTvMinutes === 108 && requestCounts.get('tv:202') === previousTvRequests + 1,
        'Cached series runtime should prevent a repeat fetch');

    const fallbackTvMinutes = await context.calculateExactWatchTime([], null, [{ id: 606, watched: ['S1E1'] }]);
    assert(fallbackTvMinutes === 45 && requestCounts.get('tv:606') === 1, 'Failed tracked TV fetch should use 45 minutes');
    assert(!cachedTvRuntimes.has(606), 'Failed request should leave the runtime cache available for a retry');

    const requestsBeforeOverlap = countRequests();
    const minutesWithoutOverlap = await context.calculateExactWatchTime(
        [{ id: 202, media_type: 'tv', exact_runtime_mins_v2: 500 }],
        null,
        [{ id: 202, watched: ['S1E1', 'S1E2', 'S1E3'], avgEpisodeRuntime: 50 }]
    );
    assert(minutesWithoutOverlap === 150, `Rated series and tracked episodes were double-counted: ${minutesWithoutOverlap}`);
    assert(countRequests() === requestsBeforeOverlap, 'Cached runtimes and tracked episodes should require no fetch');

    for (const [minutes, approximate, expected] of [
        [0, false, '0s'], [48, false, '48d'], [106, false, '1s 46d'], [120, false, '2s'],
        [48, true, '~48d'], [106, true, '~1s']
    ]) {
        assert(context.formatWatchTimeDuration(minutes, approximate) === expected, `Expected duration ${expected}`);
    }

    // -------------------------------------------------
    // AbortError must propagate.
    // -------------------------------------------------
    context.fetch =
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
                    const timer =
                        setTimeout(
                            () => {
                                resolve({
                                    ok: true,
                                    status: 200,
                                    json:
                                        async () => ({
                                            runtime:
                                                90
                                        })
                                });
                            },
                            250
                        );

                    if (!signal) {
                        return;
                    }

                    const abort =
                        () => {
                            clearTimeout(
                                timer
                            );

                            const error =
                                new Error(
                                    'Aborted'
                                );

                            error.name =
                                'AbortError';

                            reject(
                                error
                            );
                        };

                    if (
                        signal.aborted
                    ) {
                        abort();
                    } else {
                        signal
                            .addEventListener(
                                'abort',
                                abort,
                                {
                                    once: true
                                }
                            );
                    }
                }
            );

    const controller =
        new AbortController();

    const abortedCalculation =
        context
            .calculateExactWatchTime(
                [
                    {
                        id: 777,
                        media_type:
                            'movie'
                    }
                ],
                controller.signal
            );

    setTimeout(
        () => {
            controller.abort();
        },
        20
    );

    let abortErrorName =
        null;

    try {
        await abortedCalculation;
    } catch (error) {
        abortErrorName =
            error.name;
    }

    assert(
        abortErrorName ===
            'AbortError',
        'AbortError was swallowed as a normal watch-time failure'
    );

    const functionSource =
        context
            .calculateExactWatchTime
            .toString();

    assert(
        !/(innerHTML|innerText|textContent)\s*=/.test(
            functionSource
        ),
        'Watch-time error path writes directly to visible DOM'
    );

    assert(
        !/error\.(message|stack)/.test(
            functionSource
        ),
        'Watch-time function exposes raw error details'
    );

    console.log(
        '[PASS] Watch-time regression tests passed'
    );
}

runTest()
    .then(
        () =>
            process.exit(0)
    )
    .catch(error => {
        console.error(
            '[FAIL] Watch-time regression:',
            error
        );

        process.exit(1);
    });
