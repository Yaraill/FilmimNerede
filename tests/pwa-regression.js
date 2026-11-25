const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function checkServiceWorker(swContent, swPath) {
    const origin = 'https://filmimnerede.netlify.app';
    const listeners = new Map();

    class MockResponse {
        constructor(body, options) {
            this.body = body;
            Object.assign(this, options);
        }
    }

    const imaxPage = new MockResponse('IMAX');
    const indexPage = new MockResponse('FilmimNerede');
    const cachedResponses = new Map([
        ['/imax.html', imaxPage],
        ['/index.html', indexPage]
    ]);
    let precachedAssets = [];

    vm.runInNewContext(swContent, {
        self: {
            addEventListener: (type, listener) => listeners.set(type, listener),
            location: { origin },
            skipWaiting: () => {},
            clients: { claim: () => Promise.resolve() }
        },
        caches: {
            match: async key => cachedResponses.get(key),
            open: async name => {
                assert(name === 'filmimnerede-v133', 'Service worker cache name must be filmimnerede-v133');
                return {
                    addAll: async assets => { precachedAssets = assets; }
                };
            }
        },
        fetch: async () => { throw new Error('Offline'); },
        Response: MockResponse,
        URL
    }, { filename: swPath });

    let installPromise;
    listeners.get('install')({
        waitUntil: promise => { installPromise = promise; }
    });
    assert(installPromise, 'Service worker install must wait for precaching');
    await installPromise;
    assert(precachedAssets.includes('/imax.html'), 'Service worker must precache /imax.html');
    assert(precachedAssets.includes('/assets/placeholder.svg'), 'Service worker must precache /assets/placeholder.svg');

    function navigate(pathname) {
        let responsePromise;
        listeners.get('fetch')({
            request: { method: 'GET', mode: 'navigate', url: origin + pathname },
            respondWith: promise => { responsePromise = promise; }
        });
        return responsePromise;
    }

    const imaxPaths = ['/imax', '/imax/', '/imax.html'];
    for (const pathname of imaxPaths) {
        assert(await navigate(pathname) === imaxPage, `Offline ${pathname} must serve cached /imax.html`);
    }
    cachedResponses.delete('/imax.html');
    for (const pathname of imaxPaths) {
        assert(await navigate(pathname) === indexPage, `Offline ${pathname} must fall back to /index.html when /imax.html is missing`);
    }
    assert(await navigate('/nerede-izlerim') === indexPage, 'Offline /nerede-izlerim must serve cached /index.html');

    listeners.get('fetch')({
        request: { method: 'GET', mode: 'cors', url: origin + '/.netlify/functions/omdb' },
        respondWith: () => { throw new Error('Netlify function requests must bypass respondWith'); }
    });
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
    assert(indexContent.includes('<link rel="manifest" href="/manifest.json">'), 'index.html must have correct manifest link');
    assert(indexContent.includes('<meta name="theme-color"'), 'index.html must have theme-color meta tag');

    // 4. service-worker.js
    const swPath = path.join(ROOT_DIR, 'service-worker.js');
    const swContent = fs.readFileSync(swPath, 'utf8');
    
    const swVersionMatch = swContent.match(/filmimnerede-v(\d+)/);
    assert(swVersionMatch && Number(swVersionMatch[1]) >= 92, 'Service worker cache version must be at least v92');
    
    for (const icon of manifest.icons) {
        assert(swContent.includes(`/${icon.src}`), `Service worker must precache /${icon.src}`);
    }

    await checkServiceWorker(swContent, swPath);

    console.log('[PASS] PWA regression tests passed.');
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
