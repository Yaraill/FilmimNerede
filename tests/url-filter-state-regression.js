const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function tmdbResponse(request, body, delay = 0) {
    const respond = () => {
        request.respond({
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: 'application/json',
            body: JSON.stringify(body)
        }).catch(() => {});
    };

    if (delay > 0) {
        setTimeout(respond, delay);
    } else {
        respond();
    }
}

async function ensureAdvancedPanelReady(page) {
    const panelSelector = '#advanced-search-panel';
    const toggleSelector = '#advanced-toggle-btn';

    await page.waitForSelector(panelSelector);
    await page.waitForSelector(toggleSelector);

    const getPanelState = () => page.$eval(
        panelSelector,
        panel => {
            const toggle =
                document.getElementById('advanced-toggle-btn');

            const style =
                window.getComputedStyle(panel);

            return {
                display: style.display,
                visibility: style.visibility,
                closing:
                    panel.classList.contains('closing'),
                expanded:
                    toggle?.getAttribute('aria-expanded') === 'true'
            };
        }
    );

    let state = await getPanelState();

    // Drawer kapanma animasyonundaysa önce tamamen kapanmasını bekle.
    if (state.closing) {
        await page.waitForFunction(() => {
            const panel =
                document.getElementById('advanced-search-panel');
            const toggle =
                document.getElementById('advanced-toggle-btn');

            if (!panel || !toggle) return false;

            const style =
                window.getComputedStyle(panel);

            return (
                style.display === 'none' &&
                !panel.classList.contains('closing') &&
                toggle.getAttribute('aria-expanded') === 'false'
            );
        }, {
            timeout: 2000
        });

        state = await getPanelState();
    }

    // Tamamen kapalıysa kullanıcı gibi toggle ile aç.
    if (
        !state.expanded ||
        state.display === 'none'
    ) {
        await page.click(toggleSelector);
    }

    // Açılma animasyonunun gerçekten bitmesini bekle.
    await page.waitForFunction(() => {
        const panel =
            document.getElementById('advanced-search-panel');
        const toggle =
            document.getElementById('advanced-toggle-btn');

        if (!panel || !toggle) return false;

        const style =
            window.getComputedStyle(panel);

        const rect =
            panel.getBoundingClientRect();

        const animationsDone =
            panel
                .getAnimations()
                .every(
                    animation =>
                        animation.playState !== 'running'
                );

        const transformSettled =
            style.transform === 'none' ||
            style.transform ===
                'matrix(1, 0, 0, 1, 0, 0)';

        return (
            toggle.getAttribute('aria-expanded') === 'true' &&
            !panel.classList.contains('closing') &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.pointerEvents !== 'none' &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth + 1 &&
            animationsDone &&
            transformSettled
        );
    }, {
        timeout: 2000
    });
}

async function clickAdvancedControl(page, selector) {
    await ensureAdvancedPanelReady(page);

    await page.waitForFunction(targetSelector => {
        const element = document.querySelector(targetSelector);
        if (!element) return false;

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.pointerEvents === 'none' ||
            Number.parseFloat(style.opacity) === 0 ||
            rect.width <= 0 ||
            rect.height <= 0
        ) {
            return false;
        }

        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        if (
            x < 0 ||
            y < 0 ||
            x > window.innerWidth ||
            y > window.innerHeight
        ) {
            return false;
        }

        const topElement = document.elementFromPoint(x, y);

        return topElement === element ||
            element.contains(topElement);
    }, {
        timeout: 2000
    }, selector);

    await page.click(selector);
}

async function waitForPlatformState(page, expected) {
    await page.waitForFunction(
        state => {
            const value = id => document.getElementById(id)?.value;
            const activeProviders = Array.from(
                document.querySelectorAll('.provider-filter-btn.active')
            ).map(button => button.id);
            const activeGenres = Array.from(
                document.querySelectorAll('.genre-pill-btn.active')
            ).map(button => {
                const match = button
                    .getAttribute('onclick')
                    ?.match(/^setGenre\('([^']*)'/);
                return match ? match[1] : null;
            });

            return (
                document.getElementById('platform')?.classList.contains('active-tab') &&
                value('mediaTypeFilter') === state.media &&
                value('genreFilter') === state.genres &&
                value('yearFilter') === state.year &&
                value('ratingFilter') === state.rating &&
                value('runtimeFilter') === state.runtime &&
                value('sortByFilter') === state.sort &&
                value('providerFilter') === state.provider &&
                (state.provider === '0'
                    ? activeProviders.length === 0
                    : activeProviders.includes(`btn-prov-${state.provider}`)) &&
                state.activeGenres.every(value => activeGenres.includes(value))
            );
        },
        { timeout: 10000 },
        expected
    );
}

async function runTest() {
    let server;
    let browser;
    const discoverRequests = [];
    const searchRequests = [];

    try {
        server = http.createServer((req, res) => {
            const urlPath = req.url.split('?')[0].split('#')[0];
            const filePath = path.join(
                ROOT_DIR,
                urlPath === '/' ? 'index.html' : urlPath
            );

            if (!filePath.startsWith(ROOT_DIR)) {
                res.writeHead(403);
                res.end('Forbidden');
                return;
            }

            fs.readFile(filePath, (error, content) => {
                if (error) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                const ext = path.extname(filePath).toLowerCase();
                res.writeHead(200, {
                    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
                });
                res.end(content);
            });
        });

        await new Promise(resolve => {
            server.listen(0, '127.0.0.1', resolve);
        });
        const port = server.address().port;

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        const pageErrors = [];

        page.on('pageerror', error => {
            pageErrors.push(error);
        });

        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', request => {
            const rawUrl = request.url();

            if (!rawUrl.includes('api.themoviedb.org')) {
                if (rawUrl.startsWith(`http://127.0.0.1:${port}`)) {
                    request.continue();
                } else {
                    request.abort();
                }
                return;
            }

            const url = new URL(rawUrl);
            if (
                url.pathname === '/3/genre/movie/list' ||
                url.pathname === '/3/genre/tv/list'
            ) {
                tmdbResponse(request, {
                    genres: [
                        { id: 18, name: 'Dram' },
                        { id: 35, name: 'Komedi' }
                    ]
                });
                return;
            }

            if (url.pathname.startsWith('/3/discover/')) {
                discoverRequests.push(rawUrl);
                const year =
                    url.searchParams.get('primary_release_year') ||
                    url.searchParams.get('first_air_date_year') ||
                    '';
                const sort = url.searchParams.get('sort_by') || '';
                const type = url.pathname.endsWith('/tv') ? 'tv' : 'movie';
                const isStaleFixture =
                    type === 'movie' &&
                    year === '2024' &&
                    sort === 'primary_release_date.asc';
                const title = year
                    ? `${isStaleFixture ? 'Stale' : 'Fresh'} ${year}`
                    : `Platform ${type}`;

                tmdbResponse(
                    request,
                    {
                        page: 1,
                        total_pages: 1,
                        results: [
                            {
                                id: isStaleFixture ? 62024 : (year === '2023' ? 62023 : 62001),
                                title: type === 'movie' ? title : undefined,
                                name: type === 'tv' ? title : undefined,
                                media_type: type,
                                popularity: 100,
                                vote_average: 8,
                                genre_ids: [35],
                                poster_path: null,
                                backdrop_path: null,
                                overview: `${title} overview`,
                                release_date: type === 'movie' ? `${year || '2025'}-01-01` : undefined,
                                first_air_date: type === 'tv' ? `${year || '2025'}-01-01` : undefined
                            }
                        ]
                    },
                    isStaleFixture ? 700 : 0
                );
                return;
            }

            if (url.pathname === '/3/search/multi') {
                searchRequests.push(rawUrl);
                tmdbResponse(request, {
                    page: 1,
                    total_pages: 1,
                    results: [
                        {
                            id: 63001,
                            title: 'Matrix Search Result',
                            media_type: 'movie',
                            popularity: 90,
                            vote_average: 8.5,
                            genre_ids: [18],
                            poster_path: null,
                            backdrop_path: null,
                            overview: 'Search result',
                            release_date: '1999-03-31'
                        }
                    ]
                });
                return;
            }

            if (/\/3\/movie\/\d+$/.test(url.pathname)) {
                tmdbResponse(request, { runtime: 100 });
                return;
            }

            if (url.pathname.includes('/watch/providers')) {
                tmdbResponse(request, { results: {} });
                return;
            }

            tmdbResponse(request, { results: [], cast: [], crew: [] });
        });

        const directHash =
            '#platform?media=movie&genres=35%2C18&year=2024&rating=7&runtime=120&sort=vote_average.desc&provider=8';
        await page.goto(
            `http://127.0.0.1:${port}/${directHash}`,
            { waitUntil: 'domcontentloaded', timeout: 30000 }
        );

        await waitForPlatformState(page, {
            media: 'movie',
            genres: '35,18',
            year: '2024',
            rating: '7',
            runtime: '120',
            sort: 'vote_average.desc',
            provider: '8',
            activeGenres: ['35', '18']
        });
        await page.waitForFunction(
            () => document.querySelector('#search-results .movie-title')?.textContent.includes('Fresh 2024'),
            { timeout: 10000 }
        );

        const directHashAfterLoad = await page.evaluate(() => window.location.hash);
        assert(
            directHashAfterLoad === directHash,
            `Direct platform URL should remain canonical (was ${directHashAfterLoad})`
        );

        const directDiscoverUrl = discoverRequests
            .map(value => new URL(value))
            .find(url => url.searchParams.get('primary_release_year') === '2024');
        assert(directDiscoverUrl, 'Direct URL should trigger a 2024 movie discover request');
        assert(
            directDiscoverUrl.searchParams.get('with_genres') === '35,18',
            'Discover request should include restored multi-genre state'
        );
        assert(
            directDiscoverUrl.searchParams.get('vote_average.gte') === '7',
            'Discover request should include restored rating'
        );
        assert(
            directDiscoverUrl.searchParams.get('with_watch_providers') === '8',
            'Discover request should include restored provider'
        );
        assert(
            directDiscoverUrl.searchParams.get('with_runtime.gte') === '90' &&
                directDiscoverUrl.searchParams.get('with_runtime.lte') === '105',
            'Discover request should include restored runtime bounds'
        );
        assert(
            directDiscoverUrl.searchParams.get('sort_by') === 'vote_average.desc',
            'Discover request should include restored sort order'
        );

        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForPlatformState(page, {
            media: 'movie',
            genres: '35,18',
            year: '2024',
            rating: '7',
            runtime: '120',
            sort: 'vote_average.desc',
            provider: '8',
            activeGenres: ['35', '18']
        });
        assert(
            await page.evaluate(() => window.location.hash) === directHash,
            'Refresh should preserve the platform filter URL'
        );

        await page.evaluate(() => navigate('platform'));
        await waitForPlatformState(page, {
            media: 'all',
            genres: '',
            year: '',
            rating: '0',
            runtime: '',
            sort: 'popularity.desc',
            provider: '0',
            activeGenres: ['']
        });

        await clickAdvancedControl(page, '.segment-btn[onclick="setMediaType(\'movie\', this)"]');
        await clickAdvancedControl(page, '.genre-pill-btn[onclick="setGenre(\'35\', this)"]');
        await page.select('#yearFilter', '2024');
        await page.click('#btn-prov-8');
        await waitForPlatformState(page, {
            media: 'movie',
            genres: '35',
            year: '2024',
            rating: '0',
            runtime: '',
            sort: 'popularity.desc',
            provider: '8',
            activeGenres: ['35']
        });
        assert(
            decodeURIComponent(await page.evaluate(() => window.location.hash)) ===
                '#platform?media=movie&genres=35&year=2024&provider=8',
            'Filter interactions should update the shareable platform URL'
        );

        await page.select('#yearFilter', '2023');
        await page.waitForFunction(
            () => document.getElementById('yearFilter')?.value === '2023'
        );

        await page.evaluate(() => history.back());
        await page.waitForFunction(
            () =>
                document.getElementById('yearFilter')?.value === '2024' &&
                window.location.hash.includes('year=2024'),
            { timeout: 10000 }
        );
        const documentYear = await page.evaluate(
            () => document.getElementById('yearFilter').value
        );
        assert(documentYear === '2024', 'Back navigation should restore year 2024');

        await page.evaluate(() => history.forward());
        await page.waitForFunction(
            () =>
                document.getElementById('yearFilter')?.value === '2023' &&
                window.location.hash.includes('year=2023'),
            { timeout: 10000 }
        );

        await page.evaluate(() => {
            window.location.hash =
                '#platform?media=hacker&genres=999&year=1900&rating=999&runtime=999&sort=evil&provider=-1&unknown=x';
        });
        await page.waitForFunction(
            () =>
                window.location.hash === '#platform' &&
                document.getElementById('mediaTypeFilter')?.value === 'all' &&
                document.getElementById('genreFilter')?.value === '' &&
                document.getElementById('yearFilter')?.value === '' &&
                document.getElementById('ratingFilter')?.value === '0' &&
                document.getElementById('runtimeFilter')?.value === '' &&
                document.getElementById('sortByFilter')?.value === 'popularity.desc' &&
                document.getElementById('providerFilter')?.value === '0',
            { timeout: 10000 }
        );

        await page.evaluate(() => {
            window.location.hash = '#search?q=Matrix';
        });
        await page.waitForFunction(
            () =>
                window.location.hash === '#search?q=Matrix' &&
                document.getElementById('searchInput')?.value === 'Matrix',
            { timeout: 10000 }
        );
        await page.waitForFunction(
            () => document.querySelector('#search-results .movie-title')?.textContent.includes('Matrix Search Result'),
            { timeout: 10000 }
        );
        assert(
            searchRequests.some(value => new URL(value).searchParams.get('query') === 'Matrix'),
            'Existing #search?q= route should continue to issue the expected search request'
        );

        await page.evaluate(() => navigate('platform'));
        await waitForPlatformState(page, {
            media: 'all',
            genres: '',
            year: '',
            rating: '0',
            runtime: '',
            sort: 'popularity.desc',
            provider: '0',
            activeGenres: ['']
        });
        
        await clickAdvancedControl(page, '.segment-btn[onclick="setMediaType(\'movie\', this)"]');
        await page.select('#sortByFilter', 'primary_release_date.asc');
        await page.select('#yearFilter', '2024');
        await page.select('#yearFilter', '2023');

        await page.waitForFunction(
            () => document.querySelector('#search-results .movie-title')?.textContent.includes('Fresh 2023'),
            { timeout: 10000 }
        );
        await new Promise(resolve => setTimeout(resolve, 900));
        const staleResultText = await page.$eval(
            '#search-results',
            element => element.textContent
        );
        assert(
            staleResultText.includes('Fresh 2023') && !staleResultText.includes('Stale 2024'),
            'A stale filtered request must not overwrite the latest route results'
        );
        assert(
            decodeURIComponent(await page.evaluate(() => window.location.hash)).includes('year=2023'),
            'Latest filter URL should remain on the fresh 2023 state'
        );

        assert(
            pageErrors.length === 0,
            `Unexpected page errors: ${pageErrors.map(error => error.message).join(', ')}`
        );

        console.log('URL filter state regression test passed.');
    } finally {
        if (browser) {
            await browser.close();
        }
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
    }
}

runTest().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
