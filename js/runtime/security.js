function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderSafeError(
    target,
    userMessage = 'Hata oluştu.',
    error = null,
    className = 'loading'
) {
    const container =
        typeof target === 'string'
            ? document.getElementById(target)
            : target;

    if (error) {
        console.error(error);
    }

    if (!container) return;

    const message = document.createElement('div');
    message.className = className;
    message.style.color = 'red';
    message.textContent = String(userMessage);

    container.replaceChildren(message);
}

const TMDB_API_ORIGIN = 'https://api.themoviedb.org';
const TMDB_IMAGE_ORIGIN = 'https://image.tmdb.org';
const TMDB_PROXY_ENDPOINT = '/.netlify/functions/tmdb';
const TMDB_PROXY_SESSION_KEY = 'filmimnerede_tmdb_proxy_until';
const TMDB_PROXY_SESSION_TTL_MS = 10 * 60 * 1000;
const TMDB_PROXY_PROBE_TIMEOUT_MS = 3500;
const TMDB_PROXY_NEGATIVE_PROBE_TTL_MS = 30000;

const tmdbProxyState = {
    activeUntil: 0,
    imageActive: false,
    probeResult: null,
    probeResultAt: 0,
    probePromise: null,
    listenersInstalled: false
};

function isValidTmdbImagePath(value) {
    return (
        typeof value === 'string' &&
        /^\/[A-Za-z0-9._~-]+$/.test(value)
    );
}

function parseDirectTmdbApiUrl(rawUrl) {
    if (
        typeof rawUrl !== 'string' ||
        !rawUrl.startsWith(`${TMDB_API_ORIGIN}/3/`)
    ) {
        return null;
    }

    try {
        const parsed = new URL(rawUrl);
        if (
            parsed.origin === TMDB_API_ORIGIN &&
            parsed.pathname.startsWith('/3/')
        ) {
            return parsed;
        }
    } catch (_) {
        // Geçersiz TMDB API URL'i.
    }

    return null;
}

function parseDirectTmdbImageUrl(rawUrl) {
    if (
        typeof rawUrl !== 'string' ||
        !rawUrl.startsWith(`${TMDB_IMAGE_ORIGIN}/t/p/`)
    ) {
        return null;
    }

    try {
        const parsed = new URL(rawUrl);
        if (
            parsed.origin === TMDB_IMAGE_ORIGIN &&
            /^\/t\/p\/[A-Za-z0-9._~/-]+$/.test(parsed.pathname)
        ) {
            return parsed;
        }
    } catch (_) {
        // Geçersiz TMDB görsel URL'i.
    }

    return null;
}

function buildTmdbProxyUrl(target, rawUrl) {
    if (target === 'api') {
        const parsed = parseDirectTmdbApiUrl(rawUrl);
        if (!parsed) return null;
        const query = parsed.search.slice(1)
            .split('&')
            .filter(segment => segment.split('=', 1)[0] !== 'api_key')
            .join('&');
        return `${TMDB_PROXY_ENDPOINT}?target=api&path=${encodeURIComponent(
            `${parsed.pathname}${query ? `?${query}` : ''}`
        )}`;
    }

    if (target === 'image') {
        const parsed = parseDirectTmdbImageUrl(rawUrl);
        if (!parsed) return null;
        return `${TMDB_PROXY_ENDPOINT}?target=image&path=${encodeURIComponent(
            parsed.pathname
        )}`;
    }

    return null;
}

function getSafeTmdbImageUrl(path, baseUrl, fallbackUrl) {
    if (!isValidTmdbImagePath(path)) {
        return fallbackUrl;
    }

    const directUrl = `${baseUrl}${path}`;
    if (getTmdbFallbackState().imageActive) {
        const proxiedUrl = buildTmdbProxyUrl('image', directUrl);
        if (proxiedUrl) {
            return proxiedUrl;
        }
    }

    return directUrl;
}

function isValidImdbId(value) {
    return (
        typeof value === 'string' &&
        /^tt\d{7,10}$/.test(value)
    );
}

function isValidYouTubeVideoId(value) {
    return (
        typeof value === 'string' &&
        /^[A-Za-z0-9_-]{11}$/.test(value)
    );
}

function normalizeUserRating(value) {
    const numeric = Number(value);

    if (
        !Number.isFinite(numeric) ||
        numeric < 1 ||
        numeric > 10
    ) {
        return null;
    }

    return Math.round(numeric * 10) / 10;
}

function normalizeTmdbId(value) {
    let numeric = null;

    if (typeof value === 'number') {
        numeric = value;
    } else if (
        typeof value === 'string' &&
        /^\d+$/.test(value.trim())
    ) {
        numeric = Number(value.trim());
    }

    return (
        Number.isSafeInteger(numeric) &&
        numeric > 0
    )
        ? numeric
        : null;
}

function normalizeMediaType(value, fallback = null) {
    if (value === 'movie' || value === 'tv') {
        return value;
    }

    if (fallback === 'movie' || fallback === 'tv') {
        return fallback;
    }

    return null;
}

function inferItemMediaType(item, fallback = 'movie') {
    if (!item || typeof item !== 'object') {
        return normalizeMediaType(fallback, 'movie');
    }
    const explicit = normalizeMediaType(item.media_type);
    if (explicit) {
        return explicit;
    }
    if (item.first_air_date || (item.name && !item.title)) {
        return 'tv';
    }
    return normalizeMediaType(fallback, 'movie');
}

function getMediaKey(mediaTypeOrItem, maybeId = null) {
    if (mediaTypeOrItem && typeof mediaTypeOrItem === 'object') {
        const id = normalizeTmdbId(mediaTypeOrItem.id);
        if (!id) return null;
        const mType = inferItemMediaType(mediaTypeOrItem, 'movie');
        return `${mType}:${id}`;
    }
    if (typeof mediaTypeOrItem === 'string' && /^(movie|tv):\d+$/.test(mediaTypeOrItem.trim())) {
        const [rawType, rawId] = mediaTypeOrItem.trim().split(':');
        const id = normalizeTmdbId(rawId);
        return id ? `${rawType}:${id}` : null;
    }
    const id = normalizeTmdbId(maybeId !== null ? maybeId : mediaTypeOrItem);
    if (!id) return null;
    const mType = normalizeMediaType(mediaTypeOrItem, 'movie');
    return `${mType}:${id}`;
}

function parseMediaKey(value, fallbackType = 'movie') {
    if (typeof value === 'string' && /^(movie|tv):\d+$/.test(value.trim())) {
        const [rawType, rawId] = value.trim().split(':');
        const id = normalizeTmdbId(rawId);
        if (!id) return null;
        return { mediaType: rawType, id, key: `${rawType}:${id}` };
    }
    const id = normalizeTmdbId(value);
    if (!id) return null;
    const mediaType = normalizeMediaType(fallbackType, 'movie');
    return { mediaType, id, key: `${mediaType}:${id}` };
}

function getCachedMedia(id, mediaType = null) {
    const safeId = normalizeTmdbId(id);
    if (!safeId || !window.movieCache) return null;
    const explicitType = normalizeMediaType(mediaType);
    if (explicitType) {
        const composite = window.movieCache[`${explicitType}:${safeId}`];
        if (composite && typeof composite === 'object') {
            return composite;
        }
        const legacy = window.movieCache[safeId];
        if (legacy && typeof legacy === 'object') {
            const legacyType = inferItemMediaType(legacy, null);
            if (!legacyType || legacyType === explicitType) {
                return legacy;
            }
        }
        return null;
    }
    return (
        window.movieCache[safeId] ||
        window.movieCache[`movie:${safeId}`] ||
        window.movieCache[`tv:${safeId}`] ||
        null
    );
}

function setCachedMedia(item, explicitMediaType = null) {
    if (!item || typeof item !== 'object') return null;
    const safeId = normalizeTmdbId(item.id);
    if (!safeId) return null;
    const mediaType = normalizeMediaType(explicitMediaType) || inferItemMediaType(item, 'movie');
    item.id = safeId;
    item.media_type = mediaType;
    if (!window.movieCache) window.movieCache = {};
    window.movieCache[`${mediaType}:${safeId}`] = item;
    window.movieCache[safeId] = item;
    return item;
}

function safeReadStorage(key, fallback, validator = null) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined || raw === '') {
            return fallback;
        }
        const parsed = JSON.parse(raw);
        if (typeof validator === 'function') {
            return validator(parsed) ? parsed : fallback;
        }
        if (Array.isArray(fallback)) {
            return Array.isArray(parsed) ? parsed : fallback;
        }
        if (fallback && typeof fallback === 'object') {
            return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : fallback;
        }
        return parsed;
    } catch (error) {
        console.warn(`Storage okunamadı (${key}):`, error);
        return fallback;
    }
}

function safeWriteStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.warn(`Storage yazılamadı (${key}):`, error);
        return false;
    }
}

function getUserRatingForMedia(ratingsObj, id, mediaType = null) {
    if (!ratingsObj || typeof ratingsObj !== 'object') return null;
    const safeId = normalizeTmdbId(id);
    if (!safeId) return null;
    const safeType = normalizeMediaType(mediaType);
    if (safeType) {
        const compositeVal = normalizeUserRating(ratingsObj[`${safeType}:${safeId}`]);
        if (compositeVal !== null) return compositeVal;
        const hasOtherComposite = normalizeUserRating(ratingsObj[`${safeType === 'movie' ? 'tv' : 'movie'}:${safeId}`]) !== null;
        if (!hasOtherComposite) {
            return normalizeUserRating(ratingsObj[String(safeId)]);
        }
        return null;
    }
    return (
        normalizeUserRating(ratingsObj[String(safeId)]) ??
        normalizeUserRating(ratingsObj[`movie:${safeId}`]) ??
        normalizeUserRating(ratingsObj[`tv:${safeId}`]) ??
        null
    );
}

function getSafeHttpUrl(value, fallbackUrl = '#') {
    const parseHttpUrl = candidate => {
        if (
            typeof candidate !== 'string' ||
            !candidate.trim()
        ) {
            return null;
        }

        try {
            const url = new URL(
                candidate,
                window.location.origin
            );

            if (
                url.protocol === 'https:' ||
                url.protocol === 'http:'
            ) {
                return url.href;
            }
        } catch (e) {
            // Geçersiz URL
        }

        return null;
    };

    const safeValue =
        parseHttpUrl(value);

    if (safeValue) {
        return safeValue;
    }

    if (fallbackUrl === '#') {
        return '#';
    }

    return (
        parseHttpUrl(fallbackUrl) ||
        '#'
    );
}

function mountYouTubeEmbed(container, videoId, params = {}) {
    if (
        !container ||
        !isValidYouTubeVideoId(videoId)
    ) {
        return false;
    }

    const iframe = document.createElement('iframe');
    const query = new URLSearchParams(params);

    iframe.src =
        `https://www.youtube-nocookie.com/embed/${videoId}` +
        (query.toString() ? `?${query}` : '');

    iframe.title = 'YouTube Fragman Oynatıcı';
    iframe.allow = 'autoplay; encrypted-media';
    iframe.allowFullscreen = true;

    container.replaceChildren(iframe);

    return true;
}

function isTmdbFallbackBrowserEnv() {
    return (
        typeof window !== 'undefined' &&
        typeof window.fetch === 'function' &&
        typeof window.location === 'object' &&
        window.location !== null &&
        /^https?:$/.test(String(window.location.protocol || '')) &&
        typeof document !== 'undefined' &&
        typeof document.addEventListener === 'function'
    );
}

function restoreTmdbProxySession() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return false;
    }

    try {
        if (typeof sessionStorage === 'undefined' || typeof sessionStorage.getItem !== 'function') {
            return false;
        }
        const rawUntil = sessionStorage.getItem(TMDB_PROXY_SESSION_KEY);
        const until = Number(rawUntil);
        if (Number.isFinite(until) && until > Date.now()) {
            tmdbProxyState.activeUntil = until;
            tmdbProxyState.imageActive = true;
            tmdbProxyState.probeResult = true;
            return true;
        }
        if (rawUntil !== null && typeof sessionStorage.removeItem === 'function') {
            sessionStorage.removeItem(TMDB_PROXY_SESSION_KEY);
        }
    } catch (_) {
        // Depolama erişimi kısıtlıysa sessizce yoksay.
    }

    return false;
}

function rewriteFailedTmdbImages() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
        return 0;
    }

    let updatedCount = 0;
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        if (!img || (img.dataset && img.dataset.tmdbProxyRetried === 'done')) {
            return;
        }
        const rawSrc = img.getAttribute('src') || img.src || '';
        const proxiedUrl = buildTmdbProxyUrl('image', rawSrc);
        if (!proxiedUrl) {
            return;
        }
        if (rawSrc && img.complete && img.naturalWidth === 0) {
            if (img.dataset) {
                img.dataset.tmdbProxyRetried = 'done';
            }
            img.src = proxiedUrl;
            updatedCount += 1;
        }
    });

    return updatedCount;
}

function activateTmdbProxy() {
    tmdbProxyState.activeUntil = Date.now() + TMDB_PROXY_SESSION_TTL_MS;
    tmdbProxyState.imageActive = true;
    tmdbProxyState.probeResult = true;

    try {
        if (typeof sessionStorage !== 'undefined' && typeof sessionStorage.setItem === 'function') {
            sessionStorage.setItem(
                TMDB_PROXY_SESSION_KEY,
                String(tmdbProxyState.activeUntil)
            );
        }
    } catch (_) {
        // Depolama kotası veya gizli mod kısıtı sessizce yoksayılır.
    }

    rewriteFailedTmdbImages();
}

function resetTmdbProxyState() {
    tmdbProxyState.activeUntil = 0;
    tmdbProxyState.imageActive = false;
    tmdbProxyState.probeResult = null;
    tmdbProxyState.probeResultAt = 0;
    tmdbProxyState.probePromise = null;

    try {
        if (typeof sessionStorage !== 'undefined' && typeof sessionStorage.removeItem === 'function') {
            sessionStorage.removeItem(TMDB_PROXY_SESSION_KEY);
        }
    } catch (_) {}
}

function getTmdbFallbackState() {
    if (tmdbProxyState.imageActive && Date.now() >= tmdbProxyState.activeUntil) {
        resetTmdbProxyState();
    }
    return {
        imageActive: tmdbProxyState.imageActive,
        probeResult: tmdbProxyState.probeResult
    };
}

async function probeTmdbProxy(fetchImpl = null) {
    if (
        tmdbProxyState.probeResult === true ||
        (tmdbProxyState.probeResult === false &&
            Date.now() - tmdbProxyState.probeResultAt < TMDB_PROXY_NEGATIVE_PROBE_TTL_MS)
    ) {
        return tmdbProxyState.probeResult;
    }
    if (tmdbProxyState.probePromise) {
        return tmdbProxyState.probePromise;
    }

    const executor =
        typeof fetchImpl === 'function'
            ? fetchImpl
            : (typeof window !== 'undefined' && typeof window.__nativeTmdbFetch === 'function'
                ? window.__nativeTmdbFetch
                : (typeof fetch === 'function' ? fetch.bind(globalThis) : null));

    if (!executor) {
        tmdbProxyState.probeResult = false;
        tmdbProxyState.probeResultAt = Date.now();
        return false;
    }

    tmdbProxyState.probePromise = (async () => {
        const controller =
            typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId =
            controller && typeof setTimeout === 'function'
                ? setTimeout(() => controller.abort(), TMDB_PROXY_PROBE_TIMEOUT_MS)
                : null;

        try {
            const response = await executor(`${TMDB_PROXY_ENDPOINT}?probe=1`, {
                method: 'GET',
                cache: 'no-store',
                ...(controller ? { signal: controller.signal } : {})
            });

            if (!response || !response.ok) {
                tmdbProxyState.probeResult = false;
                return false;
            }

            const payload = await response.json().catch(() => null);
            const available = Boolean(payload && payload.ok === true);
            tmdbProxyState.probeResult = available;
            return available;
        } catch (_) {
            tmdbProxyState.probeResult = false;
            return false;
        } finally {
            tmdbProxyState.probeResultAt = Date.now();
            if (timeoutId !== null && typeof clearTimeout === 'function') {
                clearTimeout(timeoutId);
            }
            tmdbProxyState.probePromise = null;
        }
    })();

    return tmdbProxyState.probePromise;
}

function installTmdbSmartFallback() {
    if (!isTmdbFallbackBrowserEnv()) {
        return false;
    }

    restoreTmdbProxySession();

    if (!window.fetch.__tmdbSmartFallbackInstalled) {
        const nativeFetch = window.fetch.bind(window);
        window.__nativeTmdbFetch = nativeFetch;

        const tmdbSmartFetch = async function tmdbSmartFetch(input, init) {
            const rawUrl =
                typeof input === 'string'
                    ? input
                    : (typeof URL !== 'undefined' && input instanceof URL
                        ? input.href
                        : (input && typeof input.url === 'string' ? input.url : ''));

            const parsedTmdbUrl = parseDirectTmdbApiUrl(rawUrl);
            if (!parsedTmdbUrl) {
                return nativeFetch(input, init);
            }

            const buildProxyInit = () => {
                if (!input || typeof input === 'string') {
                    return init;
                }
                const merged = init ? { ...init } : {};
                if (!merged.method && input.method) merged.method = input.method;
                if (!merged.headers && input.headers) merged.headers = input.headers;
                if (!merged.signal && input.signal) merged.signal = input.signal;
                return merged;
            };

            const proxyUrl = buildTmdbProxyUrl('api', parsedTmdbUrl.href);
            return nativeFetch(proxyUrl, buildProxyInit());
        };

        tmdbSmartFetch.__tmdbSmartFallbackInstalled = true;
        window.fetch = tmdbSmartFetch;
    }

    if (!tmdbProxyState.listenersInstalled) {
        tmdbProxyState.listenersInstalled = true;

        document.addEventListener(
            'error',
            async event => {
                const target = event && event.target;
                if (!target || target.tagName !== 'IMG') {
                    return;
                }

                const currentSrc = target.getAttribute('src') || target.src || '';
                const proxiedUrl = buildTmdbProxyUrl('image', currentSrc);
                if (proxiedUrl) {
                    if (!getTmdbFallbackState().imageActive) {
                        if (
                            (typeof navigator !== 'undefined' && navigator.onLine === false) ||
                            !(await probeTmdbProxy())
                        ) {
                            return;
                        }
                        activateTmdbProxy();
                    }
                    if (target.dataset && target.dataset.tmdbProxyRetried === 'done') {
                        return;
                    }
                    if (target.dataset) {
                        target.dataset.tmdbProxyRetried = 'done';
                    }
                    target.src = proxiedUrl;
                    return;
                }

                if (
                    currentSrc.includes(`${TMDB_PROXY_ENDPOINT}?target=image`) &&
                    (!target.dataset || target.dataset.tmdbProxyFallbackApplied !== 'done')
                ) {
                    if (target.dataset) {
                        target.dataset.tmdbProxyFallbackApplied = 'done';
                    }
                    target.src = 'assets/placeholder.svg';
                }
            },
            true
        );

        if (typeof window.addEventListener === 'function') {
            window.addEventListener('online', () => {
                if (tmdbProxyState.probeResult === false) {
                    tmdbProxyState.probeResult = null;
                    tmdbProxyState.probeResultAt = 0;
                }
            });
        }

        if (tmdbProxyState.imageActive) {
            rewriteFailedTmdbImages();
        }
    }

    return true;
}

installTmdbSmartFallback();
