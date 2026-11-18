const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { toTmdbApiUrl } = require('./helpers/tmdb-proxy-shim');

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
        await page.waitForFunction(targetSelector => {
            const element = document.querySelector(targetSelector);
            if (!element) return false;
            element.scrollIntoView({ block: 'center', inline: 'nearest' });
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
                return false;
            }
            const topElement = document.elementFromPoint(x, y);
            return topElement === element || element.contains(topElement);
        }, { timeout: 2000 }, toggleSelector);
        try {
            await page.click(toggleSelector);
        } catch (_) {}
        if (!await page.$eval(toggleSelector, el => el.getAttribute('aria-expanded') === 'true')) {
            await page.$eval(toggleSelector, el => el.click());
        }
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
        timeout: 4000
    }).catch(async error => {
        const debug = await page.evaluate(() => {
            const panel = document.getElementById('advanced-search-panel');
            const toggle = document.getElementById('advanced-toggle-btn');
            const style = panel ? window.getComputedStyle(panel) : null;
            return {
                expanded: toggle?.getAttribute('aria-expanded'),
                closing: panel?.classList.contains('closing'),
                display: style?.display,
                transform: style?.transform,
                rect: panel?.getBoundingClientRect(),
                scrollY: window.scrollY
            };
        });
        throw new Error(`Drawer ready failed: ${JSON.stringify(debug)}`, { cause: error });
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

async function testMyPlatforms(page, discoverRequests) {
    await page.evaluate(() => {
        const panel = document.getElementById('advanced-search-panel');
        const toggleBtn = document.getElementById('advanced-toggle-btn');
        if (toggleBtn?.getAttribute('aria-expanded') === 'true' && typeof toggleAdvancedSearch === 'function') {
            toggleAdvancedSearch();
        }
        if (panel) {
            panel.classList.remove('closing');
            panel.style.display = 'none';
        }
        toggleBtn?.setAttribute('aria-expanded', 'false');
    });

    const toggle = '#my-platforms-toggle-btn';
    const edit = '#my-platforms-edit-btn';
    const chip = id => `.my-platform-chip[data-provider-id="${id}"]`;
    const clickControl = async (selector, readStateFn) => {
        const before = await page.evaluate(readStateFn, selector);
        try {
            await page.click(selector);
        } catch (_) {}
        const after = await page.evaluate(readStateFn, selector);
        if (after === before) {
            await page.$eval(selector, el => el.click());
        }
    };
    const readPressed = sel => document.querySelector(sel)?.getAttribute('aria-pressed');
    const readExpanded = sel => document.querySelector(sel)?.getAttribute('aria-expanded');
    const readPickerExpanded = () => document.querySelector('#my-platforms-edit-btn')?.getAttribute('aria-expanded');
    const readProvActive = sel => document.querySelector(sel)?.classList.contains('active');
    const clickToggle = () => clickControl(toggle, readPressed);
    const clickEdit = () => clickControl(edit, readExpanded);
    const clickChip = id => clickControl(chip(id), readPressed);
    const requests = (providerList, countFrom = 0) => discoverRequests.slice(countFrom).filter(value => {
        const params = new URL(value).searchParams;
        return params.get('with_watch_providers') === providerList &&
            params.get('watch_region') === (providerList === null ? null : 'TR');
    });
    const waitForDiscover = async (providerList, countFrom) => {
        await page.waitForSelector('#search-results .movie-card:not(.skeleton-card)');
        assert(requests(providerList, countFrom).length > 0, `Expected a new discover request for ${providerList}`);
    };
    const waitForTitles = titles => page.waitForFunction(expected => {
        const found = [...document.querySelectorAll('#search-results .movie-title-btn')];
        return found.length === expected.length &&
            expected.every(title => found.some(button => button.textContent.includes(title)));
    }, {}, titles);

    await page.evaluate(() => navigate('platform?provider=8'));
    await page.waitForSelector('#btn-prov-8.active');
    await clickControl(toggle, readPickerExpanded);
    await page.waitForSelector('#my-platforms-picker', { visible: true });
    assert(
        await page.$eval(edit, button => button.getAttribute('aria-expanded')) === 'true' &&
        await page.$eval(toggle, button => button.getAttribute('aria-pressed')) === 'false',
        'The empty filter should open the picker without enabling subscription mode'
    );

    const desktopViewport = page.viewport();
    await page.setViewport({ width: 360, height: 800 });
    assert(await page.evaluate(() => {
        const allButtons = [...document.querySelectorAll('.provider-filter-btn, .my-platform-chip')];
        const fits = () => allButtons.every(button => {
            const bounds = button.getBoundingClientRect();
            return bounds.width > 0 && bounds.left >= 0 && bounds.right <= innerWidth;
        });
        const darkFits = fits();
        document.body.classList.add('light-theme');
        const lightFits = fits();
        document.body.classList.remove('light-theme');
        return darkFits && lightFits;
    }), 'Provider buttons and chips should fit a mobile viewport in both themes');
    await page.setViewport(desktopViewport);

    await clickChip(11);
    await clickChip(337);
    assert(await page.evaluate(() =>
        document.querySelectorAll('.provider-logos-filter .provider-filter-btn').length === 10 &&
        document.querySelector('#providerFilter').options.length === 11 &&
        document.querySelectorAll('.my-platform-chip').length === 10 &&
        document.querySelectorAll('.my-platform-chip[aria-pressed="true"]').length === 2 &&
        document.querySelector('#my-platforms-count-badge').textContent === '2' &&
        [...document.querySelectorAll('.provider-filter-btn.my-platform-subscribed')].map(button => button.id).join(',') ===
            'btn-prov-337,btn-prov-11' &&
        JSON.parse(localStorage.getItem('userSubscribedProviders')).join(',') === '11,337'
    ), 'The picker should save and indicate both platforms');

    let countFrom = discoverRequests.length;
    await clickToggle();
    await waitForDiscover('11|337', countFrom);
    assert(await page.evaluate(() =>
        location.hash === '#platform' &&
        document.querySelector('#providerFilter').value === '0' &&
        !document.querySelector('.provider-filter-btn.active') &&
        JSON.parse(localStorage.getItem('myPlatformsFilterActive')) === true
    ), 'Subscription mode should clear the single-provider filter from the URL and controls');
    await page.waitForFunction(() =>
        document.querySelector('.providers-movie-62001 .provider-logo')?.alt === 'MUBI' &&
        document.querySelector('.providers-tv-62001')?.textContent === 'Seçili aboneliklerde yayını yok'
    );

    countFrom = discoverRequests.length;
    await clickChip(11);
    await waitForDiscover('337', countFrom);
    assert(await page.evaluate(() => location.hash) === '#platform', 'Changing subscriptions should refresh the same platform route');

    countFrom = discoverRequests.length;
    await clickToggle();
    await waitForDiscover(null, countFrom);
    countFrom = discoverRequests.length;
    await clickToggle();
    await waitForDiscover('337', countFrom);
    await clickControl('#btn-prov-11', readProvActive);
    await page.waitForFunction(() =>
        location.hash === '#platform?provider=11' &&
        !!document.querySelector('#btn-prov-11.active') &&
        document.querySelector('#my-platforms-toggle-btn').getAttribute('aria-pressed') === 'false' &&
        JSON.parse(localStorage.getItem('myPlatformsFilterActive')) === false &&
        document.querySelectorAll('.providers-movie-62001 .provider-logo').length === 4
    );
    const providerGridRowCounts = await page.evaluate(() => {
        const rows = new Map();
        document.querySelectorAll('.provider-logos-filter .provider-filter-btn').forEach(btn => {
            const topKey = Math.round(btn.getBoundingClientRect().top);
            rows.set(topKey, (rows.get(topKey) || 0) + 1);
        });
        return Array.from(rows.values());
    });
    assert(
        providerGridRowCounts.length === 2 && providerGridRowCounts[0] === 5 && providerGridRowCounts[1] === 5,
        `Expected 5-5 provider grid rows on desktop, got: ${JSON.stringify(providerGridRowCounts)}`
    );

    await page.evaluate(() => navigate('search?q=subscriptions'));
    await waitForTitles(['MUBI Film', 'Disney Film', 'Other Film']);
    await clickToggle();
    await waitForTitles(['Disney Film']);
    await clickChip(11);
    await waitForTitles(['MUBI Film', 'Disney Film']);
    assert(await page.evaluate(() => location.hash) === '#search?q=subscriptions', 'Changing subscriptions should refresh the same search route');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForTitles(['MUBI Film', 'Disney Film']);
    await page.waitForSelector(`${toggle}[aria-pressed="true"]`);

    await page.evaluate(() => navigate('actor/64000'));
    await waitForTitles(['MUBI Film', 'Disney Film']);
    await clickToggle();
    await waitForTitles(['MUBI Film', 'Disney Film', 'Other Film']);
    await clickToggle();
    await waitForTitles(['MUBI Film', 'Disney Film']);
    await clickEdit();
    await clickChip(11);
    await waitForTitles(['Disney Film']);
    await clickChip(337);
    await waitForTitles(['MUBI Film', 'Disney Film', 'Other Film']);
    assert(await page.$eval(toggle, button => button.getAttribute('aria-pressed')) === 'false',
        'Removing the last subscription should disable the filter and refresh results');

    await clickChip(11);
    await clickToggle();
    await waitForTitles(['MUBI Film']);
    await page.evaluate(() => clearAllFilters());
    assert(await page.evaluate(() =>
        JSON.parse(localStorage.getItem('myPlatformsFilterActive')) === false &&
        document.querySelector('#my-platforms-toggle-btn').getAttribute('aria-pressed') === 'false' &&
        document.querySelector('#my-platforms-count-badge').textContent === '1'
    ), 'Clearing filters should turn subscription mode off and preserve selected subscriptions');
}

async function testCalendarLinks(page, movie) {
    await page.evaluate(() => navigate('upcoming'));
    await page.waitForSelector('#upcoming-movies .btn-calendar-card', { visible: true, timeout: 10000 }).catch(async error => {
        const state = await page.evaluate(() => ({
            hash: location.hash,
            upcomingVisible: document.querySelector('#vizyon').classList.contains('active-tab'),
            content: document.querySelector('#upcoming-movies').textContent.trim().slice(0, 200)
        }));
        throw new Error(`Upcoming calendar link did not render: ${JSON.stringify(state)}`, { cause: error });
    });
    const link = await page.$eval('#upcoming-movies .btn-calendar-card', anchor => ({
        href: anchor.href,
        label: anchor.getAttribute('aria-label'),
        target: anchor.target,
        rel: anchor.rel,
        followsTrailer: anchor.previousElementSibling?.classList.contains('btn-trailer'),
        count: document.querySelectorAll('#upcoming-movies .btn-calendar-card').length
    }));
    const url = new URL(link.href);
    assert(
        url.origin === 'https://calendar.google.com' && url.pathname === '/calendar/render' &&
        url.searchParams.get('action') === 'TEMPLATE' &&
        url.searchParams.get('text') === movie.title &&
        url.searchParams.get('details') === movie.overview &&
        url.searchParams.get('dates') === '20961231/20970101' &&
        link.label === `${movie.title} için Google Takvime ekle` &&
        link.target === '_blank' && link.rel === 'noopener noreferrer' &&
        link.followsTrailer && link.count === 1,
        'The upcoming card should have one safe, all-day Google Calendar link after Fragman'
    );
    assert(await page.evaluate(() => {
        const invalidDates = ['2025-02-29', '2024-04-31', '2024-2-09', '2024-02-09T00:00:00Z', '2024-02-09 '];
        return invalidDates.every(date => buildGoogleCalendarUrl('Film', date) === null) &&
            new URL(buildGoogleCalendarUrl('Film', '2024-02-29')).searchParams.get('dates') === '20240229/20240301';
    }), 'Calendar dates should be strict and support leap days');

    await page.click('#upcoming-movies .movie-title-btn');
    await page.waitForSelector('.btn-calendar-modal', { visible: true });
    assert(await page.$eval('.btn-calendar-modal', anchor =>
        anchor.nextElementSibling?.id === 'modal-providers' ? anchor.href : null
    ) === link.href, 'The upcoming movie modal should show the calendar action before its providers');

    await page.evaluate(id => openDetails(id, 'tv'), movie.id);
    await page.waitForFunction(() => document.querySelector('#details-title')?.textContent === 'Fixture TV');
    assert(!await page.$('.btn-calendar-modal'), 'Opening a TV show should clear the previous calendar action');

    await page.evaluate(() => openDetails(65003, 'movie'));
    await page.waitForFunction(() => document.querySelector('#details-title')?.textContent === 'Released Movie');
    assert(!await page.$('.btn-calendar-modal'), 'A released movie should not have a modal calendar action');
}

async function runTest() {
    let server;
    let browser;
    const discoverRequests = [];
    const searchRequests = [];
    const subscriptionMovies = ['MUBI Film', 'Disney Film', 'Other Film'].map((title, index) => ({
        id: 64001 + index, title, media_type: 'movie', popularity: 90 - index,
        release_date: '2024-02-29', poster_path: '/film.jpg', genre_ids: [18]
    }));
    const calendarMovie = {
        id: 65001, title: 'Vizyon "Film" & Arkadaşlar',
        overview: 'İstanbul <3 & sinema', release_date: '2096-12-31', media_type: 'movie'
    };

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
            const rawUrl = toTmdbApiUrl(request.url());

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

            if (url.pathname === '/3/discover/movie' && url.searchParams.has('with_release_type')) {
                tmdbResponse(request, { results: [calendarMovie, {
                    ...calendarMovie, id: 65002, title: 'Invalid Date', release_date: '2096-02-31'
                }] });
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
                if (url.searchParams.get('query') === 'subscriptions') {
                    tmdbResponse(request, { page: 1, total_pages: 1, results: subscriptionMovies });
                    return;
                }
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

            if (url.pathname === '/3/person/64000') {
                tmdbResponse(request, { id: 64000, name: 'Fixture Actor' });
                return;
            }

            if (url.pathname === '/3/person/64000/combined_credits') {
                tmdbResponse(request, { cast: subscriptionMovies, crew: [] });
                return;
            }

            if (url.pathname === '/3/movie/65001') {
                tmdbResponse(request, calendarMovie);
                return;
            }

            if (url.pathname === '/3/tv/65001') {
                tmdbResponse(request, { id: 65001, name: 'Fixture TV', media_type: 'tv', first_air_date: '2096-12-31' });
                return;
            }

            if (url.pathname === '/3/movie/65003') {
                tmdbResponse(request, { id: 65003, title: 'Released Movie', media_type: 'movie', release_date: '2024-02-29' });
                return;
            }

            if (/\/3\/movie\/\d+$/.test(url.pathname)) {
                tmdbResponse(request, { runtime: 100 });
                return;
            }

            if (url.pathname.includes('/watch/providers')) {
                const provider = (provider_id, provider_name) => ({ provider_id, provider_name, logo_path: '/logo.png' });
                const providers = {
                    '/3/movie/62001/watch/providers': {
                        flatrate: [provider(8, 'Netflix'), provider(119, 'Amazon Prime'), provider(1899, 'HBO Max'), provider(11, 'MUBI')]
                    },
                    '/3/movie/64001/watch/providers': { flatrate: [provider(11, 'MUBI')] },
                    '/3/movie/64002/watch/providers': { flatrate: [provider(337, 'Disney+')] },
                    '/3/movie/64003/watch/providers': { rent: [provider(11, 'MUBI')], flatrate: [provider(8, 'Netflix')] }
                }[url.pathname];
                tmdbResponse(request, { results: providers ? { TR: providers } : {} });
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

        const applyYearUi = async (fromVal, toVal = '') => {
            await page.$eval('#yearFromInput', (el, val) => { el.value = val; }, fromVal);
            await page.$eval('#yearToInput', (el, val) => { el.value = val; }, toVal);
            await clickAdvancedControl(page, '#yearRangeApplyBtn');
        };

        await clickAdvancedControl(page, '.segment-btn[onclick="setMediaType(\'movie\', this)"]');
        await clickAdvancedControl(page, '.genre-pill-btn[onclick="setGenre(\'35\', this)"]');
        await applyYearUi('2024');
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

        await applyYearUi('2023');
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
                '#platform?media=hacker&genres=invalid&year=1900&rating=999&runtime=999&sort=evil&provider=-1&unknown=x';
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

        const filteredSearchHash = '#search?q=matrix&rating=7&sort=vote_count.desc';
        const countMatrixSearches = () => searchRequests.filter(value => {
            const params = new URL(value).searchParams;
            return params.get('query') === 'matrix' && params.get('page') === '1';
        }).length;

        await page.evaluate(() => {
            sessionStorage.setItem('search_filter_state', JSON.stringify({
                q: 'matrix', filters: 'year=2020&rating=8&provider=119'
            }));
        });
        await page.goto(`http://127.0.0.1:${port}/index.html${filteredSearchHash}`, {
            waitUntil: 'domcontentloaded', timeout: 30000
        });
        await page.waitForFunction(() =>
            document.getElementById('ratingFilter').value === '7' &&
            document.getElementById('sortByFilter').value === 'vote_count.desc' &&
            document.querySelector('#search-results .movie-title')?.textContent.includes('Matrix Search Result')
        );
        assert(countMatrixSearches() === 1, 'The filtered search link should issue one first-page request');
        const savedSearch = await page.evaluate(() => JSON.parse(sessionStorage.getItem('search_filter_state')));
        assert(
            savedSearch.q === 'matrix' && savedSearch.filters === 'rating=7&sort=vote_count.desc',
            'Explicit URL filters should replace the saved filters for the same query'
        );

        const searchHistoryLength = await page.evaluate(() => history.length);
        const yearSearchHash = '#search?q=matrix&year=2020&rating=7&sort=vote_count.desc';
        await page.evaluate(() => {
            document.getElementById('yearFilter').value = '2020';
            applyPlatformFilters();
        });
        await page.waitForFunction(hash =>
            location.hash === hash &&
            document.querySelector('#search-results .loading')?.textContent.includes('Sonuç bulunamadı'),
        {}, yearSearchHash);
        assert(countMatrixSearches() === 2, 'Applying the year should issue exactly one new search request');
        assert(
            await page.evaluate(() => history.length) === searchHistoryLength,
            'Applying search filters should replace the current history entry'
        );

        await page.evaluate(() => applyPlatformFilters());
        await page.waitForFunction(() =>
            document.querySelector('#search-results .loading')?.textContent.includes('Sonuç bulunamadı')
        );
        assert(countMatrixSearches() === 3, 'Reapplying the same search hash should issue one request');

        await page.evaluate(() => navigate('search?q=matrix&provider=119'));
        await page.waitForFunction(() =>
            currentProvider === 119 &&
            document.querySelector('#search-results .loading')?.textContent.includes('Sonuç bulunamadı')
        );
        await page.click('#btn-prov-119');
        await page.waitForFunction(() =>
            location.hash === '#search?q=matrix' &&
            document.querySelector('#search-results .movie-title')?.textContent.includes('Matrix Search Result')
        );
        await page.evaluate(() => history.back());
        await page.waitForFunction(hash =>
            location.hash === hash &&
            document.getElementById('yearFilter').value === '2020' &&
            document.querySelector('#search-results .loading')?.textContent.includes('Sonuç bulunamadı'),
        {}, yearSearchHash);

        await page.$eval('#searchInput', input => { input.value = 'arrival & friends'; });
        await page.click('.search-submit-btn');
        await page.waitForFunction(() =>
            location.hash === '#search?q=arrival%20%26%20friends' &&
            document.getElementById('yearFilter').value === '' &&
            document.getElementById('ratingFilter').value === '0' &&
            document.getElementById('sortByFilter').value === 'popularity.desc' &&
            document.querySelector('#search-results .movie-title')?.textContent.includes('Matrix Search Result')
        );
        assert(
            searchRequests.some(value => new URL(value).searchParams.get('query') === 'arrival & friends'),
            'A newly submitted query should search with reset filters'
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
        await page.$eval('#yearFromInput', el => { el.value = '2024'; });
        await page.$eval('#yearToInput', el => { el.value = ''; });
        await page.$eval('#yearRangeApplyBtn', el => el.click());
        await page.$eval('#yearFromInput', el => { el.value = '2023'; });
        await page.$eval('#yearToInput', el => { el.value = ''; });
        await page.$eval('#yearRangeApplyBtn', el => el.click());

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

async function testCustomYearRangeFilter(page, discoverRequests) {
    await page.evaluate(() => navigate('platform'));
    await page.waitForSelector('#search-results .movie-card:not(.skeleton-card)');

    assert(await page.evaluate(() =>
        document.getElementById('yearFilter')?.tagName === 'INPUT' &&
        !document.getElementById('custom-trigger-yearFilter')
    ), 'Year filter should use direct inputs instead of a select dropdown');

    await ensureAdvancedPanelReady(page);
    await page.waitForSelector('#yearFromInput', { visible: true });

    await page.$eval('#yearFromInput', el => { el.value = '1994'; });
    await page.$eval('#yearToInput', el => { el.value = ''; });
    await clickAdvancedControl(page, '#yearRangeApplyBtn');
    await page.waitForFunction(() =>
        location.hash === '#platform?year=1994' &&
        document.getElementById('yearFilter')?.value === '1994' &&
        document.getElementById('yearFromInput')?.value === '1994' &&
        document.getElementById('yearToInput')?.value === '' &&
        !document.getElementById('yearRangeClearBtn')?.hidden
    );
    assert(
        discoverRequests.some(u => new URL(u).searchParams.get('primary_release_year') === '1994'),
        'Written single year 1994 should query TMDB with primary_release_year=1994'
    );

    await page.$eval('#yearFromInput', el => { el.value = '1990'; });
    await page.$eval('#yearToInput', el => { el.value = '1999'; });
    await clickAdvancedControl(page, '#yearRangeApplyBtn');
    await page.waitForFunction(() =>
        location.hash === '#platform?year=1990-1999' &&
        document.getElementById('yearFilter')?.value === '1990-1999' &&
        document.getElementById('yearFromInput')?.value === '1990' &&
        document.getElementById('yearToInput')?.value === '1999'
    );
    assert(
        discoverRequests.some(u => {
            const p = new URL(u).searchParams;
            return p.get('primary_release_date.gte') === '1990-01-01' && p.get('primary_release_date.lte') === '1999-12-31';
        }),
        'Written year range 1990-1999 should query TMDB with release date bounds'
    );

    await clickAdvancedControl(page, '#yearRangeClearBtn');
    await page.waitForFunction(() =>
        location.hash === '#platform' &&
        document.getElementById('yearFilter')?.value === '' &&
        document.getElementById('yearFromInput')?.value === '' &&
        document.getElementById('yearRangeClearBtn')?.hidden === true
    );

    await page.evaluate(() => navigate('search?q=matrix&year=1990-1999'));
    await page.waitForFunction(() =>
        document.getElementById('yearFilter')?.value === '1990-1999' &&
        document.querySelector('#search-results .movie-title')?.textContent.includes('Matrix Search Result')
    );
}

        await testMyPlatforms(page, discoverRequests);
        await testCustomYearRangeFilter(page, discoverRequests);
        await testCalendarLinks(page, calendarMovie);

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
