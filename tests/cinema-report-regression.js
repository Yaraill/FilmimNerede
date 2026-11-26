const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const puppeteer = require('puppeteer');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon'
};

function createMockElement() {
    const listeners = {};
    return {
        hidden: false,
        dataset: {},
        attributes: {},
        classList: { toggle() {} },
        addEventListener(type, listener) { listeners[type] = listener; },
        setAttribute(name, value) { this.attributes[name] = value; },
        replaceChildren() { this.innerHTML = ''; },
        click() { listeners.click?.(); }
    };
}

function loadProfileVm() {
    const elements = {
        'cinema-report-summary': createMockElement(),
        'cinema-report-toggle-btn': createMockElement(),
        'cinema-report-body': createMockElement()
    };
    const context = vm.createContext({
        window: { movieCache: {}, genresCache: {}, genreMap: {} },
        document: {
            addEventListener() {},
            getElementById(id) { return elements[id] || null; }
        },
        localStorage: { getItem: () => null, setItem() {} },
        fetch: async () => { throw new Error('Unexpected network request'); },
        console,
        URL,
        Date,
        Math,
        Number,
        String,
        Object,
        Array,
        Set,
        Map,
        Promise
    });
    for (const script of ['security.js', 'profile.js']) {
        const filename = path.join(ROOT_DIR, 'js', 'runtime', script);
        vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    }
    return { runtime: context, elements };
}

function getCspHeader() {
    const toml = fs.readFileSync(path.join(ROOT_DIR, 'netlify.toml'), 'utf8');
    const match = toml.match(/Content-Security-Policy\s*=\s*"""([\s\S]*?)"""/);
    assert.ok(match, 'netlify.toml CSP policy is required');
    return match[1].replace(/\\[ \t]*\r?\n[ \t\r\n]*/g, '').replace(/^\r?\n/, '').trim();
}

async function runUnitTests() {
    const { runtime, elements } = loadProfileVm();
    const empty = runtime.buildProfileCinemaReport();
    assert.equal(empty.hasData, false);
    assert.equal(empty.ratingHistogram.scoredCount, 0);
    assert.equal(empty.ratingHistogram.histogram.length, 10);
    assert.ok(empty.ratingHistogram.histogram.every(bucket => bucket.count === 0));
    assert.deepEqual(Array.from(empty.topGenres), []);
    assert.deepEqual(Array.from(empty.decades), []);

    const items = [
        { id: 550, media_type: 'movie', title: 'Fight Club', release_date: '1999-10-15', genre_ids: [18, 18] },
        { id: 550, media_type: 'movie', title: 'Duplicate', release_date: '1999-10-15', genre_ids: [18] },
        { id: 550, media_type: 'tv', name: 'Shared ID Show', first_air_date: '2024-01-01', genre_ids: [878, 10765] },
        { id: 2, media_type: 'movie', title: 'Old Film', release_date: '1957-04-03', genre_ids: [18] },
        { id: 3, media_type: 'movie', title: '<img src=x onerror=alert(1)>', release_date: '2021-01-01', genres: [{ id: 99999, name: '<img src=x onerror=alert(2)>' }] }
    ];
    const report = runtime.buildProfileCinemaReport({
        ratedMovies: items,
        watchlist: [
            { id: 10, media_type: 'movie', title: 'Watch only', release_date: 'not-a-date' },
            { id: 550, media_type: 'tv', name: 'Shared ID Show', first_air_date: '2024-01-01' }
        ],
        savedRatings: {
            'movie:550': 8.5,
            'tv:550': 9,
            'movie:2': 7.5,
            'movie:3': 5
        },
        trackedTvShows: [
            { id: 550, watched: ['S1E1', 'S1E2'] },
            { id: 550, watched: ['S1E3'] }
        ]
    });
    assert.equal(report.ratingHistogram.scoredCount, 4);
    assert.equal(report.ratingHistogram.averageRating, '7.5');
    assert.equal(report.ratingHistogram.medianRating, 8);
    assert.equal(report.ratingHistogram.modeRating, 9);
    assert.equal(report.ratingHistogram.highRatingPercent, 50);
    assert.equal(report.ratingHistogram.histogram[7].count, 1);
    assert.equal(report.ratingHistogram.histogram[8].count, 2);
    assert.equal(report.ratingHistogram.histogram[9].count, 0);
    assert.equal(report.topGenres.find(genre => genre.id === 18)?.name, 'Dram');
    assert.equal(report.topGenres.find(genre => genre.id === 878)?.name, 'Bilim Kurgu');
    assert.equal(report.topGenres.find(genre => genre.id === 10765)?.name, 'Bilim Kurgu & Fantazi');
    assert.equal(report.topGenres.find(genre => genre.id === 18)?.count, 2, 'Duplicate genre IDs on one item count once');
    assert.equal(report.topGenres.find(genre => genre.id === 99999)?.name, '<img src=x onerror=alert(2)>');
    assert.deepEqual(Array.from(report.decades, decade => [decade.key, decade.label]), [
        ['pre-1970', '1970 Öncesi'],
        ['1990', "1990'lar"],
        ['2020', "2020'ler"]
    ]);
    assert.equal(report.library.totalUnique, 5);
    assert.equal(report.library.movieCount, 4);
    assert.equal(report.library.tvCount, 1);
    assert.equal(report.library.trackedShowCount, 1);
    assert.equal(report.library.trackedEpisodeCount, 2);

    const evenMedian = runtime.buildProfileCinemaReport({
        ratedMovies: [
            { id: 1, title: 'One' },
            { id: 2, title: 'Two' },
            { id: 3, title: 'Three' },
            { id: 4, title: 'Four' }
        ],
        savedRatings: { 'movie:1': 5, 'movie:2': 7.5, 'movie:3': 8.5, 'movie:4': 9 }
    });
    assert.equal(evenMedian.ratingHistogram.medianRating, 8);
    const oddMedian = runtime.buildProfileCinemaReport({
        ratedMovies: [{ id: 1 }, { id: 2 }, { id: 3 }],
        savedRatings: { 'movie:1': 5, 'movie:2': 8.5, 'movie:3': 9 }
    });
    assert.equal(oddMedian.ratingHistogram.medianRating, 8.5);
    const leftoverRatings = runtime.buildProfileCinemaReport({ savedRatings: { 'movie:1': 6, 'tv:2': 9 } });
    assert.equal(leftoverRatings.ratingHistogram.scoredCount, 2);

    runtime.renderProfileCinemaReport({
        ratedMovies: [items[4]],
        watchlist: [],
        savedRatings: { 'movie:3': 5 },
        trackedTvShows: []
    });
    assert.match(elements['cinema-report-body'].innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(elements['cinema-report-body'].innerHTML, /&lt;img src=x onerror=alert\(2\)&gt;/);
    assert.doesNotMatch(elements['cinema-report-body'].innerHTML, /<img src=x/);
    assert.equal(elements['cinema-report-toggle-btn'].hidden, false);
    elements['cinema-report-toggle-btn'].click();
    assert.equal(elements['cinema-report-body'].hidden, false);

    runtime.renderProfileCinemaReport({ watchlist: [], ratedMovies: [], savedRatings: {}, trackedTvShows: [] });
    assert.equal(elements['cinema-report-summary'].textContent,
        'Henüz puanladığın veya listene eklediğin bir yapım yok. Yapım puanladıkça kişisel sinema karnen burada oluşur.');
    assert.equal(elements['cinema-report-toggle-btn'].hidden, true);
    assert.equal(elements['cinema-report-body'].hidden, true);
}

function serveRepository(cspHeader) {
    return (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/.netlify/functions/tmdb' || url.pathname === '/.netlify/functions/omdb') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ results: [], total_pages: 1 }));
        }
        if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            return res.end();
        }
        const relative = url.pathname === '/' ? 'index.html' : `.${decodeURIComponent(url.pathname)}`;
        const filename = path.resolve(ROOT_DIR, relative);
        const extension = path.extname(filename).toLowerCase();
        if (!filename.startsWith(ROOT_DIR + path.sep) || !MIME_TYPES[extension] || !fs.existsSync(filename)) {
            res.writeHead(404);
            return res.end();
        }
        res.writeHead(200, {
            ...(extension === '.html' ? { 'Content-Security-Policy': cspHeader } : {}),
            'Content-Type': MIME_TYPES[extension]
        });
        res.end(fs.readFileSync(filename));
    };
}

async function runBrowserTests() {
    const server = http.createServer(serveRepository(getCspHeader()));
    let browser;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('request', request => {
            const requestUrl = new URL(request.url());
            if (requestUrl.origin === `http://127.0.0.1:${server.address().port}`) return request.continue();
            return request.abort();
        });
        await page.evaluateOnNewDocument(() => {
            window.__cspViolations = [];
            document.addEventListener('securitypolicyviolation', event => {
                window.__cspViolations.push(event.violatedDirective);
            });
            localStorage.setItem('watchlist', '[]');
            localStorage.setItem('ratedMovies', '[]');
            localStorage.setItem('movieRatings', '{}');
            localStorage.setItem('tvEpisodeProgress', '{}');
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        await page.goto(`${origin}/#profile`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('#cinema-report-summary');
        await page.waitForFunction(() => document.querySelector('#cinema-report-summary')?.textContent.includes('Henüz puanladığın'));
        assert.equal(await page.$eval('#cinema-report-toggle-btn', button => button.hidden), true);
        assert.equal(await page.$eval('#cinema-report-body', body => body.hidden), true);

        await page.evaluate(() => {
            localStorage.setItem('ratedMovies', JSON.stringify([
                { id: 1, media_type: 'movie', title: 'Old Film', release_date: '1957-01-01', genre_ids: [18] },
                { id: 2, media_type: 'movie', title: 'Fight Club', release_date: '1999-01-01', genre_ids: [18, 80] },
                { id: 3, media_type: 'tv', name: 'Sci-Fi Show', first_air_date: '2024-01-01', genre_ids: [878, 10765] },
                { id: 4, media_type: 'movie', title: 'Comedy', release_date: '2020-01-01', genre_ids: [35] },
                { id: 5, media_type: 'tv', name: 'Drama Show', first_air_date: '1994-01-01', genre_ids: [18] },
                { id: 6, media_type: 'movie', title: 'Crime', release_date: '2010-01-01', genre_ids: [80] }
            ]));
            localStorage.setItem('watchlist', JSON.stringify([
                { id: 7, media_type: 'movie', title: 'Upcoming', release_date: '2023-01-01' }
            ]));
            localStorage.setItem('movieRatings', JSON.stringify({
                'movie:1': 8, 'movie:2': 9, 'tv:3': 10, 'movie:4': 5, 'tv:5': 7, 'movie:6': 6
            }));
            localStorage.setItem('tvEpisodeProgress', JSON.stringify({
                'tv:3': {
                    id: 3,
                    media_type: 'tv',
                    name: 'Sci-Fi Show',
                    first_air_date: '2024-01-01',
                    genre_ids: [878, 10765],
                    watched: ['S1E1', 'S1E2'],
                    updatedAt: 1
                }
            }));
            refreshProfileWatchStats();
        });
        await page.waitForFunction(() =>
            document.querySelector('#cinema-report-summary')?.textContent.includes('6 puanlı yapım')
        );
        const summary = await page.$eval('#cinema-report-summary', element => element.textContent);
        assert.match(summary, /En baskın dönem: 1990'lar/);
        assert.match(summary, /En yüksek ort\.:/);
        assert.equal(await page.$eval('#cinema-report-toggle-btn', button => button.hidden), false);
        assert.equal(await page.$eval('#cinema-report-toggle-btn', button => button.getAttribute('aria-expanded')), 'false');
        assert.equal(await page.$eval('#cinema-report-body', body => body.hidden), true);
        await page.click('#cinema-report-toggle-btn');
        assert.equal(await page.$eval('#cinema-report-toggle-btn', button => button.getAttribute('aria-expanded')), 'true');
        assert.match(await page.$eval('#cinema-report-toggle-btn', button => button.textContent), /Detayları Gizle/);
        assert.equal(await page.$eval('#cinema-report-body', body => body.hidden), false);
        assert.equal(await page.$$eval('.cinema-hist-col', columns => columns.length), 10);
        assert.ok(await page.$$eval('.cinema-hist-bar.has-value', bars =>
            bars.length > 0 && bars.every(bar => bar.getBoundingClientRect().height >= 4)
        ), 'Non-zero rating buckets must render visible bars');
        const reportText = await page.$eval('#cinema-report-body', body => body.textContent);
        assert.match(reportText, /Dram/);
        assert.match(reportText, /Bilim Kurgu/);
        assert.doesNotMatch(reportText, /Belirsiz/);
        assert.match(reportText, /1990'lar/);
        assert.match(reportText, /2020'ler/);
        assert.match(reportText, /1970 Öncesi/);
        assert.match(reportText, /2 İzlenen Bölüm/);
        await page.click('#cinema-report-toggle-btn');
        assert.equal(await page.$eval('#cinema-report-toggle-btn', button => button.getAttribute('aria-expanded')), 'false');
        assert.match(await page.$eval('#cinema-report-toggle-btn', button => button.textContent), /Detayları Göster/);
        assert.equal(await page.$eval('#cinema-report-body', body => body.hidden), true);

        const beforeLiveUpdate = await page.$$eval('.cinema-hist-col', columns =>
            [...columns].map(column => column.querySelector('.cinema-hist-count').textContent)
        );
        await page.evaluate(() => {
            localStorage.setItem('movieRatings', JSON.stringify({
                'movie:1': 10, 'movie:2': 9, 'tv:3': 10, 'movie:4': 5, 'tv:5': 7, 'movie:6': 6, 'movie:7': 8
            }));
            localStorage.setItem('ratedMovies', JSON.stringify([
                ...JSON.parse(localStorage.getItem('ratedMovies')),
                { id: 7, media_type: 'movie', title: 'Upcoming', release_date: '2023-01-01' }
            ]));
            refreshProfileWatchStats();
            refreshProfileWatchStats();
        });
        await page.waitForFunction(() =>
            document.querySelector('#cinema-report-summary')?.textContent.includes('7 puanlı yapım')
        );
        const afterLiveUpdate = await page.$$eval('.cinema-hist-col', columns =>
            [...columns].map(column => column.querySelector('.cinema-hist-count').textContent)
        );
        assert.notDeepEqual(afterLiveUpdate, beforeLiveUpdate);
        await page.click('#cinema-report-toggle-btn');
        assert.equal(await page.$eval('#cinema-report-toggle-btn', button => button.getAttribute('aria-expanded')), 'true',
            'Repeated refreshes must not stack toggle handlers');

        await page.evaluate(() => document.body.classList.add('light-theme'));
        await page.setViewport({ width: 390, height: 844 });
        const mobile = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            cards: [...document.querySelectorAll('.cinema-report-card')].map(card => card.getBoundingClientRect().right)
        }));
        assert.equal(mobile.scrollWidth, mobile.clientWidth, 'Cinema report must not cause horizontal overflow');
        assert.ok(mobile.cards.every(right => right <= 390), 'Cinema report cards must fit within mobile viewport');

        await new Promise(resolve => setTimeout(resolve, 50));
        assert.deepEqual(pageErrors, [], `Unexpected pageerror: ${pageErrors.join('; ')}`);
        assert.deepEqual(await page.evaluate(() => window.__cspViolations), [], 'CSP violations must remain empty');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

(async () => {
    await runUnitTests();
    console.log('✓ Sinema karnesi hesaplama ve XSS birim testleri başarılı.');
    await runBrowserTests();
    console.log('✓ Sinema karnesi tarayıcı, CSP ve mobil regresyon testleri başarılı.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
