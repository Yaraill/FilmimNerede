const OMDB_BASE_URL =
    'https://www.omdbapi.com/';

const OMDB_TIMEOUT_MS =
    9000;

const IMDB_ID_PATTERN =
    /^tt\d{7,}$/;

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
            // response olarak aynen korunur.
            return jsonResponse(
                200,
                data
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