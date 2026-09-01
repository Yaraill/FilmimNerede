const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT_DIR = path.resolve(__dirname, '..');

const activeScripts = [
    'js/runtime/config.js',
    'js/runtime/security.js',
    'js/runtime/state.js',
    'js/runtime/router.js',
    'js/runtime/shared-ui.js',
    'js/runtime/providers.js',
    'js/runtime/platform.js',
    'js/runtime/search.js',
    'js/runtime/movie.js',
    'js/runtime/actor.js',
    'js/runtime/home.js',
    'js/runtime/profile.js',
    'js/runtime/misc.js',
    'app.js',
    'service-worker.js'
];

const inactiveScripts = [
    'js/api.js',
    'js/main.js',
    'js/state.js',
    'js/ui.js'
];

function assert(condition, message) {
    if (!condition) {
        console.error(`[FAIL] ${message}`);
        process.exit(1);
    }
}

try {
    console.log('Running D12A static integrity tests...');

    // 1. Syntax-check all active scripts
    for (const script of activeScripts) {
        const fullPath = path.join(ROOT_DIR, script);
        try {
            execSync(`node --check "${fullPath}"`, { stdio: 'ignore' });
            console.log(`[PASS] Syntax check: ${script}`);
        } catch (e) {
            assert(false, `Syntax check failed for ${script}`);
        }
    }

    // 2. Parse index.html
    const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const dom = new JSDOM(indexHtml);
    const document = dom.window.document;

    const detailsModals = document.querySelectorAll('#details-modal');
    assert(detailsModals.length === 1, `Expected exactly 1 #details-modal, found ${detailsModals.length}`);
    console.log('[PASS] #details-modal count is 1');

    const randomModals = document.querySelectorAll('#random-modal');
    assert(randomModals.length === 1, `Expected exactly 1 #random-modal, found ${randomModals.length}`);
    console.log('[PASS] #random-modal count is 1');

    // 3. Assert inactive scripts are not referenced
    const scriptTags = Array.from(document.querySelectorAll('script')).map(s => s.getAttribute('src')).filter(Boolean).filter(src => !src.startsWith('http'));
    for (const script of inactiveScripts) {
        const isReferenced = scriptTags.some(src => src === script || src.startsWith(script + '?'));
        assert(!isReferenced, `Inactive script ${script} should not be referenced in index.html`);
        console.log(`[PASS] Inactive script ${script} is not referenced`);
    }

    // 4. Assert active app scripts are referenced exactly once
    const appScripts = activeScripts.filter(s => s !== 'service-worker.js');
    const scriptSrcWithoutVersion = scriptTags.map(src => src.split('?')[0]);
    
    for (const script of appScripts) {
        const count = scriptSrcWithoutVersion.filter(src => src === script).length;
        assert(count === 1, `Active script ${script} should be referenced exactly once, found ${count}`);
        console.log(`[PASS] Active script ${script} is referenced exactly once`);
    }

    // 5. Read service-worker.js and assert cache matching
    const swContent = fs.readFileSync(path.join(ROOT_DIR, 'service-worker.js'), 'utf8');
    
    for (const tag of scriptTags) {
        // Tag is exactly what's in index.html, e.g. "js/runtime/actor.js?v=7"
        // In SW, it is typically "/js/runtime/actor.js?v=7" or similar
        const expectedInSW = `/${tag}`;
        assert(swContent.includes(expectedInSW), `Service worker is missing cache entry for ${expectedInSW}`);
        console.log(`[PASS] SW contains entry for ${expectedInSW}`);
    }

    // 6. Assert service-worker cache name matches filmimnerede-v<integer>
    const cacheNameMatch = swContent.match(/const CACHE_NAME = 'filmimnerede-v(\d+)';/);
    assert(cacheNameMatch && cacheNameMatch[1], `Service worker CACHE_NAME must match filmimnerede-v<integer>`);
    console.log(`[PASS] SW CACHE_NAME format is correct: filmimnerede-v${cacheNameMatch[1]}`);

    console.log('All static smoke tests PASSED!');
    process.exit(0);

} catch (e) {
    console.error(`[FAIL] Unexpected error during static test: ${e.message}`);
    process.exit(1);
}
