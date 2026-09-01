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

    iframe.allow = 'autoplay; encrypted-media';
    iframe.allowFullscreen = true;

    container.replaceChildren(iframe);

    return true;
}