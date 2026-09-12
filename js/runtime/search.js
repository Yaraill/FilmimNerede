function handleSearch(event) {
    if (event.key === "Enter") searchMovie();
}

async function searchMovie(reset = true, isFilterChange = false, routeContext = null) {
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
        
        document.querySelectorAll('.provider-filter-btn').forEach(btn => btn.classList.remove('active'));
        currentProvider = 0;
        
        updateCustomOptionVisibility('sortByFilter', 'order.asc', false);
        const sortSelect = document.getElementById('sortByFilter');
        if (sortSelect && sortSelect.value === 'order.asc') sortSelect.value = 'popularity.desc';
        
        document.getElementById('top10-section').style.display = 'none';
        const platformSelection = document.getElementById('platform-selection-area');
        if (platformSelection) platformSelection.style.display = 'none';
        toggleSelectVisibility('providerFilter', false);
        
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
        
        filtered = filtered.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
        
        const container = document.getElementById('search-results');
        if (reset) container.innerHTML = "";
        
        if (filtered.length === 0 && reset) {
            container.innerHTML = "<div class='loading'>Sonuç bulunamadı.</div>";
            document.getElementById('search-results').style.minHeight = '';
            return;
        }
        
        let html = "";
        for (let i = 0; i < filtered.length; i++) {
            html += createMovieCard(filtered[i], filtered[i].media_type, "");
            fetchAndInjectProviders(filtered[i].id, filtered[i].media_type, null, routeContext);
        }
        if (reset) {
            container.innerHTML = html;
        } else {
            container.insertAdjacentHTML('beforeend', html);
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