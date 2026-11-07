const providerDataCache = new Map();
const providerInflightRequests = new Map();

async function fetchAndInjectProviders(
    itemId,
    mediaType,
    itemData = null,
    routeContext = null
) {
    const safeItemId =
        normalizeTmdbId(
            itemId
        );

    if (!safeItemId) {
        return;
    }

    let safeMediaType =
        normalizeMediaType(
            mediaType
        );

    if (!safeMediaType) {
        safeMediaType =
            typeof inferItemMediaType === 'function'
                ? inferItemMediaType(itemData, 'movie')
                : (
                    itemData &&
                    (
                        itemData.first_air_date ||
                        (itemData.name && !itemData.title)
                    )
                        ? 'tv'
                        : 'movie'
                );
    }

    const cacheKey =
        `${safeMediaType}:${safeItemId}`;

    const getContainers = () => {
        const typed = document.querySelectorAll(
            `.providers-${safeMediaType}-${safeItemId}`
        );
        if (typed.length > 0) {
            return typed;
        }
        return document.querySelectorAll(
            `.providers-${safeItemId}:not([data-media-type]), .providers-${safeItemId}[data-media-type="${safeMediaType}"]`
        );
    };

    const renderStaticMessage =
        (
            containers,
            text
        ) => {
            containers.forEach(
                container => {
                    const message =
                        document
                            .createElement(
                                'span'
                            );

                    message.className =
                        'no-provider';

                    message.textContent =
                        text;

                    container
                        .replaceChildren(
                            message
                        );
                }
            );
        };

    const renderProviderLogos = (containers, providersList, badgeText = null) => {
        const visibleProviders = providersList.slice(0, 3);
        containers.forEach(container => {
            const fragment = document.createDocumentFragment();
            visibleProviders.forEach(provider => {
                const providerName = String(
                    provider?.provider_name || 'Platform'
                );
                const logoUrl = getSafeTmdbImageUrl(
                    provider?.logo_path,
                    IMAGE_BASE,
                    'assets/placeholder.svg'
                );
                const image = document.createElement('img');
                image.src = logoUrl;
                image.alt = badgeText
                    ? `${providerName} (${badgeText})`
                    : providerName;
                image.title = badgeText
                    ? `${providerName} (${badgeText})`
                    : providerName;
                image.loading = 'lazy';
                image.className = 'provider-logo';
                fragment.appendChild(image);
            });
            if (badgeText) {
                const badge = document.createElement('span');
                badge.className = 'no-provider provider-access-badge';
                badge.style.marginLeft = '6px';
                badge.style.fontSize = '0.72rem';
                badge.textContent = badgeText;
                fragment.appendChild(badge);
            }
            container.replaceChildren(fragment);
        });
    };

    try {
        let data;

        if (
            providerDataCache.has(
                cacheKey
            )
        ) {
            data =
                providerDataCache.get(
                    cacheKey
                );
        } else {
            let inflight = providerInflightRequests.get(cacheKey);
            if (!inflight) {
                inflight = fetch(
                    `${BASE_URL}/${safeMediaType}/${safeItemId}/watch/providers?api_key=${API_KEY}`,
                    {
                        signal: routeContext?.signal
                    }
                ).then(async res => {
                    if (!res.ok) {
                        throw new Error(`Watch providers HTTP ${res.status}`);
                    }
                    const json = await res.json();
                    if (json?.success === false) {
                        throw new Error('Watch providers API error');
                    }
                    providerDataCache.set(cacheKey, json);
                    return json;
                }).finally(() => {
                    providerInflightRequests.delete(cacheKey);
                });
                providerInflightRequests.set(cacheKey, inflight);
            }

            data = await inflight;

            if (
                routeContext &&
                !isRouteContextCurrent(
                    routeContext,
                    parseRoute().page
                )
            ) {
                return;
            }
        }

        if (
            routeContext &&
            !isRouteContextCurrent(
                routeContext,
                parseRoute().page
            )
        ) {
            return;
        }

        const results =
            data &&
            typeof data.results ===
                'object'
                ? data.results
                : null;

        const tr =
            results &&
            results.TR &&
            typeof results.TR ===
                'object'
                ? results.TR
                : null;

        const els =
            getContainers();

        if (els.length === 0) {
            return;
        }

        const rawFilterProvId =
            document.getElementById(
                'providerFilter'
            )?.value || '0';

        const filterProvId =
            rawFilterProvId === '0'
                ? 0
                : normalizeTmdbId(
                    rawFilterProvId
                );

        if (filterProvId === null) {
            return;
        }

        const flatRate =
            Array.isArray(tr?.flatrate)
                ? tr.flatrate
                : [];
        const freeProviders = [
            ...(Array.isArray(tr?.free) ? tr.free : []),
            ...(Array.isArray(tr?.ads) ? tr.ads : [])
        ];
        const rentBuyProviders = [];
        const seenRentBuy = new Set();
        [
            ...(Array.isArray(tr?.rent) ? tr.rent : []),
            ...(Array.isArray(tr?.buy) ? tr.buy : [])
        ].forEach(p => {
            const pid = normalizeTmdbId(p?.provider_id);
            if (pid && !seenRentBuy.has(pid)) {
                seenRentBuy.add(pid);
                rentBuyProviders.push(p);
            }
        });

        const matchesFilter = list =>
            filterProvId === 0 ||
            list.some(
                provider =>
                    normalizeTmdbId(provider?.provider_id) === filterProvId
            );

        if (flatRate.length > 0 && matchesFilter(flatRate)) {
            renderProviderLogos(els, flatRate, null);
            return;
        }

        if (freeProviders.length > 0 && matchesFilter(freeProviders)) {
            renderProviderLogos(els, freeProviders, 'Ücretsiz');
            return;
        }

        if (rentBuyProviders.length > 0 && matchesFilter(rentBuyProviders)) {
            renderProviderLogos(els, rentBuyProviders, 'Kiralık / Satın Al');
            return;
        }

        renderStaticMessage(
            els,
            filterProvId > 0
                ? 'Seçili platformda yayını yok'
                : "Türkiye'de dijital yayını bulunamadı"
        );
    } catch (err) {
        if (
            err.name ===
            'AbortError'
        ) {
            return;
        }

        console.error(
            'Provider bilgisi alınamadı',
            err
        );

        const els =
            getContainers();

        renderStaticMessage(
            els,
            'Platform bilgisi alınamadı'
        );
    }
}
