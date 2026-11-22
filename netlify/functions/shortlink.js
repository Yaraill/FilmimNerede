const {
    SHORTLINK_MAX_BODY_BYTES,
    SHORTLINK_ID_PATTERN,
    normalizeShortlinkPayload,
    expandShortlinkRecord,
    getShortlinkStore,
    saveIdempotentShortlink,
    _setStoreForTests
} = require('./lib/shortlink-store');

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const SHORTLINK_MAX_BASE64_LENGTH = Math.ceil(SHORTLINK_MAX_BODY_BYTES * 4 / 3) + 64;
const SHORTLINK_CACHE_HEADERS = {
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    'Netlify-CDN-Cache-Control': 'public, s-maxage=2592000, durable'
};

const MAX_RATE_LIMIT_CLIENTS = 5000;
const DEFAULT_RATE_LIMIT = {
    windowMs: 60_000,
    now: Date.now,
    limits: { write: 15, read: 120 }
};
const clientWindows = new Map();
let rateLimit = DEFAULT_RATE_LIMIT;

function _resetRateLimit(options = {}) {
    clientWindows.clear();
    rateLimit = {
        ...DEFAULT_RATE_LIMIT,
        ...options,
        limits: { ...DEFAULT_RATE_LIMIT.limits, ...options?.limits }
    };
}

function getClientKey(headers) {
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
    );
    return normalizedHeaders['x-nf-client-connection-ip']?.trim() ||
        normalizedHeaders['x-forwarded-for']?.split(',', 1)[0]?.trim() ||
        'unknown';
}

function recordRequest(bucket, clientKey) {
    const now = rateLimit.now();
    const key = `${bucket}:${clientKey}`;
    let window = clientWindows.get(key);

    if (window && window.expiresAt <= now) {
        clientWindows.delete(key);
        window = undefined;
    }

    if (!window) {
        if (clientWindows.size >= MAX_RATE_LIMIT_CLIENTS) {
            for (const [entryKey, entry] of clientWindows) {
                if (entry.expiresAt <= now) {
                    clientWindows.delete(entryKey);
                }
            }
            if (clientWindows.size >= MAX_RATE_LIMIT_CLIENTS) {
                clientWindows.delete(clientWindows.keys().next().value);
            }
        }

        window = { count: 0, expiresAt: now + rateLimit.windowMs };
        clientWindows.set(key, window);
    }

    if (window.count >= rateLimit.limits[bucket]) {
        return Math.ceil((window.expiresAt - now) / 1000);
    }

    window.count += 1;
    return 0;
}

function jsonResponse(statusCode, payload, extraHeaders = NO_STORE_HEADERS) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...extraHeaders
        },
        body: JSON.stringify(payload)
    };
}

async function handlePost(event) {
    const body = typeof event.body === 'string' ? event.body : '';
    if (event.isBase64Encoded && body.length > SHORTLINK_MAX_BASE64_LENGTH) {
        return jsonResponse(413, { error: 'İstek gövdesi çok büyük.' });
    }
    const rawText = event.isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
    if (Buffer.byteLength(rawText, 'utf8') > SHORTLINK_MAX_BODY_BYTES) {
        return jsonResponse(413, { error: 'İstek gövdesi çok büyük.' });
    }
    if (!rawText.trim()) {
        return jsonResponse(400, { error: 'İstek gövdesi boş.' });
    }

    let rawBody;
    try {
        rawBody = JSON.parse(rawText);
    } catch {
        return jsonResponse(400, { error: 'Geçersiz JSON verisi.' });
    }

    const validation = normalizeShortlinkPayload(rawBody);
    if (!validation.ok) {
        return jsonResponse(validation.statusCode, { error: validation.error });
    }

    const store = getShortlinkStore(event);
    const { id, created } = await saveIdempotentShortlink(store, validation.record);
    return jsonResponse(created ? 201 : 200, { id, route: `s/${id}` });
}

async function handleGet(event) {
    const id = event.queryStringParameters?.id;
    if (typeof id !== 'string' || !SHORTLINK_ID_PATTERN.test(id)) {
        return jsonResponse(400, { error: 'Geçersiz kısa bağlantı kimliği.' });
    }

    const store = getShortlinkStore(event);
    let record;
    try {
        record = await store.get(id);
    } catch (error) {
        if (!(error instanceof SyntaxError)) {
            throw error;
        }
    }

    const payload = expandShortlinkRecord(id, record);
    if (!payload) {
        return jsonResponse(404, { error: 'Kısa bağlantı bulunamadı.' });
    }

    return jsonResponse(200, payload, SHORTLINK_CACHE_HEADERS);
}

exports._resetRateLimit = _resetRateLimit;
exports._setStoreForTests = _setStoreForTests;

exports.handler = async function handler(event = {}) {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
        return jsonResponse(405, { error: 'Method Not Allowed' }, { ...NO_STORE_HEADERS, Allow: 'GET, POST' });
    }

    const bucket = method === 'POST' ? 'write' : 'read';
    const retryAfter = recordRequest(bucket, getClientKey(event.headers));
    if (retryAfter > 0) {
        return jsonResponse(
            429,
            { error: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.' },
            { ...NO_STORE_HEADERS, 'Retry-After': String(retryAfter) }
        );
    }

    try {
        if (method === 'POST') {
            return await handlePost(event);
        }
        return await handleGet(event);
    } catch {
        return jsonResponse(503, { error: 'Kısa bağlantı servisine şu anda ulaşılamıyor.' });
    }
};
