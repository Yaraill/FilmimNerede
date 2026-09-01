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

const XSS_PAYLOAD =
    '<img src=x onerror="window.__xssExecuted=true">';

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
                        !filePath
                            .startsWith(
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
            .evaluateOnNewDocument(
                () => {
                    window.__xssExecuted =
                        false;
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
                    body => {
                        request
                            .respond({
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
                            })
                            .catch(
                                () => {}
                            );
                    };

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
                            genres: [
                                {
                                    id: 28,
                                    name:
                                        XSS_PAYLOAD
                                }
                            ]
                        });

                        return;
                    }

                    if (
                        url.includes(
                            '/trending/all/week'
                        )
                    ) {
                        respondJson({
                            results: [
                                {
                                    id: 91001,
                                    media_type:
                                        'movie',
                                    title:
                                        XSS_PAYLOAD,
                                    poster_path:
                                        null,
                                    genre_ids: []
                                },
                                {
                                    id: 91002,
                                    media_type:
                                        'person',
                                    name:
                                        'Top10 Person'
                                }
                            ]
                        });

                        return;
                    }

                    if (
                        url.includes(
                            '/person/popular'
                        )
                    ) {
                        const parsedUrl =
                            new URL(url);

                        const pageNumber =
                            parsedUrl
                                .searchParams
                                .get(
                                    'page'
                                );

                        respondJson({
                            results:
                                pageNumber ===
                                '1'
                                    ? [
                                        {
                                            id: 92001,
                                            name:
                                                '김민수',
                                            adult:
                                                false,
                                            popularity:
                                                100,
                                            profile_path:
                                                null,
                                            known_for: [
                                                {
                                                    id: 1,
                                                    adult:
                                                        false,
                                                    original_language:
                                                        'ko'
                                                }
                                            ]
                                        },
                                        {
                                            id: 92002,
                                            name:
                                                XSS_PAYLOAD,
                                            adult:
                                                false,
                                            popularity:
                                                99,
                                            profile_path:
                                                null,
                                            known_for: [
                                                {
                                                    id: 2,
                                                    adult:
                                                        false,
                                                    original_language:
                                                        'en'
                                                }
                                            ]
                                        }
                                    ]
                                    : []
                        });

                        return;
                    }

                    if (
                        url.includes(
                            '/search/person'
                        )
                    ) {
                        respondJson({
                            results: [
                                {
                                    id: 94001,
                                    name:
                                        XSS_PAYLOAD,
                                    profile_path:
                                        '/actor.jpg',
                                    known_for_department:
                                        'Acting',
                                    popularity:
                                        50
                                }
                            ]
                        });

                        return;
                    }

                    if (
                        url.includes(
                            '/watch/providers'
                        )
                    ) {
                        respondJson({
                            results: {
                                TR: {
                                    flatrate:
                                        []
                                }
                            }
                        });

                        return;
                    }

                    const collectionMatch =
                        url.match(
                            /\/collection\/(\d+)/
                        );

                    if (
                        collectionMatch
                    ) {
                        const id =
                            Number(
                                collectionMatch[
                                    1
                                ]
                            );

                        if (
                            id ===
                            86311
                        ) {
                            respondJson({
                                id,
                                name:
                                    XSS_PAYLOAD,
                                overview:
                                    XSS_PAYLOAD,
                                backdrop_path:
                                    null,
                                poster_path:
                                    null,
                                parts: [
                                    {
                                        id: 93001,
                                        title:
                                            XSS_PAYLOAD,
                                        overview:
                                            XSS_PAYLOAD,
                                        poster_path:
                                            null,
                                        backdrop_path:
                                            null,
                                        release_date:
                                            '2020-01-01',
                                        vote_average:
                                            7,
                                        genre_ids:
                                            []
                                    }
                                ]
                            });
                        } else {
                            respondJson({
                                id,
                                name:
                                    'Empty Collection',
                                parts: []
                            });
                        }

                        return;
                    }

                    // Recommendations/discover ve
                    // bu suite için özel mock
                    // gerektirmeyen diğer TMDB çağrıları.
                    respondJson({
                        results: [],
                        genres: []
                    });

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
                    .loadTop10Trending ===
                    'function' &&
                typeof window
                    .loadTrendingActors ===
                    'function' &&
                typeof window
                    .loadCuratedCollections ===
                    'function' &&
                typeof window
                    .loadSmartRecommendations ===
                    'function' &&
                typeof window
                    .getSafeHttpUrl ===
                    'function'
        );

        const result =
            await page.evaluate(
                async payload => {
                    const failures = [];

                    const check =
                        (
                            condition,
                            message
                        ) => {
                            if (!condition) {
                                failures.push(
                                    message
                                );
                            }
                        };

                    const wait =
                        ms =>
                            new Promise(
                                resolve =>
                                    setTimeout(
                                        resolve,
                                        ms
                                    )
                            );

                    // 1. app.js genre renderer
                    let discoverGenres =
                        document
                            .getElementById(
                                'discover-genres'
                            );

                    if (!discoverGenres) {
                        discoverGenres =
                            document
                                .createElement(
                                    'div'
                                );

                        discoverGenres.id =
                            'discover-genres';

                        document.body
                            .appendChild(
                                discoverGenres
                            );
                    }

                    await window
                        .loadGenres();

                    const genreText =
                        discoverGenres
                            .querySelector(
                                '.genre-pill-text'
                            );

                    check(
                        genreText &&
                        genreText
                            .textContent ===
                            payload,
                        'Genre payload should render as text'
                    );

                    check(
                        !discoverGenres
                            .querySelector(
                                'img[src="x"]'
                            ),
                        'Genre payload created attacker img'
                    );

                    // 2. Home Top 10
                    await window
                        .loadTop10Trending();

                    const top10 =
                        document
                            .getElementById(
                                'top10-grid'
                            );

                    const top10Cards =
                        top10
                            ?.querySelectorAll(
                                '.top10-card'
                            ) || [];

                    check(
                        top10Cards.length ===
                            1,
                        'Top10 should ignore person result'
                    );

                    const top10Image =
                        top10
                            ?.querySelector(
                                '.top10-card img'
                            );

                    check(
                        top10Image &&
                        top10Image.alt ===
                            payload,
                        'Top10 title should remain plain data'
                    );

                    check(
                        !top10
                            ?.querySelector(
                                'img[src="x"]'
                            ),
                        'Top10 payload created attacker img'
                    );

                    // 3. Trending actors + non-Latin regression
                    await window
                        .loadTrendingActors();

                    const actorNames =
                        Array.from(
                            document
                                .querySelectorAll(
                                    '#trending-actors-list .story-name'
                                )
                        )
                            .map(
                                element =>
                                    element
                                        .textContent
                            );

                    check(
                        actorNames.includes(
                            '김민수'
                        ),
                        'Non-Latin actor should render'
                    );

                    check(
                        actorNames.includes(
                            payload
                        ),
                        'Actor payload should render as text'
                    );

                    check(
                        !document
                            .querySelector(
                                '#trending-actors-list img[src="x"]'
                            ),
                        'Trending actor payload created attacker img'
                    );

                    // 4. Curated collection card
                    await window
                        .loadCuratedCollections();

                    const curatedImages =
                        Array.from(
                            document
                                .querySelectorAll(
                                    '#curated-collections-list img'
                                )
                        );

                    check(
                        curatedImages.some(
                            image =>
                                image.alt ===
                                payload
                        ),
                        'Collection name should remain plain data'
                    );

                    check(
                        !document
                            .querySelector(
                                '#curated-collections-list img[src="x"]'
                            ),
                        'Collection payload created attacker img'
                    );

                    // 5. Open collection header / overview
                    await window
                        .openCollection(
                            86311
                        );

                    const collectionHeading =
                        document
                            .querySelector(
                                '#search-results h2'
                            );

                    const collectionOverview =
                        document
                            .querySelector(
                                '#search-results > div p'
                            );

                    check(
                        collectionHeading &&
                        collectionHeading
                            .textContent ===
                            payload,
                        'Open collection name should be text'
                    );

                    check(
                        collectionOverview &&
                        collectionOverview
                            .textContent ===
                            payload,
                        'Open collection overview should be text'
                    );

                    check(
                        !document
                            .querySelector(
                                '#search-results img[src="x"]'
                            ),
                        'Open collection payload created attacker img'
                    );

                    // 6. createMovieCard representative regression
                    const cardHost =
                        document
                            .createElement(
                                'div'
                            );

                    cardHost.innerHTML =
                        window
                            .createMovieCard(
                                {
                                    id: 95001,
                                    title:
                                        payload,
                                    overview:
                                        payload,
                                    poster_path:
                                        null,
                                    genre_ids:
                                        [],
                                    media_type:
                                        'movie'
                                },
                                'movie',
                                ''
                            );

                    document.body
                        .appendChild(
                            cardHost
                        );

                    check(
                        cardHost
                            .querySelector(
                                '.movie-title'
                            )
                            ?.textContent
                            .includes(
                                payload
                            ),
                        'Movie-card payload should render as text'
                    );

                    check(
                        !cardHost
                            .querySelector(
                                'img[src="x"]'
                            ),
                        'Movie-card payload created attacker img'
                    );

                    // 7. Actor autocomplete representative regression
                    const actorInput =
                        document
                            .getElementById(
                                'actor1-input'
                            );

                    actorInput.value =
                        'XSSACTOR';

                    window
                        .handleActorAutocomplete(
                            {
                                target:
                                    actorInput
                            },
                            1
                        );

                    await wait(
                        700
                    );

                    const actorSuggestion =
                        document
                            .querySelector(
                                '#actor1-autocomplete .suggestion-title'
                            );

                    check(
                        actorSuggestion &&
                        actorSuggestion
                            .textContent ===
                            payload,
                        'Actor autocomplete payload should render as text'
                    );

                    check(
                        !document
                            .querySelector(
                                '#actor1-autocomplete img[src="x"]'
                            ),
                        'Actor autocomplete payload created attacker img'
                    );

                    // 8. malformed movieRatings regression
                    localStorage.setItem(
                        'ratedMovies',
                        JSON.stringify([
                            {
                                id: 96001,
                                media_type:
                                    'movie'
                            }
                        ])
                    );

                    localStorage.setItem(
                        'movieRatings',
                        'null'
                    );

                    let malformedRatingsThrew =
                        false;

                    try {
                        await window
                            .loadSmartRecommendations();
                    } catch (error) {
                        malformedRatingsThrew =
                            true;
                    }

                    check(
                        malformedRatingsThrew ===
                            false,
                        'movieRatings=null should not crash smart recommendations'
                    );

                    localStorage.removeItem(
                        'ratedMovies'
                    );

                    localStorage.removeItem(
                        'movieRatings'
                    );

                    // 9. URL-context regression
                    const javascriptUrl =
                        window
                            .getSafeHttpUrl(
                                'javascript:window.__xssExecuted=true',
                                '#'
                            );

                    const dataUrl =
                        window
                            .getSafeHttpUrl(
                                'data:text/html,<script>window.__xssExecuted=true</script>',
                                '#'
                            );

                    check(
                        javascriptUrl ===
                            '#',
                        'javascript: URL should be rejected'
                    );

                    check(
                        dataUrl ===
                            '#',
                        'data: URL should be rejected'
                    );

                    const link =
                        document
                            .createElement(
                                'a'
                            );

                    link.href =
                        javascriptUrl;

                    check(
                        link
                            .getAttribute(
                                'href'
                            ) === '#',
                        'Unsafe URL became clickable href'
                    );

                    const embedHost =
                        document
                            .createElement(
                                'div'
                            );

                    const mounted =
                        window
                            .mountYouTubeEmbed(
                                embedHost,
                                'javascript:',
                                {
                                    autoplay:
                                        '1'
                                }
                            );

                    check(
                        mounted ===
                            false,
                        'Invalid YouTube ID should not mount'
                    );

                    check(
                        !embedHost
                            .querySelector(
                                'iframe'
                            ),
                        'Invalid YouTube ID created iframe'
                    );

                    await wait(
                        150
                    );

                    check(
                        window
                            .__xssExecuted ===
                            false,
                        'XSS sentinel executed'
                    );

                    check(
                        !document
                            .querySelector(
                                'img[src="x"]'
                            ),
                        'Attacker img element exists in DOM'
                    );

                    return {
                        pass:
                            failures
                                .length ===
                            0,
                        failures
                    };
                },
                XSS_PAYLOAD
            );

        assert(
            result.pass,
            `XSS regression failures:\n${result.failures.join('\n')}`
        );

        assert(
            pageErrors.length === 0,
            `Uncaught page errors:\n${pageErrors.join('\n')}`
        );

        console.log(
            '[PASS] XSS regression tests passed'
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
            '[FAIL] XSS regression test:',
            error
        );

        process.exit(1);
    });