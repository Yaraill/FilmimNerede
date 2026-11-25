const EXTERNAL_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const EXTERNAL_IMPORT_MAX_FILES = 20;
const EXTERNAL_IMPORT_MAX_ZIP_ENTRIES = 120;
const EXTERNAL_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const EXTERNAL_IMPORT_MAX_UNIQUE_ITEMS = 1000;
const EXTERNAL_IMPORT_CONCURRENCY = 4;

const EXTERNAL_IMPORT_ROOT_CSV_NAMES = new Set([
    'watchlist.csv',
    'ratings.csv',
    'watched.csv',
    'diary.csv'
]);

const EXTERNAL_IMPORT_TURKISH_CHAR_MAP = {
    ç: 'c', Ç: 'c',
    ğ: 'g', Ğ: 'g',
    ı: 'i', İ: 'i',
    ö: 'o', Ö: 'o',
    ş: 's', Ş: 's',
    ü: 'u', Ü: 'u'
};

const importSessionCache = new Map();
let activeExternalImportAbortController = null;
let activeExternalImportSession = null;

function getImportBaseUrl() {
    return typeof BASE_URL === 'string' && BASE_URL
        ? BASE_URL
        : 'https://api.themoviedb.org/3';
}

function getImportSharedListMaxItems() {
    return typeof SHARED_LIST_MAX_ITEMS === 'number' && SHARED_LIST_MAX_ITEMS > 0
        ? SHARED_LIST_MAX_ITEMS
        : 30;
}

function getImportSavedListsMax() {
    return typeof SAVED_SHARED_LISTS_MAX === 'number' && SAVED_SHARED_LISTS_MAX > 0
        ? SAVED_SHARED_LISTS_MAX
        : 40;
}

function getImportValidTmdbImageUrl(path, size = 'w92') {
    if (typeof isValidTmdbImagePath === 'function' && !isValidTmdbImagePath(path)) {
        return '/assets/placeholder.svg';
    }
    const base = typeof getSizedTmdbImageBase === 'function'
        ? getSizedTmdbImageBase(size, typeof IMAGE_BASE === 'string' ? IMAGE_BASE : undefined)
        : `https://image.tmdb.org/t/p/${size}`;
    if (typeof getSafeTmdbImageUrl === 'function') {
        return getSafeTmdbImageUrl(path, base, '/assets/placeholder.svg');
    }
    return path ? `${base}${path}` : '/assets/placeholder.svg';
}

/**
 * RFC 4180 uyumlu CSV ayrıştırıcı (UTF-8 BOM, tırnak içi virgül, kaçışlı tırnak, çok satırlı hücreler).
 */
function parseCsvRows(rawText) {
    if (typeof rawText !== 'string' || !rawText) return [];
    const text = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;

    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    currentField += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                currentField += ch;
            }
            continue;
        }

        if (ch === '"') {
            if (currentField.length === 0) {
                inQuotes = true;
            } else {
                currentField += ch;
            }
            continue;
        }

        if (ch === ',') {
            currentRow.push(currentField);
            currentField = '';
            continue;
        }

        if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text[i + 1] === '\n') {
                i += 1;
            }
            currentRow.push(currentField);
            if (!(currentRow.length === 1 && currentRow[0].trim() === '')) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentField = '';
            continue;
        }

        currentField += ch;
    }

    currentRow.push(currentField);
    if (!(currentRow.length === 1 && currentRow[0].trim() === '')) {
        rows.push(currentRow);
    }

    return rows;
}

function normalizeZipEntryPath(rawName) {
    const unixPath = String(rawName || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!unixPath || unixPath.endsWith('/')) return { skip: true, path: '' };
    if (/[\u0000-\u001F]/.test(unixPath) || /^[A-Za-z]:/.test(unixPath)) {
        throw new Error(`ZIP arşivinde güvensiz dosya yolu bulundu: ${unixPath.slice(0, 60)}`);
    }
    const parts = unixPath.split('/');
    if (parts.some(part => part === '..' || part === '.')) {
        throw new Error(`ZIP arşivinde geçersiz yol segmenti bulundu: ${unixPath.slice(0, 60)}`);
    }
    if (parts[0] === '__MACOSX' || parts.some(part => part.startsWith('._'))) {
        return { skip: true, path: '' };
    }
    return { skip: false, path: unixPath };
}

function resolveRelevantLetterboxdZipTarget(normalizedPath) {
    const parts = normalizedPath.split('/').filter(Boolean);
    if (!parts.length) return null;

    // Doğrudan kök veya tek üst klasör altındaki standart Letterboxd dosyaları
    const trimmedParts = parts.length >= 2 &&
        !EXTERNAL_IMPORT_ROOT_CSV_NAMES.has(parts[0].toLowerCase()) &&
        parts[0].toLowerCase() !== 'lists'
        ? parts.slice(1)
        : parts;

    if (trimmedParts.length === 1) {
        const lower = trimmedParts[0].toLowerCase();
        if (EXTERNAL_IMPORT_ROOT_CSV_NAMES.has(lower)) {
            return lower;
        }
        return null;
    }

    if (
        trimmedParts.length === 2 &&
        trimmedParts[0].toLowerCase() === 'lists' &&
        trimmedParts[1].toLowerCase().endsWith('.csv')
    ) {
        return `lists/${trimmedParts[1]}`;
    }

    return null;
}

async function inflateRawBytesWithLimit(compressedBytes, remainingBudget) {
    if (typeof DecompressionStream !== 'function') {
        throw new Error('Tarayıcınız ZIP dosyası açma (DecompressionStream) özelliğini desteklemiyor.');
    }

    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const writePromise = writer.write(compressedBytes)
        .then(() => writer.close())
        .catch(() => {});

    const chunks = [];
    let totalBytes = 0;

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value && value.byteLength) {
                totalBytes += value.byteLength;
                if (totalBytes > remainingBudget) {
                    try { await reader.cancel(); } catch (_) {}
                    throw new Error('ZIP arşivi açılmış boyut güvenlik sınırını (25 MB) aşıyor.');
                }
                chunks.push(value);
            }
        }
    } finally {
        try { reader.releaseLock(); } catch (_) {}
    }

    await writePromise;

    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}

/**
 * Sıfır bağımlılıklı güvenli ZIP çıkarıcı (Stored + Deflate, Zip-Slip & ZIP bomb korumalı).
 */
async function extractZipCsvEntries(arrayBuffer) {
    const tag = Object.prototype.toString.call(arrayBuffer);
    const isView = ArrayBuffer.isView(arrayBuffer);
    if (!arrayBuffer || (!isView && tag !== '[object ArrayBuffer]' && tag !== '[object SharedArrayBuffer]')) {
        throw new Error('ZIP verisi okunamadı.');
    }
    const bytes = isView
        ? new Uint8Array(arrayBuffer.buffer, arrayBuffer.byteOffset, arrayBuffer.byteLength)
        : new Uint8Array(arrayBuffer);

    if (bytes.byteLength < 22) {
        throw new Error('Geçersiz veya bozuk ZIP arşivi.');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const minSearchOffset = Math.max(0, bytes.byteLength - 65557);
    let eocdOffset = -1;

    for (let pos = bytes.byteLength - 22; pos >= minSearchOffset; pos--) {
        if (view.getUint32(pos, true) === 0x06054b50) {
            const commentLen = view.getUint16(pos + 20, true);
            if (pos + 22 + commentLen === bytes.byteLength) {
                eocdOffset = pos;
                break;
            }
        }
    }

    if (eocdOffset === -1) {
        throw new Error('ZIP arşiv dizini (EOCD) bulunamadı.');
    }

    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirSize = view.getUint32(eocdOffset + 12, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);

    if (
        totalEntries === 0xFFFF ||
        centralDirSize === 0xFFFFFFFF ||
        centralDirOffset === 0xFFFFFFFF
    ) {
        throw new Error('ZIP64 formatındaki büyük arşivler desteklenmiyor.');
    }

    if (totalEntries > EXTERNAL_IMPORT_MAX_ZIP_ENTRIES) {
        throw new Error(`ZIP arşivinde en fazla ${EXTERNAL_IMPORT_MAX_ZIP_ENTRIES} dosya bulunabilir.`);
    }

    if (centralDirOffset + centralDirSize > eocdOffset) {
        throw new Error('ZIP arşiv dizini bozuk.');
    }

    const decoder = new TextDecoder('utf-8');
    const results = [];
    let cursor = centralDirOffset;
    let totalUncompressedRead = 0;

    for (let i = 0; i < totalEntries; i++) {
        if (cursor + 46 > centralDirOffset + centralDirSize || view.getUint32(cursor, true) !== 0x02014b50) {
            throw new Error('ZIP merkezi dizin kaydı okunamadı.');
        }

        const flags = view.getUint16(cursor + 8, true);
        const method = view.getUint16(cursor + 10, true);
        const compressedSize = view.getUint32(cursor + 20, true);
        const uncompressedSize = view.getUint32(cursor + 24, true);
        const fileNameLen = view.getUint16(cursor + 28, true);
        const extraLen = view.getUint16(cursor + 30, true);
        const commentLen = view.getUint16(cursor + 32, true);
        const localHeaderOffset = view.getUint32(cursor + 42, true);

        const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + fileNameLen);
        const rawFileName = decoder.decode(nameBytes);
        cursor += 46 + fileNameLen + extraLen + commentLen;

        const pathCheck = normalizeZipEntryPath(rawFileName);
        if (pathCheck.skip) continue;

        const targetName = resolveRelevantLetterboxdZipTarget(pathCheck.path);
        if (!targetName) continue;

        if ((flags & 0x01) !== 0) {
            throw new Error('Şifreli ZIP dosyaları desteklenmiyor.');
        }

        if (
            compressedSize === 0xFFFFFFFF ||
            uncompressedSize === 0xFFFFFFFF ||
            localHeaderOffset === 0xFFFFFFFF
        ) {
            throw new Error('ZIP64 girdileri desteklenmiyor.');
        }

        const remainingBudget = EXTERNAL_IMPORT_MAX_ZIP_UNCOMPRESSED_BYTES - totalUncompressedRead;
        if (uncompressedSize > remainingBudget) {
            throw new Error('ZIP arşivi açılmış boyut güvenlik sınırını (25 MB) aşıyor.');
        }

        if (localHeaderOffset + 30 > bytes.byteLength || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
            throw new Error(`ZIP yerel dosya başlığı okunamadı: ${targetName}`);
        }

        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataOffset + compressedSize;

        if (dataEnd > bytes.byteLength) {
            throw new Error(`ZIP veri alanı eksik veya bozuk: ${targetName}`);
        }

        const payloadSlice = bytes.subarray(dataOffset, dataEnd);
        let entryBytes;
        if (method === 0) {
            if (compressedSize > remainingBudget) {
                throw new Error('ZIP arşivi açılmış boyut güvenlik sınırını (25 MB) aşıyor.');
            }
            entryBytes = payloadSlice;
        } else if (method === 8) {
            entryBytes = await inflateRawBytesWithLimit(payloadSlice, remainingBudget);
        } else {
            throw new Error(`Desteklenmeyen ZIP sıkıştırma yöntemi (${method}): ${targetName}`);
        }

        totalUncompressedRead += entryBytes.byteLength;
        results.push({
            name: targetName,
            text: decoder.decode(entryBytes)
        });
    }

    return results;
}

function normalizeMatchTitle(title) {
    if (typeof title !== 'string') return '';
    const turkishMapped = title.replace(/[çÇğĞıİöÖşŞüÜ]/g, ch => EXTERNAL_IMPORT_TURKISH_CHAR_MAP[ch] || ch);
    const ascii = typeof turkishMapped.normalize === 'function'
        ? turkishMapped.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        : turkishMapped;
    return ascii
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function stripLeadingArticles(normalizedTitle) {
    return String(normalizedTitle || '').replace(/^(?:the|a|an)\s+/i, '').trim();
}

function extractMainTitle(rawTitle) {
    if (typeof rawTitle !== 'string') return '';
    const trimmed = rawTitle.trim();
    const match = trimmed.match(/^(.{3,}?)(?:\s*[:\-–—]\s+|\s*\([^)]*\)\s*$)/);
    return match ? match[1].trim() : '';
}

function parseYearToken(rawValue) {
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') return null;
    const match = String(rawValue).trim().match(/^(\d{4})\b/);
    if (!match) return null;
    const year = Number(match[1]);
    return year >= 1880 && year <= 2100 ? year : null;
}

function convertLetterboxdRating(rawValue) {
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') return null;
    const num = Number(String(rawValue).trim().replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0 || num > 5) return null;
    const scaled = Math.round(num * 2);
    return Math.min(10, Math.max(1, scaled));
}

function inferImdbMediaHint(rawTitleType) {
    const normalized = String(rawTitleType || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (normalized === 'tvepisode') return 'skip_episode';
    if (normalized === 'tvseries' || normalized === 'tvminiseries' || normalized === 'tvshort' || normalized === 'tv') {
        return 'tv';
    }
    return 'movie';
}

function headerIndexMap(headerRow) {
    const map = new Map();
    if (!Array.isArray(headerRow)) return map;
    headerRow.forEach((cell, index) => {
        const key = String(cell || '').trim().toLowerCase();
        if (key && !map.has(key)) {
            map.set(key, index);
        }
    });
    return map;
}

function readCsvCell(row, indexMap, keys) {
    for (const key of keys) {
        const idx = indexMap.get(key);
        if (idx !== undefined && idx < row.length) {
            return String(row[idx] ?? '').trim();
        }
    }
    return '';
}

function deriveListTitleFromFilename(fileName) {
    const base = String(fileName || '').split('/').pop().replace(/\.csv$/i, '');
    const cleaned = base.replace(/[-_]+/g, ' ').trim();
    if (typeof normalizeSharedListTitle === 'function') {
        return normalizeSharedListTitle(cleaned, 'İçe Aktarılan Seçki');
    }
    return cleaned.slice(0, 80) || 'İçe Aktarılan Seçki';
}

function parseLetterboxdListMetadata(rows, fileName) {
    let customTitle = '';
    let dataHeaderIndex = -1;

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const idxMap = headerIndexMap(rows[i]);
        if (idxMap.has('name') && idxMap.has('year') && (idxMap.has('position') || idxMap.has('url') || idxMap.has('letterboxd uri'))) {
            dataHeaderIndex = i;
            break;
        }
        if (idxMap.has('name') && idxMap.has('url') && !idxMap.has('year') && i + 1 < rows.length) {
            const metaName = readCsvCell(rows[i + 1], idxMap, ['name']);
            if (metaName) customTitle = metaName;
        }
    }

    if (dataHeaderIndex === -1) {
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const idxMap = headerIndexMap(rows[i]);
            if (idxMap.has('name') && (idxMap.has('year') || idxMap.has('url') || idxMap.has('letterboxd uri'))) {
                dataHeaderIndex = i;
                break;
            }
        }
    }

    const fallbackTitle = deriveListTitleFromFilename(fileName);
    const title = typeof normalizeSharedListTitle === 'function'
        ? normalizeSharedListTitle(customTitle || fallbackTitle, fallbackTitle)
        : (customTitle || fallbackTitle).slice(0, 80);

    return { title, dataHeaderIndex };
}

function buildImportCandidateKey(record) {
    if (record.imdbId) {
        return `imdb:${record.imdbId}`;
    }
    const normTitle = normalizeMatchTitle(record.title || record.originalTitle);
    return `lb:${normTitle}:${record.year || ''}`;
}

/**
 * Tek veya çoklu CSV girdisini doğrular, IMDb / Letterboxd formatını tanır ve ağ öncesi tekilleştirir.
 */
function parseImportFiles(fileEntries) {
    const uniqueMap = new Map();
    const listsMap = new Map();
    const stats = {
        filesProcessed: 0,
        skippedEpisodes: 0,
        invalidRows: 0,
        truncatedUniqueItems: 0,
        listCount: 0,
        formatsDetected: new Set()
    };
    let hitMaxItems = false;

    const upsertRecord = (incoming, listMembershipId = null) => {
        const normTitle = normalizeMatchTitle(incoming.title || incoming.originalTitle);
        if (!normTitle && !incoming.imdbId) {
            stats.invalidRows += 1;
            return null;
        }

        const key = buildImportCandidateKey(incoming);
        let existing = uniqueMap.get(key);

        if (!existing) {
            if (uniqueMap.size >= EXTERNAL_IMPORT_MAX_UNIQUE_ITEMS) {
                hitMaxItems = true;
                stats.truncatedUniqueItems += 1;
                return null;
            }
            existing = {
                key,
                source: incoming.source,
                imdbId: incoming.imdbId || null,
                title: incoming.title || incoming.originalTitle || incoming.imdbId,
                originalTitle: incoming.originalTitle || '',
                year: incoming.year || null,
                mediaHint: incoming.mediaHint || null,
                inWatchlist: false,
                inWatched: false,
                rating: null,
                imdbRating: null,
                listIds: [],
                status: 'pending',
                confidence: null,
                stage: null,
                candidates: [],
                selectedKey: 'skip'
            };
            uniqueMap.set(key, existing);
        }

        if (!existing.originalTitle && incoming.originalTitle) existing.originalTitle = incoming.originalTitle;
        if (!existing.year && incoming.year) existing.year = incoming.year;
        if (!existing.mediaHint && incoming.mediaHint) existing.mediaHint = incoming.mediaHint;
        if (incoming.inWatchlist) existing.inWatchlist = true;
        if (incoming.inWatched) existing.inWatched = true;
        if (incoming.rating !== null && incoming.rating !== undefined) {
            existing.rating = incoming.rating;
        }
        if (!existing.imdbRating && incoming.imdbRating) {
            existing.imdbRating = incoming.imdbRating;
        }
        if (listMembershipId && !existing.listIds.includes(listMembershipId)) {
            existing.listIds.push(listMembershipId);
        }
        return existing;
    };

    for (const fileEntry of Array.isArray(fileEntries) ? fileEntries : []) {
        const fileName = String(fileEntry?.name || '');
        const lowerName = fileName.toLowerCase();
        const rows = parseCsvRows(String(fileEntry?.text || ''));
        if (rows.length < 2) continue;

        stats.filesProcessed += 1;

        const firstCell = String(rows[0]?.[0] || '').trim().toLowerCase();
        const firstHeaderMap = headerIndexMap(rows[0]);

        // 1) Letterboxd Liste CSV
        const isLetterboxdList =
            lowerName.startsWith('lists/') ||
            lowerName.includes('/lists/') ||
            firstCell.startsWith('letterboxd list export');

        if (isLetterboxdList) {
            const { title: listTitle, dataHeaderIndex } = parseLetterboxdListMetadata(rows, fileName);
            if (dataHeaderIndex === -1 || dataHeaderIndex + 1 >= rows.length) continue;

            stats.formatsDetected.add('Letterboxd Liste');
            const listId = `lb_list_${listsMap.size + 1}`;
            const listCols = headerIndexMap(rows[dataHeaderIndex]);
            const maxItems = getImportSharedListMaxItems();
            const listEntry = {
                id: listId,
                title: listTitle,
                candidateKeys: [],
                truncatedCount: 0
            };

            for (let r = dataHeaderIndex + 1; r < rows.length; r++) {
                const row = rows[r];
                const title = readCsvCell(row, listCols, ['name', 'title']);
                if (!title) {
                    stats.invalidRows += 1;
                    continue;
                }
                if (listEntry.candidateKeys.length >= maxItems) {
                    listEntry.truncatedCount += 1;
                    continue;
                }
                const year = parseYearToken(readCsvCell(row, listCols, ['year']));
                const saved = upsertRecord({
                    source: 'letterboxd',
                    imdbId: null,
                    title,
                    originalTitle: '',
                    year,
                    mediaHint: null,
                    inWatchlist: false,
                    inWatched: false,
                    rating: null
                }, listId);
                if (saved && !listEntry.candidateKeys.includes(saved.key)) {
                    listEntry.candidateKeys.push(saved.key);
                }
            }

            if (listEntry.candidateKeys.length > 0) {
                listsMap.set(listId, listEntry);
            }
            continue;
        }

        // 2) IMDb CSV (Const + Title)
        if (firstHeaderMap.has('const') && (firstHeaderMap.has('title') || firstHeaderMap.has('original title'))) {
            stats.formatsDetected.add('IMDb');
            const isWatchlistFile = lowerName.includes('watchlist');
            const isRatingsFile = lowerName.includes('rating');

            for (let r = 1; r < rows.length; r++) {
                const row = rows[r];
                const rawConst = readCsvCell(row, firstHeaderMap, ['const']);
                const imdbId = (typeof isValidImdbId === 'function' ? isValidImdbId(rawConst) : /^tt\d{7,10}$/.test(rawConst))
                    ? rawConst
                    : null;
                if (!imdbId) {
                    stats.invalidRows += 1;
                    continue;
                }

                const mediaHint = inferImdbMediaHint(readCsvCell(row, firstHeaderMap, ['title type']));
                if (mediaHint === 'skip_episode') {
                    stats.skippedEpisodes += 1;
                    continue;
                }

                const title = readCsvCell(row, firstHeaderMap, ['title', 'original title']);
                const originalTitle = readCsvCell(row, firstHeaderMap, ['original title']);
                const year =
                    parseYearToken(readCsvCell(row, firstHeaderMap, ['year'])) ||
                    parseYearToken(readCsvCell(row, firstHeaderMap, ['release date']));

                const rawYourRating = readCsvCell(row, firstHeaderMap, ['your rating']);
                const rating = typeof normalizeUserRating === 'function'
                    ? normalizeUserRating(rawYourRating)
                    : (Number.isFinite(Number(rawYourRating)) && Number(rawYourRating) >= 1 && Number(rawYourRating) <= 10
                        ? Math.round(Number(rawYourRating) * 10) / 10
                        : null);

                const rawImdbRating = Number(readCsvCell(row, firstHeaderMap, ['imdb rating']));
                const imdbRating = Number.isFinite(rawImdbRating) && rawImdbRating >= 0.1 && rawImdbRating <= 10
                    ? rawImdbRating.toFixed(1)
                    : null;

                const inWatchlist = isWatchlistFile || (!isRatingsFile && rating === null);
                const inWatched = !isWatchlistFile && rating === null && isRatingsFile;

                upsertRecord({
                    source: 'imdb',
                    imdbId,
                    title: title || originalTitle,
                    originalTitle,
                    year,
                    mediaHint,
                    inWatchlist,
                    inWatched,
                    rating,
                    imdbRating
                });
            }
            continue;
        }

        // 3) Letterboxd Standart CSV (Name + Year / Letterboxd URI)
        if (firstHeaderMap.has('name') && (firstHeaderMap.has('year') || firstHeaderMap.has('letterboxd uri') || firstHeaderMap.has('rating'))) {
            stats.formatsDetected.add('Letterboxd');
            const isWatchlistFile = lowerName.includes('watchlist');
            const isWatchedFile = lowerName.includes('watched') || lowerName.includes('diary');
            const isRatingsFile = lowerName.includes('rating');

            for (let r = 1; r < rows.length; r++) {
                const row = rows[r];
                const title = readCsvCell(row, firstHeaderMap, ['name']);
                if (!title) {
                    stats.invalidRows += 1;
                    continue;
                }
                const year = parseYearToken(readCsvCell(row, firstHeaderMap, ['year']));
                const rating = convertLetterboxdRating(readCsvCell(row, firstHeaderMap, ['rating']));

                if (isRatingsFile && rating === null) {
                    continue;
                }

                const inWatchlist = isWatchlistFile || (!isWatchedFile && !isRatingsFile && rating === null);
                const inWatched = isWatchedFile && rating === null;

                upsertRecord({
                    source: 'letterboxd',
                    imdbId: null,
                    title,
                    originalTitle: '',
                    year,
                    mediaHint: null,
                    inWatchlist,
                    inWatched,
                    rating
                });
            }
        }
    }

    stats.listCount = listsMap.size;
    return {
        items: Array.from(uniqueMap.values()),
        lists: Array.from(listsMap.values()),
        stats: {
            ...stats,
            hitMaxItems,
            formatsDetected: Array.from(stats.formatsDetected)
        }
    };
}

function scoreTmdbCandidate(entry, item) {
    if (!item || typeof item !== 'object') return -Infinity;
    const itemType = typeof inferItemMediaType === 'function'
        ? inferItemMediaType(item, null)
        : (item.media_type === 'tv' || item.media_type === 'movie' ? item.media_type : null);
    if (itemType !== 'movie' && itemType !== 'tv') return -Infinity;

    const targetNorm = normalizeMatchTitle(entry.title || '');
    const targetAltNorm = normalizeMatchTitle(entry.originalTitle || '');
    const targetStripped = stripLeadingArticles(targetNorm);
    const targetAltStripped = stripLeadingArticles(targetAltNorm);

    const candidateRawTitles = [item.title, item.name, item.original_title, item.original_name]
        .filter(value => typeof value === 'string' && value.trim());

    let bestTitleScore = 0;
    let isTitleExact = false;

    for (const rawTitle of candidateRawTitles) {
        const candNorm = normalizeMatchTitle(rawTitle);
        if (!candNorm) continue;
        const candStripped = stripLeadingArticles(candNorm);

        if ((targetNorm && candNorm === targetNorm) || (targetAltNorm && candNorm === targetAltNorm)) {
            bestTitleScore = Math.max(bestTitleScore, 70);
            isTitleExact = true;
        } else if (
            (targetStripped && candStripped === targetStripped) ||
            (targetAltStripped && candStripped === targetAltStripped)
        ) {
            bestTitleScore = Math.max(bestTitleScore, 62);
            isTitleExact = true;
        } else {
            const minLen = Math.min(candNorm.length, targetNorm.length);
            if (minLen >= 4 && (candNorm.includes(targetNorm) || targetNorm.includes(candNorm))) {
                bestTitleScore = Math.max(bestTitleScore, 42);
            }
        }
    }

    if (bestTitleScore === 0) return 0;

    let score = bestTitleScore;
    const candidateYear = parseYearToken(item.release_date || item.first_air_date);
    let yearDiff = null;

    if (entry.year && candidateYear) {
        yearDiff = Math.abs(candidateYear - entry.year);
        if (yearDiff === 0) score += 30;
        else if (yearDiff === 1) score += 18;
        else if (yearDiff > 2) score -= 25;
    } else if (!entry.year) {
        score += 10;
    }

    if (entry.mediaHint === 'tv' || entry.mediaHint === 'movie') {
        score += itemType === entry.mediaHint ? 8 : -5;
    }

    const voteCount = Number(item.vote_count) || 0;
    score += Math.min(12, Math.log10(voteCount + 1) * 3);

    return {
        score,
        isTitleExact,
        yearDiff,
        item: {
            ...item,
            media_type: itemType
        }
    };
}

function parseRetryAfterSeconds(response) {
    const rawHeader = typeof response?.headers?.get === 'function'
        ? response.headers.get('Retry-After')
        : '';
    if (!rawHeader) return 5;
    const numeric = Number(rawHeader);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.min(65, Math.max(1, Math.ceil(numeric)));
    }
    const parsedDate = Date.parse(rawHeader);
    if (Number.isFinite(parsedDate)) {
        const diffSeconds = Math.ceil((parsedDate - Date.now()) / 1000);
        return Math.min(65, Math.max(1, diffSeconds));
    }
    return 5;
}

function waitWithAbort(ms, signal) {
    if (signal?.aborted) {
        const err = new Error('İçe aktarma iptal edildi.');
        err.name = 'AbortError';
        return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
        let timer = null;
        const onAbort = () => {
            if (timer !== null) clearTimeout(timer);
            const err = new Error('İçe aktarma iptal edildi.');
            err.name = 'AbortError';
            reject(err);
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
        timer = setTimeout(() => {
            signal?.removeEventListener?.('abort', onAbort);
            resolve();
        }, ms);
    });
}

async function fetchImportTmdbJson(url, signal, onRateLimitWait) {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (signal?.aborted) {
            const err = new Error('İçe aktarma iptal edildi.');
            err.name = 'AbortError';
            throw err;
        }
        const response = await fetch(url, { signal });
        if (response.status === 429 && attempt < 2) {
            const waitSeconds = parseRetryAfterSeconds(response);
            if (typeof onRateLimitWait === 'function') {
                onRateLimitWait(waitSeconds);
            }
            await waitWithAbort(waitSeconds * 1000, signal);
            continue;
        }
        if (!response.ok) {
            return null;
        }
        return await response.json().catch(() => null);
    }
    return null;
}

function createResolvedCandidateSnapshot(item) {
    const safeItem = { ...item };
    if (typeof normalizeMediaType === 'function') {
        safeItem.media_type = normalizeMediaType(item.media_type, inferItemMediaType(item, 'movie'));
    }
    if (typeof setCachedMedia === 'function') {
        setCachedMedia(safeItem, safeItem.media_type);
    }
    return safeItem;
}

/**
 * 3 aşamalı TMDB eşleştirme motoru (IMDb /find + Başlık/Yıl Aşama 1-2-3).
 */
async function resolveImportEntry(entry, signal, onRateLimitWait) {
    const cached = importSessionCache.get(entry.key);
    if (cached) {
        return {
            ...entry,
            status: cached.status,
            confidence: cached.confidence,
            stage: cached.stage,
            candidates: cached.candidates,
            selectedKey: cached.selectedKey
        };
    }

    const apiBase = getImportBaseUrl();
    const candidatePool = new Map();
    const trLocaleItems = new Map();

    const addCandidates = (list, forcedType = null, isTurkishLocale = false) => {
        for (const rawItem of Array.isArray(list) ? list : []) {
            if (!rawItem || typeof rawItem !== 'object') continue;
            const id = typeof normalizeTmdbId === 'function' ? normalizeTmdbId(rawItem.id) : Number(rawItem.id);
            if (!id) continue;
            const itemType = forcedType || (typeof inferItemMediaType === 'function' ? inferItemMediaType(rawItem, null) : rawItem.media_type);
            if (itemType !== 'movie' && itemType !== 'tv') continue;
            const withType = { ...rawItem, id, media_type: itemType };
            const compositeKey = `${itemType}:${id}`;
            if (isTurkishLocale && !trLocaleItems.has(compositeKey)) {
                trLocaleItems.set(compositeKey, withType);
            }
            const scored = scoreTmdbCandidate(entry, withType);
            if (!scored || typeof scored !== 'object' || scored.score <= 0) continue;
            const displayItem = trLocaleItems.get(compositeKey) || scored.item;
            const enrichedScored = { ...scored, item: displayItem };
            const prev = candidatePool.get(compositeKey);
            if (!prev || enrichedScored.score > prev.score) {
                candidatePool.set(compositeKey, enrichedScored);
            }
        }
    };

    const finalize = (result) => {
        importSessionCache.set(entry.key, {
            status: result.status,
            confidence: result.confidence,
            stage: result.stage,
            candidates: result.candidates,
            selectedKey: result.selectedKey
        });
        return { ...entry, ...result };
    };

    // 0) IMDb ID Birincil Eşleştirme (/3/find/{imdb_id}?external_source=imdb_id)
    if (entry.imdbId) {
        const findParams = new URLSearchParams({ external_source: 'imdb_id', language: 'tr-TR' });
        const findData = await fetchImportTmdbJson(`${apiBase}/find/${entry.imdbId}?${findParams}`, signal, onRateLimitWait);
        const movieHits = Array.isArray(findData?.movie_results)
            ? findData.movie_results.map(r => ({ ...r, media_type: 'movie' }))
            : [];
        const tvHits = Array.isArray(findData?.tv_results)
            ? findData.tv_results.map(r => ({ ...r, media_type: 'tv' }))
            : [];
        const orderedHits = entry.mediaHint === 'tv'
            ? [...tvHits, ...movieHits]
            : [...movieHits, ...tvHits];

        if (orderedHits.length > 0 && orderedHits[0]?.id) {
            const best = createResolvedCandidateSnapshot(orderedHits[0]);
            const selectedKey = `${best.media_type}:${best.id}`;
            return finalize({
                status: 'matched',
                confidence: 'high',
                stage: 'imdb-id',
                candidates: [best],
                selectedKey
            });
        }
    }

    // 1) Aşama 1: Tam Başlık + Tam Yıl (movie veya tv)
    const queryTitle = entry.title || entry.originalTitle || '';
    if (queryTitle && entry.year) {
        const isTv = entry.mediaHint === 'tv';
        const endpoint = isTv ? 'tv' : 'movie';
        const params = new URLSearchParams({
            query: queryTitle,
            language: 'tr-TR',
            include_adult: 'false'
        });
        params.set(isTv ? 'first_air_date_year' : 'primary_release_year', String(entry.year));
        const stage1Data = await fetchImportTmdbJson(`${apiBase}/search/${endpoint}?${params}`, signal, onRateLimitWait);
        addCandidates(stage1Data?.results, endpoint, true);

        const ranked1 = Array.from(candidatePool.values()).sort((a, b) => b.score - a.score);
        if (
            ranked1.length > 0 &&
            ranked1[0].isTitleExact &&
            ranked1[0].yearDiff === 0 &&
            (ranked1.length === 1 || ranked1[0].score - ranked1[1].score >= 10)
        ) {
            const best = createResolvedCandidateSnapshot(ranked1[0].item);
            return finalize({
                status: 'matched',
                confidence: 'high',
                stage: 1,
                candidates: [best],
                selectedKey: `${best.media_type}:${best.id}`
            });
        }
    }

    // 2) Aşama 2: ±1 Yıl Toleransı + Orijinal Ad + Çoklu Medya (/search/multi)
    if (queryTitle) {
        const multiParams = new URLSearchParams({
            query: queryTitle,
            language: 'tr-TR',
            include_adult: 'false'
        });
        const multiData = await fetchImportTmdbJson(`${apiBase}/search/multi?${multiParams}`, signal, onRateLimitWait);
        addCandidates(multiData?.results, null, true);

        if (entry.originalTitle && normalizeMatchTitle(entry.originalTitle) !== normalizeMatchTitle(queryTitle)) {
            const altParams = new URLSearchParams({
                query: entry.originalTitle,
                language: 'tr-TR',
                include_adult: 'false'
            });
            const altData = await fetchImportTmdbJson(`${apiBase}/search/multi?${altParams}`, signal, onRateLimitWait);
            addCandidates(altData?.results, null, true);
        }

        const hasExactBeforeEn = Array.from(candidatePool.values())
            .some(cand => cand.isTitleExact && (entry.year ? (cand.yearDiff !== null && cand.yearDiff <= 1) : true));
        if (!hasExactBeforeEn) {
            const enParams = new URLSearchParams({
                query: queryTitle,
                language: 'en-US',
                include_adult: 'false'
            });
            const enData = await fetchImportTmdbJson(`${apiBase}/search/multi?${enParams}`, signal, onRateLimitWait);
            addCandidates(enData?.results, null, false);
        }

        const ranked2 = Array.from(candidatePool.values()).sort((a, b) => b.score - a.score);
        if (
            ranked2.length > 0 &&
            ranked2[0].isTitleExact &&
            (entry.year ? (ranked2[0].yearDiff !== null && ranked2[0].yearDiff <= 1) : true) &&
            (ranked2.length === 1 || ranked2[0].score - ranked2[1].score >= 15)
        ) {
            const best = createResolvedCandidateSnapshot(ranked2[0].item);
            return finalize({
                status: 'matched',
                confidence: 'medium',
                stage: 2,
                candidates: [best],
                selectedKey: `${best.media_type}:${best.id}`
            });
        }
    }

    // 3) Aşama 3: Alt Başlıksız Arama + Kullanıcı Onay Kuyruğu
    const rankedBefore3 = Array.from(candidatePool.values()).sort((a, b) => b.score - a.score);
    const mainTitle = extractMainTitle(queryTitle);
    if ((rankedBefore3.length === 0 || rankedBefore3[0].score < 65) && mainTitle) {
        const subParams = new URLSearchParams({
            query: mainTitle,
            language: 'tr-TR',
            include_adult: 'false'
        });
        const subData = await fetchImportTmdbJson(`${apiBase}/search/multi?${subParams}`, signal, onRateLimitWait);
        addCandidates(subData?.results);
    }

    const ranked3 = Array.from(candidatePool.values())
        .filter(scored => scored.score >= 45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    if (ranked3.length > 0) {
        const candidates = ranked3.map(scored => createResolvedCandidateSnapshot(scored.item));
        const defaultSelected = ranked3[0].score >= 65
            ? `${candidates[0].media_type}:${candidates[0].id}`
            : 'skip';
        return finalize({
            status: 'ambiguous',
            confidence: 'low',
            stage: 3,
            candidates,
            selectedKey: defaultSelected
        });
    }

    return finalize({
        status: 'unmatched',
        confidence: null,
        stage: 3,
        candidates: [],
        selectedKey: 'skip'
    });
}

async function resolveAllImportEntries(items, signal, onProgress, onRateLimitWait) {
    const resolved = new Array(items.length);
    let nextIndex = 0;
    let completed = 0;
    const workerCount = Math.min(EXTERNAL_IMPORT_CONCURRENCY, items.length);

    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            if (signal?.aborted) {
                const err = new Error('İçe aktarma iptal edildi.');
                err.name = 'AbortError';
                throw err;
            }
            const idx = nextIndex++;
            if (idx >= items.length) return;
            resolved[idx] = await resolveImportEntry(items[idx], signal, onRateLimitWait);
            completed += 1;
            if (typeof onProgress === 'function') {
                onProgress(completed, items.length, resolved[idx]);
            }
        }
    });

    await Promise.all(workers);
    return resolved;
}

function getSelectedTmdbCandidateForEntry(entry) {
    if (!entry || !entry.selectedKey || entry.selectedKey === 'skip') return null;
    return entry.candidates.find(c => `${c.media_type}:${c.id}` === entry.selectedKey) || null;
}

/**
 * Doğrulanmış ve seçilmiş içe aktarma kayıtlarını Backup v2 uyumlu şema ile atomik olarak kaydeder.
 */
function applyResolvedExternalImport(session, options = {}) {
    if (!session || !Array.isArray(session.items)) {
        throw new Error('İçe aktarılacak veri bulunamadı.');
    }

    const conflictMode = options.conflictMode === 'overwrite' ? 'overwrite' : 'keep';
    const includeWatched = options.includeWatched !== false;

    const currentData = typeof collectCurrentProfileBackupData === 'function'
        ? collectCurrentProfileBackupData(2)
        : {
            watchlist: [],
            ratedMovies: [],
            movieRatings: {},
            favoriteActors: [],
            recentlyViewed: [],
            userSubscribedProviders: [],
            tvEpisodeProgress: {},
            savedSharedLists: []
        };

    const normalizeItem = typeof normalizeBackupMovieItem === 'function'
        ? normalizeBackupMovieItem
        : item => item;

    const watchlistMap = new Map();
    for (const item of currentData.watchlist || []) {
        const key = `${resolveProfileItemMediaType(item)}:${item.id}`;
        watchlistMap.set(key, item);
    }

    const ratedMap = new Map();
    for (const item of currentData.ratedMovies || []) {
        const key = `${resolveProfileItemMediaType(item)}:${item.id}`;
        ratedMap.set(key, item);
    }

    const movieRatings = typeof normalizeBackupRatings === 'function'
        ? normalizeBackupRatings(currentData.movieRatings, false)
        : { ...(currentData.movieRatings || {}) };

    const selectedByCandidateKey = new Map();
    let appliedWatchlistCount = 0;
    let appliedRatingsCount = 0;
    let appliedWatchedCount = 0;

    for (const entry of session.items) {
        const chosen = getSelectedTmdbCandidateForEntry(entry);
        if (!chosen) continue;

        const candidateWithImdb = (entry.imdbId || entry.imdbRating)
            ? {
                ...chosen,
                ...(entry.imdbId ? { imdb_id: entry.imdbId } : {}),
                ...(entry.imdbRating ? { imdb_rating: entry.imdbRating } : {})
            }
            : chosen;

        const safeItem = normalizeItem(candidateWithImdb);
        if (!safeItem) continue;

        if (typeof setCachedMedia === 'function') {
            setCachedMedia(safeItem, safeItem.media_type);
        }

        const compositeKey = `${safeItem.media_type}:${safeItem.id}`;
        selectedByCandidateKey.set(entry.key, safeItem);

        if (entry.inWatchlist && !watchlistMap.has(compositeKey)) {
            watchlistMap.set(compositeKey, safeItem);
            appliedWatchlistCount += 1;
        }

        if (entry.rating !== null && entry.rating !== undefined) {
            const existingRating = typeof getUserRatingForMedia === 'function'
                ? getUserRatingForMedia(movieRatings, safeItem.id, safeItem.media_type)
                : movieRatings[compositeKey];

            if (existingRating === null || existingRating === undefined || conflictMode === 'overwrite') {
                movieRatings[compositeKey] = entry.rating;
                const otherType = safeItem.media_type === 'movie' ? 'tv' : 'movie';
                if (movieRatings[`${otherType}:${safeItem.id}`] === undefined) {
                    movieRatings[safeItem.id] = entry.rating;
                } else {
                    delete movieRatings[safeItem.id];
                }
                appliedRatingsCount += 1;
            }

            if (!ratedMap.has(compositeKey)) {
                ratedMap.set(compositeKey, safeItem);
            }
        } else if (entry.inWatched && includeWatched) {
            if (!ratedMap.has(compositeKey)) {
                ratedMap.set(compositeKey, safeItem);
                appliedWatchedCount += 1;
            }
        }
    }

    // Letterboxd listelerini Seçkilerim (savedSharedLists) formatına dönüştür
    const existingLists = Array.isArray(currentData.savedSharedLists) ? [...currentData.savedSharedLists] : [];
    const existingRoutes = new Set(existingLists.map(l => l.route));
    const maxListItems = getImportSharedListMaxItems();
    const maxLists = getImportSavedListsMax();
    const newLists = [];
    let appliedListCount = 0;

    for (const listDef of Array.isArray(session.lists) ? session.lists : []) {
        const resolvedItems = [];
        for (const candidateKey of listDef.candidateKeys || []) {
            const matchedItem = selectedByCandidateKey.get(candidateKey);
            if (!matchedItem) continue;
            const snapshot = typeof normalizeShareListItemSnapshot === 'function'
                ? normalizeShareListItemSnapshot(matchedItem)
                : matchedItem;
            if (snapshot) resolvedItems.push(snapshot);
            if (resolvedItems.length >= maxListItems) break;
        }

        if (!resolvedItems.length || typeof buildSharedListRoute !== 'function') continue;

        const customTitle = typeof normalizeSharedListTitle === 'function'
            ? normalizeSharedListTitle(listDef.title, 'İçe Aktarılan Seçki')
            : String(listDef.title || 'İçe Aktarılan Seçki').slice(0, 80);
        const route = buildSharedListRoute(customTitle, resolvedItems);
        if (!route || existingRoutes.has(route)) continue;

        existingRoutes.add(route);
        newLists.push({
            id: `import_${Date.now()}_${newLists.length}_${Math.random().toString(36).slice(2, 6)}`,
            title: customTitle,
            route,
            items: resolvedItems,
            updatedAt: Date.now()
        });
        appliedListCount += 1;
    }

    const finalData = {
        ...currentData,
        watchlist: Array.from(watchlistMap.values()),
        ratedMovies: Array.from(ratedMap.values()),
        movieRatings,
        savedSharedLists: [...newLists, ...existingLists].slice(0, maxLists)
    };

    if (typeof writeProfileBackupData === 'function') {
        writeProfileBackupData(finalData);
    } else {
        Object.entries(finalData).forEach(([k, v]) => {
            if (typeof safeWriteStorage === 'function') safeWriteStorage(k, v);
        });
    }

    return {
        appliedWatchlistCount,
        appliedRatingsCount,
        appliedWatchedCount,
        appliedListCount,
        totalSelectedItems: selectedByCandidateKey.size
    };
}

function setExternalImportStatus(message, state = '') {
    const status = document.getElementById('external-import-status');
    if (!status) return;
    status.textContent = String(message || '');
    status.dataset.state = state;
}

function formatCandidateOptionLabel(candidate) {
    const title = candidate.title || candidate.name || 'Bilinmiyor';
    const year = parseYearToken(candidate.release_date || candidate.first_air_date);
    const typeLabel = candidate.media_type === 'tv' ? 'Dizi' : 'Film';
    return `${title}${year ? ` (${year})` : ''} • ${typeLabel}`;
}

function hideExternalImportPosterPreview() {
    const preview = document.getElementById('external-import-poster-preview');
    if (!preview) return;
    preview.hidden = true;
    preview.replaceChildren();
}

function showExternalImportPosterPreview(candidate, anchorEl) {
    if (typeof document === 'undefined' || !candidate || !anchorEl) return;
    const preview = document.getElementById('external-import-poster-preview');
    if (!preview) return;

    const img = document.createElement('img');
    img.src = getImportValidTmdbImageUrl(candidate.poster_path, 'w342');
    img.alt = '';
    img.className = 'external-import-poster-preview-img';

    const titleText = String(candidate.title || candidate.name || 'Bilinmiyor');
    const origText = String(candidate.original_title || candidate.original_name || '').trim();
    const titleEl = document.createElement('strong');
    titleEl.className = 'external-import-poster-preview-title';
    titleEl.textContent = titleText;

    const metaParts = [];
    const year = parseYearToken(candidate.release_date || candidate.first_air_date);
    if (year) metaParts.push(String(year));
    metaParts.push(candidate.media_type === 'tv' ? 'Dizi' : 'Film');
    const vote = Number(candidate.vote_average);
    if (Number.isFinite(vote) && vote > 0) metaParts.push(`TMDB ${vote.toFixed(1)}`);

    const metaEl = document.createElement('span');
    metaEl.className = 'external-import-poster-preview-meta';
    metaEl.textContent = metaParts.join(' • ');

    const bodyChildren = [titleEl, metaEl];
    if (origText && origText.toLowerCase() !== titleText.toLowerCase()) {
        const origEl = document.createElement('span');
        origEl.className = 'external-import-poster-preview-orig';
        origEl.textContent = origText;
        bodyChildren.splice(1, 0, origEl);
    }

    const rawOverview = String(candidate.overview || '').trim();
    if (rawOverview) {
        const overviewEl = document.createElement('p');
        overviewEl.className = 'external-import-poster-preview-overview';
        overviewEl.textContent = rawOverview.length > 160 ? `${rawOverview.slice(0, 157).trimEnd()}…` : rawOverview;
        bodyChildren.push(overviewEl);
    }

    preview.replaceChildren(img, ...bodyChildren);
    preview.hidden = false;

    if (typeof anchorEl.getBoundingClientRect === 'function' && typeof window !== 'undefined') {
        const rect = anchorEl.getBoundingClientRect();
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 800;
        const cardW = 228;
        const cardH = preview.offsetHeight || 390;

        let left = rect.right + 12;
        if (left + cardW > vw - 12) {
            left = rect.left - cardW - 12;
        }
        if (left < 12) {
            left = Math.max(12, Math.min(vw - cardW - 12, rect.left + (rect.width - cardW) / 2));
        }
        const top = Math.max(12, Math.min(vh - cardH - 12, rect.top - 24));
        preview.style.left = `${Math.round(left)}px`;
        preview.style.top = `${Math.round(top)}px`;
    }
}

function renderExternalImportAmbiguousList(session) {
    const listWrap = document.getElementById('external-import-ambiguous-section');
    const listContainer = document.getElementById('external-import-ambiguous-list');
    if (!listWrap || !listContainer) return;

    const ambiguousItems = session.items.filter(item => item.status === 'ambiguous');
    if (ambiguousItems.length === 0) {
        listWrap.hidden = true;
        listContainer.replaceChildren();
        return;
    }

    listWrap.hidden = false;
    const fragment = document.createDocumentFragment();

    ambiguousItems.forEach((entry, rowIdx) => {
        const row = document.createElement('fieldset');
        row.className = 'external-import-ambiguous-row';

        const legend = document.createElement('legend');
        legend.className = 'external-import-ambiguous-title';
        const metaParts = [];
        if (entry.year) metaParts.push(String(entry.year));
        if (entry.rating) metaParts.push(`Puan: ${entry.rating}/10`);
        if (entry.inWatchlist) metaParts.push('İzleme Listesi');
        legend.textContent = `${entry.title}${metaParts.length ? ` (${metaParts.join(' • ')})` : ''}`;
        row.appendChild(legend);

        const optionsWrap = document.createElement('div');
        optionsWrap.className = 'external-import-candidate-grid';

        const groupName = `ext-imp-choice-${rowIdx}`;

        entry.candidates.forEach(cand => {
            const valueKey = `${cand.media_type}:${cand.id}`;
            const label = document.createElement('label');
            label.className = 'external-import-candidate-option';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = groupName;
            radio.value = valueKey;
            radio.checked = entry.selectedKey === valueKey;
            radio.addEventListener('change', () => {
                entry.selectedKey = valueKey;
                updateExternalImportConfirmCount(session);
            });

            const thumb = document.createElement('img');
            thumb.src = getImportValidTmdbImageUrl(cand.poster_path, 'w154');
            thumb.alt = '';
            thumb.loading = 'lazy';
            thumb.className = 'external-import-candidate-thumb';

            const textSpan = document.createElement('span');
            textSpan.className = 'external-import-candidate-label';
            textSpan.textContent = formatCandidateOptionLabel(cand);

            label.addEventListener('mouseenter', () => showExternalImportPosterPreview(cand, label));
            label.addEventListener('focusin', () => showExternalImportPosterPreview(cand, label));
            label.addEventListener('mouseleave', hideExternalImportPosterPreview);
            label.addEventListener('focusout', event => {
                if (!event.relatedTarget || !label.contains(event.relatedTarget)) {
                    hideExternalImportPosterPreview();
                }
            });

            label.append(radio, thumb, textSpan);
            optionsWrap.appendChild(label);
        });

        const skipLabel = document.createElement('label');
        skipLabel.className = 'external-import-candidate-option is-skip';
        const skipRadio = document.createElement('input');
        skipRadio.type = 'radio';
        skipRadio.name = groupName;
        skipRadio.value = 'skip';
        skipRadio.checked = entry.selectedKey === 'skip';
        skipRadio.addEventListener('change', () => {
            entry.selectedKey = 'skip';
            updateExternalImportConfirmCount(session);
        });
        const skipText = document.createElement('span');
        skipText.className = 'external-import-candidate-label';
        skipText.textContent = 'Bu yapımı atla';
        skipLabel.append(skipRadio, skipText);
        optionsWrap.appendChild(skipLabel);

        row.appendChild(optionsWrap);
        fragment.appendChild(row);
    });

    listContainer.replaceChildren(fragment);
}

function updateExternalImportConfirmCount(session) {
    const confirmBtn = document.getElementById('external-import-confirm-btn');
    if (!confirmBtn) return;
    const selectedCount = session.items.filter(entry => Boolean(getSelectedTmdbCandidateForEntry(entry))).length;
    confirmBtn.disabled = selectedCount === 0;
    confirmBtn.textContent = selectedCount > 0
        ? `Seçilenleri Profilime Aktar (${selectedCount})`
        : 'Aktarılacak Yapım Seçilmedi';
}

function renderExternalImportPreview(session) {
    const progressSec = document.getElementById('external-import-progress-section');
    const previewSec = document.getElementById('external-import-preview-section');
    const summaryWrap = document.getElementById('external-import-summary');
    const watchedWrap = document.getElementById('external-import-watched-wrap');
    const watchedCheckbox = document.getElementById('external-import-include-watched');
    const unmatchedDetails = document.getElementById('external-import-unmatched-details');
    const unmatchedList = document.getElementById('external-import-unmatched-list');

    if (progressSec) progressSec.hidden = true;
    if (previewSec) previewSec.hidden = false;

    const matchedCount = session.items.filter(i => i.status === 'matched').length;
    const ambiguousCount = session.items.filter(i => i.status === 'ambiguous').length;
    const unmatchedItems = session.items.filter(i => i.status === 'unmatched');

    if (summaryWrap) {
        const cards = [
            { label: 'Otomatik Eşleşen', value: matchedCount, tone: 'matched' },
            { label: 'Onay Bekleyen', value: ambiguousCount, tone: 'ambiguous' },
            { label: 'Bulunamayan', value: unmatchedItems.length, tone: 'unmatched' }
        ];
        if (session.lists.length > 0) {
            cards.push({ label: 'Aktarılacak Seçki', value: session.lists.length, tone: 'lists' });
        }

        const grid = document.createElement('div');
        grid.className = 'external-import-summary-grid';
        for (const card of cards) {
            const box = document.createElement('div');
            box.className = `external-import-stat ${card.tone}`;
            const valEl = document.createElement('strong');
            valEl.textContent = String(card.value);
            const lblEl = document.createElement('span');
            lblEl.textContent = card.label;
            box.append(valEl, lblEl);
            grid.appendChild(box);
        }

        const notes = [];
        if (session.stats.skippedEpisodes > 0) {
            notes.push(`${session.stats.skippedEpisodes} tekil dizi bölümü (tvEpisode) atlandı.`);
        }
        if (session.stats.hitMaxItems) {
            notes.push(`Tek seferde en fazla ${EXTERNAL_IMPORT_MAX_UNIQUE_ITEMS} benzersiz yapım işlenir; fazlalar atlandı.`);
        }
        const truncatedLists = session.lists.filter(l => l.truncatedCount > 0);
        if (truncatedLists.length > 0) {
            notes.push(`Seçkiler en fazla ${getImportSharedListMaxItems()} yapımla sınırlandırıldı.`);
        }

        summaryWrap.replaceChildren(grid);
        if (notes.length > 0) {
            const noteEl = document.createElement('p');
            noteEl.className = 'external-import-notes';
            noteEl.textContent = notes.join(' ');
            summaryWrap.appendChild(noteEl);
        }
    }

    const hasUnratedWatched = session.items.some(i => i.inWatched && (i.rating === null || i.rating === undefined));
    if (watchedWrap && watchedCheckbox) {
        watchedWrap.hidden = !hasUnratedWatched;
        watchedCheckbox.checked = true;
    }

    renderExternalImportAmbiguousList(session);

    if (unmatchedDetails && unmatchedList) {
        if (unmatchedItems.length === 0) {
            unmatchedDetails.hidden = true;
            unmatchedList.replaceChildren();
        } else {
            unmatchedDetails.hidden = false;
            const summaryTitle = unmatchedDetails.querySelector('summary');
            if (summaryTitle) {
                summaryTitle.textContent = `Bulunamayan Yapımlar (${unmatchedItems.length})`;
            }
            unmatchedList.replaceChildren(...unmatchedItems.map(item => {
                const li = document.createElement('li');
                li.textContent = `${item.title}${item.year ? ` (${item.year})` : ''}${item.imdbId ? ` [${item.imdbId}]` : ''}`;
                return li;
            }));
        }
    }

    updateExternalImportConfirmCount(session);
}

function updateExternalImportProgressUi(done, total, rateWaitSeconds = 0) {
    const label = document.getElementById('external-import-progress-label');
    const bar = document.getElementById('external-import-progress-bar');
    const note = document.getElementById('external-import-rate-note');

    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    if (label) {
        label.textContent = `Yapımlar TMDB ile eşleştiriliyor: ${done} / ${total} (%${percent})`;
    }
    if (bar) {
        bar.style.width = `${percent}%`;
        bar.setAttribute('aria-valuenow', String(percent));
    }
    if (note) {
        if (rateWaitSeconds > 0) {
            note.hidden = false;
            note.textContent = `TMDB istek sınırına ulaşıldı. ${rateWaitSeconds} saniye beklenip otomatik devam edilecek…`;
        } else {
            note.hidden = true;
            note.textContent = '';
        }
    }
}

function openExternalImportModalForProgress() {
    const modal = document.getElementById('external-import-modal');
    const manager = typeof window !== 'undefined' ? window.ModalManager : null;
    if (!modal || typeof manager?.openModal !== 'function') return;

    const progressSec = document.getElementById('external-import-progress-section');
    const previewSec = document.getElementById('external-import-preview-section');
    if (progressSec) progressSec.hidden = false;
    if (previewSec) previewSec.hidden = true;

    updateExternalImportProgressUi(0, 1, 0);
    manager.openModal(modal);
}

function closeExternalImportModal(event = null, force = false) {
    const modal = document.getElementById('external-import-modal');
    const manager = typeof window !== 'undefined' ? window.ModalManager : null;
    if (!modal) return;
    if (!force && event && event.target !== modal) return;

    if (activeExternalImportAbortController) {
        activeExternalImportAbortController.abort();
        activeExternalImportAbortController = null;
    }
    activeExternalImportSession = null;
    hideExternalImportPosterPreview();

    if (typeof manager?.closeModal === 'function') {
        manager.closeModal(modal);
    } else {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        modal.inert = true;
    }
}

async function readBrowserSelectedImportFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return [];
    if (files.length > EXTERNAL_IMPORT_MAX_FILES) {
        throw new Error(`Tek seferde en fazla ${EXTERNAL_IMPORT_MAX_FILES} dosya yüklenebilir.`);
    }

    const csvEntries = [];
    for (const file of files) {
        if (file.size > EXTERNAL_IMPORT_MAX_FILE_BYTES) {
            throw new Error(`"${file.name}" dosyası 10 MB boyut sınırını aşıyor.`);
        }
        const lower = String(file.name || '').toLowerCase();
        if (lower.endsWith('.zip')) {
            const buffer = await file.arrayBuffer();
            const extracted = await extractZipCsvEntries(buffer);
            csvEntries.push(...extracted);
        } else if (lower.endsWith('.csv')) {
            const text = await file.text();
            csvEntries.push({ name: file.name, text });
        } else {
            throw new Error(`Desteklenmeyen dosya türü: ${file.name}. Yalnızca .csv ve .zip dosyaları yüklenebilir.`);
        }
    }
    return csvEntries;
}

async function handleExternalImportFileSelection(event) {
    const input = event?.currentTarget;
    const files = input?.files;
    if (!files || files.length === 0) return;

    if (activeExternalImportAbortController) {
        activeExternalImportAbortController.abort();
    }

    try {
        setExternalImportStatus('Dosyalar okunuyor ve çözümleniyor…');
        const csvEntries = await readBrowserSelectedImportFiles(files);
        const parsed = parseImportFiles(csvEntries);

        if (parsed.items.length === 0) {
            setExternalImportStatus(
                'Seçilen dosyalarda içe aktarılabilir IMDb veya Letterboxd kaydı bulunamadı.',
                'error'
            );
            return;
        }

        const controller = new AbortController();
        activeExternalImportAbortController = controller;
        openExternalImportModalForProgress();
        updateExternalImportProgressUi(0, parsed.items.length, 0);

        let completedCount = 0;
        const resolvedItems = await resolveAllImportEntries(
            parsed.items,
            controller.signal,
            (done, total) => {
                completedCount = done;
                updateExternalImportProgressUi(done, total, 0);
            },
            waitSec => {
                updateExternalImportProgressUi(completedCount, parsed.items.length, waitSec);
            }
        );

        if (controller.signal.aborted) return;
        activeExternalImportAbortController = null;

        activeExternalImportSession = {
            ...parsed,
            items: resolvedItems
        };
        renderExternalImportPreview(activeExternalImportSession);
    } catch (error) {
        if (error?.name === 'AbortError') {
            setExternalImportStatus('İçe aktarma iptal edildi.');
            return;
        }
        console.warn('IMDb / Letterboxd içe aktarma hatası:', error);
        closeExternalImportModal(null, true);
        setExternalImportStatus(
            error?.message || 'Dosyalar okunurken bir hata oluştu.',
            'error'
        );
    } finally {
        if (input) input.value = '';
    }
}

function confirmExternalImportSelection() {
    if (!activeExternalImportSession) return;
    const conflictMode = document.getElementById('external-import-conflict-mode')?.value === 'overwrite'
        ? 'overwrite'
        : 'keep';
    const includeWatched = document.getElementById('external-import-include-watched')?.checked !== false;

    try {
        const result = applyResolvedExternalImport(activeExternalImportSession, {
            conflictMode,
            includeWatched
        });

        closeExternalImportModal(null, true);

        const refreshFns = [
            typeof renderSavedSharedListsSection === 'function' ? renderSavedSharedListsSection : null,
            typeof renderTvTrackerSection === 'function' ? renderTvTrackerSection : null,
            typeof loadProfile === 'function'
                ? () => loadProfile(null, { refreshCollectionSections: false, persistTrackedTvRuntime: false })
                : null
        ];
        for (const fn of refreshFns) {
            try { fn?.(); } catch (_) {}
        }

        const summaryParts = [];
        if (result.appliedWatchlistCount > 0) summaryParts.push(`${result.appliedWatchlistCount} izleme listesi`);
        if (result.appliedRatingsCount > 0) summaryParts.push(`${result.appliedRatingsCount} puan`);
        if (result.appliedWatchedCount > 0) summaryParts.push(`${result.appliedWatchedCount} izlenen`);
        if (result.appliedListCount > 0) summaryParts.push(`${result.appliedListCount} seçki`);

        const statusText = summaryParts.length > 0
            ? `İçe aktarma tamamlandı: ${summaryParts.join(', ')} profiline eklendi.`
            : 'Seçilen yapımlar zaten profilinde güncel durumda.';
        setExternalImportStatus(statusText, 'success');
        if (typeof announceA11y === 'function') announceA11y(statusText);
    } catch (error) {
        console.warn('İçe aktarma kaydedilemedi:', error);
        setExternalImportStatus(
            'Veriler kaydedilemedi (tarayıcı depolama kotası dolmuş olabilir). Mevcut verileriniz korundu.',
            'error'
        );
    }
}

function bindExternalImportControls() {
    const triggerBtn = document.getElementById('external-import-btn');
    const fileInput = document.getElementById('external-import-file');
    const modal = document.getElementById('external-import-modal');
    const closeBtn = modal?.querySelector('.close-btn');
    const abortBtn = document.getElementById('external-import-abort-btn');
    const cancelBtn = document.getElementById('external-import-cancel-preview-btn');
    const confirmBtn = document.getElementById('external-import-confirm-btn');

    if (triggerBtn && fileInput) {
        triggerBtn.addEventListener('click', () => {
            fileInput.value = '';
            fileInput.click();
        });
    }
    if (fileInput) {
        fileInput.addEventListener('change', handleExternalImportFileSelection);
    }
    if (modal) {
        modal.addEventListener('click', event => closeExternalImportModal(event, false));
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeExternalImportModal(null, true));
    }
    if (abortBtn) {
        abortBtn.addEventListener('click', () => closeExternalImportModal(null, true));
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => closeExternalImportModal(null, true));
    }
    if (confirmBtn) {
        confirmBtn.addEventListener('click', confirmExternalImportSelection);
    }
    const ambiguousList = document.getElementById('external-import-ambiguous-list');
    if (ambiguousList) {
        ambiguousList.addEventListener('scroll', hideExternalImportPosterPreview, { passive: true });
    }
    const modalDialog = modal?.querySelector('.external-import-modal-content');
    if (modalDialog) {
        modalDialog.addEventListener('scroll', hideExternalImportPosterPreview, { passive: true });
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', bindExternalImportControls);
}
