// =========================================
// API Ayarları
// =========================================






// =========================================
// ROUTER SYSTEM (HASH ROUTING)
// =========================================


document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'auto' });
    }, 10);
});

window.addEventListener('load', () => {
    setTimeout(() => {
        window.scrollTo(0, 0);
    }, 100);
});



document.addEventListener('DOMContentLoaded', () => {
    // V5 Theme check
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
        if(document.getElementById('themeToggleBtn')) document.getElementById('themeToggleBtn').innerHTML = '<i class="fas fa-moon"></i>';
    }
    
    // Load default tab
    loadGenres();
    
    // Close autocomplete when clicking outside
    
    // Close advanced search drawer when clicking outside
    document.addEventListener('click', (e) => {
        const drawer = document.getElementById('advanced-search-panel');
        const btn = document.getElementById('advanced-toggle-btn');
        if (drawer && !drawer.classList.contains('closing') && drawer.style.display === 'block' && btn) {
            if (!drawer.contains(e.target) && !btn.contains(e.target)) {
                drawer.classList.add('closing');
                setTimeout(() => {
                    drawer.style.display = 'none';
                    drawer.classList.remove('closing');
                    btn.classList.remove('active');
                }, 300); // Matches animation duration
            }
        }
    });
    
    document.addEventListener('click', (e) => {
        const box = document.getElementById('autocomplete-box');
        const input = document.getElementById('searchInput');
        if (box && input && e.target !== input && e.target !== box && !box.contains(e.target)) {
            box.style.display = 'none';
        }

        const box1 = document.getElementById('actor1-autocomplete');
        const input1 = document.getElementById('actor1-input');
        if (box1 && input1 && e.target !== input1 && e.target !== box1 && !box1.contains(e.target)) {
            box1.style.display = 'none';
        }

        const box2 = document.getElementById('actor2-autocomplete');
        const input2 = document.getElementById('actor2-input');
        if (box2 && input2 && e.target !== input2 && e.target !== box2 && !box2.contains(e.target)) {
            box2.style.display = 'none';
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDetails(e, true);
            closeTrailer(e, true);
            closeRandom(e, true);
        }
    });

    // Parallax scroll effect for navbar
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY;
        const navbar = document.querySelector('.navbar');
        if (navbar) {
            if (scrolled > 50) {
                if (document.body.classList.contains('light-theme')) {
                    navbar.style.background = 'rgba(255, 255, 255, 0.5)';
                    navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.1)';
                } else {
                    navbar.style.background = 'rgba(15, 23, 42, 0.5)';
                    navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.5)';
                }
            } else {
                navbar.style.background = 'rgba(255, 255, 255, 0.05)';
                navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.1)';
            }
        }
    });

    // Initialize Router
    window.addEventListener("hashchange", handleRoute);
    window.addEventListener("popstate", handleRoute);
    
    const currentState = history.state || {};
    if (!currentState.filmRehberiRouter) {
        history.replaceState(
            {
                ...currentState,
                filmRehberiRouter: { index: 0 }
            },
            "",
            window.location.href
        );
    }
    
    handleRoute();

    // Infinite Scroll Implementation
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && loadMoreBtn.style.display !== 'none') {
                loadMoreResults();
            }
        }, { rootMargin: '200px' });
        observer.observe(loadMoreBtn);
        // Hide button visually but keep it in DOM for observer
        loadMoreBtn.style.opacity = '0';
        loadMoreBtn.style.pointerEvents = 'none';
        loadMoreBtn.style.height = '10px';
    }

});










async function loadGenres() {
    try {
        const [movieRes, tvRes] = await Promise.all([
            fetch(`${BASE_URL}/genre/movie/list?api_key=${API_KEY}&language=tr-TR`),
            fetch(`${BASE_URL}/genre/tv/list?api_key=${API_KEY}&language=tr-TR`)
        ]);
        const movieData = await movieRes.json();
        const tvData = await tvRes.json();
        
        // Populate global cache
        window.genresCache = { movie: movieData.genres, tv: tvData.genres };
        
        movieData.genres.forEach(g => genreMap[g.id] = g.name);
        tvData.genres.forEach(g => genreMap[g.id] = g.name);
        
        // Populate Discover Modal Genres
        const discoverGenres = document.getElementById('discover-genres');
        if (discoverGenres) {
            let html = "";
            const uniqueGenres = [];
            [...movieData.genres, ...tvData.genres].forEach(g => {
                if(!uniqueGenres.find(ug => ug.id === g.id)) uniqueGenres.push(g);
            });
            uniqueGenres.sort((a,b) => a.name.localeCompare(b.name)).forEach(g => {
                html += `
                    <label class="genre-pill-checkbox">
                        <input type="checkbox" value="${g.id}" class="discover-genre-cb">
                        <span class="genre-pill-text">${g.name}</span>
                    </label>
                `;
            });
            discoverGenres.innerHTML = html;
        }
    } catch (e) {
        console.error("Türler çekilemedi", e);
    }
}

function switchTab(event, tabId) {
    if (event) event.preventDefault();
    navigate(tabId);
}

function renderSection(tabId, routeContext = null) {
    const routePage = tabId;
    if (tabId === 'home') tabId = 'now-playing';

    clearAllFilters();
    toggleSelectVisibility('providerFilter', false);
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
    document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));

    const tabEl = document.getElementById(tabId);
    if(tabEl) tabEl.classList.add('active-tab');
    
    const link = document.querySelector(`.nav-links a[onclick*="${tabId}"]`);
    if(link) link.classList.add('active');

    if (tabId === 'now-playing') {
        loadNowPlaying(routeContext, routePage);
        loadTop10Trending(routeContext, routePage);
        loadTrendingActors(routeContext, routePage);
        loadCuratedCollections(routeContext, routePage);
        renderRecentlyViewed(routeContext);
        loadSmartRecommendations(routeContext, routePage);
    } else if (tabId === 'vizyon') {
        loadUpcomingMovies(routeContext);
    } else if (tabId === 'platform') {
        resetPlatformView(routeContext);
    } else if (tabId === 'profile') {
        loadProfile(routeContext);
    }
}













function shareMovie(id) {
    if (!isValidRouteId(id)) return;
    const url = `${window.location.origin}${window.location.pathname}#movie/${id}`;
    if (navigator.share) {
        navigator.share({
            title: 'FilmimNerede',
            text: 'Bu filme mutlaka göz atmalısın!',
            url: url
        }).catch(console.error);
    } else {
        navigator.clipboard.writeText(url).then(() => {
            alert('Bağlantı kopyalandı: ' + url);
        });
    }
}













// =========================================
// AKILLI NER ALGORTMASI (Puanlananlara Gre)
// =========================================

// =========================================
// ORTAK OYUNCU ARACI
// =========================================
let selectedActor1Id = null;
let selectedActor2Id = null;
let actor1Timeout = null;
let actor2Timeout = null;

async function handleActorAutocomplete(event, actorNum) {
    const input = document.getElementById(`actor${actorNum}-input`);
    const box = document.getElementById(`actor${actorNum}-autocomplete`);
    if (!input || !box) return;

    if (actorNum === 1) selectedActor1Id = null;
    else selectedActor2Id = null;

    const query = input.value.trim();
    if (query.length < 2) {
        box.style.display = 'none';
        return;
    }

    if (actorNum === 1) clearTimeout(actor1Timeout);
    else clearTimeout(actor2Timeout);

    const timeout = setTimeout(async () => {
        try {
            const res = await fetch(`${BASE_URL}/search/person?api_key=${API_KEY}&query=${encodeURIComponent(query)}&language=tr-TR`);
            const data = await res.json();
            let results = data.results || [];
            results = results.filter(item => (item.known_for_department === 'Acting' || item.known_for_department === 'Directing') && item.profile_path).sort((a, b) => b.popularity - a.popularity);

            if (results.length === 0) {
                box.style.display = 'none';
                return;
            }

            box.innerHTML = "";
            results.slice(0, 5).forEach(item => {
                const name = item.name || "Bilinmiyor";
                const profile = item.profile_path ? IMAGE_BASE + item.profile_path : 'https://via.placeholder.com/40x60?text=Yok';
                const knownFor = item.known_for_department || "Oyuncu";

                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerHTML = `
                    <img src="${profile}" class="suggestion-img" loading="lazy">
                    <div class="suggestion-info">
                        <span class="suggestion-title">${name}</span>
                        <span class="suggestion-meta">${knownFor}</span>
                    </div>
                `;

                div.onclick = () => {
                    input.value = name;
                    if (actorNum === 1) selectedActor1Id = item.id;
                    else selectedActor2Id = item.id;
                    box.style.display = 'none';
                };

                box.appendChild(div);
            });
            box.style.display = 'block';
        } catch(e) {
            console.error("Actor Autocomplete Error:", e);
        }
    }, 300);

    if (actorNum === 1) actor1Timeout = timeout;
    else actor2Timeout = timeout;
}

async function findCommonMovies() {
    const actor1 = document.getElementById('actor1-input').value.trim();
    const actor2 = document.getElementById('actor2-input').value.trim();
    if (!actor1 || !actor2) {
        alert("Lütfen iki oyuncu adı da giriniz.");
        return;
    }
    
    document.getElementById('common-movies-result').style.display = 'block';
    showSkeletons('common-movies-grid', 5);
    
    try {
        // Find actor 1 ID
        let id1 = selectedActor1Id;
        if (!id1) {
            let res1 = await fetch(`${BASE_URL}/search/person?api_key=${API_KEY}&query=${encodeURIComponent(actor1)}&language=tr-TR`);
            let data1 = await res1.json();
            if (!data1.results || data1.results.length === 0) throw new Error(actor1 + " bulunamadı");
            id1 = data1.results[0].id;
        }
        
        // Find actor 2 ID
        let id2 = selectedActor2Id;
        if (!id2) {
            let res2 = await fetch(`${BASE_URL}/search/person?api_key=${API_KEY}&query=${encodeURIComponent(actor2)}&language=tr-TR`);
            let data2 = await res2.json();
            if (!data2.results || data2.results.length === 0) throw new Error(actor2 + " bulunamadı");
            id2 = data2.results[0].id;
        }
        
        // Discover movies with both
        let res3 = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&with_people=${id1},${id2}&sort_by=popularity.desc&language=tr-TR`);
        let data3 = await res3.json();
        
        let html = '';
        if (!data3.results || data3.results.length === 0) {
            html = "<p>Ortak film bulunamadı.</p>";
        } else {
            data3.results.forEach(item => {
                html += createMovieCard(item, 'movie', 'common');
            });
        }
        document.getElementById('common-movies-grid').innerHTML = html;
        makeScrollable(document.getElementById('common-movies-grid'));
        
    } catch(e) {
        document.getElementById('common-movies-grid').innerHTML = "<p style='color:red;'>Hata: " + e.message + "</p>";
    }
}


function switchGameTab(tabId, btnElem) {
    document.querySelectorAll('.game-tab-content').forEach(tab => {
        tab.style.display = 'none';
    });
    document.getElementById(tabId + '-tab').style.display = 'block';
    
    if (btnElem) {
        btnElem.parentElement.querySelectorAll('.segment-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        btnElem.classList.add('active');
    }
}
