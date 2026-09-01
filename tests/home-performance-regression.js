const http =
    require('http');

const fs =
    require('fs');

const path =
    require('path');

const puppeteer =
    require('puppeteer');

const ROOT_DIR =
    path.resolve(
        __dirname,
        '..'
    );

const MIME_TYPES = {
    '.html':
        'text/html',
    '.js':
        'text/javascript',
    '.css':
        'text/css',
    '.json':
        'application/json',
    '.png':
        'image/png',
    '.jpg':
        'image/jpeg',
    '.jpeg':
        'image/jpeg',
    '.webp':
        'image/webp',
    '.svg':
        'image/svg+xml',
    '.ico':
        'image/x-icon'
};

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

async function runTest() {
    let server;
    let browser;

    let actorRequestCount = 0;
    let actorActive = 0;
    let actorMaxActive = 0;

    let collectionRequestCount = 0;
    let collectionActive = 0;
    let collectionMaxActive = 0;

    try {
        server =
            http.createServer(
                (req, res) => {
                    const urlPath =
                        req.url
                            .split('?')[0]
                            .split('#')[0];

                    const filePath =
                        path.join(
                            ROOT_DIR,
                            urlPath === '/'
                                ? 'index.html'
                                : urlPath
                        );

                    if (
                        !filePath.startsWith(
                            ROOT_DIR
                        )
                    ) {
                        res.writeHead(
                            403
                        );

                        res.end(
                            'Forbidden'
                        );

                        return;
                    }

                    fs.readFile(
                        filePath,
                        (
                            error,
                            content
                        ) => {
                            if (error) {
                                res.writeHead(
                                    404
                                );

                                res.end(
                                    'Not found'
                                );

                                return;
                            }

                            const ext =
                                path
                                    .extname(
                                        filePath
                                    )
                                    .toLowerCase();

                            res.writeHead(
                                200,
                                {
                                    'Content-Type':
                                        MIME_TYPES[
                                            ext
                                        ] ||
                                        'application/octet-stream'
                                }
                            );

                            res.end(
                                content
                            );
                        }
                    );
                }
            );

        await new Promise(
            resolve => {
                server.listen(
                    0,
                    '127.0.0.1',
                    resolve
                );
            }
        );

        const port =
            server.address()
                .port;

        const localOrigin =
            `http://127.0.0.1:${port}`;

        browser =
            await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox'
                ]
            });

        const page =
            await browser.newPage();

        const pageErrors = [];

        page.on(
            'pageerror',
            error => {
                pageErrors.push(
                    String(error)
                );
            }
        );

        await page
            .setBypassServiceWorker(
                true
            );

        await page
            .setRequestInterception(
                true
            );

        page.on(
            'request',
            request => {
                const url =
                    request.url();

                const respondJson =
                    body =>
                        request.respond({
                            status: 200,
                            headers: {
                                'Access-Control-Allow-Origin':
                                    '*'
                            },
                            contentType:
                                'application/json',
                            body:
                                JSON.stringify(
                                    body
                                )
                        });

                if (
                    request.method() ===
                    'OPTIONS'
                ) {
                    request.respond({
                        status: 200,
                        headers: {
                            'Access-Control-Allow-Origin':
                                '*',
                            'Access-Control-Allow-Methods':
                                'GET, POST, OPTIONS',
                            'Access-Control-Allow-Headers':
                                '*'
                        }
                    });

                    return;
                }

                if (
                    url.includes(
                        'api.themoviedb.org'
                    )
                ) {
                    if (
                        url.includes(
                            '/genre/movie/list'
                        ) ||
                        url.includes(
                            '/genre/tv/list'
                        )
                    ) {
                        respondJson({
                            genres: []
                        }).catch(
                            () => {}
                        );

                        return;
                    }

                    if (
                        url.includes(
                            '/person/popular'
                        )
                    ) {
                        actorRequestCount++;
                        actorActive++;

                        actorMaxActive =
                            Math.max(
                                actorMaxActive,
                                actorActive
                            );

                        const parsedUrl =
                            new URL(url);

                        const pageNumber =
                            Number(
                                parsedUrl
                                    .searchParams
                                    .get(
                                        'page'
                                    )
                            );

                        const results =
                            [0, 1, 2]
                                .map(index => ({
                                    id:
                                        pageNumber *
                                            100 +
                                        index +
                                        1,
                                    name:
                                        `Actor ${pageNumber}-${index + 1}`,
                                    adult:
                                        false,
                                    popularity:
                                        100 -
                                        index,
                                    profile_path:
                                        null,
                                    known_for: [
                                        {
                                            id:
                                                pageNumber *
                                                    1000 +
                                                index,
                                            adult:
                                                false,
                                            original_language:
                                                index === 0
                                                    ? 'ko'
                                                    : 'en'
                                        }
                                    ]
                                }));

                        setTimeout(
                            async () => {
                                try {
                                    await respondJson({
                                        results
                                    });
                                } catch (
                                    error
                                ) {
                                    // Route değişiminde
                                    // request abort edilmiş olabilir.
                                } finally {
                                    actorActive =
                                        Math.max(
                                            0,
                                            actorActive -
                                                1
                                        );
                                }
                            },
                            120
                        );

                        return;
                    }

                    const collectionMatch =
                        url.match(
                            /\/collection\/(\d+)/
                        );

                    if (
                        collectionMatch
                    ) {
                        collectionRequestCount++;
                        collectionActive++;

                        collectionMaxActive =
                            Math.max(
                                collectionMaxActive,
                                collectionActive
                            );

                        const collectionId =
                            Number(
                                collectionMatch[
                                    1
                                ]
                            );

                        setTimeout(
                            async () => {
                                try {
                                    await respondJson({
                                        id:
                                            collectionId,
                                        name:
                                            `Collection ${collectionId}`,
                                        backdrop_path:
                                            null,
                                        poster_path:
                                            null,
                                        parts: [
                                            {
                                                id:
                                                    1000000 +
                                                    collectionId,
                                                title:
                                                    `Movie ${collectionId}`,
                                                poster_path:
                                                    null,
                                                backdrop_path:
                                                    null,
                                                overview:
                                                    '',
                                                release_date:
                                                    '2020-01-01',
                                                vote_average:
                                                    7,
                                                genre_ids:
                                                    []
                                            }
                                        ]
                                    });
                                } catch (
                                    error
                                ) {
                                    // Abort edilmiş request.
                                } finally {
                                    collectionActive =
                                        Math.max(
                                            0,
                                            collectionActive -
                                                1
                                        );
                                }
                            },
                            120
                        );

                        return;
                    }

                    respondJson({
                        results: [],
                        genres: []
                    }).catch(
                        () => {}
                    );

                    return;
                }

                if (
                    url.startsWith(
                        localOrigin
                    )
                ) {
                    request.continue();

                    return;
                }

                request
                    .abort()
                    .catch(
                        () => {}
                    );
            }
        );

        await page.goto(
            `${localOrigin}/#profile`,
            {
                waitUntil:
                    'domcontentloaded',
                timeout: 30000
            }
        );

        await page.waitForFunction(
            () =>
                typeof window
                    .loadTrendingActors ===
                    'function' &&
                typeof window
                    .loadCuratedCollections ===
                    'function' &&
                typeof window
                    .navigate ===
                    'function'
        );

        actorRequestCount = 0;
        actorActive = 0;
        actorMaxActive = 0;

        collectionRequestCount = 0;
        collectionActive = 0;
        collectionMaxActive = 0;

        // -------------------------------------------------
        // Actor concurrency + in-flight dedup
        // -------------------------------------------------
        const actorResult =
            await page.evaluate(
                async () => {
                    await Promise.all([
                        window
                            .loadTrendingActors(),
                        window
                            .loadTrendingActors()
                    ]);

                    return {
                        cards:
                            document
                                .querySelectorAll(
                                    '#trending-actors-list .story-item'
                                )
                                .length
                    };
                }
            );

        assert(
            actorRequestCount ===
                8,
            `Actor in-flight dedup failed: expected 8 requests, got ${actorRequestCount}`
        );

        assert(
            actorMaxActive <=
                3,
            `Actor concurrency exceeded limit: ${actorMaxActive}`
        );

        assert(
            actorResult.cards > 0 &&
                actorResult.cards <=
                    20,
            `Unexpected actor card count: ${actorResult.cards}`
        );

        // -------------------------------------------------
        // Actor TTL cache
        // -------------------------------------------------
        const actorRequestsAfterFirstLoad =
            actorRequestCount;

        await page.evaluate(
            async () => {
                await window
                    .loadTrendingActors();
            }
        );

        assert(
            actorRequestCount ===
                actorRequestsAfterFirstLoad,
            'Actor TTL cache triggered new network requests'
        );

        // -------------------------------------------------
        // Collection concurrency + per-ID in-flight dedup
        // -------------------------------------------------
        const collectionResult =
            await page.evaluate(
                async () => {
                    await Promise.all([
                        window
                            .loadCuratedCollections(),
                        window
                            .loadCuratedCollections()
                    ]);

                    return {
                        cards:
                            document
                                .querySelectorAll(
                                    '#curated-collections-list .movie-card'
                                )
                                .length
                    };
                }
            );

        assert(
            collectionRequestCount ===
                31,
            `Collection in-flight dedup failed: expected 31 requests, got ${collectionRequestCount}`
        );

        assert(
            collectionMaxActive <=
                4,
            `Collection concurrency exceeded limit: ${collectionMaxActive}`
        );

        assert(
            collectionResult.cards ===
                31,
            `Unexpected collection card count: ${collectionResult.cards}`
        );

        // -------------------------------------------------
        // Collection TTL cache
        // -------------------------------------------------
        const collectionRequestsAfterFirstLoad =
            collectionRequestCount;

        await page.evaluate(
            async () => {
                await window
                    .loadCuratedCollections();
            }
        );

        assert(
            collectionRequestCount ===
                collectionRequestsAfterFirstLoad,
            'Collection TTL cache triggered new network requests'
        );

        // -------------------------------------------------
        // Stale route regression:
        // Hem actor hem collection container korunmalı.
        //
        // Date.now ileri alınarak iki cache de TTL dışına
        // çıkarılıyor. Home açıldıktan hemen sonra games'e
        // geçiliyor. Eski home async sonuçları iki container'ı
        // da overwrite etmemeli.
        // -------------------------------------------------
        const staleResult =
            await page.evaluate(
                async () => {
                    const actorContainer =
                        document.getElementById(
                            'trending-actors-list'
                        );

                    actorContainer
                        .replaceChildren();

                    const actorMarker =
                        document
                            .createElement(
                                'div'
                            );

                    actorMarker.id =
                        'stale-route-marker';

                    actorMarker.textContent =
                        'KEEP';

                    actorContainer
                        .appendChild(
                            actorMarker
                        );

                    const collectionContainer =
                        document.getElementById(
                            'curated-collections-list'
                        );

                    collectionContainer
                        .replaceChildren();

                    const collectionMarker =
                        document.createElement(
                            'div'
                        );

                    collectionMarker.id =
                        'stale-collection-marker';

                    collectionMarker.textContent =
                        'KEEP';

                    collectionContainer
                        .appendChild(
                            collectionMarker
                        );

                    const originalDateNow =
                        Date.now;

                    const baseNow =
                        originalDateNow();

                    Date.now =
                        () =>
                            baseNow +
                            11 *
                                60 *
                                1000;

                    try {
                        window.navigate(
                            'home'
                        );

                        await new Promise(
                            resolve =>
                                setTimeout(
                                    resolve,
                                    30
                                )
                        );

                        window.navigate(
                            'games'
                        );

                        await new Promise(
                            resolve =>
                                setTimeout(
                                    resolve,
                                    350
                                )
                        );

                        return {
                            actorMarkerStillExists:
                                Boolean(
                                    document
                                        .getElementById(
                                            'stale-route-marker'
                                        )
                                ),

                            staleActorCards:
                                actorContainer
                                    .querySelectorAll(
                                        '.story-item'
                                    )
                                    .length,

                            collectionMarkerStillExists:
                                Boolean(
                                    document
                                        .getElementById(
                                            'stale-collection-marker'
                                        )
                                ),

                            staleCollectionCards:
                                collectionContainer
                                    .querySelectorAll(
                                        '.movie-card'
                                    )
                                    .length,

                            hash:
                                window
                                    .location
                                    .hash
                        };
                    } finally {
                        Date.now =
                            originalDateNow;
                    }
                }
            );

        assert(
            staleResult.hash ===
                '#games',
            `Expected games route, got ${staleResult.hash}`
        );

        assert(
            staleResult
                .actorMarkerStillExists ===
                true,
            'Stale home request overwrote actor DOM after route change'
        );

        assert(
            staleResult
                .staleActorCards ===
                0,
            'Stale actor cards rendered after route change'
        );

        assert(
            staleResult
                .collectionMarkerStillExists ===
                true,
            'Stale home request overwrote collection DOM after route change'
        );

        assert(
            staleResult
                .staleCollectionCards ===
                0,
            'Stale collection cards rendered after route change'
        );

        assert(
            actorMaxActive <=
                3,
            `Actor concurrency exceeded limit during stale-route test: ${actorMaxActive}`
        );

        assert(
            collectionMaxActive <=
                4,
            `Collection concurrency exceeded limit during stale-route test: ${collectionMaxActive}`
        );

        assert(
            pageErrors.length ===
                0,
            `Uncaught page errors:\n${pageErrors.join('\n')}`
        );

        console.log(
            '[PASS] Home performance regression tests passed'
        );

        console.log(
            `[INFO] actor max concurrency: ${actorMaxActive}`
        );

        console.log(
            `[INFO] collection max concurrency: ${collectionMaxActive}`
        );
    } finally {
        if (browser) {
            await browser.close();
        }

        if (server) {
            await new Promise(
                resolve =>
                    server.close(
                        resolve
                    )
            );
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
            '[FAIL] Home performance regression:',
            error
        );

        process.exit(1);
    });