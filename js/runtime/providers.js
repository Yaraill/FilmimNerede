const providerDataCache = new Map();

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
        const looksLikeTv =
            itemData &&
            (
                itemData
                    .first_air_date ||
                (
                    itemData.name &&
                    !itemData.title
                )
            );

        safeMediaType =
            looksLikeTv
                ? 'tv'
                : 'movie';
    }

    const cacheKey =
        `${safeMediaType}:${safeItemId}`;

    const selector =
        `.providers-${safeItemId}`;

    const getContainers =
        () =>
            document
                .querySelectorAll(
                    selector
                );

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
            const res =
                await fetch(
                    `${BASE_URL}/${safeMediaType}/${safeItemId}/watch/providers?api_key=${API_KEY}`,
                    {
                        signal:
                            routeContext
                                ?.signal
                    }
                );

            if (
                routeContext &&
                !isRouteContextCurrent(
                    routeContext,
                    parseRoute().page
                )
            ) {
                return;
            }

            data =
                await res.json();

            if (res.ok) {
                providerDataCache.set(
                    cacheKey,
                    data
                );
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
            Array.isArray(
                tr?.flatrate
            )
                ? tr.flatrate
                : [];

        const hasFlatRate =
            flatRate.length > 0;

        let hasProv = false;

        if (hasFlatRate) {
            hasProv =
                filterProvId === 0 ||
                flatRate.some(
                    provider =>
                        normalizeTmdbId(
                            provider
                                ?.provider_id
                        ) ===
                        filterProvId
                );

            if (hasProv) {
                const visibleProviders =
                    flatRate.slice(
                        0,
                        3
                    );

                els.forEach(
                    container => {
                        const fragment =
                            document
                                .createDocumentFragment();

                        visibleProviders
                            .forEach(
                                provider => {
                                    const providerName =
                                        String(
                                            provider
                                                ?.provider_name ||
                                            'Platform'
                                        );

                                    const logoUrl =
                                        getSafeTmdbImageUrl(
                                            provider
                                                ?.logo_path,
                                            IMAGE_BASE,
                                            'assets/placeholder.svg'
                                        );

                                    const image =
                                        document
                                            .createElement(
                                                'img'
                                            );

                                    image.src =
                                        logoUrl;

                                    image.alt =
                                        providerName;

                                    image.title =
                                        providerName;

                                    image.loading =
                                        'lazy';

                                    image.className =
                                        'provider-logo';

                                    fragment.appendChild(
                                        image
                                    );
                                }
                            );

                        container
                            .replaceChildren(
                                fragment
                            );
                    }
                );
            }
        }

        if (!hasProv) {
            renderStaticMessage(
                els,
                filterProvId > 0
                    ? 'Seçili platformda yayını yok'
                    : "Türkiye'de yayını yok"
            );
        }
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