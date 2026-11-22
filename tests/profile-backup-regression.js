const http = require('http');
const fs = require('fs');
const os = require('os');
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

function createBackup(data, version = 2) {
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

async function importBackupFile(page, filePath, expectedState, expectedMessage = null) {
    await page.evaluate(() => {
        const status = document.getElementById('profile-backup-status');
        status.textContent = '';
        status.dataset.state = '';
    });
    const input = await page.$('#profile-import-file');
    await input.uploadFile(filePath);
    await page.waitForFunction((state, message) => {
        const status = document.getElementById('profile-backup-status');
        return status?.dataset.state === state && (message === null || status.textContent === message);
    }, {}, expectedState, expectedMessage);
}

async function readStoredValues(page, keys) {
    return page.evaluate(keys => Object.fromEntries(
        keys.map(key => [key, localStorage.getItem(key)])
    ), keys);
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
            const url = toTmdbApiUrl(request.url());

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

        const { currentList, importedList, conflictingList, duplicateRouteList } = await page.evaluate(() => {
            function makeList(id, title, movieId, updatedAt, legacy = false) {
                const items = [{ id: movieId, title: 'List Movie', media_type: 'movie' }];
                const route = legacy ? buildLegacySharedListRoute(title, items) : buildSharedListRoute(title, items);
                return { id, title, items, route, updatedAt };
            }
            const currentList = { ...makeList('current', 'Current List', 51, 200), shortId: 'Current1' };
            return {
                currentList,
                importedList: { ...makeList('imported', 'Imported List', 52, 300, true), shortId: 'Import12' },
                conflictingList: makeList('current', 'Conflicting List', 53, 500),
                duplicateRouteList: { ...currentList, id: 'duplicate-route', updatedAt: 600 }
            };
        });
        const currentProgress = {
            id: 71, media_type: 'tv', name: 'Current TV', poster_path: '/current.jpg',
            totalSeasons: 2, totalEpisodes: 20, avgEpisodeRuntime: 45,
            watched: ['S1E1'], episodeRuntimes: { S1E1: 40 }, updatedAt: 100
        };
        const v2Baseline = {
            userSubscribedProviders: [8, '8', 119],
            tvEpisodeProgress: { 'tv:71': currentProgress },
            savedSharedLists: [currentList, { ...currentList, updatedAt: 100, shortId: 'Older123' }]
        };

        await page.evaluate(data => {
            localStorage.clear();
            Object.entries(data).forEach(([key, value]) => {
                localStorage.setItem(key, JSON.stringify(value));
            });
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
        }, v2Baseline);

        await page.click('#profile-export-btn');
        const downloadedPath = await waitForDownloadedJson(downloadDir);
        const exported = JSON.parse(fs.readFileSync(downloadedPath, 'utf8'));

        assert(exported.app === 'FilmimNerede', 'Export app marker should match');
        assert(exported.version === 2, 'Export version should be 2');
        assert(
            Object.keys(exported.data).sort().join(',') ===
                'favoriteActors,movieRatings,ratedMovies,recentlyViewed,savedSharedLists,tvEpisodeProgress,userSubscribedProviders,watchlist',
            'Export should contain only the eight profile data keys'
        );
        assert(exported.data.watchlist[0].id === 101, 'Watchlist should export');
        assert(exported.data.movieRatings['202'] === 8.5, 'Ratings should export');
        assert(!('theme' in exported.data), 'Theme should not be exported');
        assert(!('imdb_tt1234567' in exported.data), 'IMDb cache should not be exported');

        assert(exported.data.userSubscribedProviders.join(',') === '8,119', 'Subscriptions should export as unique IDs');
        assert(exported.data.tvEpisodeProgress['tv:71'].watched[0] === 'S1E1', 'TV progress should export');
        assert(
            exported.data.savedSharedLists.length === 1 &&
                exported.data.savedSharedLists[0].shortId === 'Current1',
            'Saved lists should export the newest record for each ID with its short ID'
        );
        await page.evaluate(payload => window.validateProfileBackupPayload(payload), exported);

        const v1Baseline = {
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
        }, { ...v1Baseline, ...v2Baseline });

        const storageKeys = [...Object.keys(exported.data), 'theme', 'imdb_tt1234567'];
        const beforeInvalid = await readStoredValues(page, storageKeys);
        const baseline = { ...v1Baseline, ...v2Baseline };
        const invalidBackups = [
            ['invalid-id', createBackup({ ...baseline, watchlist: [{ id: 0, title: 'Invalid', media_type: 'movie' }] })],
            ['invalid-rating', createBackup({ ...baseline, movieRatings: { 2: 99 } })],
            ['invalid-provider', createBackup({ ...baseline, userSubscribedProviders: [8, 999999] })],
            ['invalid-tv-episode', createBackup({
                ...baseline, tvEpisodeProgress: { 'tv:71': { ...currentProgress, watched: ['S1E1', 'S0E2'] } }
            })],
            ['invalid-tv-id', createBackup({ ...baseline, tvEpisodeProgress: { 'tv:72': currentProgress } })],
            ['invalid-list', createBackup({ ...baseline, savedSharedLists: [{ ...currentList, route: 'secki/m1' }] })],
            ['invalid-list-item', createBackup({
                ...baseline, savedSharedLists: [{ ...currentList, items: [...currentList.items, { id: 0 }] }]
            })],
            ['invalid-list-short-id', createBackup({ ...baseline, savedSharedLists: [{ ...currentList, shortId: '/' }] })],
            ['oversized-list', createBackup({ ...baseline, savedSharedLists: Array(41).fill(currentList) })],
            ['missing-v2-fields', createBackup(v1Baseline)],
            ['wrong-version', createBackup(baseline, 999)]
        ];
        const invalidFiles = invalidBackups.map(([name, backup]) => [name, JSON.stringify(backup)]);
        invalidFiles.push(['corrupt', '{ definitely-not-json']);
        for (const [name, contents] of invalidFiles) {
            const filePath = path.join(tempDir, name + '.json');
            fs.writeFileSync(filePath, contents);
            await importBackupFile(page, filePath, 'error');
            assert(
                JSON.stringify(await readStoredValues(page, storageKeys)) === JSON.stringify(beforeInvalid),
                name + ' import must leave all profile storage unchanged'
            );
        }

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
                    ],
                    userSubscribedProviders: [119, 337, 337],
                    tvEpisodeProgress: {
                        'tv:71': {
                            id: 71, media_type: 'tv', name: 'Imported Duplicate TV',
                            watched: ['S1E2', 'S1E1'], episodeRuntimes: { S1E1: 99, S1E2: 50 }, updatedAt: 300
                        },
                        'tv:72': {
                            id: 72, media_type: 'tv', name: 'Imported TV',
                            watched: ['S2E1'], episodeRuntimes: { S2E1: 45 }, updatedAt: 200
                        }
                    },
                    savedSharedLists: [importedList, conflictingList, duplicateRouteList],
                    theme: 'dark',
                    imdb_tt1234567: '1.0'
                })
            )
        );

        await page.select('#profile-import-mode', 'merge');
        await page.evaluate(() => navigate('platform'));
        await page.waitForSelector('#platform.active-tab');
        await importBackupFile(page, mergePath, 'success');

        const mergedRaw = await readStoredValues(page, storageKeys);
        const merged = Object.fromEntries(Object.keys(exported.data).map(key => [key, JSON.parse(mergedRaw[key])]));
        const mergedUi = await page.evaluate(() => ({
            profileActive: document.getElementById('profile').classList.contains('active-tab'),
            watchlistText: document.getElementById('watchlist-grid').textContent,
            providerCount: document.getElementById('my-platforms-count-badge').textContent,
            trackerText: document.getElementById('tv-tracker-grid').textContent,
            savedListTitles: [...document.querySelectorAll('#saved-lists-grid .saved-list-title-btn')]
                .map(button => button.textContent)
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
            mergedUi.watchlistText.includes('Imported Movie'),
            'Profile UI should refresh after a successful merge import'
        );

        const progress = merged.tvEpisodeProgress['tv:71'];
        assert(merged.userSubscribedProviders.join(',') === '8,119,337', 'Merge should union provider IDs in order');
        assert(progress.watched.join(',') === 'S1E1,S1E2', 'Merge should union and sort watched episodes');
        assert(progress.lastSeason === 1 && progress.lastEpisode === 2, 'Merge should recompute TV position');
        assert(
            progress.episodeRuntimes.S1E1 === 40 && progress.episodeRuntimes.S1E2 === 50 && progress.updatedAt === 300,
            'Merge should retain current runtimes for overlaps and take the latest timestamp'
        );
        assert(
            progress.name === currentProgress.name && progress.poster_path === currentProgress.poster_path &&
                progress.totalSeasons === 2 && progress.totalEpisodes === 20 && progress.avgEpisodeRuntime === 45,
            'Merge should retain richer current TV metadata'
        );
        assert(merged.tvEpisodeProgress['tv:72'].watched[0] === 'S2E1', 'Merge should add new tracked shows');
        assert(
            merged.savedSharedLists.map(list => list.id).join(',') === 'imported,current' &&
                merged.savedSharedLists[1].title === 'Current List' && merged.savedSharedLists[1].updatedAt === 200,
            'Merge should keep current lists on ID or route conflicts, then sort by newest'
        );
        assert(
            merged.savedSharedLists[0].route.startsWith('secki/') && merged.savedSharedLists[0].shortId === 'Import12',
            'Merge should canonicalize legacy routes and preserve valid short IDs'
        );
        assert(!mergedUi.profileActive, 'Refresh checks should run outside the active profile');
        assert(mergedUi.providerCount === '3', 'Merge should refresh the platform subscription badge');
        assert(
            mergedUi.trackerText.includes('Imported TV') && mergedUi.trackerText.includes('Current TV'),
            'Merge should refresh the TV tracker grid'
        );
        assert(mergedUi.savedListTitles.join(',') === 'Imported List,Current List', 'Merge should refresh saved lists');
        assert(mergedRaw.theme === 'light' && mergedRaw.imdb_tt1234567 === '8.9', 'Merge should preserve theme and IMDb cache');

        await page.evaluate(() => navigate('profile'));
        await page.waitForSelector('#profile.active-tab');
        const replacePath = path.join(tempDir, 'replace.json');
        fs.writeFileSync(replacePath, JSON.stringify(createBackup({
            watchlist: [{ id: 99, title: 'Replacement Movie', media_type: 'movie' }],
            ratedMovies: [],
            movieRatings: {},
            favoriteActors: [],
            recentlyViewed: [],
            userSubscribedProviders: [11],
            tvEpisodeProgress: {},
            savedSharedLists: [conflictingList],
            theme: 'dark',
            imdb_tt1234567: '1.0'
        })));

        const beforeCancelledReplace = await readStoredValues(page, storageKeys);
        await page.select('#profile-import-mode', 'replace');
        page.once('dialog', async dialog => {
            await dialog.dismiss();
        });
        await importBackupFile(page, replacePath, '', 'İçe aktarma iptal edildi.');
        assert(
            JSON.stringify(await readStoredValues(page, storageKeys)) === JSON.stringify(beforeCancelledReplace),
            'Cancelled replace import must leave data unchanged'
        );

        page.once('dialog', async dialog => {
            await dialog.accept();
        });
        await importBackupFile(page, replacePath, 'success');

        const replaced = await readStoredValues(page, storageKeys);
        const replacedWatchlist = JSON.parse(replaced.watchlist);
        assert(replacedWatchlist.length === 1 && replacedWatchlist[0].id === 99, 'Replace should replace the watchlist');
        assert(replaced.ratedMovies === '[]', 'Replace should clear rated movies');
        assert(replaced.movieRatings === '{}', 'Replace should clear ratings');
        assert(replaced.favoriteActors === '[]', 'Replace should clear favorite actors');
        assert(replaced.recentlyViewed === '[]', 'Replace should clear recent items');
        assert(replaced.userSubscribedProviders === '[11]', 'Replace should replace provider subscriptions');
        assert(replaced.tvEpisodeProgress === '{}', 'Replace should write an explicitly empty v2 TV progress object');
        const replacedLists = JSON.parse(replaced.savedSharedLists);
        assert(replacedLists.length === 1 && replacedLists[0].title === 'Conflicting List', 'Replace should replace saved lists');
        assert(replaced.theme === 'light', 'Replace must preserve the theme preference');
        assert(replaced.imdb_tt1234567 === '8.9', 'Replace must preserve unrelated IMDb cache entries');

        // Keep an uncached TV runtime so the profile refresh exercises the watch-time fetch.
        await page.evaluate(data => {
            Object.entries(data).forEach(([key, value]) => {
                localStorage.setItem(key, JSON.stringify(value, null, 2));
            });
        }, {
            ...v2Baseline,
            tvEpisodeProgress: { 'tv:71': { ...currentProgress, avgEpisodeRuntime: null, episodeRuntimes: {} } }
        });
        const v2Keys = Object.keys(v2Baseline);
        const beforeLegacy = await readStoredValues(page, v2Keys);
        const legacyPath = path.join(tempDir, 'legacy-v1.json');
        fs.writeFileSync(legacyPath, JSON.stringify(createBackup(v1Baseline, 1)));
        await page.select('#profile-import-mode', 'merge');
        await importBackupFile(page, legacyPath, 'success');
        await page.waitForFunction(() => document.getElementById('profile-watch-time')?.textContent === '2s 45d');
        const legacyMerged = await readStoredValues(page, storageKeys);
        assert(
            JSON.parse(legacyMerged.watchlist).map(item => item.id).join(',') === '99,1' &&
                JSON.parse(legacyMerged.movieRatings)['2'] === 8,
            'A v1 merge should merge the legacy profile data'
        );
        assert(
            JSON.stringify(await readStoredValues(page, v2Keys)) === JSON.stringify(beforeLegacy),
            'A v1 merge must preserve all v2 storage values exactly'
        );

        await page.select('#profile-import-mode', 'replace');
        page.once('dialog', async dialog => {
            await dialog.accept();
        });
        await importBackupFile(page, legacyPath, 'success');
        await page.waitForFunction(() => document.getElementById('profile-watch-time')?.textContent === '2s 45d');
        const legacyReplaced = await readStoredValues(page, storageKeys);
        assert(JSON.parse(legacyReplaced.watchlist).map(item => item.id).join(',') === '1', 'A v1 replace should replace legacy data');
        assert(
            JSON.stringify(await readStoredValues(page, v2Keys)) === JSON.stringify(beforeLegacy),
            'A v1 replace must preserve all v2 storage values exactly'
        );

        // Composite rating keys ("movie:550" and "tv:550") must survive export -> strict import round trip
        fs.readdirSync(downloadDir).forEach(name => {
            fs.unlinkSync(path.join(downloadDir, name));
        });
        await page.evaluate(() => {
            localStorage.setItem('watchlist', JSON.stringify([]));
            localStorage.setItem('ratedMovies', JSON.stringify([]));
            localStorage.setItem(
                'movieRatings',
                JSON.stringify({ 'movie:550': 8, 'tv:550': 6 })
            );
            localStorage.setItem('favoriteActors', JSON.stringify([]));
            localStorage.setItem('recentlyViewed', JSON.stringify([]));
        });

        await page.click('#profile-export-btn');
        const compositeDownloadedPath = await waitForDownloadedJson(downloadDir);
        const compositeExported = JSON.parse(
            fs.readFileSync(compositeDownloadedPath, 'utf8')
        );
        assert(
            compositeExported.data.movieRatings['movie:550'] === 8 &&
                compositeExported.data.movieRatings['tv:550'] === 6,
            'Composite rating keys should survive export with both entries distinct'
        );

        const strictValidated = await page.evaluate(payload => {
            return window.validateProfileBackupPayload(payload);
        }, compositeExported);
        assert(
            strictValidated.movieRatings['movie:550'] === 8 &&
                strictValidated.movieRatings['tv:550'] === 6,
            'Strict validation of composite rating keys should not throw and should preserve both entries'
        );

        const compositeRoundTripPath = path.join(tempDir, 'composite-ratings.json');
        fs.writeFileSync(compositeRoundTripPath, JSON.stringify(compositeExported));
        await page.evaluate(() => localStorage.setItem('movieRatings', JSON.stringify({})));
        await page.select('#profile-import-mode', 'replace');
        page.once('dialog', async dialog => {
            await dialog.accept();
        });
        await importBackupFile(page, compositeRoundTripPath, 'success');

        const importedCompositeRatings = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('movieRatings'))
        );
        assert(
            importedCompositeRatings['movie:550'] === 8 &&
                importedCompositeRatings['tv:550'] === 6,
            'Composite rating keys should survive export -> import round trip with both entries distinct'
        );

        const edgeChecks = await page.evaluate(() => {
            const legacySafe = window.normalizeBackupRatings(
                { 'movie:550': 8, 550: 3 },
                true
            );
            const mergedList = window.mergeBackupList(
                [{ id: 5 }],
                [{ id: 5, title: 'Movie 5', media_type: 'movie' }]
            );
            return { legacySafe, mergedList };
        });
        assert(
            edgeChecks.legacySafe['movie:550'] === 8 &&
                edgeChecks.legacySafe['550'] === undefined,
            'Legacy bare numeric key must not overwrite or coexist with composite key'
        );
        assert(
            edgeChecks.mergedList.length === 1,
            'mergeBackupList should deduplicate bare id item against composite movie:id item'
        );

        const mergedRatings = await page.evaluate(() => {
            const emptyData = {
                watchlist: [], ratedMovies: [], favoriteActors: [], recentlyViewed: []
            };
            return window.mergeProfileBackupData(
                { ...emptyData, movieRatings: { '123': 5 } },
                { ...emptyData, movieRatings: { 'movie:123': 9 } }
            ).movieRatings;
        });
        assert(
            mergedRatings['123'] === 5 &&
                mergedRatings['movie:123'] === undefined &&
                !Object.values(mergedRatings).includes(9),
            'Current legacy rating must win over an imported typed rating for the same id'
        );

        const distinctTypeRatings = await page.evaluate(() => {
            const emptyData = {
                watchlist: [], ratedMovies: [], favoriteActors: [], recentlyViewed: []
            };
            return window.mergeProfileBackupData(
                { ...emptyData, movieRatings: { 'movie:123': 5 } },
                { ...emptyData, movieRatings: { 'tv:123': 7 } }
            ).movieRatings;
        });
        assert(
            distinctTypeRatings['movie:123'] === 5 &&
                distinctTypeRatings['tv:123'] === 7,
            'Current movie rating must preserve an imported TV rating with the same id'
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
