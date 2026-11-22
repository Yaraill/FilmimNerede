const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const SHORTLINK_STORE_NAME = 'filmimnerede-shortlinks';
const SHORTLINK_MAX_BODY_BYTES = 2048;
const SHORTLINK_MAX_ITEMS = 30;
const SHORTLINK_MAX_TITLE_LENGTH = 80;
const SHORTLINK_ID_PATTERN = /^[0-9A-Za-z]{6,12}$/;

const COMPACT_ITEM_PATTERN = /^(m|t)([1-9]\d{0,14})$/;
const MAX_ITEM_ID = 999_999_999_999_999;
const BASE62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SHORTLINK_ID_LENGTH = 8;
const MAX_COLLISION_ATTEMPT = 5;

let testStore = null;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTitle(title) {
    const trimmed = title.trim();
    return typeof trimmed.toWellFormed === 'function' ? trimmed.toWellFormed() : trimmed;
}

function isCompactItem(item) {
    return typeof item === 'string' && COMPACT_ITEM_PATTERN.test(item);
}

function compactItem(item) {
    if (isCompactItem(item)) {
        return item;
    }
    if (!isRecord(item)) {
        return null;
    }

    const { id } = item;
    const mediaType = item.media_type ?? item.mediaType;
    if (!Number.isSafeInteger(id) || id < 1 || id > MAX_ITEM_ID ||
        (mediaType !== 'movie' && mediaType !== 'tv')) {
        return null;
    }
    return `${mediaType === 'movie' ? 'm' : 't'}${id}`;
}

function invalidPayload(error) {
    return { ok: false, statusCode: 400, error };
}

function normalizeShortlinkPayload(rawBody) {
    if (!isRecord(rawBody)) {
        return invalidPayload('Geçersiz liste verisi.');
    }

    const { title, items } = rawBody;
    if (title != null && typeof title !== 'string') {
        return invalidPayload('Liste başlığı metin olmalıdır.');
    }
    const canonicalTitle = normalizeTitle(title ?? '');
    if (canonicalTitle.length > SHORTLINK_MAX_TITLE_LENGTH) {
        return invalidPayload(`Liste başlığı en fazla ${SHORTLINK_MAX_TITLE_LENGTH} karakter olabilir.`);
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > SHORTLINK_MAX_ITEMS) {
        return invalidPayload(`Liste 1 ile ${SHORTLINK_MAX_ITEMS} arasında öğe içermelidir.`);
    }

    const tokens = new Set();
    for (const item of items) {
        const token = compactItem(item);
        if (token === null) {
            return invalidPayload('Listede geçersiz bir öğe var.');
        }
        tokens.add(token);
    }

    return { ok: true, record: { v: 1, t: canonicalTitle, i: [...tokens] } };
}

function expandShortlinkRecord(id, record) {
    if (!isRecord(record) || record.v !== 1 || typeof record.t !== 'string' ||
        record.t.length > SHORTLINK_MAX_TITLE_LENGTH || record.t !== normalizeTitle(record.t) ||
        !Array.isArray(record.i) || record.i.length < 1 || record.i.length > SHORTLINK_MAX_ITEMS) {
        return null;
    }

    const tokens = new Set(record.i);
    if (tokens.size !== record.i.length || ![...tokens].every(isCompactItem)) {
        return null;
    }

    return {
        v: 1,
        id,
        title: record.t || '',
        items: record.i.map(token => ({
            id: Number(token.slice(1)),
            media_type: token[0] === 'm' ? 'movie' : 'tv'
        }))
    };
}

function computeShortlinkId(canonicalRecord, attempt = 0) {
    const serialized = JSON.stringify({ v: 1, t: canonicalRecord.t, i: canonicalRecord.i });
    const suffix = attempt > 0 ? `#${attempt}` : '';
    const hash = createHash('sha256').update(serialized + suffix).digest('hex');
    let value = BigInt(`0x${hash}`);
    let id = '';
    for (let index = 0; index < SHORTLINK_ID_LENGTH; index += 1) {
        id = BASE62_DIGITS[Number(value % 62n)] + id;
        value /= 62n;
    }
    return id;
}

function createMemoryShortlinkStore() {
    const records = new Map();
    return {
        async get(id) {
            return records.has(id) ? structuredClone(records.get(id)) : null;
        },
        async setIfAbsent(id, record) {
            if (records.has(id)) {
                return { modified: false };
            }
            records.set(id, structuredClone(record));
            return { modified: true };
        }
    };
}

function createNetlifyShortlinkStore(event) {
    const blobs = require('@netlify/blobs');
    if (typeof blobs.connectLambda === 'function' && event?.blobs) {
        blobs.connectLambda(event);
    }
    const store = blobs.getStore(SHORTLINK_STORE_NAME);
    return {
        get: id => store.get(id, { type: 'json' }),
        setIfAbsent: (id, record) => store.setJSON(id, record, { onlyIfNew: true })
    };
}

function _setStoreForTests(customStore) {
    testStore = customStore;
}

function getShortlinkStore(event) {
    return testStore ?? createNetlifyShortlinkStore(event);
}

async function saveIdempotentShortlink(store, canonicalRecord) {
    for (let attempt = 0; attempt <= MAX_COLLISION_ATTEMPT; attempt += 1) {
        const id = computeShortlinkId(canonicalRecord, attempt);
        let record = await store.get(id);
        if (record == null) {
            const { modified } = await store.setIfAbsent(id, canonicalRecord);
            if (modified) {
                return { id, record: canonicalRecord, created: true };
            }

            record = await store.get(id);
            if (record == null) {
                // A retry can reuse this ID once the winning write is readable.
                throw new Error('The existing shortlink could not be read after a conditional write.');
            }
        }
        if (isDeepStrictEqual(record, canonicalRecord)) {
            return { id, record, created: false };
        }
    }
    throw new Error('No shortlink ID was available.');
}

module.exports = {
    SHORTLINK_STORE_NAME,
    SHORTLINK_MAX_BODY_BYTES,
    SHORTLINK_MAX_ITEMS,
    SHORTLINK_MAX_TITLE_LENGTH,
    SHORTLINK_ID_PATTERN,
    normalizeShortlinkPayload,
    expandShortlinkRecord,
    computeShortlinkId,
    createMemoryShortlinkStore,
    createNetlifyShortlinkStore,
    getShortlinkStore,
    saveIdempotentShortlink,
    _setStoreForTests
};
