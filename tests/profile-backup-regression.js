const http = require('http');
const fs = require('fs');
const os = require('os');
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

function createBackup(data, version = 1) {
    return {
        app: 'FilmimNerede',
        version,
        exportedAt: '2026-09-11T12:00:00.000Z',
        data
    };
}

async function waitForDownloadedJson(downloadDir) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const files = fs
            .readdirSync(downloadDir)
            .filter(name => name.endsWith('.json'));
        const pending = fs
            .readdirSync(downloadDir)
            .some(name => name.endsWith('.crdownload'));
        if (files.length > 0 && !pending) {
            return path.join(downloadDir, files[0]);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Exported backup file was not downloaded');
}

async function runTest() {
    let server;
    let browser;
    const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'filmimnerede-profile-backup-')
    );
    const downloadDir = path.join(tempDir, 'downloads');
    fs.mkdirSync(downloadDir);

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
            const url = request.url();

            if (url.includes('api.themoviedb.org')) {
                if (
                    url.includes('/genre/movie/list') ||
                    url.includes('/genre/tv/list')
                ) {
                    request.respond({
                        status: 200,
                        headers: { 'Access-Control-Allow-Origin': '*' },
                        contentType: 'application/json',
                        body: JSON.stringify({ genres: [] })
                    });
                    return;
                }

                request.respond({
                    status: 200,
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    contentType: 'application/json',
                    body: JSON.stringify({
                        id: 1,
                        runtime: 120,
                        results: {}
                    })
                });
                return;
            }

            if (url.startsWith(`http://127.0.0.1:${port}`)) {
                request.continue();
                return;
            }

            request.abort();
        });

        await page.goto(
            `http://127.0.0.1:${port}/#profile`,
            { waitUntil: 'domcontentloaded', timeout: 30000 }
        );
        await page.waitForSelector('#profile.active-tab', { timeout: 10000 });
        await page.waitForFunction(
            () =>
                typeof window.createProfileBackupPayload === 'function' &&
                typeof window.handleProfileBackupFileSelection === 'function'
        );

        const client = await page.target().createCDPSession();
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: downloadDir
        });

        await page.evaluate(() => {
            localStorage.clear();
            localStorage.setItem(
                'watchlist',
                JSON.stringify([
                    {
                        id: 101,
                        title: 'Export Movie',
                        poster_path: '/poster.jpg',
                        media_type: 'movie'
                    }
                ])
            );
            localStorage.setItem(
                'ratedMovies',
                JSON.stringify([
                    {
                        id: 202,
                        name: 'Export TV',
                        first_air_date: '2024-01-01',
                        media_type: 'tv',
                        exact_runtime_mins_v2: 900
                    }
                ])
            );
            localStorage.setItem('movieRatings', JSON.stringify({ 202: 8.5 }));
            localStorage.setItem(
                'favoriteActors',
                JSON.stringify([{ id: 303, name: 'Export Actor' }])
            );
            localStorage.setItem(
                'recentlyViewed',
                JSON.stringify([
                    {
                        id: 404,
                        title: 'Export Recent',
                        media_type: 'movie'
                    }
                ])
            );
            localStorage.setItem('theme', 'light');
            localStorage.setItem('imdb_tt1234567', '8.9');
        });

        await page.click('#profile-export-btn');
        const downloadedPath = await waitForDownloadedJson(downloadDir);
        const exported = JSON.parse(fs.readFileSync(downloadedPath, 'utf8'));

        assert(exported.app === 'FilmimNerede', 'Export app marker should match');
        assert(exported.version === 1, 'Export version should be 1');
        assert(
            Object.keys(exported.data).sort().join(',') ===
                'favoriteActors,movieRatings,ratedMovies,recentlyViewed,watchlist',
            'Export should contain only the five profile data keys'
        );
        assert(exported.data.watchlist[0].id === 101, 'Watchlist should export');
        assert(exported.data.movieRatings['202'] === 8.5, 'Ratings should export');
        assert(!('theme' in exported.data), 'Theme should not be exported');
        assert(!('imdb_tt1234567' in exported.data), 'IMDb cache should not be exported');

        const baseline = {
            watchlist: [
                { id: 1, title: 'Current Movie', media_type: 'movie' }
            ],
            ratedMovies: [
                {
                    id: 2,
                    title: 'Current Rated',
                    media_type: 'movie',
                    exact_runtime_mins_v2: 120
                }
            ],
            movieRatings: { 2: 8 },
            favoriteActors: [{ id: 3, name: 'Current Actor' }],
            recentlyViewed: [
                { id: 4, title: 'Current Recent', media_type: 'movie' }
            ]
        };

        await page.evaluate(data => {
            Object.entries(data).forEach(([key, value]) => {
                localStorage.setItem(key, JSON.stringify(value));
            });
        }, baseline);

        const invalidIdPath = path.join(tempDir, 'invalid-id.json');
        fs.writeFileSync(
            invalidIdPath,
            JSON.stringify(
                createBackup({
                    ...baseline,
                    watchlist: [{ id: 0, title: 'Invalid', media_type: 'movie' }]
                })
            )
        );

        const beforeInvalid = await page.evaluate(() => ({
            watchlist: localStorage.getItem('watchlist'),
            ratedMovies: localStorage.getItem('ratedMovies'),
            movieRatings: localStorage.getItem('movieRatings'),
            favoriteActors: localStorage.getItem('favoriteActors'),
            recentlyViewed: localStorage.getItem('recentlyViewed')
        }));

        await page.evaluate(() => {
            document.getElementById('profile-backup-status').textContent = '';
        });
        let input = await page.$('#profile-import-file');
        await input.uploadFile(invalidIdPath);
        await page.waitForFunction(
            () => document.getElementById('profile-backup-status')?.dataset.state === 'error'
        );

        const afterInvalid = await page.evaluate(() => ({
            watchlist: localStorage.getItem('watchlist'),
            ratedMovies: localStorage.getItem('ratedMovies'),
            movieRatings: localStorage.getItem('movieRatings'),
            favoriteActors: localStorage.getItem('favoriteActors'),
            recentlyViewed: localStorage.getItem('recentlyViewed')
        }));
        assert(
            JSON.stringify(afterInvalid) === JSON.stringify(beforeInvalid),
            'Invalid item import must leave all profile storage unchanged'
        );

        const invalidRatingPath = path.join(tempDir, 'invalid-rating.json');
        fs.writeFileSync(
            invalidRatingPath,
            JSON.stringify(
                createBackup({
                    ...baseline,
                    movieRatings: { 2: 99 }
                })
            )
        );
        await page.evaluate(() => {
            document.getElementById('profile-backup-status').textContent = '';
            document.getElementById('profile-backup-status').dataset.state = '';
        });
        input = await page.$('#profile-import-file');
        await input.uploadFile(invalidRatingPath);
        await page.waitForFunction(
            () => document.getElementById('profile-backup-status')?.dataset.state === 'error'
        );
        const ratingAfterInvalid = await page.evaluate(
            () => localStorage.getItem('movieRatings')
        );
        assert(
            ratingAfterInvalid === beforeInvalid.movieRatings,
            'Invalid rating import must not change ratings'
        );

        const wrongVersionPath = path.join(tempDir, 'wrong-version.json');
        fs.writeFileSync(
            wrongVersionPath,
            JSON.stringify(createBackup(baseline, 999))
        );
        await page.evaluate(() => {
            document.getElementById('profile-backup-status').textContent = '';
            document.getElementById('profile-backup-status').dataset.state = '';
        });
        input = await page.$('#profile-import-file');
        await input.uploadFile(wrongVersionPath);
        await page.waitForFunction(
            () => document.getElementById('profile-backup-status')?.dataset.state === 'error'
        );
        assert(
            await page.evaluate(() => localStorage.getItem('watchlist')) ===
                beforeInvalid.watchlist,
            'Unsupported backup version must not change data'
        );

        const corruptPath = path.join(tempDir, 'corrupt.json');
        fs.writeFileSync(corruptPath, '{ definitely-not-json');
        await page.evaluate(() => {
            document.getElementById('profile-backup-status').textContent = '';
            document.getElementById('profile-backup-status').dataset.state = '';
        });
        input = await page.$('#profile-import-file');
        await input.uploadFile(corruptPath);
        await page.waitForFunction(
            () => document.getElementById('profile-backup-status')?.dataset.state === 'error'
        );
        assert(
            await page.evaluate(() => localStorage.getItem('watchlist')) ===
                beforeInvalid.watchlist,
            'Corrupt JSON must not change data'
        );

        const mergePath = path.join(tempDir, 'merge.json');
        fs.writeFileSync(
            mergePath,
            JSON.stringify(
                createBackup({
                    watchlist: [
                        { id: 1, title: 'Imported Duplicate', media_type: 'movie' },
                        { id: 10, title: 'Imported Movie', media_type: 'movie' }
                    ],
                    ratedMovies: [
                        {
                            id: 2,
                            title: 'Imported Rated Duplicate',
                            media_type: 'movie',
                            exact_runtime_mins_v2: 120
                        },
                        {
                            id: 20,
                            title: 'Imported Rated',
                            media_type: 'movie',
                            exact_runtime_mins_v2: 120
                        }
                    ],
                    movieRatings: { 2: 3, 20: 9 },
                    favoriteActors: [
                        { id: 3, name: 'Imported Duplicate Actor' },
                        { id: 30, name: 'Imported Actor' }
                    ],
                    recentlyViewed: [
                        { id: 4, title: 'Imported Duplicate Recent', media_type: 'movie' },
                        { id: 40, title: 'Imported Recent', media_type: 'movie' }
                    ]
                })
            )
        );

        await page.select('#profile-import-mode', 'merge');
        await page.evaluate(() => {
            document.getElementById('profile-backup-status').textContent = '';
            document.getElementById('profile-backup-status').dataset.state = '';
        });
        input = await page.$('#profile-import-file');
        await input.uploadFile(mergePath);
        await page.waitForFunction(
            () => document.getElementById('profile-backup-status')?.dataset.state === 'success'
        );

        const merged = await page.evaluate(() => ({
            watchlist: JSON.parse(localStorage.getItem('watchlist')),
            ratedMovies: JSON.parse(localStorage.getItem('ratedMovies')),
            movieRatings: JSON.parse(localStorage.getItem('movieRatings')),
            favoriteActors: JSON.parse(localStorage.getItem('favoriteActors')),
            recentlyViewed: JSON.parse(localStorage.getItem('recentlyViewed')),
            watchlistText: document.getElementById('watchlist-grid')?.textContent || ''
        }));

        assert(merged.watchlist.length === 2, 'Merge should deduplicate watchlist items');
        assert(
            merged.watchlist[0].title === 'Current Movie',
            'Merge should preserve the current duplicate watchlist item'
        );
        assert(merged.watchlist[1].id === 10, 'Merge should add missing watchlist items');
        assert(merged.movieRatings['2'] === 8, 'Current rating should win during merge');
        assert(merged.movieRatings['20'] === 9, 'Missing imported rating should be added');
        assert(merged.favoriteActors.length === 2, 'Favorite actors should merge by id');
        assert(merged.recentlyViewed.length === 2, 'Recently viewed should merge by id');
        assert(
            merged.watchlistText.includes('Imported Movie'),
            'Profile UI should refresh after a successful merge import'
        );

        const cancelPath = path.join(tempDir, 'cancel-replace.json');
        fs.writeFileSync(
            cancelPath,
            JSON.stringify(
                createBackup({
                    watchlist: [
                        { id: 88, title: 'Cancelled Replacement', media_type: 'movie' }
                    ],
                    ratedMovies: [],
                    movieRatings: {},
                    favoriteActors: [],
                    recentlyViewed: []
                })
            )
        );

        const beforeCancelledReplace = await page.evaluate(
            () => localStorage.getItem('watchlist')
        );
        await page.select('#profile-import-mode', 'replace');
        page.once('dialog', async dialog => {
            await dialog.dismiss();
        });
        await page.evaluate(() => {
            document.getElementById('profile-backup-status').textContent = '';
            document.getElementById('profile-backup-status').dataset.state = '';
        });
        input = await page.$('#profile-import-file');
        await input.uploadFile(cancelPath);
        await page.waitForFunction(
            () => document.getElementById('profile-backup-status')?.textContent === 'İçe aktarma iptal edildi.'
        );
        assert(
            await page.evaluate(() => localStorage.getItem('watchlist')) ===
                beforeCancelledReplace,
            'Cancelled replace import must leave data unchanged'
        );

        const replacePath = path.join(tempDir, 'replace.json');
        fs.writeFileSync(
            replacePath,
            JSON.stringify(
                createBackup({
                    watchlist: [
                        { id: 99, title: 'Replacement Movie', media_type: 'movie' }
                    ],
                    ratedMovies: [],
                    movieRatings: {},
                    favoriteActors: [],
                    recentlyViewed: []
                })
            )
        );

        await page.select('#profile-import-mode', 'replace');
        page.once('dialog', async dialog => {
            await dialog.accept();
        });
        await page.evaluate(() => {
            document.getElementById('profile-backup-status').textContent = '';
            document.getElementById('profile-backup-status').dataset.state = '';
        });
        input = await page.$('#profile-import-file');
        await input.uploadFile(replacePath);
        await page.waitForFunction(
            () => document.getElementById('profile-backup-status')?.dataset.state === 'success'
        );

        const replaced = await page.evaluate(() => ({
            watchlist: JSON.parse(localStorage.getItem('watchlist')),
            ratedMovies: JSON.parse(localStorage.getItem('ratedMovies')),
            movieRatings: JSON.parse(localStorage.getItem('movieRatings')),
            favoriteActors: JSON.parse(localStorage.getItem('favoriteActors')),
            recentlyViewed: JSON.parse(localStorage.getItem('recentlyViewed'))
        }));

        assert(
            replaced.watchlist.length === 1 && replaced.watchlist[0].id === 99,
            'Replace should replace the watchlist'
        );
        assert(replaced.ratedMovies.length === 0, 'Replace should clear rated movies');
        assert(
            Object.keys(replaced.movieRatings).length === 0,
            'Replace should clear ratings'
        );
        assert(replaced.favoriteActors.length === 0, 'Replace should clear favorite actors');
        assert(replaced.recentlyViewed.length === 0, 'Replace should clear recent items');
        assert(
            await page.evaluate(() => localStorage.getItem('theme')) === 'light',
            'Replace must not overwrite the theme preference'
        );
        assert(
            await page.evaluate(() => localStorage.getItem('imdb_tt1234567')) === '8.9',
            'Replace must not delete unrelated IMDb cache entries'
        );

        assert(pageErrors.length === 0, `Unexpected page errors: ${pageErrors.join(', ')}`);
        console.log('Profile backup regression test passed.');
    } finally {
        if (browser) {
            await browser.close();
        }
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runTest().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
