const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ROOT_DIR = path.resolve(__dirname, '..');
const CSP_HEADER = 'Content-Security-Policy';
const NEGATIVE_URL = 'https://evil.example/test';
const VIDEO_ORIGIN = 'https://www.youtube-nocookie.com';
const TRAILER_KEY = 'dQw4w9WgXcQ';
const CSP_CONSOLE_MESSAGE = /Content Security Policy|Refused to/i;
const HTML_TYPE = 'text/html; charset=utf-8';
const MIME_TYPES = {
    '.html': HTML_TYPE,
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};
const PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
);
const EMBED_HTML = '<!doctype html><title>Mock YouTube</title><p id="mock-player">Mock player</p>';
const MOVIE = {
    id: 550,
    title: 'Fight Club',
    original_title: 'Fight Club',
    media_type: 'movie',
    poster_path: '/fight-club.jpg',
    backdrop_path: '/fight-club-backdrop.jpg',
    overview: 'CSP regression test movie',
    release_date: '1999-10-15',
    vote_average: 8.4,
    vote_count: 1000,
    genre_ids: [18]
};
const ACTOR = {
    id: 819,
    name: 'Edward Norton',
    profile_path: '/edward-norton.jpg',
    known_for_department: 'Acting',
    biography: 'CSP regression test actor',
    character: 'Narrator'
};
const VIDEOS = { results: [{ key: TRAILER_KEY, site: 'YouTube', type: 'Trailer' }] };
const PROVIDER = { provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.png' };
const UPCOMING_MOVIE = {
    ...MOVIE,
    title: 'Upcoming Film',
    release_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
};

function readNetlifyHeaders() {
    const toml = fs.readFileSync(path.join(ROOT_DIR, 'netlify.toml'), 'utf8');
    // Read only the section and value shapes used by this Netlify config.
    const sections = toml.split(/^[ \t]*(?=\[)/m);
    const build = sections.find(section => /^\[build\]/.test(section));
    const omdb = sections.find(section => /^\[functions\."omdb"\]/.test(section));
    const tmdb = sections.find(section => /^\[functions\."tmdb"\]/.test(section));
    const headerIndex = sections.findIndex(section => /^\[\[headers\]\]/.test(section));
    assert.ok(headerIndex > 0 && build && omdb && tmdb, 'Expected build, OMDb, TMDB and headers tables');
    assert.ok([build, omdb, tmdb].every(section => sections.indexOf(section) < headerIndex),
        'Build, OMDb and TMDB tables must precede the header rules');
    const readValue = (section, key) => {
        const match = section.match(new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*([^\\r\\n]+)`, 'm'));
        assert.ok(match, `Missing Netlify setting ${key}`);
        return JSON.parse(match[1]);
    };

    assert.equal(readValue(build, 'publish'), '.');
    assert.equal(readValue(build, 'functions'), 'netlify/functions');
    assert.equal(readValue(build, 'command'), 'node scripts/update-imdb-ratings.js --allow-stale');
    for (const [name, section] of [['OMDb', omdb], ['TMDB', tmdb]]) {
        const includedFiles = readValue(section, 'included_files');
        assert.ok(Array.isArray(includedFiles) && includedFiles.includes('data/imdb-ratings.bin.gz'),
            name + ' must bundle the IMDb ratings index');
    }
    assert.equal(readValue(sections[headerIndex], 'for'), '/*');
    const values = sections[headerIndex + 1];
    assert.match(values, /^\[headers\.values\]/);
    assert.doesNotMatch(toml, /Content-Security-Policy-Report-Only/i);

    const policies = [...values.matchAll(/^[ \t]*Content-Security-Policy[ \t]*=[ \t]*"""([\s\S]*?)"""/gm)];
    assert.equal(policies.length, 1, 'Expected one enforced multiline CSP');
    // TOML removes the continuation and all whitespace through the next non-whitespace character.
    const policy = policies[0][1].replace(/\\[ \t]*\r?\n[ \t\r\n]*/g, '').replace(/^\r?\n/, '');
    assert.ok(policy && policy === policy.trim(), 'CSP header must be nonempty and trimmed');
    assert.doesNotMatch(policy, /[\r\n\\]/, 'CSP must parse to one HTTP header line');
    const directives = new Map();
    for (const directive of policy.split(';').map(value => value.trim()).filter(Boolean)) {
        const [name, ...sources] = directive.split(/\s+/);
        assert.ok(!directives.has(name), `Duplicate CSP directive ${name}`);
        directives.set(name, sources);
    }
    assert.deepEqual(new Set(directives.get('connect-src')), new Set(["'self'", 'https://image.tmdb.org', VIDEO_ORIGIN]),
        'connect-src must allow only the site origin, TMDB images and YouTube no-cookie');
    assert.deepEqual(directives.get('form-action'), ["'self'"]);

    return {
        [CSP_HEADER]: policy,
        'X-Content-Type-Options': readValue(values, 'X-Content-Type-Options'),
        'Referrer-Policy': readValue(values, 'Referrer-Policy'),
        'X-Frame-Options': readValue(values, 'X-Frame-Options'),
        'Permissions-Policy': readValue(values, 'Permissions-Policy')
    };
}

function mockTmdb(url) {
    const upstream = new URL(url.searchParams.get('path') || '/', 'https://api.themoviedb.org');
    const routes = {
        '/3/movie/550': {
            ...MOVIE,
            imdb_id: 'tt0137523',
            imdb_rating: '8.8',
            imdb_rating_source: 'imdb-dataset',
            runtime: 139,
            genres: [{ id: 18, name: 'Dram' }],
            belongs_to_collection: { id: 10 },
            videos: VIDEOS,
            credits: { cast: [ACTOR], crew: [] },
            recommendations: { results: [{ ...MOVIE, id: 551, title: 'Related Film' }] },
            external_ids: { imdb_id: 'tt0137523' }
        },
        '/3/movie/550/videos': VIDEOS,
        '/3/person/819': ACTOR,
        '/3/person/819/combined_credits': { cast: [MOVIE], crew: [] },
        '/3/person/popular': { results: [ACTOR], total_pages: 1 },
        '/3/collection/10': { id: 10, name: 'CSP Collection', parts: [MOVIE] },
        '/3/watch/providers/movie': { results: [PROVIDER] },
        '/3/watch/providers/tv': { results: [PROVIDER] }
    };
    if (url.searchParams.get('probe') === '1') return { ok: true, service: 'tmdb-proxy' };
    if (/^\/3\/genre\/(movie|tv)\/list$/.test(upstream.pathname)) {
        return { genres: [{ id: 18, name: 'Dram' }] };
    }
    if (upstream.pathname.endsWith('/watch/providers')) {
        return { results: { TR: { flatrate: [PROVIDER] } } };
    }
    const isUpcoming = upstream.pathname === '/3/discover/movie' && upstream.searchParams.has('release_date.gte');
    return routes[upstream.pathname] || { page: 1, total_pages: 1, results: [isUpcoming ? UPCOMING_MOVIE : MOVIE] };
}

function createServer(headers, omdbRequests) {
    return http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/__csp-negative.html') {
            res.writeHead(200, { ...headers, 'Content-Type': HTML_TYPE });
            return res.end('<!doctype html><title>CSP enforcement check</title>');
        }
        if (url.pathname === '/.netlify/functions/tmdb' || url.pathname === '/.netlify/functions/omdb') {
            const tmdbRequest = url.pathname.endsWith('/tmdb');
            if (!tmdbRequest) omdbRequests.push(url.pathname + url.search);
            if (tmdbRequest && url.searchParams.get('target') === 'image') {
                res.writeHead(200, { 'Content-Type': 'image/png' });
                return res.end(PIXEL);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(tmdbRequest ? mockTmdb(url) : { imdbRating: '8.8' }));
        }
        if (url.pathname === '/favicon.ico') {
            res.writeHead(204);
            return res.end();
        }

        const requestedPath = decodeURIComponent(url.pathname);
        const isSpaRoute = requestedPath === '/' || !path.extname(requestedPath);
        const file = path.resolve(ROOT_DIR, isSpaRoute ? 'index.html' : `.${requestedPath}`);
        const extension = path.extname(file).toLowerCase();
        if (!file.startsWith(ROOT_DIR + path.sep) || !MIME_TYPES[extension]) {
            res.writeHead(404);
            return res.end();
        }
        fs.readFile(file, (error, data) => {
            if (error) {
                res.writeHead(404);
                return res.end();
            }
            res.writeHead(200, {
                ...(extension === '.html' ? headers : {}),
                'Content-Type': MIME_TYPES[extension]
            });
            res.end(data);
        });
    });
}

async function setupPage(page, origin) {
    const cspConsoleErrors = [];
    const pageErrors = [];
    const interceptionErrors = [];
    const externalRequests = [];

    await page.setViewport({ width: 1280, height: 900 });
    page.setDefaultTimeout(15000);
    await page.setBypassServiceWorker(true);
    await page.evaluateOnNewDocument(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', event => {
            window.__cspViolations.push({
                violatedDirective: event.violatedDirective,
                effectiveDirective: event.effectiveDirective,
                blockedURI: event.blockedURI,
                sourceFile: event.sourceFile,
                lineNumber: event.lineNumber,
                disposition: event.disposition
            });
        });
    });
    page.on('console', message => {
        if (CSP_CONSOLE_MESSAGE.test(message.text())) cspConsoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.stack || error.message));

    await page.setRequestInterception(true);
    page.on('request', async request => {
        const url = new URL(request.url());
        try {
            if (url.origin === origin) return await request.continue();
            externalRequests.push(url.href);
            const headers = { 'Access-Control-Allow-Origin': '*' };
            if (url.origin === 'https://cdnjs.cloudflare.com') {
                // Keep the page's SRI attributes intact. These stubs exercise CSP's URL checks.
                const css = url.pathname.endsWith('.css');
                return await request.respond({
                    status: 200, headers,
                    contentType: css ? 'text/css' : 'text/javascript',
                    body: css ? '/* offline stylesheet */' : '/* offline script */'
                });
            }
            if (url.origin === 'https://image.tmdb.org' || url.origin === 'https://upload.wikimedia.org' ||
                (url.origin === VIDEO_ORIGIN && url.pathname === '/favicon.ico')) {
                return await request.respond({ status: 200, headers, contentType: 'image/png', body: PIXEL });
            }
            if (url.origin === VIDEO_ORIGIN || url.origin === 'https://www.youtube.com') {
                return await request.respond({ status: 200, headers, contentType: HTML_TYPE, body: EMBED_HTML });
            }
            if (url.href === NEGATIVE_URL) {
                return await request.respond({ status: 200, headers, contentType: 'text/plain', body: 'CSP probe' });
            }
            await request.abort();
        } catch (error) {
            interceptionErrors.push(`${url.href}: ${error.message}`);
        }
    });
    return { cspConsoleErrors, pageErrors, interceptionErrors, externalRequests };
}

function assertResponseHeaders(response, headers) {
    assert.ok(response?.ok(), 'HTML response must be successful');
    const actual = response.headers();
    for (const [name, value] of Object.entries(headers)) assert.equal(actual[name.toLowerCase()], value, name);
    assert.equal(actual['content-security-policy-report-only'], undefined);
}

async function visit(page, hash, selector) {
    await page.evaluate(route => { location.hash = route; }, hash);
    await page.waitForSelector(selector, { visible: true });
}

async function closeModal(page, id) {
    await page.locator(`#${id}.active .close-btn`).click();
    await page.waitForSelector(`#${id}.active`, { hidden: true });
}

async function runAppFlows(page, origin, headers) {
    assertResponseHeaders(await page.goto(`${origin}/#home`, { waitUntil: 'load' }), headers);
    await page.waitForSelector('#now-playing-grid .movie-card[data-media-id="550"]', { visible: true });
    await visit(page, 'upcoming', '#vizyon.active-tab #upcoming-movies .movie-card:not(.skeleton-card)');
    await visit(page, 'platform', '#platform.active-tab');
    await visit(page, 'games', '#games.active-tab');
    await visit(page, 'imax', '#imax.active-tab');
    const map = await page.waitForSelector('#imax-map-container svg.turkey-svg', { visible: true });
    assert.equal(await map.$$eval('.imax-pin', pins => pins.length), 11, 'IMAX map must contain 11 theater pins');
    assert.ok(await map.evaluate(svg => svg.textContent.includes('Panora')), 'IMAX map must contain the Panora label');
    assert.ok(await map.$('path'), 'IMAX map must contain province paths');

    await visit(page, 'movie/550/movie', '#details-modal.active');
    await page.waitForFunction(() => {
        const rating = document.querySelector('#details-modal #rating-span');
        return document.querySelector('#details-title')?.textContent.includes('Fight Club') &&
            rating?.querySelector('.imdb-badge')?.textContent === 'IMDb' &&
            rating.textContent.trim() === 'IMDb 8.8';
    });
    await page.waitForSelector('#details-modal #rating-span .imdb-badge', { visible: true });
    await page.waitForSelector('#details-modal #collection-container', { visible: true });
    await page.locator('#details-modal button[onclick^="openTrailer("]').click();
    const iframe = await page.waitForSelector('#trailer-modal.active iframe', { visible: true });
    const player = await iframe.contentFrame();
    await player.waitForSelector('#mock-player');
    assert.equal(new URL(player.url()).origin, VIDEO_ORIGIN);
    assert.equal(new URL(player.url()).pathname, `/embed/${TRAILER_KEY}`);
    await closeModal(page, 'trailer-modal');
    await closeModal(page, 'details-modal');

    await visit(page, 'actor/819', '#platform.active-tab #actor-bio-card-container h3');
    assert.equal(await page.$eval('#actor-bio-card-container h3', element => element.textContent.trim()), ACTOR.name);
    await page.waitForSelector('#search-results .movie-card[data-media-id="550"]', { visible: true });
    await visit(page, 'profile', '#profile.active-tab #open-share-builder-btn');
    await page.locator('#open-share-builder-btn').click();
    await page.waitForSelector('#share-list-modal.active', { visible: true });
    await closeModal(page, 'share-list-modal');
    await page.waitForNetworkIdle();
}

async function negativeEnforcementCheck(browser, origin, headers) {
    const page = await browser.newPage();
    try {
        const { cspConsoleErrors, pageErrors, interceptionErrors, externalRequests } = await setupPage(page, origin);
        assertResponseHeaders(await page.goto(`${origin}/__csp-negative.html`), headers);
        const outcome = await page.evaluate(async url => {
            try {
                await fetch(url, { mode: 'no-cors' });
                return 'resolved';
            } catch (error) {
                return error.name;
            }
        }, NEGATIVE_URL);
        assert.equal(outcome, 'TypeError', 'The prohibited fetch must reject');
        await page.waitForFunction(() => window.__cspViolations.length > 0);
        await page.waitForNetworkIdle();

        const violations = await page.evaluate(() => window.__cspViolations);
        assert.deepEqual(violations.map(({ blockedURI, effectiveDirective, disposition }) => ({
            origin: new URL(blockedURI).origin, effectiveDirective, disposition
        })), [{ origin: new URL(NEGATIVE_URL).origin, effectiveDirective: 'connect-src', disposition: 'enforce' }]);
        assert.ok(cspConsoleErrors.length > 0 && cspConsoleErrors.every(message => message.includes('evil.example')),
            `Unexpected CSP console output: ${JSON.stringify(cspConsoleErrors)}`);
        assert.deepEqual(externalRequests, [], 'CSP must block the probe before request interception');
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(interceptionErrors, []);
        console.log('PASS negative enforcement check: CSP blocked evil.example (connect-src).');
    } finally {
        await page.close();
    }
}

async function run() {
    const headers = readNetlifyHeaders();
    const omdbRequests = [];
    const server = createServer(headers, omdbRequests);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    let browser;
    try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'win32'
            ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
            : undefined);
        browser = await puppeteer.launch({
            executablePath,
            headless: true,
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--no-proxy-server',
                '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
            ]
        });
        const page = await browser.newPage();
        const { cspConsoleErrors, pageErrors, interceptionErrors, externalRequests } = await setupPage(page, origin);
        let flowError;
        try {
            await runAppFlows(page, origin, headers);
            assert.ok(externalRequests.includes(`${VIDEO_ORIGIN}/favicon.ico`), 'Missing YouTube favicon fetch');
        } catch (error) {
            flowError = error;
        }
        const violations = await page.evaluate(() => window.__cspViolations ?? []);
        const diagnostics = { violations, cspConsoleErrors, pageErrors, interceptionErrors };
        if (Object.values(diagnostics).some(entries => entries.length > 0)) {
            const flowStatus = flowError ? `App flow failed: ${flowError.message}` : 'App flows completed.';
            throw new Error(`${flowStatus}\nBrowser diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`,
                flowError ? { cause: flowError } : undefined);
        }
        if (flowError) throw flowError;
        console.log('PASS app flows: zero CSP violations, CSP console errors or page errors.');
        await negativeEnforcementCheck(browser, origin, headers);
        assert.equal(omdbRequests.length, 0, 'IMDb 8.8 from TMDB must render without an OMDb request');
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    }
}

run().catch(error => {
    console.error('CSP REGRESSION TEST FAILED:', error);
    process.exitCode = 1;
});
