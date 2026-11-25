function normalizeImdbRating(value) {
    let numeric = null;

    if (typeof value === 'number') {
        numeric = value;
    } else if (
        typeof value === 'string' &&
        /^(?:10(?:\.0+)?|[0-9](?:\.\d+)?)$/.test(
            value.trim()
        )
    ) {
        numeric = Number(value.trim());
    }

    if (
        !Number.isFinite(numeric) ||
        numeric <= 0 ||
        numeric > 10
    ) {
        return null;
    }

    return numeric.toFixed(1);
}

function buildImdbRatingElement(imdbId, displayRatingText, state = 'ready') {
    const link = document.createElement('a');
    link.href = `https://www.imdb.com/title/${imdbId}/`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.style.cssText = 'text-decoration:none;color:inherit;';
    link.dataset.imdbState = state;
    if (state === 'loading') link.setAttribute('aria-busy', 'true');

    const badge = document.createElement('span');
    badge.className = 'imdb-badge';
    badge.textContent = 'IMDb';
    link.append(badge, document.createTextNode(' ' + displayRatingText));
    return link;
}

function syncDetailsMetaSeparators(metaContainer) {
    const isVisibleSection = element => Boolean(
        element &&
        !element.hasAttribute('data-meta-sep') &&
        !element.hidden &&
        element.style.display !== 'none' &&
        element.textContent.trim()
    );

    const children = Array.from(metaContainer.children);
    let hasVisibleBefore = false;
    for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (child.hasAttribute('data-meta-sep')) {
            const hasVisibleAfter = children.slice(i + 1).some(isVisibleSection);
            const visible = hasVisibleBefore && hasVisibleAfter;
            child.hidden = !visible;
            child.style.display = visible ? '' : 'none';
            if (visible) {
                hasVisibleBefore = false;
            }
            continue;
        }
        if (isVisibleSection(child)) {
            hasVisibleBefore = true;
        }
    }
}

const MOVIE_DETAIL_CACHE_TTL_MS = 60000;
const MOVIE_DETAIL_CACHE_MAX_ENTRIES = 50;
const MEDIA_DETAIL_PREFETCH_DELAY_MS = 150;
const MOVIE_DETAIL_APPEND_PARAM = 'videos,credits,recommendations,external_ids';
const movieDetailCache = new Map();
const movieDetailInflight = new Map();
const movieCollectionCache = new Map();
const movieCollectionInflight = new Map();
let movieTrailerRequest = null;
let mediaDetailPrefetchTimer = null;

function createMovieAbortError() {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
}

function getShortLivedCacheEntry(cache, key, ttlMs) {
    if (!key) return null;
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttlMs) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

function setShortLivedCacheEntry(cache, key, data, maxEntries) {
    if (!key || !data || typeof data !== 'object') return;
    if (cache.has(key)) {
        cache.delete(key);
    } else if (cache.size >= maxEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) {
            cache.delete(oldestKey);
        }
    }
    cache.set(key, { data, timestamp: Date.now() });
}

function getMovieDetailCacheKey(mediaType, id) {
    if (typeof getMediaKey === 'function') {
        return getMediaKey(mediaType, id);
    }
    const safeType = normalizeMediaType(mediaType);
    const safeId = normalizeTmdbId(id);
    return safeType && safeId ? `${safeType}:${safeId}` : null;
}

function getCachedExtendedMediaDetail(mediaType, id) {
    const key = getMovieDetailCacheKey(mediaType, id);
    return getShortLivedCacheEntry(
        movieDetailCache,
        key,
        MOVIE_DETAIL_CACHE_TTL_MS
    );
}

function runWithSharedInflight(inflightMap, key, signal, fetcher) {
    if (signal?.aborted) {
        return Promise.reject(createMovieAbortError());
    }

    let entry = inflightMap.get(key);
    if (!entry || entry.controller?.signal?.aborted) {
        const controller =
            typeof AbortController === 'function'
                ? new AbortController()
                : null;
        entry = {
            subscribers: 0,
            controller,
            promise: null
        };
        entry.promise = Promise.resolve()
            .then(() => fetcher(controller ? controller.signal : undefined))
            .finally(() => {
                if (inflightMap.get(key) === entry) {
                    inflightMap.delete(key);
                }
            });
        inflightMap.set(key, entry);
    }

    entry.subscribers += 1;

    if (!signal) {
        return entry.promise.finally(() => {
            entry.subscribers = Math.max(0, entry.subscribers - 1);
        });
    }

    return new Promise((resolve, reject) => {
        let settled = false;

        const onAbort = () => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', onAbort);
            entry.subscribers = Math.max(0, entry.subscribers - 1);
            if (entry.subscribers === 0 && entry.controller) {
                if (inflightMap.get(key) === entry) {
                    inflightMap.delete(key);
                }
                entry.controller.abort();
            }
            reject(createMovieAbortError());
        };

        signal.addEventListener('abort', onAbort, { once: true });

        entry.promise.then(
            result => {
                if (settled) return;
                settled = true;
                signal.removeEventListener('abort', onAbort);
                entry.subscribers = Math.max(0, entry.subscribers - 1);
                resolve(result);
            },
            error => {
                if (settled) return;
                settled = true;
                signal.removeEventListener('abort', onAbort);
                entry.subscribers = Math.max(0, entry.subscribers - 1);
                reject(error);
            }
        );
    });
}

async function fetchExtendedMediaDetail(mediaType, id, signal) {
    if (signal?.aborted) {
        throw createMovieAbortError();
    }

    const safeType = normalizeMediaType(mediaType);
    const safeId = normalizeTmdbId(id);
    const key = getMovieDetailCacheKey(safeType, safeId);
    if (!safeType || !safeId || !key) {
        return { ok: false, data: null };
    }

    const cached = getCachedExtendedMediaDetail(safeType, safeId);
    if (cached) {
        return { ok: true, data: cached, fromCache: true };
    }

    return runWithSharedInflight(movieDetailInflight, key, signal, async sharedSignal => {
        const res = await fetch(
            `${BASE_URL}/${safeType}/${safeId}?language=tr-TR&append_to_response=${MOVIE_DETAIL_APPEND_PARAM}`,
            sharedSignal ? { signal: sharedSignal } : undefined
        );
        const data = await res.json();
        if (res.ok && normalizeTmdbId(data?.id) === safeId && data.status_code !== 34) {
            if (safeType === 'tv') {
                data.title = data.name || data.title;
            }
            data.media_type = safeType;
            setShortLivedCacheEntry(
                movieDetailCache,
                key,
                data,
                MOVIE_DETAIL_CACHE_MAX_ENTRIES
            );
            return { ok: true, data };
        }
        return { ok: false, data };
    });
}

function cancelMediaDetailPrefetch() {
    if (mediaDetailPrefetchTimer !== null) {
        clearTimeout(mediaDetailPrefetchTimer);
        mediaDetailPrefetchTimer = null;
    }
}

function scheduleMediaDetailPrefetch(movieId, mediaType = 'movie') {
    cancelMediaDetailPrefetch();

    const safeId = normalizeTmdbId(movieId);
    const safeType = normalizeMediaType(mediaType);
    if (!safeId || !safeType) return;
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData === true) return;

    const key = getMovieDetailCacheKey(safeType, safeId);
    if (!key || getCachedExtendedMediaDetail(safeType, safeId) || movieDetailInflight.has(key)) return;

    mediaDetailPrefetchTimer = setTimeout(() => {
        mediaDetailPrefetchTimer = null;
        if (!getCachedExtendedMediaDetail(safeType, safeId) && !movieDetailInflight.has(key)) {
            fetchExtendedMediaDetail(safeType, safeId).catch(() => {});
        }
    }, MEDIA_DETAIL_PREFETCH_DELAY_MS);
}

async function fetchCollectionDetail(collectionId, signal) {
    if (signal?.aborted) {
        throw createMovieAbortError();
    }

    const safeCollectionId = normalizeTmdbId(collectionId);
    if (!safeCollectionId) {
        return null;
    }

    const key = `collection:${safeCollectionId}`;
    const cached = getShortLivedCacheEntry(
        movieCollectionCache,
        key,
        MOVIE_DETAIL_CACHE_TTL_MS
    );
    if (cached) {
        return cached;
    }

    return runWithSharedInflight(movieCollectionInflight, key, signal, async sharedSignal => {
        const colRes = await fetch(
            `${BASE_URL}/collection/${safeCollectionId}?language=tr-TR`,
            sharedSignal ? { signal: sharedSignal } : undefined
        );
        const colData = await colRes.json();
        if (colRes.ok && colData && colData.status_code !== 34) {
            setShortLivedCacheEntry(
                movieCollectionCache,
                key,
                colData,
                MOVIE_DETAIL_CACHE_MAX_ENTRIES
            );
        }
        return colData;
    });
}


function openDetails(movieId, mediaType = null) {
    const safeMovieId =
        normalizeTmdbId(movieId);

    if (!safeMovieId) {
        return;
    }

    const explicitMediaType =
        normalizeMediaType(mediaType);

    if (explicitMediaType) {
        navigate(
            `movie/${safeMovieId}/${explicitMediaType}`
        );
        return;
    }

    const cachedItem =
        typeof getCachedMedia === 'function'
            ? getCachedMedia(safeMovieId, null)
            : window.movieCache[safeMovieId];
    const cachedMediaType =
        normalizeMediaType(
            cachedItem?.media_type
        );

    if (cachedMediaType) {
        navigate(
            `movie/${safeMovieId}/${cachedMediaType}`
        );
        return;
    }

    // Legacy route:
    // type bilinmiyorsa renderMovie()
    // mevcut movie -> tv fallback'ini yapacak.
    navigate(
        `movie/${safeMovieId}`
    );
}

function clearDetailsModalActions(modal) {
    modal?.querySelectorAll('.details-left .btn-watchlist, .details-left [id^="rate-menu-"]').forEach(control => {
        if (control.closest('#modal-providers')) return;
        const wrapper = control.parentElement;
        const isActionWrapper = wrapper?.tagName === 'DIV' &&
            wrapper.style.position === 'relative' &&
            !wrapper.matches('.details-left') &&
            !wrapper.querySelector('#modal-providers');
        (isActionWrapper ? wrapper : control).remove();
    });
}

function resetDetailsModalView(modal) {
    if (!modal) return;

    const title = modal.querySelector('#details-title');
    if (title) title.textContent = 'Yapım detayları yükleniyor...';
    const overview = modal.querySelector('#details-overview');
    if (overview) overview.textContent = '';
    modal.querySelector('#details-meta')?.replaceChildren();

    const poster = modal.querySelector('#details-poster');
    if (poster) {
        poster.onload = null;
        poster.onerror = null;
        poster.removeAttribute('src');
        poster.alt = '';
        poster.style.visibility = 'hidden';
    }

    const backdrop = modal.querySelector('#details-backdrop');
    if (backdrop) {
        backdrop.style.backgroundImage = '';
        backdrop.style.display = 'block';
    }
    const ambilight = modal.querySelector('#ambilight-bg');
    if (ambilight) ambilight.style.backgroundImage = '';
    document.documentElement.style.removeProperty('--primary-color');
    document.documentElement.style.removeProperty('--accent-color');

    const dateBadge = modal.querySelector('#details-date-badge');
    if (dateBadge) {
        dateBadge.textContent = '';
        dateBadge.style.display = 'none';
    }

    const providers = modal.querySelector('#modal-providers');
    if (providers) providers.textContent = 'Platformlar aranıyor...';
    modal.querySelector('#details-cast')?.replaceChildren();
    modal.querySelector('#details-recommendations')?.replaceChildren();

    const video = modal.querySelector('#video-bg-container');
    if (video) {
        video.innerHTML = '';
        video.style.opacity = '0';
    }

    modal.querySelectorAll('#collection-container, #tv-guide-container, .btn-calendar-modal')
        .forEach(element => element.remove());
    clearDetailsModalActions(modal);
}

async function renderMovie(
    movieId,
    routeContext,
    requestedMediaType = null
) {
    const safeMovieId =
        normalizeTmdbId(movieId);

    if (!safeMovieId) {
        return;
    }

    movieId = safeMovieId;

    requestedMediaType =
        normalizeMediaType(
            requestedMediaType
        );

    const modal =
        document.getElementById(
            'details-modal'
        );
    if (!isRouteContextCurrent(routeContext, 'movie', movieId)) return;

    resetDetailsModalView(modal);
    const metaContainer = document.getElementById('details-meta');
    const detailsTitle = document.getElementById('details-title');
    if (modal) {
        if (window.ModalManager) {
            window.ModalManager.openModal(modal);
        } else {
            modal.style.display = 'flex';
            modal.classList.add('active');
            modal.removeAttribute('aria-hidden');
            document.body.style.overflow = "hidden";
        }
        modal.scrollTo(0, 0);
        const detailsContent = modal.querySelector('.details-content');
        if (detailsContent) detailsContent.scrollTop = 0;
    }
    window.currentMovieId = movieId;
    window.currentMediaType = requestedMediaType;
    window.currentImdbId = null;

    try {
    let extendedData = requestedMediaType
        ? getCachedExtendedMediaDetail(requestedMediaType, movieId)
        : null;
    let cachedBasicItem = null;
    if (!extendedData && requestedMediaType) {
        const cached = getCachedMedia(movieId, requestedMediaType);
        if (cached?.id === movieId) cachedBasicItem = cached;
    }

    const cacheExtendedDetail = (result, mediaType, basicItem = null) => {
        const data = result?.data;
        if (!result?.ok || normalizeTmdbId(data?.id) !== movieId ||
            !isRouteContextCurrent(routeContext, 'movie', movieId)) return null;

        data.id = movieId;
        data.media_type = mediaType;
        const cached = basicItem ? { ...basicItem, ...data } : data;
        setCachedMedia(cached, mediaType);
        return data;
    };

    const handleDetailError = error => {
        if (error.name !== 'AbortError' && isRouteContextCurrent(routeContext, 'movie', movieId)) {
            console.error(error);
        }
        return {};
    };

    let fullDataPromise;
    if (extendedData) {
        cacheExtendedDetail({ ok: true, data: extendedData }, requestedMediaType);
    } else if (cachedBasicItem) {
        const backgroundDetailPromise = fetchExtendedMediaDetail(requestedMediaType, movieId, routeContext?.signal);
        fullDataPromise = backgroundDetailPromise
            .then(result => cacheExtendedDetail(result, requestedMediaType, cachedBasicItem) || {})
            .catch(handleDetailError);
    } else {
        try {
            let mediaType = requestedMediaType || 'movie';
            let result = await fetchExtendedMediaDetail(mediaType, movieId, routeContext?.signal);
            if (!isRouteContextCurrent(routeContext, 'movie', movieId)) return;
            if (!requestedMediaType && !result.ok) {
                mediaType = 'tv';
                result = await fetchExtendedMediaDetail(mediaType, movieId, routeContext?.signal);
            }
            extendedData = cacheExtendedDetail(result, mediaType);
        } catch (error) {
            if (error.name === 'AbortError') return;
            handleDetailError(error);
        }
    }

    if (!isRouteContextCurrent(routeContext, 'movie', movieId)) return;

    const item = extendedData || cachedBasicItem || getCachedMedia(movieId, requestedMediaType);
    if (item?.id !== movieId) {
        if (detailsTitle) detailsTitle.textContent = 'Yapım detayları yüklenemedi';
        const overview = document.getElementById('details-overview');
        if (overview) {
            overview.textContent = 'Bağlantı hatası nedeniyle yapım bilgileri alınamadı. Lütfen daha sonra tekrar deneyin.';
        }
        return;
    }

    item.media_type = requestedMediaType || inferItemMediaType(item);

    // Verify legacy cache entries when neither detail endpoint provided a result.
    if (!extendedData && !requestedMediaType) {
        try {
            const response = await fetch(`${BASE_URL}/${item.media_type}/${item.id}?language=tr-TR`, {
                signal: routeContext?.signal
            });
            const verification = await response.json();
            if (!isRouteContextCurrent(routeContext, 'movie', movieId)) return;
            if (verification.status_code === 34) {
                item.media_type = item.media_type === 'movie' ? 'tv' : 'movie';
                setCachedMedia(item, item.media_type);
            }
        } catch (error) {
            if (error.name === 'AbortError') return;
        }
    }

    if (!isRouteContextCurrent(routeContext, 'movie', movieId)) return;
    window.currentMediaType = item.media_type;
    if (typeof syncResolvedMediaRoute === 'function') {
        syncResolvedMediaRoute(movieId, item.media_type);
    }

    fullDataPromise ??= extendedData
        ? Promise.resolve(extendedData)
        : fetchExtendedMediaDetail(item.media_type, movieId, routeContext?.signal)
            .then(result => cacheExtendedDetail(result, item.media_type, item) || {})
            .catch(handleDetailError);

    const detailTitle = String(item.title || item.name || 'Bilinmiyor');
    detailsTitle.textContent = detailTitle;
    if (typeof updateRouteSeoMeta === 'function') {
        const releaseDateStr = String(item.release_date || item.first_air_date || '');
        const releaseYear = releaseDateStr ? releaseDateStr.split('-')[0] : '';
        const titleWithYear = releaseYear ? `${detailTitle} (${releaseYear})` : detailTitle;
        const canonicalSlug = item.media_type === 'tv' ? 'dizi' : 'film';
        const rawOverview = String(item.overview || '').trim();
        const seoDesc = rawOverview
            ? rawOverview.slice(0, 155) + (rawOverview.length > 155 ? '…' : '')
            : `${titleWithYear} hangi dijital platformda izlenir? Türkiye yayın bilgileri, IMDb puanı ve fragmanı FilmimNerede'de.`;
        updateRouteSeoMeta({
            title: `${titleWithYear} Hangi Platformda? | FilmimNerede`,
            description: seoDesc,
            canonical: `https://filmimnerede.netlify.app/${canonicalSlug}/${movieId}`
        });
    }

    const overview = document.getElementById('details-overview');
    overview.textContent = item.overview || 'Bu yapım için konu özeti bulunmuyor.';

    const initialPosterPath = item.poster_path;
    const initialBackdropPath = item.backdrop_path;
    const posterImgElem = document.getElementById('details-poster');
    const backdropEl = document.getElementById('details-backdrop');
    const ambilightEl = document.getElementById('ambilight-bg');

    posterImgElem.crossOrigin = 'anonymous';
    posterImgElem.alt = detailTitle;

    // Dynamic Theme (ColorThief)
    posterImgElem.onload = function() {
        if (!isRouteContextCurrent(routeContext, 'movie', movieId)) return;
        try {
            if (typeof ColorThief !== 'undefined') {
                const colorThief = new ColorThief();
                const color = colorThief.getColor(posterImgElem);
                if (color) {
                    document.documentElement.style.setProperty('--primary-color', `rgb(${color[0]}, ${color[1]}, ${color[2]})`);

                    // Lighter accent
                    const accentR = Math.min(255, color[0] + 50);
                    const accentG = Math.min(255, color[1] + 50);
                    const accentB = Math.min(255, color[2] + 50);
                    document.documentElement.style.setProperty('--accent-color', `rgb(${accentR}, ${accentG}, ${accentB})`);
                }
            }
        } catch(e) {
            console.log("ColorThief couldn't extract color:", e);
        }
    };

    const showPoster = posterUrl => {
        posterImgElem.style.visibility = '';
        // Use a stable URL for ColorThief's anonymous CORS request, separate from the card image.
        if (/^(?:https?:)?\/\//i.test(posterUrl) || posterUrl.startsWith('/.netlify/')) {
            const fragmentIndex = posterUrl.indexOf('#');
            const requestUrl = fragmentIndex === -1 ? posterUrl : posterUrl.slice(0, fragmentIndex);
            if (!/\?(?:[^#]*&)?cors=1(?:&|$)/.test(requestUrl)) {
                const separator = requestUrl.includes('?') ? '&' : '?';
                const fragment = posterUrl.slice(requestUrl.length);
                posterUrl = `${requestUrl}${separator}cors=1${fragment}`;
            }
        }
        posterImgElem.src = posterUrl;
    };

    const showBackdrop = (backdropPath, posterUrl) => {
        const backdropUrl = getSafeTmdbImageUrl(backdropPath, BACKDROP_BASE, posterUrl);
        const background = `url("${backdropUrl}")`;
        if (backdropEl) backdropEl.style.backgroundImage = background;
        if (ambilightEl) ambilightEl.style.backgroundImage = background;
    };

    let posterUrl = getSafeTmdbImageUrl(initialPosterPath, IMAGE_BASE, '/assets/placeholder.svg');
    showPoster(posterUrl);
    showBackdrop(initialBackdropPath, posterUrl);

    const initialImdbIdRaw = item.external_ids?.imdb_id || item.imdb_id;
    const initialImdbId = isValidImdbId(initialImdbIdRaw) ? initialImdbIdRaw : null;
    const inlineImdbRating = normalizeImdbRating(item.imdb_rating);
    const ratingSpan = metaContainer ? document.createElement('span') : null;

    const renderImdbBadge = (imdbId, displayRatingText, state = 'ready') => {
        if (!ratingSpan) return null;
        const link = buildImdbRatingElement(imdbId, displayRatingText, state);
        ratingSpan.replaceChildren(link);
        ratingSpan.hidden = false;
        ratingSpan.style.display = '';
        syncDetailsMetaSeparators(metaContainer);
        return link;
    };

    const rememberImdbRating = (imdbId, rating) => {
        renderImdbBadge(imdbId, rating);
        try {
            localStorage.setItem('imdb_' + imdbId, rating);
        } catch {
            // The badge remains usable when storage is unavailable.
        }
        if (typeof syncImdbRatingToProfileStorage === 'function') {
            syncImdbRatingToProfileStorage(movieId, item.media_type, imdbId, rating);
        }
    };

    const resolveImdbFallback = async imdbId => {
        const loadingBadge = renderImdbBadge(imdbId, '…', 'loading');
        if (!loadingBadge) return;

        let imdbRating = null;
        try {
            const response = await fetch(`/.netlify/functions/omdb?i=${imdbId}`, {
                signal: routeContext?.signal
            });
            if (response.ok) {
                const omdbData = await response.json();
                if (omdbData?.Response !== 'False') {
                    imdbRating = normalizeImdbRating(omdbData?.imdbRating);
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') return;
        }

        if (!isRouteContextCurrent(routeContext, 'movie', movieId) ||
            ratingSpan.firstElementChild !== loadingBadge) return;

        if (imdbRating) {
            rememberImdbRating(imdbId, imdbRating);
        } else {
            renderImdbBadge(imdbId, '—', 'empty');
        }
    };

    const resolveImdbRating = (imdbId, directRating) => {
        window.currentImdbId = imdbId;
        if (directRating) {
            rememberImdbRating(imdbId, directRating);
            return;
        }

        let cachedRating = null;
        try {
            cachedRating = normalizeImdbRating(localStorage.getItem('imdb_' + imdbId));
        } catch {
            // The fallback can still resolve the rating.
        }

        if (cachedRating) {
            renderImdbBadge(imdbId, cachedRating);
        } else {
            void resolveImdbFallback(imdbId);
        }
    };

    const genresContainer = metaContainer ? document.createElement('div') : null;
    const renderGenres = media => {
        let renderedCount = 0;
        const genres = Array.isArray(media.genres) && media.genres.length
            ? media.genres
            : Array.isArray(media.genre_ids) ? media.genre_ids : [];

        for (const genre of genres) {
            const genreId = normalizeTmdbId(genre?.id ?? genre);
            if (!genreId) continue;
            const genreName = String(genreMap[genreId] || genre?.name || '').trim();
            if (!genreName) continue;

            if (renderedCount > 0) {
                const separator = document.createElement('span');
                separator.style.cssText = 'color:var(--text-muted);font-size:0.7rem;margin:0 5px;';
                separator.textContent = '•';
                genresContainer.appendChild(separator);
            }

            const badge = document.createElement('span');
            badge.className = 'genre-badge';
            badge.title = 'Bu türde ara';
            badge.textContent = genreName;
            badge.addEventListener('click', () => searchByGenre(genreId));
            genresContainer.appendChild(badge);
            renderedCount++;
        }

        genresContainer.hidden = renderedCount === 0;
        genresContainer.style.display = renderedCount ? '' : 'none';
        syncDetailsMetaSeparators(metaContainer);
        return renderedCount;
    };

    let initialGenreCount = 0;
    if (metaContainer) {
        ratingSpan.id = 'rating-span';
        ratingSpan.hidden = true;
        ratingSpan.style.display = 'none';

        const mainSeparator = document.createElement('span');
        mainSeparator.dataset.metaSep = '1';
        mainSeparator.textContent = '|';

        genresContainer.style.maxWidth = '250px';
        metaContainer.replaceChildren(ratingSpan, mainSeparator, genresContainer);
        initialGenreCount = renderGenres(item);
    }
    if (initialImdbId) resolveImdbRating(initialImdbId, inlineImdbRating);

    const dateBadge = document.getElementById('details-date-badge');
    const renderDateBadge = date => {
        if (!dateBadge) return;
        const parsed = new Date(date || '');
        const formatted = Number.isNaN(parsed.getTime()) ? '' :
            parsed.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
        if (dateBadge.textContent !== formatted) dateBadge.textContent = formatted;
        dateBadge.style.display = formatted ? 'block' : 'none';
    };
    const initialReleaseDate = item.release_date || item.first_air_date;
    renderDateBadge(initialReleaseDate);

    const isUpcoming = releaseDate => Boolean(releaseDate && new Date(releaseDate) > new Date());
    const initiallyUpcoming = isUpcoming(item.release_date);
    renderDetailsModalActions(modal, item, initiallyUpcoming);

    const provContainer =
    document.getElementById(
        'modal-providers'
    );

    if (provContainer) {
        provContainer.style.cssText =
            'margin-top:15px;' +
            'display:flex;' +
            'gap:10px;' +
            'align-items:center;' +
            'justify-content:center;' +
            'flex-wrap:wrap;';

        provContainer.textContent =
            'Platformlar aranıyor...';
    }

    // Modal Provider Fetch (WITH DEEP LINKS)
    fetch(`${BASE_URL}/${item.media_type}/${item.id}/watch/providers`, { signal: routeContext?.signal })
        .then(res => res.json())
        .then(data => {
            if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
            const tr =
                data.results &&
                data.results.TR
                    ? data.results.TR
                    : null;

            const provContainer =
                document.getElementById(
                    'modal-providers'
                );

            if (!provContainer) {
                return;
            }

            const flatrateList = tr && Array.isArray(tr.flatrate) ? tr.flatrate : [];
            const freeList = [
                ...(tr && Array.isArray(tr.free) ? tr.free : []),
                ...(tr && Array.isArray(tr.ads) ? tr.ads : [])
            ];
            const transactionalList = [
                ...(tr && Array.isArray(tr.rent) ? tr.rent : []),
                ...(tr && Array.isArray(tr.buy) ? tr.buy : [])
            ];

            let activeProviders = [];
            let labelText = 'İzlenebilir:';

            if (flatrateList.length > 0) {
                activeProviders = flatrateList;
                labelText = 'İzlenebilir:';
            } else if (freeList.length > 0) {
                activeProviders = freeList;
                labelText = 'Ücretsiz:';
            } else if (transactionalList.length > 0) {
                const seenIds = new Set();
                activeProviders = transactionalList.filter(p => {
                    const pid = p?.provider_id || p?.provider_name;
                    if (!pid || seenIds.has(pid)) return false;
                    seenIds.add(pid);
                    return true;
                });
                labelText = 'Kiralık / Satın Al:';
            }

            if (activeProviders.length > 0) {
                const watchLink =
                    getSafeHttpUrl(
                        tr.link,
                        '#'
                    );

                const hasWatchLink =
                    watchLink !== '#';

                const label =
                    document.createElement(
                        'span'
                    );

                label.style.cssText =
                    'color:var(--text-muted);' +
                    'font-size:0.95rem;' +
                    'font-weight:bold;';

                label.textContent =
                    labelText;

                const fragment =
                    document.createDocumentFragment();

                fragment.append(
                    label,
                    document.createTextNode(' ')
                );

                activeProviders.forEach(provider => {
                    const providerName =
                        String(
                            provider?.provider_name ||
                            'Platform'
                        );

                    const logoUrl =
                        getSafeTmdbImageUrl(
                            provider?.logo_path,
                            IMAGE_BASE,
                            '/assets/placeholder.svg'
                        );

                    const wrapper =
                        document.createElement(
                            hasWatchLink
                                ? 'a'
                                : 'span'
                        );

                    if (hasWatchLink) {
                        wrapper.href =
                            watchLink;

                        wrapper.target =
                            '_blank';

                        wrapper.rel =
                            'noopener noreferrer';

                        wrapper.title =
                            `${providerName} Üzerinde İzle`;
                    } else {
                        wrapper.title =
                            providerName;
                    }

                    const logo =
                        document.createElement(
                            'img'
                        );

                    logo.src =
                        logoUrl;

                    logo.alt =
                        providerName;

                    logo.loading =
                        'lazy';

                    logo.style.cssText =
                        'width:35px;' +
                        'height:35px;' +
                        'border-radius:8px;' +
                        'box-shadow:0 2px 5px rgba(0,0,0,0.5);' +
                        `cursor:${hasWatchLink ? 'pointer' : 'default'};`;

                    wrapper.appendChild(
                        logo
                    );

                    fragment.appendChild(
                        wrapper
                    );
                });

                provContainer.replaceChildren(
                    fragment
                );
            } else {
                provContainer.innerHTML =
                    "<span style='color:var(--text-muted); font-size:0.9rem;'>Türkiye'de dijital yayını bulunamadı</span>";
            }
        }).catch(err => {
            if (err.name === 'AbortError' || !isRouteContextCurrent(routeContext, 'movie', movieId)) return;
            const provContainer = document.getElementById('modal-providers');
            if(provContainer) provContainer.innerHTML = "<span style='color:var(--text-muted); font-size:0.9rem;'>Platform bilgisi alınamadı</span>";
        });

    // Add to recently viewed
    let recent = [];

    try {
        const parsedRecent =
            JSON.parse(
                localStorage.getItem(
                    'recentlyViewed'
                ) ||
                '[]'
            );

        if (
            Array.isArray(
                parsedRecent
            )
        ) {
            recent = parsedRecent;
        }
    } catch (error) {
        console.warn(
            'Recently viewed okunamadı:',
            error
        );
    }

    recent =
        recent.filter(
            entry =>
                !(
                    normalizeTmdbId(
                        entry?.id
                    ) === item.id &&
                    inferItemMediaType(
                        entry,
                        item.media_type
                    ) === item.media_type
                )
        );

    recent.unshift(item);

    if (recent.length > 10) {
        recent.pop();
    }

    localStorage.setItem(
        'recentlyViewed',
        JSON.stringify(recent)
    );
    renderRecentlyViewed(routeContext);

    const castContainer = document.getElementById('details-cast');
    const recContainer = document.getElementById('details-recommendations');
    const videoBgContainer = document.getElementById('video-bg-container');

    castContainer.innerHTML = "<div style='color:#ccc'>Oyuncular yükleniyor...</div>";
    if (recContainer) recContainer.innerHTML = "<div style='color:#ccc'>Öneriler yükleniyor...</div>";

    fullDataPromise
        .then(async fullData => {
            if (!fullData || typeof fullData !== 'object') return;
            if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
            const fullTitle = fullData.title || fullData.name;
            if (fullTitle && detailsTitle.textContent !== fullTitle) {
                detailsTitle.textContent = fullTitle;
                posterImgElem.alt = fullTitle;
            }

            const posterChanged = isValidTmdbImagePath(fullData.poster_path) &&
                fullData.poster_path !== initialPosterPath;
            if (posterChanged) {
                posterUrl = getSafeTmdbImageUrl(fullData.poster_path, IMAGE_BASE, posterUrl);
                showPoster(posterUrl);
            }
            if ((fullData.backdrop_path && fullData.backdrop_path !== initialBackdropPath) ||
                (!initialBackdropPath && posterChanged)) {
                showBackdrop(fullData.backdrop_path || initialBackdropPath, posterUrl);
            }

            const fullReleaseDate = fullData.release_date || fullData.first_air_date;
            if (fullReleaseDate && fullReleaseDate !== initialReleaseDate) {
                renderDateBadge(fullReleaseDate);
            }
            const updatedUpcoming = isUpcoming(fullData.release_date || item.release_date);
            if (updatedUpcoming !== initiallyUpcoming) {
                clearDetailsModalActions(modal);
                renderDetailsModalActions(modal, item, updatedUpcoming);
            }

            if (genresContainer && initialGenreCount === 0) renderGenres(fullData);

            if (item.media_type === 'movie' &&
                typeof fullData.release_date === 'string' &&
                fullData.release_date >= new Date().toLocaleDateString('sv-SE')) {
                const title = fullData.title || item.title || 'Film';
                const calendarUrl = buildGoogleCalendarUrl(title, fullData.release_date, fullData.overview || item.overview || '');
                if (calendarUrl) {
                    provContainer?.insertAdjacentHTML('beforebegin', `
                        <a class="action-btn btn-calendar-modal" href="${escapeAttr(calendarUrl)}"
                            target="_blank" rel="noopener noreferrer"
                            aria-label="${escapeAttr(title)} için Google Takvime ekle">
                            <i class="fas fa-calendar-plus" aria-hidden="true"></i> Takvime Ekle
                        </a>
                    `);
                }
            }
            if (fullData.overview && fullData.overview !== overview.textContent) {
                overview.textContent = fullData.overview;
                const storedRecent = safeReadStorage('recentlyViewed', []);
                const recentEntry = storedRecent.find(entry =>
                    normalizeTmdbId(entry?.id) === item.id &&
                    inferItemMediaType(entry, item.media_type) === item.media_type
                );
                if (recentEntry) {
                    recentEntry.overview = fullData.overview;
                    safeWriteStorage('recentlyViewed', storedRecent);
                }
            }

            const runtimeCandidates = [
                fullData.runtime,
                Array.isArray(
                    fullData.episode_run_time
                )
                    ? fullData.episode_run_time[0]
                    : null,
                fullData.last_episode_to_air
                    ?.runtime
            ];

            const runtime =
                runtimeCandidates.find(
                    value =>
                        typeof value === 'number' &&
                        Number.isFinite(value) &&
                        value > 0
                ) ?? null;

            const episodeCount =
                typeof fullData.number_of_episodes ===
                    'number' &&
                Number.isSafeInteger(
                    fullData.number_of_episodes
                ) &&
                fullData.number_of_episodes > 0
                    ? fullData.number_of_episodes
                    : null;

            if (runtime !== null) {
                if (
                    metaContainer &&
                    !metaContainer.querySelector(
                        '#runtime-span'
                    )
                ) {
                    const separator =
                        document.createElement(
                            'span'
                        );

                    separator.dataset.metaSep = '1';
                    separator.textContent =
                        '|';

                    const runtimeSpan =
                        document.createElement(
                            'span'
                        );

                    runtimeSpan.id =
                        'runtime-span';

                    let runtimeText =
                        `${runtime} dk`;

                    if (
                        item.media_type === 'tv' &&
                        episodeCount !== null
                    ) {
                        const totalMins =
                            runtime *
                            episodeCount;

                        const hours =
                            Math.floor(
                                totalMins / 60
                            );

                        const mins =
                            totalMins % 60;

                        runtimeText +=
                            ` / Bölüm (Toplam: ${hours}s ${mins}d)`;
                    }

                    runtimeSpan.textContent =
                        runtimeText;

                    metaContainer.append(separator, runtimeSpan);
                    syncDetailsMetaSeparators(metaContainer);
                }
            }

            const fullImdbIdRaw = fullData.external_ids?.imdb_id || fullData.imdb_id;
            const imdbId = isValidImdbId(fullImdbIdRaw) ? fullImdbIdRaw : initialImdbId;
            const directRating = normalizeImdbRating(fullData.imdb_rating);
            if (imdbId && (imdbId !== initialImdbId || (directRating && directRating !== inlineImdbRating))) {
                resolveImdbRating(imdbId, directRating);
            }

            // Video Background (Only PC)
            const backgroundVideos =
                Array.isArray(
                    fullData.videos?.results
                )
                    ? fullData.videos.results
                    : [];

            if (
                window.innerWidth > 768 &&
                videoBgContainer &&
                backgroundVideos.length > 0
            ) {
                let video =
                    backgroundVideos.find(
                        candidate =>
                            candidate?.site ===
                                'YouTube' &&
                            candidate?.type ===
                                'Trailer' &&
                            isValidYouTubeVideoId(
                                candidate?.key
                            )
                    );

                if (!video) {
                    video =
                        backgroundVideos.find(
                            candidate =>
                                candidate?.site ===
                                    'YouTube' &&
                                isValidYouTubeVideoId(
                                    candidate?.key
                                )
                        );
                }

                const validVideoId =
                    video &&
                    isValidYouTubeVideoId(
                        video.key
                    )
                        ? video.key
                        : null;

                if (validVideoId) {
                    const mounted =
                        mountYouTubeEmbed(
                            videoBgContainer,
                            validVideoId,
                            {
                                autoplay: '1',
                                mute: '1',
                                controls: '0',
                                loop: '1',
                                playlist:
                                    validVideoId,
                                modestbranding: '1',
                                showinfo: '0',
                                rel: '0',
                                iv_load_policy: '3',
                                enablejsapi: '1'
                            }
                        );

                    if (mounted) {
                        // Şirket interneti engellemesini
                        // (Hata 152 / Beyaz Ekran)
                        // tespit etmek için mevcut
                        // youtube-nocookie bağlantı testi.
                        fetch(
                            'https://www.youtube-nocookie.com/favicon.ico',
                            {
                                mode: 'no-cors',
                                signal:
                                    routeContext
                                        ?.signal
                            }
                        )
                            .then(() => {
                                if (
                                    !isRouteContextCurrent(
                                        routeContext,
                                        'movie',
                                        movieId
                                    )
                                ) {
                                    return;
                                }

                                // Mevcut 1 saniyelik reveal.
                                setTimeout(
                                    () => {
                                        if (
                                            !isRouteContextCurrent(
                                                routeContext,
                                                'movie',
                                                movieId
                                            )
                                        ) {
                                            return;
                                        }

                                        videoBgContainer
                                            .style
                                            .opacity =
                                            '1';

                                        if (backdropEl) {
                                            backdropEl
                                                .style
                                                .display =
                                                'none';
                                        }
                                    },
                                    1000
                                );
                            })
                            .catch(error => {
                                if (
                                    error.name ===
                                    'AbortError'
                                ) {
                                    return;
                                }

                                // Bağlantı reddedilirse video
                                // görünmez; mevcut backdrop kalır.
                                console.warn(
                                    'YouTube bağlantısı engellendi, video arka planı iptal edildi.'
                                );
                            });
                    }
                }
            }

            if (
                Array.isArray(
                    fullData.credits?.crew
                )
            ) {
                const director =
                    fullData.credits.crew.find(
                        crewMember =>
                            crewMember.job ===
                            'Director'
                    );

                const directorId =
                    normalizeTmdbId(
                        director?.id
                    );

                if (
                    director &&
                    directorId
                ) {
                    const directorName =
                        String(
                            director.name ||
                            'Bilinmiyor'
                        );

                    const directorBadge =
                        document.createElement(
                            'div'
                        );

                    directorBadge.id =
                        'director-badge-container';

                    directorBadge.style.cssText =
                        'margin-top:10px;' +
                        'margin-bottom:10px;' +
                        'display:inline-block;' +
                        'background:rgba(0,0,0,0.6);' +
                        'padding:5px 12px;' +
                        'border-radius:15px;' +
                        'border:1px solid rgba(255,255,255,0.1);' +
                        'box-shadow:0 2px 4px rgba(0,0,0,0.3);' +
                        'backdrop-filter:blur(5px);' +
                        'transition:all 0.5s ease;';

                    const directorLink =
                        document.createElement(
                            'span'
                        );

                    directorLink.id =
                        'directorLink';

                    directorLink.style.cssText =
                        'cursor:pointer;' +
                        'color:#fff;' +
                        'font-weight:bold;' +
                        'font-size:0.95rem;' +
                        'text-shadow:0 2px 4px rgba(0,0,0,0.8);';

                    directorLink.title =
                        `${directorName} filmleri`;

                    const directorIcon =
                        document.createElement(
                            'i'
                        );

                    directorIcon.className =
                        'fas fa-bullhorn';

                    directorIcon.style.cssText =
                        'color:var(--accent-color);' +
                        'margin-right:5px;';

                    directorLink.setAttribute('role', 'button');
                    directorLink.setAttribute('tabindex', '0');
                    directorLink.setAttribute('aria-label', `Yönetmen: ${directorName}`);

                    directorLink.append(
                        directorIcon,
                        document.createTextNode(
                            ` Yönetmen: ${directorName}`
                        )
                    );

                    const activateDirector = () => {
                        openActorDetails(
                            directorId
                        );
                    };

                    directorLink.addEventListener(
                        'click',
                        activateDirector
                    );

                    directorLink.addEventListener(
                        'keydown',
                        (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                activateDirector();
                            }
                        }
                    );

                    directorBadge.appendChild(
                        directorLink
                    );

                    if (metaContainer) {
                        metaContainer.appendChild(directorBadge);
                        syncDetailsMetaSeparators(metaContainer);
                    }

                    const directorBackdrop =
                        getSafeTmdbImageUrl(
                            fullData.backdrop_path || initialBackdropPath,
                            IMAGE_BASE,
                            null
                        );

                    if (directorBackdrop) {
                        const img =
                            new Image();

                        img.crossOrigin =
                            'Anonymous';

                        img.onload = () => {
                            if (
                                !isRouteContextCurrent(
                                    routeContext,
                                    'movie',
                                    movieId
                                )
                            ) {
                                return;
                            }

                            try {
                                const colorThief =
                                    new ColorThief();

                                const color =
                                    colorThief.getColor(
                                        img
                                    );

                                const rgb =
                                    `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`;

                                const dirBadge =
                                    document.getElementById(
                                        'director-badge-container'
                                    );

                                if (dirBadge) {
                                    dirBadge.style.background =
                                        rgb;

                                    dirBadge.style.boxShadow =
                                        `0 4px 15px rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.5)`;

                                    dirBadge.style.border =
                                        `1px solid rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`;
                                }
                            } catch (error) {
                                // Tema rengi opsiyonel.
                            }
                        };

                        img.src =
                            directorBackdrop;
                    }
                }
            }
            
            // Başrol Oyuncuları
            if (
                Array.isArray(
                    fullData.credits?.cast
                )
            ) {
                const cast =
                    fullData.credits.cast
                        .slice(0, 10);

                const fragment =
                    document.createDocumentFragment();

                let renderedCastCount = 0;

                cast.forEach(actor => {
                    const actorId =
                        normalizeTmdbId(
                            actor?.id
                        );

                    if (!actorId) {
                        return;
                    }

                    const actorName =
                        String(
                            actor.name ||
                            'Bilinmiyor'
                        );

                    const actorImg =
                        getSafeTmdbImageUrl(
                            actor.profile_path,
                            IMAGE_BASE,
                            '/assets/placeholder.svg'
                        );

                    const card =
                        document.createElement(
                            'div'
                        );

                    card.className =
                        'actor-card';

                    card.style.cursor =
                        'pointer';

                    const image =
                        document.createElement(
                            'img'
                        );

                    image.src =
                        actorImg;

                    image.alt =
                        actorName;

                    image.loading =
                        'lazy';

                    const name =
                        document.createElement(
                            'div'
                        );

                    name.className =
                        'actor-name';

                    name.title =
                        actorName;

                    name.textContent =
                        actorName;

                    const tooltip =
                        document.createElement(
                            'div'
                        );

                    tooltip.className =
                        'actor-tooltip';

                    tooltip.textContent =
                        'Yükleniyor...';

                    card.setAttribute('role', 'button');
                    card.setAttribute('tabindex', '0');
                    card.setAttribute('aria-label', `${actorName} detaylarını görüntüle`);

                    card.append(
                        image,
                        name,
                        tooltip
                    );

                    const activateCastActor = () => {
                        openActorDetails(
                            actorId
                        );
                    };

                    card.addEventListener(
                        'click',
                        activateCastActor
                    );

                    card.addEventListener(
                        'keydown',
                        (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                activateCastActor();
                            }
                        }
                    );

                    card.addEventListener(
                        'mouseenter',
                        () => {
                            showActorTooltip(
                                card,
                                actorId
                            );
                        }
                    );

                    card.addEventListener(
                        'mouseleave',
                        () => {
                            hideActorTooltip(
                                card
                            );
                        }
                    );

                    fragment.appendChild(card);
                    renderedCastCount++;
                });

                if (renderedCastCount > 0) {
                    castContainer.replaceChildren(
                        fragment
                    );
                } else {
                    castContainer.innerHTML =
                        "<div style='color:#ccc'>Oyuncu bilgisi bulunamadı.</div>";
                }
            }

           // Recommendations
            if (
                Array.isArray(
                    fullData.recommendations
                        ?.results
                ) &&
                recContainer
            ) {
                const recs =
                    fullData.recommendations
                        .results
                        .slice(0, 10);

                const fragment =
                    document.createDocumentFragment();

                let renderedRecCount = 0;

                recs.forEach(rec => {
                    const recId =
                        normalizeTmdbId(
                            rec?.id
                        );

                    const recMediaType =
                        normalizeMediaType(
                            rec?.media_type,
                            item.media_type
                        );

                    if (
                        !recId ||
                        !recMediaType
                    ) {
                        return;
                    }

                    const recTitle =
                        String(
                            rec.title ||
                            rec.name ||
                            'Bilinmiyor'
                        );

                    const recImage =
                        getSafeTmdbImageUrl(
                            rec.poster_path,
                            IMAGE_BASE,
                            '/assets/placeholder.svg'
                        );

                    const recItem = {
                        id: recId,
                        title: recTitle,
                        name: recTitle,
                        overview:
                            rec.overview,
                        poster_path:
                            rec.poster_path,
                        backdrop_path:
                            rec.backdrop_path,
                        release_date:
                            rec.release_date,
                        first_air_date:
                            rec.first_air_date,
                        vote_average:
                            rec.vote_average,
                        genre_ids:
                            Array.isArray(
                                rec.genre_ids
                            )
                                ? rec.genre_ids
                                : [],
                        media_type:
                            recMediaType
                    };

                    if (typeof setCachedMedia === 'function') {
                        setCachedMedia(recItem, recMediaType);
                    } else {
                        window.movieCache[recId] = recItem;
                    }

                    const card =
                        document.createElement(
                            'div'
                        );

                    card.className =
                        'recommendation-card';

                    const image =
                        document.createElement(
                            'img'
                        );

                    image.src =
                        recImage;

                    image.alt =
                        recTitle;

                    image.loading =
                        'lazy';

                    const title =
                        document.createElement(
                            'div'
                        );

                    title.className =
                        'recommendation-title';

                    title.title =
                        recTitle;

                    title.textContent =
                        recTitle;

                    card.setAttribute('role', 'button');
                    card.setAttribute('tabindex', '0');
                    card.setAttribute('aria-label', `${recTitle} detaylarını görüntüle`);

                    card.append(
                        image,
                        title
                    );

                    const activateRec = () => {
                        openDetails(
                            recId,
                            recMediaType
                        );
                    };

                    card.addEventListener(
                        'click',
                        activateRec
                    );

                    card.addEventListener(
                        'keydown',
                        (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                activateRec();
                            }
                        }
                    );

                    fragment.appendChild(card);
                    renderedRecCount++;
                });

                if (renderedRecCount > 0) {
                    recContainer.replaceChildren(
                        fragment
                    );

                    makeScrollable(
                        recContainer
                    );
                } else {
                    recContainer.innerHTML =
                        "<div style='color:#ccc'>Öneri bulunamadı.</div>";
                }
            }

            // TV Show Seasons
            if (
                item.media_type === 'tv' &&
                Array.isArray(
                    fullData.seasons
                ) &&
                fullData.seasons.length > 0
            ) {
                const validSeasons = [];

                fullData.seasons.forEach(
                    season => {
                        const seasonNumber =
                            typeof season
                                ?.season_number ===
                                'number' &&
                            Number.isSafeInteger(
                                season.season_number
                            ) &&
                            season.season_number > 0
                                ? season.season_number
                                : null;

                        if (
                            seasonNumber === null
                        ) {
                            return;
                        }

                        const episodeCount =
                            typeof season
                                .episode_count ===
                                'number' &&
                            Number.isSafeInteger(
                                season.episode_count
                            ) &&
                            season.episode_count >= 0
                                ? season.episode_count
                                : null;

                        validSeasons.push({
                            seasonNumber,
                            name: String(
                                season.name ||
                                `Sezon ${seasonNumber}`
                            ),
                            episodeCount
                        });
                    }
                );
                if (validSeasons.length > 0) {
                    const episodeRuntimes = Array.isArray(fullData.episode_run_time)
                        ? fullData.episode_run_time.filter(minutes => Number.isFinite(minutes) && minutes > 0)
                        : [];
                    const avgEpisodeRuntime = episodeRuntimes.length
                        ? normalizePositiveMinutes(episodeRuntimes.reduce((sum, minutes) => sum + minutes, 0) / episodeRuntimes.length)
                        : normalizePositiveMinutes(fullData.last_episode_to_air?.runtime);
                    const tvProgressMeta = {
                        id: item.id,
                        name: fullData.name || fullData.title || item.name || item.title || 'Bilinmiyor',
                        poster_path: isValidTmdbImagePath(fullData.poster_path) ? fullData.poster_path
                            : (isValidTmdbImagePath(item.poster_path) ? item.poster_path : null),
                        first_air_date: fullData.first_air_date || item.first_air_date || '',
                        vote_average: typeof fullData.vote_average === 'number' ? fullData.vote_average : item.vote_average,
                        genre_ids: Array.isArray(fullData.genres) ? fullData.genres.map(g => g?.id).filter(Boolean)
                            : (Array.isArray(item.genre_ids) ? item.genre_ids : []),
                        totalSeasons: validSeasons.length,
                        avgEpisodeRuntime,
                        totalEpisodes: typeof fullData.number_of_episodes === 'number' && fullData.number_of_episodes > 0
                            ? fullData.number_of_episodes
                            : validSeasons.reduce((total, season) => total + (season.episodeCount || 0), 0)
                    };

                    const guide = document.createElement('div');
                    guide.id = 'tv-guide-container';
                    guide.className = 'collection-section';

                    const heading = document.createElement('h3');
                    heading.className = 'cast-title';
                    heading.textContent = 'Dizi Sezon Rehberi';

                    const overallProgress = document.createElement('div');
                    overallProgress.id = 'tv-overall-progress';
                    overallProgress.className = 'tv-overall-progress';

                    const selectWrapper = document.createElement('div');
                    selectWrapper.className = 'season-select-wrapper';

                    const select = document.createElement('select');
                    select.className = 'season-select';
                    select.setAttribute('aria-label', 'Sezon seçin');

                    for (const season of validSeasons) {
                        const option = document.createElement('option');
                        option.value = String(season.seasonNumber);
                        option.dataset.seasonNumber = option.value;
                        option.dataset.episodeCount = season.episodeCount ?? '';
                        option.dataset.baseLabel = season.episodeCount === null
                            ? season.name : `${season.name} (${season.episodeCount} Bölüm)`;
                        option.textContent = option.dataset.baseLabel;
                        select.appendChild(option);
                    }
                    selectWrapper.appendChild(select);

                    const seasonProgress = document.createElement('div');
                    seasonProgress.id = 'season-progress-bar';
                    seasonProgress.className = 'season-progress-bar';
                    seasonProgress.hidden = true;

                    const episodesContainer = document.createElement('div');
                    episodesContainer.id = 'episodes-container';
                    episodesContainer.className = 'episode-list';

                    guide.append(heading, overallProgress, selectWrapper, seasonProgress, episodesContainer);
                    castContainer.previousElementSibling?.before(guide);

                    const lastSeason = getTvShowProgress(item.id)?.lastSeason;
                    const initialSeason = validSeasons.find(season => season.seasonNumber === lastSeason) || validSeasons[0];
                    select.value = String(initialSeason.seasonNumber);
                    select.addEventListener('change', () => {
                        loadSeasonEpisodes(item.id, select.value, routeContext, tvProgressMeta);
                    });
                    loadSeasonEpisodes(item.id, initialSeason.seasonNumber, routeContext, tvProgressMeta);
                }
            }

            // Collections
            if (
                item.media_type === 'movie' &&
                fullData.belongs_to_collection
            ) {
                const collectionId =
                    normalizeTmdbId(
                        fullData
                            .belongs_to_collection
                            .id
                    );

                if (collectionId) {
                    const colData =
                        await fetchCollectionDetail(
                            collectionId,
                            routeContext?.signal
                        );

                    if (
                        !isRouteContextCurrent(
                            routeContext,
                            'movie',
                            movieId
                        )
                    ) {
                        return;
                    }

                    if (
                        colData &&
                        Array.isArray(
                            colData.parts
                        ) &&
                        colData.parts.length > 0
                    ) {
                        colData.parts.sort(
                            (a, b) =>
                                new Date(
                                    a.release_date
                                ) -
                                new Date(
                                    b.release_date
                                )
                        );

                        const rawCollectionName =
                            String(
                                colData.name ||
                                ''
                            );

                        const cleanCollectionName =
                            rawCollectionName
                                .replace(
                                    /\[Seri\]/gi,
                                    ''
                                )
                                .replace(
                                    /Serisi/gi,
                                    ''
                                )
                                .replace(
                                    /Collection/gi,
                                    ''
                                )
                                .trim();

                        const collectionTitle =
                            `${
                                cleanCollectionName ||
                                'Film'
                            } Serisi`;

                        const section =
                            document.createElement(
                                'div'
                            );

                        section.id =
                            'collection-container';

                        section.className =
                            'collection-section';

                        const heading =
                            document.createElement(
                                'h3'
                            );

                        heading.className =
                            'cast-title';

                        heading.textContent =
                            collectionTitle;

                        const list =
                            document.createElement(
                                'div'
                            );

                        list.className =
                            'collection-list';

                        let renderedParts = 0;

                        colData.parts.forEach(
                            part => {
                                const partId =
                                    normalizeTmdbId(
                                        part?.id
                                    );

                                if (!partId) {
                                    return;
                                }

                                const partTitle =
                                    String(
                                        part.title ||
                                        'Bilinmiyor'
                                    );

                                const partImage =
                                    getSafeTmdbImageUrl(
                                        part.poster_path,
                                        IMAGE_BASE,
                                        '/assets/placeholder.svg'
                                    );

                                const partItem = {
                                    id: partId,
                                    title:
                                        partTitle,
                                    name:
                                        partTitle,
                                    overview:
                                        part.overview,
                                    poster_path:
                                        part.poster_path,
                                    backdrop_path:
                                        part.backdrop_path,
                                    release_date:
                                        part.release_date,
                                    vote_average:
                                        part.vote_average,
                                    genre_ids:
                                        Array.isArray(
                                            part.genre_ids
                                        )
                                            ? part.genre_ids
                                            : [],
                                    media_type:
                                        'movie'
                                };

                                if (typeof setCachedMedia === 'function') {
                                    setCachedMedia(partItem, 'movie');
                                } else {
                                    window.movieCache[partId] = partItem;
                                }

                                const card =
                                    document
                                        .createElement(
                                            'div'
                                        );

                                card.className =
                                    'recommendation-card';

                                const image =
                                    document
                                        .createElement(
                                            'img'
                                        );

                                image.src =
                                    partImage;

                                image.alt =
                                    partTitle;

                                image.loading =
                                    'lazy';

                                if (
                                    partId ===
                                    item.id
                                ) {
                                    image.style.cssText =
                                        'outline:3px solid var(--primary-color);' +
                                        'outline-offset:-3px;' +
                                        'border-radius:10px;';
                                }

                                const title =
                                    document
                                        .createElement(
                                            'div'
                                        );

                                title.className =
                                    'recommendation-title';

                                title.title =
                                    partTitle;

                                title.textContent =
                                    partTitle;

                                card.setAttribute('role', 'button');
                                card.setAttribute('tabindex', '0');
                                card.setAttribute('aria-label', `${partTitle} detaylarını görüntüle`);

                                card.append(
                                    image,
                                    title
                                );

                                const activatePart = () => {
                                    openDetails(
                                        partId,
                                        'movie'
                                    );
                                };

                                card.addEventListener(
                                    'click',
                                    activatePart
                                );

                                card.addEventListener(
                                    'keydown',
                                    (e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            activatePart();
                                        }
                                    }
                                );

                                list.appendChild(
                                    card
                                );

                                renderedParts++;
                            }
                        );

                        if (renderedParts > 0) {
                            section.append(
                                heading,
                                list
                            );

                            const recHeading =
                                recContainer
                                    ?.previousElementSibling;

                            if (
                                recHeading &&
                                recHeading.parentNode
                            ) {
                                recHeading.parentNode
                                    .insertBefore(
                                        section,
                                        recHeading
                                    );
                            }
                        }
                    }
                }
            }
        }).catch(err => {
            if (err.name === 'AbortError' || !isRouteContextCurrent(routeContext, 'movie', movieId)) return;
            console.error("Full fetch error", err);
            castContainer.innerHTML = "<div style='color:red'>Veriler çekilemedi.</div>";
        });
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error(error);
    }
}

function renderDetailsModalActions(modal, item, isUpcoming) {
    const actions = modal?.querySelector('.details-left');
    if (!actions) return;

    let watchlist = [];

    try {
        const parsedWatchlist =
            JSON.parse(
                localStorage.getItem(
                    'watchlist'
                ) ||
                '[]'
            );

        if (
            Array.isArray(
                parsedWatchlist
            )
        ) {
            watchlist =
                parsedWatchlist;
        }
    } catch (error) {
        console.warn(
            'Watchlist okunamadı:',
            error
        );
    }

    const safeActionMediaType =
        normalizeMediaType(
            item.media_type
        ) || 'movie';

    const isInWatchlist =
        watchlist.some(
            entry =>
                normalizeTmdbId(
                    entry?.id
                ) === item.id &&
                inferItemMediaType(
                    entry,
                    safeActionMediaType
                ) === safeActionMediaType
        );

    const wlText =
        isInWatchlist
            ? 'Listeden Çıkar'
            : 'Listeme Ekle';

    const wlClass =
        isInWatchlist
            ? 'active'
            : 'inactive';

    const wlAriaLabel = isInWatchlist ? 'Listeden çıkar' : 'Listeme ekle';
    const wlAriaPressed = isInWatchlist ? 'true' : 'false';

    const wlBtnHtml =
        `<button id="modal-wl-btn" data-media-id="${item.id}" data-media-type="${safeActionMediaType}" onclick="toggleWatchlist(this, ${item.id}, '${safeActionMediaType}')" class="btn-watchlist ${wlClass}" aria-label="${wlAriaLabel}" aria-pressed="${wlAriaPressed}"><i class="fas fa-heart" aria-hidden="true"></i> ${wlText}</button>`;

    let rateBtnHtml = '';

    if (!isUpcoming) {
        let savedRatings = {};

        try {
            const parsedRatings =
                JSON.parse(
                    localStorage.getItem(
                        'movieRatings'
                    ) ||
                    '{}'
                );

            if (
                parsedRatings &&
                typeof parsedRatings ===
                    'object' &&
                !Array.isArray(
                    parsedRatings
                )
            ) {
                savedRatings =
                    parsedRatings;
            }
        } catch (error) {
            console.warn(
                'Movie ratings okunamadı:',
                error
            );
        }

        const myRating =
            typeof getUserRatingForMedia === 'function'
                ? getUserRatingForMedia(
                      savedRatings,
                      item.id,
                      safeActionMediaType
                  )
                : normalizeUserRating(
                      savedRatings[item.id]
                  );

        const hasRating =
            myRating !== null;

        const rateText =
            hasRating
                ? `Puanım: ${myRating}/10`
                : 'İzledim / Puan Ver';

        const rateClass =
            hasRating
                ? 'active'
                : 'inactive';

        rateBtnHtml = `
            <div style="position:relative; width:100%; margin-top: 10px;">
                <button
                    onclick="toggleRateMenu(${item.id})"
                    class="btn-watchlist ${rateClass}"
                    style="width:100%;"
                >
                    <i class="fas fa-star"></i>
                    <span id="rate-text-${item.id}">
                        ${rateText}
                    </span>
                </button>

                <div
                    id="rate-menu-${item.id}"
                    style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--card-bg); border-radius:10px; padding:10px; box-shadow:0 10px 20px rgba(0,0,0,0.5); z-index:10; border:1px solid var(--glass-border); flex-wrap:wrap; justify-content:center; gap:5px; margin-top:5px;"
                >
                    ${
                        [1,2,3,4,5,6,7,8,9,10]
                            .map(
                                n =>
                                    `<button onclick="saveRating(${item.id}, ${n}, '${safeActionMediaType}')" style="width:28px; height:28px; border-radius:5px; background:var(--primary-color); color:white; border:none; cursor:pointer;">${n}</button>`
                            )
                            .join('')
                    }

                    <button
                        onclick="removeRating(${item.id}, '${safeActionMediaType}')"
                        style="width:100%; margin-top:5px; padding:5px; border-radius:5px; background:rgba(229,9,20,0.8); color:white; border:none; cursor:pointer;"
                    >
                        Puanı Sil
                    </button>
                </div>
            </div>
        `;
    }

    const trailerBtnHtml =
        `<button onclick="openTrailer(${item.id}, '${safeActionMediaType}')" class="btn-watchlist inactive" style="margin-top: 10px;"><i class="fas fa-play"></i> Fragmanı İzle</button>`;

    const shareBtnHtml =
        `<button onclick="shareMovie(${item.id}, '${safeActionMediaType}')" class="btn-watchlist inactive" style="margin-top: 10px; background:rgba(255,255,255,0.05);"><i class="fas fa-share-alt"></i> Paylaş</button>`;

    
    const combinedHtml = wlBtnHtml + rateBtnHtml + trailerBtnHtml + shareBtnHtml;
    const providers = actions.querySelector('#modal-providers');
    if (providers) {
        providers.insertAdjacentHTML('beforebegin', combinedHtml);
    } else {
        actions.insertAdjacentHTML('beforeend', combinedHtml);
    }
}

function searchByGenre(genreId) {
    const safeGenreId =
        normalizeTmdbId(
            genreId
        );

    if (!safeGenreId) {
        return;
    }

    const params =
        new URLSearchParams();

    params.set(
        'genres',
        String(safeGenreId)
    );

    navigate(
        `platform?${params.toString()}`
    );
}

async function openTrailer(
    id,
    mediaType
) {
    if (movieTrailerRequest) {
        if (movieTrailerRequest.controller) {
            movieTrailerRequest.controller.abort();
        }
        movieTrailerRequest = null;
    }

    const safeId =
        normalizeTmdbId(id);

    if (!safeId) {
        return;
    }

    const cachedItemForTrailer =
        typeof getCachedMedia === 'function'
            ? getCachedMedia(safeId, mediaType)
            : window.movieCache?.[safeId];

    const safeMediaType =
        normalizeMediaType(
            mediaType,
            normalizeMediaType(
                cachedItemForTrailer?.media_type
            )
        );

    if (!safeMediaType) {
        return;
    }

    const modal =
        document.getElementById(
            'trailer-modal'
        );

    const container =
        document.getElementById(
            'video-container'
        );

    if (
        !modal ||
        !container
    ) {
        return;
    }

    container.innerHTML =
        "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Fragman Aranıyor...</div>";

    const trailerTrigger = document.activeElement;
    if (window.ModalManager) {
        window.ModalManager.openModal(modal, trailerTrigger);
    } else {
        modal.classList.add('active');
        modal.removeAttribute('aria-hidden');
    }

    const bgIframe =
        document.querySelector(
            '#video-bg-container iframe'
        );

    if (
        bgIframe &&
        bgIframe.contentWindow
    ) {
        bgIframe.contentWindow
            .postMessage(
                '{"event":"command","func":"pauseVideo","args":""}',
                '*'
            );
    }

    const requestToken = {
        id: safeId,
        mediaType: safeMediaType,
        controller:
            typeof AbortController === 'function'
                ? new AbortController()
                : null
    };
    movieTrailerRequest = requestToken;

    const isTrailerRequestCurrent = () =>
        movieTrailerRequest === requestToken &&
        modal.classList.contains('active') &&
        (!window.ModalManager ||
            typeof window.ModalManager.isModalOpen !== 'function' ||
            window.ModalManager.isModalOpen(modal));

    try {
        const findBestYouTubeVideo = videoList => {
            if (!Array.isArray(videoList) || videoList.length === 0) {
                return null;
            }
            return (
                videoList.find(
                    video =>
                        video?.site === 'YouTube' &&
                        video?.type === 'Trailer' &&
                        isValidYouTubeVideoId(video?.key)
                ) ||
                videoList.find(
                    video =>
                        video?.site === 'YouTube' &&
                        isValidYouTubeVideoId(video?.key)
                ) ||
                null
            );
        };

        const cachedExtended =
            getCachedExtendedMediaDetail(safeMediaType, safeId) ||
            (typeof getCachedMedia === 'function'
                ? getCachedMedia(safeId, safeMediaType)
                : window.movieCache?.[safeId]);

        let trailer = findBestYouTubeVideo(cachedExtended?.videos?.results);

        if (!trailer) {
            const fetchOptions = requestToken.controller
                ? { signal: requestToken.controller.signal }
                : undefined;

            const res =
                await fetch(
                    `${BASE_URL}/${safeMediaType}/${safeId}/videos`,
                    fetchOptions
                );

            if (!isTrailerRequestCurrent()) {
                return;
            }

            if (!res.ok) {
                container.innerHTML =
                    "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Bu yapım için fragman bulunamadı 😔</div>";
                return;
            }

            const data =
                await res.json();

            if (!isTrailerRequestCurrent()) {
                return;
            }

            trailer = findBestYouTubeVideo(data?.results);
        }

        if (!isTrailerRequestCurrent()) {
            return;
        }

        if (trailer) {
            mountYouTubeEmbed(
                container,
                trailer.key,
                {
                    autoplay: '1',
                    rel: '0'
                }
            );
        } else {
            container.innerHTML =
                "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Bu yapım için fragman bulunamadı 😔</div>";
        }
    } catch (error) {
        if (
            (error && error.name === 'AbortError') ||
            requestToken.controller?.signal?.aborted ||
            !isTrailerRequestCurrent()
        ) {
            return;
        }
        container.innerHTML =
            "<div style='color:red;text-align:center;padding-top:20%;'>Fragman yüklenirken hata oluştu!</div>";
    } finally {
        if (movieTrailerRequest === requestToken) {
            movieTrailerRequest = null;
        }
    }
}

function togglePiP(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const modal =
        document.getElementById(
            'trailer-modal'
        );

    if (
        !modal ||
        !modal.classList.contains(
            'active'
        )
    ) {
        return;
    }

    const enteringPip =
        !modal.classList.contains(
            'pip-mode'
        );

    modal.classList.toggle(
        'pip-mode',
        enteringPip
    );

    const pipBtn =
        event?.currentTarget ||
        modal.querySelector(
            '.pip-btn'
        );

    if (pipBtn) {
        pipBtn.setAttribute(
            'aria-pressed',
            enteringPip
                ? 'true'
                : 'false'
        );

        const label =
            enteringPip
                ? 'Normal oynatıcıya dön'
                : 'Yüzen Oynatıcı (PiP)';

        pipBtn.setAttribute(
            'aria-label',
            label
        );

        pipBtn.title =
            label;
    }

    if (!window.ModalManager) {
        return;
    }

    const stack =
        window.ModalManager.stack || [];

    const trailerIndex =
        stack.findIndex(
            entry =>
                entry.element === modal
        );

    const previousEntry =
        trailerIndex > 0
            ? stack[
                trailerIndex - 1
            ]
            : null;

    if (previousEntry?.element) {
        previousEntry.element.inert =
            !enteringPip;

        previousEntry.element
            .classList.toggle(
                'modal-underlay',
                !enteringPip
            );

        if (enteringPip) {
            previousEntry.element
                .removeAttribute(
                    'aria-hidden'
                );
        } else {
            previousEntry.element
                .setAttribute(
                    'aria-hidden',
                    'true'
                );
        }

        return;
    }

    const backgroundElements = [
        document.getElementById(
            'main-content'
        ),
        document.querySelector(
            '.navbar'
        ),
        document.querySelector(
            '.site-footer'
        ),
        document.getElementById(
            'advanced-search-panel'
        )
    ];

    backgroundElements.forEach(
        element => {
            if (element) {
                element.inert =
                    !enteringPip;
            }
        }
    );
}

function closeTrailer(event, force = false) {
    const modal = document.getElementById('trailer-modal');
    if (!modal) return;

    const isBackdropClick = Boolean(event && event.target === modal);
    if (force || isBackdropClick) {
        if (movieTrailerRequest) {
            if (movieTrailerRequest.controller) {
                movieTrailerRequest.controller.abort();
            }
            movieTrailerRequest = null;
        }

        modal.classList.remove(
            'pip-mode'
        );

        const pipBtn =
            modal.querySelector(
                '.pip-btn'
            );

        if (pipBtn) {
            pipBtn.setAttribute(
                'aria-pressed',
                'false'
            );

            pipBtn.setAttribute(
                'aria-label',
                'Yüzen Oynatıcı (PiP)'
            );

            pipBtn.title =
                'Yüzen Oynatıcı (PiP)';
        }
        const container = document.getElementById('video-container');
        if (window.ModalManager) {
            window.ModalManager.closeModal(modal);
        } else {
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
        }
        if (container) container.innerHTML = "";
        
        const bgIframe = document.querySelector('#video-bg-container iframe');
        if (bgIframe && bgIframe.contentWindow) {
            bgIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        }
    }
}

window.isNavigatingBack = false;

function closeDetails(event, force = false) {
    const modal = document.getElementById('details-modal');
    if (!modal) return;

    const isBackdropClick = Boolean(event && event.target === modal);
    if (force || isBackdropClick) {
        if (window.isNavigatingBack) return;

        const currentPath = (window.location?.pathname || '/').replace(/\/+$/, '') || '/';
        if (currentPath.startsWith('/film/') || currentPath.startsWith('/dizi/') || currentPath.startsWith('/movie/')) {
            const state = history.state;
            if (state && state.filmRehberiRouter && state.filmRehberiRouter.index > 0) {
                window.isNavigatingBack = true;

                const navigatingFromUrl = typeof getCurrentAppUrl === 'function'
                    ? getCurrentAppUrl()
                    : currentPath;

                history.back();

                setTimeout(() => {
                    const activeUrl = typeof getCurrentAppUrl === 'function'
                        ? getCurrentAppUrl()
                        : ((window.location?.pathname || '/').replace(/\/+$/, '') || '/');
                    if (activeUrl === navigatingFromUrl) {
                        window.isNavigatingBack = false;
                    }
                }, 300);
            } else {
                navigate('platform', { replace: true });
            }
        } else if (window.ModalManager && window.ModalManager.isModalOpen(modal)) {
            window.ModalManager.closeModal(modal);
            const trailerModal = document.getElementById('trailer-modal');
            const onlyPipTrailerOpen = Boolean(
                window.ModalManager.stack?.length === 1 &&
                trailerModal &&
                trailerModal.classList.contains('active') &&
                trailerModal.classList.contains('pip-mode') &&
                window.ModalManager.isModalOpen(trailerModal)
            );
            if (!window.ModalManager.hasActiveModal() || onlyPipTrailerOpen) {
                document.body.style.overflow = "auto";
            }
        } else {
            modal.style.display = 'none';
            modal.classList.remove('active');
            modal.setAttribute('aria-hidden', 'true');
            if (!window.ModalManager || !window.ModalManager.hasActiveModal()) {
                document.body.style.overflow = "auto";
            }
        }
    }
}

// =========================================
// V5: PREMIUM FONKSİYONLAR (Tooltip, TV)
// =========================================

function syncTvGuideSeasonOptions(tvId, select) {
    for (const option of select.options) {
        const { baseLabel, seasonNumber, episodeCount } = option.dataset;
        const watchedCount = getWatchedEpisodesForSeason(tvId, seasonNumber).size;
        const total = normalizeTmdbId(episodeCount);
        let suffix = '';
        if (watchedCount) {
            suffix = total
                ? (watchedCount >= total ? ' • ✓' : ` • ${watchedCount}/${total}`)
                : ` • ${watchedCount} izlendi`;
        }
        option.textContent = baseLabel + suffix;
    }
}

function syncTvGuideOverallProgress(container, tvId, showMeta) {
    const progress = getTvShowProgress(tvId);
    if (!progress) {
        container.textContent = 'İzlediğiniz bölümleri işaretleyerek kaldığınız yeri kaydedebilirsiniz.';
        return;
    }

    const summary = formatTvProgressSummary({
        ...progress,
        totalEpisodes: showMeta?.totalEpisodes || progress.totalEpisodes
    });
    const position = document.createElement('strong');
    position.textContent = `Kaldığın Yer: ${summary.positionLabel}`;
    const count = document.createElement('span');
    count.textContent = summary.countLabel;
    container.replaceChildren(position, count);
    if (summary.totalEpisodes) {
        container.appendChild(createTvProgressBar(
            summary.watchedCount, summary.totalEpisodes, `İzleme ilerlemesi %${summary.percent}`
        ));
    }
}

function createTvEpisodeCard(episode, episodeNumber, tvId, seasonNumber, imdbId) {
    const episodeName = String(episode.name || 'Bilinmiyor');
    const targetUrl = getSafeHttpUrl(imdbId
        ? `https://www.imdb.com/title/${imdbId}/episodes?season=${seasonNumber}`
        : `https://www.themoviedb.org/tv/${tvId}/season/${seasonNumber}/episode/${episodeNumber}`);

    const card = document.createElement('article');
    card.className = 'episode-card';
    card.dataset.episodeNumber = String(episodeNumber);

    const titleLink = document.createElement('a');
    titleLink.className = 'episode-ext-link';
    titleLink.href = targetUrl;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleLink.textContent = `${episodeNumber}. ${episodeName}`;

    const stillLink = titleLink.cloneNode(false);
    stillLink.className = 'episode-still-link';
    stillLink.setAttribute('aria-label', `${seasonNumber}. sezon ${episodeNumber}. bölüm: ${episodeName} (${imdbId ? 'IMDb' : 'TMDB'})`);

    const image = document.createElement('img');
    image.src = getSafeTmdbImageUrl(episode.still_path, IMAGE_BASE, '/assets/placeholder.svg');
    image.alt = '';
    image.loading = 'lazy';
    stillLink.appendChild(image);

    const info = document.createElement('div');
    info.className = 'episode-info';
    const heading = document.createElement('h4');
    heading.appendChild(titleLink);
    if (imdbId) {
        const icon = document.createElement('i');
        icon.className = 'fab fa-imdb episode-imdb-icon';
        icon.setAttribute('aria-hidden', 'true');
        heading.appendChild(icon);
    }

    const airDate = new Date(episode.air_date ?? NaN);
    const dateText = document.createElement('p');
    dateText.className = 'episode-date-line';
    dateText.textContent = `Yayın: ${Number.isFinite(airDate.getTime()) ? airDate.toLocaleDateString('tr-TR') : 'Bilinmiyor'}`;

    const overview = document.createElement('p');
    overview.textContent = typeof episode.overview === 'string' && episode.overview.trim()
        ? episode.overview : 'Bu bölüm için henüz özet bulunmuyor.';

    const actions = document.createElement('div');
    actions.className = 'episode-actions';
    const watchButton = document.createElement('button');
    watchButton.type = 'button';
    watchButton.className = 'episode-watch-btn';
    watchButton.setAttribute('aria-label', `${episodeNumber}. bölüm izleme durumu`);

    const markUpToButton = document.createElement('button');
    markUpToButton.type = 'button';
    markUpToButton.className = 'episode-mark-upto-btn';
    markUpToButton.textContent = `1–${episodeNumber}. Bölümleri İşaretle`;
    actions.append(watchButton, markUpToButton);
    info.append(heading, dateText, overview, actions);
    card.append(stillLink, info);
    return { card, watchButton, markUpToButton };
}

async function loadSeasonEpisodes(tvId, seasonNumber, routeContext = null, showMeta = null) {
    const safeTvId = normalizeTmdbId(tvId);
    const safeSeasonNumber = normalizeTmdbId(seasonNumber);
    const guide = document.getElementById('tv-guide-container');
    if (!safeTvId || !safeSeasonNumber || !guide) return;

    const container = guide.querySelector('#episodes-container');
    const overallProgress = guide.querySelector('#tv-overall-progress');
    const seasonProgress = guide.querySelector('#season-progress-bar');
    const select = guide.querySelector('.season-select');
    routeContext = routeContext || { generation: routeGeneration, signal: currentAbortController?.signal };
    if (!isRouteContextCurrent(routeContext, 'movie', safeTvId)) return;

    // The loading node also distinguishes requests made within the same route.
    const loading = document.createElement('div');
    loading.className = 'loading';
    loading.textContent = 'Bölümler yükleniyor...';
    container.replaceChildren(loading);
    seasonProgress.hidden = true;
    syncTvGuideOverallProgress(overallProgress, safeTvId, showMeta);
    syncTvGuideSeasonOptions(safeTvId, select);

    const isCurrentRequest = () => guide.isConnected && container.firstElementChild === loading &&
        isRouteContextCurrent(routeContext, 'movie', safeTvId);

    try {
        const response = await fetch(
            `${BASE_URL}/tv/${safeTvId}/season/${safeSeasonNumber}?language=tr-TR`,
            { signal: routeContext.signal }
        );
        if (!response.ok) throw new Error('Bölümler yüklenemedi.');
        const data = await response.json();
        if (!isCurrentRequest()) return;

        const episodes = new Map();
        for (const episode of Array.isArray(data?.episodes) ? data.episodes : []) {
            const number = episode?.episode_number;
            if (Number.isSafeInteger(number) && number > 0 && !episodes.has(number)) {
                episodes.set(number, episode);
            }
        }
        if (!episodes.size) {
            container.textContent = 'Bu sezon için bölüm bulunamadı.';
            return;
        }

        const episodeNumbers = [...episodes.keys()].sort((a, b) => a - b);
        const seasonEpisodeRuntimes = {};
        for (const [number, episode] of episodes) {
            const minutes = normalizePositiveMinutes(episode.runtime);
            if (minutes) seasonEpisodeRuntimes[formatEpisodeKey(safeSeasonNumber, number)] = minutes;
        }
        const runtimeValues = Object.values(seasonEpisodeRuntimes);
        const seasonAvgRuntime = runtimeValues.length
            ? normalizePositiveMinutes(runtimeValues.reduce((sum, minutes) => sum + minutes, 0) / runtimeValues.length)
            : null;
        const progressShowMeta = {
            ...showMeta,
            avgEpisodeRuntime: normalizePositiveMinutes(showMeta?.avgEpisodeRuntime) || seasonAvgRuntime,
            episodeRuntimes: { ...showMeta?.episodeRuntimes, ...seasonEpisodeRuntimes }
        };
        const imdbId = isValidImdbId(window.currentImdbId) ? window.currentImdbId : null;
        const label = document.createElement('strong');
        const progress = createTvProgressBar(0, episodeNumbers.length, `Sezon ${safeSeasonNumber} izleme ilerlemesi`);
        const toggleAll = document.createElement('button');
        toggleAll.type = 'button';
        toggleAll.className = 'season-toggle-all-btn';

        const progressInfo = document.createElement('div');
        progressInfo.className = 'season-progress-info';
        progressInfo.append(label, progress);
        seasonProgress.replaceChildren(progressInfo, toggleAll);

        const fragment = document.createDocumentFragment();
        const controls = new Map();
        const syncProgress = () => {
            const watched = getWatchedEpisodesForSeason(safeTvId, safeSeasonNumber);
            let firstUnwatched = 1;
            while (watched.has(firstUnwatched)) firstUnwatched++;

            let watchedCount = 0;
            for (const [number, { card, watchButton, markUpToButton }] of controls) {
                const isWatched = watched.has(number);
                if (isWatched) watchedCount++;
                card.classList.toggle('episode-watched', isWatched);
                watchButton.classList.toggle('watched', isWatched);
                watchButton.setAttribute('aria-pressed', String(isWatched));
                watchButton.setAttribute('aria-label', `${safeSeasonNumber}. Sezon ${number}. Bölümü ${isWatched ? 'izlendi işaretini kaldır' : 'izlendi olarak işaretle'}`);
                const watchIcon = document.createElement('i');
                watchIcon.className = isWatched ? 'fas fa-check-circle' : 'far fa-check-circle';
                watchIcon.setAttribute('aria-hidden', 'true');
                watchButton.replaceChildren(watchIcon, isWatched ? ' İzlendi' : ' İzledim');
                const hideMarkUpTo = number <= 1 || number < firstUnwatched;
                if (hideMarkUpTo && document.activeElement === markUpToButton) watchButton.focus();
                markUpToButton.hidden = hideMarkUpTo;
            }

            const complete = watchedCount === episodeNumbers.length;
            label.textContent = `Sezon ${safeSeasonNumber}: ${watchedCount} / ${episodeNumbers.length} bölüm izlendi`;
            progress.value = watchedCount;
            toggleAll.setAttribute('aria-pressed', String(complete));
            toggleAll.textContent = complete ? 'Sezon İşaretlerini Kaldır' : 'Bu Sezonu Tamamla';
            syncTvGuideOverallProgress(overallProgress, safeTvId, showMeta);
            syncTvGuideSeasonOptions(safeTvId, select);
        };

        const updateProgress = (saved, getMessage) => {
            if (saved) syncProgress();
            if (typeof announceA11y === 'function') {
                announceA11y(saved ? getMessage() : 'İzleme ilerlemesi kaydedilemedi.');
            }
        };

        for (const number of episodeNumbers) {
            const episodeControls = createTvEpisodeCard(episodes.get(number), number, safeTvId, safeSeasonNumber, imdbId);
            const { card, watchButton, markUpToButton } = episodeControls;
            controls.set(number, episodeControls);

            watchButton.addEventListener('click', () => {
                updateProgress(toggleEpisodeWatched(safeTvId, safeSeasonNumber, number, progressShowMeta), () =>
                    watchButton.classList.contains('watched')
                        ? `${number}. bölüm izlendi olarak işaretlendi.`
                        : `${number}. bölümün izleme işareti kaldırıldı.`);
            });
            markUpToButton.addEventListener('click', () => {
                updateProgress(markEpisodesUpTo(safeTvId, safeSeasonNumber, number, episodeNumbers, progressShowMeta), () =>
                    `${number}. bölüme kadar olan bölümler izlendi olarak işaretlendi.`);
            });
            fragment.appendChild(card);
        }
        toggleAll.addEventListener('click', () => {
            updateProgress(toggleSeasonWatched(safeTvId, safeSeasonNumber, episodeNumbers, progressShowMeta), () =>
                toggleAll.getAttribute('aria-pressed') === 'true'
                    ? `Sezon ${safeSeasonNumber} tamamlandı.`
                    : `Sezon ${safeSeasonNumber} izleme işaretleri kaldırıldı.`);
        });

        syncProgress();
        container.replaceChildren(fragment);
        seasonProgress.hidden = false;
    } catch (error) {
        if (error.name !== 'AbortError' && isCurrentRequest()) {
            container.textContent = 'Bölümler yüklenemedi.';
        }
    }
}

function shareMovie(id, mediaType = null) {
    const safeId =
        normalizeTmdbId(id);

    if (!safeId) {
        return;
    }

    const cachedItem =
        typeof getCachedMedia === 'function'
            ? getCachedMedia(safeId, mediaType)
            : window.movieCache?.[safeId];

    const resolvedMediaType =
        normalizeMediaType(mediaType) ||
        normalizeMediaType(window.currentMediaType) ||
        normalizeMediaType(cachedItem?.media_type);

    const routePath = resolvedMediaType === 'tv'
        ? `/dizi/${safeId}`
        : `/film/${safeId}`;

    const url =
        `${window.location.origin}${routePath}`;

    if (navigator.share) {
        navigator.share({
            title: 'FilmimNerede',
            text: 'Bu yapıma mutlaka göz atmalısın!',
            url: url
        }).catch(err => {
            if (err && err.name === 'AbortError') return;
            console.warn('Paylaşım iptal edildi veya başarısız oldu:', err);
        });
    } else if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(url).then(() => {
            alert('Bağlantı kopyalandı: ' + url);
        }).catch(() => {
            prompt('Bağlantıyı kopyalayın:', url);
        });
    } else {
        prompt('Bağlantıyı kopyalayın:', url);
    }
}
