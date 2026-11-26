const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { toTmdbApiUrl } = require('./helpers/tmdb-proxy-shim');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};
const SHOW = {
    id: 1396,
    media_type: 'tv',
    name: 'Test Breaking Series',
    poster_path: '/test-poster.jpg',
    first_air_date: '2008-01-20',
    vote_average: 9,
    genre_ids: [18],
    episode_run_time: [50],
    overview: 'A TV tracking fixture.'
};
const UNTRACKED_SHOW = { ...SHOW, id: 202, name: 'Untracked Test Series' };
const SEASONS = [
    { season_number: 1, name: 'Sezon 1', episode_count: 6 },
    { season_number: 2, name: 'Sezon 2', episode_count: 4 }
];
const TV_ROUTE = '#movie/1396/tv';
const SEASON_SELECT = '#tv-guide-container select.season-select';
const SEASON_TOGGLE = '#season-progress-bar .season-toggle-all-btn';
const PLATFORM_CARD = '#search-results .movie-card[data-media-id="1396"][data-media-type="tv"]';
const TOP10_CARD = '#top10-grid .top10-card[data-media-id="1396"][data-media-type="tv"]';
const UNTRACKED_PLATFORM_CARD = '#search-results .movie-card[data-media-id="202"][data-media-type="tv"]';
const UNTRACKED_TOP10_CARD = '#top10-grid .top10-card[data-media-id="202"][data-media-type="tv"]';

function serveRepo(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const isSpaRoute = pathname === '/' || !path.extname(pathname);
    const file = path.resolve(ROOT_DIR, isSpaRoute ? 'index.html' : '.' + pathname);
    if (!file.startsWith(ROOT_DIR + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    fs.readFile(file, (error, content) => {
        if (error) {
            res.writeHead(404).end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(content);
    });
}

function mockTmdb(pathname, seasonRequests) {
    const season = SEASONS.find(item => pathname === '/3/tv/1396/season/' + item.season_number);
    if (season) {
        seasonRequests.push(season.season_number);
        return {
            episodes: Array.from({ length: season.episode_count }, (_, index) => ({
                episode_number: index + 1,
                name: index === 0 ? 'Bölüm <1> & başlangıç' : 'Bölüm ' + (index + 1),
                overview: 'Test bölüm özeti.',
                runtime: 50,
                air_date: '2008-01-20'
            }))
        };
    }
    switch (pathname) {
        case '/3/tv/1396':
            return {
                ...SHOW,
                genres: [{ id: 18, name: 'Dram' }],
                seasons: SEASONS,
                number_of_episodes: 10,
                external_ids: { imdb_id: 'tt0903747' },
                credits: { cast: [], crew: [] },
                recommendations: { results: [] },
                videos: { results: [] }
            };
        case '/3/trending/all/week':
        case '/3/discover/tv':
            return { page: 1, total_pages: 1, results: [SHOW, UNTRACKED_SHOW] };
        case '/3/discover/movie':
            return {
                page: 1,
                total_pages: 1,
                results: [{ id: SHOW.id, title: 'Same ID film', release_date: '2008-01-01' }]
            };
        default:
            return { page: 1, total_pages: 1, results: [], genres: [], cast: [], crew: [] };
    }
}

function episodeCard(number) {
    return '.episode-card[data-episode-number="' + number + '"]';
}

async function waitForSeason(page, season, count) {
    await page.waitForFunction((expectedSeason, expectedCount) => {
        const guide = document.getElementById('tv-guide-container');
        return guide?.querySelector('.season-select')?.value === String(expectedSeason) &&
            !guide.querySelector('#season-progress-bar').hidden &&
            guide.querySelectorAll('article.episode-card').length === expectedCount;
    }, {}, season, count);
}

function storedProgress(page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem('tvEpisodeProgress') || '{}'));
}

async function assertGuideProgress(page, { watched, season, position, percent }) {
    const state = await page.evaluate(() => {
        const overall = document.getElementById('tv-overall-progress');
        const season = document.getElementById('season-progress-bar');
        return {
            watched: [...document.querySelectorAll('.episode-card.episode-watched')]
                .map(card => Number(card.dataset.episodeNumber)),
            season: season.querySelector('strong').textContent,
            overall: overall.textContent,
            percentLabel: overall.querySelector('progress')?.getAttribute('aria-label'),
            seasonBar: {
                value: season.querySelector('progress').value,
                max: season.querySelector('progress').max
            }
        };
    });
    assert.deepEqual(state.watched, watched);
    assert.ok(state.season.includes(season), state.season);
    assert.ok(state.overall.includes(position), state.overall);
    assert.equal(state.percentLabel, 'İzleme ilerlemesi %' + percent);
    assert.equal(state.seasonBar.value, watched.length);
    assert.equal(state.seasonBar.max, Number(season.split(' / ')[1]));
}

async function assertNoHorizontalOverflow(page, view) {
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
    }));
    assert.ok(scrollWidth <= innerWidth, view + ' overflows horizontally (' + scrollWidth + ' > ' + innerWidth + ')');
}

async function assertPosterOverlay(page, trackedCard, untrackedCard, posterSelector, variant) {
    await page.waitForSelector(trackedCard + ' .card-tv-progress', { visible: true });
    await page.waitForSelector(untrackedCard, { visible: true });
    const layout = await page.evaluate((tracked, untracked, poster, expectedVariant) => {
        const card = document.querySelector(tracked);
        const otherCard = document.querySelector(untracked);
        const slot = card.querySelector('.card-tv-progress-slot');
        return {
            insidePoster: slot.parentElement === card.querySelector(poster),
            variant: slot.dataset.progressVariant,
            hasOverlayClass: !!slot.querySelector('.card-tv-progress--' + expectedVariant),
            position: getComputedStyle(slot).position,
            hasUntrackedBadge: !!otherCard.querySelector('.card-tv-progress'),
            heightDifference: Math.abs(card.offsetHeight - otherCard.offsetHeight)
        };
    }, trackedCard, untrackedCard, posterSelector, variant === 'card' ? 'overlay' : variant);
    assert.equal(layout.insidePoster, true, 'Progress slot should be a child of ' + posterSelector);
    assert.equal(layout.variant, variant);
    assert.equal(layout.hasOverlayClass, true);
    assert.equal(layout.position, 'absolute');
    assert.equal(layout.hasUntrackedBadge, false);
    assert.ok(layout.heightDifference <= 2, 'Tracked and untracked card heights differ by ' + layout.heightDifference + 'px');
}

async function assertEpisodeKeyOrdering(page) {
    const { marked, enriched, unmarked, knownMinutes, canUpdateClearedShow } = await page.evaluate(() => {
        const id = 1396;
        setEpisodesWatchedState(id, ['S2E10', 'S1E12', 'S2E2', 'S2E2', 'S0E2', 'S2E02'], true, {
            episodeRuntimes: { S2E10: 49.7, S1E12: 48, S2E2: '40', S0E2: 35, S9E1: 90 }
        });
        const marked = getTvShowProgress(id);
        updateTvShowAvgRuntime(id, 52.2);
        const enriched = getTvShowProgress(id);
        const knownMinutes = hasKnownTvWatchMinutes(enriched) && getTvShowWatchedMinutes(enriched);
        toggleEpisodeWatched(id, 2, 10);
        const unmarked = getTvShowProgress(id);
        clearTvShowProgress(id);
        return { marked, enriched, unmarked, knownMinutes, canUpdateClearedShow: updateTvShowAvgRuntime(id, 52) };
    });
    assert.deepEqual(marked.watched, ['S1E12', 'S2E2', 'S2E10']);
    assert.deepEqual(marked.episodeRuntimes, { S1E12: 48, S2E10: 50 });
    assert.equal(marked.lastSeason, 2);
    assert.equal(marked.lastEpisode, 10);
    assert.equal(enriched.avgEpisodeRuntime, 52);
    assert.equal(enriched.updatedAt, marked.updatedAt);
    assert.equal(knownMinutes, 150);
    assert.deepEqual(unmarked.watched, ['S1E12', 'S2E2']);
    assert.deepEqual(unmarked.episodeRuntimes, { S1E12: 48 });
    assert.equal(unmarked.lastSeason, 2);
    assert.equal(unmarked.lastEpisode, 2);
    assert.equal(canUpdateClearedShow, false);
}

async function run() {
    const server = http.createServer(serveRepo);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        const pageErrors = [];
        const seasonRequests = [];
        page.on('pageerror', error => pageErrors.push(error.message));

        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        page.on('request', request => {
            const url = new URL(toTmdbApiUrl(request.url()));
            if (url.origin === 'https://api.themoviedb.org') {
                return request.respond({
                    status: 200,
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    contentType: 'application/json',
                    body: JSON.stringify(mockTmdb(url.pathname, seasonRequests))
                });
            }
            return url.origin === origin ? request.continue() : request.abort();
        });

        await page.goto(origin + '/' + TV_ROUTE, { waitUntil: 'domcontentloaded' });
        await waitForSeason(page, 1, 6);
        const initial = await page.$eval('#tv-guide-container', guide => ({
            prompt: guide.querySelector('#tv-overall-progress').textContent,
            list: [...guide.querySelectorAll('.episode-card')].map(card => ({
                tag: card.tagName,
                wrappingLink: [...card.querySelectorAll('button')].some(button => button.closest('[role="link"], a')),
                tabindex: card.getAttribute('tabindex'),
                controls: [...card.querySelectorAll('button')].map(button => button.type),
                title: card.querySelector('.episode-ext-link').textContent,
                href: card.querySelector('.episode-ext-link').href,
                rel: card.querySelector('.episode-ext-link').rel,
                stillHref: card.querySelector('.episode-still-link').href
            }))
        }));
        assert.match(initial.prompt, /İzlediğiniz bölümleri işaretleyerek/);
        assert.equal(initial.list.length, 6);
        assert.ok(initial.list.every(card => card.tag === 'ARTICLE' && !card.wrappingLink && card.tabindex === null));
        assert.ok(initial.list.every(card => card.href.startsWith('https://') &&
            card.href === card.stillHref && card.rel === 'noopener noreferrer'));
        assert.deepEqual(initial.list.map(card => card.controls), Array.from({ length: 6 }, () => ['button', 'button']));
        assert.equal(initial.list[0].title, '1. Bölüm <1> & başlangıç');

        const firstWatchButton = episodeCard(1) + ' .episode-watch-btn';
        await page.click(firstWatchButton);
        assert.equal(await page.$eval(firstWatchButton, button => button.getAttribute('aria-pressed')), 'true');
        await assertGuideProgress(page, { watched: [1], season: '1 / 6', position: 'S1 • B1', percent: 10 });
        const firstRecord = (await storedProgress(page))['tv:1396'];
        assert.deepEqual(firstRecord, {
            id: 1396,
            media_type: 'tv',
            name: SHOW.name,
            poster_path: SHOW.poster_path,
            first_air_date: SHOW.first_air_date,
            vote_average: SHOW.vote_average,
            genre_ids: SHOW.genre_ids,
            totalSeasons: 2,
            totalEpisodes: 10,
            watched: ['S1E1'],
            avgEpisodeRuntime: 50,
            episodeRuntimes: { S1E1: 50 },
            lastSeason: 1,
            lastEpisode: 1,
            updatedAt: firstRecord.updatedAt
        });
        assert.ok(firstRecord.updatedAt > 0);
        assert.match(await page.$eval(SEASON_SELECT, select => select.options[0].textContent), / • 1\/6$/);

        const markFive = episodeCard(5) + ' .episode-mark-upto-btn';
        await page.click(markFive);
        assert.equal(await page.$eval(markFive, button => button.hidden), true);
        await assertGuideProgress(page, { watched: [1, 2, 3, 4, 5], season: '5 / 6', position: 'S1 • B5', percent: 50 });
        assert.match(await page.$eval(SEASON_SELECT, select => select.options[0].textContent), / • 5\/6$/);

        await page.click(SEASON_TOGGLE);
        assert.equal(await page.$eval(SEASON_TOGGLE, button => button.getAttribute('aria-pressed')), 'true');
        await assertGuideProgress(page, { watched: [1, 2, 3, 4, 5, 6], season: '6 / 6', position: 'S1 • B6', percent: 60 });
        assert.match(await page.$eval(SEASON_SELECT, select => select.options[0].textContent), / • ✓$/);
        await page.click(SEASON_TOGGLE);
        assert.equal(await page.$eval(SEASON_TOGGLE, button => button.getAttribute('aria-pressed')), 'false');
        assert.equal(await page.$$eval('.episode-card.episode-watched', cards => cards.length), 0);
        assert.equal(await page.$eval('#season-progress-bar progress', progress => progress.value), 0);
        assert.equal('tv:1396' in await storedProgress(page), false);
        assert.deepEqual(seasonRequests, [1], 'Watch actions must update the guide without refetching episodes.');

        await page.select(SEASON_SELECT, '2');
        await waitForSeason(page, 2, 4);
        const secondWatchButton = episodeCard(2) + ' .episode-watch-btn';
        await page.click(secondWatchButton);
        const secondRecord = (await storedProgress(page))['tv:1396'];
        assert.deepEqual(secondRecord.watched, ['S2E2']);
        assert.equal(secondRecord.lastSeason, 2);
        assert.equal(secondRecord.lastEpisode, 2);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForSeason(page, 2, 4);
        assert.equal(await page.$eval(secondWatchButton, button => button.getAttribute('aria-pressed')), 'true');
        await assertGuideProgress(page, { watched: [2], season: '1 / 4', position: 'S2 • B2', percent: 10 });
        assert.deepEqual(seasonRequests, [1, 2, 2], 'Reload must open the last tracked season.');

        await page.evaluate(() => navigate('profile'));
        await page.waitForSelector('#tab-profile-tv-tracker', { visible: true });
        await page.click('#tab-profile-tv-tracker');
        await page.waitForSelector('#tv-tracker-grid .tv-tracker-card', { visible: true });
        const trackerText = await page.$eval('#tv-tracker-grid', grid => grid.textContent);
        assert.match(trackerText, /Test Breaking Series/);
        assert.match(trackerText, /S2 • B2/);
        assert.match(trackerText, /S2 • B2\s+1 \/ 10 bölüm \(%10\)/);
        assert.match(trackerText, /1 \/ 10 bölüm \(%10\)/);
        assert.match(await page.$eval('#tab-profile-tv-tracker', tab => tab.textContent), /Dizi Takibim \(1\)/);
        assert.deepEqual(await page.evaluate(() => safeReadStorage('ratedMovies', [])), []);
        assert.equal(await page.$eval('.stat-card--content .stat-value', value => value.textContent), '1');
        assert.equal(await page.$eval('#profile-watch-time', value => value.textContent), '50d');
        await page.evaluate(() => toggleEpisodeWatched(1396, 2, 1));
        assert.equal(await page.$eval('#profile-watch-time', value => value.textContent), '1s 40d');
        await page.evaluate(() => toggleEpisodeWatched(1396, 2, 1));
        assert.equal(await page.$eval('#profile-watch-time', value => value.textContent), '50d');

        await page.evaluate(() => navigate('home'));
        await page.waitForSelector(TOP10_CARD + ' .card-tv-progress');
        await page.evaluate(() => navigate('platform'));
        await assertPosterOverlay(page, TOP10_CARD, UNTRACKED_TOP10_CARD, '.top10-poster', 'top10');
        await assertPosterOverlay(page, PLATFORM_CARD, UNTRACKED_PLATFORM_CARD, '.movie-poster-wrap', 'card');
        for (const card of [PLATFORM_CARD, TOP10_CARD]) {
            await page.waitForSelector(card + ' .card-tv-progress', { visible: true });
            assert.match(await page.$eval(card + ' .card-tv-progress', badge => badge.textContent), /S2 • B2/);
        }
        const sameIdMovie = '#search-results .movie-card[data-media-id="1396"][data-media-type="movie"]';
        await page.waitForSelector(sameIdMovie, { visible: true });
        assert.equal(await page.$eval(sameIdMovie, card => card.querySelector('.card-tv-progress-slot') !== null),
            false, 'The movie with the same TMDB ID must have no TV progress.');

        await page.evaluate(() => toggleEpisodeWatched(1396, 2, 1));
        assert.equal(await page.$eval(TOP10_CARD + ' .card-tv-progress--top10 progress', bar => bar.value), 2);
        assert.equal(await page.$eval(PLATFORM_CARD + ' .card-tv-progress--overlay progress', bar => bar.value), 2);
        await page.evaluate(() => toggleEpisodeWatched(1396, 2, 1));

        await page.focus('#themeToggleBtn');
        await page.keyboard.press('Enter');
        assert.ok(await page.evaluate(() => document.body.classList.contains('light-theme')));
        await page.setViewport({ width: 390, height: 844 });
        await assertNoHorizontalOverflow(page, 'Platform');

        await page.evaluate(() => navigate('profile'));
        await page.waitForSelector('#tv-tracker-grid .tv-tracker-open-btn', { visible: true });
        await assertNoHorizontalOverflow(page, 'Profile tracker');
        await page.click('.tv-tracker-open-btn');
        await waitForSeason(page, 2, 4);
        await assertNoHorizontalOverflow(page, 'TV guide');
        await page.evaluate(() => navigate('profile'));
        await page.waitForSelector('.tv-tracker-reset-btn', { visible: true });
        await page.click('.tv-tracker-reset-btn');
        assert.equal('tv:1396' in await storedProgress(page), false);
        assert.equal(await page.$eval('#profile-watch-time', value => value.textContent), '0s');
        assert.equal(await page.$eval('.stat-card--content .stat-value', value => value.textContent), '0');
        assert.equal(await page.$$eval('#tv-tracker-grid .tv-tracker-card', cards => cards.length), 0);
        await page.waitForSelector('#tv-tracker-grid .tv-tracker-empty', { visible: true });
        for (const card of [PLATFORM_CARD, TOP10_CARD]) {
            assert.equal(await page.$eval(card + ' .card-tv-progress-slot', slot => slot.innerHTML), '');
        }
        await assertEpisodeKeyOrdering(page);
        assert.deepEqual(pageErrors, [], 'Unexpected browser page errors.');
        console.log('TV episode tracking regression test passed.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
