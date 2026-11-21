const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_INDEX_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'imdb-ratings.bin.gz');
const MAGIC = 'FNR1';
const VERSION = 1;
const HEADER_SIZE = 16;
const RECORD_SIZE = 5;
const MAX_ID = 0xFFFFFFFF;
const RATING_BASE = 256;

let indexCache;
let testIndexPathOverride;
let testBufferOverride;

function parseImdbIdNumber(imdbId) {
    if (typeof imdbId !== 'string') {
        return null;
    }

    const match = /^tt(\d{7,10})$/.exec(imdbId.trim());
    if (!match) {
        return null;
    }

    const num = Number(match[1]);
    return Number.isSafeInteger(num) && num >= 1 && num <= MAX_ID ? num : null;
}

function parseRatingTenths(rawRating) {
    if (typeof rawRating !== 'string' && typeof rawRating !== 'number') {
        return null;
    }

    const rating = Number(rawRating);
    return rating >= 0.1 && rating <= 10 ? Math.round(rating * 10) : null;
}

function encodeRatingsBinary(entries, generatedAtSec = Math.floor(Date.now() / 1000)) {
    const objectEntries = Array.isArray(entries);
    const packed = new Float64Array(entries.length);
    let length = 0;
    let sorted = true;

    for (let i = 0; i < entries.length; i += 1) {
        const idNum = objectEntries ? entries[i]?.idNum : entries.idNums[i];
        const rating = objectEntries ? entries[i]?.ratingTenths : entries.ratingTenths[i];
        if (!Number.isInteger(idNum) || idNum < 1 || idNum > MAX_ID ||
            !Number.isInteger(rating) || rating < 1 || rating > 100) {
            continue;
        }

        // Each packed value fits in 40 bits. Numeric sort keeps ID and rating together.
        const value = idNum * RATING_BASE + rating;
        if (length > 0 && value < packed[length - 1]) {
            sorted = false;
        }
        packed[length] = value;
        length += 1;
    }

    if (!sorted) {
        packed.subarray(0, length).sort();
    }

    let count = 0;
    let previousId = 0;
    for (let i = 0; i < length; i += 1) {
        const value = packed[i];
        const idNum = Math.floor(value / RATING_BASE);
        if (idNum !== previousId) {
            count += 1;
            previousId = idNum;
        }
        // The last value for an ID has its highest valid rating.
        packed[count - 1] = value;
    }

    const buffer = Buffer.allocUnsafe(HEADER_SIZE + count * RECORD_SIZE);
    buffer.write(MAGIC, 0, 'ascii');
    buffer.writeUInt16LE(VERSION, 4);
    buffer.writeUInt16LE(RECORD_SIZE, 6);
    buffer.writeUInt32LE(count, 8);
    buffer.writeUInt32LE(generatedAtSec, 12);

    for (let i = 0; i < count; i += 1) {
        const offset = HEADER_SIZE + i * RECORD_SIZE;
        const value = packed[i];
        buffer.writeUInt32LE(Math.floor(value / RATING_BASE), offset);
        buffer.writeUInt8(value % RATING_BASE, offset + 4);
    }

    return buffer;
}

function createRatingsCollector(minVotes) {
    let idNums = new Uint32Array(1024);
    let ratingTenths = new Uint8Array(idNums.length);
    let length = 0;
    let pending = '';

    function addLine(line) {
        const firstTab = line.indexOf('\t');
        const secondTab = line.indexOf('\t', firstTab + 1);
        if (firstTab < 0 || secondTab < 0 || line.indexOf('\t', secondTab + 1) !== -1) {
            return;
        }

        const idNum = parseImdbIdNumber(line.slice(0, firstTab));
        const rating = parseRatingTenths(line.slice(firstTab + 1, secondTab));
        const votes = Number(line.slice(secondTab + 1));
        if (idNum === null || rating === null || !Number.isFinite(votes) ||
            votes <= 0 || votes < minVotes) {
            return;
        }

        if (length === idNums.length) {
            const nextIds = new Uint32Array(length * 2);
            const nextRatings = new Uint8Array(nextIds.length);
            nextIds.set(idNums);
            nextRatings.set(ratingTenths);
            idNums = nextIds;
            ratingTenths = nextRatings;
        }

        idNums[length] = idNum;
        ratingTenths[length] = rating;
        length += 1;
    }

    return {
        addChunk(chunk) {
            const text = pending + chunk;
            let start = 0;
            let end = text.indexOf('\n');
            while (end !== -1) {
                addLine(text.slice(start, end));
                start = end + 1;
                end = text.indexOf('\n', start);
            }
            pending = text.slice(start);
        },
        finish() {
            if (pending) {
                addLine(pending);
                pending = '';
            }
            return { idNums, ratingTenths, length };
        }
    };
}

function parseRatingsTsvToBinaryBuffer(tsvString, options = {}) {
    const collector = createRatingsCollector(options.minVotes ?? 0);
    collector.addChunk(tsvString);
    return encodeRatingsBinary(collector.finish(), options.generatedAtSec);
}

function validateIndexBuffer(buf) {
    return Buffer.isBuffer(buf) &&
        buf.length >= HEADER_SIZE &&
        buf.toString('latin1', 0, 4) === MAGIC &&
        buf.readUInt16LE(4) === VERSION &&
        buf.readUInt16LE(6) === RECORD_SIZE &&
        buf.length === HEADER_SIZE + buf.readUInt32LE(8) * RECORD_SIZE;
}

function lookupImdbRatingInBuffer(buf, imdbId) {
    const idNum = parseImdbIdNumber(imdbId);
    if (idNum === null || !validateIndexBuffer(buf)) {
        return null;
    }

    let low = 0;
    let high = buf.readUInt32LE(8) - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const offset = HEADER_SIZE + middle * RECORD_SIZE;
        const currentId = buf.readUInt32LE(offset);
        if (currentId === idNum) {
            return (buf.readUInt8(offset + 4) / 10).toFixed(1);
        }
        if (currentId < idNum) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return null;
}

function loadIndexBuffer() {
    const indexPath = testIndexPathOverride || process.env.IMDB_RATINGS_INDEX_PATH?.trim() || DEFAULT_INDEX_PATH;
    try {
        const { mtimeMs, ctimeMs, size } = fs.statSync(indexPath);
        if (indexCache?.indexPath === indexPath && indexCache.mtimeMs === mtimeMs &&
            indexCache.ctimeMs === ctimeMs && indexCache.size === size) {
            return indexCache.buffer;
        }

        const buffer = zlib.gunzipSync(fs.readFileSync(indexPath));
        indexCache = { indexPath, mtimeMs, ctimeMs, size, buffer: validateIndexBuffer(buffer) ? buffer : null };
        return indexCache.buffer;
    } catch {
        indexCache = undefined;
        return null;
    }
}

function lookupImdbRating(imdbId) {
    const buffer = testBufferOverride !== undefined ? testBufferOverride : loadIndexBuffer();
    return lookupImdbRatingInBuffer(buffer, imdbId);
}

function _resetIndexCache() {
    indexCache = undefined;
    testIndexPathOverride = undefined;
    testBufferOverride = undefined;
}

function _setIndexPathForTests(customPath) {
    indexCache = undefined;
    testIndexPathOverride = customPath;
}

function _setIndexBufferForTests(bufOrNull) {
    testBufferOverride = bufOrNull;
}

module.exports = {
    DEFAULT_INDEX_PATH,
    parseImdbIdNumber,
    parseRatingTenths,
    encodeRatingsBinary,
    createRatingsCollector,
    parseRatingsTsvToBinaryBuffer,
    validateIndexBuffer,
    lookupImdbRatingInBuffer,
    loadIndexBuffer,
    lookupImdbRating,
    _resetIndexCache,
    _setIndexPathForTests,
    _setIndexBufferForTests
};
