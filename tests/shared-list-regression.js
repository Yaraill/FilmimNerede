const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const puppeteer = require('puppeteer');
const { toTmdbApiUrl } = require('./helpers/tmdb-proxy-shim');

const root = path.resolve(__dirname, '..');
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
};
const maliciousTitle = '<img src=x onerror=window.__xss=1>';
const maliciousRoute = 'list?title=%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E&items=m550,t1396';
const expectedNav = ['now-playing', 'vizyon', 'platform', 'profile', 'games', 'imax']
    .map(tab => ['#', `switchTab(event, '${tab}')`]);

function testQueryHelpers() {
    const storage = new Map();
    const localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
    const context = vm.createContext({ URLSearchParams, document: {}, localStorage });
    for (const script of ['security.js', 'profile.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'js', 'runtime', script), 'utf8'), context);
    }
    const {
        parseSharedListQuery,
        parseSharedListPath,
        parseSharedListRoute,
        buildSharedListRoute,
        getSavedSharedLists,
        saveSharedListRecord
    } = context;
    const parsed = parseSharedListQuery('title=+Cuma+Gecesi+&items=m550,t550,m550,m0,invalid,m01,T5,m1e3,t9007199254740993,m1234567890123456');
    assert.equal(parsed.title, 'Cuma Gecesi');
    assert.equal(parsed.hasCustomTitle, true);
    assert.equal(parsed.ignoredCount, 8);
    assert.equal(parsed.truncated, false);
    assert.deepEqual(Array.from(parsed.items, item => [item.id, item.mediaType, item.key, item.token]), [
        [550, 'movie', 'movie:550', 'm550'],
        [550, 'tv', 'tv:550', 't550']
    ]);
    const items = Array.from({ length: 31 }, (_, index) => ({ id: index + 1, media_type: 'movie' }));
    const raw = parseSharedListQuery('title=' + 'x'.repeat(81) + '&items=' + items.map(item => 'm' + item.id).join(','));
    assert.equal(raw.title.length, 80);
    assert.equal(raw.items.length, 30);
    assert.equal(raw.items[29].id, 30);
    assert.equal(raw.truncated, true);

    assert.equal(buildSharedListRoute(' ', [{ id: 550, media_type: 'movie' }]), 'secki/mfa');
    const cleanAscii = buildSharedListRoute('Bilim Kurgu Gecesi', [
        { id: 438631, media_type: 'movie' },
        { id: 693134, media_type: 'movie' },
        { id: 550, media_type: 'movie' }
    ]);
    assert.equal(cleanAscii, 'secki/bilim-kurgu-gecesi/m9eg7.meutq.mfa');
    assert.equal(cleanAscii.includes('~'), false);
    assert.equal(cleanAscii.includes('%'), false);

    const turkishRoute = buildSharedListRoute('Yüzüklerin Efendisi Seçkisi', [
        { id: 550, media_type: 'movie' },
        { id: 1396, media_type: 'tv' }
    ]);
    assert.match(turkishRoute, /^secki\/yuzuklerin-efendisi-seckisi\/mfa\.t12s~[A-Za-z0-9_-]+$/);
    const decodedTurkish = parseSharedListRoute(turkishRoute);
    assert.equal(decodedTurkish.title, 'Yüzüklerin Efendisi Seçkisi');
    assert.deepEqual(Array.from(decodedTurkish.items, item => item.token), ['m550', 't1396']);

    const emojiRoute = buildSharedListRoute('🎬🔥', [{ id: 550, media_type: 'movie' }]);
    assert.match(emojiRoute, /^secki\/mfa~[A-Za-z0-9_-]+$/);
    assert.equal(parseSharedListRoute(emojiRoute).title, '🎬🔥');

    assert.equal(parseSharedListPath('a/b/c').items.length, 0);
    assert.equal(parseSharedListRoute('invalid').items.length, 0);
    const badTokens = parseSharedListPath('m0.m05.mfa~!!!');
    assert.equal(badTokens.ignoredCount, 2);
    assert.deepEqual(Array.from(badTokens.items, item => item.token), ['m550']);

    const canonical = buildSharedListRoute('  ' + 'y'.repeat(81), [
        { id: 0, media_type: 'tv' },
        { id: 1, media_type: 'person' },
        items[0],
        ...items
    ]);
    const roundTrip = parseSharedListRoute(canonical);
    assert.equal(roundTrip.title, 'y'.repeat(80));
    assert.equal(roundTrip.items.length, 30);
    assert.equal(roundTrip.ignoredCount, 0);
    assert.equal(roundTrip.truncated, false);
    const defaultTitle = parseSharedListRoute(buildSharedListRoute(' ', parsed.items));
    assert.equal(defaultTitle.title, 'Paylaşılan Film & Dizi Seçkisi');
    assert.equal(defaultTitle.hasCustomTitle, false);
    assert.equal(buildSharedListRoute('Boş', [{ id: Number.MAX_SAFE_INTEGER, media_type: 'tv' }]), null);

    const source = [{
        id: 550, media_type: 'movie', title: 'Dövüş Kulübü', release_date: '1999-10-15',
        poster_path: '/invalid"poster.jpg', vote_average: Infinity, imdb_rating: '8.8', overview: '🎬'.repeat(1000),
        genres: [{ id: 18 }, { id: 18 }, { id: 0 }]
    }];
    const saved = saveSharedListRecord({ title: ' ', items: [...source, ...source] });
    assert.equal(saved.route, 'secki/mfa');
    assert.equal(saved.title, 'Paylaşılan Film & Dizi Seçkisi');
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].poster_path, null);
    assert.equal(saved.items[0].vote_average, null);
    assert.equal(saved.items[0].imdb_rating, '8.8');
    assert.equal(saved.items[0].year, '1999');
    assert.ok(saved.items[0].overview.length <= 420);
    assert.match(saved.items[0].overview, /…$/u);
    assert.deepEqual(Array.from(saved.items[0].genre_ids), [18]);
    assert.equal(saveSharedListRecord({ title: '', items: source }).id, saved.id);
    const legacySaved = { ...saved, id: 'legacy_1', route: 'list?items=m550' };
    const invalid = { ...saved, id: 'bad', route: 'secki/t12s' };
    storage.set('savedSharedLists', JSON.stringify([invalid, legacySaved]));
    const migrated = getSavedSharedLists();
    assert.deepEqual(Array.from(migrated, list => [list.id, list.route]), [['legacy_1', 'secki/mfa']]);
    for (let index = 1; index <= 40; index++) {
        saveSharedListRecord({ title: `Seçki ${index}`, items: source });
    }
    const capped = getSavedSharedLists();
    assert.equal(capped.length, 40);
    assert.equal(capped[0].title, 'Seçki 40');
    assert.ok(capped.every(list => list.id !== legacySaved.id));
}

function serveFile(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
    }
    fs.readFile(file, (error, content) => {
        if (error) {
            res.writeHead(404).end();
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream' });
        res.end(content);
    });
}

function media(type, id, title) {
    return {
        id,
        media_type: type,
        ...(type === 'movie' ? { title, release_date: '1999-10-15', runtime: 139 } :
            { name: title, first_air_date: '2008-01-20', episode_run_time: [45], number_of_episodes: 62, seasons: [] }),
        poster_path: '/poster.jpg',
        backdrop_path: null,
        overview: type === 'movie' ? 'Paylaşılan film özeti.' : 'Paylaşılan dizi özeti.',
        vote_average: 8.5,
        genre_ids: [18],
        genres: [],
        credits: { cast: [], crew: [] },
        recommendations: { results: [] },
        videos: { results: [] },
        external_ids: {}
    };
}

const movies = {
    'movie:550': media('movie', 550, 'Dövüş Kulübü'),
    'tv:1396': media('tv', 1396, 'Breaking Bad'),
    'movie:603': media('movie', 603, maliciousTitle)
};

async function mockRequests(page, origin) {
    const queries = [];
    const listDetailRequests = [];
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = new URL(toTmdbApiUrl(request.url()));
        const json = (body, status = 200) => request.respond({
            status,
            headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: 'application/json',
            body: JSON.stringify(body)
        });
        const handle = () => {
            if (url.hostname === 'api.themoviedb.org') {
                if (url.pathname === '/3/search/multi') {
                    const query = url.searchParams.get('query');
                    queries.push(query);
                    if (query === 'Nolan') {
                        return json({
                            results: [
                                {
                                    id: 525,
                                    media_type: 'person',
                                    name: 'Christopher Nolan',
                                    profile_path: '/poster.jpg',
                                    known_for_department: 'Directing',
                                    known_for: [{ id: 27205, media_type: 'movie', title: 'Başlangıç', release_date: '2010-07-16' }]
                                },
                                movies['movie:603']
                            ]
                        });
                    }
                    return json({
                        results: [
                            movies['movie:603'],
                            movies['tv:1396'],
                            { id: 5, media_type: 'person', name: 'Kişi', known_for_department: 'Acting', profile_path: null, known_for: [] }
                        ]
                    });
                }
                if (url.pathname === '/3/person/525/combined_credits') {
                    return json({
                        crew: [
                            { ...media('movie', 27205, 'Başlangıç'), release_date: '2010-07-16', vote_count: 35000, popularity: 120, job: 'Director' },
                            { ...media('movie', 157336, 'Yıldızlararası'), release_date: '2014-11-05', vote_count: 33000, popularity: 110, job: 'Director' }
                        ],
                        cast: [
                            { ...media('movie', 99901, 'Gerçek Film'), release_date: '2015-01-01', vote_count: 500, popularity: 30, character: 'Dedektif' },
                            { ...media('tv', 99902, 'Gerçek Dizi'), first_air_date: '2018-01-01', vote_count: 450, popularity: 25, episode_count: 10, character: 'Başrol' },
                            { ...media('tv', 99910, 'The Tonight Show'), genre_ids: [10767], popularity: 999, vote_count: 5000 },
                            { ...media('tv', 99911, 'Celebrity Reality'), genre_ids: [10764], popularity: 800, vote_count: 500 },
                            { ...media('movie', 99912, 'Nolan Belgeseli'), genre_ids: [99], popularity: 700, vote_count: 500 },
                            { ...media('movie', 99913, 'The 96th Oscars Ceremony'), genre_ids: [18], popularity: 900, vote_count: 500 },
                            { ...media('tv', 99914, 'Saturday Night Live'), genre_ids: [35], character: 'Self - Host', popularity: 950, vote_count: 1000 },
                            { ...media('movie', 99915, 'Afişsiz Yapım'), poster_path: null, genre_ids: [18], vote_count: 500 }
                        ]
                    });
                }
                if (/^\/3\/genre\/(movie|tv)\/list$/.test(url.pathname)) {
                    return json({ genres: [{ id: 18, name: 'Dram' }] });
                }
                if (/\/watch\/providers$/.test(url.pathname)) {
                    return json({ results: { TR: { flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }] } } });
                }
                const detail = /^\/3\/(movie|tv)\/(\d+)$/.exec(url.pathname);
                if (detail) {
                    const key = `${detail[1]}:${detail[2]}`;
                    if (!url.searchParams.has('append_to_response')) listDetailRequests.push(key);
                    return movies[key] ? json(movies[key]) : json({ status_message: 'Not found' }, 404);
                }
                return json({ results: [], total_pages: 1 });
            }
            if (url.origin === origin) return request.continue();
            return request.abort();
        };
        handle().catch(error => {
            if (!request.isInterceptResolutionHandled() && !page.isClosed()) {
                console.error('Mock request failed:', url.href, error.message);
            }
        });
    });
    return { queries, listDetailRequests };
}

async function assertNoHorizontalOverflow(page, selector) {
    assert.equal(await page.$eval(selector, element => {
        const rect = element.getBoundingClientRect();
        return document.body.classList.contains('light-theme') &&
            window.innerWidth === 390 && window.innerHeight === 844 &&
            document.documentElement.scrollWidth <= window.innerWidth &&
            element.scrollWidth <= element.clientWidth &&
            rect.left >= 0 && rect.right <= window.innerWidth;
    }), true, `${selector} overflowed the 390 × 844 light-theme viewport`);
}

async function testSharedList(page, origin, listDetailRequests) {
    await page.goto(origin + '/#' + maliciousRoute, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#shared-list-grid .provider-logo').length === 2);
    assert.deepEqual(await page.$$eval('.nav-links a', links => links.map(link => [
        link.getAttribute('href'), link.getAttribute('onclick')
    ])), expectedNav);
    assert.equal(await page.$eval('#shared-list-title', el => el.textContent), maliciousTitle);
    assert.equal(await page.$('#shared-list-title img'), null);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.$eval('#shared-list-subtitle', el => el.textContent), '2 yapım • 1 Film, 1 Dizi');
    assert.deepEqual(await page.$$eval('#shared-list-grid .movie-card', cards => cards.map(card =>
        `${card.dataset.mediaType}:${card.dataset.mediaId}`
    )), ['movie:550', 'tv:1396']);
    assert.deepEqual([...listDetailRequests].sort(), ['movie:550', 'tv:1396']);

    await page.click('#shared-list-copy-btn');
    await page.waitForFunction(() => window.__copiedLink?.includes('#secki/'));
    const copiedUrl = new URL(await page.evaluate(() => window.__copiedLink));
    assert.equal(copiedUrl.origin, origin);
    const parsedCopied = await page.evaluate(hash => parseSharedListRoute(hash), copiedUrl.hash);
    assert.equal(parsedCopied.title, maliciousTitle);
    assert.deepEqual(parsedCopied.items.map(item => item.token), ['m550', 't1396']);

    await page.click('#shared-list-grid .movie-card[data-media-id="550"] .movie-title-btn');
    await page.waitForFunction(() => location.hash === '#movie/550/movie' &&
        document.querySelector('#details-modal.active #details-title')?.textContent.includes('Dövüş Kulübü'));
    await page.evaluate(() => {
        window.movieCache = {};
        closeDetails(null, true);
    });
    await page.waitForFunction(hash => location.hash === hash &&
        !document.getElementById('details-modal').classList.contains('active') &&
        document.querySelectorAll('#shared-list-grid .movie-card').length === 2, {}, '#' + maliciousRoute);
    assert.equal(listDetailRequests.length, 2, 'Back navigation should use the shared list cache');

    for (const added of [2, 0]) {
        await page.click('#shared-list-add-all-btn');
        assert.match(await page.$eval('#shared-list-status', el => el.textContent),
            new RegExp(`^${added} yapım eklendi, ${2 - added} yapım zaten listende`));
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('watchlist'))
            .map(({ id, media_type }) => `${media_type}:${id}`)), ['movie:550', 'tv:1396']);
        assert.equal(await page.$$eval('#shared-list-grid .btn-heart.active[aria-pressed="true"][aria-label="Listeden çıkar"]',
            hearts => hearts.length), 2);
    }

    await page.click('#shared-list-pick-random-btn');
    await page.waitForSelector('#details-modal.active');
    assert.match(new URL(page.url()).hash, /^#movie\/(550\/movie|1396\/tv)$/);
    assert.match(await page.$eval('#shared-list-status', el => el.textContent), /Seçilen yapım: (Dövüş Kulübü|Breaking Bad)/);
    await page.evaluate(() => closeDetails(null, true));
    await page.waitForFunction(hash => location.hash === hash, {}, '#' + maliciousRoute);

    await page.evaluate(() => navigate('list?items=m550,t999'));
    await page.waitForFunction(() => document.getElementById('shared-list-notice').textContent.includes('1 yapım yüklenemedi.'));
    assert.equal(await page.$$('#shared-list-grid .movie-card').then(cards => cards.length), 1);

    await page.evaluate(() => navigate('list?items=t999'));
    await page.waitForSelector('#shared-list-grid .shared-list-empty');
    assert.match(await page.$eval('#shared-list-grid .shared-list-empty', el => el.textContent), /Seçkideki yapımlar şu anda yüklenemedi/);
    assert.equal(await page.$eval('#shared-list-add-all-btn', el => el.disabled), true);

    await page.evaluate(() => navigate('list?items=invalid,m0'));
    await page.waitForSelector('#shared-list.active-tab .shared-list-empty');
    assert.equal(await page.$eval('#shared-list-actions', el => el.hidden), true);
    assert.match(await page.$eval('#shared-list-subtitle', el => el.textContent), /geçerli film veya dizi bulunamadı/);
    assert.deepEqual(await page.$$eval('.shared-list-empty button', buttons => buttons.map(btn => btn.textContent.trim())),
        ["Keşfet'e Dön", 'Yeni Seçki Oluştur']);
}

async function testBuilder(page, queries) {
    await page.evaluate(tv => {
        safeWriteStorage('ratedMovies', [tv]);
        navigate('profile');
    }, movies['tv:1396']);
    await page.waitForSelector('#profile.active-tab #open-share-builder-btn', { visible: true });

    await page.evaluate(() => {
        navigator.clipboard.writeText = async () => { throw new Error('Denied'); };
        document.execCommand = command => {
            window.__copiedLink = document.activeElement.value;
            return command === 'copy';
        };
    });
    await page.click('#share-watchlist-quick-btn');
    await page.waitForSelector('#watchlist-share-status .share-list-inline-open-btn');
    assert.match(await page.$eval('#watchlist-share-status', el => el.textContent), /linki kopyalandı/);
    await page.click('#watchlist-share-status .share-list-inline-open-btn');
    await page.waitForFunction(() => location.hash.includes('#secki/izleme-listem/') &&
        document.getElementById('shared-list-title').textContent === 'İzleme Listem');
    assert.equal(new URL(await page.evaluate(() => window.__copiedLink)).hash, new URL(page.url()).hash);
    await page.evaluate(() => navigate('profile'));
    await page.click('#open-share-builder-btn');
    await page.waitForSelector('#share-list-modal.active', { visible: true });
    assert.equal(await page.$$('#share-list-library-chips button').then(buttons => buttons.length), 2);
    const previewCard = '#share-list-preview .share-list-preview-card';
    const libraryMovie = '#share-list-library-chips [data-share-token="m550"]';
    const libraryTv = '#share-list-library-chips [data-share-token="t1396"]';
    assert.match(await page.$eval(previewCard + ' h3', el => el.textContent), /Dövüş Kulübü \(1999\)/);
    assert.match(await page.$eval(libraryMovie, el => el.textContent), /\(1999\)/);
    assert.match(await page.$eval(libraryTv, el => el.textContent), /\(2008\)/);

    await page.type('#share-list-search-input', 'Nolan');
    const nolanResult = '#share-list-search-results [data-share-person-id="525"]';
    await page.waitForSelector(nolanResult, { visible: true });
    assert.equal(await page.$eval(nolanResult + ' .share-list-item-label', el => el.textContent), 'Christopher Nolan');
    assert.equal(await page.$eval(nolanResult + ' .share-list-result-meta', el => el.textContent), 'Kişi • Yönetmen');
    assert.equal(await page.$eval(nolanResult + ' .share-list-choice-action', el => el.textContent), 'Yapımları →');
    await page.hover(nolanResult);
    assert.equal(await page.$eval(previewCard + ' h3', el => el.textContent), 'Christopher Nolan');
    assert.match(await page.$eval(previewCard + ' .share-list-preview-overview', el => el.textContent), /görmek için tıkla/);
    await page.click(nolanResult);
    await page.waitForSelector('#share-list-search-results [data-share-token="m27205"]', { visible: true });
    assert.equal(await page.$eval('#share-list-person-bar', el => el.hidden), false);
    assert.deepEqual(
        await page.$$eval('.share-list-person-filters .share-list-person-filter-btn', buttons =>
            buttons.map(btn => [btn.textContent, btn.getAttribute('aria-pressed')])),
        [['Yönetmen (2)', 'true'], ['Oyuncu (2)', 'false'], ['Tümü (4)', 'false']]
    );
    assert.equal(await page.$('.share-list-person-media-filters'), null);
    await page.evaluate(() => {
        Array.from(document.querySelectorAll('.share-list-person-filters .share-list-person-filter-btn'))
            .find(el => el.textContent.startsWith('Oyuncu')).click();
    });
    await page.waitForSelector('#share-list-search-results [data-share-token="m99901"]', { visible: true });
    assert.equal(await page.$('#share-list-search-results [data-share-token="t99902"]') !== null, true);
    assert.deepEqual(
        await page.$$eval('#share-list-search-results [data-share-token]', els => els.map(el => el.dataset.shareToken)),
        ['m99901', 't99902']
    );
    assert.deepEqual(
        await page.$$eval('.share-list-person-media-filters button', buttons =>
            buttons.map(btn => [btn.dataset.shareMediaFilter, btn.textContent, btn.getAttribute('aria-pressed')])),
        [['all', 'Tümü (2)', 'true'], ['movie', 'Filmler (1)', 'false'], ['tv', 'Diziler (1)', 'false']]
    );
    await page.click('.share-list-person-media-filters [data-share-media-filter="movie"]');
    assert.deepEqual(
        await page.$$eval('#share-list-search-results [data-share-token]', els => els.map(el => el.dataset.shareToken)),
        ['m99901']
    );
    await page.click('.share-list-person-media-filters [data-share-media-filter="tv"]');
    assert.deepEqual(
        await page.$$eval('#share-list-search-results [data-share-token]', els => els.map(el => el.dataset.shareToken)),
        ['t99902']
    );
    await page.evaluate(() => {
        Array.from(document.querySelectorAll('.share-list-person-filters .share-list-person-filter-btn'))
            .find(el => el.textContent.startsWith('Yönetmen')).click();
    });
    assert.equal(await page.$('.share-list-person-media-filters'), null);
    await page.waitForSelector('#share-list-search-results [data-share-token="m27205"]', { visible: true });
    await page.click('#share-list-search-results [data-share-token="m27205"]');
    assert.match(await page.$eval('#share-list-selected-count', el => el.textContent), /1 \/ 30/);
    await page.click('#share-list-selected-items .share-list-pill button');
    assert.match(await page.$eval('#share-list-selected-count', el => el.textContent), /0 \/ 30/);
    await page.click('.share-list-person-back-btn');
    await page.waitForSelector(nolanResult, { visible: true });
    assert.equal(await page.$eval('#share-list-person-bar', el => el.hidden), true);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.sharePersonId), '525');
    await page.evaluate(() => {
        const input = document.getElementById('share-list-search-input');
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.type('#share-list-title-input', 'Cuma Film Gecesi');
    await page.type('#share-list-search-input', 'Matrix');
    const movieResult = '#share-list-search-results [data-share-token="m603"]';
    const tvResult = '#share-list-search-results [data-share-token="t1396"]';
    await page.waitForSelector(movieResult, { visible: true });
    assert.ok(queries.includes('Matrix'), 'Typing should trigger the debounced search');
    assert.equal(await page.$$('#share-list-search-results button').then(buttons => buttons.length), 3);
    assert.equal(await page.$eval(movieResult + ' .share-list-item-label', el => el.textContent), maliciousTitle + ' (1999)');
    assert.match(await page.$eval(movieResult + ' .share-list-result-meta', el => el.textContent), /^Film • 1999$/);
    const thumb = await page.$eval(movieResult, el => Array.from(el.querySelectorAll('img'), img =>
        [img.className, new URL(img.src).pathname, img.getAttribute('alt'), img.loading]
    ));
    assert.deepEqual(thumb, [['share-list-thumb', '/t/p/w92/poster.jpg', '', 'lazy']]);
    assert.equal(await page.$eval(movieResult + ' .share-list-result-overview', el => el.textContent), 'Paylaşılan film özeti.');

    await page.hover(movieResult);
    assert.equal(await page.$eval(previewCard + ' h3', el => el.textContent), maliciousTitle + ' (1999)');
    assert.equal(await page.$(previewCard + ' h3 img'), null);
    assert.equal(await page.$(previewCard + ' .share-list-preview-rating'), null);
    assert.equal(await page.$eval(previewCard + ' .share-list-preview-year', el => el.textContent), '1999');
    assert.equal(await page.$eval(previewCard + ' .share-list-preview-overview', el => el.textContent), 'Paylaşılan film özeti.');
    assert.equal(await page.$eval(previewCard + ' .share-list-preview-poster', el => new URL(el.src).pathname), '/t/p/w185/poster.jpg');
    await page.focus(tvResult);
    assert.equal(await page.$eval(previewCard + ' h3', el => el.textContent), 'Breaking Bad (2008)');
    assert.equal(await page.$(previewCard + ' .share-list-preview-rating'), null);
    assert.equal(await page.$eval(previewCard + ' .share-list-preview-overview', el => el.textContent), 'Paylaşılan dizi özeti.');
    await page.waitForFunction(selector => document.querySelector(selector)?.textContent === 'Dram', {},
        previewCard + ' .share-list-preview-genres');
    await page.evaluate(() => {
        renderShareListPreview({ id: 603, media_type: 'movie', title: 'Matrix', vote_average: 8.5, imdb_rating: '8.8' });
    });
    assert.equal(await page.$eval(previewCard + ' .share-list-preview-rating', el => el.textContent), 'IMDb 8.8');

    await page.focus('#share-list-search-input');
    await page.keyboard.press('Enter');
    await page.waitForSelector(movieResult, { visible: true });
    await page.click('#share-list-search-btn');
    await page.waitForSelector(movieResult, { visible: true });
    assert.ok(queries.filter(query => query === 'Matrix').length >= 3);

    await page.click(movieResult);
    const actionLayout = await page.evaluate((addedSel, addSel) => {
        const longOverview = 'Karanlığın bütün güçleri son savaş için bir araya gelirken kahramanlar imkansız bir yolculuğa çıkar ve kaderi değiştirmek için mücadele ederler...';
        const overviews = Array.from(document.querySelectorAll('#share-list-search-results .share-list-result-overview'));
        const previous = overviews.map(node => node.textContent);
        overviews.forEach(node => { node.textContent = longOverview; });
        try {
            const container = document.getElementById('share-list-search-results');
            const items = [addedSel, addSel].map(sel => {
                const actionEl = document.querySelector(sel + ' .share-list-choice-action');
                const style = getComputedStyle(actionEl);
                const rect = actionEl.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(actionEl);
                return {
                    text: actionEl.textContent.trim(),
                    whiteSpace: style.whiteSpace,
                    flexShrink: style.flexShrink,
                    lineRects: range.getClientRects().length,
                    width: rect.width,
                    height: rect.height
                };
            });
            return {
                overflowX: container.scrollWidth > container.clientWidth,
                items
            };
        } finally {
            overviews.forEach((node, index) => { node.textContent = previous[index]; });
        }
    }, movieResult, tvResult);
    assert.equal(actionLayout.overflowX, false, 'Search results container should not overflow horizontally');
    assert.deepEqual(actionLayout.items.map(item => item.text), ['Eklendi', '+ Ekle']);
    actionLayout.items.forEach(item => {
        assert.equal(item.whiteSpace, 'nowrap', `${item.text} must stay on one line`);
        assert.equal(item.flexShrink, '0', `${item.text} must not shrink inside flex row`);
        assert.equal(item.lineRects, 1, `${item.text} must render in a single text line`);
        assert.ok(item.height <= 28, `${item.text} height too tall: ${item.height}`);
        assert.ok(item.width >= 40, `${item.text} width too narrow: ${item.width}`);
    });
    await page.click(libraryTv);
    assert.equal(await page.$eval(libraryTv, el => el.getAttribute('aria-pressed')), 'true');
    assert.match(await page.$eval('#share-list-selected-count', el => el.textContent), /2 \/ 30/);
    assert.deepEqual(await page.$$eval('#share-list-selected-items .share-list-pill > span', labels =>
        labels.map(label => label.textContent)), [maliciousTitle + ' (1999)', 'Breaking Bad (2008)']);
    const previewStability = await page.evaluate(() => {
        const modalContent = document.querySelector('.share-list-modal-content');
        const preview = document.getElementById('share-list-preview');
        const pillClose = document.querySelector('#share-list-selected-items .share-list-pill:first-child button');
        const measure = () => ({
            modalTop: Math.round(modalContent.getBoundingClientRect().top),
            modalHeight: Math.round(modalContent.getBoundingClientRect().height),
            previewHeight: Math.round(preview.getBoundingClientRect().height),
            pillTop: Math.round(pillClose.getBoundingClientRect().top)
        });
        renderShareListPreview({ id: 550, media_type: 'movie', title: 'Kısa', overview: '' });
        const shortMetrics = measure();
        renderShareListPreview({ id: 1396, media_type: 'tv', name: 'Uzun', overview: 'Çok uzun açıklama metni. '.repeat(60) });
        const longMetrics = measure();
        return { shortMetrics, longMetrics };
    });
    assert.deepEqual(previewStability.longMetrics, previewStability.shortMetrics,
        'Varying preview synopsis lengths must not bounce modal or shift pill buttons');
    await page.focus('#share-list-selected-items .share-list-pill:first-child button');
    assert.equal(await page.$eval(previewCard + ' h3', el => el.textContent), maliciousTitle + ' (1999)');
    await page.click('#share-list-selected-items .share-list-pill:nth-child(2) button');
    assert.equal(await page.$eval(libraryTv, el => el.getAttribute('aria-pressed')), 'false');
    await page.click(libraryTv);
    await page.click('#share-list-copy-link-btn');
    await page.waitForFunction(() => document.getElementById('share-list-modal-status').textContent.includes('kopyalandı'));
    const copiedLink = await page.evaluate(() => window.__copiedLink);
    const savedOnCopy = await page.evaluate(() => JSON.parse(localStorage.getItem('savedSharedLists')));
    assert.equal(savedOnCopy.length, 1);
    assert.equal(savedOnCopy[0].route, new URL(copiedLink).hash.slice(1));
    await page.click('#share-list-open-btn');
    await page.waitForSelector('#shared-list.active-tab .movie-card[data-media-id="603"]');
    assert.equal(page.url(), copiedLink);
    const savedOnOpen = await page.evaluate(() => JSON.parse(localStorage.getItem('savedSharedLists')));
    assert.equal(savedOnOpen.length, 1);
    assert.equal(savedOnOpen[0].id, savedOnCopy[0].id);
    assert.equal(await page.$eval('#shared-list-save-btn', el => el.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.$eval('#shared-list-clone-btn', el => el.textContent.trim()), 'Seçkiyi Düzenle');
    assert.equal(await page.$('#share-list-modal.active'), null);
    assert.equal(await page.evaluate(() => window.__xss), undefined);

    await page.evaluate(() => toggleTheme());
    await page.setViewport({ width: 390, height: 844 });
    await page.waitForFunction(() => innerWidth === 390);
    await assertNoHorizontalOverflow(page, '#shared-list');

    await page.click('#shared-list-clone-btn');
    await page.waitForSelector('#share-list-modal.active');
    assert.equal(await page.$eval('#share-list-save-btn', el => el.textContent.trim()), 'Kaydet ve Güncelle');
    await page.mouse.click(8, 200);
    await page.waitForSelector('#share-list-modal.active', { hidden: true });

    await page.click('#shared-list-clone-btn');
    await page.waitForSelector('#share-list-modal.active');
    assert.equal(await page.$eval('#share-list-title-input', el => el.value), 'Cuma Film Gecesi');
    assert.equal(await page.$$('#share-list-selected-items .share-list-pill').then(pills => pills.length), 2);
    await page.click('#share-list-selected-items .share-list-pill:nth-child(2) button');
    await page.mouse.click(8, 200);
    assert.notEqual(await page.$('#share-list-modal.active'), null, 'Dirty modal must not close on backdrop click');
    assert.match(await page.$eval('#share-list-modal-status', el => el.textContent), /Kaydedilmemiş değişiklikler var/);
    assert.equal(await page.$$('#share-list-selected-items .share-list-pill').then(pills => pills.length), 1);
    await page.click('#share-list-save-btn');
    await page.waitForSelector('#share-list-modal.active', { hidden: true });
    await page.waitForFunction(() => document.querySelectorAll('#shared-list-grid .movie-card').length === 1);
    const savedAfterUpdate = await page.evaluate(() => JSON.parse(localStorage.getItem('savedSharedLists')));
    assert.equal(savedAfterUpdate.length, 1);
    assert.equal(savedAfterUpdate[0].id, savedOnOpen[0].id);

    await page.click('#shared-list-clone-btn');
    await page.waitForSelector('#share-list-modal.active');
    await page.click(libraryTv);
    await page.click('#share-list-save-btn');
    await page.waitForSelector('#share-list-modal.active', { hidden: true });
    await page.waitForFunction(() => document.querySelectorAll('#shared-list-grid .movie-card').length === 2);

    await page.click('#shared-list-clone-btn');
    await page.waitForSelector('#share-list-modal.active');
    await page.type('#share-list-search-input', 'Matrix');
    await page.waitForSelector(movieResult);
    await assertNoHorizontalOverflow(page, '#share-list-modal');
    await assertNoHorizontalOverflow(page, '.share-list-modal-content');
    await assertNoHorizontalOverflow(page, '#share-list-preview');
    await page.click('#share-list-clear-btn');
    assert.equal(await page.$eval('#share-list-open-btn', el => el.disabled), true);
    assert.equal(await page.$eval('#share-list-save-btn', el => el.disabled), true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#share-list-modal.active', { hidden: true });
    assert.equal(await page.$eval('#shared-list-clone-btn', el => el === document.activeElement), true);

    await page.click('#shared-list-clone-btn');
    await page.evaluate(() => navigate('profile'));
    assert.equal(await page.$eval('#share-list-modal', el => el.inert && el.getAttribute('aria-hidden') === 'true'), true);
    assert.equal(await page.$eval('#main-content', el => el.inert), false);
}

async function testSavedLists(page) {
    const tab = '#tab-profile-shared-lists';
    const panel = '#profile-shared-lists';
    const card = '#saved-lists-grid .saved-list-card';
    const savedLists = () => page.evaluate(() => JSON.parse(localStorage.getItem('savedSharedLists')));
    const clickCardAction = (index, label) => page.evaluate(({ index, label }) => {
        const card = document.querySelectorAll('.saved-list-card')[index];
        const button = Array.from(card.querySelectorAll('.saved-list-actions button'))
            .find(el => el.textContent === label);
        button.focus();
        button.click();
    }, { index, label });

    await page.waitForSelector('#profile.active-tab');
    assert.equal(await page.$eval(tab, el => el.textContent.trim()), 'Seçkilerim (1)');
    await page.click(tab);
    await page.waitForSelector(card, { visible: true });
    await assertNoHorizontalOverflow(page, panel);
    assert.equal(await page.$eval(card + ' .saved-list-title-btn', el => el.textContent), 'Cuma Film Gecesi');
    assert.equal(await page.$eval(card + ' .saved-list-meta', el => el.textContent), '2 yapım • 1 Film, 1 Dizi');
    assert.match(await page.$eval(card + ' .saved-list-sample', el => el.textContent), /\(1999\).*Breaking Bad \(2008\)/);
    assert.deepEqual(await page.$$eval(card + ' .saved-list-posters img', images => images.map(img =>
        [new URL(img.src).pathname, img.alt, img.loading]
    )), Array(2).fill(['/t/p/w154/poster.jpg', '', 'lazy']));
    const [original] = await savedLists();
    await clickCardAction(0, 'Linki Kopyala');
    await page.waitForFunction(() => document.getElementById('saved-lists-status').textContent.includes('kopyalandı'));
    assert.equal(new URL(await page.evaluate(() => window.__copiedLink)).hash, '#' + original.route);

    await clickCardAction(0, 'Düzenle');
    await page.waitForSelector('#share-list-modal.active');
    assert.equal(await page.$eval('#share-list-title-input', el => el.value), original.title);
    await page.focus('#share-list-title-input');
    await page.keyboard.press('Home');
    await page.keyboard.type('Yeni ');
    await page.click('#share-list-copy-link-btn');
    await page.waitForFunction(() => document.getElementById('share-list-modal-status').textContent.includes('kopyalandı'));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#share-list-modal.active', { hidden: true });
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Düzenle');
    const edited = await savedLists();
    assert.equal(edited.length, 1);
    assert.equal(edited[0].id, original.id);
    assert.equal(edited[0].title, 'Yeni ' + original.title);
    assert.equal(await page.$eval(card + ' .saved-list-title-btn', el => el.textContent), edited[0].title);
    await clickCardAction(0, 'Seçkiyi Aç');
    await page.waitForFunction(route => location.hash === '#' + route &&
        document.getElementById('shared-list-save-btn').getAttribute('aria-pressed') === 'true', {}, edited[0].route);

    const partialRoute = 'list?items=m550%2Ct999';
    await page.evaluate(route => navigate(route), partialRoute);
    await page.waitForFunction(() => !document.getElementById('shared-list-save-btn').disabled);
    assert.equal(await page.$eval('#shared-list-save-btn', el => el.textContent.trim()), 'Profilime Kaydet');
    assert.equal(await page.$eval('#shared-list-clone-btn', el => el.textContent.trim()), 'Kopyalayıp Düzenle');
    await page.click('#shared-list-save-btn');
    assert.equal(await page.$eval('#shared-list-save-btn', el => el.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.$eval('#shared-list-save-btn', el => el.textContent.trim()), 'Profilde Kayıtlı');
    assert.equal(await page.$eval('#shared-list-clone-btn', el => el.textContent.trim()), 'Seçkiyi Düzenle');
    const direct = (await savedLists()).find(list => list.route === 'secki/mfa.trr');
    assert.equal(direct.title, 'Paylaşılan Film & Dizi Seçkisi');
    assert.deepEqual(direct.items.map(item => item.id), [550, 999]);

    await page.evaluate(() => navigate('profile'));
    await page.click(tab);
    assert.equal(await page.$eval(tab, el => el.textContent.trim()), 'Seçkilerim (2)');
    await clickCardAction(0, 'Sil');
    await page.waitForFunction(() => document.querySelectorAll('.saved-list-card').length === 1);
    assert.match(await page.$eval('#saved-lists-status', el => el.textContent), /silindi/);
    assert.deepEqual((await savedLists()).map(list => list.id), [original.id]);
    await clickCardAction(0, 'Sil');
    await page.waitForSelector('#saved-lists-grid .tv-tracker-empty', { visible: true });
    assert.equal(await page.$eval(tab, el => el.textContent.trim()), 'Seçkilerim');
    assert.equal(await page.$eval('#saved-lists-create-btn', el => el === document.activeElement), true);

    await page.click('#saved-lists-create-btn');
    await page.waitForSelector('#share-list-modal.active');
    assert.equal(await page.$eval('#share-list-title-input', el => el.value), '');
    await page.click('#share-list-library-chips [data-share-token="m550"]');
    await page.click('#share-list-open-btn');
    await page.waitForFunction(() => location.hash === '#secki/mfa' &&
        document.getElementById('shared-list-save-btn').getAttribute('aria-pressed') === 'true');
    const [untitled] = await savedLists();
    assert.equal(untitled.route, 'secki/mfa');
    assert.equal(untitled.title, 'Paylaşılan Film & Dizi Seçkisi');
    await page.evaluate(() => navigate('profile'));
    await page.click(tab);
    await clickCardAction(0, 'Düzenle');
    await page.waitForSelector('#share-list-modal.active');
    assert.equal(await page.$eval('#share-list-title-input', el => el.value), '');
    await page.click('#share-list-copy-link-btn');
    await page.waitForFunction(() => document.getElementById('share-list-modal-status').textContent.includes('kopyalandı'));
    assert.equal(new URL(await page.evaluate(() => window.__copiedLink)).hash, '#secki/mfa');
    assert.deepEqual((await savedLists()).map(list => list.id), [untitled.id]);

    await page.keyboard.press('Escape');
    await page.waitForSelector('#share-list-modal.active', { hidden: true });
    await page.evaluate(() => {
        safeWriteStorage('watchlist', []);
        safeWriteStorage('ratedMovies', []);
    });
    await page.click('#saved-lists-create-btn');
    const emptyPreview = '#share-list-preview .share-list-preview-empty';
    await page.waitForSelector(emptyPreview, { visible: true });
    assert.equal(await page.$eval(emptyPreview, el => el.textContent),
        'Detayını görmek için bir film veya dizinin üzerine gel.');
    await assertNoHorizontalOverflow(page, '#share-list-preview');
}

async function run() {
    testQueryHelpers();
    const server = http.createServer(serveFile);
    let browser;
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 900 });
        await page.setBypassServiceWorker(true);
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'clipboard', {
                value: { writeText: async text => { window.__copiedLink = text; } }
            });
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const { listDetailRequests, queries } = await mockRequests(page, origin);
        await testSharedList(page, origin, listDetailRequests);
        await testBuilder(page, queries);
        await testSavedLists(page);
        assert.deepEqual(errors, [], 'Shared list flow should produce zero page errors');
        console.log('[PASS] Shared list regression tests passed');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
