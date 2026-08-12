
const API_KEY = "24e682394f9c71a770ddae8f3686036e";
const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

let genreMap = {}; 
let currentCity = ""; 
window.movieCache = {}; // Hata Çözümü: Filmleri hafızada tutarız (Tırnak çakışmasını engeller)

let currentProvider = 0; // 0 = Hepsi
let currentPage = 1;
let currentMode = "platform"; // "platform", "search", "actor", "mother"
let currentSearchQuery = "";
let currentActorId = 0;
let currentJobType = "cast";

document.addEventListener('DOMContentLoaded', () => {
    // Sayfa yenilendiğinde en üste scroll at
    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'auto' });
    }, 10);
});

window.addEventListener('load', () => {
    setTimeout(() => {
        window.scrollTo(0, 0);
    }, 100);
});

function toggleSelectVisibility(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = show ? 'inline-block' : 'none';
    const wrapper = el.nextElementSibling;
    if (wrapper && wrapper.classList.contains('custom-select-container')) {
        wrapper.style.display = show ? 'inline-block' : 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // V5 Theme check
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
        if(document.getElementById('themeToggleBtn')) document.getElementById('themeToggleBtn').innerHTML = '<i class="fas fa-moon"></i>';
    }
    
    // Load default tab
    loadNowPlaying();
    loadGenres();
    loadTop10Trending();
    loadTrendingActors();
    loadCuratedCollections();
    renderRecentlyViewed();
    
    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
        const box = document.getElementById('autocomplete-box');
        const input = document.getElementById('searchInput');
        if (box && input && e.target !== input && e.target !== box && !box.contains(e.target)) {
            box.style.display = 'none';
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

    handleDeepLink();

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

function showSkeletons(containerId, count = 10) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let html = '';
    for(let i=0; i<count; i++) {
        html += `
            <div class="movie-card" style="border:none; background:transparent;">
                <div class="skeleton" style="width:100%; height:300px; border-radius:10px;"></div>
                <div class="skeleton" style="width:80%; height:20px; margin-top:10px;"></div>
                <div class="skeleton" style="width:50%; height:15px; margin-top:5px;"></div>
            </div>
        `;
    }
    container.innerHTML = html;
}

async function handleDeepLink() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#film/')) {
        const id = hash.replace('#film/', '');
        if (!window.movieCache[id]) {
            try {
                let res = await fetch(`${BASE_URL}/movie/${id}?api_key=${API_KEY}&language=tr-TR`);
                let data = await res.json();
                if (data.status_code === 34) {
                    res = await fetch(`${BASE_URL}/tv/${id}?api_key=${API_KEY}&language=tr-TR`);
                    data = await res.json();
                    data.title = data.name;
                    data.media_type = "tv";
                } else {
                    data.media_type = "movie";
                }
                if (data.id) {
                    window.movieCache[id] = data;
                }
            } catch (e) {
                console.error("Deep link fetch error", e);
            }
        }
        if (window.movieCache[id]) {
            openDetails(id);
        }
    }
}

function resetPlatformView() {
    document.getElementById('searchInput').value = "";
    
    // Fallbacks for removed filters
    const gF = document.getElementById('genreFilter');
    if (gF) gF.value = "";
    
    const mT = document.getElementById('mediaTypeFilter');
    if (mT) mT.value = "all";
    
    const rF = document.getElementById('ratingFilter');
    if (rF) rF.value = "0";
    
    const sB = document.getElementById('sortByFilter');
    if (sB) sB.value = "popularity.desc";
    
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
    
    loadPlatformMovies(0, true);
}

function switchViewMode(mode) {
    const container = document.getElementById('search-results');
    const nowPlayingContainer = document.getElementById('now-playing-grid');
    const vizyonContainer = document.getElementById('vizyon-grid');
    const watchlistContainer = document.getElementById('watchlist-grid');
    
    if(document.getElementById('viewGridBtn')) document.getElementById('viewGridBtn').classList.remove('active');
    if(document.getElementById('viewListBtn')) document.getElementById('viewListBtn').classList.remove('active');
    
    if (mode === 'list') {
        if(container) container.classList.add('list-view');
        if(document.getElementById('viewListBtn')) document.getElementById('viewListBtn').classList.add('active');
    } else {
        if(container) container.classList.remove('list-view');
        if(document.getElementById('viewGridBtn')) document.getElementById('viewGridBtn').classList.add('active');
    }
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    if(document.getElementById('themeToggleBtn')) {
        document.getElementById('themeToggleBtn').innerHTML = isLight ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
    }
    window.dispatchEvent(new Event('scroll'));
}

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

async function loadTop10Trending() {
    try {
        const res = await fetch(`${BASE_URL}/trending/all/week?api_key=${API_KEY}&language=tr-TR`);
        const data = await res.json();
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
    clearAllFilters();
    toggleSelectVisibility('providerFilter', false);
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
    document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));

    document.getElementById(tabId).classList.add('active-tab');
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }

    if (tabId === 'now-playing') {
        loadNowPlaying();
    } else if (tabId === 'vizyon') {
        loadUpcomingMovies();
    } else if (tabId === 'platform') {
        resetPlatformView();
    } else if (tabId === 'profile') {
        loadProfile();
    }
}

function updateCity() {
    currentCity = document.getElementById('citySelect').value;
}

function buyTicket(movieId) {
    if (!currentCity) {
        alert("Lütfen önce yukarıdan şehrinizi seçin!");
        document.getElementById('citySelect').focus();
        return;
    }
    const movie = window.movieCache[movieId];
    if (!movie) return;
    
    // Biletinial yönlendirme
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(currentCity + ' ' + movie.title + ' bilet al')}`;
    window.open(searchUrl, '_blank');
}


