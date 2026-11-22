let profileMutationGeneration = 0;

function resolveProfileItemMediaType(item, explicitMediaType = null) {
    const explicit = normalizeMediaType(explicitMediaType);
    if (explicit) return explicit;
    if (typeof inferItemMediaType === 'function') {
        return inferItemMediaType(item, 'movie');
    }
    if (item && (item.first_air_date || (item.name && !item.title))) {
        return 'tv';
    }
    return normalizeMediaType(item?.media_type, 'movie');
}

function isSameProfileMedia(entry, targetId, targetMediaType) {
    const entryId = normalizeTmdbId(entry?.id);
    if (entryId !== targetId) return false;
    const entryType = resolveProfileItemMediaType(entry, null);
    return entryType === targetMediaType;
}

function toggleWatchlist(btnElem, movieId, mediaType = null) {
    const safeId = normalizeTmdbId(movieId);
    if (!safeId) return;

    const inferredBtnType = normalizeMediaType(mediaType) ||
        normalizeMediaType(btnElem?.dataset?.mediaType) ||
        (window.currentMovieId === safeId ? normalizeMediaType(window.currentMediaType) : null);

    const item = (typeof getCachedMedia === 'function'
        ? getCachedMedia(safeId, inferredBtnType)
        : null) || window.movieCache?.[safeId];
    if (!item) return;

    const resolvedType = resolveProfileItemMediaType(item, inferredBtnType);
    const normalizedItem = {
        ...item,
        id: safeId,
        media_type: resolvedType
    };

    profileMutationGeneration++;
    let watchlist = typeof safeReadStorage === 'function'
        ? safeReadStorage('watchlist', [])
        : [];
    const existingIndex = watchlist.findIndex(w => isSameProfileMedia(w, safeId, resolvedType));
    const isAdding = existingIndex === -1;

    if (!isAdding) {
        watchlist.splice(existingIndex, 1);
    } else {
        watchlist.push(normalizedItem);
    }

    if (typeof safeWriteStorage === 'function') {
        safeWriteStorage('watchlist', watchlist);
    } else {
        try { localStorage.setItem('watchlist', JSON.stringify(watchlist)); } catch (e) {}
    }

    const allBtns = document.querySelectorAll(
        `button[data-media-id="${safeId}"][data-media-type="${resolvedType}"], button[data-media-id="${safeId}"]:not([data-media-type]), button[onclick*="toggleWatchlist(this, ${safeId})"], button[onclick*="toggleWatchlist(this, ${safeId},"]`
    );
    allBtns.forEach(btn => {
        const btnType = normalizeMediaType(btn.dataset?.mediaType);
        if (btnType && btnType !== resolvedType) return;
        if (!isAdding) {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-label', 'Listeme ekle');
        } else {
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            btn.setAttribute('aria-label', 'Listeden çıkar');
        }
    });

    const modalBtn = document.getElementById("modal-wl-btn");
    const modalMatchesType = !window.currentMediaType || window.currentMediaType === resolvedType;
    if (modalBtn && window.currentMovieId === safeId && modalMatchesType) {
        if (!isAdding) {
            modalBtn.classList.remove('active');
            modalBtn.classList.add('inactive');
            modalBtn.setAttribute('aria-pressed', 'false');
            modalBtn.setAttribute('aria-label', 'Listeme ekle');
            modalBtn.innerHTML = '<i class="fas fa-heart"></i> Listeme Ekle';
            modalBtn.style.background = "";
            modalBtn.style.color = "";
        } else {
            modalBtn.classList.remove('inactive');
            modalBtn.classList.add('active');
            modalBtn.setAttribute('aria-pressed', 'true');
            modalBtn.setAttribute('aria-label', 'Listeden çıkar');
            modalBtn.innerHTML = `<i class="fas fa-heart"></i> Listeden Çıkar`;
            modalBtn.style.background = "";
            modalBtn.style.color = "";
        }
    }

    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }

    if (typeof loadSmartRecommendations === 'function') {
        const homeTab = document.getElementById('now-playing');
        const profileRecs = document.getElementById('profile-smart-recs');
        if ((homeTab && homeTab.classList.contains('active-tab')) || (profileRecs && profileRecs.classList.contains('active-tab'))) {
            loadSmartRecommendations();
        }
    }
}

function toggleRateMenu(id) {
    const menu = document.getElementById(`rate-menu-${id}`);
    if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

function saveRating(id, rating, mediaType = null) {
    const safeId = normalizeTmdbId(id);
    const safeRating = normalizeUserRating(rating);
    if (!safeId || safeRating === null) return;

    const explicitType = normalizeMediaType(mediaType) ||
        (window.currentMovieId === safeId ? normalizeMediaType(window.currentMediaType) : null);
    const item = (typeof getCachedMedia === 'function'
        ? getCachedMedia(safeId, explicitType)
        : null) || window.movieCache?.[safeId];
    const resolvedType = resolveProfileItemMediaType(item, explicitType);
    const compositeKey = `${resolvedType}:${safeId}`;
    const otherType = resolvedType === 'movie' ? 'tv' : 'movie';
    const otherKey = `${otherType}:${safeId}`;

    profileMutationGeneration++;
    const savedRatings = typeof safeReadStorage === 'function'
        ? { ...safeReadStorage('movieRatings', {}) }
        : JSON.parse(localStorage.getItem('movieRatings') || '{}');

    savedRatings[compositeKey] = safeRating;
    if (savedRatings[otherKey] === undefined) {
        savedRatings[safeId] = safeRating;
    } else {
        delete savedRatings[safeId];
    }

    if (typeof safeWriteStorage === 'function') {
        safeWriteStorage('movieRatings', savedRatings);
    } else {
        try { localStorage.setItem('movieRatings', JSON.stringify(savedRatings)); } catch (e) {}
    }

    if (item) {
        const normalizedItem = {
            ...item,
            id: safeId,
            media_type: resolvedType
        };
        let ratedMovies = typeof safeReadStorage === 'function'
            ? safeReadStorage('ratedMovies', [])
            : JSON.parse(localStorage.getItem('ratedMovies') || '[]');
        const existingIdx = ratedMovies.findIndex(m => isSameProfileMedia(m, safeId, resolvedType));
        if (existingIdx === -1) {
            ratedMovies.push(normalizedItem);
        } else {
            ratedMovies[existingIdx] = {
                ...ratedMovies[existingIdx],
                ...normalizedItem
            };
        }
        if (typeof safeWriteStorage === 'function') {
            safeWriteStorage('ratedMovies', ratedMovies);
        } else {
            try { localStorage.setItem('ratedMovies', JSON.stringify(ratedMovies)); } catch (e) {}
        }
    }

    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }

    if (typeof loadSmartRecommendations === 'function') {
        const homeTab = document.getElementById('now-playing');
        const profileRecs = document.getElementById('profile-smart-recs');
        if ((homeTab && homeTab.classList.contains('active-tab')) || (profileRecs && profileRecs.classList.contains('active-tab'))) {
            loadSmartRecommendations();
        }
    }

    const textSpan = document.getElementById(`rate-text-${safeId}`);
    if (textSpan) textSpan.innerText = `Puanım: ${safeRating}/10`;
    const btn = textSpan ? textSpan.parentElement : null;
    if (btn) {
        btn.classList.add('active');
        btn.classList.remove('inactive');
    }
    const menu = document.getElementById(`rate-menu-${safeId}`);
    if (menu) menu.style.display = 'none';
}

function removeRating(id, mediaType = null) {
    const safeId = normalizeTmdbId(id);
    if (!safeId) return;

    const explicitType = normalizeMediaType(mediaType) ||
        (window.currentMovieId === safeId ? normalizeMediaType(window.currentMediaType) : null);
    const item = (typeof getCachedMedia === 'function'
        ? getCachedMedia(safeId, explicitType)
        : null) || window.movieCache?.[safeId];
    const resolvedType = explicitType || (item ? resolveProfileItemMediaType(item, null) : null);

    profileMutationGeneration++;
    const savedRatings = typeof safeReadStorage === 'function'
        ? { ...safeReadStorage('movieRatings', {}) }
        : JSON.parse(localStorage.getItem('movieRatings') || '{}');

    if (resolvedType) {
        const compositeKey = `${resolvedType}:${safeId}`;
        const otherType = resolvedType === 'movie' ? 'tv' : 'movie';
        const otherKey = `${otherType}:${safeId}`;
        delete savedRatings[compositeKey];
        if (savedRatings[otherKey] !== undefined) {
            savedRatings[safeId] = savedRatings[otherKey];
        } else {
            delete savedRatings[safeId];
        }
    } else {
        delete savedRatings[safeId];
        delete savedRatings[`movie:${safeId}`];
        delete savedRatings[`tv:${safeId}`];
    }

    if (typeof safeWriteStorage === 'function') {
        safeWriteStorage('movieRatings', savedRatings);
    } else {
        try { localStorage.setItem('movieRatings', JSON.stringify(savedRatings)); } catch (e) {}
    }

    let ratedMovies = typeof safeReadStorage === 'function'
        ? safeReadStorage('ratedMovies', [])
        : JSON.parse(localStorage.getItem('ratedMovies') || '[]');
    ratedMovies = ratedMovies.filter(m => {
        const mId = normalizeTmdbId(m?.id);
        if (mId !== safeId) return true;
        if (!resolvedType) return false;
        return resolveProfileItemMediaType(m, null) !== resolvedType;
    });

    if (typeof safeWriteStorage === 'function') {
        safeWriteStorage('ratedMovies', ratedMovies);
    } else {
        try { localStorage.setItem('ratedMovies', JSON.stringify(ratedMovies)); } catch (e) {}
    }

    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }

    if (typeof loadSmartRecommendations === 'function') {
        const homeTab = document.getElementById('now-playing');
        const profileRecs = document.getElementById('profile-smart-recs');
        if ((homeTab && homeTab.classList.contains('active-tab')) || (profileRecs && profileRecs.classList.contains('active-tab'))) {
            loadSmartRecommendations();
        }
    }

    const textSpan = document.getElementById(`rate-text-${safeId}`);
    if (textSpan) textSpan.innerText = "İzledim / Puan Ver";
    const btn = textSpan ? textSpan.parentElement : null;
    if (btn) {
        btn.classList.remove('active');
        btn.classList.add('inactive');
    }
    const menu = document.getElementById(`rate-menu-${safeId}`);
    if (menu) menu.style.display = 'none';
}

function renderRecentlyViewed(routeContext = null) {
    const recent = typeof safeReadStorage === 'function'
        ? safeReadStorage('recentlyViewed', [])
        : [];
    const container = document.getElementById('recently-viewed-grid');
    const section = document.getElementById('recently-viewed-section');
    if (!container) return;

    if (!Array.isArray(recent) || recent.length === 0) {
        if (section) section.style.display = 'none';
    } else {
        if (section) section.style.display = 'block';
        container.innerHTML = recent.map(item => {
            const mType = resolveProfileItemMediaType(item, null);
            return createMovieCard(item, mType, "");
        }).join('');
        recent.forEach(item => {
            const mType = resolveProfileItemMediaType(item, null);
            fetchAndInjectProviders(item.id, mType, item, routeContext);
        });
    }
}


const PROFILE_BACKUP_APP = 'FilmimNerede';
const PROFILE_BACKUP_VERSION = 2;
const PROFILE_BACKUP_SUPPORTED_VERSIONS = new Set([1, 2]);
const PROFILE_BACKUP_MAX_FILE_BYTES = 5 * 1024 * 1024;
const PROFILE_BACKUP_V1_STORAGE_KEYS = [
    'watchlist',
    'ratedMovies',
    'movieRatings',
    'favoriteActors',
    'recentlyViewed'
];
const PROFILE_BACKUP_STORAGE_KEYS = [
    ...PROFILE_BACKUP_V1_STORAGE_KEYS,
    'userSubscribedProviders',
    'tvEpisodeProgress',
    'savedSharedLists'
];

function isPlainBackupObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readProfileBackupStorage(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
        console.warn(`Profil verisi okunamadı (${key}):`, error);
        return fallback;
    }
}

function normalizeBackupText(value, maxLength) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function normalizeBackupDate(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
}

function normalizeBackupMovieItem(item) {
    if (!isPlainBackupObject(item)) return null;

    const id = normalizeTmdbId(item.id);
    if (!id) return null;

    const title = normalizeBackupText(item.title, 300);
    const name = normalizeBackupText(item.name, 300);
    const releaseDate = normalizeBackupDate(item.release_date);
    const firstAirDate = normalizeBackupDate(item.first_air_date);
    const inferredMediaType = firstAirDate || (name && !title) ? 'tv' : 'movie';
    const mediaType = normalizeMediaType(item.media_type, inferredMediaType);
    if (!mediaType) return null;

    const normalized = {
        id,
        title,
        name,
        release_date: releaseDate,
        first_air_date: firstAirDate,
        poster_path: isValidTmdbImagePath(item.poster_path) ? item.poster_path : null,
        backdrop_path: isValidTmdbImagePath(item.backdrop_path) ? item.backdrop_path : null,
        overview: normalizeBackupText(item.overview, 12000),
        genre_ids: Array.isArray(item.genre_ids)
            ? Array.from(new Set(
                item.genre_ids
                    .map(genreId => normalizeTmdbId(genreId))
                    .filter(Boolean)
            )).slice(0, 50)
            : [],
        media_type: mediaType
    };

    const voteAverage = Number(item.vote_average);
    if (Number.isFinite(voteAverage) && voteAverage >= 0 && voteAverage <= 10) {
        normalized.vote_average = voteAverage;
    }

    const exactRuntime = Number(item.exact_runtime_mins_v2);
    if (Number.isFinite(exactRuntime) && exactRuntime > 0 && exactRuntime <= 1000000) {
        normalized.exact_runtime_mins_v2 = exactRuntime;
    }

    return normalized;
}

function normalizeBackupMovieList(value, fieldName, strict = true) {
    if (!Array.isArray(value)) {
        if (strict) throw new Error(`${fieldName} dizi olmalı`);
        return [];
    }

    const normalized = [];
    const seenKeys = new Set();
    value.forEach(item => {
        const safeItem = normalizeBackupMovieItem(item);
        if (!safeItem) {
            if (strict) throw new Error(`${fieldName} geçersiz kayıt içeriyor`);
            return;
        }
        const compositeKey = `${safeItem.media_type}:${safeItem.id}`;
        if (seenKeys.has(compositeKey)) return;
        seenKeys.add(compositeKey);
        normalized.push(safeItem);
    });
    return normalized;
}

function normalizeBackupFavoriteActors(value, strict = true) {
    if (!Array.isArray(value)) {
        if (strict) throw new Error('favoriteActors dizi olmalı');
        return [];
    }

    const normalized = [];
    const seenIds = new Set();
    value.forEach(actor => {
        if (!isPlainBackupObject(actor)) {
            if (strict) throw new Error('favoriteActors geçersiz kayıt içeriyor');
            return;
        }

        const id = normalizeTmdbId(actor.id);
        if (!id) {
            if (strict) throw new Error('favoriteActors geçersiz kimlik içeriyor');
            return;
        }
        if (seenIds.has(id)) return;
        seenIds.add(id);
        normalized.push({
            id,
            name: normalizeBackupText(actor.name, 300) || 'Bilinmiyor',
            profile_path: isValidTmdbImagePath(actor.profile_path)
                ? actor.profile_path
                : null
        });
    });
    return normalized;
}

function normalizeBackupRatings(value, strict = true) {
    if (!isPlainBackupObject(value)) {
        if (strict) throw new Error('movieRatings nesne olmalı');
        return {};
    }

    const normalized = {};
    Object.entries(value).forEach(([rawKey, rawRating]) => {
        const rating = normalizeUserRating(rawRating);
        const trimmedKey = String(rawKey || '').trim();
        if (/^(movie|tv):\d+$/.test(trimmedKey)) {
            const [mType, idPart] = trimmedKey.split(':');
            const id = normalizeTmdbId(idPart);
            if (!id || rating === null) {
                if (strict) throw new Error('movieRatings geçersiz kayıt içeriyor');
                return;
            }
            normalized[`${mType}:${id}`] = rating;
            delete normalized[id];
            return;
        }
        const id = normalizeTmdbId(trimmedKey);
        if (!id || rating === null) {
            if (strict) throw new Error('movieRatings geçersiz kayıt içeriyor');
            return;
        }
        if (normalized[`movie:${id}`] === undefined && normalized[`tv:${id}`] === undefined) {
            normalized[id] = rating;
        }
    });
    return normalized;
}

function normalizeBackupSubscribedProviders(value, strict = true) {
    if (!Array.isArray(value)) {
        if (strict) throw new Error('userSubscribedProviders dizi olmalı');
        return [];
    }

    const allowedIds = new Set(typeof TR_SUBSCRIPTION_PROVIDERS === 'object'
        ? Object.keys(TR_SUBSCRIPTION_PROVIDERS).map(Number)
        : [8, 119, 337, 1899, 11, 1826, 1904, 2235, 1791, 342]);
    const ids = new Set();
    for (const rawId of value) {
        const id = normalizeTmdbId(rawId);
        if (!allowedIds.has(id)) {
            if (strict) throw new Error('userSubscribedProviders geçersiz kimlik içeriyor');
            continue;
        }
        ids.add(id);
    }
    return [...ids];
}

function parseBackupEpisodeKey(key) {
    if (typeof parseEpisodeKey === 'function') return parseEpisodeKey(key);

    const match = typeof key === 'string' && /^S([1-9]\d*)E([1-9]\d*)$/.exec(key);
    if (!match) return null;
    const seasonNumber = normalizeTmdbId(match[1]);
    const episodeNumber = normalizeTmdbId(match[2]);
    return seasonNumber && episodeNumber ? { seasonNumber, episodeNumber } : null;
}

function createBackupTvProgressRecord(id, record, watched, updatedAt) {
    const name = normalizeBackupText(record.name, 300);
    if (typeof normalizeTvProgressRecord === 'function') {
        return normalizeTvProgressRecord(id, { ...record, name }, watched, updatedAt);
    }

    const episodes = [...new Set(watched)].map(key => ({ key, ...parseBackupEpisodeKey(key) }));
    episodes.sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    const last = episodes[episodes.length - 1];
    const episodeRuntimes = {};
    for (const { key } of episodes) {
        const minutes = record.episodeRuntimes?.[key];
        if (Number.isFinite(minutes) && minutes > 0) episodeRuntimes[key] = minutes;
    }

    return {
        id,
        media_type: 'tv',
        name: name.trim() ? name : 'Bilinmiyor',
        poster_path: isValidTmdbImagePath(record.poster_path) ? record.poster_path : null,
        first_air_date: normalizeBackupDate(record.first_air_date),
        vote_average: Number.isFinite(record.vote_average) ? record.vote_average : null,
        genre_ids: Array.isArray(record.genre_ids) ? record.genre_ids.map(normalizeTmdbId).filter(Boolean) : [],
        totalSeasons: normalizeTmdbId(record.totalSeasons),
        totalEpisodes: normalizeTmdbId(record.totalEpisodes),
        watched: episodes.map(({ key }) => key),
        avgEpisodeRuntime: Number.isFinite(record.avgEpisodeRuntime) && record.avgEpisodeRuntime > 0
            ? record.avgEpisodeRuntime : null,
        episodeRuntimes,
        lastSeason: last.seasonNumber,
        lastEpisode: last.episodeNumber,
        updatedAt: Number.isFinite(updatedAt) && updatedAt >= 0 ? updatedAt : 0
    };
}

function normalizeBackupTvProgress(value, strict = true) {
    if (!isPlainBackupObject(value)) {
        if (strict) throw new Error('tvEpisodeProgress nesne olmalı');
        return {};
    }

    const normalized = {};
    for (const [key, record] of Object.entries(value)) {
        const id = normalizeTmdbId(/^tv:([1-9]\d*)$/.exec(key)?.[1]);
        const validRecord = id && isPlainBackupObject(record) && normalizeTmdbId(record.id) === id &&
            record.media_type === 'tv' && Array.isArray(record.watched) && record.watched.length > 0 &&
            record.watched.every(parseBackupEpisodeKey);
        const progress = validRecord && createBackupTvProgressRecord(id, record, record.watched, record.updatedAt);
        if (!progress) {
            if (strict) throw new Error('tvEpisodeProgress geçersiz kayıt içeriyor');
            continue;
        }
        normalized[key] = progress;
    }
    return normalized;
}

function normalizeBackupSavedSharedList(record) {
    if (!isPlainBackupObject(record) ||
        typeof record.id !== 'string' || !/^[\w-]{1,80}$/.test(record.id) ||
        typeof record.title !== 'string' || record.title.length < 1 || record.title.length > 80 ||
        typeof record.route !== 'string' || record.route.length > 2048 ||
        (!record.route.startsWith('secki/') && !record.route.startsWith('list?')) ||
        !Array.isArray(record.items) || !record.items.length || record.items.length > SHARED_LIST_MAX_ITEMS ||
        !Number.isFinite(record.updatedAt) || record.updatedAt < 0) return null;

    const snapshots = record.items.map(normalizeShareListItemSnapshot);
    if (snapshots.includes(null)) return null;
    const items = getUniqueShareListItems(snapshots);
    const parsed = parseSharedListRoute(record.route);
    const titleArg = parsed.hasCustomTitle ? parsed.title : '';
    const canonicalRoute = buildSharedListRoute(titleArg, items);
    const legacyRoute = buildLegacySharedListRoute(titleArg, items);
    if (!canonicalRoute || (record.route !== canonicalRoute && record.route !== legacyRoute) ||
        record.title !== parsed.title) return null;

    const shortId = normalizeShortlinkId(record.shortId);
    if (Object.hasOwn(record, 'shortId') && !shortId) return null;
    return {
        id: record.id, title: parsed.title, route: canonicalRoute, items, updatedAt: record.updatedAt,
        ...(shortId ? { shortId } : {})
    };
}

function normalizeBackupSavedSharedLists(value, strict = true) {
    if (!Array.isArray(value)) {
        if (strict) throw new Error('savedSharedLists dizi olmalı');
        return [];
    }
    if (strict && value.length > SAVED_SHARED_LISTS_MAX) {
        throw new Error('savedSharedLists kayıt sınırını aşıyor');
    }

    const byId = new Map();
    for (const record of value) {
        const list = normalizeBackupSavedSharedList(record);
        if (!list) {
            if (strict) throw new Error('savedSharedLists geçersiz kayıt içeriyor');
            continue;
        }
        const previous = byId.get(list.id);
        if (!previous || list.updatedAt > previous.updatedAt) byId.set(list.id, list);
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SAVED_SHARED_LISTS_MAX);
}

function normalizeProfileBackupData(data, strict = true, version = PROFILE_BACKUP_VERSION) {
    if (!isPlainBackupObject(data)) {
        throw new Error('Yedek verisi geçersiz');
    }

    const normalized = {
        watchlist: normalizeBackupMovieList(data.watchlist, 'watchlist', strict),
        ratedMovies: normalizeBackupMovieList(data.ratedMovies, 'ratedMovies', strict),
        movieRatings: normalizeBackupRatings(data.movieRatings, strict),
        favoriteActors: normalizeBackupFavoriteActors(data.favoriteActors, strict),
        recentlyViewed: normalizeBackupMovieList(
            data.recentlyViewed,
            'recentlyViewed',
            strict
        ).slice(0, 10)
    };
    if (version === 1) return normalized;

    normalized.userSubscribedProviders = normalizeBackupSubscribedProviders(data.userSubscribedProviders, strict);
    normalized.tvEpisodeProgress = normalizeBackupTvProgress(data.tvEpisodeProgress, strict);
    normalized.savedSharedLists = normalizeBackupSavedSharedLists(data.savedSharedLists, strict);
    return normalized;
}

function collectCurrentProfileBackupData(version = PROFILE_BACKUP_VERSION) {
    const keys = version === 1 ? PROFILE_BACKUP_V1_STORAGE_KEYS : PROFILE_BACKUP_STORAGE_KEYS;
    const data = Object.fromEntries(keys.map(key => [key, readProfileBackupStorage(key, null)]));
    return normalizeProfileBackupData(data, false, version);
}

function createProfileBackupPayload() {
    return {
        app: PROFILE_BACKUP_APP,
        version: PROFILE_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: collectCurrentProfileBackupData()
    };
}

function validateProfileBackupPayload(payload) {
    if (
        !isPlainBackupObject(payload) ||
        payload.app !== PROFILE_BACKUP_APP ||
        !PROFILE_BACKUP_SUPPORTED_VERSIONS.has(payload.version) ||
        !Object.prototype.hasOwnProperty.call(payload, 'data')
    ) {
        throw new Error('Desteklenmeyen yedek formatı');
    }
    return normalizeProfileBackupData(payload.data, true, payload.version);
}

function mergeBackupList(currentItems, importedItems, limit = null, byMediaType = true) {
    const merged = [];
    const seenKeys = new Set();
    [...currentItems, ...importedItems].forEach(item => {
        const id = normalizeTmdbId(item?.id);
        if (!id) return;
        const key = byMediaType
            ? `${resolveProfileItemMediaType(item, null)}:${id}`
            : String(id);
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        merged.push(item);
    });
    return typeof limit === 'number' ? merged.slice(0, limit) : merged;
}

function mergeBackupTvProgress(currentProgress = {}, importedProgress) {
    const merged = { ...currentProgress };
    for (const [key, imported] of Object.entries(importedProgress)) {
        const current = currentProgress[key];
        if (!current) {
            merged[key] = imported;
            continue;
        }
        const metadata = {
            ...imported,
            ...current,
            name: current.name === 'Bilinmiyor' ? imported.name : current.name,
            poster_path: current.poster_path ?? imported.poster_path,
            totalSeasons: current.totalSeasons ?? imported.totalSeasons,
            totalEpisodes: current.totalEpisodes ?? imported.totalEpisodes,
            avgEpisodeRuntime: current.avgEpisodeRuntime ?? imported.avgEpisodeRuntime,
            episodeRuntimes: { ...imported.episodeRuntimes, ...current.episodeRuntimes }
        };
        merged[key] = createBackupTvProgressRecord(
            current.id, metadata, [...current.watched, ...imported.watched],
            Math.max(current.updatedAt, imported.updatedAt)
        );
    }
    return merged;
}

function mergeBackupSavedSharedLists(currentLists = [], importedLists) {
    const merged = [];
    const ids = new Set();
    const routes = new Set();
    for (const list of [...currentLists, ...importedLists]) {
        if (ids.has(list.id) || routes.has(list.route)) continue;
        ids.add(list.id);
        routes.add(list.route);
        merged.push(list);
    }
    return merged.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SAVED_SHARED_LISTS_MAX);
}

function mergeProfileBackupData(currentData, importedData) {
    const currentRatings = normalizeBackupRatings(currentData.movieRatings, false);
    const movieRatings = normalizeBackupRatings(importedData.movieRatings, false);
    Object.keys(currentRatings).forEach(key => {
        const { id } = parseMediaKey(key);
        delete movieRatings[key];
        delete movieRatings[id];
        if (/^\d+$/.test(key)) {
            delete movieRatings[`movie:${id}`];
            delete movieRatings[`tv:${id}`];
        }
    });
    Object.assign(movieRatings, currentRatings);

    const merged = {
        watchlist: mergeBackupList(currentData.watchlist, importedData.watchlist),
        ratedMovies: mergeBackupList(currentData.ratedMovies, importedData.ratedMovies),
        movieRatings,
        favoriteActors: mergeBackupList(
            currentData.favoriteActors,
            importedData.favoriteActors
        ),
        recentlyViewed: mergeBackupList(
            currentData.recentlyViewed,
            importedData.recentlyViewed,
            10
        )
    };

    // A v1 import leaves its absent v2 fields out of the write entirely.
    if (Object.hasOwn(importedData, 'userSubscribedProviders')) {
        merged.userSubscribedProviders = [...new Set([
            ...(currentData.userSubscribedProviders ?? []), ...importedData.userSubscribedProviders
        ])];
    }
    if (Object.hasOwn(importedData, 'tvEpisodeProgress')) {
        merged.tvEpisodeProgress = mergeBackupTvProgress(currentData.tvEpisodeProgress, importedData.tvEpisodeProgress);
    }
    if (Object.hasOwn(importedData, 'savedSharedLists')) {
        merged.savedSharedLists = mergeBackupSavedSharedLists(currentData.savedSharedLists, importedData.savedSharedLists);
    }
    return merged;
}

function writeProfileBackupData(data) {
    const keysToWrite = PROFILE_BACKUP_STORAGE_KEYS.filter(key => Object.hasOwn(data, key));
    profileMutationGeneration++;
    const previousValues = Object.fromEntries(
        keysToWrite.map(key => [key, localStorage.getItem(key)])
    );

    try {
        keysToWrite.forEach(key => {
            localStorage.setItem(key, JSON.stringify(data[key]));
        });
    } catch (error) {
        keysToWrite.forEach(key => {
            try {
                if (previousValues[key] === null) localStorage.removeItem(key);
                else localStorage.setItem(key, previousValues[key]);
            } catch (rollbackError) {
                console.error('Profil yedeği geri alma hatası:', rollbackError);
            }
        });
        throw error;
    }
}

function setProfileBackupStatus(message, state = '') {
    const status = document.getElementById('profile-backup-status');
    if (!status) return;
    status.textContent = String(message || '');
    status.dataset.state = state;
}

function exportProfileData() {
    try {
        const payload = createProfileBackupPayload();
        const blob = new Blob(
            [JSON.stringify(payload, null, 2)],
            { type: 'application/json;charset=utf-8' }
        );
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `filmimnerede-yedek-${payload.exportedAt.slice(0, 10)}.json`;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        setProfileBackupStatus('Yedek dosyanız indirildi.', 'success');
    } catch (error) {
        console.warn('Profil yedeği dışa aktarılamadı:', error);
        setProfileBackupStatus(
            'Yedek oluşturulamadı. Lütfen tekrar deneyin.',
            'error'
        );
    }
}

async function handleProfileBackupFileSelection(event) {
    const input = event?.currentTarget;
    const file = input?.files?.[0];
    if (!file) return;

    try {
        if (file.size > PROFILE_BACKUP_MAX_FILE_BYTES) {
            throw new Error('Yedek dosyası boyut sınırını aşıyor');
        }

        setProfileBackupStatus('Yedek dosyası kontrol ediliyor…');
        const payload = JSON.parse(await file.text());
        const importedData = validateProfileBackupPayload(payload);
        const mode = document.getElementById('profile-import-mode')?.value === 'replace'
            ? 'replace'
            : 'merge';

        if (
            mode === 'replace' &&
            !window.confirm(
                'Bu işlem mevcut FilmimNerede listelerinizi yedekteki verilerle değiştirecek. Devam edilsin mi?'
            )
        ) {
            setProfileBackupStatus('İçe aktarma iptal edildi.');
            return;
        }

        const finalData = mode === 'merge'
            ? mergeProfileBackupData(collectCurrentProfileBackupData(payload.version), importedData)
            : importedData;
        writeProfileBackupData(finalData);

        const refreshFunctions = [
            typeof syncMyPlatformsUi === 'function' ? syncMyPlatformsUi : null,
            renderTvTrackerSection,
            renderSavedSharedListsSection,
            () => loadProfile(null, { refreshCollectionSections: false, persistTrackedTvRuntime: false })
        ];
        for (const refresh of refreshFunctions) {
            try {
                refresh?.();
            } catch (refreshError) {
                console.warn('Profil import sonrası yenilenemedi:', refreshError);
            }
        }

        setProfileBackupStatus(
            mode === 'merge'
                ? 'Yedek mevcut verilerinizle başarıyla birleştirildi.'
                : 'Yedek başarıyla geri yüklendi.',
            'success'
        );
    } catch (error) {
        console.warn('Profil yedeği içe aktarılamadı:', error);
        setProfileBackupStatus(
            'Yedek dosyası geçersiz veya desteklenmiyor. Mevcut verileriniz değiştirilmedi.',
            'error'
        );
    } finally {
        if (input) input.value = '';
    }
}

function bindProfileBackupControls() {
    const exportButton = document.getElementById('profile-export-btn');
    const importButton = document.getElementById('profile-import-btn');
    const importInput = document.getElementById('profile-import-file');

    if (exportButton) {
        exportButton.addEventListener('click', exportProfileData);
    }
    if (importButton && importInput) {
        importButton.addEventListener('click', () => {
            importInput.value = '';
            importInput.click();
        });
    }
    if (importInput) {
        importInput.addEventListener('change', handleProfileBackupFileSelection);
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', bindProfileBackupControls);
}

function switchProfileTab(tabId, btnElem) {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function' ||
        typeof document.getElementById !== 'function') return;
    document.querySelectorAll('.profile-tab-content').forEach(el => {
        el.classList.remove('active-tab');
        el.hidden = true;
    });
    const target = document.getElementById(tabId);
    if (target) {
        target.classList.add('active-tab');
        target.hidden = false;
    }
    
    document.querySelectorAll('.profile-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
        btn.setAttribute('tabindex', '-1');
        btn.style.background = '';
        btn.style.border = '';
    });
    if (btnElem) {
        btnElem.classList.add('active');
        btnElem.setAttribute('aria-selected', 'true');
        btnElem.setAttribute('tabindex', '0');
        btnElem.style.background = '';
        btnElem.style.borderColor = '';
    }

    if (tabId === 'profile-smart-recs' && typeof loadSmartRecommendations === 'function') {
        loadSmartRecommendations();
    }
    if (tabId === 'profile-tv-tracker') {
        renderTvTrackerSection();
    }
    if (tabId === 'profile-shared-lists') {
        renderSavedSharedListsSection();
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', () => {
    const profileTabs = document.querySelectorAll('.profile-tab-btn');
    profileTabs.forEach((tabBtn, index) => {
        tabBtn.addEventListener('keydown', (e) => {
            const tabs = Array.from(document.querySelectorAll('.profile-tab-btn'));
            let targetIdx = -1;
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                targetIdx = (index + 1) % tabs.length;
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                targetIdx = (index - 1 + tabs.length) % tabs.length;
            } else if (e.key === 'Home') {
                e.preventDefault();
                targetIdx = 0;
            } else if (e.key === 'End') {
                e.preventDefault();
                targetIdx = tabs.length - 1;
            }
            if (targetIdx !== -1) {
                const targetTab = tabs[targetIdx];
                const targetPanelId = targetTab.getAttribute('aria-controls');
                if (targetPanelId) {
                    switchProfileTab(targetPanelId, targetTab);
                    targetTab.focus();
                }
            }
        });
    });
});
}

function renderTvTrackerSection() {
    const grid = document.getElementById('tv-tracker-grid');
    if (!grid) return;

    const shows = getAllTrackedTvShows();
    const tab = document.getElementById('tab-profile-tv-tracker');
    if (tab) {
        const icon = tab.querySelector('i');
        const label = shows.length ? ` Dizi Takibim (${shows.length})` : ' Dizi Takibim';
        if (icon) {
            tab.replaceChildren(icon, label);
        } else {
            tab.textContent = label.trim();
        }
    }

    if (!shows.length) {
        const empty = document.createElement('p');
        empty.className = 'tv-tracker-empty';
        empty.textContent = 'Henüz dizi takibiniz yok. Bir dizinin sezon rehberinde izlediğiniz bölümleri işaretleyin.';
        grid.replaceChildren(empty);
        return;
    }

    const cards = document.createDocumentFragment();
    for (const show of shows) {
        const summary = formatTvProgressSummary(show);
        const card = document.createElement('article');
        card.className = 'tv-tracker-card';
        const openShow = () => openDetails(show.id, 'tv');

        const titleButton = document.createElement('button');
        titleButton.type = 'button';
        titleButton.className = 'tv-tracker-title-btn';
        titleButton.addEventListener('click', openShow);

        const poster = document.createElement('img');
        poster.className = 'tv-tracker-poster';
        poster.src = getSafeTmdbImageUrl(show.poster_path, getSizedTmdbImageBase('w185', IMAGE_BASE), 'assets/placeholder.svg');
        poster.alt = '';
        poster.loading = 'lazy';
        const title = document.createElement('span');
        title.textContent = show.name;
        titleButton.append(poster, title);

        const progress = document.createElement('div');
        progress.className = 'tv-tracker-progress';
        const position = document.createElement('strong');
        position.textContent = `Kaldığın Yer: ${summary.positionLabel}`;
        const count = document.createElement('span');
        count.textContent = summary.countLabel;
        progress.append(position, count);
        if (summary.totalEpisodes) {
            progress.appendChild(createTvProgressBar(
                summary.watchedCount, summary.totalEpisodes, `İzleme ilerlemesi %${summary.percent}`
            ));
        }

        const actions = document.createElement('div');
        actions.className = 'tv-tracker-actions';
        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'tv-tracker-open-btn';
        openButton.textContent = 'Bölümlere Git';
        openButton.addEventListener('click', openShow);

        const resetButton = document.createElement('button');
        resetButton.type = 'button';
        resetButton.className = 'tv-tracker-reset-btn';
        resetButton.textContent = 'Takibi Sıfırla';
        resetButton.addEventListener('click', () => {
            const hadFocus = document.activeElement === resetButton;
            const cleared = clearTvShowProgress(show.id);
            if (cleared && hadFocus) tab?.focus();
            if (typeof announceA11y === 'function') {
                announceA11y(cleared ? `${show.name} için izleme takibi sıfırlandı.` : 'İzleme takibi sıfırlanamadı.');
            }
        });
        actions.append(openButton, resetButton);
        card.append(titleButton, progress, actions);
        cards.appendChild(card);
    }
    grid.replaceChildren(cards);
}

function refreshProfileWatchStats(routeContext = null, persistTrackedTvRuntime = true) {
    const statsContainer = document.getElementById('profile-stats-container');
    if (!statsContainer) return;

    const watchlist = typeof safeReadStorage === 'function'
        ? safeReadStorage('watchlist', [])
        : [];
    const ratedMovies = typeof safeReadStorage === 'function'
        ? safeReadStorage('ratedMovies', [])
        : [];
    const savedRatings = typeof safeReadStorage === 'function'
        ? safeReadStorage('movieRatings', {})
        : {};
    const trackedTvShows = typeof getAllTrackedTvShows === 'function' ? getAllTrackedTvShows() : [];
    const trackedTvIds = new Set(trackedTvShows.map(show => `tv:${show.id}`));

    let totalWatchTimeMinutes = 0;
    let needsFetch = false;
    for (const item of ratedMovies) {
        const id = normalizeTmdbId(item?.id);
        if (!id) continue;
        const mediaType = inferItemMediaType(item);
        if (mediaType === 'tv' && trackedTvIds.has(`tv:${id}`)) continue;

        const cachedRuntime = getPositiveWatchTimeNumber(item.exact_runtime_mins_v2);
        totalWatchTimeMinutes += cachedRuntime ?? (mediaType === 'tv' ? 900 : 120);
        if (cachedRuntime === null) needsFetch = true;
    }
    for (const show of trackedTvShows) {
        totalWatchTimeMinutes += getTrackedTvWatchedMinutesLocal(show);
        if (doesTrackedTvNeedRuntimeFetch(show)) needsFetch = true;
    }

    let genreCounts = {};
    ratedMovies.forEach(m => {
        const gIds = Array.isArray(m?.genre_ids) && m.genre_ids.length > 0
            ? m.genre_ids
            : (Array.isArray(m?.genres) ? m.genres.map(g => g?.id).filter(Boolean) : []);
        gIds.forEach(gId => {
            const safeGId = normalizeTmdbId(gId);
            if (safeGId) {
                genreCounts[safeGId] = (genreCounts[safeGId] || 0) + 1;
            }
        });
    });

    let favoriteGenre = "Belirsiz";
    if (Object.keys(genreCounts).length > 0) {
        const topGenreId = Object.keys(genreCounts).reduce((a, b) => genreCounts[a] > genreCounts[b] ? a : b);
        const allGenres = Object.values(window.genresCache || {}).flat();
        const genreObj = allGenres.find(g => String(g.id) === String(topGenreId));
        if (genreObj) {
            favoriteGenre = genreObj.name;
        } else if (typeof genreMap === 'object' && genreMap && genreMap[topGenreId]) {
            favoriteGenre = genreMap[topGenreId];
        } else if (typeof window !== 'undefined' && window.genreMap && window.genreMap[topGenreId]) {
            favoriteGenre = window.genreMap[topGenreId];
        } else {
            for (const m of ratedMovies) {
                const matched = Array.isArray(m?.genres)
                    ? m.genres.find(g => String(g?.id) === String(topGenreId) && g?.name)
                    : null;
                if (matched) {
                    favoriteGenre = String(matched.name);
                    break;
                }
            }
        }
    }

    const ratingValues = [];
    if (ratedMovies.length > 0) {
        ratedMovies.forEach(m => {
            const mId = normalizeTmdbId(m?.id);
            if (!mId) return;
            const mType = resolveProfileItemMediaType(m, null);
            const rVal = typeof getUserRatingForMedia === 'function'
                ? getUserRatingForMedia(savedRatings, mId, mType)
                : normalizeUserRating(savedRatings[`${mType}:${mId}`] ?? savedRatings[mId]);
            if (rVal !== null) ratingValues.push(rVal);
        });
    } else {
        Object.values(savedRatings).forEach(v => {
            const rVal = normalizeUserRating(v);
            if (rVal !== null) ratingValues.push(rVal);
        });
    }
    const avgRating = ratingValues.length > 0
        ? (ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length).toFixed(1)
        : 0;

    const uniqueMediaKeys = new Set(trackedTvIds);
    [...watchlist, ...ratedMovies].forEach(item => {
        const id = normalizeTmdbId(item?.id);
        if (!id) return;
        uniqueMediaKeys.add(`${resolveProfileItemMediaType(item, null)}:${id}`);
    });
    const totalUniqueContent = uniqueMediaKeys.size;

    statsContainer.innerHTML = `
        <div class="stat-card stat-card--content">
            <i class="fas fa-film stat-card-icon" aria-hidden="true"></i>
            <div class="stat-value">${escapeHtml(totalUniqueContent)}</div>
            <div class="stat-label">Toplam İçerik</div>
        </div>
        <div class="stat-card stat-card--watch-time" title="Puanladığın yapımlar ve takip ettiğin dizi bölümlerinin toplam izleme süresi.">
            <i class="fas fa-clock stat-card-icon" aria-hidden="true"></i>
            <div class="stat-value" id="profile-watch-time">${escapeHtml(formatWatchTimeDuration(totalWatchTimeMinutes, needsFetch))}</div>
            <div class="stat-label">Tahmini İzleme Süresi</div>
        </div>
        <div class="stat-card stat-card--rating">
            <i class="fas fa-star stat-card-icon" aria-hidden="true"></i>
            <div class="stat-value">${escapeHtml(avgRating)}</div>
            <div class="stat-label">Ortalama Puan</div>
        </div>
        <div class="stat-card stat-card--genre">
            <i class="fas fa-heart stat-card-icon" aria-hidden="true"></i>
            <div class="stat-value">${escapeHtml(favoriteGenre)}</div>
            <div class="stat-label">Favori Tür</div>
        </div>
    `;

    if (needsFetch) {
        const watchTimeElem = statsContainer.querySelector('#profile-watch-time');
        calculateExactWatchTime(ratedMovies, routeContext?.signal, trackedTvShows, persistTrackedTvRuntime)
            .then(exactMinutes => {
                if (routeContext?.signal?.aborted || !watchTimeElem?.isConnected) return;
                if (routeContext && !isRouteContextCurrent(routeContext, 'profile')) return;
                if (exactMinutes >= 0) watchTimeElem.textContent = formatWatchTimeDuration(exactMinutes);
            })
            .catch(error => {
                if (error.name !== 'AbortError') console.warn('İzleme süresi hesaplanamadı:', error);
            });
    }
}

function loadProfile(routeContext = null, { refreshCollectionSections = true, persistTrackedTvRuntime = true } = {}) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    if (refreshCollectionSections) {
        renderTvTrackerSection();
        renderSavedSharedListsSection();
    }
    refreshProfileWatchStats(routeContext, persistTrackedTvRuntime);
    const watchlistGrid = document.getElementById('watchlist-grid');
    const ratedTvGrid = document.getElementById('rated-tv-grid');
    const ratedMovieGrid = document.getElementById('rated-movie-grid');
    const actorsGrid = document.getElementById('favorite-actors-grid');
    const watchlist = typeof safeReadStorage === 'function'
        ? safeReadStorage('watchlist', [])
        : [];
    const ratedMovies = typeof safeReadStorage === 'function'
        ? safeReadStorage('ratedMovies', [])
        : [];
    let favoriteActors = [];

    try {
        const parsedFavoriteActors = JSON.parse(localStorage.getItem('favoriteActors') || '[]');
        if (Array.isArray(parsedFavoriteActors)) favoriteActors = parsedFavoriteActors;
    } catch (error) {
        console.warn('Favorite actors okunamadı:', error);
    }

    // Render Recently Viewed
    renderRecentlyViewed(routeContext);

    // Render Watchlist
    if (watchlist.length === 0) {
        watchlistGrid.innerHTML = "<div class='no-provider profile-grid-empty'>İzleme listeniz boş.</div>";
    } else {
        watchlistGrid.innerHTML = watchlist.map(item => {
            let type = item.media_type;
            if (!type || type === "undefined") type = item.first_air_date ? "tv" : "movie";
            return createMovieCard(item, type, "");
        }).join('');
    }
    
    // Render Rated
    let ratedTvs = [];
    let ratedMoviesOnly = [];
    ratedMovies.forEach(item => {
        let type = item.media_type;
        if (!type || type === "undefined") {
            type = (item.first_air_date || (item.name && !item.title)) ? "tv" : "movie";
        }
        if (type === "tv") ratedTvs.push(item);
        else ratedMoviesOnly.push(item);
    });

    if (ratedTvs.length === 0) {
        ratedTvGrid.innerHTML = "<div class='no-provider profile-grid-empty'>Puanladığınız dizi yok.</div>";
    } else {
        ratedTvGrid.innerHTML = ratedTvs.map(item => createMovieCard(item, "tv", "rated")).join('');
    }

    if (ratedMoviesOnly.length === 0) {
        ratedMovieGrid.innerHTML = "<div class='no-provider profile-grid-empty'>Puanladığınız film yok.</div>";
    } else {
        ratedMovieGrid.innerHTML = ratedMoviesOnly.map(item => createMovieCard(item, "movie", "rated")).join('');
    }
    
    // Render Actors
    const validFavoriteActors =
        favoriteActors.filter(
            actor =>
                actor &&
                normalizeTmdbId(
                    actor.id
                )
        );

    if (
        validFavoriteActors.length === 0
    ) {
        actorsGrid.innerHTML =
            "<div class='no-provider profile-grid-empty'>Favori oyuncunuz yok.</div>";
    } else {
        actorsGrid.replaceChildren();

        validFavoriteActors.forEach(
            actor => {
                const actorId =
                    normalizeTmdbId(
                        actor.id
                    );

                const actorName =
                    String(
                        actor.name ||
                        'Bilinmiyor'
                    );

                const profilePath =
                    isValidTmdbImagePath(
                        actor.profile_path
                    )
                        ? actor.profile_path
                        : null;

                const profileUrl =
                    getSafeTmdbImageUrl(
                        profilePath,
                        IMAGE_BASE,
                        'assets/placeholder.svg'
                    );

                const card =
                    document.createElement(
                        'div'
                    );

                card.className =
                    'fav-actor-card';

                const mainBtn =
                    document.createElement(
                        'button'
                    );

                mainBtn.type =
                    'button';

                mainBtn.className =
                    'fav-actor-main-btn';

                mainBtn.setAttribute(
                    'aria-label',
                    `${actorName} detayları`
                );

                const img =
                    document.createElement(
                        'img'
                    );

                img.src =
                    profileUrl;

                img.alt =
                    actorName;

                img.loading =
                    'lazy';

                const title =
                    document.createElement(
                        'h4'
                    );

                title.textContent =
                    actorName;

                mainBtn.append(
                    img,
                    title
                );

                mainBtn.addEventListener(
                    'click',
                    () => {
                        openActorDetails(
                            actorId
                        );
                    }
                );

                const heart =
                    document.createElement(
                        'button'
                    );

                heart.type =
                    'button';

                heart.className =
                    'btn-actor-heart active';

                heart.setAttribute(
                    'aria-label',
                    `${actorName} favorilerden çıkar`
                );

                heart.setAttribute(
                    'aria-pressed',
                    'true'
                );

                heart.title =
                    'Favorilerden çıkar';

                const heartIcon =
                    document.createElement(
                        'i'
                    );

                heartIcon.className =
                    'fas fa-heart';

                heartIcon.setAttribute(
                    'aria-hidden',
                    'true'
                );

                heart.appendChild(
                    heartIcon
                );

                heart.addEventListener(
                    'click',
                    event => {
                        event.stopPropagation();

                        toggleActorFavorite(
                            heart,
                            actorId,
                            actorName,
                            profilePath
                        );
                    }
                );

                heart.addEventListener(
                    'keydown',
                    event => {
                        if (
                            event.key === 'Enter' ||
                            event.key === ' '
                        ) {
                            event.stopPropagation();
                        }
                    }
                );

                card.append(
                    heart,
                    mainBtn
                );

                actorsGrid.appendChild(
                    card
                );
            }
        );
    }
    
    [...watchlist, ...ratedMovies].forEach(item => {
        let type = item.media_type;
        if (!type || type === "undefined") type = item.first_air_date ? "tv" : "movie";
        fetchAndInjectProviders(item.id, type, item, routeContext);
    });

    if (typeof loadSmartRecommendations === 'function') {
        loadSmartRecommendations(routeContext, 'profile');
    }
}

const WATCH_TIME_CONCURRENCY =
    4;

async function runWatchTimeTasksWithConcurrency(
    items,
    limit,
    worker
) {
    const results =
        new Array(
            items.length
        );

    let nextIndex = 0;

    const workerCount =
        Math.min(
            limit,
            items.length
        );

    const runners =
        Array.from(
            {
                length:
                    workerCount
            },
            async () => {
                while (true) {
                    const index =
                        nextIndex++;

                    if (
                        index >=
                        items.length
                    ) {
                        return;
                    }

                    results[index] =
                        await worker(
                            items[index],
                            index
                        );
                }
            }
        );

    await Promise.all(
        runners
    );

    return results;
}

function getPositiveWatchTimeNumber(
    value
) {
    return (
        typeof value ===
            'number' &&
        Number.isFinite(
            value
        ) &&
        value > 0
    )
        ? value
        : null;
}

function getPositiveWatchTimeInteger(
    value
) {
    return (
        Number.isSafeInteger(
            value
        ) &&
        value > 0
    )
        ? value
        : null;
}

function calculateMovieWatchMinutes(
    data
) {
    return (
        getPositiveWatchTimeNumber(
            data?.runtime
        ) ??
        120
    );
}

function calculateTvWatchMinutes(
    data
) {
    const episodeRuntime =
        Array.isArray(
            data?.episode_run_time
        )
            ? getPositiveWatchTimeNumber(
                data
                    .episode_run_time[
                    0
                ]
            )
            : null;

    const minutesPerEpisode =
        episodeRuntime ??
        45;

    let episodeCount =
        getPositiveWatchTimeInteger(
            data
                ?.number_of_episodes
        );

    if (!episodeCount) {
        const seasonCount =
            getPositiveWatchTimeInteger(
                data
                    ?.number_of_seasons
            );

        episodeCount =
            seasonCount
                ? seasonCount * 10
                : 20;
    }

    const totalMinutes =
        minutesPerEpisode *
        episodeCount;

    return (
        getPositiveWatchTimeNumber(
            totalMinutes
        ) ??
        900
    );
}

function formatWatchTimeDuration(totalMinutes, approximate = false) {
    const minutes = Number.isFinite(totalMinutes) ? Math.round(totalMinutes) : 0;
    if (minutes <= 0) return '0s';

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (approximate) return hours ? `~${hours}s` : `~${remainder}d`;
    if (!hours) return `${remainder}d`;
    return remainder ? `${hours}s ${remainder}d` : `${hours}s`;
}

function calculateTvAverageEpisodeRuntime(data) {
    const runtimes = Array.isArray(data?.episode_run_time)
        ? data.episode_run_time.map(getPositiveWatchTimeNumber).filter(Boolean)
        : [];
    const average = runtimes.length
        ? runtimes.reduce((total, minutes) => total + minutes, 0) / runtimes.length
        : getPositiveWatchTimeNumber(data?.last_episode_to_air?.runtime);
    return Math.round(average) || 45;
}

function getTrackedTvWatchedMinutesLocal(show, fallbackEpisodeRuntime = 45) {
    if (typeof getTvShowWatchedMinutes === 'function') {
        return getTvShowWatchedMinutes(show, fallbackEpisodeRuntime);
    }
    const average = getPositiveWatchTimeNumber(show?.avgEpisodeRuntime) ?? fallbackEpisodeRuntime;
    return (show?.watched || []).reduce((total, key) => total +
        (getPositiveWatchTimeNumber(show.episodeRuntimes?.[key]) ?? average), 0);
}

function doesTrackedTvNeedRuntimeFetch(show) {
    if (typeof hasKnownTvWatchMinutes === 'function') return !hasKnownTvWatchMinutes(show);
    return getPositiveWatchTimeNumber(show?.avgEpisodeRuntime) === null &&
        (show?.watched || []).some(key => getPositiveWatchTimeNumber(show.episodeRuntimes?.[key]) === null);
}

async function calculateExactWatchTime(
    ratedMovies,
    signal = null,
    trackedTvShows = [],
    persistTrackedTvRuntime = true
) {
    const trackedTvIds = new Set();
    const trackedItems = [];
    for (const show of Array.isArray(trackedTvShows) ? trackedTvShows : []) {
        const itemId = normalizeTmdbId(show?.id);
        if (!itemId || !Array.isArray(show.watched) || !show.watched.length) continue;
        const key = `tv:${itemId}`;
        if (trackedTvIds.has(key)) continue;
        trackedTvIds.add(key);
        trackedItems.push({ itemId, show });
    }

    const ratedItems = [];
    for (const item of Array.isArray(ratedMovies) ? ratedMovies : []) {
        const itemId = normalizeTmdbId(item?.id);
        if (!itemId) continue;
        const mediaType = inferItemMediaType(item);
        if (mediaType === 'tv' && trackedTvIds.has(`tv:${itemId}`)) continue;
        ratedItems.push({ itemId, mediaType, item });
    }

    const workItems = [...ratedItems, ...trackedItems];
    if (!workItems.length) return 0;

    if (signal?.aborted) {
        const error =
            new Error('Aborted');

        error.name =
            'AbortError';

        throw error;
    }

    let updated = false;
    const startGeneration = profileMutationGeneration;
    const hadStoredRatedAtStart = (() => {
        try { return localStorage.getItem('ratedMovies') !== null; } catch (e) { return false; }
    })();
    const computedRuntimeByKey = new Map();

    // Aynı hesaplama invocation'ı
    // içinde mediaType:id dedup.
    const detailRequests =
        new Map();

    const fetchDetail =
        (
            mediaType,
            itemId
        ) => {
            const key =
                `${mediaType}:${itemId}`;

            if (
                detailRequests.has(
                    key
                )
            ) {
                return detailRequests.get(
                    key
                );
            }

            const request =
                fetch(
                    `${BASE_URL}/${mediaType}/${itemId}?language=tr-TR`,
                    {
                        signal
                    }
                )
                    .then(
                        async response => {
                            if (
                                !response.ok
                            ) {
                                throw new Error(
                                    `TMDB detail HTTP ${response.status}`
                                );
                            }

                            const data =
                                await response
                                    .json();

                            if (
                                data
                                    ?.success ===
                                false
                            ) {
                                throw new Error(
                                    'TMDB detail response failed'
                                );
                            }

                            return data;
                        }
                    )
                    .catch(error => {
                        if (
                            error.name ===
                            'AbortError'
                        ) {
                            throw error;
                        }

                        console.warn(
                            `Watch time detail ${key} alınamadı:`,
                            error
                        );

                        return null;
                    });

            detailRequests.set(
                key,
                request
            );

            return request;
        };

    const minutesPerItem =
        await runWatchTimeTasksWithConcurrency(
            workItems,
            WATCH_TIME_CONCURRENCY,
            async ({ itemId, mediaType, item, show }) => {
                if (signal?.aborted) {
                    const error =
                        new Error(
                            'Aborted'
                        );

                    error.name =
                        'AbortError';

                    throw error;
                }

                if (show) {
                    if (!doesTrackedTvNeedRuntimeFetch(show)) return getTrackedTvWatchedMinutesLocal(show);

                    const data = await fetchDetail('tv', itemId);
                    const avgRuntime = calculateTvAverageEpisodeRuntime(data);
                    if (data && persistTrackedTvRuntime && !signal?.aborted &&
                        profileMutationGeneration === startGeneration && typeof updateTvShowAvgRuntime === 'function') {
                        updateTvShowAvgRuntime(itemId, avgRuntime);
                    }
                    return getTrackedTvWatchedMinutesLocal({ ...show, avgEpisodeRuntime: avgRuntime });
                }

                const cachedMinutes =
                    getPositiveWatchTimeNumber(
                        item
                            ?.exact_runtime_mins_v2
                    );

                if (
                    cachedMinutes !==
                    null
                ) {
                    return cachedMinutes;
                }

                const data =
                    await fetchDetail(
                        mediaType,
                        itemId
                    );

                if (!data) {
                    return (
                        mediaType ===
                            'tv'
                            ? 900
                            : 120
                    );
                }

                const minutes =
                    mediaType ===
                        'tv'
                        ? calculateTvWatchMinutes(
                            data
                        )
                        : calculateMovieWatchMinutes(
                            data
                        );

                item.exact_runtime_mins_v2 =
                    minutes;

                computedRuntimeByKey.set(
                    `${mediaType}:${itemId}`,
                    minutes
                );

                updated = true;

                return minutes;
            }
        );

    const exactTimeMinutes =
        minutesPerItem.reduce(
            (
                total,
                value
            ) => {
                const minutes =
                    getPositiveWatchTimeNumber(
                        value
                    );

                return (
                    total +
                    (
                        minutes ??
                        0
                    )
                );
            },
            0
        );

    if (updated && !signal?.aborted) {
        try {
            const currentRaw = localStorage.getItem('ratedMovies');
            if (currentRaw !== null) {
                const currentList = JSON.parse(currentRaw);
                if (Array.isArray(currentList)) {
                    let changedCurrent = false;
                    currentList.forEach(entry => {
                        const entryId = normalizeTmdbId(entry?.id);
                        if (!entryId) return;
                        const entryType = resolveProfileItemMediaType(entry, null);
                        const runtimeVal = computedRuntimeByKey.get(`${entryType}:${entryId}`);
                        if (runtimeVal && entry.exact_runtime_mins_v2 !== runtimeVal) {
                            entry.exact_runtime_mins_v2 = runtimeVal;
                            changedCurrent = true;
                        }
                    });
                    if (changedCurrent) {
                        localStorage.setItem('ratedMovies', JSON.stringify(currentList));
                    }
                }
            } else if (!hadStoredRatedAtStart && profileMutationGeneration === startGeneration) {
                localStorage.setItem(
                    'ratedMovies',
                    JSON.stringify(ratedMovies)
                );
            }
        } catch (error) {
            console.warn(
                'Watch time cache yazılamadı:',
                error
            );
        }
    }

    return exactTimeMinutes;
}

const SHARED_LIST_MAX_ITEMS = 30;
const SHARED_LIST_MAX_TITLE_LENGTH = 80;
const SHARED_LIST_DEFAULT_TITLE = 'Paylaşılan Film & Dizi Seçkisi';
const SHARED_LIST_FETCH_CONCURRENCY = 4;
const SHARED_LIST_CACHE_LIMIT = 20;
const SHARED_LIST_SHORTLINK_ENDPOINT = '/.netlify/functions/shortlink';
const SHARED_LIST_SHORTLINK_TIMEOUT_MS = 2500;
const SAVED_SHARED_LISTS_KEY = 'savedSharedLists';
const SAVED_SHARED_LISTS_MAX = 40;
const SHARED_LIST_B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const SHARE_PERSON_EXCLUDED_GENRES = new Set([10767, 10763, 10764, 99]);
const SHARE_PERSON_BLOCKED_TITLE_WORDS = [
    'award', 'oscar', 'grammy', 'emmy', 'golden globe', 'bafta', 'tony',
    'ceremony', 'making of', 'behind the scenes', 'the making', 'assembled',
    'a film by', 'road to', 'story of', 'tribute', 'red carpet', 'late show', 'tonight show'
];
const SHARE_PERSON_SELF_CHARACTER_PATTERN = /^(?:self|himself|herself|guest|host|presenter|narrator|various|archive footage)\b|\b(?:himself|herself|archive footage|uncredited)\b/i;
const sharedListResultCache = new Map();
const shortSharedListRouteCache = new Map();
const shortSharedListPayloadCache = new Map();
const shortSharedListInflight = new Map();
const shareListPersonCreditsCache = new Map();

let currentSharedListState = null;
let sharedListLoadGeneration = 0;
let watchlistShareGeneration = 0;
let shareListDraft = null;
let shareListDraftInitialSignature = '';
let shareListSearchTimer = null;
let shareListSearchController = null;
let shareListPreviewItem = null;
let shareListGenresRequest = null;
let shareListLastSearchResults = [];
let shareListActivePerson = null;

function getShareListDraftSignature(draft) {
    if (!draft) return '';
    const title = normalizeSharedListTitle(draft.title, '');
    const tokens = getUniqueShareListItems(draft.items)
        .slice(0, SHARED_LIST_MAX_ITEMS)
        .map(encodeSharedListItemToken)
        .filter(Boolean)
        .join(',');
    return `${title}|${tokens}`;
}

function isShareListDraftDirty() {
    return Boolean(shareListDraft) && getShareListDraftSignature(shareListDraft) !== shareListDraftInitialSignature;
}

function normalizeSharedListTitle(rawTitle, fallback = SHARED_LIST_DEFAULT_TITLE) {
    if (typeof rawTitle !== 'string') return fallback;
    const trimmed = rawTitle.trim().slice(0, SHARED_LIST_MAX_TITLE_LENGTH);
    const wellFormed = typeof trimmed.toWellFormed === 'function' ? trimmed.toWellFormed() : trimmed;
    return wellFormed.trimEnd() || fallback;
}

function encodeShareUtf8Base64Url(text) {
    if (typeof text !== 'string' || !text) return '';
    const encodedUri = encodeURIComponent(text);
    const bytes = [];
    for (let i = 0; i < encodedUri.length; i++) {
        if (encodedUri[i] === '%') {
            bytes.push(parseInt(encodedUri.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push(encodedUri.charCodeAt(i));
        }
    }
    let output = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : -1;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : -1;
        output += SHARED_LIST_B64URL_CHARS[b0 >> 2];
        output += SHARED_LIST_B64URL_CHARS[((b0 & 3) << 4) | (b1 >= 0 ? b1 >> 4 : 0)];
        if (b1 >= 0) output += SHARED_LIST_B64URL_CHARS[((b1 & 15) << 2) | (b2 >= 0 ? b2 >> 6 : 0)];
        if (b2 >= 0) output += SHARED_LIST_B64URL_CHARS[b2 & 63];
    }
    return output;
}

function decodeShareUtf8Base64Url(encoded) {
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]{1,440}$/.test(encoded) || encoded.length % 4 === 1) {
        return null;
    }
    const bytes = [];
    for (let i = 0; i < encoded.length; i += 4) {
        const c0 = SHARED_LIST_B64URL_CHARS.indexOf(encoded[i]);
        const c1 = SHARED_LIST_B64URL_CHARS.indexOf(encoded[i + 1]);
        const c2 = i + 2 < encoded.length ? SHARED_LIST_B64URL_CHARS.indexOf(encoded[i + 2]) : -1;
        const c3 = i + 3 < encoded.length ? SHARED_LIST_B64URL_CHARS.indexOf(encoded[i + 3]) : -1;
        if (c0 < 0 || c1 < 0 || (i + 2 < encoded.length && c2 < 0) || (i + 3 < encoded.length && c3 < 0)) {
            return null;
        }
        if (c2 < 0 && (c1 & 15) !== 0) return null;
        if (c3 < 0 && c2 >= 0 && (c2 & 3) !== 0) return null;
        bytes.push((c0 << 2) | (c1 >> 4));
        if (c2 >= 0) {
            bytes.push(((c1 & 15) << 4) | (c2 >> 2));
            if (c3 >= 0) bytes.push(((c2 & 3) << 6) | c3);
        }
    }
    try {
        return decodeURIComponent(bytes.map(byte => '%' + byte.toString(16).padStart(2, '0')).join(''));
    } catch (_) {
        return null;
    }
}

function slugifySharedListTitle(title) {
    if (typeof title !== 'string') return '';
    const mapped = title
        .replace(/[çÇ]/g, 'c')
        .replace(/[ğĞ]/g, 'g')
        .replace(/[ıİ]/g, 'i')
        .replace(/[öÖ]/g, 'o')
        .replace(/[şŞ]/g, 's')
        .replace(/[üÜ]/g, 'u');
    const ascii = typeof mapped.normalize === 'function'
        ? mapped.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        : mapped;
    return ascii
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/g, '');
}

function titleFromSharedListSlug(slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return '';
    return slug
        .split('-')
        .map(word => word[0].toUpperCase() + word.slice(1))
        .join(' ');
}

function encodeSharedListItemToken(item) {
    if (typeof normalizeTmdbId !== 'function' || typeof normalizeMediaType !== 'function') return null;
    const id = normalizeTmdbId(item?.id);
    if (!id || String(id).length > 15) return null;

    const explicitType = item.mediaType ?? item.media_type;
    const mediaType = explicitType && explicitType !== 'undefined'
        ? normalizeMediaType(explicitType)
        : resolveProfileItemMediaType(item);
    if (!mediaType) return null;
    return (mediaType === 'movie' ? 'm' : 't') + id;
}

function encodeSharedListCompactToken(item) {
    const token = encodeSharedListItemToken(item);
    if (!token) return null;
    return token[0] + Number(token.slice(1)).toString(36);
}

function extractShareItemYear(item) {
    for (const value of [item?.release_date, item?.first_air_date, item?.year]) {
        if (typeof value !== 'string' && typeof value !== 'number') continue;
        const match = /^(\d{4})(?!\d)/.exec(String(value).trim());
        if (match) return match[1];
    }
    return '';
}

function formatShareItemLabel(item) {
    const title = item?.title || item?.name || 'İsimsiz yapım';
    const year = extractShareItemYear(item);
    return year ? `${title} (${year})` : title;
}

function getShareItemRating(item) {
    const value = item?.vote_average;
    const rating = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(rating) && rating > 0 ? rating : null;
}

function getShareItemGenreIds(item) {
    if (typeof normalizeTmdbId !== 'function') return [];
    const ids = Array.isArray(item?.genre_ids) ? item.genre_ids : [];
    const genres = Array.isArray(item?.genres) ? item.genres : [];
    return [...new Set([...ids, ...genres.map(genre => genre?.id)].map(normalizeTmdbId).filter(Boolean))];
}

function getShareItemGenres(item) {
    const browser = typeof window !== 'undefined' ? window : null;
    const cache = browser?.genresCache;
    const cachedGenres = [cache?.movie, cache?.tv].filter(Array.isArray).flat();
    const map = typeof genreMap !== 'undefined' ? genreMap : null;
    const directNames = Array.isArray(item?.genres) ? item.genres.map(genre => genre?.name) : [];
    const mappedNames = getShareItemGenreIds(item).map(id =>
        browser?.genreMap?.[id] || map?.[id] || cachedGenres.find(genre => String(genre?.id) === String(id))?.name
    );
    return [...new Set([...directNames, ...mappedNames]
        .filter(name => typeof name === 'string').map(name => name.trim()).filter(Boolean))].slice(0, 3);
}

function compactShareItemText(value, limit) {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (text.length <= limit) return text;
    return text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, '').trimEnd() + '…';
}

function normalizeShareItemImdbRating(value) {
    if (typeof normalizeImdbRating === 'function') {
        return normalizeImdbRating(value);
    }
    let numeric = null;
    if (typeof value === 'number') {
        numeric = value;
    } else if (typeof value === 'string' && /^(?:10(?:\.0+)?|[0-9](?:\.\d+)?)$/.test(value.trim())) {
        numeric = Number(value.trim());
    }
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 10 ? numeric.toFixed(1) : null;
}

function normalizeShareListItemSnapshot(item) {
    const token = encodeSharedListItemToken(item);
    if (!token) return null;
    const poster = item.poster_path;
    const imdbRating = normalizeShareItemImdbRating(item.imdb_rating);
    return {
        id: Number(token.slice(1)),
        media_type: token[0] === 'm' ? 'movie' : 'tv',
        title: compactShareItemText(item.title, 160),
        name: compactShareItemText(item.name, 160),
        poster_path: typeof isValidTmdbImagePath === 'function' &&
            isValidTmdbImagePath(poster) && poster.length <= 128 ? poster : null,
        release_date: compactShareItemText(item.release_date, 10),
        first_air_date: compactShareItemText(item.first_air_date, 10),
        year: extractShareItemYear(item),
        vote_average: getShareItemRating(item),
        ...(imdbRating ? { imdb_rating: imdbRating } : {}),
        overview: compactShareItemText(item.overview, 420),
        genre_ids: getShareItemGenreIds(item).slice(0, 12)
    };
}

function parseSharedListQuery(queryString) {
    const params = new URLSearchParams(queryString);
    const customTitle = normalizeSharedListTitle(params.get('title'), '');
    const rawItems = params.get('items');
    const seen = new Set();
    const items = [];
    let ignoredCount = 0;

    for (const token of rawItems ? rawItems.split(',') : []) {
        const match = /^(m|t)([1-9]\d{0,14})$/.exec(token);
        const id = match ? Number(match[2]) : null;
        if (!Number.isSafeInteger(id) || seen.has(token)) {
            ignoredCount++;
            continue;
        }
        seen.add(token);
        if (items.length < SHARED_LIST_MAX_ITEMS) {
            const mediaType = match[1] === 'm' ? 'movie' : 'tv';
            items.push({ id, mediaType, key: `${mediaType}:${id}`, token });
        }
    }

    return {
        title: customTitle || SHARED_LIST_DEFAULT_TITLE,
        hasCustomTitle: Boolean(customTitle),
        items,
        truncated: seen.size > SHARED_LIST_MAX_ITEMS,
        ignoredCount
    };
}

function parseSharedListPath(rawPath) {
    const trimmedPath = typeof rawPath === 'string' ? rawPath.trim().replace(/^\/+|\/+$/g, '') : '';
    if (!trimmedPath) {
        return {
            title: SHARED_LIST_DEFAULT_TITLE,
            hasCustomTitle: false,
            items: [],
            truncated: false,
            ignoredCount: 0
        };
    }

    const segments = trimmedPath.split('/');
    if (segments.length > 2) {
        return {
            title: SHARED_LIST_DEFAULT_TITLE,
            hasCustomTitle: false,
            items: [],
            truncated: false,
            ignoredCount: 1
        };
    }

    const slug = segments.length === 2 ? segments[0] : '';
    const payload = segments.length === 2 ? segments[1] : segments[0];
    const tildeParts = payload.split('~');
    if (tildeParts.length > 2) {
        return {
            title: SHARED_LIST_DEFAULT_TITLE,
            hasCustomTitle: false,
            items: [],
            truncated: false,
            ignoredCount: 1
        };
    }

    const itemsPart = tildeParts[0];
    const encodedTitle = tildeParts[1] || '';
    const seen = new Set();
    const items = [];
    let ignoredCount = 0;

    for (const token of itemsPart ? itemsPart.split('.') : []) {
        const match = /^(m|t)([1-9a-z][0-9a-z]{0,10})$/.exec(token);
        const id = match ? parseInt(match[2], 36) : null;
        if (!match || !Number.isSafeInteger(id) || id <= 0 || String(id).length > 15 || id.toString(36) !== match[2]) {
            ignoredCount++;
            continue;
        }
        const mediaType = match[1] === 'm' ? 'movie' : 'tv';
        const decimalToken = `${match[1]}${id}`;
        if (seen.has(decimalToken)) {
            ignoredCount++;
            continue;
        }
        seen.add(decimalToken);
        if (items.length < SHARED_LIST_MAX_ITEMS) {
            items.push({ id, mediaType, key: `${mediaType}:${id}`, token: decimalToken });
        }
    }

    const decodedTitle = encodedTitle ? decodeShareUtf8Base64Url(encodedTitle) : '';
    const customTitle = decodedTitle
        ? normalizeSharedListTitle(decodedTitle, '')
        : normalizeSharedListTitle(titleFromSharedListSlug(slug), '');

    return {
        title: customTitle || SHARED_LIST_DEFAULT_TITLE,
        hasCustomTitle: Boolean(customTitle),
        items,
        truncated: seen.size > SHARED_LIST_MAX_ITEMS,
        ignoredCount
    };
}

function parseSharedListRoute(route) {
    if (typeof route !== 'string') return parseSharedListPath('');
    const normalized = route.startsWith('#') ? route.slice(1) : route;
    if (normalized === 'secki' || normalized.startsWith('secki/')) {
        return parseSharedListPath(normalized.slice('secki'.length));
    }
    if (normalized === 'list' || normalized.startsWith('list?')) {
        const queryIndex = normalized.indexOf('?');
        return parseSharedListQuery(queryIndex === -1 ? '' : normalized.slice(queryIndex + 1));
    }
    return parseSharedListPath('');
}

function buildLegacySharedListRoute(title, items) {
    const tokens = new Set();
    for (const item of Array.isArray(items) ? items : []) {
        const token = encodeSharedListItemToken(item);
        if (token) tokens.add(token);
        if (tokens.size === SHARED_LIST_MAX_ITEMS) break;
    }
    if (!tokens.size) return null;

    const params = new URLSearchParams();
    const customTitle = normalizeSharedListTitle(title, '');
    if (customTitle) params.set('title', customTitle);
    params.set('items', Array.from(tokens).join(','));
    return 'list?' + params.toString();
}

function buildSharedListRoute(title, items) {
    const seen = new Set();
    const compactTokens = [];
    for (const item of Array.isArray(items) ? items : []) {
        const token = encodeSharedListItemToken(item);
        const compact = token ? encodeSharedListCompactToken(item) : null;
        if (token && compact && !seen.has(token)) {
            seen.add(token);
            compactTokens.push(compact);
        }
        if (compactTokens.length === SHARED_LIST_MAX_ITEMS) break;
    }
    if (!compactTokens.length) return null;

    const itemsPart = compactTokens.join('.');
    const customTitle = normalizeSharedListTitle(title, '');
    if (!customTitle) return 'secki/' + itemsPart;

    const slug = slugifySharedListTitle(customTitle);
    const needsExactTitle = !slug || titleFromSharedListSlug(slug) !== customTitle;
    const payload = needsExactTitle
        ? `${itemsPart}~${encodeShareUtf8Base64Url(customTitle)}`
        : itemsPart;
    return slug ? `secki/${slug}/${payload}` : `secki/${payload}`;
}

function buildSharedListUrl(title, items) {
    const route = buildSharedListRoute(title, items);
    return route ? getSharedListRouteUrl(route) : null;
}

function getSharedListRouteUrl(route) {
    return window.location.origin + window.location.pathname + '#' + route;
}

function normalizeShortlinkId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    return /^[0-9A-Za-z]{6,12}$/.test(id) ? id : null;
}

function getCachedShortSharedList(cache, key) {
    const value = cache.get(key);
    if (value !== undefined) {
        cache.delete(key);
        cache.set(key, value);
    }
    return value;
}

function cacheShortSharedList(cache, key, value) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > SHARED_LIST_CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
    }
}

function compactShareListPayloadItems(items) {
    return getUniqueShareListItems(items).slice(0, SHARED_LIST_MAX_ITEMS).map(item => {
        const token = encodeSharedListItemToken(item);
        return { id: Number(token.slice(1)), media_type: token[0] === 'm' ? 'movie' : 'tv' };
    });
}

async function createShortSharedListRoute(title, items, existingShortId = null) {
    const fallbackRoute = buildSharedListRoute(title, items);
    if (!fallbackRoute) return null;

    const validExistingId = normalizeShortlinkId(existingShortId);
    if (validExistingId) return 's/' + validExistingId;

    const cached = getCachedShortSharedList(shortSharedListRouteCache, fallbackRoute);
    if (cached) return cached;
    if (typeof fetch !== 'function' || typeof window === 'undefined' ||
        window.location?.protocol === 'file:' || window.navigator?.onLine === false) return fallbackRoute;

    const inflight = shortSharedListInflight.get(fallbackRoute);
    if (inflight) return inflight;

    const request = (async () => {
        let timeout;
        try {
            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), SHARED_LIST_SHORTLINK_TIMEOUT_MS);
            const response = await fetch(SHARED_LIST_SHORTLINK_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: normalizeSharedListTitle(title, ''),
                    items: compactShareListPayloadItems(items)
                }),
                signal: controller.signal
            });
            if (!response.ok) return fallbackRoute;
            const data = await response.json();
            const id = normalizeShortlinkId(data?.id);
            if (!id || controller.signal.aborted) return fallbackRoute;
            const shortRoute = 's/' + id;
            cacheShortSharedList(shortSharedListRouteCache, fallbackRoute, shortRoute);
            return shortRoute;
        } catch (_) {
            return fallbackRoute;
        } finally {
            clearTimeout(timeout);
        }
    })();
    shortSharedListInflight.set(fallbackRoute, request);
    try {
        return await request;
    } finally {
        shortSharedListInflight.delete(fallbackRoute);
    }
}

async function resolveShortSharedList(shortId, signal = null) {
    const safeId = normalizeShortlinkId(shortId);
    if (!safeId) return { notFound: true, invalid: true };
    signal?.throwIfAborted?.();

    const cached = getCachedShortSharedList(shortSharedListPayloadCache, safeId);
    if (cached) return { ok: true, ...cached };

    try {
        const url = `${SHARED_LIST_SHORTLINK_ENDPOINT}?id=${encodeURIComponent(safeId)}`;
        const response = await fetch(url, signal ? { signal } : undefined);
        if (response.status === 404 || response.status === 400) return { ok: false, notFound: true };
        if (!response.ok) return { ok: false, error: true };

        const data = await response.json();
        signal?.throwIfAborted?.();
        const title = normalizeSharedListTitle(data?.title, '');
        const items = [];
        const seen = new Set();
        for (const item of Array.isArray(data?.items) ? data.items : []) {
            const mediaType = item?.media_type;
            if (mediaType !== 'movie' && mediaType !== 'tv') continue;
            const token = encodeSharedListItemToken({ id: item.id, mediaType });
            if (!token || seen.has(token)) continue;
            seen.add(token);
            const id = Number(token.slice(1));
            items.push({ id, mediaType, key: `${mediaType}:${id}`, token });
            if (items.length === SHARED_LIST_MAX_ITEMS) break;
        }
        if (!items.length) return { ok: false, error: true };

        const payload = { title: title || SHARED_LIST_DEFAULT_TITLE, hasCustomTitle: Boolean(title), items };
        cacheShortSharedList(shortSharedListPayloadCache, safeId, payload);
        return { ok: true, ...payload };
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        return { ok: false, error: true };
    }
}

async function copyTextToClipboard(text) {
    if (typeof text !== 'string' || !text) return false;
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (_) {
        // Clipboard permissions can require the selection-based fallback.
    }

    if (typeof document === 'undefined' || typeof document.execCommand !== 'function' ||
        typeof document.createElement !== 'function' || !document.body) return false;

    const input = document.createElement('textarea');
    input.className = 'share-list-clipboard';
    input.value = text;
    input.readOnly = true;
    const focused = document.activeElement;
    const manager = window.ModalManager;
    const topModal = typeof manager?.getTopModal === 'function' ? manager.getTopModal() : null;
    (topModal?.element || document.body).append(input);
    try {
        input.focus({ preventScroll: true });
        input.select();
        return document.execCommand('copy');
    } catch (_) {
        return false;
    } finally {
        input.remove();
        if (typeof focused?.focus === 'function') focused.focus({ preventScroll: true });
    }
}

function setSharedListStatus(id, message = '') {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const status = document.getElementById(id);
    if (status) status.textContent = message;
}

function renderSharedListEmpty(grid, message) {
    grid.innerHTML = `
        <div class="shared-list-empty glass">
            <p></p>
            <div class="shared-list-empty-actions">
                <button type="button" class="action-btn shared-list-btn" onclick="if (typeof navigate === 'function') navigate('platform')">Keşfet'e Dön</button>
                <button type="button" class="action-btn shared-list-btn primary" onclick="openShareListBuilder()">Yeni Seçki Oluştur</button>
            </div>
        </div>
    `;
    grid.querySelector('p').textContent = message;
}

async function fetchSharedListItem(entry, signal) {
    if (signal?.aborted) return null;
    const cached = typeof getCachedMedia === 'function' ? getCachedMedia(entry.id, entry.mediaType) : null;
    if ((cached?.title || cached?.name) && typeof cached.overview === 'string' && cached.poster_path !== undefined) {
        return { ...cached, id: entry.id, media_type: entry.mediaType };
    }

    try {
        const response = await fetch(`${BASE_URL}/${entry.mediaType}/${entry.id}?language=tr-TR`, { signal });
        if (!response.ok) return null;
        const item = await response.json();
        if (typeof normalizeTmdbId !== 'function' || normalizeTmdbId(item?.id) !== entry.id ||
            !(item.title || item.name)) return null;
        return { ...item, id: entry.id, media_type: entry.mediaType };
    } catch (_) {
        return null;
    }
}

async function loadSharedList(routeContext = null) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' ||
        typeof window === 'undefined') return;
    const grid = document.getElementById('shared-list-grid');
    if (!grid) return;
    const hash = window.location.hash;
    const rawRoute = hash.startsWith('#') ? hash.slice(1) : '';
    const queryStart = hash.indexOf('?');
    const routePath = rawRoute.split('?')[0];
    const generation = ++sharedListLoadGeneration;
    const isCurrentLoad = () => generation === sharedListLoadGeneration && window.location.hash === hash &&
        (!routeContext || typeof isRouteContextCurrent !== 'function' || isRouteContextCurrent(routeContext, 'list'));
    const actions = document.getElementById('shared-list-actions');
    const notice = document.getElementById('shared-list-notice');
    const previousState = currentSharedListState;
    setSharedListStatus('shared-list-status');
    notice.hidden = true;
    notice.textContent = '';

    let parsed;
    let shortId = null;
    if (routeContext?.shortId || routePath === 's' || routePath.startsWith('s/')) {
        shortId = normalizeShortlinkId(routeContext?.shortId || routePath.slice(1).replace(/^\/+|\/+$/g, ''));
        currentSharedListState = null;
        actions.hidden = true;
        syncSharedListSaveButton();

        let resolved = { notFound: true };
        if (shortId) {
            const cached = shortSharedListPayloadCache.get(shortId);
            setSharedListStatus('shared-list-title', cached?.title || 'Seçki Yükleniyor…');
            setSharedListStatus('shared-list-subtitle', 'Kısa bağlantı açılıyor…');
            if (!cached) {
                if (typeof showSkeletons === 'function') showSkeletons('shared-list-grid', 4);
                else grid.replaceChildren();
            }
            try {
                resolved = await resolveShortSharedList(shortId, routeContext?.signal);
            } catch (error) {
                if (error?.name === 'AbortError') return;
                resolved = { error: true };
            }
            if (!isCurrentLoad()) return;
        }

        if (!resolved.ok) {
            const message = resolved.notFound ? 'Bu kısa seçki bağlantısı bulunamadı.' :
                'Kısa seçki bağlantısı açılamadı. Sayfayı yenileyip tekrar deneyebilirsin.';
            setSharedListStatus('shared-list-title', SHARED_LIST_DEFAULT_TITLE);
            setSharedListStatus('shared-list-subtitle', message);
            renderSharedListEmpty(grid, message);
            return;
        }
        parsed = resolved;
    } else if (rawRoute === 'secki' || rawRoute.startsWith('secki/')) {
        parsed = typeof routeContext?.listPath === 'string'
            ? parseSharedListPath(routeContext.listPath)
            : parseSharedListRoute(rawRoute);
    } else {
        parsed = parseSharedListQuery(routeContext?.listQuery ?? (queryStart === -1 ? '' : hash.slice(queryStart + 1)));
    }

    const state = {
        title: parsed.title,
        items: [],
        entries: parsed.items,
        route: buildSharedListRoute(parsed.hasCustomTitle ? parsed.title : '', parsed.items),
        shortId,
        hash
    };
    currentSharedListState = state;

    setSharedListStatus('shared-list-title', parsed.title);
    actions.hidden = !state.route;
    syncSharedListSaveButton();
    if (!state.route) {
        const message = 'Bu seçki bağlantısında geçerli film veya dizi bulunamadı.';
        setSharedListStatus('shared-list-subtitle', message);
        renderSharedListEmpty(grid, 'Geçerli bir seçki için keşfet sayfasına dönebilir veya yeni bir seçki oluşturabilirsin.');
        return;
    }

    const itemActions = actions.querySelectorAll('button:not(#shared-list-copy-btn, #shared-list-save-btn)');
    itemActions.forEach(button => { button.disabled = true; });
    let loadedItems = sharedListResultCache.get(state.route);
    if (!loadedItems) {
        setSharedListStatus('shared-list-subtitle', 'Seçki yükleniyor…');
        if (typeof showSkeletons === 'function') {
            showSkeletons('shared-list-grid', Math.min(parsed.items.length, 8));
        }
        const results = await runWatchTimeTasksWithConcurrency(
            parsed.items,
            SHARED_LIST_FETCH_CONCURRENCY,
            entry => fetchSharedListItem(entry, routeContext?.signal)
        );
        loadedItems = results.filter(Boolean);
    }
    if (currentSharedListState !== state || !isCurrentLoad()) return;

    state.items = loadedItems;
    syncSharedListSaveButton();
    if (loadedItems.length) {
        sharedListResultCache.delete(state.route);
        sharedListResultCache.set(state.route, loadedItems);
        if (sharedListResultCache.size > SHARED_LIST_CACHE_LIMIT) {
            sharedListResultCache.delete(sharedListResultCache.keys().next().value);
        }
    }

    const skippedCount = parsed.items.length - loadedItems.length;
    const notices = [];
    if (parsed.truncated) notices.push('Bağlantıdaki ilk 30 geçerli yapım gösteriliyor.');
    if (parsed.ignoredCount) notices.push(`${parsed.ignoredCount} geçersiz veya yinelenen kayıt atlandı.`);
    if (skippedCount) notices.push(`${skippedCount} yapım yüklenemedi.`);
    notice.textContent = notices.join(' ');
    notice.hidden = !notices.length;

    if (!loadedItems.length) {
        setSharedListStatus('shared-list-subtitle', '0 yapım');
        renderSharedListEmpty(grid, 'Seçkideki yapımlar şu anda yüklenemedi.');
        return;
    }

    const movieCount = loadedItems.filter(item => item.media_type === 'movie').length;
    setSharedListStatus('shared-list-subtitle', `${loadedItems.length} yapım • ${movieCount} Film, ${loadedItems.length - movieCount} Dizi`);
    itemActions.forEach(button => { button.disabled = false; });
    if (typeof setCachedMedia === 'function') {
        loadedItems.forEach(item => setCachedMedia(item, item.media_type));
    }
    // Keep the triggering card in the DOM when the details modal restores focus.
    const restoredCardFocus = routeContext?.returningFromDetails &&
        previousState?.route === state.route && grid.contains(document.activeElement);
    if (!restoredCardFocus && typeof createMovieCardsBatch === 'function') {
        grid.innerHTML = createMovieCardsBatch(loadedItems, null, 'shared-list');
    }
    if (typeof fetchAndInjectProviders === 'function') {
        loadedItems.forEach(item => fetchAndInjectProviders(item.id, item.media_type, item, routeContext));
    }
}

function getCurrentSharedList() {
    return typeof window !== 'undefined' && currentSharedListState?.hash === window.location.hash
        ? currentSharedListState : null;
}

function getSavedSharedLists() {
    if (typeof safeReadStorage !== 'function') return [];
    const records = safeReadStorage(SAVED_SHARED_LISTS_KEY, []);
    if (!Array.isArray(records)) return [];
    const valid = [];
    for (const record of records) {
        if (typeof record?.id !== 'string' || !/^[\w-]{1,80}$/.test(record.id) ||
            typeof record.title !== 'string' || typeof record.route !== 'string' ||
            (!record.route.startsWith('secki/') && !record.route.startsWith('list?')) ||
            record.route.length > 2048 ||
            !Array.isArray(record.items) || record.items.length > SHARED_LIST_MAX_ITEMS ||
            !Number.isFinite(record.updatedAt)) continue;

        const parsed = parseSharedListRoute(record.route);
        const items = getUniqueShareListItems(record.items).map(normalizeShareListItemSnapshot);
        const titleArg = parsed.hasCustomTitle ? parsed.title : '';
        const canonicalRoute = buildSharedListRoute(titleArg, items);
        const legacyRoute = buildLegacySharedListRoute(titleArg, items);
        if (!canonicalRoute || (record.route !== canonicalRoute && record.route !== legacyRoute) ||
            record.title !== parsed.title) continue;
        const shortId = normalizeShortlinkId(record.shortId);
        valid.push({
            id: record.id, title: parsed.title, route: canonicalRoute, items, updatedAt: record.updatedAt,
            ...(shortId ? { shortId } : {})
        });
    }
    const seen = new Set();
    return valid.sort((a, b) => b.updatedAt - a.updatedAt).filter(record => {
        if (seen.has(record.id)) return false;
        seen.add(record.id);
        return true;
    }).slice(0, SAVED_SHARED_LISTS_MAX);
}

function saveSharedListRecord({ id = null, title, items, shortId = null }) {
    if (typeof safeWriteStorage !== 'function') return null;
    const snapshots = getUniqueShareListItems(items).slice(0, SHARED_LIST_MAX_ITEMS).map(normalizeShareListItemSnapshot);
    const customTitle = normalizeSharedListTitle(title, '');
    const route = buildSharedListRoute(customTitle, snapshots);
    if (!route) return null;

    const lists = getSavedSharedLists();
    const previous = lists.find(list => list.id === id) || lists.find(list => list.route === route);
    let validShortId = normalizeShortlinkId(shortId);
    if (previous?.route === route) validShortId ??= previous.shortId;
    else if (validShortId === previous?.shortId) validShortId = null;

    const now = Date.now();
    const record = {
        id: previous?.id || `list_${now}_${Math.random().toString(36).slice(2, 7)}`,
        title: customTitle || SHARED_LIST_DEFAULT_TITLE,
        route,
        items: snapshots,
        updatedAt: now,
        ...(validShortId ? { shortId: validShortId } : {})
    };
    const updated = [record, ...lists.filter(list => list.id !== record.id)].slice(0, SAVED_SHARED_LISTS_MAX);
    if (!safeWriteStorage(SAVED_SHARED_LISTS_KEY, updated)) return null;
    renderSavedSharedListsSection(updated);
    syncSharedListSaveButton(updated);
    return record;
}

function persistSavedSharedListShortId(list, routeToCopy) {
    if (!routeToCopy.startsWith('s/') || typeof safeWriteStorage !== 'function') return;
    const shortId = normalizeShortlinkId(routeToCopy.slice(2));
    if (!shortId || shortId === list.shortId) return;

    const lists = getSavedSharedLists();
    // The list may have been edited or deleted while the short link was being created.
    const current = lists.find(entry => entry.id === list.id && entry.route === list.route);
    if (!current || current.shortId === shortId) return;
    current.shortId = shortId;
    safeWriteStorage(SAVED_SHARED_LISTS_KEY, lists);
}

function deleteSavedSharedList(listId) {
    if (typeof safeWriteStorage !== 'function') return;
    const lists = getSavedSharedLists();
    const index = lists.findIndex(list => list.id === listId);
    if (index === -1) return;
    const removed = lists.splice(index, 1)[0];
    const deleted = safeWriteStorage(SAVED_SHARED_LISTS_KEY, lists);
    const message = deleted ? `“${removed.title}” silindi.` : 'Seçki silinemedi.';
    if (deleted) {
        renderSavedSharedListsSection(lists);
        syncSharedListSaveButton(lists);
        if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
            const next = lists[index] || lists[index - 1];
            const focusTarget = document.getElementById(next ? `saved-list-delete-${next.id}` : 'saved-lists-create-btn');
            if (typeof focusTarget?.focus === 'function') focusTarget.focus();
        }
    }
    setSharedListStatus('saved-lists-status', message);
    if (typeof announceA11y === 'function') announceA11y(message);
}

async function copySavedSharedListLink(listId) {
    const list = getSavedSharedLists().find(entry => entry.id === listId);
    if (!list || typeof window === 'undefined') return;
    const parsed = parseSharedListRoute(list.route);
    const routeToCopy = await createShortSharedListRoute(parsed.hasCustomTitle ? parsed.title : '', list.items, list.shortId);
    if (!routeToCopy) return;
    persistSavedSharedListShortId(list, routeToCopy);
    const copied = await copyTextToClipboard(getSharedListRouteUrl(routeToCopy));
    setSharedListStatus('saved-lists-status', copied ? 'Seçki linki kopyalandı.' : 'Seçki linki kopyalanamadı.');
}

function renderSavedSharedListsSection(lists = null) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' ||
        typeof document.createElement !== 'function') return;
    const tab = document.getElementById('tab-profile-shared-lists');
    const grid = document.getElementById('saved-lists-grid');
    if (!tab && !grid) return;
    lists ??= getSavedSharedLists();
    if (tab) setShareListIconButtonLabel(tab, lists.length ? `Seçkilerim (${lists.length})` : 'Seçkilerim');
    if (!grid) return;
    if (!lists.length) {
        grid.replaceChildren(createShareListElement('p', 'tv-tracker-empty', 'Henüz kayıtlı seçkin yok.'));
        return;
    }
    grid.replaceChildren(...lists.map(createSavedSharedListCard));
}

function createSavedSharedListCard(list) {
    const card = createShareListElement('article', 'saved-list-card');
    const posters = createShareListElement('div', 'saved-list-posters');
    for (const item of list.items) {
        if (posters.childElementCount === 4) break;
        const poster = createShareListPoster(item, 'w154', '', false);
        if (poster) posters.append(poster);
    }
    if (posters.childElementCount) card.append(posters);

    const open = () => {
        if (typeof navigate === 'function') navigate(list.route);
    };
    const movieCount = list.items.filter(item => item.media_type === 'movie').length;
    const meta = `${list.items.length} yapım • ${movieCount} Film, ${list.items.length - movieCount} Dizi`;
    const sample = list.items.slice(0, 3).map(formatShareItemLabel).join(' • ');
    card.append(
        createSavedSharedListButton(list.title, open, 'saved-list-title-btn'),
        createShareListElement('p', 'saved-list-meta', meta),
        createShareListElement('p', 'saved-list-sample', sample)
    );

    const actions = createShareListElement('div', 'saved-list-actions');
    const edit = createSavedSharedListButton('Düzenle', () => openShareListBuilder(list));
    edit.id = `saved-list-edit-${list.id}`;
    const remove = createSavedSharedListButton('Sil', () => deleteSavedSharedList(list.id),
        'action-btn shared-list-btn saved-list-delete-btn');
    remove.id = `saved-list-delete-${list.id}`;
    actions.append(
        createSavedSharedListButton('Seçkiyi Aç', open, 'action-btn shared-list-btn primary'),
        createSavedSharedListButton('Linki Kopyala', () => copySavedSharedListLink(list.id)),
        edit,
        remove
    );
    card.append(actions);
    return card;
}

function createSavedSharedListButton(label, action, className = 'action-btn shared-list-btn') {
    const button = createShareListElement('button', className, label);
    button.type = 'button';
    if (typeof button.addEventListener === 'function') button.addEventListener('click', action);
    return button;
}

function setShareListIconButtonLabel(button, label) {
    const icon = button.querySelector('i');
    if (button.textContent.trim() === label) return;
    if (icon) button.replaceChildren(icon, ' ' + label);
    else button.textContent = label;
}

function syncSharedListSaveButton(lists = null) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const button = document.getElementById('shared-list-save-btn');
    if (!button) return;
    const state = getCurrentSharedList();
    const saved = Boolean(state?.route && (lists ?? getSavedSharedLists()).some(list => list.route === state.route));
    button.disabled = !state?.items.length;
    button.setAttribute('aria-pressed', String(saved));
    setShareListIconButtonLabel(button, saved ? 'Profilde Kayıtlı' : 'Profilime Kaydet');
    const cloneBtn = document.getElementById('shared-list-clone-btn');
    if (cloneBtn) setShareListIconButtonLabel(cloneBtn, saved ? 'Seçkiyi Düzenle' : 'Kopyalayıp Düzenle');
}

function saveCurrentSharedListToProfile() {
    const state = getCurrentSharedList();
    if (!state?.route || !state.items.length) return;
    if (getSavedSharedLists().some(list => list.route === state.route)) {
        setSharedListStatus('shared-list-status', 'Seçki zaten profilinde kayıtlı.');
        return;
    }
    const loaded = new Map(state.items.map(item => [encodeSharedListItemToken(item), item]));
    const items = state.entries.map(entry => loaded.get(entry.token) || entry);
    const title = parseSharedListRoute(state.route);
    const saved = saveSharedListRecord({ title: title.hasCustomTitle ? title.title : '', items, shortId: state.shortId });
    const message = saved ? 'Seçki profiline kaydedildi.' : 'Seçki profiline kaydedilemedi.';
    setSharedListStatus('shared-list-status', message);
}

function readShareListLibrary(key) {
    return typeof safeReadStorage === 'function' ? safeReadStorage(key, []) : [];
}

function syncSharedListWatchlistHearts(items) {
    const keys = new Set(items.map(encodeSharedListItemToken));
    document.querySelectorAll('.btn-heart[data-media-id][data-media-type]').forEach(button => {
        const { mediaId, mediaType } = button.dataset;
        if (!keys.has(encodeSharedListItemToken({ id: mediaId, mediaType }))) return;
        button.classList.add('active');
        button.setAttribute('aria-pressed', 'true');
        button.setAttribute('aria-label', 'Listeden çıkar');
    });
}

function addSharedListToWatchlist() {
    const state = getCurrentSharedList();
    if (!state?.items.length || typeof safeWriteStorage !== 'function' ||
        typeof normalizeTmdbId !== 'function' || typeof normalizeMediaType !== 'function') return;

    const watchlist = readShareListLibrary('watchlist');
    const added = state.items.filter(item => !watchlist.some(entry => isSameProfileMedia(entry, item.id, item.media_type)));
    let message;
    if (added.length && !safeWriteStorage('watchlist', [...watchlist, ...added])) {
        message = 'İzleme listesi kaydedilemedi.';
    } else {
        if (added.length) profileMutationGeneration++;
        syncSharedListWatchlistHearts(state.items);
        message = `${added.length} yapım eklendi, ${state.items.length - added.length} yapım zaten listende.`;
    }
    setSharedListStatus('shared-list-status', message);
    if (typeof announceA11y === 'function') announceA11y(message);
}

function pickRandomFromSharedList() {
    const items = getCurrentSharedList()?.items;
    if (!items?.length || typeof openDetails !== 'function') return;
    const picked = items[Math.floor(Math.random() * items.length)];
    const message = `Seçilen yapım: ${picked.title || picked.name}`;
    setSharedListStatus('shared-list-status', message);
    if (typeof announceA11y === 'function') announceA11y(message);
    openDetails(picked.id, picked.media_type);
}

async function copyCurrentSharedListLink() {
    const state = getCurrentSharedList();
    if (!state?.route) return;
    const parsed = parseSharedListRoute(state.route);
    const routeToCopy = await createShortSharedListRoute(parsed.hasCustomTitle ? parsed.title : '', state.entries, state.shortId);
    if (!routeToCopy) return;
    if (routeToCopy.startsWith('s/')) state.shortId = routeToCopy.slice(2);
    const copied = await copyTextToClipboard(getSharedListRouteUrl(routeToCopy));
    if (state === getCurrentSharedList()) {
        setSharedListStatus('shared-list-status', copied ? 'Seçki linki kopyalandı.' : 'Seçki linki kopyalanamadı.');
    }
}

function openShareListBuilderFromCurrent() {
    const state = getCurrentSharedList();
    if (!state?.items.length) return;
    const existing = getSavedSharedLists().find(list => list.route === state.route);
    openShareListBuilder(
        existing ? { ...existing, items: state.items } : state,
        { fromCurrentSharedList: true }
    );
}

async function shareWatchlistQuick() {
    const status = document.getElementById('watchlist-share-status');
    if (!status) return;
    const generation = ++watchlistShareGeneration;
    const watchlist = readShareListLibrary('watchlist');
    const items = watchlist.slice(0, SHARED_LIST_MAX_ITEMS);
    status.textContent = 'Seçki bağlantısı hazırlanıyor…';
    const route = await createShortSharedListRoute('İzleme Listem', items);
    if (generation !== watchlistShareGeneration) return;
    if (!route) {
        status.textContent = 'İzleme listende paylaşılabilecek yapım yok.';
        return;
    }

    const copied = await copyTextToClipboard(getSharedListRouteUrl(route));
    if (generation !== watchlistShareGeneration) return;
    const cap = watchlist.length > SHARED_LIST_MAX_ITEMS ? ' İlk 30 yapım paylaşılıyor.' : '';
    status.textContent = (copied ? 'Seçki linki kopyalandı.' : 'Seçki linki kopyalanamadı.') + cap;
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'share-list-inline-open-btn';
    openButton.textContent = 'Seçkiyi Aç';
    if (typeof openButton.addEventListener === 'function') {
        openButton.addEventListener('click', () => {
            if (typeof navigate === 'function') navigate(route);
        });
    }
    status.append(openButton);
}

function getUniqueShareListItems(items) {
    const unique = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        const token = encodeSharedListItemToken(item);
        if (token && !unique.has(token)) unique.set(token, item);
    }
    return Array.from(unique.values());
}

function createShareListElement(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function createShareListImage(path, size, className, usePlaceholder = true) {
    const hasPath = typeof isValidTmdbImagePath === 'function' && isValidTmdbImagePath(path);
    if (!hasPath && !usePlaceholder) return null;
    const base = typeof getSizedTmdbImageBase === 'function'
        ? getSizedTmdbImageBase(size, typeof IMAGE_BASE === 'string' ? IMAGE_BASE : undefined)
        : `https://image.tmdb.org/t/p/${size}`;
    const fallback = usePlaceholder ? 'assets/placeholder.svg' : '';
    const url = typeof getSafeTmdbImageUrl === 'function'
        ? getSafeTmdbImageUrl(path, base, fallback)
        : fallback;
    if (!url) return null;
    const image = createShareListElement('img', className);
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    return image;
}

function createShareListPoster(item, size, className, usePlaceholder = true) {
    return createShareListImage(item?.poster_path, size, className, usePlaceholder);
}

function createShareListPersonPhoto(person, size, className, usePlaceholder = true) {
    return createShareListImage(person?.profile_path, size, className, usePlaceholder);
}

function getShareItemTypeLabel(item) {
    return encodeSharedListItemToken(item)?.[0] === 't' ? 'Dizi' : 'Film';
}

function getSharePersonRoleLabel(department) {
    if (department === 'Directing') return 'Yönetmen';
    if (department === 'Writing') return 'Senarist';
    if (department === 'Production') return 'Yapımcı';
    return 'Oyuncu';
}

function renderShareListPersonPreview(person) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' ||
        typeof document.createElement !== 'function') return;
    const preview = document.getElementById('share-list-preview');
    if (!preview) return;

    shareListPreviewItem = null;
    if (!person) {
        renderShareListPreview(null);
        return;
    }

    const card = createShareListElement('div', 'share-list-preview-card');
    const photo = createShareListPersonPhoto(person, 'w185', 'share-list-preview-poster share-list-person-thumb');
    if (photo) card.append(photo);

    const header = createShareListElement('div', 'share-list-preview-header');
    const meta = createShareListElement('div', 'share-list-preview-meta');
    meta.append(createShareListElement('span', 'share-list-preview-type', getSharePersonRoleLabel(person.known_for_department)));
    header.append(createShareListElement('h3', '', person.name || 'İsimsiz kişi'), meta);
    card.append(header);

    const knownFor = Array.isArray(person.known_for)
        ? person.known_for.filter(entry => entry?.title || entry?.name).map(formatShareItemLabel).slice(0, 3)
        : [];
    if (knownFor.length) {
        const works = createShareListElement('div', 'share-list-preview-genres');
        works.append(...knownFor.map(title => createShareListElement('span', '', title)));
        card.append(works);
    }

    card.append(createShareListElement('p', 'share-list-preview-overview', 'Film ve dizilerini görmek için tıkla.'));
    preview.replaceChildren(card);
}

function renderShareListPreview(item) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' ||
        typeof document.createElement !== 'function') return;
    const preview = document.getElementById('share-list-preview');
    if (!preview) return;

    shareListPreviewItem = item;
    if (!item) {
        preview.replaceChildren(createShareListElement('p', 'share-list-preview-empty',
            'Detayını görmek için bir film veya dizinin üzerine gel.'));
        return;
    }

    const card = createShareListElement('div', 'share-list-preview-card');
    const poster = createShareListPoster(item, 'w185', 'share-list-preview-poster');
    if (poster) card.append(poster);

    const header = createShareListElement('div', 'share-list-preview-header');
    const meta = createShareListElement('div', 'share-list-preview-meta');
    const year = extractShareItemYear(item);
    const imdbRating = normalizeShareItemImdbRating(item.imdb_rating);
    meta.append(createShareListElement('span', 'share-list-preview-type', getShareItemTypeLabel(item)));
    if (year) meta.append(createShareListElement('span', 'share-list-preview-year', year));
    if (imdbRating) {
        meta.append(createShareListElement('span', 'share-list-preview-rating', 'IMDb ' + imdbRating));
    }
    header.append(createShareListElement('h3', '', formatShareItemLabel(item)), meta);
    card.append(header);

    const names = getShareItemGenres(item);
    if (names.length) {
        const genres = createShareListElement('div', 'share-list-preview-genres');
        genres.append(...names.map(name => createShareListElement('span', '', name)));
        card.append(genres);
    }

    const overview = typeof item.overview === 'string' ? item.overview.trim() : '';
    card.append(createShareListElement('p', 'share-list-preview-overview', overview || 'Konu özeti bulunmuyor.'));
    preview.replaceChildren(card);
}

function loadShareListPreviewGenres() {
    if (typeof window === 'undefined' || window.genresCache || shareListGenresRequest ||
        typeof loadGenres !== 'function') return;
    shareListGenresRequest = Promise.resolve().then(() => loadGenres()).then(() => {
        if (isShareListBuilderOpen() && shareListPreviewItem) renderShareListPreview(shareListPreviewItem);
    }).catch(() => {
        // Previews can still show genre names supplied with the item.
    }).finally(() => {
        shareListGenresRequest = null;
    });
}

function hideShareListPersonBar() {
    shareListActivePerson = null;
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const personBar = document.getElementById('share-list-person-bar');
    if (personBar) {
        personBar.hidden = true;
        personBar.replaceChildren();
    }
}

function openShareListBuilder(initialDraft = null, options = null) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' ||
        typeof document.createElement !== 'function' || typeof window === 'undefined') return;
    const modal = document.getElementById('share-list-modal');
    const manager = window.ModalManager;
    if (!modal || typeof manager?.openModal !== 'function') return;

    cancelShareListSearch();
    shareListLastSearchResults = [];
    hideShareListPersonBar();
    const parsedDraftRoute = typeof initialDraft?.route === 'string' &&
        (initialDraft.route.startsWith('secki/') || initialDraft.route.startsWith('list?'))
        ? parseSharedListRoute(initialDraft.route)
        : null;
    const savedTitle = parsedDraftRoute
        ? (parsedDraftRoute.hasCustomTitle ? parsedDraftRoute.title : '')
        : initialDraft?.title;
    shareListDraft = {
        id: initialDraft?.id || null,
        title: normalizeSharedListTitle(savedTitle, ''),
        items: getUniqueShareListItems(initialDraft?.items).slice(0, SHARED_LIST_MAX_ITEMS),
        fromCurrentSharedList: Boolean(options?.fromCurrentSharedList)
    };
    shareListDraftInitialSignature = getShareListDraftSignature(shareListDraft);
    const saveBtn = document.getElementById('share-list-save-btn');
    if (saveBtn) {
        setShareListIconButtonLabel(
            saveBtn,
            (shareListDraft.id || shareListDraft.fromCurrentSharedList) ? 'Kaydet ve Güncelle' : 'Profilime Kaydet'
        );
    }
    document.getElementById('share-list-title-input').value = shareListDraft.title;
    document.getElementById('share-list-search-input').value = '';
    document.getElementById('share-list-search-results').replaceChildren();
    setSharedListStatus('share-list-modal-status');

    const library = getUniqueShareListItems([
        ...readShareListLibrary('watchlist'),
        ...readShareListLibrary('ratedMovies')
    ]);
    const chips = document.getElementById('share-list-library-chips');
    chips.replaceChildren(...library.map(item => createShareListChoice(item, true)));
    document.getElementById('share-list-library-section').hidden = !library.length;
    renderShareListDraft();
    renderShareListPreview(shareListDraft.items[0] || library[0]);
    manager.openModal(modal);
    loadShareListPreviewGenres();
}

function closeShareListModal(event, force = false) {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function' ||
        typeof window === 'undefined') return;
    const modal = document.getElementById('share-list-modal');
    const manager = window.ModalManager;
    if (!modal || (!force && event?.target !== modal) || typeof manager?.closeModal !== 'function') return;
    if (!force && isShareListDraftDirty()) {
        const message = 'Kaydedilmemiş değişiklikler var. Kaydetmek için aşağıdaki butonları kullan veya çıkmak için × tuşuna bas.';
        setSharedListStatus('share-list-modal-status', message);
        if (typeof announceA11y === 'function') announceA11y(message);
        return;
    }
    cancelShareListSearch();
    shareListLastSearchResults = [];
    shareListDraftInitialSignature = '';
    hideShareListPersonBar();
    manager.closeModal(modal);
}

function createShareListChoice(item, isLibrary) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = isLibrary ? 'share-list-library-chip' : 'share-list-result-btn';
    button.dataset.shareToken = encodeSharedListItemToken(item);
    const label = createShareListElement('span', 'share-list-item-label', formatShareItemLabel(item));
    const type = getShareItemTypeLabel(item);
    if (isLibrary) {
        button.append(label, createShareListElement('span', 'share-list-item-type', type));
    } else {
        const thumbnail = createShareListPoster(item, 'w92', 'share-list-thumb');
        if (thumbnail) button.append(thumbnail);
        const body = createShareListElement('span', 'share-list-result-body');
        const meta = [type, extractShareItemYear(item)].filter(Boolean).join(' • ');
        body.append(label, createShareListElement('span', 'share-list-result-meta', meta));
        const overview = compactShareItemText(item.overview, 160);
        if (overview) body.append(createShareListElement('span', 'share-list-result-overview', overview));
        button.append(body);
    }
    button.append(createShareListElement('span', 'share-list-choice-action'));
    if (typeof button.addEventListener === 'function') {
        button.addEventListener('click', () => toggleShareListDraftItem(item));
        button.addEventListener('mouseenter', () => renderShareListPreview(item));
        button.addEventListener('focus', () => renderShareListPreview(item));
    }
    return button;
}

function syncShareListChoices() {
    const selected = new Set(shareListDraft.items.map(encodeSharedListItemToken));
    document.querySelectorAll('#share-list-modal [data-share-token]').forEach(button => {
        const added = selected.has(button.dataset.shareToken);
        button.setAttribute('aria-pressed', String(added));
        button.querySelector('.share-list-choice-action').textContent = added ? 'Eklendi' : '+ Ekle';
    });
}

function renderShareListDraft() {
    const { items } = shareListDraft;
    setSharedListStatus('share-list-selected-count', `Seçilen Yapımlar (${items.length} / ${SHARED_LIST_MAX_ITEMS})`);
    const saveBtn = document.getElementById('share-list-save-btn');
    if (saveBtn) saveBtn.disabled = !items.length;
    document.getElementById('share-list-clear-btn').disabled = !items.length;
    document.getElementById('share-list-open-btn').disabled = !items.length;
    document.getElementById('share-list-copy-link-btn').disabled = !items.length;
    const selected = document.getElementById('share-list-selected-items');
    selected.replaceChildren(...items.map(item => {
        const label = formatShareItemLabel(item);
        const pill = document.createElement('div');
        pill.className = 'share-list-pill';
        if (typeof pill.addEventListener === 'function') {
            pill.addEventListener('mouseenter', () => renderShareListPreview(item));
            pill.addEventListener('focusin', () => renderShareListPreview(item));
        }
        const name = document.createElement('span');
        name.textContent = label;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `${label} seçkiden çıkar`);
        if (typeof remove.addEventListener === 'function') {
            remove.addEventListener('click', () => {
                const nextIndex = Array.from(selected.querySelectorAll('button')).indexOf(remove);
                toggleShareListDraftItem(item);
                const buttons = selected.querySelectorAll('button');
                const next = buttons[nextIndex] || buttons[buttons.length - 1] ||
                    document.getElementById('share-list-search-input');
                if (typeof next?.focus === 'function') next.focus();
            });
        }
        pill.append(name, remove);
        return pill;
    }));
    syncShareListChoices();
}

function toggleShareListDraftItem(item) {
    if (!shareListDraft) return;
    const token = encodeSharedListItemToken(item);
    if (!token) return;
    const { items } = shareListDraft;
    const index = items.findIndex(entry => encodeSharedListItemToken(entry) === token);
    if (index !== -1) {
        items.splice(index, 1);
    } else if (items.length < SHARED_LIST_MAX_ITEMS) {
        items.push(item);
    } else {
        setSharedListStatus('share-list-modal-status', `Bir seçkiye en fazla ${SHARED_LIST_MAX_ITEMS} yapım ekleyebilirsin.`);
        return;
    }
    setSharedListStatus('share-list-modal-status');
    renderShareListDraft();
}

function clearShareListDraft() {
    if (!shareListDraft) return;
    shareListDraft.items = [];
    renderShareListDraft();
    setSharedListStatus('share-list-modal-status', 'Seçilen yapımlar temizlendi.');
    const searchInput = document.getElementById('share-list-search-input');
    if (typeof searchInput?.focus === 'function') searchInput.focus();
}

function isShareListBuilderOpen() {
    if (typeof window === 'undefined') return false;
    const manager = window.ModalManager;
    return typeof manager?.isModalOpen === 'function' && manager.isModalOpen('share-list-modal');
}

function cancelShareListSearch() {
    clearTimeout(shareListSearchTimer);
    shareListSearchTimer = null;
    shareListSearchController?.abort();
    shareListSearchController = null;
}

function createShareListPersonChoice(person) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'share-list-result-btn share-list-person-btn';
    const personId = typeof normalizeTmdbId === 'function' ? normalizeTmdbId(person?.id) : null;
    if (personId) button.dataset.sharePersonId = String(personId);

    const photo = createShareListPersonPhoto(person, 'w92', 'share-list-thumb share-list-person-thumb');
    if (photo) button.append(photo);

    const body = createShareListElement('span', 'share-list-result-body');
    const roleLabel = getSharePersonRoleLabel(person?.known_for_department);
    body.append(
        createShareListElement('span', 'share-list-item-label', person?.name || 'İsimsiz kişi'),
        createShareListElement('span', 'share-list-result-meta', `Kişi • ${roleLabel}`)
    );
    const knownFor = Array.isArray(person?.known_for)
        ? compactShareItemText(
            person.known_for.filter(entry => entry?.title || entry?.name).map(formatShareItemLabel).join(' • '),
            160
        )
        : '';
    if (knownFor) body.append(createShareListElement('span', 'share-list-result-overview', knownFor));

    button.append(body, createShareListElement('span', 'share-list-choice-action', 'Yapımları →'));
    if (typeof button.addEventListener === 'function') {
        button.addEventListener('click', () => openShareListPersonCredits(person));
        button.addEventListener('mouseenter', () => renderShareListPersonPreview(person));
        button.addEventListener('focus', () => renderShareListPersonPreview(person));
    }
    return button;
}

function renderShareListSearchResults(items, emptyMessage = 'Film, dizi veya kişi bulunamadı.') {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const results = document.getElementById('share-list-search-results');
    if (!results) return;
    if (!items.length) {
        results.textContent = emptyMessage;
        return;
    }
    results.replaceChildren(...items.map(item =>
        item?.media_type === 'person' ? createShareListPersonChoice(item) : createShareListChoice(item, false)
    ));
    syncShareListChoices();
}

function isSharePersonCreditClean(entry, isCast = false) {
    if (!entry || (entry.media_type !== 'movie' && entry.media_type !== 'tv')) return false;
    const title = typeof entry.title === 'string' && entry.title.trim()
        ? entry.title.trim()
        : (typeof entry.name === 'string' ? entry.name.trim() : '');
    if (!title) return false;
    const hasPoster = typeof isValidTmdbImagePath === 'function'
        ? isValidTmdbImagePath(entry.poster_path)
        : Boolean(entry.poster_path);
    if (!hasPoster) return false;
    if (Array.isArray(entry.genre_ids) && entry.genre_ids.some(id => SHARE_PERSON_EXCLUDED_GENRES.has(Number(id)))) {
        return false;
    }
    const lowerTitle = title.toLowerCase();
    if (SHARE_PERSON_BLOCKED_TITLE_WORDS.some(word => lowerTitle.includes(word))) return false;
    if (isCast && typeof entry.character === 'string' && SHARE_PERSON_SELF_CHARACTER_PATTERN.test(entry.character.trim())) {
        return false;
    }
    return true;
}

function buildSharePersonCredits(data) {
    const normalizeBucket = (entries, isCast = false) => {
        const deduped = new Map();
        for (const entry of Array.isArray(entries) ? entries : []) {
            if (!isSharePersonCreditClean(entry, isCast)) continue;
            const token = encodeSharedListItemToken(entry);
            if (token && !deduped.has(token)) deduped.set(token, entry);
        }
        const isMinorGuestTv = entry =>
            entry.media_type === 'tv' && Number(entry.episode_count) === 1 && entry.job !== 'Director';
        return Array.from(deduped.values()).sort((a, b) => {
            const minorDiff = (isMinorGuestTv(a) ? 1 : 0) - (isMinorGuestTv(b) ? 1 : 0);
            if (minorDiff !== 0) return minorDiff;
            const aNotable = (Number(a.vote_count) || 0) >= 100 ? 1 : 0;
            const bNotable = (Number(b.vote_count) || 0) >= 100 ? 1 : 0;
            if (bNotable !== aNotable) return bNotable - aNotable;
            const voteDiff = (Number(b.vote_count) || 0) - (Number(a.vote_count) || 0);
            if (voteDiff !== 0) return voteDiff;
            return (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
        }).slice(0, 60);
    };

    const rawCrew = Array.isArray(data?.crew) ? data.crew : [];
    const director = normalizeBucket(rawCrew.filter(entry => entry?.job === 'Director'), false);
    const cast = normalizeBucket(data?.cast, true);
    const all = normalizeBucket([...director, ...cast], false);
    return { director, cast, all };
}

function getActiveSharePersonItems() {
    if (!shareListActivePerson?.creditsByRole) return [];
    const roleItems = shareListActivePerson.creditsByRole[shareListActivePerson.activeRole] || [];
    if (shareListActivePerson.activeMediaType === 'movie') {
        return roleItems.filter(item => item.media_type === 'movie');
    }
    if (shareListActivePerson.activeMediaType === 'tv') {
        return roleItems.filter(item => item.media_type === 'tv');
    }
    return roleItems;
}

function renderShareListPersonBar() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const personBar = document.getElementById('share-list-person-bar');
    if (!personBar) return;
    if (!shareListActivePerson) {
        personBar.hidden = true;
        personBar.replaceChildren();
        return;
    }

    const { person, creditsByRole, activeRole, activeMediaType = 'all' } = shareListActivePerson;
    const backBtn = createShareListElement('button', 'share-list-person-back-btn', '← Sonuçlara Dön');
    backBtn.type = 'button';
    if (typeof backBtn.addEventListener === 'function') {
        backBtn.addEventListener('click', () => {
            const personId = typeof normalizeTmdbId === 'function' ? normalizeTmdbId(person?.id) : null;
            cancelShareListSearch();
            hideShareListPersonBar();
            renderShareListSearchResults(shareListLastSearchResults);
            if (person) renderShareListPersonPreview(person);
            const focusTarget = (personId && document.querySelector(`#share-list-search-results [data-share-person-id="${personId}"]`)) ||
                document.getElementById('share-list-search-input');
            if (typeof focusTarget?.focus === 'function') focusTarget.focus();
        });
    }

    const roleItems = creditsByRole?.[activeRole] || [];
    const activeCount = roleItems.length;
    const titleText = creditsByRole && !creditsByRole.director.length && !creditsByRole.cast.length
        ? (person?.name || 'Kişi')
        : creditsByRole && !(creditsByRole.director.length && creditsByRole.cast.length)
            ? `${person?.name || 'Kişi'} (${activeCount})`
            : (person?.name || 'Kişi');
    const title = createShareListElement('span', 'share-list-person-title', titleText);
    const children = [backBtn, title];

    if (creditsByRole && creditsByRole.director.length && creditsByRole.cast.length) {
        const filters = createShareListElement('div', 'share-list-person-filters');
        for (const [role, label] of [['director', 'Yönetmen'], ['cast', 'Oyuncu'], ['all', 'Tümü']]) {
            const count = creditsByRole[role].length;
            if (!count) continue;
            const filterBtn = createShareListElement('button', 'share-list-person-filter-btn', `${label} (${count})`);
            filterBtn.type = 'button';
            filterBtn.setAttribute('aria-pressed', String(activeRole === role));
            if (typeof filterBtn.addEventListener === 'function') {
                filterBtn.addEventListener('click', () => {
                    if (!shareListActivePerson) return;
                    shareListActivePerson.activeRole = role;
                    if (shareListActivePerson.activeMediaType !== 'all' && !getActiveSharePersonItems().length) {
                        shareListActivePerson.activeMediaType = 'all';
                    }
                    renderShareListPersonBar();
                    const list = getActiveSharePersonItems();
                    renderShareListSearchResults(list, 'Bu kategoride eklenebilir yapım bulunamadı.');
                    if (list[0]) renderShareListPreview(list[0]);
                });
            }
            filters.append(filterBtn);
        }
        children.push(filters);
    }

    const movieCount = roleItems.filter(item => item.media_type === 'movie').length;
    const tvCount = roleItems.filter(item => item.media_type === 'tv').length;
    if (movieCount && tvCount) {
        const mediaFilters = createShareListElement('div', 'share-list-person-media-filters');
        for (const [mediaFilter, label, count] of [
            ['all', 'Tümü', roleItems.length],
            ['movie', 'Filmler', movieCount],
            ['tv', 'Diziler', tvCount]
        ]) {
            const mediaBtn = createShareListElement('button', 'share-list-person-filter-btn', `${label} (${count})`);
            mediaBtn.type = 'button';
            mediaBtn.dataset.shareMediaFilter = mediaFilter;
            mediaBtn.setAttribute('aria-pressed', String(activeMediaType === mediaFilter));
            if (typeof mediaBtn.addEventListener === 'function') {
                mediaBtn.addEventListener('click', () => {
                    if (!shareListActivePerson) return;
                    shareListActivePerson.activeMediaType = mediaFilter;
                    renderShareListPersonBar();
                    const list = getActiveSharePersonItems();
                    renderShareListSearchResults(list, 'Bu kategoride eklenebilir yapım bulunamadı.');
                    if (list[0]) renderShareListPreview(list[0]);
                });
            }
            mediaFilters.append(mediaBtn);
        }
        children.push(mediaFilters);
    }

    personBar.hidden = false;
    personBar.replaceChildren(...children);
}

async function openShareListPersonCredits(person) {
    const personId = typeof normalizeTmdbId === 'function' ? normalizeTmdbId(person?.id) : null;
    if (!personId || !isShareListBuilderOpen()) return;

    cancelShareListSearch();
    const results = document.getElementById('share-list-search-results');
    if (!results) return;

    renderShareListPersonPreview(person);
    const cacheKey = String(personId);
    let creditsByRole = shareListPersonCreditsCache.get(cacheKey);
    if (!creditsByRole) {
        shareListActivePerson = { person, creditsByRole: null, activeRole: 'all', activeMediaType: 'all' };
        renderShareListPersonBar();
        results.textContent = 'Yapımlar yükleniyor…';
        const controller = new AbortController();
        shareListSearchController = controller;
        try {
            const params = new URLSearchParams({ language: 'tr-TR' });
            const response = await fetch(`${BASE_URL}/person/${personId}/combined_credits?${params}`, {
                signal: controller.signal
            });
            if (!response.ok) throw new Error('Kişi yapımları yüklenemedi.');
            const data = await response.json();
            if (controller.signal.aborted || !isShareListBuilderOpen()) return;
            creditsByRole = buildSharePersonCredits(data);
            shareListPersonCreditsCache.delete(cacheKey);
            shareListPersonCreditsCache.set(cacheKey, creditsByRole);
            if (shareListPersonCreditsCache.size > SHARED_LIST_CACHE_LIMIT) {
                shareListPersonCreditsCache.delete(shareListPersonCreditsCache.keys().next().value);
            }
        } catch (_) {
            if (!controller.signal.aborted) {
                results.textContent = 'Kişinin yapımları yüklenemedi. Tekrar deneyebilirsin.';
            }
            return;
        } finally {
            if (shareListSearchController === controller) shareListSearchController = null;
        }
    }

    if (!isShareListBuilderOpen()) return;
    const activeRole = person?.known_for_department === 'Directing' && creditsByRole.director.length
        ? 'director'
        : creditsByRole.cast.length
            ? 'cast'
            : 'all';
    shareListActivePerson = { person, creditsByRole, activeRole, activeMediaType: 'all' };
    renderShareListPersonBar();
    const activeItems = getActiveSharePersonItems();
    renderShareListSearchResults(activeItems, 'Bu kişi için eklenebilir yapım bulunamadı.');
    if (activeItems[0]) renderShareListPreview(activeItems[0]);
}

async function searchShareListItems() {
    cancelShareListSearch();
    hideShareListPersonBar();
    if (!isShareListBuilderOpen()) return;
    const query = document.getElementById('share-list-search-input').value.trim();
    const results = document.getElementById('share-list-search-results');
    if (!query) {
        shareListLastSearchResults = [];
        results.replaceChildren();
        return;
    }

    const controller = new AbortController();
    shareListSearchController = controller;
    const params = new URLSearchParams({ language: 'tr-TR', query, include_adult: 'false' });
    results.textContent = 'Aranıyor…';
    try {
        const response = await fetch(`${BASE_URL}/search/multi?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Seçki araması başarısız oldu.');
        const data = await response.json();
        if (controller.signal.aborted) return;

        const items = [];
        const seenTokens = new Set();
        for (const item of Array.isArray(data.results) ? data.results : []) {
            if (!item || (item.media_type !== 'movie' && item.media_type !== 'tv' && item.media_type !== 'person')) continue;
            if (item.media_type === 'person') {
                const personId = typeof normalizeTmdbId === 'function' ? normalizeTmdbId(item.id) : null;
                if (!personId || !String(item.name || '').trim()) continue;
                const personToken = `p${personId}`;
                if (seenTokens.has(personToken)) continue;
                seenTokens.add(personToken);
                items.push(item);
                continue;
            }
            const token = encodeSharedListItemToken(item);
            if (!token || seenTokens.has(token)) continue;
            seenTokens.add(token);
            items.push(item);
        }

        shareListLastSearchResults = items;
        renderShareListSearchResults(items);
    } catch (_) {
        if (!controller.signal.aborted) results.textContent = 'Arama yapılamadı. Tekrar deneyebilirsin.';
    } finally {
        if (shareListSearchController === controller) shareListSearchController = null;
    }
}

function saveBuiltSharedList() {
    const draft = shareListDraft;
    if (!draft?.items.length) return;
    const hadExistingId = Boolean(draft.id);
    const fromCurrentSharedList = Boolean(draft.fromCurrentSharedList);
    const saved = saveSharedListRecord(draft);
    if (!saved) {
        setSharedListStatus('share-list-modal-status', 'Seçki profiline kaydedilemedi.');
        return;
    }
    draft.id = saved.id;
    shareListDraftInitialSignature = getShareListDraftSignature(draft);
    const currentState = getCurrentSharedList();
    closeShareListModal(null, true);
    if (fromCurrentSharedList || currentState) {
        if (currentState?.route !== saved.route && typeof navigate === 'function') {
            navigate(saved.route);
        } else {
            const message = hadExistingId ? 'Seçki güncellendi.' : 'Seçki profiline kaydedildi.';
            setSharedListStatus('shared-list-status', message);
            if (typeof announceA11y === 'function') announceA11y(message);
        }
        return;
    }
    const message = hadExistingId ? 'Seçki güncellendi.' : 'Seçki profiline kaydedildi.';
    setSharedListStatus('saved-lists-status', message);
    setSharedListStatus('watchlist-share-status', message);
    if (typeof announceA11y === 'function') announceA11y(message);
}

async function copyBuiltSharedListLink() {
    const draft = shareListDraft;
    if (!draft?.items.length || typeof window === 'undefined') return;
    const saved = saveSharedListRecord(draft);
    if (saved) {
        draft.id = saved.id;
        shareListDraftInitialSignature = getShareListDraftSignature(draft);
        const saveBtn = document.getElementById('share-list-save-btn');
        if (saveBtn) setShareListIconButtonLabel(saveBtn, 'Kaydet ve Güncelle');
    }
    const routeToCopy = await createShortSharedListRoute(draft.title, draft.items, saved?.shortId);
    if (!routeToCopy) return;
    if (saved) persistSavedSharedListShortId(saved, routeToCopy);
    const copied = await copyTextToClipboard(getSharedListRouteUrl(routeToCopy));
    if (draft === shareListDraft && isShareListBuilderOpen()) {
        const message = copied ? 'Seçki linki kopyalandı.' : 'Seçki linki kopyalanamadı.';
        setSharedListStatus('share-list-modal-status', saved ? message : message + ' Seçki profiline kaydedilemedi.');
    }
}

function openBuiltSharedList() {
    if (!shareListDraft || typeof navigate !== 'function') return;
    const saved = saveSharedListRecord(shareListDraft);
    if (saved) shareListDraft.id = saved.id;
    const route = saved?.route || buildSharedListRoute(shareListDraft.title, shareListDraft.items);
    if (!route) return;
    closeShareListModal(null, true);
    navigate(route);
    if (!saved && typeof announceA11y === 'function') announceA11y('Seçki profiline kaydedilemedi.');
}

function bindShareListControls() {
    const title = document.getElementById('share-list-title-input');
    if (typeof title?.addEventListener === 'function') {
        title.addEventListener('input', () => {
            if (shareListDraft) shareListDraft.title = title.value;
        });
    }
    const searchInput = document.getElementById('share-list-search-input');
    if (typeof searchInput?.addEventListener === 'function') {
        searchInput.addEventListener('input', () => {
            cancelShareListSearch();
            hideShareListPersonBar();
            shareListLastSearchResults = [];
            document.getElementById('share-list-search-results').replaceChildren();
            if (searchInput.value.trim()) {
                shareListSearchTimer = setTimeout(searchShareListItems, 300);
            }
        });
        searchInput.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault();
                searchShareListItems();
            }
        });
    }
    const searchButton = document.getElementById('share-list-search-btn');
    if (typeof searchButton?.addEventListener === 'function') {
        searchButton.addEventListener('click', searchShareListItems);
    }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', bindShareListControls);
}
