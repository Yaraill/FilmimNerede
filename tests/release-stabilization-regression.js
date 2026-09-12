const fs = require('fs');
const path = require('path');

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


    console.log('[PASS] All Release Stabilization Regression Tests passed.');
}

runTest().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
