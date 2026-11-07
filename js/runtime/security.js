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

function isValidTmdbImagePath(value) {
    return (
        typeof value === 'string' &&
        /^\/[A-Za-z0-9._~-]+$/.test(value)
    );
}

function getSafeTmdbImageUrl(path, baseUrl, fallbackUrl) {
    return isValidTmdbImagePath(path)
        ? `${baseUrl}${path}`
        : fallbackUrl;
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
