const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function runTest() {
    console.log('Running PWA regression tests...');

    // 1. Manifest
    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    assert(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifestStr = fs.readFileSync(manifestPath, 'utf8');
    
    let manifest;
    try {
        manifest = JSON.parse(manifestStr);
    } catch (e) {
        assert(false, 'manifest.json must be valid JSON');
    }

    assert(manifest.name, 'manifest must have name');
    assert(manifest.short_name, 'manifest must have short_name');
    assert(manifest.start_url === '/', 'manifest start_url must be /');
    assert(manifest.display === 'standalone', 'manifest display must be standalone');
    assert(manifest.theme_color, 'manifest must have theme_color');
    assert(manifest.background_color, 'manifest must have background_color');
    assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest must have at least 2 icons');

    // 2. Icons
    const icon192 = manifest.icons.find(i => i.sizes === '192x192' && i.purpose === 'any');
    const icon512 = manifest.icons.find(i => i.sizes === '512x512' && i.purpose === 'any');
    const maskable192 = manifest.icons.find(i => i.sizes === '192x192' && i.purpose === 'maskable');
    const maskable512 = manifest.icons.find(i => i.sizes === '512x512' && i.purpose === 'maskable');

    assert(icon192, 'manifest must declare 192x192 any icon');
    assert(icon512, 'manifest must declare 512x512 any icon');
    assert(maskable192, 'manifest must declare 192x192 maskable icon');
    assert(maskable512, 'manifest must declare 512x512 maskable icon');

    const checkIcon = (iconObj) => {
        const fullPath = path.join(ROOT_DIR, iconObj.src);
        assert(fs.existsSync(fullPath), `Icon asset must exist at ${iconObj.src}`);
        
        // Simple PNG header check for dimensions (IHDR chunk)
        const buffer = fs.readFileSync(fullPath);
        assert(buffer.toString('hex', 0, 8) === '89504e470d0a1a0a', 'Icon must be a valid PNG');
        
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        const sizeStr = `${width}x${height}`;
        assert(sizeStr === iconObj.sizes, `Icon actual size ${sizeStr} must match declared size ${iconObj.sizes}`);
    };

    checkIcon(icon192);
    checkIcon(icon512);
    checkIcon(maskable192);
    checkIcon(maskable512);

    // 3. index.html
    const indexPath = path.join(ROOT_DIR, 'index.html');
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    assert(indexContent.includes('<link rel="manifest" href="manifest.json">'), 'index.html must have correct manifest link');
    assert(indexContent.includes('<meta name="theme-color"'), 'index.html must have theme-color meta tag');

    // 4. service-worker.js
    const swPath = path.join(ROOT_DIR, 'service-worker.js');
    const swContent = fs.readFileSync(swPath, 'utf8');
    
    assert(swContent.includes('filmimnerede-v92'), 'Service worker cache version must be bumped to v92');
    
    for (const icon of manifest.icons) {
        assert(swContent.includes(`/${icon.src}`), `Service worker must precache /${icon.src}`);
    }

    console.log('[PASS] PWA regression tests passed.');
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
