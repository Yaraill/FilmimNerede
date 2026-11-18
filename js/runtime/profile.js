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
const PROFILE_BACKUP_VERSION = 1;
const PROFILE_BACKUP_MAX_FILE_BYTES = 5 * 1024 * 1024;
const PROFILE_BACKUP_STORAGE_KEYS = [
    'watchlist',
    'ratedMovies',
    'movieRatings',
    'favoriteActors',
    'recentlyViewed'
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

function normalizeProfileBackupData(data, strict = true) {
    if (!isPlainBackupObject(data)) {
        throw new Error('Yedek verisi geçersiz');
    }

    return {
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
}

function collectCurrentProfileBackupData() {
    return normalizeProfileBackupData({
        watchlist: readProfileBackupStorage('watchlist', []),
        ratedMovies: readProfileBackupStorage('ratedMovies', []),
        movieRatings: readProfileBackupStorage('movieRatings', {}),
        favoriteActors: readProfileBackupStorage('favoriteActors', []),
        recentlyViewed: readProfileBackupStorage('recentlyViewed', [])
    }, false);
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
        payload.version !== PROFILE_BACKUP_VERSION ||
        !Object.prototype.hasOwnProperty.call(payload, 'data')
    ) {
        throw new Error('Desteklenmeyen yedek formatı');
    }
    return normalizeProfileBackupData(payload.data, true);
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

    return {
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
}

function writeProfileBackupData(data) {
    profileMutationGeneration++;
    const previousValues = Object.fromEntries(
        PROFILE_BACKUP_STORAGE_KEYS.map(key => [key, localStorage.getItem(key)])
    );

    try {
        PROFILE_BACKUP_STORAGE_KEYS.forEach(key => {
            localStorage.setItem(key, JSON.stringify(data[key]));
        });
    } catch (error) {
        PROFILE_BACKUP_STORAGE_KEYS.forEach(key => {
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
            ? mergeProfileBackupData(collectCurrentProfileBackupData(), importedData)
            : importedData;
        writeProfileBackupData(finalData);

        try {
            const profile = document.getElementById('profile');
            if (
                profile?.classList.contains('active-tab') &&
                typeof loadProfile === 'function'
            ) {
                loadProfile();
            }
        } catch (refreshError) {
            console.warn('Profil import sonrası yenilenemedi:', refreshError);
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

function refreshProfileWatchStats(routeContext = null) {
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
        calculateExactWatchTime(ratedMovies, routeContext?.signal, trackedTvShows)
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

function loadProfile(routeContext = null) {
    renderTvTrackerSection();
    refreshProfileWatchStats(routeContext);
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
    trackedTvShows = []
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
                    if (data && !signal?.aborted && typeof updateTvShowAvgRuntime === 'function') {
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
