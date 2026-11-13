const dns = require('dns');
const https = require('https');

const TMDB_API_HOST = 'api.themoviedb.org';
const TMDB_IMAGE_HOST = 'image.tmdb.org';
const TMDB_TIMEOUT_MS = 9500;
const DOH_TIMEOUT_MS = 4000;
const DOH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ALLOWED_IMAGE_PATH_PATTERN =
    /^\/t\/p\/(?:original|w45|w92|w154|w185|w300|w342|w500|w780|w1280|h632)\/[A-Za-z0-9._-]+$/;

const ALLOWED_API_PATH_PREFIXES = [
    '/3/movie/',
    '/3/tv/',
    '/3/person/',
    '/3/search/',
    '/3/discover/',
    '/3/trending/',
    '/3/genre/',
    '/3/collection/',
    '/3/watch/providers/'
];

const IPV4_PATTERN =
    /^(?:\d{1,3}\.){3}\d{1,3}$/;

const dohIpCache = new Map();

function jsonResponse(statusCode, payload, extraHeaders = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...extraHeaders
        },
        body: JSON.stringify(payload)
    };
}

function parseIpv4Octets(ipAddress) {
    if (typeof ipAddress !== 'string') {
        return null;
    }

    const trimmed = ipAddress.trim();
    if (!IPV4_PATTERN.test(trimmed)) {
        return null;
    }

    const parts = trimmed.split('.').map(Number);
    if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return null;
    }

    return parts;
}

function isNonPublicIpv4Octets(parts) {
    const [a, b] = parts;
    return (
        a === 0 || // 0/8
        a === 10 || // 10/8 (RFC 1918)
        (a === 100 && b >= 64 && b <= 127) || // 100.64/10 (CGNAT)
        a === 127 || // 127/8 (Loopback)
        (a === 169 && b === 254) || // 169.254/16 (Link-local)
        (a === 172 && b >= 16 && b <= 31) || // 172.16/12 (RFC 1918)
        (a === 192 && b === 168) || // 192.168/16 (RFC 1918)
        a >= 224 // 224/4 (Multicast) ve 240/4+ (Ayrılmış)
    );
}

function isSinkholeIp(ipAddress) {
    if (typeof ipAddress !== 'string') {
        return true;
    }

    const normalized = ipAddress.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    if (
        normalized === '::1' ||
        normalized === '::' ||
        /^(?:fc|fd)[0-9a-f]{2}:/.test(normalized) ||
        /^fe[89ab][0-9a-f]:/.test(normalized)
    ) {
        return true;
    }

    const ipv4Candidate = normalized.startsWith('::ffff:')
        ? normalized.slice(7)
        : normalized;

    if (IPV4_PATTERN.test(ipv4Candidate)) {
        const octets = parseIpv4Octets(ipv4Candidate);
        return !octets || isNonPublicIpv4Octets(octets);
    }

    return false;
}

function isValidPublicIpv4(ipAddress) {
    const octets = parseIpv4Octets(ipAddress);
    if (!octets) {
        return false;
    }

    return !isNonPublicIpv4Octets(octets);
}

function validateTmdbTargetAndPath(rawTarget, rawPath) {
    const target =
        typeof rawTarget === 'string' && rawTarget.trim()
            ? rawTarget.trim().toLowerCase()
            : 'api';

    if (target !== 'api' && target !== 'image') {
        return { valid: false, error: 'Geçersiz hedef parametresi.' };
    }

    if (typeof rawPath !== 'string' || !rawPath.trim()) {
        return { valid: false, error: 'Eksik yol parametresi.' };
    }

    const trimmedPath = rawPath.trim();
    if (
        !trimmedPath.startsWith('/') ||
        trimmedPath.startsWith('//') ||
        trimmedPath.includes('\\')
    ) {
        return { valid: false, error: 'Geçersiz TMDB yolu.' };
    }

    const expectedHost = target === 'image' ? TMDB_IMAGE_HOST : TMDB_API_HOST;
    const expectedOrigin = `https://${expectedHost}`;

    let parsed;
    try {
        parsed = new URL(trimmedPath, expectedOrigin);
    } catch (_) {
        return { valid: false, error: 'Geçersiz TMDB URL yapısı.' };
    }

    let decodedPathname;
    try {
        decodedPathname = decodeURIComponent(parsed.pathname);
    } catch (_) {
        return { valid: false, error: 'Geçersiz TMDB yol kodlaması.' };
    }

    if (
        parsed.origin !== expectedOrigin ||
        parsed.username ||
        parsed.password ||
        parsed.pathname.includes('..') ||
        decodedPathname.includes('..') ||
        decodedPathname.includes('\\')
    ) {
        return { valid: false, error: 'Geçersiz TMDB konumu.' };
    }

    if (target === 'api') {
        if (!parsed.pathname.startsWith('/3/') || parsed.pathname.length <= 3) {
            return { valid: false, error: 'Yalnızca TMDB /3/ uç noktaları desteklenir.' };
        }

        const isAllowedApiPath = ALLOWED_API_PATH_PREFIXES.some(
            prefix => parsed.pathname.startsWith(prefix) && parsed.pathname.length > prefix.length
        );
        if (!isAllowedApiPath) {
            return { valid: false, error: 'Desteklenmeyen TMDB uç noktası.' };
        }

        return {
            valid: true,
            target: 'api',
            host: TMDB_API_HOST,
            upstreamPath: `${parsed.pathname}${parsed.search}`,
            upstreamUrl: `${expectedOrigin}${parsed.pathname}${parsed.search}`
        };
    }

    if (!ALLOWED_IMAGE_PATH_PATTERN.test(parsed.pathname)) {
        return { valid: false, error: 'Geçersiz TMDB görsel yolu.' };
    }

    return {
        valid: true,
        target: 'image',
        host: TMDB_IMAGE_HOST,
        upstreamPath: parsed.pathname,
        upstreamUrl: `${expectedOrigin}${parsed.pathname}`
    };
}

async function resolveUpstreamIpViaDoh(hostname, fetchImpl = globalThis.fetch) {
    const cached = dohIpCache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.ip;
    }

    const dohProviders = [
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`
    ];

    for (const dohUrl of dohProviders) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DOH_TIMEOUT_MS);

        try {
            const res = await fetchImpl(dohUrl, {
                method: 'GET',
                headers: { Accept: 'application/dns-json' },
                signal: controller.signal
            });

            if (!res || !res.ok) {
                continue;
            }

            const payload = await res.json();
            const answers = Array.isArray(payload?.Answer) ? payload.Answer : [];
            const record = answers.find(entry => entry && entry.type === 1 && isValidPublicIpv4(entry.data));

            if (record) {
                const ttlSeconds = Number.isFinite(Number(record.TTL))
                    ? Math.max(30, Math.min(300, Number(record.TTL)))
                    : 60;
                const resolvedIp = record.data.trim();
                dohIpCache.set(hostname, {
                    ip: resolvedIp,
                    expiresAt: Date.now() + ttlSeconds * 1000
                });
                return resolvedIp;
            }
        } catch (_) {
            // Sonraki DoH sağlayıcısını dene.
        } finally {
            clearTimeout(timeoutId);
        }
    }

    return null;
}

async function shouldUseDohFallback(hostname, lookupImpl = dns.promises.lookup) {
    try {
        const entries = await lookupImpl(hostname, { all: true });
        if (!Array.isArray(entries) || entries.length === 0) {
            return true;
        }
        return !entries.some(entry => entry && !isSinkholeIp(entry.address));
    } catch (_) {
        return true;
    }
}

function requestViaResolvedIp(ipAddress, targetHost, upstreamPath, acceptHeader, maxBytes, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timerId = null;

        const done = (fn, value) => {
            if (settled) return;
            settled = true;
            if (timerId) {
                clearTimeout(timerId);
                timerId = null;
            }
            fn(value);
        };

        const req = https.request(
            {
                hostname: ipAddress,
                port: 443,
                path: upstreamPath,
                method: 'GET',
                servername: targetHost,
                headers: {
                    Host: targetHost,
                    Accept: acceptHeader,
                    'Accept-Encoding': 'identity'
                }
            },
            res => {
                const chunks = [];
                let totalBytes = 0;

                res.on('data', chunk => {
                    totalBytes += chunk.length;
                    if (totalBytes > maxBytes) {
                        req.destroy(new Error('Upstream response size limit exceeded'));
                        return;
                    }
                    chunks.push(chunk);
                });

                res.on('end', () => {
                    done(resolve, {
                        statusCode: res.statusCode || 502,
                        contentType: String(res.headers['content-type'] || ''),
                        bodyBuffer: Buffer.concat(chunks)
                    });
                });

                res.on('error', err => done(reject, err));
            }
        );

        timerId = setTimeout(() => {
            const timeoutErr = new Error('TMDB upstream request timed out');
            timeoutErr.name = 'AbortError';
            req.destroy(timeoutErr);
        }, timeoutMs);

        req.on('error', err => done(reject, err));
        req.end();
    });
}

async function fetchUpstreamWithFallback(targetSpec, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const lookupImpl = options.lookupImpl || dns.promises.lookup;
    const dohResolver = options.dohResolver || ((host) => resolveUpstreamIpViaDoh(host, fetchImpl));
    const directIpRequest = options.directIpRequest || requestViaResolvedIp;

    const acceptHeader = targetSpec.target === 'image' ? 'image/*' : 'application/json';
    const maxBytes = targetSpec.target === 'image' ? MAX_IMAGE_BYTES : 2 * 1024 * 1024;

    const forceDoh = await shouldUseDohFallback(targetSpec.host, lookupImpl);
    if (!forceDoh) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);

        try {
            const response = await fetchImpl(targetSpec.upstreamUrl, {
                method: 'GET',
                headers: { Accept: acceptHeader },
                signal: controller.signal
            });
            const arrayBuffer = await response.arrayBuffer();
            const bodyBuffer = Buffer.from(arrayBuffer);
            if (bodyBuffer.length > maxBytes) {
                throw new Error('Upstream response size limit exceeded');
            }

            return {
                statusCode: response.status,
                contentType: String(response.headers?.get?.('content-type') || ''),
                bodyBuffer
            };
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw error;
            }
            // Standart bağlantı başarısızsa DoH IP fallback dene.
        } finally {
            clearTimeout(timeoutId);
        }
    }

    const dohIp = await dohResolver(targetSpec.host);
    if (!dohIp || !isValidPublicIpv4(dohIp)) {
        throw new Error(`TMDB DNS resolution failed for ${targetSpec.host}`);
    }

    return directIpRequest(
        dohIp,
        targetSpec.host,
        targetSpec.upstreamPath,
        acceptHeader,
        maxBytes,
        TMDB_TIMEOUT_MS
    );
}

async function handler(event = {}, deps = {}) {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method !== 'GET') {
        return jsonResponse(405, { error: 'Method Not Allowed' }, { Allow: 'GET' });
    }

    const queryParams = event.queryStringParameters || {};
    if (queryParams.probe === '1') {
        return jsonResponse(
            200,
            { ok: true, service: 'tmdb-proxy' },
            { 'Cache-Control': 'no-store' }
        );
    }

    const validation = validateTmdbTargetAndPath(queryParams.target, queryParams.path);
    if (!validation.valid) {
        return jsonResponse(400, { error: validation.error });
    }

    try {
        const upstream = await fetchUpstreamWithFallback(validation, deps);

        if (validation.target === 'image') {
            if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
                return jsonResponse(
                    upstream.statusCode === 404 ? 404 : 502,
                    { error: 'TMDB görseli alınamadı.' }
                );
            }

            const safeMime = upstream.contentType.split(';')[0].trim().toLowerCase();
            if (!safeMime.startsWith('image/')) {
                return jsonResponse(502, { error: 'Geçersiz görsel yanıtı.' });
            }

            return {
                statusCode: 200,
                headers: {
                    'Content-Type': safeMime,
                    'Cache-Control': 'public, max-age=86400, s-maxage=604800'
                },
                body: upstream.bodyBuffer.toString('base64'),
                isBase64Encoded: true
            };
        }

        const responseHeaders = {
            'Content-Type': 'application/json; charset=utf-8'
        };
        if (upstream.statusCode >= 200 && upstream.statusCode < 300) {
            responseHeaders['Cache-Control'] = 'public, max-age=120, s-maxage=300';
        }

        return {
            statusCode: upstream.statusCode,
            headers: responseHeaders,
            body: upstream.bodyBuffer.toString('utf8')
        };
    } catch (error) {
        if (error?.name === 'AbortError') {
            return jsonResponse(504, { error: 'TMDB isteği zaman aşımına uğradı.' });
        }

        console.error('TMDB proxy upstream error:', error);
        return jsonResponse(502, { error: 'TMDB isteği başarısız oldu.' });
    }
}

module.exports = {
    handler,
    validateTmdbTargetAndPath,
    isSinkholeIp,
    isValidPublicIpv4,
    resolveUpstreamIpViaDoh,
    shouldUseDohFallback,
    _resetDohCache: () => dohIpCache.clear()
};
