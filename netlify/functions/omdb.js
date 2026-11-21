const {
    lookupImdbRating,
    _resetIndexCache,
    _setIndexPathForTests,
    _setIndexBufferForTests
} = require('./lib/imdb-ratings-index');

exports._resetIndexCache = _resetIndexCache;
exports._setIndexPathForTests = _setIndexPathForTests;
exports._setIndexBufferForTests = _setIndexBufferForTests;

const OMDB_BASE_URL =
    'https://www.omdbapi.com/';

const OMDB_TIMEOUT_MS =
    9000;

const IMDB_ID_PATTERN =
    /^tt\d{7,10}$/;

const RATINGS_CACHE_HEADERS = {
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    'Netlify-CDN-Cache-Control': 'public, s-maxage=604800, durable'
};

// İstek sınırı tek bir fonksiyon örneğinde geçerli olan en iyi çaba korumasıdır.
const MAX_RATE_LIMIT_CLIENTS = 5000;
const DEFAULT_RATE_LIMIT = {
    limit: 30,
    windowMs: 60_000,
    now: Date.now
};
const clientWindows = new Map();
let rateLimit = DEFAULT_RATE_LIMIT;

exports._resetRateLimit = function resetRateLimit(options) {
    clientWindows.clear();
    rateLimit = { ...DEFAULT_RATE_LIMIT, ...options };
};

function getClientKey(headers) {
    const normalizedHeaders = Object.fromEntries(
        Object.entries(headers ?? {}).map(([name, value]) => [
            name.toLowerCase(),
            value
        ])
    );

    return normalizedHeaders['x-nf-client-connection-ip']?.trim() ||
        normalizedHeaders['x-forwarded-for']?.split(',', 1)[0].trim() ||
        'unknown';
}

function recordRequest(clientKey) {
    const now = rateLimit.now();
    let window = clientWindows.get(clientKey);

    if (window && window.expiresAt <= now) {
        clientWindows.delete(clientKey);
        window = undefined;
    }

    if (!window) {
        if (clientWindows.size >= MAX_RATE_LIMIT_CLIENTS) {
            for (const [key, entry] of clientWindows) {
                if (entry.expiresAt <= now) {
                    clientWindows.delete(key);
                }
            }
            if (clientWindows.size >= MAX_RATE_LIMIT_CLIENTS) {
                // Map sırası pencerenin açılış sırasını korur.
                clientWindows.delete(clientWindows.keys().next().value);
            }
        }

        window = { count: 0, expiresAt: now + rateLimit.windowMs };
        clientWindows.set(clientKey, window);
    }

    if (window.count >= rateLimit.limit) {
        return Math.ceil((window.expiresAt - now) / 1000);
    }

    window.count += 1;
    return 0;
}

function jsonResponse(
    statusCode,
    payload,
    extraHeaders = {}
) {
    return {
        statusCode,
        headers: {
            'Content-Type':
                'application/json; charset=utf-8',
            ...extraHeaders
        },
        body:
            JSON.stringify(
                payload
            )
    };
}

exports.handler =
    async function handler(
        event = {}
    ) {
        const method =
            String(
                event.httpMethod ||
                ''
            ).toUpperCase();

        if (method !== 'GET') {
            return jsonResponse(
                405,
                {
                    error:
                        'Method Not Allowed'
                },
                {
                    Allow: 'GET'
                }
            );
        }

        const retryAfter = recordRequest(getClientKey(event.headers));
        if (retryAfter > 0) {
            return jsonResponse(
                429,
                { error: 'Çok fazla istek. Lütfen biraz sonra tekrar deneyin.' },
                { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' }
            );
        }

        const rawImdbId =
            event
                .queryStringParameters
                ?.i;

        const imdbId =
            typeof rawImdbId ===
                'string'
                ? rawImdbId.trim()
                : '';

        if (
            !IMDB_ID_PATTERN.test(
                imdbId
            )
        ) {
            return jsonResponse(
                400,
                {
                    error:
                        'Geçersiz IMDb ID.'
                }
            );
        }

        const localRating = lookupImdbRating(imdbId);
        if (localRating) {
            return jsonResponse(
                200,
                {
                    Response: 'True',
                    imdbID: imdbId,
                    imdbRating: localRating,
                    source: 'imdb-dataset'
                },
                RATINGS_CACHE_HEADERS
            );
        }

        const rawApiKey =
            process.env
                .OMDB_API_KEY;

        const apiKey =
            typeof rawApiKey ===
                'string'
                ? rawApiKey.trim()
                : '';

        if (!apiKey) {
            console.error(
                'OMDB_API_KEY tanımlı değil.'
            );

            return jsonResponse(
                500,
                {
                    error:
                        'OMDb servisi yapılandırılmamış.'
                }
            );
        }

        const params =
            new URLSearchParams();

        params.set(
            'apikey',
            apiKey
        );

        params.set(
            'i',
            imdbId
        );

        const upstreamUrl =
            new URL(
                OMDB_BASE_URL
            );

        upstreamUrl.search =
            params.toString();

        const controller =
            new AbortController();

        const timeoutId =
            setTimeout(
                () => {
                    controller.abort();
                },
                OMDB_TIMEOUT_MS
            );

        try {
            const response =
                await fetch(
                    upstreamUrl,
                    {
                        method:
                            'GET',
                        headers: {
                            Accept:
                                'application/json'
                        },
                        signal:
                            controller.signal
                    }
                );

            if (!response.ok) {
                console.error(
                    `OMDb upstream HTTP ${response.status}`
                );

                return jsonResponse(
                    502,
                    {
                        error:
                            'OMDb isteği başarısız oldu.'
                    }
                );
            }

            let data;

            try {
                data =
                    await response.json();
            } catch (error) {
                console.error(
                    'OMDb JSON parse hatası:',
                    error
                );

                return jsonResponse(
                    502,
                    {
                        error:
                            'OMDb isteği başarısız oldu.'
                    }
                );
            }

            // OMDb HTTP 200 +
            // Response:false application-level
            // response olarak aynen korunur; ancak
            // başarısız/kota yanıtları CDN/tarayıcıda önbelleklenmez.
            const cacheHeaders =
                data?.Response === 'True'
                    ? RATINGS_CACHE_HEADERS
                    : { 'Cache-Control': 'no-store' };

            return jsonResponse(
                200,
                data,
                cacheHeaders
            );
        } catch (error) {
            if (
                error?.name ===
                'AbortError'
            ) {
                console.error(
                    'OMDb upstream timeout.'
                );

                return jsonResponse(
                    504,
                    {
                        error:
                            'OMDb isteği zaman aşımına uğradı.'
                    }
                );
            }

            console.error(
                'OMDb upstream request failed:',
                error
            );

            return jsonResponse(
                502,
                {
                    error:
                        'OMDb isteği başarısız oldu.'
                }
            );
        } finally {
            clearTimeout(
                timeoutId
            );
        }
    };
