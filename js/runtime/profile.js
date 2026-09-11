function toggleWatchlist(btnElem, movieId) {
    const item = window.movieCache[movieId];
    if (!item) return;
    
    let watchlist = JSON.parse(localStorage.getItem('watchlist')) || [];
    const existingIndex = watchlist.findIndex(w => w.id === item.id);
    const isAdding = existingIndex === -1;
    
    if (!isAdding) {
        watchlist.splice(existingIndex, 1);
    } else {
        watchlist.push(item);
    }
    
    localStorage.setItem('watchlist', JSON.stringify(watchlist));
    
    // Global sync for all heart buttons for this movie
    const allBtns = document.querySelectorAll(`button[onclick*="toggleWatchlist(this, ${item.id})"]`);
    allBtns.forEach(btn => {
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
    
    // Explicit sync for the modal button if it's currently open for this movie
    const modalBtn = document.getElementById("modal-wl-btn");
    if (modalBtn && window.currentMovieId === item.id) {
        if (!isAdding) {
            modalBtn.classList.remove('active');
            modalBtn.classList.add('inactive');
            modalBtn.innerHTML = '<i class="fas fa-heart"></i> Listeme Ekle';
            modalBtn.style.background = "";
            modalBtn.style.color = "";
        } else {
            modalBtn.classList.remove('inactive');
            modalBtn.classList.add('active');
            modalBtn.innerHTML = `<i class="fas fa-heart"></i> Listeden Çıkar`;
            modalBtn.style.background = "";
            modalBtn.style.color = "";
        }
    }
    
    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }
}

function toggleRateMenu(id) {
    const menu = document.getElementById(`rate-menu-${id}`);
    if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

function saveRating(id, rating) {
    const savedRatings = JSON.parse(localStorage.getItem('movieRatings') || '{}');
    savedRatings[id] = rating;
    localStorage.setItem('movieRatings', JSON.stringify(savedRatings));
    
    // Ayrıca "Listem" sekmesinde gözükmesi için ratedMovies dizisine de kaydedelim
    const item = window.movieCache[id];
    if (item) {
        let ratedMovies = JSON.parse(localStorage.getItem('ratedMovies') || '[]');
        if (!ratedMovies.some(m => m.id === id)) {
            ratedMovies.push(item);
            localStorage.setItem('ratedMovies', JSON.stringify(ratedMovies));
        }
    }

    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }

    const textSpan = document.getElementById(`rate-text-${id}`);
    if (textSpan) textSpan.innerText = `⭐ ${rating}/10`;
    const btn = textSpan ? textSpan.parentElement : null;
    if (btn) {
        btn.classList.add('active');
        btn.classList.remove('inactive');
    }
    const menu = document.getElementById(`rate-menu-${id}`);
    if (menu) menu.style.display = 'none';
}

function removeRating(id) {
    const savedRatings = JSON.parse(localStorage.getItem('movieRatings') || '{}');
    delete savedRatings[id];
    localStorage.setItem('movieRatings', JSON.stringify(savedRatings));
    
    let ratedMovies = JSON.parse(localStorage.getItem('ratedMovies') || '[]');
    ratedMovies = ratedMovies.filter(m => m.id !== id);
    localStorage.setItem('ratedMovies', JSON.stringify(ratedMovies));

    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }

    const textSpan = document.getElementById(`rate-text-${id}`);
    if (textSpan) textSpan.innerText = "İzledim / Puan Ver";
    const btn = textSpan ? textSpan.parentElement : null;
    if (btn) {
        btn.classList.remove('active');
        btn.classList.add('inactive');
    }
    const menu = document.getElementById(`rate-menu-${id}`);
    if (menu) menu.style.display = 'none';
}

function renderRecentlyViewed(routeContext = null) {
    const recent = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    const container = document.getElementById('recently-viewed-grid');
    if (!container) return;
    
    if (recent.length === 0) {
        document.getElementById('recently-viewed-section').style.display = 'none';
    } else {
        document.getElementById('recently-viewed-section').style.display = 'block';
        container.innerHTML = recent.map(item => createMovieCard(item, item.media_type, "")).join('');
        recent.forEach(item => fetchAndInjectProviders(item.id, item.media_type, item, routeContext));
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
    const seenIds = new Set();
    value.forEach(item => {
        const safeItem = normalizeBackupMovieItem(item);
        if (!safeItem) {
            if (strict) throw new Error(`${fieldName} geçersiz kayıt içeriyor`);
            return;
        }
        if (seenIds.has(safeItem.id)) return;
        seenIds.add(safeItem.id);
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
    Object.entries(value).forEach(([rawId, rawRating]) => {
        const id = normalizeTmdbId(rawId);
        const rating = normalizeUserRating(rawRating);
        if (!id || rating === null) {
            if (strict) throw new Error('movieRatings geçersiz kayıt içeriyor');
            return;
        }
        normalized[id] = rating;
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

function mergeBackupList(currentItems, importedItems, limit = null) {
    const merged = [];
    const seenIds = new Set();
    [...currentItems, ...importedItems].forEach(item => {
        const id = normalizeTmdbId(item?.id);
        if (!id || seenIds.has(id)) return;
        seenIds.add(id);
        merged.push(item);
    });
    return typeof limit === 'number' ? merged.slice(0, limit) : merged;
}

function mergeProfileBackupData(currentData, importedData) {
    return {
        watchlist: mergeBackupList(currentData.watchlist, importedData.watchlist),
        ratedMovies: mergeBackupList(currentData.ratedMovies, importedData.ratedMovies),
        movieRatings: { ...importedData.movieRatings, ...currentData.movieRatings },
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
        el.style.display = 'none';
        el.hidden = true;
    });
    const target = document.getElementById(tabId);
    if (target) {
        target.classList.add('active-tab');
        target.style.display = 'block';
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

function loadProfile(routeContext = null) {
    const watchlistGrid = document.getElementById('watchlist-grid');
    const ratedTvGrid = document.getElementById('rated-tv-grid');
    const ratedMovieGrid = document.getElementById('rated-movie-grid');
    const actorsGrid = document.getElementById('favorite-actors-grid');
    const statsContainer = document.getElementById('profile-stats-container');
    
    const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    const ratedMovies = JSON.parse(localStorage.getItem('ratedMovies') || '[]');
    let favoriteActors = [];

    try {
        const parsedFavoriteActors =
            JSON.parse(
                localStorage.getItem(
                    'favoriteActors'
                ) ||
                '[]'
            );

        if (
            Array.isArray(
                parsedFavoriteActors
            )
        ) {
            favoriteActors =
                parsedFavoriteActors;
        }
    } catch (error) {
        console.warn(
            'Favorite actors okunamadı:',
            error
        );
    }
        
    // Stats Calculation
    let totalWatchTimeMinutes = 0;
let needsFetch = false;

ratedMovies.forEach(m => {
    const itemId =
        normalizeTmdbId(
            m?.id
        );

    if (!itemId) {
        return;
    }

    const inferredMediaType =
        (
            m?.first_air_date ||
            (
                m?.name &&
                !m?.title
            )
        )
            ? 'tv'
            : 'movie';

    const mediaType =
        normalizeMediaType(
            m?.media_type,
            inferredMediaType
        );

    if (!mediaType) {
        return;
    }

    const cachedRuntime =
        typeof m
            ?.exact_runtime_mins_v2 ===
            'number' &&
        Number.isFinite(
            m.exact_runtime_mins_v2
        ) &&
        m.exact_runtime_mins_v2 > 0
            ? m.exact_runtime_mins_v2
            : null;

    if (cachedRuntime !== null) {
        totalWatchTimeMinutes +=
            cachedRuntime;

        return;
    }

    totalWatchTimeMinutes +=
        mediaType === 'tv'
            ? 900
            : 120;

    needsFetch =
        true;
});
    
    let displayHours = Math.floor(totalWatchTimeMinutes / 60);
    let displayMins = totalWatchTimeMinutes % 60;
    let timeText = `${displayHours}s ${displayMins > 0 ? displayMins + 'd' : ''}`;
    if (needsFetch) timeText = "~" + displayHours + "s";
    
    let genreCounts = {};
    ratedMovies.forEach(m => {
        if (m.genre_ids) {
            m.genre_ids.forEach(gId => {
                genreCounts[gId] = (genreCounts[gId] || 0) + 1;
            });
        }
    });
    
    let favoriteGenre = "Belirsiz";
    if (Object.keys(genreCounts).length > 0) {
        const topGenreId = Object.keys(genreCounts).reduce((a, b) => genreCounts[a] > genreCounts[b] ? a : b);
        const allGenres = Object.values(window.genresCache || {}).flat();
        const genreObj = allGenres.find(g => String(g.id) === String(topGenreId));
        if (genreObj) favoriteGenre = genreObj.name;
    }
    
    const savedRatings = JSON.parse(localStorage.getItem('movieRatings') || '{}');
    const ratingsArray = Object.values(savedRatings);
    const avgRating = ratingsArray.length > 0 ? (ratingsArray.reduce((a,b)=>a+b,0) / ratingsArray.length).toFixed(1) : 0;
    
    statsContainer.innerHTML = `
        <div class="stat-card" style="border-top: 2px solid var(--primary-color); position:relative; overflow:hidden;">
            <i class="fas fa-film" style="position:absolute; right:-10px; bottom:-10px; font-size:4rem; color:rgba(128,128,128,0.1);"></i>
            <div class="stat-value" style="background: -webkit-linear-gradient(45deg, var(--primary-color), var(--accent-color)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${watchlist.length + ratedMovies.length}</div>
            <div class="stat-label" style="font-weight:600; letter-spacing:1px; font-size:0.9rem;">Toplam İçerik</div>
        </div>
        <div class="stat-card" style="border-top: 2px solid #00c6ff; position:relative; overflow:hidden;">
            <i class="fas fa-clock" style="position:absolute; right:-10px; bottom:-10px; font-size:4rem; color:rgba(128,128,128,0.1);"></i>
            <div class="stat-value" id="profile-watch-time" style="background: -webkit-linear-gradient(45deg, #00c6ff, #0072ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${timeText}</div>
            <div class="stat-label" style="font-weight:600; letter-spacing:1px; font-size:0.9rem;">İzleme Süresi</div>
        </div>
        <div class="stat-card" style="border-top: 2px solid #f1c40f; position:relative; overflow:hidden;">
            <i class="fas fa-star" style="position:absolute; right:-10px; bottom:-10px; font-size:4rem; color:rgba(128,128,128,0.1);"></i>
            <div class="stat-value" style="background: -webkit-linear-gradient(45deg, #f1c40f, #e67e22); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${avgRating}</div>
            <div class="stat-label" style="font-weight:600; letter-spacing:1px; font-size:0.9rem;">Ortalama Puan</div>
        </div>
        <div class="stat-card" style="border-top: 2px solid #9b59b6; position:relative; overflow:hidden;">
            <i class="fas fa-heart" style="position:absolute; right:-10px; bottom:-10px; font-size:4rem; color:rgba(128,128,128,0.1);"></i>
            <div class="stat-value" style="font-size:1.5rem; line-height:2.5rem; background: -webkit-linear-gradient(45deg, #9b59b6, #8e44ad); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${escapeHtml(favoriteGenre)}</div>
            <div class="stat-label" style="font-weight:600; letter-spacing:1px; font-size:0.9rem;">Favori Tür</div>
        </div>
    `;

    // Asynchronously calculate exact watch time
    if (needsFetch) {
    calculateExactWatchTime(
        ratedMovies,
        routeContext?.signal
    )
        .then(exactMinutes => {
            if (
                routeContext
                    ?.signal
                    ?.aborted
            ) {
                return;
            }

            if (
                routeContext &&
                !isRouteContextCurrent(
                    routeContext,
                    'profile'
                )
            ) {
                return;
            }

            const watchTimeElem =
                document.getElementById(
                    'profile-watch-time'
                );

            if (
                watchTimeElem &&
                exactMinutes > 0
            ) {
                const hours =
                    Math.floor(
                        exactMinutes /
                        60
                    );

                const mins =
                    exactMinutes %
                    60;

                watchTimeElem.innerText =
                    `${hours}s ${mins > 0 ? mins + 'd' : ''}`;
            }
        })
        .catch(error => {
            if (
                error.name ===
                'AbortError'
            ) {
                return;
            }

            console.warn(
                'İzleme süresi hesaplanamadı:',
                error
            );
        });
}
    
    // Render Recently Viewed
    renderRecentlyViewed(routeContext);

    // Render Watchlist
    if (watchlist.length === 0) {
        watchlistGrid.innerHTML = "<div class='no-provider' style='grid-column: 1/-1;'>İzleme listeniz boş.</div>";
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
        ratedTvGrid.innerHTML = "<div class='no-provider' style='grid-column: 1/-1;'>Puanladığınız dizi yok.</div>";
    } else {
        ratedTvGrid.innerHTML = ratedTvs.map(item => createMovieCard(item, "tv", "")).join('');
    }

    if (ratedMoviesOnly.length === 0) {
        ratedMovieGrid.innerHTML = "<div class='no-provider' style='grid-column: 1/-1;'>Puanladığınız film yok.</div>";
    } else {
        ratedMovieGrid.innerHTML = ratedMoviesOnly.map(item => createMovieCard(item, "movie", "")).join('');
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
            "<div class='no-provider' style='grid-column: 1/-1;'>Favori oyuncunuz yok.</div>";
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
                        'https://via.placeholder.com/150x225?text=Yok'
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

async function calculateExactWatchTime(
    ratedMovies,
    signal = null
) {
    if (
        !Array.isArray(
            ratedMovies
        ) ||
        ratedMovies.length ===
            0
    ) {
        return 0;
    }

    if (signal?.aborted) {
        const error =
            new Error('Aborted');

        error.name =
            'AbortError';

        throw error;
    }

    let updated = false;

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
                    `${BASE_URL}/${mediaType}/${itemId}?api_key=${API_KEY}&language=tr-TR`,
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
            ratedMovies,
            WATCH_TIME_CONCURRENCY,
            async item => {
                if (signal?.aborted) {
                    const error =
                        new Error(
                            'Aborted'
                        );

                    error.name =
                        'AbortError';

                    throw error;
                }

                const itemId =
                    normalizeTmdbId(
                        item?.id
                    );

                if (!itemId) {
                    return 0;
                }

                const inferredMediaType =
                    (
                        item
                            ?.first_air_date ||
                        (
                            item?.name &&
                            !item?.title
                        )
                    )
                        ? 'tv'
                        : 'movie';

                const mediaType =
                    normalizeMediaType(
                        item
                            ?.media_type,
                        inferredMediaType
                    );

                if (!mediaType) {
                    return 0;
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

    if (updated) {
        try {
            localStorage.setItem(
                'ratedMovies',
                JSON.stringify(
                    ratedMovies
                )
            );
        } catch (error) {
            console.warn(
                'Watch time cache yazılamadı:',
                error
            );
        }
    }

    return exactTimeMinutes;
}