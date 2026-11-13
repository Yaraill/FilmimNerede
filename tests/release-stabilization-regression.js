const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT_DIR = path.resolve(__dirname, '..');

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[FAIL] ${message}`);
    }
}

async function runTest() {
    console.log('Running Release Stabilization Regression Tests...');

    // 1. Actor mobile CSS contract
    const indexHTML = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const styleCSS = fs.readFileSync(path.join(ROOT_DIR, 'style.css'), 'utf8');

    assert(indexHTML.includes('class="actor-header"'), 'actor-header class must exist in index.html');
    assert(!indexHTML.includes('<div class="actor-header" style="display: flex;'), 'inline display: flex must be removed from actor-header');
    
    assert(styleCSS.includes('.actor-header {'), 'actor-header must be styled in style.css');
    assert(styleCSS.includes('flex-direction: column'), 'actor-header must have flex-direction column rule for mobile');

    // 2. Placeholder
    const jsFiles = [
        'js/runtime/actor.js',
        'js/runtime/home.js',
        'js/runtime/movie.js',
        'js/runtime/profile.js',
        'js/runtime/providers.js',
        'js/runtime/search.js'
    ];
    
    for (const jsFile of jsFiles) {
        const content = fs.readFileSync(path.join(ROOT_DIR, jsFile), 'utf8');
        assert(!content.includes('via.placeholder.com'), `via.placeholder.com must be removed from ${jsFile}`);
        assert(content.includes('assets/placeholder.svg'), `assets/placeholder.svg must be used in ${jsFile}`);
    }

    assert(fs.existsSync(path.join(ROOT_DIR, 'assets', 'placeholder.svg')), 'assets/placeholder.svg must exist');

    // 3. PWA
    assert(indexHTML.includes('<link rel="apple-touch-icon" href="assets/icons/icon-192.png">'), 'apple-touch-icon link must exist in index.html');
    assert(fs.existsSync(path.join(ROOT_DIR, 'assets', 'icons', 'icon-192.png')), 'icon-192.png must exist');

    // 4. Dead legacy code cleanup (Section 9.5) & behavioral delegate check
    const miscJS = fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/misc.js'), 'utf8');
    const deadSelectors = [
        '#discover-type',
        'discover-type',
        'discover-year-min',
        'discover-year-max',
        'discover-rating',
        'discover-genre-cb'
    ];
    for (const selector of deadSelectors) {
        assert(!miscJS.includes(selector), `Dead legacy selector "${selector}" must be removed from js/runtime/misc.js`);
    }

    let toggledCount = 0;
    let appliedCount = 0;
    const miscContext = vm.createContext({
        window: {
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        document: {
            getElementById: () => null,
            querySelectorAll: () => [],
            querySelector: () => null,
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        console,
        setTimeout,
        clearTimeout,
        applyPlatformFilters: async () => {
            appliedCount += 1;
        }
    });
    vm.runInContext(miscJS, miscContext);
    const originalToggleAdvancedSearch = miscContext.toggleAdvancedSearch;
    miscContext.toggleAdvancedSearch = (...args) => {
        toggledCount += 1;
        return originalToggleAdvancedSearch(...args);
    };
    await miscContext.executeDiscover();
    assert(toggledCount === 1 && appliedCount === 1, 'executeDiscover() must delegate cleanly to toggleAdvancedSearch and applyPlatformFilters');

    // 5. Composite media key contract & TR region enforcement (B01, B03)
    const securityJS = fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/security.js'), 'utf8');
    const providersJS = fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/providers.js'), 'utf8');
    const platformJS = fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/platform.js'), 'utf8');

    for (const fnName of ['getMediaKey', 'getCachedMedia', 'setCachedMedia']) {
        assert(securityJS.includes(`function ${fnName}(`), `${fnName} must be defined in js/runtime/security.js`);
    }
    assert(!providersJS.includes('watch_region=US'), 'providers.js must not override TR region with watch_region=US');
    assert(!platformJS.includes('watch_region=US'), 'platform.js must not override TR region with watch_region=US');

    const secContext = vm.createContext({
        window: { movieCache: {} },
        localStorage: {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {}
        },
        console
    });
    vm.runInContext(securityJS, secContext);
    assert(secContext.getMediaKey('movie', 42) === 'movie:42', 'getMediaKey must format movie composite key');
    assert(secContext.getMediaKey('tv', 42) === 'tv:42', 'getMediaKey must format tv composite key');
    secContext.setCachedMedia({ id: 42, title: 'Film 42', media_type: 'movie' }, 'movie');
    secContext.setCachedMedia({ id: 42, name: 'Dizi 42', media_type: 'tv' }, 'tv');
    const cachedMovie42 = secContext.getCachedMedia(42, 'movie');
    const cachedTv42 = secContext.getCachedMedia(42, 'tv');
    assert(cachedMovie42 && cachedMovie42.title === 'Film 42', 'getCachedMedia(42, movie) must return movie entry');
    assert(cachedTv42 && cachedTv42.name === 'Dizi 42', 'getCachedMedia(42, tv) must return tv entry without collision');

    // 6. UX contracts (UX07-UX13)
    const sharedUiJS = fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/shared-ui.js'), 'utf8');
    const actorJS = fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/actor.js'), 'utf8');

    assert(sharedUiJS.includes('card-user-rating'), 'shared-ui.js must include .card-user-rating badge markup');
    assert(sharedUiJS.includes('function getSizedTmdbImageBase('), 'shared-ui.js must define getSizedTmdbImageBase helper');
    assert(actorJS.includes('actor-bio-collapsed') && actorJS.includes('btn-bio-toggle'), 'actor.js must support actor-bio-collapsed and btn-bio-toggle');
    assert(indexHTML.includes('class="imax-theaters-grid"') && indexHTML.includes('class="imax-city-card"'), 'index.html must include accessible IMAX grid and city cards');
    assert(styleCSS.includes('.imax-theaters-grid') && styleCSS.includes('.imax-city-card'), 'style.css must style .imax-theaters-grid and .imax-city-card');

    // 7. Performance & network optimization contracts (Section 7.2-7.5)
    const movieJS = fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/movie.js'), 'utf8');
    const homeJS = fs.readFileSync(path.join(ROOT_DIR, 'js/runtime/home.js'), 'utf8');

    assert(providersJS.includes('PROVIDER_MAX_CONCURRENT_REQUESTS'), 'providers.js must enforce PROVIDER_MAX_CONCURRENT_REQUESTS');
    assert(providersJS.includes('PROVIDER_CACHE_TTL_MS') && providersJS.includes('PROVIDER_CACHE_MAX_SIZE'), 'providers.js must enforce cache TTL and max size');
    assert(movieJS.includes('function fetchExtendedMediaDetail('), 'movie.js must define fetchExtendedMediaDetail');
    assert(
        movieJS.includes("const MOVIE_DETAIL_APPEND_PARAM = 'videos,credits,recommendations,external_ids';") &&
        movieJS.includes('append_to_response=${MOVIE_DETAIL_APPEND_PARAM}'),
        'movie.js must use unified append_to_response=videos,credits,recommendations,external_ids'
    );
    assert(
        homeJS.includes('HOME_INITIAL_COLLECTION_COUNT') && homeJS.includes('HOME_COLLECTION_CONCURRENCY'),
        'home.js must stage curated collections with HOME_INITIAL_COLLECTION_COUNT and HOME_COLLECTION_CONCURRENCY'
    );

    console.log('[PASS] All Release Stabilization Regression Tests passed.');
}

runTest().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
