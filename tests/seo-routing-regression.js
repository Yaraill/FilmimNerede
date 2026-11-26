const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { toTmdbApiUrl } = require('./helpers/tmdb-proxy-shim');

const ROOT_DIR = path.resolve(__dirname, '..');
const IMAX_THEATER_NAMES = [
    'Paribu Cineverse İstinyePark',
    'Paribu Cineverse Akasya Acıbadem',
    'Paribu Cineverse Marmara Park',
    'World Cinezone Marmara Forum',
    'Paribu Cineverse Hilltown',
    'Paribu Cineverse ANKAmall',
    'World Cinezone Gordion',
    'Paribu Cineverse Panora',
    'Paribu Cineverse MaviBahçe',
    'Paribu Cineverse Sur Yapı Marka',
    'Paribu Cineverse M1 Adana'
];
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
};

function createTestServer() {
    return http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const requested = decodeURIComponent(url.pathname);
        let relativeFile = `.${requested}`;
        if (requested === '/imax' || requested === '/imax/') {
            relativeFile = './imax.html';
        } else if (requested === '/' || !path.extname(requested)) {
            relativeFile = './index.html';
        }
        const filePath = path.resolve(ROOT_DIR, relativeFile);
        if (!filePath.startsWith(ROOT_DIR + path.sep)) {
            res.writeHead(403).end('Forbidden');
            return;
        }
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404).end('Not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
            res.end(data);
        });
    });
}

async function run() {
    // 1. Static checks for robots.txt, _redirects and sitemap.xml
    const robotsTxt = fs.readFileSync(path.join(ROOT_DIR, 'robots.txt'), 'utf8');
    const robotGroups = robotsTxt.split(/(?=^User-agent:)/m).filter(block => /^User-agent:/m.test(block));
    assert.equal(robotGroups.length, 6, 'robots.txt must define 6 crawler groups');
    for (const group of robotGroups) {
        assert.match(group, /^Disallow:\s*\/\.netlify\/$/m, `robots.txt group must disallow /.netlify/: ${group.split(/\r?\n/)[0]}`);
    }

    const redirects = fs.readFileSync(path.join(ROOT_DIR, '_redirects'), 'utf8').trim();
    const imaxRedirectIndex = redirects.search(/^\/imax\s+\/imax\.html\s+200$/m);
    const imaxSlashRedirectIndex = redirects.search(/^\/imax\/\s+\/imax\.html\s+200$/m);
    const spaFallbackIndex = redirects.search(/^\/\*\s+\/index\.html\s+200$/m);
    assert(imaxRedirectIndex >= 0, '_redirects must contain /imax  /imax.html  200');
    assert(imaxSlashRedirectIndex >= 0, '_redirects must contain /imax/  /imax.html  200');
    assert(spaFallbackIndex >= 0, '_redirects must provide SPA 200 fallback');
    assert(imaxRedirectIndex < spaFallbackIndex && imaxSlashRedirectIndex < spaFallbackIndex, 'IMAX rewrites must appear before SPA fallback');
    assert.match(redirects, /^\/\*\s+\/index\.html\s+200$/m, '_redirects must provide SPA 200 fallback');

    const sitemap = fs.readFileSync(path.join(ROOT_DIR, 'sitemap.xml'), 'utf8');
    for (const loc of ['/', '/vizyon', '/nerede-izlerim', '/imax', '/oyunlar']) {
        assert(sitemap.includes(`<loc>https://filmimnerede.netlify.app${loc}</loc>`), `sitemap.xml missing ${loc}`);
    }
    assert(!sitemap.includes('/profilim'), 'sitemap.xml must not list noindex /profilim');

    const llmsPath = path.join(ROOT_DIR, 'llms.txt');
    assert(fs.existsSync(llmsPath), 'llms.txt must exist');
    const llms = fs.readFileSync(llmsPath, 'utf8');
    for (const route of ['/', '/vizyon', '/nerede-izlerim', '/imax', '/oyunlar']) {
        assert(llms.includes(route), `llms.txt missing ${route}`);
    }

    const imaxPath = path.join(ROOT_DIR, 'imax.html');
    assert(fs.existsSync(imaxPath), 'imax.html must exist');
    const imaxHtml = fs.readFileSync(imaxPath, 'utf8');
    assert(!/<script(?![^>]*type=["']application\/ld\+json["'])[^>]*>/i.test(imaxHtml), 'imax.html must not contain executable inline scripts');
    assert(!/\son[a-z]+\s*=/i.test(imaxHtml), 'imax.html must not contain inline event handlers');
    assert.match(imaxHtml, /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/filmimnerede\.netlify\.app\/imax["']/i);
    assert.match(imaxHtml, /<meta[^>]+name=["']robots["'][^>]+content=["']index,\s*follow[^"']*["']/i);
    assert.match(imaxHtml, /<h1[^>]*>Türkiye IMAX Salonları Rehberi<\/h1>/i);
    assert.match(imaxHtml, /<h2[^>]*>Türkiye'de Kaç Tane IMAX Salonu Var\?<\/h2>/i);
    assert.match(imaxHtml, /<h2[^>]*>IMAX Lazer ile Dijital IMAX Arasındaki Fark Nedir\?<\/h2>/i);
    const imaxTableMatch = imaxHtml.match(/<table class=["']imax-summary-table["'][^>]*>([\s\S]*?)<\/table>/i);
    assert(imaxTableMatch, 'imax.html must contain imax-summary-table');
    const imaxRows = (imaxTableMatch[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1].match(/<tr/g) || []).length;
    assert.equal(imaxRows, 11, 'imax.html table must contain 11 rows');

    const jsonLdScripts = [...imaxHtml.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    assert(jsonLdScripts.length > 0, 'imax.html must contain JSON-LD');
    const jsonLd = jsonLdScripts.map(match => JSON.parse(match[1])).flat();
    const jsonLdObjects = jsonLd.flatMap(value => value['@graph'] ? value['@graph'] : [value]);
    const itemListJsonLd = jsonLdObjects.find(value => value['@type'] === 'ItemList');
    assert(itemListJsonLd, 'imax.html must contain ItemList JSON-LD');
    assert.equal(itemListJsonLd.numberOfItems, 11);
    assert.equal((itemListJsonLd.itemListElement || []).filter(item => item.item?.['@type'] === 'MovieTheater').length, 11);
    assert(jsonLdObjects.some(value => value['@type'] === 'BreadcrumbList'), 'imax.html must contain BreadcrumbList JSON-LD');

    const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const localScriptTags = [...indexHtml.matchAll(/<script[^>]+src=["'](\/(?:js\/runtime\/[^"']+|app\.js(?:\?[^"']*)?))["'][^>]*>/gi)];
    assert.equal(localScriptTags.length, 15, 'index.html must contain exactly 15 local app script tags');
    for (const [tagIndex, scriptMatch] of localScriptTags.entries()) {
        assert(/(?:^|\s)defer(?:\s|=|>|$)/i.test(scriptMatch[0]), `Local app script ${tagIndex + 1} must have the defer attribute`);
    }
    assert(localScriptTags[0][1].startsWith('/js/runtime/config.js'), 'First local app script must be config.js');
    assert(localScriptTags[14][1].startsWith('/app.js'), 'Last local app script must be app.js');

    const headersPath = path.join(ROOT_DIR, '_headers');
    assert(fs.existsSync(headersPath), '_headers must exist');
    const headers = fs.readFileSync(headersPath, 'utf8');
    assert.match(headers, /\/service-worker\.js[\s\S]*?Cache-Control:\s*no-cache,\s*must-revalidate/i,
        '_headers must disable caching for /service-worker.js');
    assert.match(headers, /\/index\.html[\s\S]*?Cache-Control:\s*public,\s*max-age=0,\s*must-revalidate/i,
        '_headers must keep /index.html revalidation enabled');
    assert.match(headers, /\/imax\.html[\s\S]*?Cache-Control:\s*public,\s*max-age=0,\s*must-revalidate/i,
        '_headers must keep /imax.html revalidation enabled');
    for (const route of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/style.css', '/app.js', '/js/runtime/*', '/assets/*', '/turkey-inline.svg']) {
        assert.match(headers, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?Cache-Control:', 'i'),
            `_headers must contain Cache-Control rules for ${route}`);
    }
    assert(!/Content-Security-Policy/i.test(headers), '_headers must not contain Content-Security-Policy');

    const indexImaxMatch = indexHtml.match(/<section id=["']imax["'][\s\S]*?<table class=["']imax-summary-table["'][^>]*>([\s\S]*?)<\/table>/i);
    assert(indexImaxMatch, 'index.html IMAX section must contain a summary table');
    const indexCardNames = [...indexHtml.matchAll(/<div class=["']imax-theater-name["']>([^<]+)<\/div>/gi)].map(match => match[1].trim());
    assert.equal(indexCardNames.length, 11, 'index.html must contain 11 IMAX theater cards');
    const extractTheaterColumnNames = tableHtml => [...tableHtml.matchAll(/<tr[^>]*>\s*<td>[^<]*<\/td>\s*<td>([^<]+)<\/td>/gi)]
        .map(match => match[1].trim());
    const staticTableNames = extractTheaterColumnNames(imaxTableMatch[1]);
    const indexTableNames = extractTheaterColumnNames(indexImaxMatch[1]);
    assert.deepEqual(staticTableNames, IMAX_THEATER_NAMES, 'imax.html table names must match the authoritative 11 venues');
    assert.deepEqual(indexTableNames, IMAX_THEATER_NAMES, 'index.html summary table names must match the authoritative 11 venues');
    assert.deepEqual(indexCardNames, IMAX_THEATER_NAMES, 'index.html IMAX cards must match the authoritative 11 venues');

    const server = createTestServer();
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);
        const pageErrors = [];
        const consoleErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        page.on('console', message => {
            if (message.type() === 'error' && !message.text().includes('ERR_FAILED')) {
                consoleErrors.push(message.text());
            }
        });

        page.on('request', req => {
            const url = toTmdbApiUrl(req.url());
            if (url.includes('api.themoviedb.org')) {
                const headers = { 'Access-Control-Allow-Origin': '*' };
                if (url.includes('/movie/550')) {
                    return req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            id: 550,
                            title: 'Dövüş Kulübü',
                            release_date: '1999-10-15',
                            overview: 'İlk kural bundan bahsetmemektir.',
                            poster_path: '/fc.jpg',
                            backdrop_path: '/fcb.jpg',
                            genres: [{ id: 18, name: 'Dram' }],
                            credits: { cast: [], crew: [] },
                            recommendations: { results: [] },
                            videos: { results: [] },
                            external_ids: { imdb_id: 'tt0137523' }
                        })
                    });
                }
                if (url.includes('/tv/1396')) {
                    return req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            id: 1396,
                            name: 'Breaking Bad',
                            first_air_date: '2008-01-20',
                            overview: 'Kimya öğretmeninin hikayesi.',
                            poster_path: '/bb.jpg',
                            backdrop_path: '/bbb.jpg',
                            genres: [{ id: 18, name: 'Dram' }],
                            credits: { cast: [], crew: [] },
                            recommendations: { results: [] },
                            videos: { results: [] },
                            external_ids: { imdb_id: 'tt0903747' }
                        })
                    });
                }
                if (url.includes('/person/819/combined_credits')) {
                    return req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({ cast: [], crew: [] })
                    });
                }
                if (url.includes('/person/819')) {
                    return req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({ id: 819, name: 'Edward Norton', profile_path: '/en.jpg' })
                    });
                }
                if (url.includes('/genre/')) {
                    return req.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ genres: [{ id: 18, name: 'Dram' }] }) });
                }
                return req.respond({
                    status: 200,
                    headers,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        page: 1,
                        total_pages: 1,
                        results: [{ id: 550, title: 'Dövüş Kulübü', media_type: 'movie', release_date: '1999-10-15', poster_path: '/fc.jpg', genre_ids: [18] }]
                    })
                });
            }
            if (req.url().startsWith(origin)) return req.continue();
            return req.abort();
        });

        const readSeo = () => page.evaluate(() => ({
            pathname: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash,
            title: document.title,
            canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
            robots: document.querySelector('meta[name="robots"]')?.getAttribute('content'),
            description: document.querySelector('meta[name="description"]')?.getAttribute('content')
        }));

        // 2. Clean URLs directly loaded (static IMAX page + dynamic SEO)
        await page.goto(`${origin}/imax`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('h1');
        let seo = await readSeo();
        assert.equal(seo.pathname, '/imax');
        assert.match(seo.title, /Türkiye IMAX Salonları Rehberi/);
        assert.equal(seo.canonical, 'https://filmimnerede.netlify.app/imax');
        assert.match(seo.robots, /^index, follow/);
        const imaxBrowser = await page.evaluate(() => ({
            h1: document.querySelector('h1')?.textContent.trim(),
            tableRows: document.querySelectorAll('.imax-summary-table tbody tr').length,
            tableDisplay: getComputedStyle(document.querySelector('.imax-summary-table')).display,
            directAnswer: document.querySelector('.imax-direct-answer')?.textContent || '',
            statusText: document.body?.textContent || ''
        }));
        assert.equal(imaxBrowser.h1, 'Türkiye IMAX Salonları Rehberi');
        assert.equal(imaxBrowser.tableRows, 11);
        assert.notEqual(imaxBrowser.tableDisplay, 'none');
        assert.match(imaxBrowser.directAnswer, /5/i);
        assert.match(imaxBrowser.directAnswer, /11 IMAX/i);
        assert.match(imaxBrowser.directAnswer, /4\s+IMAX Lazer/i);
        assert.match(imaxBrowser.directAnswer, /7\s+Dijital IMAX/i);

        await page.setViewport({ width: 390, height: 844 });
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('h1');
        const imaxMobileLight = await page.evaluate(() => ({
            backgroundColor: getComputedStyle(document.body).backgroundColor,
            documentOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            captionRight: document.querySelector('.imax-summary-table caption')?.getBoundingClientRect().right
        }));
        assert.equal(imaxMobileLight.backgroundColor, 'rgb(241, 245, 249)');
        assert(imaxMobileLight.documentOverflow, 'IMAX page must not overflow horizontally at 390px');
        assert(imaxMobileLight.captionRight <= 390, 'IMAX table caption must stay within the 390px viewport');
        await page.setViewport({ width: 1280, height: 720 });
        await page.emulateMediaFeatures([]);

        // 3. Card titles must be <a href="/film/..."> and Ctrl+Click must not hijack
        await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
        const homeSeo = await page.evaluate(() => ({
            leadDisplay: getComputedStyle(document.querySelector('#now-playing .site-hero-lead')).display,
            faqDisplay: getComputedStyle(document.querySelector('.home-geo-faq')).display,
            faqCount: document.querySelectorAll('.home-faq-item').length,
            detailsCount: document.querySelectorAll('#now-playing .home-geo-faq details').length
        }));
        assert.notEqual(homeSeo.leadDisplay, 'none');
        assert.notEqual(homeSeo.faqDisplay, 'none');
        assert.equal(homeSeo.faqCount, 3);
        assert.equal(homeSeo.detailsCount, 0);
        await page.waitForSelector('#now-playing-grid .movie-card a.movie-title-btn');
        const linkInfo = await page.$eval('#now-playing-grid .movie-card a.movie-title-btn', a => ({
            tag: a.tagName,
            href: a.getAttribute('href'),
            ctrlHandledInSpa: shouldHandleLinkClickInSpa({ button: 0, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false }),
            normalHandledInSpa: shouldHandleLinkClickInSpa({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false })
        }));
        assert.equal(linkInfo.tag, 'A');
        assert.equal(linkInfo.href, '/film/550');
        assert.equal(linkInfo.ctrlHandledInSpa, false);
        assert.equal(linkInfo.normalHandledInSpa, true);

        // 4. Direct /film/550, /dizi/1396, /oyuncu/819, /profilim, /olmayan-sayfa
        await page.goto(`${origin}/film/550`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.title.includes('Dövüş Kulübü (1999)'));
        seo = await readSeo();
        assert.equal(seo.canonical, 'https://filmimnerede.netlify.app/film/550');
        assert.match(seo.robots, /^index, follow/);

        await page.goto(`${origin}/dizi/1396`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.title.includes('Breaking Bad (2008)'));
        seo = await readSeo();
        assert.equal(seo.canonical, 'https://filmimnerede.netlify.app/dizi/1396');

        await page.goto(`${origin}/oyuncu/819`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.title.includes('Edward Norton'));
        seo = await readSeo();
        assert.equal(seo.canonical, 'https://filmimnerede.netlify.app/oyuncu/819');

        await page.goto(`${origin}/profilim`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#profile.active-tab');
        seo = await readSeo();
        assert.equal(seo.canonical, 'https://filmimnerede.netlify.app/profilim');
        assert.equal(seo.robots, 'noindex, follow');

        await page.goto(`${origin}/olmayan-sayfa`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#not-found.active-tab');
        seo = await readSeo();
        assert.match(seo.title, /404/);
        assert.equal(seo.robots, 'noindex, follow');

        // 5. Legacy #hash redirects
        for (const [legacyHash, expectedPath, expectedSearch = ''] of [
            ['#vizyon', '/vizyon'],
            ['#imax', '/imax'],
            ['#platform?provider=8', '/nerede-izlerim', '?provider=8'],
            ['#search?q=matrix', '/nerede-izlerim', '?q=matrix'],
            ['#movie/550/movie', '/film/550'],
            ['#movie/1396/tv', '/dizi/1396'],
            ['#actor/819', '/oyuncu/819'],
            ['#s/AbCd1234', '/s/AbCd1234']
        ]) {
            await page.goto(`${origin}/${legacyHash}`, { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(p => window.location.pathname === p, {}, expectedPath);
            seo = await readSeo();
            assert.equal(seo.pathname, expectedPath, `Redirect failed for ${legacyHash}`);
            assert.equal(seo.search, expectedSearch, `Search mismatch for ${legacyHash}`);
            assert.equal(seo.hash, '', `Hash not cleared for ${legacyHash}`);
            if (legacyHash === '#imax') {
                await page.waitForSelector('#imax.active-tab');
            }
        }

        assert.equal(pageErrors.length, 0, `Browser page errors: ${pageErrors.join(' | ')}`);
        assert.equal(consoleErrors.length, 0, `Browser console errors: ${consoleErrors.join(' | ')}`);

        console.log('[PASS] All Phase 2 & Phase 3 SEO & routing regression tests passed.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(err => {
    console.error('SEO ROUTING REGRESSION FAILED:', err);
    process.exitCode = 1;
});
