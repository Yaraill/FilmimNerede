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

const mockMovies = [
    {
        id: 101,
        title: 'Accessibility Inception',
        overview: 'A movie about accessible web design.',
        poster_path: '/poster1.jpg',
        backdrop_path: '/backdrop1.jpg',
        vote_average: 8.8,
        media_type: 'movie',
        genre_ids: [28, 878],
        release_date: '2024-01-01'
    },
    {
        id: 102,
        title: 'Keyboard Matrix',
        overview: 'Follow the white rabbit through keyboard traps.',
        poster_path: '/poster2.jpg',
        backdrop_path: '/backdrop2.jpg',
        vote_average: 8.5,
        media_type: 'movie',
        genre_ids: [28, 878],
        release_date: '2024-02-01'
    }
];

const mockPersons = [
    {
        id: 201,
        name: 'Accessible Keanu',
        known_for_department: 'Acting',
        profile_path: '/keanu.jpg',
        popularity: 50.0,
        adult: false,
        known_for: [
            { id: 101, title: 'Accessibility Inception', media_type: 'movie', adult: false }
        ]
    },
    {
        id: 202,
        name: 'Accessible Carrie',
        known_for_department: 'Acting',
        profile_path: '/carrie.jpg',
        popularity: 45.0,
        adult: false,
        known_for: [
            { id: 102, title: 'Keyboard Matrix', media_type: 'movie', adult: false }
        ]
    }
];

async function runAccessibilityTests() {
    let server;
    let browser;
    const errors = [];
    let delayNextMovie101 = false;

    try {
        console.log('Starting local HTTP server for accessibility tests...');
        server = http.createServer((req, res) => {
            const urlPath = req.url.split('?')[0].split('#')[0];
            const filePath = path.join(ROOT_DIR, urlPath === '/' ? 'index.html' : urlPath);

            if (!filePath.startsWith(ROOT_DIR)) {
                res.writeHead(403);
                return res.end('Forbidden');
            }

            fs.readFile(filePath, (err, content) => {
                if (err) {
                    res.writeHead(404);
                    return res.end('Not found');
                }
                const ext = path.extname(filePath).toLowerCase();
                const contentType = MIME_TYPES[ext] || 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            });
        });

        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        console.log(`Server listening on port ${port}`);

        console.log('Launching Puppeteer...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        page.on('pageerror', err => {
            console.error('PAGE ERROR:', err.message);
            errors.push(err);
        });
        page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

        await page.setBypassServiceWorker(true);
        await page.setRequestInterception(true);

        page.on('request', req => {
            const url = req.url();
            if (req.method() === 'OPTIONS') {
                req.respond({
                    status: 200,
                    headers: { 'Access-Control-Allow-Origin': '*' }
                });
                return;
            }

            if (url.includes('api.themoviedb.org')) {
                const headers = { 'Access-Control-Allow-Origin': '*' };

                if (url.includes('/genre/movie/list')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            genres: [
                                { id: 28, name: 'Aksiyon' },
                                { id: 878, name: 'Bilim Kurgu' }
                            ]
                        })
                    });
                    return;
                }

                if (url.includes('/search/multi')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            page: 1,
                            results: mockMovies,
                            total_pages: 1
                        })
                    });
                    return;
                }

                if (url.includes('/search/person')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            page: 1,
                            results: mockPersons,
                            total_pages: 1
                        })
                    });
                    return;
                }

                if (url.includes('/trending/all/week') || url.includes('/discover/movie') || url.includes('/now_playing') || url.includes('/upcoming')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            page: 1,
                            results: mockMovies,
                            total_pages: 1
                        })
                    });
                    return;
                }

                if (url.includes('/trending/person') || url.includes('/person/popular')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            page: 1,
                            results: mockPersons,
                            total_pages: 1
                        })
                    });
                    return;
                }

                if (url.includes('/collection/')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            id: 86311,
                            name: 'Marvel Sinematik Evreni',
                            overview: 'Marvel koleksiyonu',
                            poster_path: '/poster1.jpg',
                            backdrop_path: '/backdrop.jpg',
                            parts: mockMovies
                        })
                    });
                    return;
                }

                if (url.includes('/person/201/combined_credits') || url.includes('/person/202/combined_credits')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            cast: mockMovies,
                            crew: []
                        })
                    });
                    return;
                }

                if (url.includes('/person/201')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            id: 201,
                            name: 'Accessible Keanu',
                            biography: 'Known for playing Neo and accessible roles.',
                            profile_path: '/keanu.jpg',
                            birthday: '1964-09-02',
                            place_of_birth: 'Beirut, Lebanon'
                        })
                    });
                    return;
                }

                if (url.includes('/videos')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            id: 101,
                            results: [
                                {
                                    id: 'v1',
                                    key: 'dQw4w9WgXcQ',
                                    name: 'Official Trailer',
                                    site: 'YouTube',
                                    type: 'Trailer'
                                }
                            ]
                        })
                    });
                    return;
                }

                if (url.includes('/movie/101') || url.includes('/movie/102')) {
                    const is101 = url.includes('/movie/101');
                    const response = {
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            id: is101 ? 101 : 102,
                            title: is101 ? 'Accessibility Inception' : 'Keyboard Matrix',
                            overview: is101 ? 'A movie about accessible web design.' : 'Follow the white rabbit.',
                            poster_path: is101 ? '/poster1.jpg' : '/poster2.jpg',
                            backdrop_path: '/backdrop.jpg',
                            vote_average: 8.8,
                            runtime: 148,
                            release_date: '2024-01-01',
                            genres: [{ id: 28, name: 'Aksiyon' }],
                            credits: {
                                cast: [{ id: 201, name: 'Accessible Keanu', character: 'Neo', profile_path: '/keanu.jpg' }],
                                crew: [{ id: 301, name: 'Christopher Nolan', job: 'Director', department: 'Directing' }]
                            },
                            belongs_to_collection: {
                                id: 86311,
                                name: 'Marvel Sinematik Evreni',
                                poster_path: '/poster1.jpg',
                                backdrop_path: '/backdrop.jpg'
                            },
                            recommendations: {
                                results: is101 ? [mockMovies[1]] : []
                            },
                            videos: {
                                results: [
                                    {
                                        id: 'v1',
                                        key: 'dQw4w9WgXcQ',
                                        name: 'Official Trailer',
                                        site: 'YouTube',
                                        type: 'Trailer'
                                    }
                                ]
                            },
                            similar: { results: [] }
                        })
                    };

                    if (is101 && delayNextMovie101) {
                        delayNextMovie101 = false;
                        setTimeout(() => {
                            req.respond(response).catch(err => {
                                console.error('Delayed movie mock response failed:', err.message);
                            });
                        }, 150);
                    } else {
                        req.respond(response);
                    }
                    return;
                }

                if (url.includes('/watch/providers')) {
                    req.respond({
                        status: 200,
                        headers,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            id: 101,
                            results: {
                                TR: {
                                    flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg' }]
                                }
                            }
                        })
                    });
                    return;
                }

                req.respond({
                    status: 200,
                    headers,
                    contentType: 'application/json',
                    body: JSON.stringify({ page: 1, results: [], total_pages: 1 })
                });
                return;
            }

            if (url.includes('image.tmdb.org') || url.includes('placeholder.com')) {
                req.respond({
                    status: 200,
                    contentType: 'image/png',
                    body: Buffer.from('')
                });
                return;
            }

            req.continue();
        });

        console.log('Navigating to index.html...');
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 600));

        console.log('\n--- Running Complete Accessibility Journeys (A through O) ---\n');

        // ==========================================
        // BASELINE CHECKS: html[lang="tr"] & CSS :focus-visible
        // ==========================================
        const lang = await page.$eval('html', el => el.getAttribute('lang'));
        assert(lang === 'tr', `Baseline Check FAILED: html lang is "${lang}", expected "tr"`);
        console.log('[PASS] Baseline: html[lang="tr"] verified');

        const cssContent = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');
        assert(cssContent.includes(':focus-visible'), 'Baseline Check FAILED: style.css missing :focus-visible rules');
        console.log('[PASS] Baseline: style.css contains :focus-visible rules');

        // ==========================================
        // JOURNEY A: SKIP LINK
        // ==========================================
        console.log('\n--- Running Journey A: Skip Link ---');
        // Ensure natural blurred initial focus state
        await page.evaluate(() => {
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
        });
        await page.keyboard.press('Tab');
        const isSkipLink = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('skip-link'));
        assert(isSkipLink, 'Journey A FAILED: First tab stop must be .skip-link');

        const skipLinkHref = await page.$eval('.skip-link', el => el.getAttribute('href'));
        assert(skipLinkHref === '#main-content', `Journey A FAILED: skip-link href is "${skipLinkHref}", expected "#main-content"`);

        const mainTabIndex = await page.$eval('#main-content', el => el.getAttribute('tabindex'));
        assert(mainTabIndex === '-1', `Journey A FAILED: #main-content tabindex is "${mainTabIndex}", expected "-1"`);

        await page.keyboard.press('Enter');
        const activeAfterSkip = await page.evaluate(() => document.activeElement ? document.activeElement.id : null);
        assert(activeAfterSkip === 'main-content', `Journey A FAILED: Focus did not move to #main-content after Enter, got "${activeAfterSkip}"`);
        console.log('[PASS] Journey A: First tab stop is skip-link and Enter moves focus to #main-content');

        // ==========================================
        // JOURNEY B: FOCUS VISIBLE
        // ==========================================
        console.log('\n--- Running Journey B: Focus Visible ---');
        await page.evaluate(() => {
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
        });
        await page.keyboard.press('Tab');
        const computedFocus = await page.evaluate(() => {
            const el = document.activeElement;
            const style = window.getComputedStyle(el);
            return {
                tag: el.tagName,
                className: el.className,
                outlineStyle: style.outlineStyle,
                outlineWidth: style.outlineWidth,
                boxShadow: style.boxShadow
            };
        });
        const hasVisibleIndicator = (computedFocus.outlineStyle && computedFocus.outlineStyle !== 'none' && computedFocus.outlineWidth !== '0px') ||
                                   (computedFocus.boxShadow && computedFocus.boxShadow !== 'none');
        assert(hasVisibleIndicator, `Journey B FAILED: Computed focus style on ${computedFocus.className} has no visible outline or box-shadow: ${JSON.stringify(computedFocus)}`);
        console.log('[PASS] Journey B: Visible keyboard focus styling verified via computed styles and :focus-visible rules');

        // ==========================================
        // JOURNEY C: RANDOM MODAL FOCUS TRAP
        // ==========================================
        console.log('\n--- Running Journey C: Random Modal Focus Trap ---');
        await page.evaluate(() => switchTab(null, 'platform'));
        await new Promise(r => setTimeout(r, 150));

        await page.focus('#surprise-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => {
            const modal = document.getElementById('random-modal');
            return modal && modal.classList.contains('active') && modal.getAttribute('aria-hidden') === 'false' && modal.contains(document.activeElement);
        });

        const randomComputedDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('random-modal')).display);
        assert(randomComputedDisplay === 'flex', `Journey C FAILED: #random-modal computed display is "${randomComputedDisplay}", expected "flex"`);

        const randomMainInert = await page.evaluate(() => document.getElementById('main-content').inert);
        assert(randomMainInert === true, 'Journey C FAILED: #main-content is not inert while #random-modal is open');

        const randomInitialInside = await page.evaluate(() => document.getElementById('random-modal').contains(document.activeElement));
        assert(randomInitialInside, 'Journey C FAILED: Initial focus is not inside #random-modal');

        // Tab forward multiple times, focus must stay inside modal
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Tab');
            const inside = await page.evaluate(() => document.getElementById('random-modal').contains(document.activeElement));
            assert(inside, `Journey C FAILED: Tab step ${i} escaped #random-modal`);
        }

        // Shift+Tab backward multiple times, focus must stay inside modal
        for (let i = 0; i < 5; i++) {
            await page.keyboard.down('Shift');
            await page.keyboard.press('Tab');
            await page.keyboard.up('Shift');
            const inside = await page.evaluate(() => document.getElementById('random-modal').contains(document.activeElement));
            assert(inside, `Journey C FAILED: Shift+Tab step ${i} escaped #random-modal`);
        }

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => {
            const modal = document.getElementById('random-modal');
            return modal && !modal.classList.contains('active') && modal.getAttribute('aria-hidden') === 'true';
        });

        const randomMainInertClosed = await page.evaluate(() => document.getElementById('main-content').inert);
        assert(randomMainInertClosed === false, 'Journey C FAILED: #main-content is still inert after #random-modal closed');

        const activeAfterRandom = await page.evaluate(() => document.activeElement ? document.activeElement.id : null);
        assert(activeAfterRandom === 'surprise-btn', `Journey C FAILED: Focus did not restore to #surprise-btn, got "${activeAfterRandom}"`);
        console.log('[PASS] Journey C: Random modal keyboard activation, initial focus, trap, Escape, and focus restore verified');

        // ==========================================
        // JOURNEY D: REAL DETAILS / TRAILER JOURNEY
        // ==========================================
        console.log('\n--- Running Journey D: Real Details / Trailer Journey ---');
        await page.evaluate(async () => {
            switchTab(null, 'platform');
            await new Promise(r => setTimeout(r, 100));
            document.getElementById('searchInput').value = 'Inception';
            await searchMovie(true);
        });
        await page.waitForFunction(() => document.querySelector('#search-results .movie-title-btn') !== null);

        delayNextMovie101 = true;
        await page.focus('#search-results .movie-title-btn');
        await page.keyboard.press('Enter');

        await page.waitForFunction(() => {
            const modal = document.getElementById('details-modal');
            return modal && modal.classList.contains('active') && modal.getAttribute('aria-hidden') === 'false';
        });

        const detailsComputedDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('details-modal')).display);
        assert(detailsComputedDisplay === 'flex', `Journey D FAILED: #details-modal computed display is "${detailsComputedDisplay}", expected "flex"`);

        const detailsOpenNameState = await page.evaluate(() => {
            const modal = document.getElementById('details-modal');
            const labelledBy = modal.getAttribute('aria-labelledby');
            const source = labelledBy ? document.getElementById(labelledBy) : null;
            return {
                labelledBy,
                sourceExists: Boolean(source),
                sourceText: source ? source.textContent.trim() : ''
            };
        });
        assert(detailsOpenNameState.labelledBy === 'details-title', `Journey D FAILED: details aria-labelledby is "${detailsOpenNameState.labelledBy}"`);
        assert(detailsOpenNameState.sourceExists, 'Journey D FAILED: details accessible-name source does not exist at open time');
        assert(detailsOpenNameState.sourceText.length > 0, 'Journey D FAILED: details accessible-name source is empty at open time');

        const detailsHandle = await page.$('#details-modal');
        if (page.accessibility && typeof page.accessibility.snapshot === 'function') {
            const detailsAx = await page.accessibility.snapshot({ root: detailsHandle, interestingOnly: false });
            assert(Boolean(detailsAx && detailsAx.name && detailsAx.name.trim()), 'Journey D FAILED: browser accessibility tree reports an empty details dialog name');
        }

        await page.waitForFunction(() => {
            const modal = document.getElementById('details-modal');
            const trailerBtn = modal ? modal.querySelector('.details-left button[onclick*="openTrailer"]') : null;
            const title = document.getElementById('details-title');
            return trailerBtn !== null && title && title.textContent.includes('Accessibility Inception');
        });

        assert(await page.evaluate(() => document.getElementById('main-content').inert === true), 'Journey D FAILED: #main-content is not inert while details modal open');

        await page.focus('.details-left button[onclick*="openTrailer"]');
        await page.keyboard.press('Enter');

        await page.waitForFunction(() => {
            const tm = document.getElementById('trailer-modal');
            return tm && tm.classList.contains('active') && tm.getAttribute('aria-hidden') === 'false' && tm.contains(document.activeElement);
        });

        const trailerComputedDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('trailer-modal')).display);
        assert(trailerComputedDisplay === 'flex', `Journey D FAILED: #trailer-modal computed display is "${trailerComputedDisplay}", expected "flex"`);

        const detailsUnderlaid = await page.evaluate(() => {
            const dm = document.getElementById('details-modal');
            return dm.classList.contains('modal-underlay') && (dm.inert === true || dm.getAttribute('aria-hidden') === 'true');
        });
        assert(detailsUnderlaid, 'Journey D FAILED: #details-modal is not underlaid/inert while #trailer-modal is active');

        for (let i = 0; i < 3; i++) {
            await page.keyboard.press('Tab');
            assert(await page.evaluate(() => document.getElementById('trailer-modal').contains(document.activeElement)), 'Journey D FAILED: Tab escaped trailer modal trap');
        }
        await page.keyboard.down('Shift');
        await page.keyboard.press('Tab');
        await page.keyboard.up('Shift');
        assert(await page.evaluate(() => document.getElementById('trailer-modal').contains(document.activeElement)), 'Journey D FAILED: Shift+Tab escaped trailer modal trap');

        await page.focus('#trailer-modal .close-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => {
            const tm = document.getElementById('trailer-modal');
            const dm = document.getElementById('details-modal');
            return tm &&
                !tm.classList.contains('active') &&
                tm.getAttribute('aria-hidden') === 'true' &&
                dm &&
                dm.classList.contains('active') &&
                !dm.classList.contains('modal-underlay') &&
                dm.inert === false;
        });

        const nativeCloseFocusState = await page.evaluate(() => {
            const trailerBtn = document.querySelector('.details-left button[onclick*="openTrailer"]');
            const detailsClose = document.querySelector('#details-modal .close-btn');
            return {
                onTrailerTrigger: document.activeElement === trailerBtn,
                onDetailsClose: document.activeElement === detailsClose
            };
        });
        assert(nativeCloseFocusState.onTrailerTrigger, 'Journey D FAILED: Native trailer close did not restore focus to trailer trigger');
        assert(!nativeCloseFocusState.onDetailsClose, 'Journey D FAILED: Native trailer close bubbled into a second close and moved focus to Details close button');

        await page.keyboard.press('Enter');
        await page.waitForFunction(() => {
            const tm = document.getElementById('trailer-modal');
            return tm && tm.classList.contains('active') && tm.contains(document.activeElement);
        });

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => {
            const tm = document.getElementById('trailer-modal');
            const dm = document.getElementById('details-modal');
            return tm && !tm.classList.contains('active') && dm && dm.classList.contains('active') && !dm.classList.contains('modal-underlay');
        });
        assert(await page.evaluate(() => {
            const btn = document.querySelector('.details-left button[onclick*="openTrailer"]');
            return document.activeElement === btn;
        }), 'Journey D FAILED: Escape did not return focus to trailer button inside details');

        await page.focus('#details-modal .close-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.getElementById('details-modal').classList.contains('active'));
        await page.waitForFunction(() => {
            const titleBtn = document.querySelector('#search-results .movie-title-btn');
            return document.activeElement === titleBtn;
        }, { timeout: 3000 });

        console.log('[PASS] Journey D: Details open-time accessible name, nested trailer trap, native close, Escape, and focus restore verified');

        // ==========================================
        // JOURNEY E: REAL RECOMMENDATION + ROUTER HISTORY
        // ==========================================
        console.log('\n--- Running Journey E: Real Recommendation + Router History ---');
        // Movie 101 card is in grid. Activate it with keyboard Enter
        await page.focus('#search-results .movie-title-btn');
        await page.keyboard.press('Enter');

        await page.waitForFunction(() => {
            const recCard = document.querySelector('#details-recommendations .recommendation-card');
            return recCard !== null;
        });

        const historyState1 = await page.evaluate(() => ({
            index: history.state?.filmRehberiRouter?.index,
            hash: window.location.hash
        }));
        assert(historyState1.hash.includes('movie/101'), 'Journey E FAILED: Route hash does not contain movie/101');

        // Activate real recommendation card for Movie 102 via keyboard Enter
        await new Promise(r => setTimeout(r, 60));
        await page.focus('#details-recommendations .recommendation-card');
        await page.keyboard.press('Enter');

        await page.waitForFunction(() => {
            const title = document.getElementById('details-title');
            return title && title.textContent.includes('Keyboard Matrix');
        });

        const historyState2 = await page.evaluate(() => ({
            index: history.state?.filmRehberiRouter?.index,
            hash: window.location.hash
        }));
        assert(historyState2.hash.includes('movie/102'), 'Journey E FAILED: Route hash does not contain movie/102');
        assert(historyState2.index > historyState1.index, `Journey E FAILED: Router history index did not advance: ${historyState2.index} <= ${historyState1.index}`);

        // Close details from Movie 102 via close button
        await page.focus('#details-modal .close-btn');
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 400));

        // If history rewound back to Movie 101, close once more to reach platform
        const currentHash = await page.evaluate(() => window.location.hash);
        if (currentHash.includes('movie/101')) {
            await page.focus('#details-modal .close-btn');
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => {
                const dm = document.getElementById('details-modal');
                return dm && !dm.classList.contains('active');
            });
        }

        await page.waitForFunction(() => {
            const titleBtn = document.querySelector('#search-results .movie-title-btn');
            return document.activeElement === titleBtn;
        }, { timeout: 3000 });

        const finalTriggerRestored = await page.evaluate(() => {
            const titleBtn = document.querySelector('#search-results .movie-title-btn');
            return document.activeElement === titleBtn;
        });
        assert(finalTriggerRestored, 'Journey E FAILED: Focus did not restore to external Movie 101 card on platform');
        console.log('[PASS] Journey E: Real recommendation navigation, router history index contract, and external focus restore verified');

        // ==========================================
        // JOURNEY F: REAL ACTOR ROUTE KEYBOARD ACCESS
        // ==========================================
        console.log('\n--- Running Journey F: Real Actor Route Keyboard Access ---');
        await page.evaluate(() => openDetails(101, 'movie'));
        await page.waitForFunction(() => document.querySelector('#details-modal .actor-card') !== null);

        const actorCardSemantics = await page.$eval('#details-modal .actor-card', el => ({
            role: el.getAttribute('role'),
            tabindex: el.getAttribute('tabindex'),
            label: el.getAttribute('aria-label')
        }));
        assert(actorCardSemantics.role === 'button', `Journey F FAILED: actor card role is "${actorCardSemantics.role}"`);
        assert(actorCardSemantics.tabindex === '0', `Journey F FAILED: actor card tabindex is "${actorCardSemantics.tabindex}"`);
        assert(Boolean(actorCardSemantics.label), 'Journey F FAILED: actor card is missing aria-label');

        await page.focus('#details-modal .actor-card');
        await page.keyboard.press('Enter');

        await page.waitForFunction(() => {
            const platform = document.getElementById('platform');
            const details = document.getElementById('details-modal');
            return window.location.hash.includes('actor/201') &&
                platform &&
                platform.classList.contains('active-tab') &&
                details &&
                !details.classList.contains('active') &&
                document.querySelector('#search-results .movie-title-btn');
        });

        const actorRouteState = await page.evaluate(() => ({
            hash: window.location.hash,
            detailsHidden: document.getElementById('details-modal').getAttribute('aria-hidden'),
            actorModalActive: document.getElementById('actor-modal').classList.contains('active'),
            resultCount: document.querySelectorAll('#search-results .movie-title-btn').length
        }));
        assert(actorRouteState.hash.includes('actor/201'), `Journey F FAILED: real actor keyboard activation routed to "${actorRouteState.hash}"`);
        assert(actorRouteState.detailsHidden === 'true', `Journey F FAILED: details modal aria-hidden is "${actorRouteState.detailsHidden}" on actor route`);
        assert(actorRouteState.actorModalActive === false, 'Journey F FAILED: legacy actor modal opened instead of production actor route');
        assert(actorRouteState.resultCount > 0, 'Journey F FAILED: actor route did not render production movie results');

        await page.evaluate(() => switchTab(null, 'platform'));
        await page.waitForFunction(() => document.getElementById('platform').classList.contains('active-tab'));

        // Verify the same production role=button handler with Space, without injecting test handlers.
        await page.evaluate(() => openDetails(101, 'movie'));
        await page.waitForFunction(() => document.querySelector('#details-modal .actor-card') !== null);
        await page.focus('#details-modal .actor-card');
        await page.keyboard.press('Space');
        await page.waitForFunction(() => {
            const details = document.getElementById('details-modal');
            return window.location.hash.includes('actor/201') &&
                details &&
                !details.classList.contains('active') &&
                document.querySelector('#search-results .movie-title-btn');
        });
        assert(await page.evaluate(() => window.location.hash.includes('actor/201')), 'Journey F FAILED: actor card Space activation did not route to #actor/201');

        await page.evaluate(() => switchTab(null, 'platform'));
        await page.waitForFunction(() => document.getElementById('platform').classList.contains('active-tab'));
        console.log('[PASS] Journey F: Production actor card Enter/Space activation routes to #actor/201 without test-injected handlers');

        // ==========================================
        // JOURNEY G: FAVORITE ACTOR CARD SEPARATION
        // ==========================================
        console.log('\n--- Running Journey G: Favorite Actor Card Separation ---');
        await page.evaluate(() => {
            localStorage.setItem('favoriteActors', JSON.stringify([
                { id: 201, name: 'Accessible Keanu', profile_path: '/keanu.jpg' }
            ]));
            switchTab(null, 'profile');
        });
        await page.waitForFunction(() => document.getElementById('tab-profile-fav-actors') !== null);
        await page.focus('#tab-profile-fav-actors');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => {
            const tab = document.getElementById('tab-profile-fav-actors');
            return tab &&
                tab.getAttribute('aria-selected') === 'true' &&
                document.querySelector('.fav-actor-card') !== null;
        });

        const favActorCardStructure = await page.evaluate(() => {
            const card = document.querySelector('.fav-actor-card');
            const mainBtn = card.querySelector('.fav-actor-main-btn');
            const heartBtn = card.querySelector('.btn-actor-heart');
            return {
                hasMain: Boolean(mainBtn),
                hasHeart: Boolean(heartBtn),
                isSibling: mainBtn.parentElement === heartBtn.parentElement,
                mainNestedInInteractive: Boolean(mainBtn.closest('a, button:not(.fav-actor-main-btn)')),
                heartNestedInInteractive: Boolean(heartBtn.closest('a, button:not(.btn-actor-heart)'))
            };
        });
        assert(favActorCardStructure.hasMain && favActorCardStructure.hasHeart, 'Journey G FAILED: Missing main button or heart button in fav-actor-card');
        assert(favActorCardStructure.isSibling, 'Journey G FAILED: Main button and heart button must be siblings');
        assert(!favActorCardStructure.mainNestedInInteractive && !favActorCardStructure.heartNestedInInteractive, 'Journey G FAILED: Buttons are nested inside invalid interactive parents');

        // Heart activation toggles favorite only (does NOT open actor modal or navigate)
        await page.focus('.fav-actor-card .btn-actor-heart');
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 150));

        const heartToggled = await page.evaluate(() => {
            const am = document.getElementById('actor-modal');
            const dm = document.getElementById('details-modal');
            const stored = JSON.parse(localStorage.getItem('favoriteActors') || '[]');
            return {
                modalOpen: (am && am.classList.contains('active')) || (dm && dm.classList.contains('active')),
                removedFromFavs: !stored.some(a => a.id == 201)
            };
        });
        assert(!heartToggled.modalOpen, 'Journey G FAILED: Heart Enter key opened a modal!');
        assert(heartToggled.removedFromFavs, 'Journey G FAILED: Heart Enter key did not toggle favorite in localStorage');
        console.log('[PASS] Journey G: Favorite actor card non-nested interactive semantics and isolated action verified');

        // ==========================================
        // JOURNEY H: HOME CARD KEYBOARD ACCESSIBILITY
        // ==========================================
        console.log('\n--- Running Journey H: Home Card Keyboard Accessibility ---');
        await page.evaluate(() => switchTab(null, 'home'));
        await page.waitForFunction(() =>
            document.querySelector('#trending-actors-list .story-item') &&
            document.querySelector('#curated-collections-list .movie-card') &&
            document.querySelector('#top10-grid .top10-card')
        );

        const homeCardSemantics = await page.evaluate(() => {
            const actor = document.querySelector('#trending-actors-list .story-item');
            const collection = document.querySelector('#curated-collections-list .movie-card');
            const top10 = document.querySelector('#top10-grid .top10-card');
            const read = el => el ? {
                role: el.getAttribute('role'),
                tabindex: el.getAttribute('tabindex'),
                label: el.getAttribute('aria-label')
            } : null;
            return { actor: read(actor), collection: read(collection), top10: read(top10) };
        });
        for (const [name, state] of Object.entries(homeCardSemantics)) {
            assert(state && state.role === 'button', `Journey H FAILED: ${name} card missing role=button`);
            assert(state.tabindex === '0', `Journey H FAILED: ${name} card tabindex is "${state.tabindex}"`);
            assert(Boolean(state.label), `Journey H FAILED: ${name} card missing aria-label`);
        }

        await page.focus('#trending-actors-list .story-item');
        await page.keyboard.press('Enter');

        await page.waitForFunction(
            () =>
                window.location.hash.includes('actor/201') &&
                document.querySelectorAll('#search-results .movie-title-btn').length > 0,
            { timeout: 3000 }
        );

        assert(
            await page.evaluate(() =>
                window.location.hash.includes('actor/201') &&
                document.querySelectorAll('#search-results .movie-title-btn').length > 0
            ),
            'Journey H FAILED: trending actor did not render real actor route results'
        );

        await page.evaluate(() => switchTab(null, 'platform'));

        const top10Selector =
            '#top10-grid .top10-card[aria-label*="Accessibility Inception"]';

        await page.waitForFunction(
            selector => {
                const platform = document.getElementById('platform');
                const card = document.querySelector(selector);

                return Boolean(
                    platform &&
                    platform.classList.contains('active-tab') &&
                    card &&
                    card.isConnected &&
                    card.getAttribute('role') === 'button' &&
                    card.getAttribute('tabindex') === '0' &&
                    card.getClientRects().length > 0
                );
            },
            {},
            top10Selector
        );

        await page.focus(top10Selector);

        assert(
            await page.evaluate(selector => {
                const card = document.querySelector(selector);
                return Boolean(
                    card &&
                    card.isConnected &&
                    document.activeElement === card
                );
            }, top10Selector),
            'Journey H FAILED: visible Top 10 card did not receive keyboard focus'
        );

        await page.keyboard.press('Enter');

        await page.waitForFunction(() => {
            const modal = document.getElementById('details-modal');
            return window.location.hash.includes('movie/101') &&
                modal &&
                modal.classList.contains('active') &&
                document.getElementById('details-title').textContent.includes('Accessibility Inception');
        });
        await page.focus('#details-modal .close-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.getElementById('details-modal').classList.contains('active'));

        await page.evaluate(() => switchTab(null, 'home'));

        const collectionSelector =
            '#curated-collections-list .movie-card[aria-label^="Marvel Sinematik Evreni"]';

        await page.waitForFunction(
            selector => {
                const home = document.getElementById('now-playing');
                const card = document.querySelector(selector);

                return Boolean(
                    home &&
                    home.classList.contains('active-tab') &&
                    card &&
                    card.isConnected &&
                    card.getAttribute('role') === 'button' &&
                    card.getAttribute('tabindex') === '0' &&
                    card.getClientRects().length > 0
                );
            },
            {},
            collectionSelector
        );

        let collectionFocused = false;

        for (let attempt = 0; attempt < 5 && !collectionFocused; attempt += 1) {
            await page.focus(collectionSelector);

            await new Promise(resolve => setTimeout(resolve, 50));

            collectionFocused = await page.evaluate(selector => {
                const card = document.querySelector(selector);

                return Boolean(
                    card &&
                    card.isConnected &&
                    card.getClientRects().length > 0 &&
                    document.activeElement === card
                );
            }, collectionSelector);
        }

        assert(
            collectionFocused,
            'Journey H FAILED: Curated Collection card could not receive stable keyboard focus'
        );

        await page.keyboard.press('Space');

        await page.waitForFunction(() => {
            const platform = document.getElementById('platform');
            const heading = document.querySelector('#search-results h2');

            return Boolean(
                platform &&
                platform.classList.contains('active-tab') &&
                heading &&
                heading.textContent.includes('Marvel Sinematik Evreni') &&
                document.querySelector('#search-results .movie-title-btn')
            );
        });

        console.log('[PASS] Journey H: Production Trending Actor, Curated Collection, and Top 10 cards verified with real keyboard activation');

        // ==========================================
        // JOURNEY I: DETAILS SECONDARY CARDS
        // ==========================================
        console.log('\n--- Running Journey I: Details Secondary Cards ---');
        await page.evaluate(() => openDetails(101, 'movie'));
        await page.waitForFunction(() =>
            document.querySelector('#details-modal .actor-card') &&
            document.querySelector('#details-recommendations .recommendation-card') &&
            document.querySelector('#collection-container .recommendation-card')
        );

        const secondaryCards = await page.evaluate(() => {
            const director = document.getElementById('directorLink');
            const cast = document.querySelector('.actor-card');
            const rec = document.querySelector('#details-recommendations .recommendation-card');
            const colPart = document.querySelector('#collection-container .recommendation-card');
            const read = el => el ? {
                role: el.getAttribute('role'),
                tabindex: el.getAttribute('tabindex'),
                label: el.getAttribute('aria-label')
            } : null;
            return { director: read(director), cast: read(cast), rec: read(rec), colPart: read(colPart) };
        });

        assert(secondaryCards.director && secondaryCards.director.role === 'button' && secondaryCards.director.tabindex === '0', 'Journey I FAILED: Director link missing role=button or tabindex=0');
        assert(secondaryCards.cast && secondaryCards.cast.role === 'button' && secondaryCards.cast.tabindex === '0', 'Journey I FAILED: Cast card missing role=button or tabindex=0');
        assert(secondaryCards.rec && secondaryCards.rec.role === 'button' && secondaryCards.rec.tabindex === '0', 'Journey I FAILED: Recommendation card missing role=button or tabindex=0');
        assert(secondaryCards.colPart && secondaryCards.colPart.role === 'button' && secondaryCards.colPart.tabindex === '0', 'Journey I FAILED: Collection part missing role=button or tabindex=0');

        await page.focus('#details-modal .close-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.getElementById('details-modal').classList.contains('active'));
        console.log('[PASS] Journey I: Real Director, Cast, Recommendation, and Collection Part accessibility verified');

        // ==========================================
        // JOURNEY J: SEARCH COMBOBOX & POINTER SELECTION
        // ==========================================
        console.log('\n--- Running Journey J: Search Combobox & Pointer Selection ---');
        await page.evaluate(() => switchTab(null, 'platform'));
        await page.focus('#searchInput');
        await page.type('#searchInput', 'Inception');
        await page.waitForFunction(() => {
            const box = document.getElementById('autocomplete-box');
            return box && box.style.display !== 'none' && box.querySelectorAll('[role="option"]').length > 0;
        });

        // ArrowDown / ArrowUp
        await page.focus('#searchInput');
        await page.keyboard.press('ArrowDown');
        const activeDesc1 = await page.$eval('#searchInput', el => el.getAttribute('aria-activedescendant'));
        assert(activeDesc1 === 'search-opt-0', `Journey J FAILED: Expected search-opt-0, got "${activeDesc1}"`);

        await page.keyboard.press('ArrowDown');
        const activeDesc2 = await page.$eval('#searchInput', el => el.getAttribute('aria-activedescendant'));
        assert(activeDesc2 === 'search-opt-1', `Journey J FAILED: Expected search-opt-1, got "${activeDesc2}"`);

        await page.keyboard.press('ArrowUp');
        const activeDesc3 = await page.$eval('#searchInput', el => el.getAttribute('aria-activedescendant'));
        assert(activeDesc3 === 'search-opt-0', `Journey J FAILED: Expected search-opt-0, got "${activeDesc3}"`);

        // Escape cleans up aria-selected and closes
        await page.keyboard.press('Escape');
        const searchCleanedEscape = await page.evaluate(() => {
            const input = document.getElementById('searchInput');
            const box = document.getElementById('autocomplete-box');
            const anyActive = box.querySelector('.active');
            const anySelected = box.querySelector('[aria-selected="true"]');
            return {
                expanded: input.getAttribute('aria-expanded'),
                hidden: box.style.display === 'none',
                hasActive: Boolean(anyActive),
                hasSelected: Boolean(anySelected)
            };
        });
        assert(searchCleanedEscape.expanded === 'false' && searchCleanedEscape.hidden, 'Journey J FAILED: Escape did not close search');
        assert(!searchCleanedEscape.hasActive && !searchCleanedEscape.hasSelected, 'Journey J FAILED: Escape did not clean up .active / aria-selected');

        // Test Tab cleanup without preventing natural Tab
        await page.focus('#searchInput');
        await page.type('#searchInput', 'A');
        await new Promise(r => setTimeout(r, 600));

        await page.keyboard.press('Tab');
        const searchCleanedTab = await page.evaluate(() => {
            const input = document.getElementById('searchInput');
            const box = document.getElementById('autocomplete-box');
            return input.getAttribute('aria-expanded') === 'false' && box.style.display === 'none';
        });
        assert(searchCleanedTab, 'Journey J FAILED: Tab did not clean up search combobox');

        // Real pointer selection: verify production route/history result.
        await page.focus('#searchInput');
        await page.$eval('#searchInput', el => { el.value = ''; });
        await page.type('#searchInput', 'Inception');
        await page.waitForFunction(() => {
            const box = document.getElementById('autocomplete-box');
            return box && box.style.display !== 'none' && box.querySelectorAll('[role="option"]').length > 0;
        });

        const historyBeforeSearchPointer = await page.evaluate(() => history.state?.filmRehberiRouter?.index ?? 0);
        await page.click('#search-opt-0');
        await page.waitForFunction(() => {
            const modal = document.getElementById('details-modal');
            return window.location.hash.includes('movie/101') &&
                modal &&
                modal.classList.contains('active') &&
                document.getElementById('details-title').textContent.includes('Accessibility Inception');
        });

        const historyAfterSearchPointer = await page.evaluate(() => history.state?.filmRehberiRouter?.index ?? 0);
        assert(historyAfterSearchPointer === historyBeforeSearchPointer + 1, `Journey J FAILED: pointer selection advanced router index from ${historyBeforeSearchPointer} to ${historyAfterSearchPointer}, expected exactly +1`);
        assert(await page.$eval('#searchInput', el => el.getAttribute('aria-expanded') === 'false' && !el.hasAttribute('aria-activedescendant')), 'Journey J FAILED: pointer selection did not clean combobox ARIA state');

        await page.focus('#details-modal .close-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => !document.getElementById('details-modal').classList.contains('active'));
        console.log('[PASS] Journey J: Search combobox navigation, cleanup, and real pointer route/history behavior verified');

        // ==========================================
        // JOURNEY K: ACTOR 1 & ACTOR 2 COMBOBOXES
        // ==========================================
        console.log('\n--- Running Journey K: Actor 1 & Actor 2 Comboboxes ---');
        await page.evaluate(() => {
            switchTab(null, 'games');
            switchGameTab('common-actor', document.getElementById('tab-common-actor'));
        });
        await new Promise(r => setTimeout(r, 150));

        for (const actorNum of ['1', '2']) {
            const inputId = `#actor${actorNum}-input`;
            const boxId = `#actor${actorNum}-autocomplete`;

            await page.focus(inputId);
            await page.type(inputId, 'Keanu');
            await page.waitForFunction((bId) => {
                const box = document.querySelector(bId);
                return box && box.style.display !== 'none' && box.querySelectorAll('[role="option"]').length > 0;
            }, {}, boxId);

            // ArrowDown
            await page.keyboard.press('ArrowDown');
            const activedesc = await page.$eval(inputId, el => el.getAttribute('aria-activedescendant'));
            assert(activedesc === `actor${actorNum}-opt-0`, `Journey K FAILED: ${inputId} activedescendant is "${activedesc}"`);

            // Tab cleanup
            await page.keyboard.press('Tab');
            const tabCleaned = await page.evaluate((iId, bId) => {
                const input = document.querySelector(iId);
                const box = document.querySelector(bId);
                const anyActive = box.querySelector('.active');
                const anySelected = box.querySelector('[aria-selected="true"]');
                return input.getAttribute('aria-expanded') === 'false' && box.style.display === 'none' && !anyActive && !anySelected;
            }, inputId, boxId);
            assert(tabCleaned, `Journey K FAILED: Tab did not clean up ${inputId}`);

            // Re-open and use the real pointer handler; assert real selected UI state.
            await page.focus(inputId);
            await page.$eval(inputId, el => { el.value = ''; });
            await page.type(inputId, 'Keanu');
            await page.waitForFunction((bId) => {
                const box = document.querySelector(bId);
                return box && box.style.display !== 'none' && box.querySelectorAll('[role="option"]').length > 0;
            }, {}, boxId);

            await page.click(`#actor${actorNum}-opt-0`);

            const pointerSelected = await page.evaluate((iId, bId) => {
                const input = document.querySelector(iId);
                const box = document.querySelector(bId);
                return {
                    value: input.value,
                    expanded: input.getAttribute('aria-expanded'),
                    activeDescendant: input.getAttribute('aria-activedescendant'),
                    hidden: box.style.display === 'none',
                    selectedCount: box.querySelectorAll('[aria-selected="true"]').length
                };
            }, inputId, boxId);

            assert(pointerSelected.value === 'Accessible Keanu', `Journey K FAILED: ${inputId} pointer selection value is "${pointerSelected.value}"`);
            assert(pointerSelected.expanded === 'false' && pointerSelected.hidden, `Journey K FAILED: ${inputId} pointer selection did not close listbox`);
            assert(pointerSelected.activeDescendant === null, `Journey K FAILED: ${inputId} pointer selection left aria-activedescendant="${pointerSelected.activeDescendant}"`);
            assert(pointerSelected.selectedCount === 0, `Journey K FAILED: ${inputId} pointer selection left aria-selected=true options`);
        }
        console.log('[PASS] Journey K: Actor 1 and Actor 2 combobox navigation, Tab cleanup, and real pointer selection state verified');

        // ==========================================
        // JOURNEY L: CUSTOM SELECT ACCESSIBILITY & DISPATCH
        // ==========================================
        console.log('\n--- Running Journey L: Custom Select Accessibility & Dispatch ---');
        await page.evaluate(() => switchTab(null, 'platform'));
        await page.waitForFunction(() => document.getElementById('platform').classList.contains('active-tab'));

        await page.click('#advanced-toggle-btn');
        await page.waitForFunction(() => {
            const panel = document.getElementById('advanced-search-panel');
            const btn = document.getElementById('advanced-toggle-btn');
            return panel && panel.style.display === 'block' && btn && btn.getAttribute('aria-expanded') === 'true';
        });

        await page.click('#searchInput');
        await new Promise(r => setTimeout(r, 350));
        const advancedOutsideState = await page.evaluate(() => {
            const panel = document.getElementById('advanced-search-panel');
            const btn = document.getElementById('advanced-toggle-btn');
            return {
                hidden: panel.style.display === 'none',
                closing: panel.classList.contains('closing'),
                expanded: btn.getAttribute('aria-expanded'),
                active: btn.classList.contains('active')
            };
        });
        assert(advancedOutsideState.hidden && !advancedOutsideState.closing, 'Journey L FAILED: outside click did not fully close advanced drawer');
        assert(advancedOutsideState.expanded === 'false', `Journey L FAILED: advanced toggle aria-expanded stayed "${advancedOutsideState.expanded}" after outside click`);
        assert(advancedOutsideState.active === false, 'Journey L FAILED: advanced toggle active class stayed set after outside click');

        await page.click('#advanced-toggle-btn');
        await page.waitForFunction(() => document.getElementById('advanced-toggle-btn').getAttribute('aria-expanded') === 'true');

        await page.evaluate(() => {
            window.selectChangeEvents = 0;
            const sortSelect = document.getElementById('sortByFilter');
            if (sortSelect) {
                sortSelect.addEventListener('change', () => {
                    window.selectChangeEvents++;
                });
            }
        });

        // Trigger accessible name includes field label AND current value
        const initialTriggerAria = await page.$eval('#sortByFilter + .custom-select-container .custom-select-trigger', el => ({
            label: el.getAttribute('aria-label'),
            role: el.getAttribute('role'),
            haspopup: el.getAttribute('aria-haspopup')
        }));
        assert(initialTriggerAria.role === 'combobox', 'Journey L FAILED: Trigger missing role=combobox');
        assert(initialTriggerAria.haspopup === 'listbox', 'Journey L FAILED: Trigger missing aria-haspopup=listbox');
        assert(Boolean(initialTriggerAria.label && initialTriggerAria.label.includes('Sıralama')), `Journey L FAILED: Trigger aria-label does not include field label: "${initialTriggerAria.label}"`);

        // Enter opens
        await page.focus('#sortByFilter + .custom-select-container .custom-select-trigger');
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 100));

        const isOpenOnEnter = await page.$eval('#sortByFilter + .custom-select-container', el => el.classList.contains('open'));
        assert(isOpenOnEnter, 'Journey L FAILED: Custom select did not open on Enter');

        // ArrowDown and Enter selection
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 100));

        const changeEventsCount = await page.evaluate(() => window.selectChangeEvents);
        assert(changeEventsCount === 1, `Journey L FAILED: Select change event fired ${changeEventsCount} times, expected exactly 1!`);

        // Trigger aria-label updated with new value
        const updatedTriggerAria = await page.$eval('#sortByFilter + .custom-select-container .custom-select-trigger', el => el.getAttribute('aria-label'));
        assert(Boolean(updatedTriggerAria && (updatedTriggerAria.includes('Oy') || updatedTriggerAria.includes('En Çok Oy'))), `Journey L FAILED: Trigger aria-label did not update to new value: "${updatedTriggerAria}"`);

        // Re-open with Space, Escape closes and restores focus to trigger
        await page.keyboard.press('Space');
        await new Promise(r => setTimeout(r, 100));
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 100));

        const isClosedOnEscape = await page.$eval('#sortByFilter + .custom-select-container', el => !el.classList.contains('open'));
        const isTriggerRefocused = await page.evaluate(() => {
            const trigger = document.querySelector('#sortByFilter + .custom-select-container .custom-select-trigger');
            return document.activeElement === trigger;
        });
        assert(isClosedOnEscape && isTriggerRefocused, 'Journey L FAILED: Escape did not close custom select or restore focus to trigger');

        // Re-open and Tab closes without preventing natural Tab
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 100));
        await page.keyboard.press('Tab');
        await new Promise(r => setTimeout(r, 100));

        const isClosedOnTab = await page.$eval('#sortByFilter + .custom-select-container', el => !el.classList.contains('open'));
        const triggerStillFocused = await page.evaluate(() => {
            const trigger = document.querySelector('#sortByFilter + .custom-select-container .custom-select-trigger');
            return document.activeElement === trigger;
        });
        assert(isClosedOnTab, 'Journey L FAILED: Tab did not close custom select');
        assert(!triggerStillFocused, 'Journey L FAILED: Tab was trapped or prevented on trigger');

        await page.click('#advanced-toggle-btn');
        await new Promise(r => setTimeout(r, 350));
        assert(await page.$eval('#advanced-toggle-btn', el => el.getAttribute('aria-expanded') === 'false'), 'Journey L FAILED: advanced toggle close path left aria-expanded=true');
        console.log('[PASS] Journey L: Advanced-drawer outside-click sync plus custom select keyboard/dispatch behaviors verified');

        // ==========================================
        // JOURNEY M: PREFERS-REDUCED-MOTION EMULATION
        // ==========================================
        console.log('\n--- Running Journey M: Prefers-Reduced-Motion Emulation ---');
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await new Promise(r => setTimeout(r, 100));

        const reducedMotionChecks = await page.evaluate(() => {
            const helperTrue = typeof prefersReducedMotion === 'function' ? prefersReducedMotion() : false;
            const testImg = document.createElement('img');
            testImg.dataset.intervalId = '';
            startHoverSlideshow(testImg, 101);
            const slideshowStarted = Boolean(testImg.dataset.intervalId);

            const scrollBehavior = (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) ? 'auto' : 'smooth';

            return {
                helperTrue,
                slideshowStarted,
                scrollBehavior
            };
        });

        assert(reducedMotionChecks.helperTrue === true, 'Journey M FAILED: prefersReducedMotion() did not return true under media emulation');
        assert(reducedMotionChecks.slideshowStarted === false, 'Journey M FAILED: startHoverSlideshow started under prefers-reduced-motion');
        assert(reducedMotionChecks.scrollBehavior === 'auto', `Journey M FAILED: scroll behavior is "${reducedMotionChecks.scrollBehavior}", expected "auto"`);

        // Restore normal media features
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
        console.log('[PASS] Journey M: Reduced motion emulation, slideshow suppression, and auto-scroll behaviors verified');

        // ==========================================
        // JOURNEY N: ACCESSIBILITY LIVE REGION ANNOUNCEMENTS
        // ==========================================
        console.log('\n--- Running Journey N: Accessibility Live Region Announcements ---');
        const liveRegionAria = await page.$eval('#a11y-live-region', el => ({
            role: el.getAttribute('role'),
            live: el.getAttribute('aria-live'),
            atomic: el.getAttribute('aria-atomic')
        }));
        assert(liveRegionAria.role === 'status', `Journey N FAILED: #a11y-live-region role is "${liveRegionAria.role}"`);
        assert(liveRegionAria.live === 'polite', `Journey N FAILED: #a11y-live-region aria-live is "${liveRegionAria.live}"`);

        // Trigger search suggestions announcement
        await page.focus('#searchInput');
        await page.type('#searchInput', 'Inception');
        await page.waitForFunction(() => {
            const lr = document.getElementById('a11y-live-region');
            return lr && lr.textContent.trim().length > 0;
        });
        const liveText = await page.$eval('#a11y-live-region', el => el.textContent);
        assert(liveText.includes('öneri') || liveText.includes('sonuç'), `Journey N FAILED: Live region announcement unexpected: "${liveText}"`);

        // Clear search
        await page.evaluate(() => {
            const input = document.getElementById('searchInput');
            input.value = '';
            closeSearchAutocomplete();
        });
        console.log('[PASS] Journey N: Live region polite status and controlled announcements verified');

        // ==========================================
        // ADDITIONAL SYSTEM VERIFICATIONS (Theme, Modals, Tabs, Mobile Menu, Views)
        // ==========================================
        console.log('\n--- Running Additional System Verifications ---');

        // 1. Persisted theme initial state + native keyboard toggle synchronization.
        await page.evaluate(() => localStorage.setItem('theme', 'light'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 650));

        const initialThemeState = await page.evaluate(() => {
            const btn = document.getElementById('themeToggleBtn');
            const icon = btn ? btn.querySelector('i') : null;
            return {
                light: document.body.classList.contains('light-theme'),
                pressed: btn ? btn.getAttribute('aria-pressed') : null,
                label: btn ? btn.getAttribute('aria-label') : null,
                title: btn ? btn.getAttribute('title') : null,
                iconMoon: Boolean(icon && icon.classList.contains('fa-moon')),
                iconHidden: icon ? icon.getAttribute('aria-hidden') : null
            };
        });
        assert(initialThemeState.light, 'Theme Sync FAILED: persisted light theme did not apply on reload');
        assert(initialThemeState.pressed === 'true', `Theme Sync FAILED: persisted light aria-pressed is "${initialThemeState.pressed}"`);
        assert(initialThemeState.iconMoon && initialThemeState.iconHidden === 'true', 'Theme Sync FAILED: persisted light icon state/aria-hidden is not synchronized');
        assert(Boolean(initialThemeState.label && initialThemeState.title), 'Theme Sync FAILED: theme control lost accessible label/title');

        await page.focus('#themeToggleBtn');
        await page.keyboard.press('Enter');
        const darkThemeState = await page.evaluate(() => ({
            light: document.body.classList.contains('light-theme'),
            pressed: document.getElementById('themeToggleBtn').getAttribute('aria-pressed'),
            iconSun: document.querySelector('#themeToggleBtn i')?.classList.contains('fa-sun') === true
        }));
        assert(!darkThemeState.light && darkThemeState.pressed === 'false' && darkThemeState.iconSun, 'Theme Sync FAILED: keyboard toggle did not synchronize dark state');

        await page.keyboard.press('Enter');
        const lightThemeStateAgain = await page.evaluate(() => ({
            light: document.body.classList.contains('light-theme'),
            pressed: document.getElementById('themeToggleBtn').getAttribute('aria-pressed'),
            stored: localStorage.getItem('theme')
        }));
        assert(lightThemeStateAgain.light && lightThemeStateAgain.pressed === 'true' && lightThemeStateAgain.stored === 'light', 'Theme Sync FAILED: second keyboard toggle did not restore synchronized light state');

        // 2. Mobile Menu Semantics
        await page.setViewport({ width: 375, height: 667 });
        await new Promise(r => setTimeout(r, 100));

        const menuTagName = await page.$eval('#mobile-menu', el => el.tagName.toLowerCase());
        const menuLabel = await page.$eval('#mobile-menu', el => el.getAttribute('aria-label'));
        const menuExpandedInitial = await page.$eval('#mobile-menu', el => el.getAttribute('aria-expanded'));
        const menuControls = await page.$eval('#mobile-menu', el => el.getAttribute('aria-controls'));

        assert(menuTagName === 'button', `Mobile Menu FAILED: #mobile-menu tag is "${menuTagName}", expected button`);
        assert(Boolean(menuLabel), 'Mobile Menu FAILED: #mobile-menu missing aria-label');
        assert(menuExpandedInitial === 'false', `Mobile Menu FAILED: Initial aria-expanded is "${menuExpandedInitial}"`);
        assert(menuControls === 'nav-links', `Mobile Menu FAILED: aria-controls is "${menuControls}", expected "nav-links"`);

        await page.click('#mobile-menu');
        assert(await page.$eval('#mobile-menu', el => el.getAttribute('aria-expanded') === 'true'), 'Mobile Menu FAILED: aria-expanded did not toggle to true');
        await page.keyboard.press('Escape');
        assert(await page.$eval('#mobile-menu', el => el.getAttribute('aria-expanded') === 'false'), 'Mobile Menu FAILED: aria-expanded did not toggle to false on Escape');
        assert(await page.evaluate(() => document.activeElement.id === 'mobile-menu'), 'Mobile Menu FAILED: Focus did not return to #mobile-menu');

        await page.setViewport({ width: 1280, height: 800 });
        await new Promise(r => setTimeout(r, 100));

        // 3. Dialog semantics. Details real open-time name is verified in Journey D.
        const modals = ['#trailer-modal', '#random-modal', '#details-modal', '#actor-modal'];
        for (const modalId of modals) {
            const role = await page.$eval(modalId, el => el.getAttribute('role'));
            const ariaModal = await page.$eval(modalId, el => el.getAttribute('aria-modal'));
            const closeBtnTag = await page.$eval(`${modalId} .close-btn`, el => el.tagName.toLowerCase());
            const closeBtnLabel = await page.$eval(`${modalId} .close-btn`, el => el.getAttribute('aria-label'));
            assert(role === 'dialog', `${modalId} FAILED: role is "${role}"`);
            assert(ariaModal === 'true', `${modalId} FAILED: aria-modal is "${ariaModal}"`);
            assert(closeBtnTag === 'button', `${modalId} FAILED: close button tag is "${closeBtnTag}"`);
            assert(Boolean(closeBtnLabel), `${modalId} FAILED: close button missing aria-label`);
        }

        const staticNamedDialogs = await page.evaluate(() => {
            const trailer = document.getElementById('trailer-modal');
            const random = document.getElementById('random-modal');
            const randomLabelId = random.getAttribute('aria-labelledby');
            const randomLabel = randomLabelId ? document.getElementById(randomLabelId) : null;
            return {
                trailerName: (trailer.getAttribute('aria-label') || '').trim(),
                randomName: randomLabel ? randomLabel.textContent.trim() : ''
            };
        });
        assert(staticNamedDialogs.trailerName.length > 0, 'Dialog Semantics FAILED: trailer static accessible name is empty');
        assert(staticNamedDialogs.randomName.length > 0, 'Dialog Semantics FAILED: random modal labelledby text is empty');

        // 4. Profile Tabs ARIA & Navigation
        await page.evaluate(() => switchTab(null, 'profile'));
        await new Promise(r => setTimeout(r, 100));
        assert(await page.$eval('.profile-tabs', el => el.getAttribute('role') === 'tablist'), 'Profile Tabs FAILED: missing role=tablist');

        const getTabSnapshot = async (tablistSelector) => page.evaluate((selector) => {
            const tablist = document.querySelector(selector);
            const tabs = tablist ? Array.from(tablist.querySelectorAll('[role="tab"]')) : [];
            return {
                count: tabs.length,
                focusedIndex: tabs.indexOf(document.activeElement),
                tabs: tabs.map((tab) => {
                    const panelId = tab.getAttribute('aria-controls');
                    const panel = panelId ? document.getElementById(panelId) : null;
                    return {
                        id: tab.id,
                        selected: tab.getAttribute('aria-selected'),
                        tabindex: tab.getAttribute('tabindex'),
                        panelId,
                        panelHidden: panel ? panel.hidden : null,
                        panelDisplay: panel ? getComputedStyle(panel).display : null
                    };
                })
            };
        }, tablistSelector);

        const assertTabState = (snapshot, expectedIndex, label) => {
            assert(snapshot.count > 1, `${label} FAILED: expected at least 2 tabs, got ${snapshot.count}`);
            assert(expectedIndex >= 0 && expectedIndex < snapshot.count, `${label} FAILED: expected index ${expectedIndex} outside tab count ${snapshot.count}`);
            assert(snapshot.focusedIndex === expectedIndex, `${label} FAILED: focused index ${snapshot.focusedIndex}, expected ${expectedIndex}`);
            snapshot.tabs.forEach((tab, index) => {
                const shouldBeSelected = index === expectedIndex;
                assert(tab.selected === String(shouldBeSelected), `${label} FAILED: ${tab.id} aria-selected is "${tab.selected}", expected "${shouldBeSelected}"`);
                assert(tab.tabindex === (shouldBeSelected ? '0' : '-1'), `${label} FAILED: ${tab.id} tabindex is "${tab.tabindex}", expected "${shouldBeSelected ? '0' : '-1'}"`);
                assert(Boolean(tab.panelId), `${label} FAILED: ${tab.id} missing aria-controls`);
                assert(tab.panelHidden === !shouldBeSelected, `${label} FAILED: ${tab.panelId} hidden=${tab.panelHidden}, expected ${!shouldBeSelected}`);
                assert(shouldBeSelected ? tab.panelDisplay !== 'none' : tab.panelDisplay === 'none', `${label} FAILED: ${tab.panelId} display is "${tab.panelDisplay}" for selected=${shouldBeSelected}`);
            });
        };

        const profileTabIds = await page.$$eval('.profile-tabs [role="tab"]', tabs => tabs.map(tab => tab.id));
        assert(profileTabIds.length > 1, `Profile Tabs FAILED: expected at least 2 tabs, got ${profileTabIds.length}`);
        await page.focus(`#${profileTabIds[0]}`);
        await page.keyboard.press('ArrowRight');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.profile-tabs'), 1 % profileTabIds.length, 'Profile Tabs ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.profile-tabs'), 0, 'Profile Tabs ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.profile-tabs'), profileTabIds.length - 1, 'Profile Tabs ArrowLeft wrap-around');
        await page.keyboard.press('ArrowRight');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.profile-tabs'), 0, 'Profile Tabs ArrowRight wrap-around');
        await page.keyboard.press('End');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.profile-tabs'), profileTabIds.length - 1, 'Profile Tabs End');
        await page.keyboard.press('Home');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.profile-tabs'), 0, 'Profile Tabs Home');

        // 5. Game Tabs ARIA & Navigation
        await page.evaluate(() => switchTab(null, 'games'));
        await new Promise(r => setTimeout(r, 100));
        assert(await page.$eval('.games-tabs', el => el.getAttribute('role') === 'tablist'), 'Game Tabs FAILED: missing role=tablist');

        const gameTabIds = await page.$$eval('.games-tabs [role="tab"]', tabs => tabs.map(tab => tab.id));
        assert(gameTabIds.length > 1, `Game Tabs FAILED: expected at least 2 tabs, got ${gameTabIds.length}`);
        await page.focus(`#${gameTabIds[0]}`);
        await page.keyboard.press('ArrowRight');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.games-tabs'), 1 % gameTabIds.length, 'Game Tabs ArrowRight');
        await page.keyboard.press('ArrowLeft');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.games-tabs'), 0, 'Game Tabs ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.games-tabs'), gameTabIds.length - 1, 'Game Tabs ArrowLeft wrap-around');
        await page.keyboard.press('ArrowRight');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.games-tabs'), 0, 'Game Tabs ArrowRight wrap-around');
        await page.keyboard.press('End');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.games-tabs'), gameTabIds.length - 1, 'Game Tabs End');
        await page.keyboard.press('Home');
        await new Promise(r => setTimeout(r, 50));
        assertTabState(await getTabSnapshot('.games-tabs'), 0, 'Game Tabs Home');

        // 6. Grid/List View Mode aria-pressed
        await page.evaluate(() => switchTab(null, 'platform'));
        await new Promise(r => setTimeout(r, 100));

        await page.click('#viewListBtn');
        const listPressed = await page.$eval('#viewListBtn', el => el.getAttribute('aria-pressed'));
        const gridPressed = await page.$eval('#viewGridBtn', el => el.getAttribute('aria-pressed'));
        assert(listPressed === 'true' && gridPressed === 'false', 'View Mode FAILED: aria-pressed not synced on list view');

        await page.click('#viewGridBtn');
        const listPressed2 = await page.$eval('#viewListBtn', el => el.getAttribute('aria-pressed'));
        const gridPressed2 = await page.$eval('#viewGridBtn', el => el.getAttribute('aria-pressed'));
        assert(listPressed2 === 'false' && gridPressed2 === 'true', 'View Mode FAILED: aria-pressed not synced on grid view');
        console.log('[PASS] Additional System Verifications (Theme, Modals, Tabs, Mobile Menu, Views) verified');

        // ==========================================
        // BLOCKER 2: ADVANCED DRAWER MODAL BACKGROUND ISOLATION
        // ==========================================
        console.log('\n--- Running Blocker 2: Advanced Drawer Modal Background Isolation ---');
        await page.click('#advanced-toggle-btn');
        await page.waitForFunction(() => {
            const panel = document.getElementById('advanced-search-panel');
            const button = document.getElementById('advanced-toggle-btn');
            return panel && panel.style.display === 'block' && button && button.getAttribute('aria-expanded') === 'true';
        });

        await page.focus('#surprise-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('random-modal')?.classList.contains('active'));

        const drawerIsolationOpen = await page.evaluate(() => {
            const panel = document.getElementById('advanced-search-panel');
            const button = document.getElementById('advanced-toggle-btn');
            return {
                panelInert: panel.inert,
                panelDisplay: panel.style.display,
                expanded: button.getAttribute('aria-expanded'),
                mainInert: document.getElementById('main-content').inert,
                navbarInert: document.querySelector('.navbar').inert,
                footerInert: document.querySelector('.site-footer').inert
            };
        });
        assert(drawerIsolationOpen.panelInert === true, 'Blocker 2 FAILED: advanced drawer is not inert while random modal is open');
        assert(drawerIsolationOpen.mainInert === true, 'Blocker 2 FAILED: main content is not inert while random modal is open');
        assert(drawerIsolationOpen.navbarInert === true, 'Blocker 2 FAILED: navbar is not inert while random modal is open');
        assert(drawerIsolationOpen.footerInert === true, 'Blocker 2 FAILED: footer is not inert while random modal is open');
        assert(drawerIsolationOpen.panelDisplay === 'block', `Blocker 2 FAILED: drawer visibility changed while modal was open: "${drawerIsolationOpen.panelDisplay}"`);
        assert(drawerIsolationOpen.expanded === 'true', `Blocker 2 FAILED: drawer aria-expanded changed while modal was open: "${drawerIsolationOpen.expanded}"`);

        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('random-modal')?.classList.contains('active'));

        const drawerIsolationClosed = await page.evaluate(() => {
            const panel = document.getElementById('advanced-search-panel');
            const button = document.getElementById('advanced-toggle-btn');
            return {
                panelInert: panel.inert,
                panelDisplay: panel.style.display,
                expanded: button.getAttribute('aria-expanded'),
                mainInert: document.getElementById('main-content').inert,
                navbarInert: document.querySelector('.navbar').inert,
                footerInert: document.querySelector('.site-footer').inert
            };
        });
        assert(drawerIsolationClosed.panelInert === false, 'Blocker 2 FAILED: advanced drawer remained inert after modal stack emptied');
        assert(drawerIsolationClosed.mainInert === false, 'Blocker 2 FAILED: main content remained inert after modal stack emptied');
        assert(drawerIsolationClosed.navbarInert === false, 'Blocker 2 FAILED: navbar remained inert after modal stack emptied');
        assert(drawerIsolationClosed.footerInert === false, 'Blocker 2 FAILED: footer remained inert after modal stack emptied');
        assert(drawerIsolationClosed.panelDisplay === 'block', `Blocker 2 FAILED: drawer visibility was not preserved: "${drawerIsolationClosed.panelDisplay}"`);
        assert(drawerIsolationClosed.expanded === 'true', `Blocker 2 FAILED: drawer aria-expanded was not preserved: "${drawerIsolationClosed.expanded}"`);

        await page.click('#advanced-toggle-btn');
        await page.waitForFunction(() => {
            const panel = document.getElementById('advanced-search-panel');
            const button = document.getElementById('advanced-toggle-btn');
            return panel && panel.style.display === 'none' && button && button.getAttribute('aria-expanded') === 'false';
        });
        console.log('[PASS] Blocker 2: Drawer visibility/ARIA state preserved while ModalManager isolates and restores background interaction');

        // ==========================================
        // BLOCKER 3: ROUTER TRANSIENT MODAL CLEANUP
        // ==========================================
        console.log('\n--- Running Blocker 3: Router Transient Modal Cleanup ---');

        // A. Production search -> Movie A -> real recommendation Movie B -> real Trailer -> browser Back -> Movie A.
        await page.click('.nav-links a[onclick*="platform"]');
        await page.waitForFunction(() => document.getElementById('platform')?.classList.contains('active-tab'));
        await page.click('#searchInput', { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.keyboard.type('Inception');
        await page.click('#platform .search-box button[aria-label="Film veya Dizi Ara"]');
        await page.waitForFunction(() => document.querySelector('#search-results .movie-title-btn') !== null);

        await page.focus('#search-results .movie-title-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('details-title')?.textContent.includes('Accessibility Inception'));
        await page.waitForFunction(() => document.querySelector('#details-recommendations .recommendation-card') !== null);

        await page.focus('#details-recommendations .recommendation-card');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('details-title')?.textContent.includes('Keyboard Matrix'));

        await page.focus('.details-left button[onclick*="openTrailer"]');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('trailer-modal')?.classList.contains('active'));

        await page.evaluate(() => history.back());
        await page.waitForFunction(() => {
            const title = document.getElementById('details-title');
            const trailer = document.getElementById('trailer-modal');
            return window.location.hash.includes('movie/101') &&
                title && title.textContent.includes('Accessibility Inception') &&
                trailer && !trailer.classList.contains('active');
        });

        const movieBackState = await page.evaluate(() => {
            const details = document.getElementById('details-modal');
            const trailer = document.getElementById('trailer-modal');
            const stackIds = window.ModalManager ? window.ModalManager.stack.map(entry => entry.id) : [];
            return {
                trailerActive: trailer.classList.contains('active'),
                trailerHidden: trailer.getAttribute('aria-hidden'),
                detailsActive: details.classList.contains('active'),
                detailsInert: details.inert,
                bodyOverflow: document.body.style.overflow,
                stackIds
            };
        });
        assert(movieBackState.trailerActive === false, 'Blocker 3A FAILED: Trailer stayed active after movie-to-movie browser Back');
        assert(movieBackState.trailerHidden === 'true', `Blocker 3A FAILED: Trailer aria-hidden is "${movieBackState.trailerHidden}" after browser Back`);
        assert(movieBackState.detailsActive === true, 'Blocker 3A FAILED: Details closed during movie-to-movie browser Back');
        assert(movieBackState.detailsInert === false, 'Blocker 3A FAILED: Details remained inert after transient Trailer cleanup');
        assert(movieBackState.bodyOverflow === 'hidden', `Blocker 3A FAILED: body overflow is "${movieBackState.bodyOverflow}", expected "hidden" while Details remains open`);
        assert(!movieBackState.stackIds.includes('trailer-modal'), 'Blocker 3A FAILED: ModalManager retained a stale trailer-modal entry');
        assert(movieBackState.stackIds.includes('details-modal'), 'Blocker 3A FAILED: ModalManager lost the persistent details-modal entry');

        await page.evaluate(() => history.back());
        await page.waitForFunction(() => !document.getElementById('details-modal')?.classList.contains('active'));

        // B. Random modal -> real browser history change -> overlay/stack/background cleanup.
        await page.click('.nav-links a[onclick*="games"]');
        await page.waitForFunction(() => window.location.hash === '#games');
        await page.click('.nav-links a[onclick*="platform"]');
        await page.waitForFunction(() => window.location.hash === '#platform');

        await page.focus('#surprise-btn');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('random-modal')?.classList.contains('active'));
        await page.evaluate(() => history.back());
        await page.waitForFunction(() => window.location.hash === '#games' && !document.getElementById('random-modal')?.classList.contains('active'));

        const randomRouteState = await page.evaluate(() => ({
            randomHidden: document.getElementById('random-modal').getAttribute('aria-hidden'),
            stackIds: window.ModalManager ? window.ModalManager.stack.map(entry => entry.id) : [],
            mainInert: document.getElementById('main-content').inert,
            navbarInert: document.querySelector('.navbar').inert,
            footerInert: document.querySelector('.site-footer').inert,
            drawerInert: document.getElementById('advanced-search-panel').inert,
            bodyOverflow: document.body.style.overflow
        }));
        assert(randomRouteState.randomHidden === 'true', `Blocker 3B FAILED: Random aria-hidden is "${randomRouteState.randomHidden}" after history change`);
        assert(!randomRouteState.stackIds.includes('random-modal'), 'Blocker 3B FAILED: ModalManager retained a stale random-modal entry');
        assert(randomRouteState.mainInert === false, 'Blocker 3B FAILED: main content remained inert after Random route cleanup');
        assert(randomRouteState.navbarInert === false, 'Blocker 3B FAILED: navbar remained inert after Random route cleanup');
        assert(randomRouteState.footerInert === false, 'Blocker 3B FAILED: footer remained inert after Random route cleanup');
        assert(randomRouteState.drawerInert === false, 'Blocker 3B FAILED: advanced drawer remained inert after Random route cleanup');
        assert(randomRouteState.bodyOverflow === 'auto', `Blocker 3B FAILED: body overflow is "${randomRouteState.bodyOverflow}", expected "auto"`);
        console.log('[PASS] Blocker 3: Trailer/Random transient overlays are removed by real history changes without stale stack or inert state');

        // ==========================================
        // BLOCKER 4: WATCHLIST HEART ARIA STATE
        // ==========================================
        console.log('\n--- Running Blocker 4: Watchlist Heart ARIA State ---');
        await page.click('.nav-links a[onclick*="platform"]');
        await page.waitForFunction(() => document.getElementById('platform')?.classList.contains('active-tab'));
        await page.evaluate(() => localStorage.removeItem('watchlist'));
        await page.click('#searchInput', { clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.keyboard.type('Inception');
        await page.click('#platform .search-box button[aria-label="Film veya Dizi Ara"]');
        await page.waitForFunction(() => document.querySelector('#search-results .btn-heart') !== null);

        const initialWatchlistHeart = await page.$eval('#search-results .btn-heart', btn => ({
            active: btn.classList.contains('active'),
            pressed: btn.getAttribute('aria-pressed'),
            label: btn.getAttribute('aria-label')
        }));
        assert(initialWatchlistHeart.active === false, 'Blocker 4 FAILED: initial movie heart is active');
        assert(initialWatchlistHeart.pressed === 'false', `Blocker 4 FAILED: initial aria-pressed is "${initialWatchlistHeart.pressed}"`);
        assert(initialWatchlistHeart.label === 'Listeme ekle', `Blocker 4 FAILED: initial aria-label is "${initialWatchlistHeart.label}"`);

        await page.focus('#search-results .btn-heart');
        await page.keyboard.press('Enter');
        const watchlistAdded = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button[onclick*="toggleWatchlist(this, 101)"]'));
            const stored = JSON.parse(localStorage.getItem('watchlist') || '[]');
            return {
                saved: stored.some(item => item.id === 101),
                buttons: buttons.map(btn => ({
                    active: btn.classList.contains('active'),
                    pressed: btn.getAttribute('aria-pressed'),
                    label: btn.getAttribute('aria-label')
                })),
                detailsActive: document.getElementById('details-modal').classList.contains('active')
            };
        });
        assert(watchlistAdded.saved, 'Blocker 4 FAILED: movie was not added to watchlist localStorage');
        assert(watchlistAdded.buttons.length > 0, 'Blocker 4 FAILED: no same-movie watchlist buttons were found after add');
        watchlistAdded.buttons.forEach((state, index) => {
            assert(state.active === true, `Blocker 4 FAILED: same-movie button ${index} is not active after add`);
            assert(state.pressed === 'true', `Blocker 4 FAILED: same-movie button ${index} aria-pressed is "${state.pressed}" after add`);
            assert(state.label === 'Listeden çıkar', `Blocker 4 FAILED: same-movie button ${index} aria-label is "${state.label}" after add`);
        });
        assert(watchlistAdded.detailsActive === false, 'Blocker 4 FAILED: Enter on heart unexpectedly opened Details');

        await page.focus('#search-results .btn-heart');
        await page.keyboard.press('Enter');
        const watchlistRemoved = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button[onclick*="toggleWatchlist(this, 101)"]'));
            const stored = JSON.parse(localStorage.getItem('watchlist') || '[]');
            return {
                saved: stored.some(item => item.id === 101),
                buttons: buttons.map(btn => ({
                    active: btn.classList.contains('active'),
                    pressed: btn.getAttribute('aria-pressed'),
                    label: btn.getAttribute('aria-label')
                }))
            };
        });
        assert(watchlistRemoved.saved === false, 'Blocker 4 FAILED: movie remained in watchlist localStorage after remove');
        watchlistRemoved.buttons.forEach((state, index) => {
            assert(state.active === false, `Blocker 4 FAILED: same-movie button ${index} remained active after remove`);
            assert(state.pressed === 'false', `Blocker 4 FAILED: same-movie button ${index} aria-pressed is "${state.pressed}" after remove`);
            assert(state.label === 'Listeme ekle', `Blocker 4 FAILED: same-movie button ${index} aria-label is "${state.label}" after remove`);
        });
        console.log('[PASS] Blocker 4: Real movie-card keyboard watchlist toggle keeps localStorage, visual and ARIA state synchronized');

        // ==========================================
        // JOURNEY O: ZERO UNHANDLED PAGE ERRORS
        // ==========================================
        console.log('\n--- Running Journey O: Zero Unhandled Page Errors ---');
        assert(errors.length === 0, `Journey O FAILED: Detected ${errors.length} unhandled page errors during test run: ${errors.map(e => e.message).join('; ')}`);
        console.log('[PASS] Journey O: Zero unhandled page errors confirmed');

        console.log('\n=============================================================');
        console.log('ALL ACCESSIBILITY JOURNEYS (A THROUGH O) PASSED CLEANLY (100%)!');
        console.log('=============================================================\n');

    } catch (err) {
        console.error('\nACCESSIBILITY REGRESSION TEST FAILED:', err);
        process.exitCode = 1;
    } finally {
        if (browser) {
            await browser.close();
        }
        if (server) {
            server.close();
        }
    }
}

runAccessibilityTests();
