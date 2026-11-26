const {
    PROFILE_SYNC_MAX_BODY_BYTES,
    validateProfileSyncBackup,
    getProfileSyncStore,
    saveOneTimeSyncRecord,
    redeemOneTimeSyncRecord,
    _setStoreForTests
} = require('./lib/profile-sync-store');

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };
const MAX_RATE_LIMIT_CLIENTS = 5000;
const DEFAULT_RATE_LIMIT = {
    windowMs: 60_000,
    now: Date.now,
    limits: { create: 5, redeem: 10 }
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
        Object.entries(headers ?? {}).map(([name, value]) => [
            name.toLowerCase(),
            typeof value === 'string' ? value : ''
        ])
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
                if (entry.expiresAt <= now) clientWindows.delete(entryKey);
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
    if (event.isBase64Encoded && body.length > Math.ceil(PROFILE_SYNC_MAX_BODY_BYTES * 4 / 3) + 64) {
        return jsonResponse(413, { error: 'İstek gövdesi çok büyük.' });
    }

    let rawText;
    if (event.isBase64Encoded) {
        rawText = Buffer.from(body, 'base64').toString('utf8');
    } else {
        if (Buffer.byteLength(body, 'utf8') > PROFILE_SYNC_MAX_BODY_BYTES) {
            return jsonResponse(413, { error: 'İstek gövdesi çok büyük.' });
        }
        rawText = body;
    }
    if (Buffer.byteLength(rawText, 'utf8') > PROFILE_SYNC_MAX_BODY_BYTES) {
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

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
        return jsonResponse(400, { error: 'Geçersiz istek verisi.' });
    }
    const action = rawBody.action;
    if (action !== 'create' && action !== 'redeem') {
        return jsonResponse(400, { error: 'Geçersiz işlem.' });
    }

    const retryAfter = recordRequest(action, getClientKey(event.headers));
    if (retryAfter > 0) {
        return jsonResponse(
            429,
            { error: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.' },
            { ...NO_STORE_HEADERS, 'Retry-After': String(retryAfter) }
        );
    }

    if (action === 'create') {
        const validation = validateProfileSyncBackup(rawBody.backup);
        if (!validation.ok) {
            return jsonResponse(validation.statusCode, { error: validation.error });
        }
        const result = await saveOneTimeSyncRecord(getProfileSyncStore(event), validation.backup);
        return jsonResponse(201, {
            code: result.code,
            formattedCode: result.formattedCode,
            expiresAt: result.expiresAt,
            ttlSeconds: result.ttlSeconds
        });
    }

    const result = await redeemOneTimeSyncRecord(getProfileSyncStore(event), rawBody.code);
    if (!result.ok) {
        return jsonResponse(result.statusCode, { error: result.error });
    }
    return jsonResponse(200, { backup: result.backup });
}

exports._resetRateLimit = _resetRateLimit;
exports._setStoreForTests = _setStoreForTests;
exports.handler = async function handler(event = {}) {
    const method = String(event.httpMethod || '').toUpperCase();
    if (method !== 'POST') {
        return jsonResponse(405, { error: 'Method Not Allowed' }, {
            ...NO_STORE_HEADERS,
            Allow: 'POST'
        });
    }

    try {
        return await handlePost(event);
    } catch {
        return jsonResponse(503, { error: 'Profil aktarım servisine şu anda ulaşılamıyor.' });
    }
};
