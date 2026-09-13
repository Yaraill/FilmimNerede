function handleSearch(event) {
    if (event.key === "Enter") searchMovie();
}

async function applySearchResultFilters(
    results,
    routeContext,
    requestGeneration
) {
    const state =
        getPlatformFilterStateFromUi();

    let filtered =
        Array.isArray(results)
            ? [...results]
            : [];

    const isRequestCurrent = () =>
        requestGeneration ===
            searchRequestGeneration &&
        !routeContext?.signal?.aborted &&
        (
            !routeContext ||
            routeContext.generation ===
                routeGeneration
        );

    if (state.media !== 'all') {
        filtered =
            filtered.filter(
                item =>
                    item.media_type ===
                    state.media
            );
    }

    const genreGroups =
        state.genres
            .map(value =>
                String(value)
                    .split('|')
                    .map(part =>
                        Number.parseInt(
                            part,
                            10
                        )
                    )
                    .filter(
                        Number.isSafeInteger
                    )
            )
            .filter(
                group =>
                    group.length > 0
            );

    if (genreGroups.length > 0) {
        filtered =
            filtered.filter(item => {
                const itemGenres =
                    new Set(
                        (
                            Array.isArray(
                                item.genre_ids
                            )
                                ? item.genre_ids
                                : []
                        ).map(Number)
                    );

                return genreGroups.every(
                    group =>
                        group.some(
                            genreId =>
                                itemGenres.has(
                                    genreId
                                )
                        )
                );
            });
    }

    if (state.year) {
        const selectedYear =
            Number.parseInt(
                state.year,
                10
            );

        if (
            Number.isSafeInteger(
                selectedYear
            )
        ) {
            const isDecade =
                state.year.endsWith('0');

            filtered =
                filtered.filter(item => {
                    const dateValue =
                        String(
                            item.release_date ||
                            item.first_air_date ||
                            ''
                        );

                    const itemYear =
                        Number.parseInt(
                            dateValue.slice(
                                0,
                                4
                            ),
                            10
                        );

                    if (
                        !Number.isSafeInteger(
                            itemYear
                        )
                    ) {
                        return false;
                    }

                    if (isDecade) {
                        return (
                            itemYear >=
                                selectedYear &&
                            itemYear <=
                                selectedYear + 9
                        );
                    }

                    return (
                        itemYear ===
                        selectedYear
                    );
                });
        }
    }

    const minimumRating =
        Number(state.rating);

    if (
        Number.isFinite(
            minimumRating
        ) &&
        minimumRating > 0
    ) {
        filtered =
            filtered.filter(
                item =>
                    Number(
                        item.vote_average ||
                        0
                    ) >= minimumRating
            );
    }

    const providerId =
        state.provider === '0'
            ? 0
            : normalizeTmdbId(
                state.provider
            );

    if (providerId) {
        const region =
            providerId === 1899 ||
            providerId === 384
                ? 'US'
                : 'TR';

        const providerFiltered = [];

        for (
            let index = 0;
            index < filtered.length;
            index += 10
        ) {
            const chunk =
                filtered.slice(
                    index,
                    index + 10
                );

            const providerMatches =
                await Promise.all(
                    chunk.map(
                        async item => {
                            const safeId =
                                normalizeTmdbId(
                                    item?.id
                                );

                            const mediaType =
                                normalizeMediaType(
                                    item?.media_type
                                );

                            if (
                                !safeId ||
                                !mediaType
                            ) {
                                return null;
                            }

                            const cacheKey =
                                `${mediaType}:${safeId}`;

                            let providerData =
                                null;

                            try {
                                if (
                                    typeof providerDataCache !==
                                        'undefined' &&
                                    providerDataCache.has(
                                        cacheKey
                                    )
                                ) {
                                    providerData =
                                        providerDataCache.get(
                                            cacheKey
                                        );
                                } else {
                                    const response =
                                        await fetch(
                                            `${BASE_URL}/${mediaType}/${safeId}/watch/providers?api_key=${API_KEY}`,
                                            {
                                                signal:
                                                    routeContext
                                                        ?.signal
                                            }
                                        );

                                    providerData =
                                        await response.json();

                                    if (
                                        response.ok &&
                                        typeof providerDataCache !==
                                            'undefined'
                                    ) {
                                        providerDataCache.set(
                                            cacheKey,
                                            providerData
                                        );
                                    }
                                }

                                const regionData =
                                    providerData
                                        ?.results
                                        ?.[region];

                                const flatRate =
                                    Array.isArray(
                                        regionData
                                            ?.flatrate
                                    )
                                        ? regionData
                                            .flatrate
                                        : [];

                                const matches =
                                    flatRate.some(
                                        provider =>
                                            normalizeTmdbId(
                                                provider
                                                    ?.provider_id
                                            ) ===
                                            providerId
                                    );

                                return matches
                                    ? item
                                    : null;
                            } catch (error) {
                                if (
                                    error?.name ===
                                    'AbortError'
                                ) {
                                    throw error;
                                }

                                return null;
                            }
                        }
                    )
                );

            if (!isRequestCurrent()) {
                return null;
            }

            providerFiltered.push(
                ...providerMatches.filter(
                    Boolean
                )
            );
        }

        filtered =
            providerFiltered;
    }

    if (state.runtime) {
        const matchesRuntime =
            runtime => {
                if (
                    !Number.isFinite(runtime) ||
                    runtime <= 0
                ) {
                    return false;
                }

                if (
                    state.runtime === '90'
                ) {
                    return runtime <= 90;
                }

                if (
                    state.runtime === '120'
                ) {
                    return (
                        runtime > 90 &&
                        runtime <= 105
                    );
                }

                if (
                    state.runtime === '150'
                ) {
                    return (
                        runtime > 105 &&
                        runtime <= 135
                    );
                }

                if (
                    state.runtime === '180'
                ) {
                    return runtime > 135;
                }

                return true;
            };

        const movieCandidates =
            filtered.filter(
                item =>
                    item.media_type ===
                    'movie'
            );

        const runtimeFiltered = [];

        for (
            let index = 0;
            index < movieCandidates.length;
            index += 10
        ) {
            const chunk =
                movieCandidates.slice(
                    index,
                    index + 10
                );

            const detailedMovies =
                await Promise.all(
                    chunk.map(
                        async item => {
                            const safeId =
                                normalizeTmdbId(
                                    item.id
                                );

                            if (!safeId) {
                                return null;
                            }

                            try {
                                const response =
                                    await fetch(
                                        `${BASE_URL}/movie/${safeId}?api_key=${API_KEY}&language=tr-TR`,
                                        {
                                            signal:
                                                routeContext?.signal
                                        }
                                    );

                                const detail =
                                    await response.json();

                                const runtime =
                                    Number(
                                        detail?.runtime
                                    );

                                if (
                                    !Number.isFinite(
                                        runtime
                                    ) ||
                                    runtime <= 0
                                ) {
                                    return null;
                                }

                                return {
                                    ...item,
                                    runtime
                                };
                            } catch (error) {
                                if (
                                    error?.name ===
                                    'AbortError'
                                ) {
                                    throw error;
                                }

                                return null;
                            }
                        }
                    )
                );

            if (!isRequestCurrent()) {
                return null;
            }

            runtimeFiltered.push(
                ...detailedMovies.filter(
                    item =>
                        item &&
                        matchesRuntime(
                            item.runtime
                        )
                )
            );
        }

        filtered =
            runtimeFiltered;
    }

    if (!isRequestCurrent()) {
        return null;
    }

    const getDateValue =
        item => {
            const value =
                Date.parse(
                    item.release_date ||
                    item.first_air_date ||
                    ''
                );

            return Number.isFinite(value)
                ? value
                : 0;
        };

    if (
        state.sort ===
        'vote_average.desc'
    ) {
        filtered.sort(
            (a, b) =>
                Number(
                    b.vote_average || 0
                ) -
                Number(
                    a.vote_average || 0
                )
        );
    } else if (
        state.sort ===
        'primary_release_date.desc'
    ) {
        filtered.sort(
            (a, b) =>
                getDateValue(b) -
                getDateValue(a)
        );
    } else if (
        state.sort ===
        'primary_release_date.asc'
    ) {
        filtered.sort(
            (a, b) =>
                getDateValue(a) -
                getDateValue(b)
        );
    } else if (
        state.sort ===
        'popularity.desc'
    ) {
        filtered.sort(
            (a, b) =>
                Number(
                    b.popularity || 0
                ) -
                Number(
                    a.popularity || 0
                )
        );
    }

    return filtered;
}

async function searchMovie(reset = true, isFilterChange = false, routeContext = null) {
    if (reset && !isFilterChange && !routeContext) {
        const searchInput =
            document.getElementById(
                'searchInput'
            );

        const requestedQuery =
            searchInput
                ? searchInput.value.trim()
                : '';

        if (requestedQuery) {
            clearAllFilters();

            restorePlatformFilterState(
                sanitizePlatformFilterState('')
            );

            navigate(
                `search?q=${encodeURIComponent(
                    requestedQuery
                )}`
            );

            return;
        }
    }

    routeContext = routeContext || {
        generation: routeGeneration,
        signal: currentAbortController?.signal
    };

    const requestGeneration = reset
        ? ++searchRequestGeneration
        : searchRequestGeneration;

    if (reset) {
        currentSearchQuery = document.getElementById('searchInput').value.trim();
        if (!currentSearchQuery) {
            const activeNav = document.querySelector('.nav-links a.active');
            if (activeNav) {
                activeNav.click();
            } else {
                switchTab(null, 'now-playing');
            }
            return;
        }

        if (!isFilterChange) {
            const scrollBehavior = (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) ? 'auto' : 'smooth';
            window.scrollTo({ top: 0, behavior: scrollBehavior });
        }
        currentMode = "search";
        currentPage = 1;

        if (!isFilterChange) {
            document
                .querySelectorAll(
                    '.provider-filter-btn'
                )
                .forEach(button =>
                    button.classList.remove(
                        'active'
                    )
                );

            currentProvider = 0;
        }

        updateCustomOptionVisibility('sortByFilter', 'order.asc', false);
        const sortSelect = document.getElementById('sortByFilter');
        if (sortSelect && sortSelect.value === 'order.asc') sortSelect.value = 'popularity.desc';

        document.getElementById('top10-section').style.display = 'none';

        const platformFilters =
            document.querySelector(
                '.platform-filters'
            );

        if (platformFilters) {
            platformFilters.style.display =
                'flex';
        }

        const platformSelection =
            document.getElementById(
                'platform-selection-area'
            );

        if (platformSelection) {
            platformSelection.style.display =
                'block';
        }

        toggleSelectVisibility(
            'providerFilter',
            false
        );

        const container = document.getElementById('search-results');
        if (isFilterChange) {
            container.style.minHeight = container.offsetHeight + 'px';
        }
        container.innerHTML = "";

        if (!currentSearchQuery) {
            container.innerHTML = "<div class='loading'>Lütfen aramak için bir kelime girin.</div>";
            document.getElementById('loadMoreBtn').style.display = 'none';
            return;
        }

        showSkeletons('search-results', 20);
        document.getElementById('loadMoreBtn').style.display = 'none';
    }

    const requestQuery = currentSearchQuery;
    const requestPage = currentPage;

    try {
        const res = await fetch(`${BASE_URL}/search/multi?api_key=${API_KEY}&language=tr-TR&query=${encodeURIComponent(requestQuery)}&page=${requestPage}&include_adult=false`, { signal: routeContext?.signal });
        const data = await res.json();

        if (requestGeneration !== searchRequestGeneration) return;
        if (routeContext && (routeContext.signal?.aborted || routeContext.generation !== routeGeneration)) return;
        if (requestQuery !== currentSearchQuery) return;

        // Filter out people and talk shows locally
        let filtered = data.results.filter(item => {
            if (item.media_type === "person") return false;
            if (item.genre_ids && (item.genre_ids.includes(10767) || item.genre_ids.includes(10763) || item.genre_ids.includes(10764) || item.genre_ids.includes(99))) return false;
            if (item.title?.toLowerCase().includes('making of') || item.name?.toLowerCase().includes('making of')) return false;
            if (item.title?.toLowerCase().includes('marvel studios assembled')) return false;
            if (item.title?.toLowerCase().includes('the odyssey: the making of')) return false;
            return true;
        });

        // Benzersiz sonuçları filtrele
        filtered = filtered.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);

        filtered =
            await applySearchResultFilters(
                filtered,
                routeContext,
                requestGeneration
            );

        if (filtered === null) {
            return;
        }

        const container = document.getElementById('search-results');
        if (reset) container.innerHTML = "";

        if (filtered.length === 0 && reset) {
            container.innerHTML = "<div class='loading'>Sonuç bulunamadı.</div>";
            document.getElementById('search-results').style.minHeight = '';
            return;
        }

        let html = "";
        for (let i = 0; i < filtered.length; i++) {
            html += createMovieCard(
                filtered[i],
                filtered[i].media_type,
                ""
            );
        }

        if (reset) {
            container.innerHTML = html;
        } else {
            container.insertAdjacentHTML(
                'beforeend',
                html
            );
        }

        for (let i = 0; i < filtered.length; i++) {
            fetchAndInjectProviders(
                filtered[i].id,
                filtered[i].media_type,
                null,
                routeContext
            );
        }

        if (filtered.length > 0) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        } else {
            document.getElementById('loadMoreBtn').style.display = 'none';
        }
        document.getElementById('search-results').style.minHeight = '';
        if (typeof announceA11y === 'function') {
            announceA11y(`${filtered.length} arama sonucu listelendi.`);
        }
        } catch (error) {
            if (error.name === 'AbortError') {
                return;
            }

            if (
                requestGeneration !==
                searchRequestGeneration
            ) {
                return;
            }

            if (
                routeContext &&
                (
                    routeContext.signal?.aborted ||
                    routeContext.generation !==
                        routeGeneration
                )
            ) {
                return;
            }

            if (!reset) {
                throw error;
            }

            const container =
                document.getElementById(
                    'search-results'
                );

            if (container) {
                container.style.minHeight = '';
            }

            renderSafeError(
                'search-results',
                'Arama sırasında bir sorun oluştu. Lütfen tekrar deneyin.',
                error
            );
        }
     finally {
        if (requestGeneration === searchRequestGeneration) {
            const spinner = document.getElementById('infinite-spinner');
            if (spinner) spinner.style.display = 'none';
        }
    }
}

let searchTimeout = null;
let autocompleteAbortController = null;
let autocompleteRequestGeneration = 0;
let searchActiveIndex = -1;

function closeSearchAutocomplete() {
    const box = document.getElementById('autocomplete-box');
    const input = document.getElementById('searchInput');
    if (box) {
        box.querySelectorAll('.suggestion-item').forEach(item => {
            item.classList.remove('active');
            item.setAttribute('aria-selected', 'false');
        });
        box.style.display = 'none';
        box.replaceChildren();
    }
    if (input) {
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }
    searchActiveIndex = -1;
}

async function handleSearchInput(event) {
    if (event && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
        return;
    }

    const query = event.target.value.trim();
    const box = document.getElementById('autocomplete-box');
    const input = event.target;

    const requestGeneration = ++autocompleteRequestGeneration;
    const routeGenerationAtInput = routeGeneration;

    clearTimeout(searchTimeout);

    if (autocompleteAbortController) {
        autocompleteAbortController.abort();
        autocompleteAbortController = null;
    }

    if (query.length < 3) {
        closeSearchAutocomplete();
        return;
    }

    searchTimeout = setTimeout(async () => {
        const controller = new AbortController();
        autocompleteAbortController = controller;
        try {
            const res = await fetch(`${BASE_URL}/search/multi?api_key=${API_KEY}&language=tr-TR&query=${encodeURIComponent(query)}&include_adult=false`, { signal: controller.signal });
            const data = await res.json();

            if (requestGeneration !== autocompleteRequestGeneration) return;
            if (routeGenerationAtInput !== routeGeneration) return;
            const currentInputValue = document.getElementById('searchInput')?.value.trim() || "";
            if (currentInputValue !== query) return;

            let results = data.results.filter(item => {
                if (item.genre_ids && (item.genre_ids.includes(10767) || item.genre_ids.includes(10763) || item.genre_ids.includes(10764))) return false;
                return true;
            });

            if (results.length === 0) {
                closeSearchAutocomplete();
                return;
            }

            if (box) {
                box.replaceChildren();
                searchActiveIndex = -1;
                input.removeAttribute('aria-activedescendant');

                let appendedCount = 0;

                results
                    .slice(0, 5)
                    .forEach((item, index) => {
                        const itemId =
                            normalizeTmdbId(
                                item?.id
                            );

                        if (!itemId) {
                            return;
                        }

                        const isPerson =
                            item.media_type ===
                            'person';

                        const mediaType =
                            isPerson
                                ? null
                                : normalizeMediaType(
                                    item.media_type
                                );

                        if (
                            !isPerson &&
                            !mediaType
                        ) {
                            return;
                        }

                        const title =
                            String(
                                item.title ||
                                item.name ||
                                'Bilinmiyor'
                            );

                        const imagePath =
                            item.poster_path ||
                            item.profile_path;

                        const poster =
                            getSafeTmdbImageUrl(
                                imagePath,
                                IMAGE_BASE,
                                'assets/placeholder.svg'
                            );

                        let typeStr =
                            'Film';

                        if (
                            mediaType === 'tv'
                        ) {
                            typeStr = 'Dizi';
                        } else if (isPerson) {
                            typeStr = 'Oyuncu';
                        }

                        const div =
                            document.createElement(
                                'div'
                            );

                        div.className =
                            'suggestion-item';
                        div.id = `search-opt-${index}`;
                        div.setAttribute('role', 'option');
                        div.setAttribute('aria-selected', 'false');

                        const img =
                            document.createElement(
                                'img'
                            );

                        img.src = poster;
                        img.className =
                            'suggestion-img';
                        img.loading = 'lazy';
                        img.alt = '';

                        const info =
                            document.createElement(
                                'div'
                            );

                        info.className =
                            'suggestion-info';

                        const titleSpan =
                            document.createElement(
                                'span'
                            );

                        titleSpan.className =
                            'suggestion-title';

                        titleSpan.textContent =
                            title;

                        const metaSpan =
                            document.createElement(
                                'span'
                            );

                        metaSpan.className =
                            'suggestion-meta';

                        metaSpan.textContent =
                            typeStr;

                        info.append(
                            titleSpan,
                            metaSpan
                        );

                        div.append(
                            img,
                            info
                        );

                        const selectSuggestion = () => {
                            closeSearchAutocomplete();

                            if (isPerson) {
                                openActorDetails(
                                    itemId
                                );
                                return;
                            }

                            window.movieCache[
                                itemId
                            ] = {
                                ...item,
                                id: itemId,
                                media_type:
                                    mediaType
                            };

                            openDetails(
                                itemId,
                                mediaType
                            );
                        };

                        div.addEventListener('mousedown', (e) => {
                            e.preventDefault();
                        });
                        div.addEventListener('click', selectSuggestion);

                        box.appendChild(div);
                        appendedCount++;
                    });

                if (appendedCount > 0) {
                    box.style.display = 'block';

                    // Prevent clipping by opening upward if necessary
                    const rect = input.getBoundingClientRect();
                    const spaceBelow = window.innerHeight - rect.bottom;
                    const spaceAbove = rect.top;

                    if (spaceBelow < 250 && spaceAbove > spaceBelow) {
                        box.style.top = 'auto';
                        box.style.bottom = '100%';
                        box.style.marginTop = '0';
                        box.style.marginBottom = '5px';
                        box.style.maxHeight = Math.min(spaceAbove - 20, 250) + 'px';
                    } else {
                        box.style.top = '100%';
                        box.style.bottom = 'auto';
                        box.style.marginTop = '5px';
                        box.style.marginBottom = '0';
                        box.style.maxHeight = Math.min(spaceBelow - 20, 250) + 'px';
                    }

                    input.setAttribute('aria-expanded', 'true');
                    if (typeof announceA11y === 'function') {
                        announceA11y(`${appendedCount} arama önerisi bulundu.`);
                    }
                } else {
                    closeSearchAutocomplete();
                    if (typeof announceA11y === 'function') {
                        announceA11y('Öneri bulunamadı.');
                    }
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') return;
            console.error("Autocomplete Error:", e);
        } finally {
            if (autocompleteAbortController === controller) {
                autocompleteAbortController = null;
            }
        }
    }, 400);
}

function initSearchAutocompleteEvents() {
    const input = document.getElementById('searchInput');
    const box = document.getElementById('autocomplete-box');
    if (!input || !box) return;

    input.addEventListener('keydown', (e) => {
        const isBoxOpen = box.style.display !== 'none' && box.children.length > 0;

        if (e.key === 'ArrowDown') {
            if (isBoxOpen) {
                e.preventDefault();
                const items = Array.from(box.querySelectorAll('.suggestion-item'));
                if (items.length > 0) {
                    searchActiveIndex = (searchActiveIndex + 1) % items.length;
                    items.forEach((item, i) => {
                        const active = i === searchActiveIndex;
                        item.classList.toggle('active', active);
                        item.setAttribute('aria-selected', active ? 'true' : 'false');
                    });
                    input.setAttribute('aria-activedescendant', items[searchActiveIndex].id);
                    items[searchActiveIndex].scrollIntoView({ block: 'nearest' });
                }
            }
        } else if (e.key === 'ArrowUp') {
            if (isBoxOpen) {
                e.preventDefault();
                const items = Array.from(box.querySelectorAll('.suggestion-item'));
                if (items.length > 0) {
                    searchActiveIndex = (searchActiveIndex - 1 + items.length) % items.length;
                    items.forEach((item, i) => {
                        const active = i === searchActiveIndex;
                        item.classList.toggle('active', active);
                        item.setAttribute('aria-selected', active ? 'true' : 'false');
                    });
                    input.setAttribute('aria-activedescendant', items[searchActiveIndex].id);
                    items[searchActiveIndex].scrollIntoView({ block: 'nearest' });
                }
            }
        } else if (e.key === 'Enter') {
            if (isBoxOpen && searchActiveIndex >= 0) {
                const items = Array.from(box.querySelectorAll('.suggestion-item'));
                if (items[searchActiveIndex]) {
                    e.preventDefault();
                    e.stopPropagation();
                    items[searchActiveIndex].click();
                }
            }
        } else if (e.key === 'Escape') {
            if (isBoxOpen) {
                e.preventDefault();
                e.stopPropagation();
                closeSearchAutocomplete();
            }
        } else if (e.key === 'Tab') {
            if (isBoxOpen) {
                // Do not preventDefault; close listbox and allow natural focus movement
                closeSearchAutocomplete();
            }
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-box')) {
            if (box.style.display !== 'none') {
                closeSearchAutocomplete();
            }
        }
    });
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSearchAutocompleteEvents);
    } else {
        initSearchAutocompleteEvents();
    }
}

async function loadMoreResults() {
    if (isLoadingMore) return;

    if (
        currentMode !== "platform" &&
        currentMode !== "search" &&
        currentMode !== "actor"
    ) {
        return;
    }

    isLoadingMore = true;

    const modeAtStart = currentMode;
    const routeContext = {
        generation: routeGeneration,
        signal: currentAbortController?.signal
    };

    const previousPage = currentPage;
    const attemptedPage = previousPage + 1;
    currentPage = attemptedPage;

    const spinner = document.getElementById('infinite-spinner');
    if (spinner) spinner.style.display = 'block';

    try {
        if (modeAtStart === "platform") {
            await loadPlatformMovies(
                currentProvider,
                false,
                false,
                routeContext
            );

        } else if (modeAtStart === "search") {
            await searchMovie(
                false,
                false,
                routeContext
            );

        } else if (modeAtStart === "actor") {
            await renderActor(
                currentActorId,
                document.getElementById('searchInput')?.value || "",
                false,
                currentJobType,
                0,
                false,
                routeContext
            );
        }
    } catch (e) {
        if (e?.name !== 'AbortError') {
            if (
                currentMode === modeAtStart &&
                currentPage === attemptedPage &&
                routeContext.generation === routeGeneration &&
                !routeContext.signal?.aborted
            ) {
                currentPage = previousPage;
            }
            console.error("loadMoreResults error:", e);
        }
    } finally {
        isLoadingMore = false;

        if (spinner) {
            spinner.style.display = 'none';
        }
    }
}