function toTmdbApiUrl(rawUrl) {
    try {
        const url = new URL(rawUrl, 'http://localhost');
        if (
            url.pathname === '/.netlify/functions/tmdb' &&
            url.searchParams.get('target') === 'api' &&
            url.searchParams.has('path')
        ) {
            // URLSearchParams decodes the outer proxy encoding once.
            return `https://api.themoviedb.org${url.searchParams.get('path')}`;
        }
    } catch (_) {
        // Leave non-URL input unchanged, like other non-proxy requests.
    }
    return rawUrl;
}

module.exports = { toTmdbApiUrl };
