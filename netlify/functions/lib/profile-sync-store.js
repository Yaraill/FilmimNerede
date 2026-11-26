const { randomInt } = require('node:crypto');

const PROFILE_SYNC_STORE_NAME = 'filmimnerede-profile-sync';
const PROFILE_SYNC_TTL_MS = 10 * 60 * 1000;
const PROFILE_SYNC_MAX_BODY_BYTES = 1_500_000;
const PROFILE_SYNC_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PROFILE_SYNC_CODE_LENGTH = 6;
const PROFILE_SYNC_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const PROFILE_SYNC_MAX_LIST_LENGTH = 5000;
const BACKUP_ARRAY_KEYS = [
    'watchlist',
    'ratedMovies',
    'favoriteActors',
    'recentlyViewed',
    'userSubscribedProviders',
    'savedSharedLists'
];
const BACKUP_MAP_KEYS = ['movieRatings', 'tvEpisodeProgress'];

let testStore = null;

function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function normalizeSyncCode(raw) {
    if (typeof raw !== 'string') return null;
    const code = raw.trim().toUpperCase().replace(/[\s-]+/g, '');
    return PROFILE_SYNC_CODE_PATTERN.test(code) ? code : null;
}

function formatSyncCode(code) {
    const normalized = normalizeSyncCode(code);
    return normalized ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : '';
}

function generateSyncCode() {
    let code = '';
    for (let index = 0; index < PROFILE_SYNC_CODE_LENGTH; index += 1) {
        code += PROFILE_SYNC_ALPHABET[randomInt(0, PROFILE_SYNC_ALPHABET.length)];
    }
    return code;
}

function validateProfileSyncBackup(rawBackup) {
    if (!isPlainObject(rawBackup)) {
        return { ok: false, statusCode: 400, error: 'Geçersiz profil yedeği.' };
    }
    if (rawBackup.app !== 'FilmimNerede' || ![1, 2].includes(rawBackup.version) ||
        !isPlainObject(rawBackup.data)) {
        return { ok: false, statusCode: 400, error: 'Desteklenmeyen profil yedeği.' };
    }

    for (const key of BACKUP_ARRAY_KEYS) {
        if (Object.hasOwn(rawBackup.data, key) &&
            (!Array.isArray(rawBackup.data[key]) || rawBackup.data[key].length > PROFILE_SYNC_MAX_LIST_LENGTH)) {
            return { ok: false, statusCode: 400, error: `Profil yedeğindeki ${key} verisi geçersiz.` };
        }
    }
    for (const key of BACKUP_MAP_KEYS) {
        if (Object.hasOwn(rawBackup.data, key) &&
            (!isPlainObject(rawBackup.data[key]) ||
                Object.keys(rawBackup.data[key]).length > PROFILE_SYNC_MAX_LIST_LENGTH)) {
            return { ok: false, statusCode: 400, error: `Profil yedeğindeki ${key} verisi geçersiz.` };
        }
    }
    return { ok: true, backup: rawBackup };
}

function createMemoryProfileSyncStore() {
    const records = new Map();
    return {
        async get(code) {
            return records.has(code) ? structuredClone(records.get(code)) : null;
        },
        async setIfAbsent(code, record) {
            if (records.has(code)) return { modified: false };
            records.set(code, structuredClone(record));
            return { modified: true };
        },
        async delete(code) {
            records.delete(code);
        }
    };
}

function createNetlifyProfileSyncStore(event) {
    const blobs = require('@netlify/blobs');
    if (typeof blobs.connectLambda === 'function' && event?.blobs) {
        blobs.connectLambda(event);
    }
    const store = blobs.getStore(PROFILE_SYNC_STORE_NAME);
    return {
        get: code => store.get(code, { type: 'json' }),
        setIfAbsent: (code, record) => store.setJSON(code, record, { onlyIfNew: true }),
        delete: code => store.delete(code)
    };
}

function _setStoreForTests(customStore) {
    testStore = customStore;
}

function getProfileSyncStore(event) {
    return testStore ?? createNetlifyProfileSyncStore(event);
}

async function saveOneTimeSyncRecord(store, backup, nowFn = Date.now) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = generateSyncCode();
        const createdAt = nowFn();
        const expiresAt = createdAt + PROFILE_SYNC_TTL_MS;
        const result = await store.setIfAbsent(code, {
            v: 1,
            createdAt,
            expiresAt,
            backup
        });
        if (result?.modified) {
            return {
                code,
                formattedCode: formatSyncCode(code),
                createdAt,
                expiresAt,
                ttlSeconds: Math.floor(PROFILE_SYNC_TTL_MS / 1000)
            };
        }
    }
    throw new Error('No profile sync code was available.');
}

async function redeemOneTimeSyncRecord(store, rawCode, nowFn = Date.now) {
    const code = normalizeSyncCode(rawCode);
    if (!code) {
        return { ok: false, statusCode: 400, error: 'Geçersiz aktarım kodu biçimi.' };
    }

    const record = await store.get(code);
    if (!record || typeof record !== 'object') {
        return { ok: false, statusCode: 404, error: 'Kod geçersiz, kullanılmış veya süresi dolmuş.' };
    }

    const now = nowFn();
    const claim = await store.setIfAbsent(`redeemed:${code}`, { redeemedAt: now });
    if (!claim?.modified) {
        return { ok: false, statusCode: 404, error: 'Kod geçersiz, kullanılmış veya süresi dolmuş.' };
    }
    await store.delete(code);
    if (record.v !== 1 || typeof record.expiresAt !== 'number' ||
        record.expiresAt <= now || !record.backup) {
        return { ok: false, statusCode: 404, error: 'Kod geçersiz, kullanılmış veya süresi dolmuş.' };
    }

    const validation = validateProfileSyncBackup(record.backup);
    if (!validation.ok) {
        return { ok: false, statusCode: 404, error: 'Kod geçersiz, kullanılmış veya süresi dolmuş.' };
    }
    return { ok: true, backup: record.backup };
}

module.exports = {
    PROFILE_SYNC_STORE_NAME,
    PROFILE_SYNC_TTL_MS,
    PROFILE_SYNC_MAX_BODY_BYTES,
    PROFILE_SYNC_ALPHABET,
    PROFILE_SYNC_CODE_LENGTH,
    PROFILE_SYNC_CODE_PATTERN,
    PROFILE_SYNC_MAX_LIST_LENGTH,
    normalizeSyncCode,
    formatSyncCode,
    generateSyncCode,
    validateProfileSyncBackup,
    createMemoryProfileSyncStore,
    createNetlifyProfileSyncStore,
    getProfileSyncStore,
    saveOneTimeSyncRecord,
    redeemOneTimeSyncRecord,
    _setStoreForTests
};
