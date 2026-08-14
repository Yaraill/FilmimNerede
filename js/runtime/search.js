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
        
        if (!isFilterChange) window.scrollTo({ top: 0, behavior: 'smooth' });
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
        container.innerHTML += html;
        
        if (filtered.length > 0) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        } else {
            document.getElementById('loadMoreBtn').style.display = 'none';
        }
        document.getElementById('search-results').style.minHeight = '';
    } catch (error) {
        if (error.name === 'AbortError') return;
        if (requestGeneration !== searchRequestGeneration) return;
        if (routeContext && (routeContext.signal?.aborted || routeContext.generation !== routeGeneration)) return;
        document.getElementById('search-results').style.minHeight = '';
        console.error("searchMovie error:", error);
        if (reset) document.getElementById('search-results').innerHTML = `<div class='loading' style='color:red;'>Arama Hatası: ${error.message}</div>`;
    } finally {
        if (requestGeneration === searchRequestGeneration) {
            const spinner = document.getElementById('infinite-spinner');
            if (spinner) spinner.style.display = 'none';
        }
    }
}

let searchTimeout = null;
let autocompleteAbortController = null;
let autocompleteRequestGeneration = 0;
async function handleSearchInput(event) {
    const query = event.target.value.trim();
    const box = document.getElementById('autocomplete-box');
    
    const requestGeneration = ++autocompleteRequestGeneration;
    const routeGenerationAtInput = routeGeneration;
    
    clearTimeout(searchTimeout);
    
    if (autocompleteAbortController) {
        autocompleteAbortController.abort();
        autocompleteAbortController = null;
    }
    
    if (query.length < 3) {
        if(box) box.style.display = 'none';
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
                if(box) box.style.display = 'none';
                return;
            }
            
            if(box) {
                box.innerHTML = "";
                results.slice(0, 5).forEach(item => {
                    const title = item.title || item.name || "Bilinmiyor";
                    const poster = item.poster_path || item.profile_path ? IMAGE_BASE + (item.poster_path || item.profile_path) : 'https://via.placeholder.com/40x60?text=Yok';
                    let typeStr = "Film";
                    if(item.media_type === "tv") typeStr = "Dizi";
                    if(item.media_type === "person") typeStr = "Oyuncu";
                    
                    const div = document.createElement('div');
                    div.className = 'suggestion-item';
                    div.innerHTML = `
                        <img src="${poster}" class="suggestion-img" loading="lazy">
                        <div class="suggestion-info">
                            <span class="suggestion-title">${title}</span>
                            <span class="suggestion-meta">${typeStr}</span>
                        </div>
                    `;
                    
                    div.onclick = () => {
                        box.style.display = 'none';
                        if (item.media_type === "person") {
                            openActorDetails(item.id, title);
                        } else {
                            window.movieCache[item.id] = item;
                            openDetails(item.id);
                        }
                    };
                    
                    box.appendChild(div);
                });
                box.style.display = 'block';
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

    currentPage++;

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
            console.error("loadMoreResults error:", e);
        }
    } finally {
        isLoadingMore = false;

        if (spinner) {
            spinner.style.display = 'none';
        }
    }
}