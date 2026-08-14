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









function surpriseMe() {
    const modal = document.getElementById('random-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = "hidden";
    }
}

function closeRandom(event, force = false) {
    if (force || event.target.id === 'random-modal' || event.target.closest('.close-btn')) {
        const modal = document.getElementById('random-modal');
        if (modal) {
            modal.classList.remove('active');
            if (!document.getElementById('details-modal').classList.contains('active')) {
                document.body.style.overflow = "auto";
            }
        }
    }
}

async function loadTop10Trending(routeContext = null, expectedPage = null) {
    try {
        const res = await fetch(`${BASE_URL}/trending/all/week?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        const data = await res.json();
        if (routeContext && expectedPage && !isRouteContextCurrent(routeContext, expectedPage)) return;
        const top10 = data.results.slice(0, 10);
        
        const container = document.getElementById('top10-grid');
        if (container) {
            document.getElementById('top10-section').style.display = 'block';
            container.innerHTML = top10.map((item, index) => {
                const title = item.title || item.name;
                const poster = item.poster_path ? IMAGE_BASE + item.poster_path : 'https://via.placeholder.com/500x750?text=Yok';
                
                // Cache it
                window.movieCache[item.id] = {
                    id: item.id,
                    title: title,
                    name: title,
                    release_date: item.release_date || item.first_air_date,
                    poster_path: item.poster_path,
                    backdrop_path: item.backdrop_path,
                    overview: item.overview,
                    vote_average: item.vote_average,
                    genre_ids: item.genre_ids,
                    media_type: item.media_type
                };
                
                return `
                    <div class="recommendation-card top10-card" onclick="openDetails(${item.id})" style="position:relative; width:140px; margin-left: 20px;">
                        <span class="top10-number">${index + 1}</span>
                        <img src="${poster}" alt="${title}" style="width: 100%; height: 210px; object-fit: cover; border-radius: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.5);" loading="lazy">
                    </div>
                `;
            }).join('');
            makeScrollable(container);
        }
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error("Top 10 fetching failed", e);
    }
}

window.lastRandomGenre = null;
async function fetchRandomMovie(isNext = false) {
    let genre = "";
    if (isNext) {
        genre = window.lastRandomGenre;
    } else {
        genre = document.getElementById('randomGenreSelect').value;
        window.lastRandomGenre = genre;
    }
    
    const btn = document.querySelector(isNext ? '#next-random-btn' : '#random-modal .btn-buy-ticket');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aranıyor...';
        btn.disabled = true;
    }

    try {
        let maxPage = 50;
        const genreQuery = genre ? `&with_genres=${genre}` : '';
        
        try {
            const initialRes = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&page=1&vote_count.gte=500&sort_by=popularity.desc${genreQuery}`);
            const initialData = await initialRes.json();
            if (initialData.total_pages) {
                maxPage = Math.min(50, initialData.total_pages);
            }
        } catch(e) {}
        
        const randomPage = Math.floor(Math.random() * maxPage) + 1; 
        const res = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&page=${randomPage}&vote_count.gte=500&sort_by=popularity.desc${genreQuery}`);
        const data = await res.json();
        let validMovies = data.results.filter(m => !['hi','ja','ko','zh','th','cn','te','ta'].includes(m.original_language) && !m.title.toLowerCase().includes('making of'));
        if(validMovies.length === 0) validMovies = data.results;
        const randomMovie = validMovies[Math.floor(Math.random() * validMovies.length)];
        
        if (randomMovie) {
            randomMovie.media_type = "movie";
            window.movieCache[randomMovie.id] = randomMovie;
            if (!isNext) closeRandom(null, true);
            
            window.isRandomMode = true;
            openDetails(randomMovie.id);
            
            const nextContainer = document.getElementById('random-next-container');
            if (nextContainer) nextContainer.style.display = 'block';
        } else {
            alert('Bu kritere uygun film bulunamadı, lütfen tekrar deneyin!');
        }
    } catch (e) {
        console.error(e);
        alert('Rastgele film seçilirken hata oluştu.');
    } finally {
        if (btn) {
            if (isNext) {
                btn.innerHTML = '<i class="fas fa-random"></i> Başka Öner';
            } else {
                btn.innerHTML = '<i class="fas fa-magic"></i> Bana Öner!';
            }
            btn.disabled = false;
        }
    }
}

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







async function loadNowPlaying(routeContext = null, expectedPage = null) {
    const container = document.getElementById('now-playing-grid');
    if(document.getElementById('top10-section')) document.getElementById('top10-section').style.display = 'block';
    if(document.getElementById('collections-section')) document.getElementById('collections-section').style.display = 'block';
    if(document.getElementById('trending-actors-section')) document.getElementById('trending-actors-section').style.display = 'block';

    if (container.children.length > 0) return;
    
    showSkeletons('now-playing-grid', 10);
    container.style.display = "";
    container.innerHTML = "<div class='loading'>Vizyondaki filmler çekiliyor...</div>";
    try {
        const res = await fetch(`${BASE_URL}/movie/now_playing?api_key=${API_KEY}&language=tr-TR&region=TR&page=1`, { signal: routeContext?.signal });
        const data = await res.json();
        
        if (routeContext && expectedPage && !isRouteContextCurrent(routeContext, expectedPage)) return;
        
        let html = "";
        data.results.forEach(movie => {
            html += createMovieCard(movie, "movie", "now-playing");
        });
        container.innerHTML = html;
        
        // Fetch providers for each movie after rendering cards
        data.results.forEach(movie => {
            fetchAndInjectProviders(movie.id, "movie", null, routeContext);
        });
    } catch (error) {
        if (error.name === 'AbortError') return;
        container.innerHTML = "<div class='loading'>Hata oluştu.</div>";
    }
}

async function loadUpcomingMovies(routeContext = null) {
    const container = document.getElementById('upcoming-movies');
    if (container.children.length > 1) return; 
    
    container.style.display = "";
    container.innerHTML = "<div class='loading'>Gelecek filmler çekiliyor...</div>";
    try {
        const today = new Date().toISOString().split('T')[0];
        const response = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&region=TR&with_release_type=2|3|4&release_date.gte=${today}&sort_by=release_date.asc&popularity.gte=15&page=1`, { signal: routeContext?.signal });
        const data = await response.json();
        
        if (routeContext && !isRouteContextCurrent(routeContext, "vizyon")) return;
        
        let html = "";
        data.results.forEach(movie => {
            html += createMovieCard(movie, "movie", "upcoming");
        });
        container.innerHTML = html;
    } catch (error) {
        if (error.name === 'AbortError') return;
        container.innerHTML = "<div class='loading'>Hata oluştu.</div>";
    }
}





function toggleWatchlist(btnElem, movieId) {
    const item = window.movieCache[movieId];
    if (!item) return;
    
    let watchlist = JSON.parse(localStorage.getItem('watchlist')) || [];
    const existingIndex = watchlist.findIndex(w => w.id === item.id);
    const isAdding = existingIndex === -1;
    
    if (!isAdding) {
        watchlist.splice(existingIndex, 1);
    } else {
        watchlist.push(item);
    }
    
    localStorage.setItem('watchlist', JSON.stringify(watchlist));
    
    // Global sync for all heart buttons for this movie
    const allBtns = document.querySelectorAll(`button[onclick*="toggleWatchlist(this, ${item.id})"]`);
    allBtns.forEach(btn => {
        if (!isAdding) {
            btn.classList.remove('active');
        } else {
            btn.classList.add('active');
        }
    });
    
    // Explicit sync for the modal button if it's currently open for this movie
    const modalBtn = document.getElementById("modal-wl-btn");
    if (modalBtn && window.currentMovieId === item.id) {
        if (!isAdding) {
            modalBtn.classList.remove('active');
            modalBtn.classList.add('inactive');
            modalBtn.innerHTML = '<i class="fas fa-heart"></i> Listeme Ekle';
            modalBtn.style.background = "";
            modalBtn.style.color = "";
        } else {
            modalBtn.classList.remove('inactive');
            modalBtn.classList.add('active');
            modalBtn.innerHTML = `<i class="fas fa-heart"></i> Listeden Çıkar`;
            modalBtn.style.background = "";
            modalBtn.style.color = "";
        }
    }
    
    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }
}

function toggleRateMenu(id) {
    const menu = document.getElementById(`rate-menu-${id}`);
    if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

function saveRating(id, rating) {
    const savedRatings = JSON.parse(localStorage.getItem('movieRatings') || '{}');
    savedRatings[id] = rating;
    localStorage.setItem('movieRatings', JSON.stringify(savedRatings));
    
    // Ayrıca "Listem" sekmesinde gözükmesi için ratedMovies dizisine de kaydedelim
    const item = window.movieCache[id];
    if (item) {
        let ratedMovies = JSON.parse(localStorage.getItem('ratedMovies') || '[]');
        if (!ratedMovies.some(m => m.id === id)) {
            ratedMovies.push(item);
            localStorage.setItem('ratedMovies', JSON.stringify(ratedMovies));
        }
    }

    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }

    const textSpan = document.getElementById(`rate-text-${id}`);
    if (textSpan) textSpan.innerText = `⭐ ${rating}/10`;
    const btn = textSpan ? textSpan.parentElement : null;
    if (btn) {
        btn.classList.add('active');
        btn.classList.remove('inactive');
    }
    const menu = document.getElementById(`rate-menu-${id}`);
    if (menu) menu.style.display = 'none';
}

function removeRating(id) {
    const savedRatings = JSON.parse(localStorage.getItem('movieRatings') || '{}');
    delete savedRatings[id];
    localStorage.setItem('movieRatings', JSON.stringify(savedRatings));
    
    let ratedMovies = JSON.parse(localStorage.getItem('ratedMovies') || '[]');
    ratedMovies = ratedMovies.filter(m => m.id !== id);
    localStorage.setItem('ratedMovies', JSON.stringify(ratedMovies));

    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }

    const textSpan = document.getElementById(`rate-text-${id}`);
    if (textSpan) textSpan.innerText = "İzledim / Puan Ver";
    const btn = textSpan ? textSpan.parentElement : null;
    if (btn) {
        btn.classList.remove('active');
        btn.classList.add('inactive');
    }
    const menu = document.getElementById(`rate-menu-${id}`);
    if (menu) menu.style.display = 'none';
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

function renderRecentlyViewed(routeContext = null) {
    const recent = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    const container = document.getElementById('recently-viewed-grid');
    if (!container) return;
    
    if (recent.length === 0) {
        document.getElementById('recently-viewed-section').style.display = 'none';
    } else {
        document.getElementById('recently-viewed-section').style.display = 'block';
        container.innerHTML = recent.map(item => createMovieCard(item, item.media_type, "")).join('');
        recent.forEach(item => fetchAndInjectProviders(item.id, item.media_type, item, routeContext));
    }
}

function switchProfileTab(tabId, btnElem) {
    document.querySelectorAll('.profile-tab-content').forEach(el => {
        el.classList.remove('active-tab');
        el.style.display = 'none';
    });
    const target = document.getElementById(tabId);
    if (target) {
        target.classList.add('active-tab');
        target.style.display = 'block';
    }
    
    document.querySelectorAll('.profile-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = '';
        btn.style.border = '';
    });
    if (btnElem) {
        btnElem.classList.add('active');
        btnElem.style.background = '';
        btnElem.style.borderColor = '';
    }
}

function loadProfile(routeContext = null) {
    const watchlistGrid = document.getElementById('watchlist-grid');
    const ratedTvGrid = document.getElementById('rated-tv-grid');
    const ratedMovieGrid = document.getElementById('rated-movie-grid');
    const actorsGrid = document.getElementById('favorite-actors-grid');
    const statsContainer = document.getElementById('profile-stats-container');
    
    const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    const ratedMovies = JSON.parse(localStorage.getItem('ratedMovies') || '[]');
    const favoriteActors = JSON.parse(localStorage.getItem('favoriteActors') || '[]');
    
    // Stats Calculation
    let totalWatchTimeMinutes = 0;
    let needsFetch = false;

    ratedMovies.forEach(m => {
        if (m.exact_runtime_mins_v2 !== undefined) {
            totalWatchTimeMinutes += m.exact_runtime_mins_v2;
        } else {
            let type = m.media_type;
            if (!type || type === "undefined") {
                type = (m.first_air_date || (m.name && !m.title)) ? "tv" : "movie";
            }
            totalWatchTimeMinutes += type === "tv" ? 900 : 120; // Approximate 15h per series, 2h per movie
            needsFetch = true;
        }
    });
    
    let displayHours = Math.floor(totalWatchTimeMinutes / 60);
    let displayMins = totalWatchTimeMinutes % 60;
    let timeText = `${displayHours}s ${displayMins > 0 ? displayMins + 'd' : ''}`;
    if (needsFetch) timeText = "~" + displayHours + "s";
    
    let genreCounts = {};
    ratedMovies.forEach(m => {
        if (m.genre_ids) {
            m.genre_ids.forEach(gId => {
                genreCounts[gId] = (genreCounts[gId] || 0) + 1;
            });
        }
    });
    
    let favoriteGenre = "Belirsiz";
    if (Object.keys(genreCounts).length > 0) {
        const topGenreId = Object.keys(genreCounts).reduce((a, b) => genreCounts[a] > genreCounts[b] ? a : b);
        const allGenres = Object.values(window.genresCache || {}).flat();
        const genreObj = allGenres.find(g => String(g.id) === String(topGenreId));
        if (genreObj) favoriteGenre = genreObj.name;
    }
    
    const savedRatings = JSON.parse(localStorage.getItem('movieRatings') || '{}');
    const ratingsArray = Object.values(savedRatings);
    const avgRating = ratingsArray.length > 0 ? (ratingsArray.reduce((a,b)=>a+b,0) / ratingsArray.length).toFixed(1) : 0;
    
    statsContainer.innerHTML = `
        <div class="stat-card" style="border-top: 2px solid var(--primary-color); position:relative; overflow:hidden;">
            <i class="fas fa-film" style="position:absolute; right:-10px; bottom:-10px; font-size:4rem; color:rgba(128,128,128,0.1);"></i>
            <div class="stat-value" style="background: -webkit-linear-gradient(45deg, var(--primary-color), var(--accent-color)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${watchlist.length + ratedMovies.length}</div>
            <div class="stat-label" style="font-weight:600; letter-spacing:1px; font-size:0.9rem;">Toplam İçerik</div>
        </div>
        <div class="stat-card" style="border-top: 2px solid #00c6ff; position:relative; overflow:hidden;">
            <i class="fas fa-clock" style="position:absolute; right:-10px; bottom:-10px; font-size:4rem; color:rgba(128,128,128,0.1);"></i>
            <div class="stat-value" id="profile-watch-time" style="background: -webkit-linear-gradient(45deg, #00c6ff, #0072ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${timeText}</div>
            <div class="stat-label" style="font-weight:600; letter-spacing:1px; font-size:0.9rem;">İzleme Süresi</div>
        </div>
        <div class="stat-card" style="border-top: 2px solid #f1c40f; position:relative; overflow:hidden;">
            <i class="fas fa-star" style="position:absolute; right:-10px; bottom:-10px; font-size:4rem; color:rgba(128,128,128,0.1);"></i>
            <div class="stat-value" style="background: -webkit-linear-gradient(45deg, #f1c40f, #e67e22); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${avgRating}</div>
            <div class="stat-label" style="font-weight:600; letter-spacing:1px; font-size:0.9rem;">Ortalama Puan</div>
        </div>
        <div class="stat-card" style="border-top: 2px solid #9b59b6; position:relative; overflow:hidden;">
            <i class="fas fa-heart" style="position:absolute; right:-10px; bottom:-10px; font-size:4rem; color:rgba(128,128,128,0.1);"></i>
            <div class="stat-value" style="font-size:1.5rem; line-height:2.5rem; background: -webkit-linear-gradient(45deg, #9b59b6, #8e44ad); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${favoriteGenre}</div>
            <div class="stat-label" style="font-weight:600; letter-spacing:1px; font-size:0.9rem;">Favori Tür</div>
        </div>
    `;

    // Asynchronously calculate exact watch time
    if (needsFetch) {
        calculateExactWatchTime(ratedMovies).then(exactMinutes => {
            const watchTimeElem = document.getElementById('profile-watch-time');
            if (watchTimeElem && exactMinutes > 0) {
                let hours = Math.floor(exactMinutes / 60);
                let mins = exactMinutes % 60;
                watchTimeElem.innerText = `${hours}s ${mins > 0 ? mins + 'd' : ''}`;
            }
        });
    }
    
    // Render Recently Viewed
    renderRecentlyViewed(routeContext);

    // Render Watchlist
    if (watchlist.length === 0) {
        watchlistGrid.innerHTML = "<div class='no-provider' style='grid-column: 1/-1;'>İzleme listeniz boş.</div>";
    } else {
        watchlistGrid.innerHTML = watchlist.map(item => {
            let type = item.media_type;
            if (!type || type === "undefined") type = item.first_air_date ? "tv" : "movie";
            return createMovieCard(item, type, "");
        }).join('');
    }
    
    // Render Rated
    let ratedTvs = [];
    let ratedMoviesOnly = [];
    ratedMovies.forEach(item => {
        let type = item.media_type;
        if (!type || type === "undefined") {
            type = (item.first_air_date || (item.name && !item.title)) ? "tv" : "movie";
        }
        if (type === "tv") ratedTvs.push(item);
        else ratedMoviesOnly.push(item);
    });

    if (ratedTvs.length === 0) {
        ratedTvGrid.innerHTML = "<div class='no-provider' style='grid-column: 1/-1;'>Puanladığınız dizi yok.</div>";
    } else {
        ratedTvGrid.innerHTML = ratedTvs.map(item => createMovieCard(item, "tv", "")).join('');
    }

    if (ratedMoviesOnly.length === 0) {
        ratedMovieGrid.innerHTML = "<div class='no-provider' style='grid-column: 1/-1;'>Puanladığınız film yok.</div>";
    } else {
        ratedMovieGrid.innerHTML = ratedMoviesOnly.map(item => createMovieCard(item, "movie", "")).join('');
    }
    
    // Render Actors
    if (favoriteActors.length === 0) {
        actorsGrid.innerHTML = "<div class='no-provider' style='grid-column: 1/-1;'>Favori oyuncunuz yok.</div>";
    } else {
        actorsGrid.innerHTML = favoriteActors.map(actor => {
            const profile = actor.profile_path ? IMAGE_BASE + actor.profile_path : 'https://via.placeholder.com/150x225?text=Yok';
            return `
                <div class="fav-actor-card" onclick="openActorDetails(${actor.id}, '${actor.name}')">
                    <img src="${profile}" alt="${actor.name}" loading="lazy">
                    <h4>${actor.name}</h4>
                    <button class="btn-actor-heart active" onclick="event.stopPropagation(); toggleActorFavorite(this, ${actor.id}, '${actor.name}', '${actor.profile_path}')">
                        <i class="fas fa-heart"></i>
                    </button>
                </div>
            `;
        }).join('');
    }
    
    [...watchlist, ...ratedMovies].forEach(item => {
        let type = item.media_type;
        if (!type || type === "undefined") type = item.first_air_date ? "tv" : "movie";
        fetchAndInjectProviders(item.id, type, item, routeContext);
    });
}

async function calculateExactWatchTime(ratedMovies) {
    let exactTimeMinutes = 0;
    let updated = false;

    for (let m of ratedMovies) {
        if (m.exact_runtime_mins_v2 !== undefined) {
            exactTimeMinutes += m.exact_runtime_mins_v2;
            continue;
        }

        let type = m.media_type;
        if (!type || type === "undefined") {
            type = (m.first_air_date || (m.name && !m.title)) ? "tv" : "movie";
        }
        
        try {
            const res = await fetch(`https://api.themoviedb.org/3/${type}/${m.id}?api_key=${API_KEY}&language=tr-TR`);
            if (!res.ok) {
                throw new Error(`API Error: ${res.status}`);
            }
            const data = await res.json();
            if (data.success === false) {
                throw new Error(`API Data Error: ${data.status_message}`);
            }
            
            let minutes = 0;
            if (type === "movie") {
                minutes = data.runtime || 120;
            } else {
                let epTime = (data.episode_run_time && data.episode_run_time.length > 0) ? data.episode_run_time[0] : 45;
                let episodes = data.number_of_episodes || (data.number_of_seasons ? data.number_of_seasons * 10 : 20);
                minutes = epTime * episodes;
            }
            
            m.exact_runtime_mins_v2 = minutes;
            exactTimeMinutes += minutes;
            updated = true;
        } catch (e) {
            console.error("Watch time fetch error", e);
            exactTimeMinutes += type === "tv" ? 900 : 120; // fallback 15h / 2h
        }
    }

    if (updated) {
        localStorage.setItem('ratedMovies', JSON.stringify(ratedMovies));
    }

    return exactTimeMinutes;
}



function openActorDetails(actorId, actorName, reset = true, jobType = 'cast', filterGenre = 0, isFilterChange = false) {
    navigate('actor/' + actorId);
}

async function renderActor(actorId, actorName = "", reset = true, jobType = 'cast', filterGenre = 0, isFilterChange = false, routeContext = null) {
    routeContext = routeContext || { generation: routeGeneration, signal: currentAbortController?.signal };
    hideActorTooltip();
    
    if (reset) {
        if (!isFilterChange) {
                // Filter clearing moved to top
            }
        
        const detailsModal = document.getElementById('details-modal');
        if (detailsModal) detailsModal.style.display = 'none';

        currentMode = "actor";
        currentActorId = actorId;
        currentJobType = jobType;
        currentPage = 1;
        
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
        document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));
        document.getElementById('platform').classList.add('active-tab');
        const platformLink = document.querySelector('a[onclick*="platform"]');
        if (platformLink) platformLink.classList.add('active');
        
        document.querySelectorAll('.provider-filter-btn').forEach(btn => btn.classList.remove('active'));
        currentProvider = 0;
        
        toggleSelectVisibility('providerFilter', true);
        
        document.getElementById('searchInput').value = actorName;
        const container = document.getElementById('search-results');
        
        if (!isFilterChange) {
            container.innerHTML = "";
            showSkeletons('search-results', 10);
            document.getElementById('loadMoreBtn').style.display = 'none';
        } else {
            container.style.minHeight = container.offsetHeight + 'px';
            const oldMovies = container.querySelectorAll('.movie-card, .no-provider, .loading');
            oldMovies.forEach(m => m.remove());
            
            let skel = "";
            for(let i=0; i<10; i++) {
                skel += `<div class="movie-card skeleton-card" style="border:none; background:transparent;"><div class="skeleton" style="width:100%; height:300px; border-radius:10px;"></div><div class="skeleton" style="width:80%; height:20px; margin-top:10px;"></div><div class="skeleton" style="width:50%; height:15px; margin-top:5px;"></div></div>`;
            }
            container.insertAdjacentHTML('beforeend', skel);
        }
        
        document.getElementById('top10-section').style.display = 'none';
        const nowPlaying = document.getElementById('now-playing-section');
        if (nowPlaying) nowPlaying.style.display = 'none';
        const vizyon = document.getElementById('vizyon-section');
        if (vizyon) vizyon.style.display = 'none';
        
        const platformFilters = document.querySelector('.platform-filters');
        if (platformFilters) platformFilters.style.display = 'none';
        
        // moved below clearAllFilters
    }
    
    if (reset && !isFilterChange) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        clearAllFilters();
    }
    
    if (reset) {
        updateCustomOptionVisibility('sortByFilter', 'order.asc', jobType !== 'Director');
    }

    try {
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;

        const personRes = await fetch(`${BASE_URL}/person/${currentActorId}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        const personData = await personRes.json();
        
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        
        if (!actorName) {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = personData.name;
        }
        
        // EĞER KİŞİ ASLEN BİR YÖNETMENSE VE VARSAYILAN OLARAK 'CAST' GELDİYSE, ONU YÖNETMEN OLARAK DEĞİŞTİR!
        if (jobType === 'cast' && personData.known_for_department === 'Directing') {
            jobType = 'Director';
        }
        
        const filterProvId = parseInt(document.getElementById('providerFilter')?.value || "0");
        
        const creditsRes = await fetch(`${BASE_URL}/person/${currentActorId}/combined_credits?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        let data = await creditsRes.json();
        
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        
        let movies = [];
        if (jobType === 'Director') {
            movies = data.crew ? data.crew.filter(c => c.job === 'Director') : [];
            // Remove duplicates
            const seen = new Set();
            movies = movies.filter(item => {
                const duplicate = seen.has(item.id);
                seen.add(item.id);
                return !duplicate && item.poster_path;
            });
        } else {
            movies = data.cast || [];
            const seenCast = new Set();
            movies = movies.filter(item => {
                const isDup = seenCast.has(item.id);
                seenCast.add(item.id);
                return !isDup;
            });
            // Exclude talk shows locally
            movies = movies.filter(m => !(m.genre_ids && (m.genre_ids.includes(10767) || m.genre_ids.includes(10763) || m.genre_ids.includes(10764))));
        }
        
        // Exclude documentaries (genre 99) from actor/director filmography
        movies = movies.filter(m => !(m.genre_ids && m.genre_ids.includes(99)));

        // Exclude award shows, ceremonies, making-of, behind-the-scenes
        const blockedWords = ["award", "oscar", "grammy", "emmy", "golden globe", "bafta", "tony", "ceremony", "making of", "behind the scenes", "the making", "assembled", "a film by", "road to", "story of"];
        movies = movies.filter(m => {
            const title = (m.title || m.name || "").toLowerCase();
            return !blockedWords.some(w => title.includes(w));
        });

        // Only keep items with a poster (no poster = likely a minor production)
        movies = movies.filter(m => m.poster_path);
        
        
        const mediaType = document.getElementById('mediaTypeFilter')?.value || "all";
        if (mediaType === "movie") {
            movies = movies.filter(m => m.media_type === "movie");
        } else if (mediaType === "tv") {
            movies = movies.filter(m => m.media_type === "tv");
        }
        
        const genreFilterStr = document.getElementById('genreFilter')?.value || "";
        if (genreFilterStr !== "") {
            const selectedGenresArr = genreFilterStr.split(',').map(g => parseInt(g)).filter(g => !isNaN(g));
            if (selectedGenresArr.length > 0) {
                movies = movies.filter(m => m.genre_ids && selectedGenresArr.every(g => m.genre_ids.includes(g)));
            }
        } else if (filterGenre > 0) {
            movies = movies.filter(m => m.genre_ids && m.genre_ids.includes(parseInt(filterGenre)));
        }
        
        const yearFilterStr = document.getElementById('yearFilter')?.value || "";
        if (yearFilterStr !== "") {
            movies = movies.filter(m => {
                const y = m.release_date ? m.release_date.split('-')[0] : (m.first_air_date ? m.first_air_date.split('-')[0] : "");
                return y === yearFilterStr;
            });
        }
        
        const ratingFilter = parseFloat(document.getElementById('ratingFilter')?.value || "0");
        if (ratingFilter > 0) {
            movies = movies.filter(m => m.vote_average >= ratingFilter);
        }
        
        const runtimeFilter = document.getElementById('runtimeFilter')?.value || "";
        if (runtimeFilter !== "") {
            movies = movies.filter(m => m.media_type === "movie");
            
            const validMovies = [];
            const maxToCheck = Math.min(movies.length, 60);
            for (let i = 0; i < maxToCheck; i += 20) {
                const chunk = movies.slice(i, Math.min(i + 20, maxToCheck));
                const results = await Promise.all(chunk.map(async m => {
                    try {
                        const res = await fetch(`${BASE_URL}/movie/${m.id}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
                        const detail = await res.json();
                        const rt = detail.runtime || 0;
                        if (runtimeFilter == '90' && rt <= 90 && rt > 0) return m;
                        if (runtimeFilter == '120' && rt > 90 && rt <= 105) return m;
                        if (runtimeFilter == '150' && rt > 105 && rt <= 135) return m;
                        if (runtimeFilter == '180' && rt > 135) return m;
                    } catch (e) { if (e.name === 'AbortError') throw e; return null; }
                    return null;
                }));
                validMovies.push(...results.filter(Boolean));
                if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
            }
            movies = validMovies;
        }
        
        const sortBy = document.getElementById('sortByFilter') ? document.getElementById('sortByFilter').value : 'popularity.desc';
        if (sortBy === 'order.asc') {
            movies.sort((a, b) => {
                const orderA = a.order !== undefined ? a.order : 999;
                const orderB = b.order !== undefined ? b.order : 999;
                if (orderA === orderB) return b.popularity - a.popularity;
                return orderA - orderB;
            });
        } else if (sortBy.includes("vote_average")) {
            movies.sort((a, b) => b.vote_average - a.vote_average);
        } else if (sortBy.includes("primary_release_date")) {
            movies.sort((a, b) => {
                const dA = a.release_date || a.first_air_date;
                const dB = b.release_date || b.first_air_date;
                const dateA = dA ? new Date(dA).getTime() : 0;
                const dateB = dB ? new Date(dB).getTime() : 0;
                return sortBy.includes("desc") ? dateB - dateA : dateA - dateB;
            });
        } else {
            movies.sort((a, b) => b.popularity - a.popularity);
        }
        
        if (filterProvId > 0) {
            const regionStr = (filterProvId === 1899 || filterProvId === 384) ? 'US' : 'TR';
            const validMovies = [];
            const maxToCheck = Math.min(movies.length, 60);
            for (let i = 0; i < maxToCheck; i += 20) {
                const chunk = movies.slice(i, Math.min(i + 20, maxToCheck));
                const results = await Promise.all(chunk.map(async m => {
                    try {
                        const res = await fetch(`${BASE_URL}/${m.media_type}/${m.id}/watch/providers?api_key=${API_KEY}`, { signal: routeContext?.signal });
                        const data = await res.json();
                        const tr = data.results && data.results[regionStr] ? data.results[regionStr] : null;
                        if (tr && tr.flatrate && tr.flatrate.some(p => p.provider_id === filterProvId)) return m;
                    } catch (e) { if (e.name === 'AbortError') throw e; return null; }
                    return null;
                }));
                validMovies.push(...results.filter(Boolean));
                if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
            }
            movies = validMovies;
        }
        
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        const startIndex = (currentPage - 1) * 20;
        const endIndex = startIndex + 20;
        const pagedMovies = movies.slice(startIndex, endIndex);
        
        const container = document.getElementById('search-results');
        
        let bioCardHtml = "";
        if (reset) {
            let bioText = personData.biography ? personData.biography : "";
            const birthDate = personData.birthday ? new Date(personData.birthday).getFullYear() : "";
            const birthPlace = personData.place_of_birth || "";
            let bioHtml = "";
            if(birthDate || birthPlace) bioHtml += `<strong>Doğum:</strong> ${birthDate} ${birthPlace} <br>`;
            bioHtml += bioText;
            
            // Check if favorite
            let favs = JSON.parse(localStorage.getItem('favoriteActors') || '[]');
            const isFav = favs.some(a => a.id === currentActorId);
            const favText = isFav ? "Favorilerden Çıkar" : "Favorilere Ekle";
            const favClass = isFav ? "active" : "inactive";
            
            if (!isFilterChange) {
                if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
                container.innerHTML = "";
                if (bioText || birthDate || true) { // Always show bio card even if empty bio, to show favorite button
                    bioCardHtml = `
                    <div id="actor-bio-card-container" class="actor-bio-card" style="grid-column: 1 / -1; width: 100%; max-width: 800px; margin: 0 auto 20px auto; padding: 20px; background: var(--card-bg); border-radius: 15px; border: 1px solid var(--glass-border); color: var(--text-muted); font-size: 0.95rem;">
                        <div style="display:flex; align-items:flex-start; gap: 20px; margin-bottom: 10px;">
                            <img src="${personData.profile_path ? IMAGE_BASE + personData.profile_path : 'https://via.placeholder.com/60x90'}" style="width: 80px; height: 120px; border-radius: 10px; object-fit: cover; flex-shrink: 0; user-select: none; -webkit-user-drag: none;" loading="lazy">
                            <div style="flex: 1; min-width: 0;">
                                <div style="display:flex; justify-content: flex-start; align-items: center; margin-bottom: 10px; gap: 10px;">
                                    <h3 style="color: var(--text-color); margin: 0; font-size: 1.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: calc(100% - 60px);">${personData.name}</h3>
                                    <button id="modal-actor-fav-btn" class="btn-watchlist ${favClass}" style="position:relative; z-index:10; margin-top:0; flex-shrink:0; border-radius:50%; width:35px; height:35px; padding:0; display:flex; align-items:center; justify-content:center; border:none; cursor:pointer;" onclick="toggleActorFavorite(this, ${personData.id}, '${personData.name.replace(/'/g, "\\'")}', '${personData.profile_path}')">
                                        <i class="fas fa-heart" style="font-size:1.2rem;"></i>
                                    </button>
                                </div>
                                <div style="max-height: 110px; overflow-y: auto; padding-right: 5px;">
                                    ${bioHtml}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                    container.innerHTML = bioCardHtml;
                }
            }
        }
        
        if (isFilterChange) {
            if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
            const skels = container.querySelectorAll('.skeleton-card');
            skels.forEach(s => s.remove());
        }
        
        if (pagedMovies.length === 0 && reset) {
            const emptyMsg = filterProvId > 0 ? (jobType === 'Director' ? "Yönetmenin bu platformda içeriği yok." : "Oyuncunun bu platformda içeriği yok.") : "Seçtiğiniz filtrelere uygun yapım bulunamadı.";
            if (!isFilterChange) {
                container.innerHTML = `
                    <div id="actor-bio-card-container" style="margin-bottom:30px;">
                        ${bioCardHtml}
                    </div>
                    <div class='loading' style='margin-top:20px; text-align:center;'>${emptyMsg}</div>
                `;
            } else {
                const existingMsgs = container.querySelectorAll('.loading');
                existingMsgs.forEach(m => m.remove());
                container.insertAdjacentHTML('beforeend', `<div class='loading' style='margin-top:20px; text-align:center;'>${emptyMsg}</div>`);
            }
            container.style.minHeight = '';
            document.getElementById('loadMoreBtn').style.display = 'none';
            return;
        }
        
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        for (let i = 0; i < pagedMovies.length; i++) {
            container.insertAdjacentHTML('beforeend', createMovieCard(pagedMovies[i], pagedMovies[i].media_type, ""));
            fetchAndInjectProviders(pagedMovies[i].id, pagedMovies[i].media_type, null, routeContext);
        }
        
        if (endIndex < movies.length) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        } else {
            document.getElementById('loadMoreBtn').style.display = 'none';
        }
        
        container.style.minHeight = '';
        
    } catch (e) {
        if (e.name === 'AbortError') return;
        if (reset) document.getElementById('search-results').innerHTML = "<div class='loading'>Hata oluştu.</div>";
    } finally {
        const spinner = document.getElementById('infinite-spinner');
        if (spinner) spinner.style.display = 'none';
    }
}


let currentTooltipTimer = null;
function showActorTooltip(element, actorId) {
    if (currentTooltipTimer) clearTimeout(currentTooltipTimer);
    
    currentTooltipTimer = setTimeout(async () => {
        let tooltip = document.getElementById('global-actor-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'global-actor-tooltip';
            tooltip.className = 'actor-tooltip';
            document.body.appendChild(tooltip);
        }
        
        tooltip.innerHTML = "Yükleniyor...";
        
        // Calculate position
        const rect = element.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        tooltip.style.left = (rect.left + rect.width / 2) + 'px';
        tooltip.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
        tooltip.style.transform = 'translateX(-50%) translateY(0)';
        tooltip.classList.add('active');
        
        try {
            const [pRes, mRes] = await Promise.all([
                fetch(`${BASE_URL}/person/${actorId}?api_key=${API_KEY}&language=tr-TR`),
                fetch(`${BASE_URL}/person/${actorId}/combined_credits?api_key=${API_KEY}&language=tr-TR`)
            ]);
            
            const person = await pRes.json();
            const movies = await mRes.json();
            
            let ageHtml = "";
            if (person.birthday) {
                const birth = new Date(person.birthday);
                const end = person.deathday ? new Date(person.deathday) : new Date();
                const age = Math.floor((end - birth) / (365.25 * 24 * 60 * 60 * 1000));
                ageHtml = person.deathday ? `Vefat (${age} yaşında)` : `${age} Yaşında`;
            }
            
            const place = person.place_of_birth ? `<br>${person.place_of_birth.split(',').pop().trim()}` : "";
            
            const bestMovies = (movies.cast || []).sort((a,b) => b.popularity - a.popularity).slice(0, 3);
            let moviesHtml = "";
            bestMovies.forEach(m => {
                moviesHtml += `<li style="white-space: normal; overflow: visible;">• ${m.title || m.name}</li>`;
            });
            
            tooltip.innerHTML = `
                <h4>${person.name}</h4>
                <div class="tt-meta">${ageHtml} ${place}</div>
                ${moviesHtml ? `<ul style="padding: 0; list-style: none;">${moviesHtml}</ul>` : ''}
            `;
        } catch(e) {
            tooltip.innerHTML = "Bilgi alınamadı.";
        }
    }, 400);
}

function hideActorTooltip(element = null) {
    if (currentTooltipTimer) clearTimeout(currentTooltipTimer);
    const tooltip = document.getElementById('global-actor-tooltip');
    if (tooltip) {
        tooltip.classList.remove('active');
    }
}

// =========================================
// Sürükle Bırak Kaydırma (Drag to Scroll)
// =========================================
let isDown = false;
let startX;
let scrollLeft;
let slider = null;

document.addEventListener('mousedown', (e) => {
    const target = e.target.closest('.cast-list') || e.target.closest('.collection-list') || e.target.closest('#recently-viewed-grid');
    if (!target) return;
    
    isDown = true;
    slider = target;
    slider.classList.add('active');
    startX = e.pageX - slider.offsetLeft;
    scrollLeft = slider.scrollLeft;
});

document.addEventListener('mouseleave', () => {
    isDown = false;
    if(slider) slider.classList.remove('active');
});

document.addEventListener('mouseup', () => {
    isDown = false;
    if(slider) slider.classList.remove('active');
});

document.addEventListener('mousemove', (e) => {
    if (!isDown || !slider) return;
    e.preventDefault();
    const x = e.pageX - slider.offsetLeft;
    const walk = (x - startX) * 2; // Scroll-fast
    slider.scrollLeft = scrollLeft - walk;
});

// V19 Mega Update Functions

async function loadTrendingActors(routeContext = null, expectedPage = null) {
    const container = document.getElementById('trending-actors-list');
    if (!container) return;
    
    try {
        const promises = [];
        for(let p = 1; p <= 8; p++) {
            promises.push(fetch(`${BASE_URL}/person/popular?api_key=${API_KEY}&language=tr-TR&page=${p}`, { signal: routeContext?.signal }));
        }
        const responses = await Promise.all(promises);
        if (routeContext && expectedPage && !isRouteContextCurrent(routeContext, expectedPage)) return;
        
        let allActors = [];
        for(const res of responses) {
            const data = await res.json();
            if(data.results) allActors = allActors.concat(data.results);
        }
        
        let html = "";
        
        // Asya yapımı içeriklerle veya +18 (adult) içeriklerle tanınanları filtrele
        const filteredActors = allActors.filter(actor => {
            if (actor.adult) return false;
            
            // Eğer isminde Latin alfabesi (ve Türkçe karakterler) harici (Çince, Japonca, Kiril, Arapça vb.) bir harf varsa direkt ele
            if (!/^[-a-zA-Z0-9\s.,'şğüöçıŞĞÜÖÇİäöüßéèêëàâäôûçñ]+$/.test(actor.name)) return false;
            
            // Eğer bilinen yapımları (known_for) boşsa veya hiç yoksa, bu genelde gizli +18 oyuncusu olduğu anlamına gelir. Bunu da ele.
            if (!actor.known_for || actor.known_for.length === 0) return false;
            
            const hasAsianOrAdultContent = actor.known_for.some(m => {
                const lang = m.original_language;
                const isAsian = ['ko', 'ja', 'zh', 'cn', 'hi', 'th', 'vi', 'tl'].includes(lang);
                const isAdult = m.adult === true;
                return isAsian || isAdult;
            });
            return !hasAsianOrAdultContent;
        });
        
        // Remove duplicates just in case since we fetched 2 pages
        const uniqueActors = [];
        filteredActors.forEach(a => {
            if(!uniqueActors.find(ua => ua.id === a.id)) uniqueActors.push(a);
        });
        
        const actors = uniqueActors.slice(0, 20);
        
        actors.forEach(actor => {
            const profile = actor.profile_path ? IMAGE_BASE + actor.profile_path : 'https://via.placeholder.com/150x225?text=Yok';
            html += `
                <div class="story-item" onclick="openActorDetails(${actor.id}, '${actor.name.replace(/'/g, "\\'")}')">
                    <img src="${profile}" alt="${actor.name}" class="story-img" loading="lazy">
                    <div class="story-name" title="${actor.name}">${actor.name}</div>
                </div>
            `;
        });
        container.innerHTML = html;
        
        // Add auto-scroll
        let direction = 1;
        setInterval(() => {
            if(!container.classList.contains('active')) {
                container.scrollLeft += direction;
                if (container.scrollLeft >= (container.scrollWidth - container.clientWidth - 1)) {
                    direction = -1;
                } else if (container.scrollLeft <= 0) {
                    direction = 1;
                }
            }
        }, 30);
        
        // Add drag to scroll
        makeScrollable(container);
    } catch (e) {
        if (e.name === 'AbortError') return;
        container.innerHTML = "<div style='color:red'>Oyuncular yüklenemedi.</div>";
    }
}

async function loadCuratedCollections(routeContext = null, expectedPage = null) {
    const container = document.getElementById('curated-collections-list');
    if (!container) return;
    
    // True TMDB Collection IDs
    const collections = [
        { id: 86311, title: "Marvel Sinematik Evreni" },
        { id: 1241, title: "Harry Potter Serisi" },
        { id: 10, title: "Star Wars Efsanesi" },
        { id: 119, title: "Yüzüklerin Efendisi" },
        { id: 404609, title: "John Wick Serisi" },
        { id: 2344, title: "Matrix Serisi" },
        { id: 531241, title: "Spider-Man (MCU) Serisi" },
        { id: 119932, title: "Karanlık Şövalye Üçlemesi" },
        { id: 748, title: "X-Men Koleksiyonu" },
        { id: 9485, title: "Hızlı ve Öfkeli Serisi" },
        { id: 8735, title: "Görevimiz Tehlike Serisi" },
        { id: 131635, title: "Açlık Oyunları Serisi" },
        { id: 196419, title: "Labirent Serisi" },
        { id: 230, title: "Baba (Godfather) Serisi" },
        { id: 295, title: "Karayip Korsanları Serisi" },
        { id: 328, title: "Jurassic Park Serisi" },
        { id: 1703, title: "Alacakaranlık Efsanesi" },
        { id: 525, title: "Terminatör Serisi" },
        { id: 2150, title: "Shrek Serisi" },
        { id: 84, title: "Indiana Jones Serisi" },
        { id: 645, title: "James Bond Serisi" },
        { id: 10194, title: "Oyuncak Hikayesi Serisi" },
        { id: 87096, title: "Avatar Serisi" },
        { id: 133931, title: "Testere (Saw) Serisi" },
        { id: 8091, title: "Yaratık (Alien) Serisi" },
        { id: 1575, title: "Rocky Efsanesi" },
        { id: 8650, title: "Transformers Serisi" },
        { id: 264, title: "Geleceğe Dönüş Serisi" },
        { id: 8945, title: "Mad Max Serisi" },
        { id: 1570, title: "Zor Ölüm (Die Hard) Serisi" },
        { id: 86066, title: "Çılgın Hırsız Serisi" }
    ];
    
    const fetchPromises = collections.map(c => 
        fetch(`${BASE_URL}/collection/${c.id}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal })
            .then(res => res.json())
            .then(data => ({ data, c }))
            .catch((e) => { if (e.name === 'AbortError') throw e; return null; })
    );
    
    try {
        const results = await Promise.all(fetchPromises);
        if (routeContext && expectedPage && !isRouteContextCurrent(routeContext, expectedPage)) return;
    
    let html = "";
    for (let res of results) {
        if (res && res.data && res.data.parts && res.data.parts.length > 0) {
            const data = res.data;
            const c = res.c;
            const poster = data.backdrop_path ? BACKDROP_BASE + data.backdrop_path : (data.poster_path ? IMAGE_BASE + data.poster_path : 'https://via.placeholder.com/300x170?text=Koleksiyon');
            html += `
                <div class="movie-card" style="width: 250px; flex-shrink: 0; cursor:pointer;" onclick="openCollection(${data.id})">
                    <img src="${poster}" style="width: 100%; aspect-ratio: 16/9; object-fit: cover;" alt="${data.name}" loading="lazy">
                    <div class="movie-info">
                        <h4 style="margin: 10px 0; font-size:1.1rem; color:var(--text-color);">${c.title}</h4>
                        <p style="font-size:0.8rem; color:var(--text-muted);">${data.parts.length} Film</p>
                    </div>
                </div>
            `;
        }
    }
    
    container.innerHTML = html;
    
    // Add auto-scroll
    let direction = 1;
    setInterval(() => {
        if(!container.classList.contains('active')) {
            container.scrollLeft += direction;
            if (container.scrollLeft >= (container.scrollWidth - container.clientWidth - 1)) {
                direction = -1;
            } else if (container.scrollLeft <= 0) {
                direction = 1;
            }
        }
    }, 30);
    
    makeScrollable(container);
    } catch(e) {
        if (e.name === 'AbortError') return;
        console.error("Collections error:", e);
    }
}

async function openCollection(collectionId) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeDetails(null, true);
    currentMode = "search";
    currentPage = 1;
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
    document.getElementById('platform').classList.add('active-tab');
    document.getElementById('top10-section').style.display = 'none';
    const platformFilters = document.querySelector('.platform-filters');
    if (platformFilters) platformFilters.style.display = 'none';
    const filterControls = document.querySelector('.filter-controls');
    if (filterControls) filterControls.style.display = 'none';
    
    const container = document.getElementById('search-results');
    container.innerHTML = "";
    showSkeletons('search-results', 10);
    
    try {
        const res = await fetch(`${BASE_URL}/collection/${collectionId}?api_key=${API_KEY}&language=tr-TR`);
        const data = await res.json();
        
        let cleanName = data.name.replace(/\s*(Serisi|Koleksiyonu|Collection|Üçlemesi|Efsanesi|\[Seri\])$/gi, '').trim();
        
        container.innerHTML = `
            <div style="grid-column: 1/-1; margin-bottom: 20px; background:var(--card-bg); padding:20px; border-radius:15px; border:1px solid var(--glass-border);">
                <h2 style="color:var(--primary-color); font-size: 2rem; margin-bottom:10px;">${cleanName}</h2>
                <p style="color:var(--text-muted); font-size:1.1rem;">${data.overview || ''}</p>
            </div>
        `;
        
        let html = "";
        
        // Sort by release_date
        data.parts.sort((a, b) => {
            const d1 = new Date(a.release_date || "2100-01-01");
            const d2 = new Date(b.release_date || "2100-01-01");
            return d1 - d2;
        });
        
        data.parts.forEach(item => {
            html += createMovieCard(item, 'movie', "");
        });
        container.innerHTML += html;
        
        data.parts.forEach(item => {
            fetchAndInjectProviders(item.id, 'movie', item);
        });
    } catch (e) {
        container.innerHTML = "<div style='color:red'>Hata oluştu.</div>";
    }
}

function toggleActorFavorite(btnElem, actorId, actorName, profilePath) {
    let favs = JSON.parse(localStorage.getItem('favoriteActors') || '[]');
    const existingIndex = favs.findIndex(a => a.id === actorId);
    
    if (existingIndex > -1) {
        favs.splice(existingIndex, 1);
        if (btnElem) {
            btnElem.classList.remove('active', 'inactive');
            btnElem.classList.add('inactive');
            if(btnElem.id === "modal-actor-fav-btn") {
                btnElem.innerHTML = '<i class="fas fa-heart" style="font-size:1.2rem;"></i>';
            }
        }
    } else {
        favs.push({ id: actorId, name: actorName, profile_path: profilePath });
        if (btnElem) {
            btnElem.classList.remove('active', 'inactive');
            btnElem.classList.add('active');
            if(btnElem.id === "modal-actor-fav-btn") {
                btnElem.innerHTML = '<i class="fas fa-heart" style="font-size:1.2rem;"></i>';
            }
        }
    }
    
    localStorage.setItem('favoriteActors', JSON.stringify(favs));
    
    // Refresh profile grid if open
    if (document.getElementById('profile') && document.getElementById('profile').classList.contains('active-tab')) {
        loadProfile();
    }
}

function makeScrollable(container) {
    if (!container || container.dataset.isScrollable) return;
    container.dataset.isScrollable = "true";
    
    let isDown = false;
    let startX;
    let scrollLeft;
    let isDragging = false;

    container.addEventListener('mousedown', (e) => {
        isDown = true;
        isDragging = false;
        container.classList.add('active');
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
    });
    container.addEventListener('mouseleave', () => {
        isDown = false;
        container.classList.remove('active');
    });
    container.addEventListener('mouseup', () => {
        isDown = false;
        container.classList.remove('active');
    });
    container.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 2;
        if (Math.abs(walk) > 5) isDragging = true;
        container.scrollLeft = scrollLeft - walk;
    });
    container.addEventListener('click', (e) => {
        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
}

// Discover Modal Events (Replaced with Inline Panel)
document.addEventListener('DOMContentLoaded', () => {
    // Legacy support if needed
});

function toggleAdvancedSearch() {
    const panel = document.getElementById('advanced-search-panel');
    const btn = document.getElementById('advanced-toggle-btn');
    if (panel) {
        if (panel.style.display === 'none' || panel.style.display === '') {
            panel.style.display = 'block';
            panel.classList.remove('closing');
            if (btn) btn.classList.add('active');
        } else if (!panel.classList.contains('closing')) {
            panel.classList.add('closing');
            setTimeout(() => {
                panel.style.display = 'none';
                panel.classList.remove('closing');
                if (btn) btn.classList.remove('active');
            }, 300);
        }
    }
}

async function executeDiscover() {
    const type = document.getElementById('discover-type').value;
    const yearMin = document.getElementById('discover-year-min').value;
    const yearMax = document.getElementById('discover-year-max').value;
    const rating = document.getElementById('discover-rating').value;
    
    const checkboxes = document.querySelectorAll('.discover-genre-cb:checked');
    const genreIds = Array.from(checkboxes).map(cb => cb.value).join(',');
    
    let query = `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=tr-TR&vote_average.gte=${rating}`;
    if (yearMin) query += `&primary_release_date.gte=${yearMin}-01-01`;
    if (yearMax) query += `&primary_release_date.lte=${yearMax}-12-31`;
    if (genreIds) query += `&with_genres=${genreIds}`;
    
    // Check if a platform is currently selected
    if (currentProvider > 0) {
        query += `&with_watch_providers=${currentProvider}&watch_region=TR`;
    }
    
    toggleAdvancedSearch(); // Close the panel after search
    
    // Setup UI for results
    currentMode = "search";
    currentPage = 1;
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
    document.getElementById('platform').classList.add('active-tab');
    
    document.getElementById('top10-section').style.display = 'none';
    const container = document.getElementById('search-results');
    container.innerHTML = "";
    showSkeletons('search-results', 20);
    
    try {
        const res = await fetch(query);
        const data = await res.json();
        
        container.innerHTML = "";
        
        if (data.results.length === 0) {
            container.innerHTML = "<div class='no-provider'>Sonuç bulunamadı. Lütfen filtreleri gevşetin.</div>";
            return;
        }
        
        let html = `<h2 style="grid-column: 1/-1; margin-bottom: 20px;">Keşif Sonuçları</h2>`;
        data.results.forEach(item => {
            html += createMovieCard(item, type, "");
        });
        container.innerHTML = html;
        
        data.results.forEach(item => {
            fetchAndInjectProviders(item.id, type, item);
        });
    } catch (e) {
        console.error("executeDiscover error:", e);
        if (reset) {
            const container = document.getElementById('search-results');
            container.innerHTML = `<div class='no-provider' style='color:red;'>Keşfet Hatası: ${e.message}</div>`;
        }
    }
}

// --- MINI OYUN (AFİŞTEN TAHMİN) ---
let currentGameMovie = null;
let currentGameOptions = [];
let gameAttempts = 0;
let gameScoreCorrect = 0;
let gameScoreWrong = 0;

let playedGameMovies = [];

async function startNewGame() {
    document.getElementById('game-start-btn').style.display = 'none';
    const nextBtn = document.getElementById('game-next-btn');
    if(nextBtn) nextBtn.style.display = 'none';
    document.getElementById('game-container').style.display = 'none';
    document.getElementById('game-loading').style.display = 'block';
    document.getElementById('game-result').innerHTML = '';
    document.getElementById('clue-1').style.display = 'none';
    document.getElementById('clue-2').style.display = 'none';
    document.getElementById('game-poster').style.filter = 'blur(25px)';
    
    const overlayText = document.getElementById('game-overlay-text');
    if (overlayText) overlayText.style.display = 'none';
    gameAttempts = 0;

    document.getElementById('game-score-board').style.display = 'flex';
    document.getElementById('game-score-correct').innerText = gameScoreCorrect;
    document.getElementById('game-score-wrong').innerText = gameScoreWrong;

    try {
        // Rastgele 1-10 arası popüler film sayfası
        const randomPage = Math.floor(Math.random() * 20) + 1;
        const res = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&page=${randomPage}&vote_count.gte=500&with_original_language=en|tr&sort_by=popularity.desc`);
        const data = await res.json();
        
        let shuffled = data.results.filter(m => !playedGameMovies.includes(m.id)).sort(() => 0.5 - Math.random());
        
        if (shuffled.length === 0) {
            // Eğer o sayfadaki tüm filmler oynanmışsa listeyi sıfırla
            playedGameMovies = [];
            shuffled = data.results.sort(() => 0.5 - Math.random());
        }
        
        currentGameMovie = shuffled[0];
        currentGameMovie.media_type = 'movie';
        window.movieCache[currentGameMovie.id] = currentGameMovie;
        playedGameMovies.push(currentGameMovie.id);
        
        let allOptions = data.results.filter(m => m.id !== currentGameMovie.id).sort(() => 0.5 - Math.random()).slice(0, 3);
        allOptions.push(currentGameMovie);
        currentGameOptions = allOptions.sort(() => 0.5 - Math.random());

        // Posteri yükle (Dikey afiş tercih et)
        const posterUrl = currentGameMovie.poster_path ? IMAGE_BASE + currentGameMovie.poster_path : (currentGameMovie.backdrop_path ? BACKDROP_BASE + currentGameMovie.backdrop_path : '');
        const posterEl = document.getElementById('game-poster');
        posterEl.src = posterUrl;
        posterEl.onclick = null;
        posterEl.style.cursor = 'default';

        // İpuçlarını hazırla
        const releaseYear = currentGameMovie.release_date ? currentGameMovie.release_date.split('-')[0] : 'Bilinmiyor';
        document.getElementById('clue-1').innerHTML = `<i class='far fa-calendar-alt'></i> Yıl: ${releaseYear}`;
        
        // Oyuncu ipucunu çek
        const castRes = await fetch(`${BASE_URL}/movie/${currentGameMovie.id}/credits?api_key=${API_KEY}&language=tr-TR`);
        const castData = await castRes.json();
        if(castData.cast && castData.cast.length > 0) {
            document.getElementById('clue-2').innerHTML = `<i class='fas fa-user'></i> Oyuncu: ${castData.cast[0].name}`;
        } else {
            document.getElementById('clue-2').innerHTML = `<i class='fas fa-star'></i> Puan: ${currentGameMovie.vote_average}`;
        }

        // Seçenekleri ekrana bas
        const optionsContainer = document.getElementById('game-options');
        optionsContainer.innerHTML = '';
        currentGameOptions.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'game-option-btn';
            btn.innerText = opt.title;
            btn.onclick = () => makeGameGuess(opt.id, btn);
            optionsContainer.appendChild(btn);
        });

        document.getElementById('game-loading').style.display = 'none';
        document.getElementById('game-container').style.display = 'block';

        // Oyun yüklendikten sonra kaydırma yap (Başlığı gizle, afişe odakla)
        setTimeout(() => {
            const container = document.getElementById('game-container');
            if(container) container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    } catch (err) {
        console.error(err);
        document.getElementById('game-loading').innerHTML = 'Oyun yüklenirken hata oluştu.';
    }
}

function makeGameGuess(guessedId, btn) {
    if(guessedId === currentGameMovie.id) {
        // Doğru Bildi!
        btn.style.background = '#4CAF50';
        btn.style.borderColor = '#4CAF50';
        document.getElementById('game-result').innerHTML = '<span style="color:#4CAF50"><i class="fas fa-check-circle"></i> Doğru Bildin!</span>';
        document.getElementById('game-poster').style.filter = 'blur(0px)';
        const posterEl = document.getElementById('game-poster');
        posterEl.style.cursor = 'pointer';
        posterEl.onclick = () => openDetails(currentGameMovie.id, currentGameMovie.media_type || 'movie');
        
        document.getElementById('clue-1').style.display = 'inline-block';
        document.getElementById('clue-2').style.display = 'inline-block';
        const overlayText = document.getElementById('game-overlay-text');
        if (overlayText) {
            overlayText.innerHTML = currentGameMovie.title;
            overlayText.style.display = 'block';
            overlayText.style.fontSize = '1.2rem';
            overlayText.style.background = 'rgba(0,0,0,0.7)';
            overlayText.style.padding = '8px 15px';
            overlayText.style.borderRadius = '10px';
            overlayText.style.top = '85%';
            overlayText.style.textShadow = 'none';
            overlayText.style.width = 'max-content';
            overlayText.style.maxWidth = '90%';
            overlayText.style.textAlign = 'center';
        }
        
        gameScoreCorrect++;
        document.getElementById('game-score-correct').innerText = gameScoreCorrect;

        // Diğer butonları devre dışı bırak
        Array.from(document.getElementById('game-options').children).forEach(b => b.disabled = true);
        
        const nextBtn = document.getElementById('game-next-btn');
        if(nextBtn) {
            nextBtn.style.display = 'block';
        }
    } else {
        // Yanlış Bildi
        btn.style.background = '#f44336';
        btn.style.borderColor = '#f44336';
        btn.disabled = true;
        gameAttempts++;
        
        if(gameAttempts === 1) {
            document.getElementById('game-result').innerHTML = '<span style="color:#f44336"><i class="fas fa-times-circle"></i> Yanlış! 1. İpucu açıldı.</span>';
            document.getElementById('clue-1').style.display = 'inline-block';
        } else if(gameAttempts === 2) {
            document.getElementById('game-result').innerHTML = '<span style="color:#f44336"><i class="fas fa-times-circle"></i> Yanlış! 2. İpucu açıldı.</span>';
            document.getElementById('clue-2').style.display = 'inline-block';
        } else {
            // Kaybetti
            document.getElementById('game-result').innerHTML = '<span style="color:#f44336"><i class="fas fa-skull-crossbones"></i> Bilemedin! Cevap: ' + currentGameMovie.title + '</span>';
            const posterEl = document.getElementById('game-poster');
            posterEl.style.filter = 'blur(0px)';
            posterEl.style.cursor = 'pointer';
            posterEl.onclick = () => openDetails(currentGameMovie.id, currentGameMovie.media_type || 'movie');
            
            const overlayText = document.getElementById('game-overlay-text');
            if (overlayText) overlayText.style.display = 'none';
            
            gameScoreWrong++;
            document.getElementById('game-score-wrong').innerText = gameScoreWrong;

            // Doğru olanı yeşil yap
            Array.from(document.getElementById('game-options').children).forEach(b => {
                b.disabled = true;
                if(b.innerText === currentGameMovie.title) {
                    b.style.background = '#4CAF50';
                }
            });
            // Otomatik geçiş kaldırıldı, kullanıcı next butonuna basacak.
            const nextBtn = document.getElementById('game-next-btn');
            if(nextBtn) {
                nextBtn.style.display = 'block';
            }
        }
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

// =========================================
// MOBILE HAMBURGER MENU
// =========================================
function toggleMobileMenu() {
    const menuToggle = document.getElementById('mobile-menu');
    const navLinks = document.querySelector('.nav-links');
    if (menuToggle && navLinks) {
        menuToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
    }
}

// Close mobile menu when a nav link is clicked
document.querySelectorAll('.nav-links li a, .nav-links li button').forEach(link => {
    link.addEventListener('click', () => {
        const menuToggle = document.getElementById('mobile-menu');
        const navLinks = document.querySelector('.nav-links');
        if (menuToggle && menuToggle.classList.contains('active')) {
            menuToggle.classList.remove('active');
            navLinks.classList.remove('active');
        }
    });
});

// =========================================
// CUSTOM SELECTS INITIALIZATION
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    const selects = document.querySelectorAll('select.premium-dropdown, select.premium-city-select, select.modern-select');
    selects.forEach(select => {
        if (select.classList.contains('custom-select-hidden')) return;
        
        select.classList.add('custom-select-hidden');
        
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-container';
        if (select.style.width === '100%' || select.classList.contains('modern-select')) wrapper.classList.add('full-width');
        
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        
        const selectedOption = select.options[select.selectedIndex];
        let triggerText = selectedOption ? selectedOption.text : "Seçiniz...";
        
        trigger.innerHTML = `<span>${triggerText}</span> <i class="fas fa-chevron-down"></i>`;
        
        const optionsWrapper = document.createElement('div');
        optionsWrapper.className = 'custom-options-wrapper';
        
        Array.from(select.options).forEach((option, index) => {
            if (option.disabled && option.value === "") return;
            
            const customOption = document.createElement('div');
            customOption.className = 'custom-option';
            if (index === select.selectedIndex) customOption.classList.add('selected');
            customOption.textContent = option.text;
            customOption.dataset.value = option.value;
            if (option.hidden) customOption.style.display = 'none';
            
            customOption.addEventListener('click', function(e) {
                e.stopPropagation();
                select.value = this.dataset.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof select.onchange === 'function') {
                    select.onchange(new Event('change'));
                }
                
                trigger.querySelector('span').textContent = this.textContent;
                optionsWrapper.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                this.classList.add('selected');
                wrapper.classList.remove('open');
            });
            optionsWrapper.appendChild(customOption);
        });
        
        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.custom-select-container').forEach(c => {
                if (c !== wrapper) c.classList.remove('open');
            });
            wrapper.classList.toggle('open');
        });
        
        wrapper.appendChild(trigger);
        wrapper.appendChild(optionsWrapper);
        select.parentNode.insertBefore(wrapper, select.nextSibling);
    });
    
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-container').forEach(c => {
            c.classList.remove('open');
        });
    });
});


// =========================================
// AKILLI NER ALGORTMASI (Puanlananlara Gre)
// =========================================
async function loadSmartRecommendations(routeContext = null, expectedPage = null) {
    let rated = JSON.parse(localStorage.getItem('ratedMovies')) || [];
    let ratings = JSON.parse(localStorage.getItem('movieRatings')) || {};
    
    if (rated.length === 0) {
        document.getElementById('smart-recommendations-section').style.display = 'block';
        document.getElementById('smart-recommendations-list').innerHTML = "<p style='color:var(--text-muted); width:100%; text-align:center; padding:20px; grid-column: 1/-1;'>Henüz hiç film puanlamadınız. Profilinize gidip izlediğiniz filmlere puan vererek size özel öneriler alabilirsiniz.</p>";
        return;
    }
    
    document.getElementById('smart-recommendations-section').style.display = 'block';
    showSkeletons('smart-recommendations-list', 14);
    
    try {
        // En yüksek puanlanan 5 filmi al
        let ratedWithScores = rated.map(m => ({ ...m, user_rating: ratings[m.id] || 5 }));
        ratedWithScores.sort((a, b) => b.user_rating - a.user_rating);
        let topMovies = ratedWithScores.slice(0, 5);
        
        let recommendedMovies = [];
        for (let movie of topMovies) {
            let mediaType = movie.media_type || 'movie';
            let res = await fetch(`${BASE_URL}/${mediaType}/${movie.id}/recommendations?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
            let data = await res.json();
            if (data.results) {
                recommendedMovies.push(...data.results);
            }
        }
        
        // Belgeselleri, making-of içerikleri ve yetişkin içerikleri filtrele
        const blockedGenres = [99, 10767, 10763, 10764];
        const blockedTitleWords = ["making of", "behind the scenes", "assembled", "the making", "xxx", "erotic", "sex"];
        recommendedMovies = recommendedMovies.filter(m => {
            if (m.genre_ids && blockedGenres.some(g => m.genre_ids.includes(g))) return false;
            const title = (m.title || m.name || "").toLowerCase();
            if (blockedTitleWords.some(w => title.includes(w))) return false;
            if (!m.poster_path) return false;
            if (m.adult) return false;
            if ((m.vote_average || 0) < 5.0) return false;
            return true;
        });
        
        // Tekrarları ve zaten puanlanmış filmleri kaldır
        const seen = new Set();
        recommendedMovies = recommendedMovies.filter(m => {
            const isDup = seen.has(m.id);
            seen.add(m.id);
            return !isDup && !ratings[m.id];
        });
        
        // Kaliteye göre sırala (puan * log(oy sayısı))
        recommendedMovies.sort((a, b) => {
            const scoreA = (a.vote_average || 0) * Math.log10((a.vote_count || 0) + 1);
            const scoreB = (b.vote_average || 0) * Math.log10((b.vote_count || 0) + 1);
            return scoreB - scoreA;
        });
        
        let finalMovies = recommendedMovies.slice(0, 14);
        
        // Eğer 14'ten az çıktıysa, popüler ve yüksek puanlı filmlerle doldur
        if (finalMovies.length < 14) {
            let res = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&sort_by=vote_average.desc&vote_count.gte=1000&without_genres=99`, { signal: routeContext?.signal });
            let data = await res.json();
            if (data.results) {
                let extra = data.results.filter(m => !seen.has(m.id) && !ratings[m.id] && m.poster_path && !m.adult && m.vote_average >= 7.0);
                finalMovies.push(...extra.slice(0, 14 - finalMovies.length));
            }
        }
        
        let html = '';
        finalMovies.forEach(item => {
            html += createMovieCard(item, item.media_type || 'movie', 'smart');
        });
        
        if (routeContext && expectedPage && !isRouteContextCurrent(routeContext, expectedPage)) return;
        
        document.getElementById('smart-recommendations-list').innerHTML = html;
    } catch(e) {
        if (e.name === 'AbortError') return;
        console.error("Smart Recommendation error", e);
    }
}

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
