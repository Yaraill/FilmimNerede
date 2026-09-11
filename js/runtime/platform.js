const PLATFORM_FILTER_DEFAULTS = Object.freeze({
    media: 'all',
    genres: [],
    year: '',
    rating: '0',
    runtime: '',
    sort: 'popularity.desc',
    provider: '0'
});

function getPlatformSelectValues(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return new Set();
    return new Set(
        Array.from(select.options)
            .filter(option => !option.disabled)
            .map(option => option.value)
    );
}

function getPlatformGenreValues() {
    return Array.from(
        document.querySelectorAll('.genre-pill-btn[onclick^="setGenre"]')
    )
        .map(button => {
            const match = button
                .getAttribute('onclick')
                ?.match(/^setGenre\('([^']*)'/);
            return match ? match[1] : null;
        })
        .filter(value => value !== null && value !== '');
}

function sanitizePlatformFilterState(queryString = '') {
    const params = new URLSearchParams(queryString);
    const allowedMedia = getPlatformSelectValues('mediaTypeFilter');
    const allowedYears = getPlatformSelectValues('yearFilter');
    const allowedRatings = getPlatformSelectValues('ratingFilter');
    const allowedRuntimes = getPlatformSelectValues('runtimeFilter');
    const allowedSorts = getPlatformSelectValues('sortByFilter');
    const allowedProviders = getPlatformSelectValues('providerFilter');
    const genreOrder = getPlatformGenreValues();
    const requestedGenres = new Set(
        (params.get('genres') || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
    );

    const readAllowed = (key, allowed, fallback) => {
        const value = params.get(key);
        return value !== null && allowed.has(value)
            ? value
            : fallback;
    };

    return {
        media: readAllowed('media', allowedMedia, PLATFORM_FILTER_DEFAULTS.media),
        genres: genreOrder.filter(value => requestedGenres.has(value)),
        year: readAllowed('year', allowedYears, PLATFORM_FILTER_DEFAULTS.year),
        rating: readAllowed('rating', allowedRatings, PLATFORM_FILTER_DEFAULTS.rating),
        runtime: readAllowed('runtime', allowedRuntimes, PLATFORM_FILTER_DEFAULTS.runtime),
        sort: readAllowed('sort', allowedSorts, PLATFORM_FILTER_DEFAULTS.sort),
        provider: readAllowed('provider', allowedProviders, PLATFORM_FILTER_DEFAULTS.provider)
    };
}

function getPlatformFilterStateFromUi() {
    const params = new URLSearchParams();
    const media = document.getElementById('mediaTypeFilter')?.value || 'all';
    const genres = document.getElementById('genreFilter')?.value || '';
    const year = document.getElementById('yearFilter')?.value || '';
    const rating = document.getElementById('ratingFilter')?.value || '0';
    const runtime = document.getElementById('runtimeFilter')?.value || '';
    const sort = document.getElementById('sortByFilter')?.value || 'popularity.desc';

    params.set('media', media);
    params.set('genres', genres);
    params.set('year', year);
    params.set('rating', rating);
    params.set('runtime', runtime);
    params.set('sort', sort);
    params.set('provider', String(currentProvider || 0));

    return sanitizePlatformFilterState(params.toString());
}

function buildPlatformRoute(state = getPlatformFilterStateFromUi()) {
    const params = new URLSearchParams();

    if (state.media !== PLATFORM_FILTER_DEFAULTS.media) {
        params.set('media', state.media);
    }
    if (state.genres.length > 0) {
        params.set('genres', state.genres.join(','));
    }
    if (state.year !== PLATFORM_FILTER_DEFAULTS.year) {
        params.set('year', state.year);
    }
    if (state.rating !== PLATFORM_FILTER_DEFAULTS.rating) {
        params.set('rating', state.rating);
    }
    if (state.runtime !== PLATFORM_FILTER_DEFAULTS.runtime) {
        params.set('runtime', state.runtime);
    }
    if (state.sort !== PLATFORM_FILTER_DEFAULTS.sort) {
        params.set('sort', state.sort);
    }
    if (state.provider !== PLATFORM_FILTER_DEFAULTS.provider) {
        params.set('provider', state.provider);
    }

    const queryString = params.toString();
    return queryString ? `platform?${queryString}` : 'platform';
}

function syncPlatformSelect(selectId, value) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.value = value;
    const wrapper = select.nextElementSibling;
    if (!wrapper || !wrapper.classList.contains('custom-select-container')) {
        return;
    }

    const selectedOption = select.options[select.selectedIndex];
    const triggerText = wrapper.querySelector('.custom-select-trigger span');
    if (triggerText && selectedOption) {
        triggerText.textContent = selectedOption.text;
    }

    wrapper.querySelectorAll('.custom-option').forEach(option => {
        option.classList.toggle('selected', option.dataset.value === value);
    });
}

function restorePlatformFilterState(state) {
    syncPlatformSelect('mediaTypeFilter', state.media);
    syncPlatformSelect('yearFilter', state.year);
    syncPlatformSelect('ratingFilter', state.rating);
    syncPlatformSelect('runtimeFilter', state.runtime);
    syncPlatformSelect('sortByFilter', state.sort);
    syncPlatformSelect('providerFilter', state.provider);

    document
        .querySelectorAll('.segment-btn[onclick^="setMediaType"]')
        .forEach(button => {
            const match = button
                .getAttribute('onclick')
                ?.match(/^setMediaType\('([^']*)'/);
            button.classList.toggle(
                'active',
                Boolean(match && match[1] === state.media)
            );
        });

    const selectedGenreSet = new Set(state.genres);
    selectedGenres = [...state.genres];
    const genreFilter = document.getElementById('genreFilter');
    if (genreFilter) {
        genreFilter.value = selectedGenres.join(',');
    }

    document.querySelectorAll('.genre-pill-btn[onclick^="setGenre"]').forEach(button => {
        const match = button
            .getAttribute('onclick')
            ?.match(/^setGenre\('([^']*)'/);
        if (!match) return;
        const value = match[1];
        button.classList.toggle(
            'active',
            value === '' ? selectedGenres.length === 0 : selectedGenreSet.has(value)
        );
    });

    currentProvider = Number(state.provider) || 0;
    document.querySelectorAll('.provider-filter-btn').forEach(button => {
        button.classList.toggle(
            'active',
            button.id === `btn-prov-${currentProvider}` && currentProvider > 0
        );
    });
}

function navigateToCurrentPlatformFilters(options = {}) {
    navigate(buildPlatformRoute(), options);
}
function resetPlatformView(routeContext = null) {
    if (
        window.isHistoryRestoration &&
        currentMode === "search" &&
        routeContext?.platformQuery === "" &&
        document.getElementById('search-results').children.length > 0
    ) {
        // Preserve existing search results on history back/forward
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
        document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));
        document.getElementById('platform').classList.add('active-tab');
        const platformLink = document.querySelector('a[onclick*="platform"]');
        if (platformLink) platformLink.classList.add('active');
        return;
    }
    
    document.getElementById('searchInput').value = "";
    
    // Fallbacks for removed filters
    const gF = document.getElementById('genreFilter');
    if (gF) gF.value = "";
    
    const mT = document.getElementById('mediaTypeFilter');
    if (mT) mT.value = "all";
    
    const rF = document.getElementById('ratingFilter');
    if (rF) rF.value = "0";
    
    const sB = document.getElementById('sortByFilter');
    if (sB) {
        sB.value = "popularity.desc";
        updateCustomOptionVisibility('sortByFilter', 'order.asc', false);
    }
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
    document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));
    document.getElementById('platform').classList.add('active-tab');
    const platformLink = document.querySelector('a[onclick*="platform"]');
    if (platformLink) platformLink.classList.add('active');
    
    document.getElementById('top10-section').style.display = 'block';
    const platformSelector = document.querySelector('.platform-selector');
    if (platformSelector) platformSelector.style.display = 'flex';
    const platformFilters = document.querySelector('.platform-filters');
    if (platformFilters) platformFilters.style.display = 'block';
    const filterControls = document.querySelector('.filter-controls');
    if (filterControls) filterControls.style.display = 'flex';
    
    const state = sanitizePlatformFilterState(routeContext?.platformQuery || "");
    restorePlatformFilterState(state);

    const canonicalRoute = buildPlatformRoute(state);
    if (window.location.hash.slice(1) !== canonicalRoute) {
        navigate(canonicalRoute, { replace: true });
        return;
    }

    loadPlatformMovies(
        currentProvider,
        true,
        Boolean(window.isHistoryRestoration),
        routeContext
    );
}


function applyPlatformFilters() {
    if (currentMode === "actor") {
        renderActor(currentActorId, document.getElementById('searchInput').value, true, currentJobType, 0, true);
    } else if (currentMode === "search") {
        searchMovie(true, true);
    } else {
        navigateToCurrentPlatformFilters();
    }
}


function handlePlatformButtonClick(pid) {
    if (currentProvider === pid) {
        currentProvider = 0;
    } else {
        currentProvider = pid;
    }
    syncPlatformSelect('providerFilter', String(currentProvider));
    navigateToCurrentPlatformFilters();
}


let platformRequestGeneration = 0;

async function loadPlatformMovies(providerId = 0, reset = true, isFilterChange = false, routeContext = null) {
    const requestGeneration = reset
        ? ++platformRequestGeneration
        : platformRequestGeneration;

    if (reset) {
        if (!isFilterChange && routeContext?.platformQuery == null) clearAllFilters();
        currentPage = 1;
        document.getElementById('search-results').innerHTML = "";
        document.getElementById('loadMoreBtn').style.display = 'none';
        updateCustomOptionVisibility('sortByFilter', 'order.asc', false);
        const sortSelect = document.getElementById('sortByFilter');
        if (sortSelect && sortSelect.value === 'order.asc') sortSelect.value = 'popularity.desc';
        
        if (!isFilterChange) {
            const scrollBehavior = (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) ? 'auto' : 'smooth';
            window.scrollTo({ top: 0, behavior: scrollBehavior });
        }
        currentProvider = providerId;
        
        // Sync platform dropdown
        const platSelect = document.getElementById('discover-platform');
        if (platSelect) platSelect.value = currentProvider;
        
        currentPage = 1;
        currentMode = "platform";
        const container = document.getElementById('search-results');
        
        if (isFilterChange) {
            container.style.minHeight = container.offsetHeight + 'px';
            const oldMovies = container.querySelectorAll('.movie-card, .no-provider, .loading');
            oldMovies.forEach(m => m.remove());
            
            let skel = "";
            for(let i=0; i<10; i++) {
                skel += `<div class="movie-card skeleton-card" style="border:none; background:transparent;"><div class="skeleton" style="width:100%; height:300px; border-radius:10px;"></div><div class="skeleton" style="width:80%; height:20px; margin-top:10px;"></div><div class="skeleton" style="width:50%; height:15px; margin-top:5px;"></div></div>`;
            }
            container.insertAdjacentHTML('beforeend', skel);
        } else {
            container.innerHTML = "<div class='loading'>İçerikler Yükleniyor...</div>";
        }
        document.getElementById('loadMoreBtn').style.display = 'none';
        
        document.querySelectorAll('.provider-filter-btn').forEach(btn => btn.classList.remove('active'));
        if (providerId > 0) {
            const activeBtn = document.getElementById('btn-prov-' + providerId);
            if (activeBtn) activeBtn.classList.add('active');
        }
    }

    const genre = document.getElementById('genreFilter')?.value || "";
    const rating = document.getElementById('ratingFilter')?.value || "0";
    const mediaType = document.getElementById('mediaTypeFilter')?.value || "all";
    const yearVal = document.getElementById('yearFilter')?.value || "";
    
    let typesToFetch = mediaType === "all" ? ["movie", "tv"] : [mediaType];
    let allResults = [];
    
    try {
        for (let type of typesToFetch) {
            let url = `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=tr-TR&page=${currentPage}&include_adult=false&vote_count.gte=1000&without_keywords=210024,198385,195669`;
            
            // Exclude Talk shows (10767), News (10763), Reality (10764)
            url += `&without_genres=10767,10763,10764,99`;

            if (providerId > 0) {
                if (providerId === 1899 || providerId === 384) { 
                    url += `&watch_region=US`; // HBO Max requires US region
                } else {
                    url += `&watch_region=TR`;
                }
                url += `&with_watch_providers=${providerId}`;
            }
            if (genre) url += `&with_genres=${encodeURIComponent(genre)}`;
            if (rating > 0) url += `&vote_average.gte=${rating}`;
            
            if (yearVal) {
                if (yearVal.length === 4 && !yearVal.endsWith("0")) {
                    // Exact year like 2024, 2023, 2022
                    if (type === "movie") url += `&primary_release_year=${yearVal}`;
                    else url += `&first_air_date_year=${yearVal}`;
                } else if (yearVal.endsWith("0")) {
                    // Decade like 2020, 2010, 2000
                    const startYear = yearVal;
                    const endYear = parseInt(yearVal) + 9;
                    if (type === "movie") {
                        url += `&primary_release_date.gte=${startYear}-01-01&primary_release_date.lte=${endYear}-12-31`;
                    } else {
                        url += `&first_air_date.gte=${startYear}-01-01&first_air_date.lte=${endYear}-12-31`;
                    }
                }
            }
            
            const sortBy = document.getElementById('sortByFilter') ? document.getElementById('sortByFilter').value : 'popularity.desc';
            url += `&sort_by=${sortBy}`;
            
            const runtime = document.getElementById('runtimeFilter') ? document.getElementById('runtimeFilter').value : "";
            
            // Skip TV Shows if a runtime filter is active (runtime filters >90m apply almost exclusively to movies)
            // TMDB API has very inaccurate episode runtimes for TV shows resulting in false positives like Supergirl.
            if (type === "tv" && runtime) {
                continue;
            }

            if (runtime) {
                if (runtime == '90') {
                    url += `&with_runtime.lte=90`;
                } else if (runtime == '120') {
                    url += `&with_runtime.gte=90&with_runtime.lte=105`;
                } else if (runtime == '150') {
                    url += `&with_runtime.gte=105&with_runtime.lte=135`;
                } else if (runtime == '180') {
                    url += `&with_runtime.gte=135`;
                }
            }
            
            const res = await fetch(url, { signal: routeContext?.signal });
            const data = await res.json();
            
            if (requestGeneration !== platformRequestGeneration || currentMode !== "platform") return;
            if (routeContext && !isRouteContextCurrent(routeContext, "platform")) return;
            
            if (data.results && data.results.length > 0) {
                let results = data.results;
                
                // Fetch strict runtime details if filter is active
                if (runtime && type === "movie") {
                    results = results.slice(0, 20); // Be mindful of performance
                    const detailedResults = await Promise.all(results.map(async (item) => {
                        try {
                            const detailRes = await fetch(`${BASE_URL}/movie/${item.id}?api_key=${API_KEY}&language=tr-TR`);
                            const detailData = await detailRes.json();
                            return { item, runtime: detailData.runtime || 0 };
                        } catch(e) {
                            return { item, runtime: 0 };
                        }
                    }));
                    
                    if (requestGeneration !== platformRequestGeneration || currentMode !== "platform") return;

                    results = detailedResults.filter(detail => {
                        const rt = detail.runtime;
                        if (runtime == '90') return rt <= 90;
                        if (runtime == '120') return rt >= 90 && rt <= 105;
                        if (runtime == '150') return rt >= 105 && rt <= 135;
                        if (runtime == '180') return rt >= 135;
                        return true;
                    }).map(detail => detail.item);
                }

                let validResults = results.filter(m => !m.title?.toLowerCase().includes('making of') && !m.name?.toLowerCase().includes('making of') && !m.title?.toLowerCase().includes('marvel studios assembled') && !m.title?.toLowerCase().includes('the odyssey: the making of'));
                
                allResults = allResults.concat(validResults.map(item => {
                    item.media_type = type;
                    return item;
                }));
            }
        }
        
        if (requestGeneration !== platformRequestGeneration || currentMode !== "platform") return;

        allResults.sort((a, b) => b.popularity - a.popularity);
        
        const container = document.getElementById('search-results');
        if (reset) container.innerHTML = "";
        
        if (allResults.length === 0 && reset) {
            container.innerHTML = "<div class='loading'>Bu filtrelere uygun içerik bulunamadı.</div>";
            return;
        }
        
        let html = "";
        for (let i = 0; i < allResults.length; i++) {
            html += createMovieCard(allResults[i], allResults[i].media_type, "");
            fetchAndInjectProviders(allResults[i].id, allResults[i].media_type, null, routeContext);
        }
        if (reset) {
            container.innerHTML = html;
        } else {
            container.insertAdjacentHTML('beforeend', html);
        }
        
        if (allResults.length > 0) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        }
        if (reset) document.getElementById('search-results').style.minHeight = '';
    } catch (error) {
        if (error.name === 'AbortError') return;
        if (requestGeneration !== platformRequestGeneration) return;
        if (!reset) throw error;
        if (reset) document.getElementById('search-results').style.minHeight = '';
        console.error("loadPlatformMovies error:", error);
        if (reset) {
            renderSafeError(
                'search-results',
                'İçerikler yüklenirken bir sorun oluştu. Lütfen tekrar deneyin.',
                error
            );
        }
    } finally {
        const spinner = document.getElementById('infinite-spinner');
        if (spinner) spinner.style.display = 'none';
    }
}



// --- PREMIUM FILTER UI LOGIC ---
function setMediaType(val, btn) {
    // Update hidden select
    document.getElementById('mediaTypeFilter').value = val;
    // Update UI
    const siblings = btn.parentElement.querySelectorAll('.segment-btn');
    siblings.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Trigger filter
    applyPlatformFilters();
}

let selectedGenres = [];

function setGenre(val, btn) {
    const hepsiBtn = btn.parentElement.querySelector('.genre-pill-btn[onclick*="\'\'"]');
    
    if (val === '') {
        selectedGenres = [];
        const siblings = btn.parentElement.querySelectorAll('.genre-pill-btn');
        siblings.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    } else {
        if (hepsiBtn) hepsiBtn.classList.remove('active');
        
        if (selectedGenres.includes(val)) {
            selectedGenres = selectedGenres.filter(g => g !== val);
            btn.classList.remove('active');
        } else {
            selectedGenres.push(val);
            btn.classList.add('active');
        }
        
        if (selectedGenres.length === 0) {
            if (hepsiBtn) hepsiBtn.classList.add('active');
        }
    }
    
    document.getElementById('genreFilter').value = selectedGenres.join(',');
    applyPlatformFilters();
}

function clearAllFilters() {
    const gf = document.getElementById('genreFilter');
    if (gf) gf.value = '';
    const yf = document.getElementById('yearFilter');
    if (yf) yf.value = '';
    const sf = document.getElementById('sortByFilter');
    if (sf) sf.value = 'popularity.desc';
    const pf = document.getElementById('providerFilter');
    if (pf) pf.value = '0';
    const rf = document.getElementById('ratingFilter');
    if (rf) rf.value = '0';
    const rtf = document.getElementById('runtimeFilter');
    if (rtf) rtf.value = '';
    const mtf = document.getElementById('mediaTypeFilter');
    if (mtf) mtf.value = 'all';
    
    document.querySelectorAll('.segment-btn[onclick^="setMediaType"]').forEach(btn => btn.classList.remove('active'));
    const allMediaBtn = document.querySelector('.segment-btn[onclick="setMediaType(\'all\', this)"]');
    if (allMediaBtn) allMediaBtn.classList.add('active');
    
    // Sync custom selects if they exist
    document.querySelectorAll('select.custom-select-hidden').forEach(select => {
        const wrapper = select.nextElementSibling;
        if (wrapper && wrapper.classList.contains('custom-select-container')) {
            const selectedOption = select.options[select.selectedIndex];
            if (selectedOption) {
                const trigger = wrapper.querySelector('.custom-select-trigger span');
                if (trigger) trigger.textContent = selectedOption.text;
                
                wrapper.querySelectorAll('.custom-option').forEach(opt => {
                    opt.classList.remove('selected');
                    if (opt.dataset.value === select.value) {
                        opt.classList.add('selected');
                    }
                });
            }
        }
    });
    
    selectedGenres = [];
    document.querySelectorAll('.genre-pill-btn').forEach(b => b.classList.remove('active'));
    const hepsiBtn = document.querySelector('.genre-pill-btn[onclick*="\'\'"]');
    if (hepsiBtn) hepsiBtn.classList.add('active');
}