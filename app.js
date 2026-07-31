// =========================================
// API Ayarları
// =========================================
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
                        <img src="${poster}" alt="${title}" style="width: 100%; height: 210px; object-fit: cover; border-radius: 10px; box-shadow: 0 5px 15px rgba(0,0,0,0.5);">
                    </div>
                `;
            }).join('');
            makeScrollable(container);
        }
    } catch (e) {
        console.error("Top 10 fetching failed", e);
    }
}

async function fetchRandomMovie() {
    const genre = document.getElementById('randomGenreSelect').value;
    const btn = document.querySelector('#random-modal .btn-buy-ticket');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Aranıyor...';
    btn.disabled = true;

    try {
        const randomPage = Math.floor(Math.random() * 50) + 1; 
        const genreQuery = genre ? `&with_genres=${genre}` : '';
        const res = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&page=${randomPage}&vote_count.gte=500&sort_by=popularity.desc${genreQuery}`);
        const data = await res.json();
        const randomMovie = data.results[Math.floor(Math.random() * data.results.length)];
        
        if (randomMovie) {
            randomMovie.media_type = "movie";
            window.movieCache[randomMovie.id] = randomMovie;
            closeRandom(null, true);
            openDetails(randomMovie.id);
        } else {
            alert('Bu kritere uygun film bulunamadı, lütfen tekrar deneyin!');
        }
    } catch (e) {
        console.error(e);
        alert('Rastgele film seçilirken hata oluştu.');
    } finally {
        btn.innerHTML = '<i class="fas fa-magic"></i> Bana Öner!';
        btn.disabled = false;
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

// =========================================
// Kart Oluşturma Ortak Fonksiyonu
// =========================================
function createMovieCard(item, mediaType = "movie", tabContext = "") {
    const title = item.title || item.name;
    const year = (item.release_date || item.first_air_date || "").split('-')[0];
    const titleWithYear = year ? `${title} (${year})` : title;
    
    const poster = item.poster_path ? IMAGE_BASE + item.poster_path : 'https://via.placeholder.com/500x750?text=Afiş+Yok';
    const rating = item.vote_average ? item.vote_average.toFixed(1) : "N/A";
    
    const genres = (item.genre_ids || []).map(id => genreMap[id]).filter(Boolean).slice(0, 2).join(', ');

    let watchlist = JSON.parse(localStorage.getItem('watchlist')) || [];
    const isSaved = watchlist.find(w => w.id === item.id) ? "active" : "";

    // Hata Çözümü: Veriyi string yapmak yerine objeye atıyoruz
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
        media_type: mediaType
    };

    let dateOrProviderHtml = "";
    if (tabContext === "upcoming" && item.release_date) {
        const d = new Date(item.release_date);
        const formattedDate = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
        dateOrProviderHtml = `<div class="movie-date" style="color:var(--primary-color)">Vizyon: ${formattedDate}</div>`;
    } else {
        dateOrProviderHtml = `<div class="movie-date providers-container providers-${item.id}"><span style="font-size:0.8rem; color:var(--text-muted)">Platformlar aranıyor...</span></div>`;
    }

    let buyTicketHtml = "";
    if (tabContext === "now-playing" && mediaType === "movie") {
        buyTicketHtml = `<button class="action-btn btn-buy-ticket-card" onclick="buyTicket(${item.id})"><i class="fas fa-ticket-alt"></i> Bilet Al</button>`;
    }

    const mediaBadgeLabel = mediaType === "tv" ? "Dizi" : "Film";

    return `
        <div class="movie-card" style="position:relative">
            <div class="media-type-badge">${mediaBadgeLabel}</div>
            <button class="btn-heart ${isSaved}" onclick="toggleWatchlist(this, ${item.id})" title="Listeme Ekle/Çıkar">
                <i class="fas fa-heart"></i>
            </button>
            <img src="${poster}" alt="${title}" class="movie-poster" style="cursor:pointer" onclick="openDetails(${item.id})"
                onmouseenter="startHoverSlideshow(this, ${item.id})" 
                onmouseleave="stopHoverSlideshow(this, '${poster}')">
            <div class="movie-info">
                <div class="movie-meta">
                    <span class="genre-list">${genres}</span>
                </div>
                <div class="movie-title" title="${title}" style="cursor:pointer" onclick="openDetails(${item.id})">${titleWithYear}</div>
                <div class="bottom-group" style="margin-top: auto; display: flex; flex-direction: column; gap: 10px; padding-top: 10px;">
                    ${dateOrProviderHtml}
                    <div class="card-actions">
                        <button class="action-btn btn-trailer" onclick="openTrailer(${item.id}, '${mediaType}')">
                            <i class="fas fa-play"></i> Fragman
                        </button>
                        ${buyTicketHtml}
                    </div>
                </div>
            </div>
        </div>
    `;
}

let hoverSlideshowTimer = null;
let hoverSlideshowInterval = null;
async function startHoverSlideshow(imgElement, movieId) {
    if (!movieId) return;
    
    hoverSlideshowTimer = setTimeout(async () => {
        imgElement.style.transition = "none";
        
        let images = [imgElement.src];
        
        if (movieId) {
            if (!window.movieImagesCache) window.movieImagesCache = {};
            if (!window.movieImagesCache[movieId]) {
                try {
                    const item = window.movieCache[movieId];
                    const type = item ? (item.media_type || 'movie') : 'movie';
                    const res = await fetch(`${BASE_URL}/${type}/${movieId}/images?api_key=${API_KEY}`);
                    const data = await res.json();
                    const extraImages = (data.backdrops || []).slice(0, 5).map(b => BACKDROP_BASE + b.file_path);
                    if (extraImages.length > 0) {
                        images = extraImages;
                    }
                    window.movieImagesCache[movieId] = images;
                } catch (e) {}
            } else {
                images = window.movieImagesCache[movieId];
            }
        }
        
        if (images.length > 0) {
            imgElement.style.objectFit = 'contain';
            imgElement.style.backgroundColor = 'black';
            let index = 0;
            imgElement.src = images[index];
            if (images.length > 1) {
                hoverSlideshowInterval = setInterval(() => {
                    index = (index + 1) % images.length;
                    imgElement.src = images[index];
                }, 1500);
            }
        }
    }, 600); // 600ms hover delay
}

function stopHoverSlideshow(imgElement, originalSrc) {
    if (hoverSlideshowTimer) {
        clearTimeout(hoverSlideshowTimer);
        hoverSlideshowTimer = null;
    }
    if (hoverSlideshowInterval) {
        clearInterval(hoverSlideshowInterval);
        hoverSlideshowInterval = null;
    }
    if (imgElement.src !== originalSrc) {
        imgElement.src = originalSrc;
        imgElement.style.transition = "transform 0.3s ease";
        imgElement.style.objectFit = 'cover';
        imgElement.style.backgroundColor = 'transparent';
    }
}

async function fetchAndInjectProviders(itemId, mediaType, itemData = null) {
    if (!mediaType || mediaType === "undefined") {
        if (itemData && (itemData.first_air_date || itemData.name)) {
            mediaType = "tv";
        } else {
            mediaType = "movie";
        }
    }
    try {
        const res = await fetch(`${BASE_URL}/${mediaType}/${itemId}/watch/providers?api_key=${API_KEY}`);
        const data = await res.json();
        const tr = data.results && data.results.TR ? data.results.TR : null;
        
        const els = document.querySelectorAll(`.providers-${itemId}`);
        if (els.length === 0) return;

        if (tr && tr.flatrate) {
            let html = "";
            tr.flatrate.slice(0,3).forEach(p => {
                html += `<img src="${IMAGE_BASE}${p.logo_path}" alt="${p.provider_name}" class="provider-logo" title="${p.provider_name}">`;
            });
            els.forEach(el => el.innerHTML = html);
        } else {
            els.forEach(el => el.innerHTML = "<span class='no-provider'>Türkiye'de yayını yok</span>");
        }
    } catch (err) {
        console.error("Provider bilgisi alınamadı", err);
        const els = document.querySelectorAll(`.providers-${itemId}`);
        els.forEach(el => el.innerHTML = "<span class='no-provider'>Platform bilgisi alınamadı</span>");
    }
}

async function loadNowPlaying() {
    const container = document.getElementById('now-playing-grid');
    if(document.getElementById('top10-section')) document.getElementById('top10-section').style.display = 'block';
    if(document.getElementById('collections-section')) document.getElementById('collections-section').style.display = 'block';
    if(document.getElementById('trending-actors-section')) document.getElementById('trending-actors-section').style.display = 'block';

    if (container.children.length > 0) return;
    
    showSkeletons('now-playing-grid', 10);
    container.style.display = "";
    container.innerHTML = "<div class='loading'>Vizyondaki filmler çekiliyor...</div>";
    try {
        const res = await fetch(`${BASE_URL}/movie/now_playing?api_key=${API_KEY}&language=tr-TR&region=TR&page=1`);
        const data = await res.json();
        container.innerHTML = "";
        data.results.forEach(movie => {
            container.innerHTML += createMovieCard(movie, "movie", "now-playing");
        });
        
        // Fetch providers for each movie after rendering cards
        data.results.forEach(movie => {
            fetchAndInjectProviders(movie.id, "movie");
        });
    } catch (error) {
        container.innerHTML = "<div class='loading'>Hata oluştu.</div>";
    }
}

async function loadUpcomingMovies() {
    const container = document.getElementById('upcoming-movies');
    if (container.children.length > 1) return; 
    
    container.style.display = "";
    container.innerHTML = "<div class='loading'>Gelecek filmler çekiliyor...</div>";
    try {
        const today = new Date().toISOString().split('T')[0];
        const response = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&region=TR&with_release_type=2|3|4&release_date.gte=${today}&sort_by=release_date.asc&popularity.gte=15&page=1`);
        const data = await response.json();
        container.innerHTML = "";
        
        data.results.forEach(movie => {
            container.innerHTML += createMovieCard(movie, "movie", "upcoming");
        });
    } catch (error) {
        container.innerHTML = "<div class='loading'>Hata oluştu.</div>";
    }
}

function applyPlatformFilters() {
    if (currentMode === "actor") {
        openActorDetails(currentActorId, document.getElementById('searchInput').value, true, currentJobType);
    } else if (currentMode === "search") {
        searchMovie(true);
    } else {
        loadPlatformMovies(currentProvider, true, true); // true for isFilterChange
    }
}

async function loadPlatformMovies(providerId = 0, reset = true, isFilterChange = false) {
    if (reset) {
        currentPage = 1;
        document.getElementById('search-results').innerHTML = "";
        document.getElementById('loadMoreBtn').style.display = 'none';
        const sortByFilterOption = document.querySelector('#sortByFilter option[value="order.asc"]');
        if (sortByFilterOption) sortByFilterOption.style.display = 'none';
        const sortSelect = document.getElementById('sortByFilter');
        if (sortSelect && sortSelect.value === 'order.asc') sortSelect.value = 'popularity.desc';
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Toggle off if already selected, unless it's just a filter change
        if (!isFilterChange && providerId > 0 && currentProvider === providerId) {
            providerId = 0;
            currentProvider = 0;
        } else {
            currentProvider = providerId;
        }
        
        // Sync platform dropdown
        const platSelect = document.getElementById('discover-platform');
        if (platSelect) platSelect.value = currentProvider;
        
        currentPage = 1;
        currentMode = "platform";
        const container = document.getElementById('search-results');
        container.innerHTML = "<div class='loading'>İçerikler Yükleniyor...</div>";
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
            url += `&without_genres=10767,10763,10764`;

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
            
            const res = await fetch(url);
            const data = await res.json();
            
            if (data.results && data.results.length > 0) {
                allResults = allResults.concat(data.results.map(item => {
                    item.media_type = type;
                    return item;
                }));
            }
        }
        
        allResults.sort((a, b) => b.popularity - a.popularity);
        
        const container = document.getElementById('search-results');
        if (reset) container.innerHTML = "";
        
        if (allResults.length === 0 && reset) {
            container.innerHTML = "<div class='loading'>Bu filtrelere uygun içerik bulunamadı.</div>";
            return;
        }
        
        for (let i = 0; i < allResults.length; i++) {
            container.innerHTML += createMovieCard(allResults[i], allResults[i].media_type, "");
            fetchAndInjectProviders(allResults[i].id, allResults[i].media_type);
        }
        
        if (allResults.length > 0) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        }
    } catch (error) {
        console.error("loadPlatformMovies error:", error);
        if (reset) document.getElementById('search-results').innerHTML = `<div class='loading' style='color:red;'>Hata oluştu: ${error.message} <br/> ${error.stack}</div>`;
    }
}

function handleSearch(event) {
    if (event.key === "Enter") searchMovie();
}

async function searchMovie(reset = true) {
    if (reset) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        currentMode = "search";
        currentPage = 1;
        currentSearchQuery = document.getElementById('searchInput').value.trim();
        
        document.querySelectorAll('.provider-filter-btn').forEach(btn => btn.classList.remove('active'));
        currentProvider = 0;
        
        const sortByFilterOption = document.querySelector('#sortByFilter option[value="order.asc"]');
        if (sortByFilterOption) sortByFilterOption.style.display = 'none';
        const sortSelect = document.getElementById('sortByFilter');
        if (sortSelect && sortSelect.value === 'order.asc') sortSelect.value = 'popularity.desc';
        
        document.getElementById('top10-section').style.display = 'none';
        const platformSelection = document.getElementById('platform-selection-area');
        if (platformSelection) platformSelection.style.display = 'none';
        
        const container = document.getElementById('search-results');
        container.innerHTML = "";
        
        if (!currentSearchQuery) {
            container.innerHTML = "<div class='loading'>Lütfen aramak için bir kelime girin.</div>";
            document.getElementById('loadMoreBtn').style.display = 'none';
            return;
        }
        
        showSkeletons('search-results', 20);
        document.getElementById('loadMoreBtn').style.display = 'none';
    }

    try {
        const res = await fetch(`${BASE_URL}/search/multi?api_key=${API_KEY}&language=tr-TR&query=${encodeURIComponent(currentSearchQuery)}&page=${currentPage}&include_adult=false`);
        const data = await res.json();
        
        // Filter out people and talk shows locally
        let filtered = data.results.filter(item => {
            if (item.media_type === "person") return false;
            if (item.genre_ids && (item.genre_ids.includes(10767) || item.genre_ids.includes(10763) || item.genre_ids.includes(10764))) return false; 
            return true;
        });
        
        filtered = filtered.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
        
        const container = document.getElementById('search-results');
        if (reset) container.innerHTML = "";
        
        if (filtered.length === 0 && reset) {
            container.innerHTML = "<div class='loading'>Sonuç bulunamadı.</div>";
            return;
        }
        
        for (let i = 0; i < filtered.length; i++) {
            container.innerHTML += createMovieCard(filtered[i], filtered[i].media_type, "");
            fetchAndInjectProviders(filtered[i].id, filtered[i].media_type);
        }
        
        if (filtered.length > 0) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        } else {
            document.getElementById('loadMoreBtn').style.display = 'none';
        }
    } catch (error) {
        console.error("searchMovie error:", error);
        if (reset) document.getElementById('search-results').innerHTML = `<div class='loading' style='color:red;'>Arama Hatası: ${error.message}</div>`;
    }
}

let searchTimeout = null;
async function handleSearchInput(event) {
    const query = event.target.value.trim();
    const box = document.getElementById('autocomplete-box');
    
    if (query.length < 3) {
        if(box) box.style.display = 'none';
        return;
    }
    
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(`${BASE_URL}/search/multi?api_key=${API_KEY}&language=tr-TR&query=${encodeURIComponent(query)}&include_adult=false`);
            const data = await res.json();
            
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
                        <img src="${poster}" class="suggestion-img">
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
        } catch(e) {
            console.error("Autocomplete Error:", e);
        }
    }, 400);
}

function loadMoreResults() {
    currentPage++;
    if (currentMode === "platform") {
        loadPlatformMovies(currentProvider, false);
    } else if (currentMode === "search") {
        searchMovie(false);
    } else if (currentMode === "actor") {
        openActorDetails(currentActorId, document.getElementById('searchInput').value, false, currentJobType);
    }
}

function toggleWatchlist(btnElem, movieId) {
    const item = window.movieCache[movieId];
    if (!item) return;
    
    let watchlist = JSON.parse(localStorage.getItem('watchlist')) || [];
    const existingIndex = watchlist.findIndex(w => w.id === item.id);
    
    if (existingIndex > -1) {
        watchlist.splice(existingIndex, 1);
        if (btnElem.id === "modal-wl-btn") {
            btnElem.classList.remove('active');
            btnElem.classList.add('inactive');
            btnElem.innerHTML = '<i class="fas fa-heart"></i> Listeme Ekle';
            btnElem.style.background = "";
            btnElem.style.color = "";
        } else {
            btnElem.classList.remove('active');
        }
    } else {
        watchlist.push(item);
        if (btnElem.id === "modal-wl-btn") {
            btnElem.classList.remove('inactive');
            btnElem.classList.add('active');
            btnElem.innerHTML = `<i class="fas fa-heart"></i> Listeden Çıkar`;
            btnElem.style.background = "";
            btnElem.style.color = "";
        } else {
            btnElem.classList.add('active');
        }
    }
    
    localStorage.setItem('watchlist', JSON.stringify(watchlist));
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
    const url = `${window.location.origin}${window.location.pathname}#film/${id}`;
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

function renderRecentlyViewed() {
    const recent = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    const container = document.getElementById('recently-viewed-grid');
    if (!container) return;
    
    if (recent.length === 0) {
        document.getElementById('recently-viewed-section').style.display = 'none';
    } else {
        document.getElementById('recently-viewed-section').style.display = 'block';
        container.innerHTML = recent.map(item => createMovieCard(item, item.media_type, "")).join('');
        recent.forEach(item => fetchAndInjectProviders(item.id, item.media_type, item));
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

function loadProfile() {
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
    renderRecentlyViewed();

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
                    <img src="${profile}" alt="${actor.name}">
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
        fetchAndInjectProviders(item.id, type, item);
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

function searchByGenre(genreId) {
    closeDetails(null, true);
    resetPlatformView();
    
    const select = document.getElementById('genreFilter');
    if (select) {
        let matchedValue = "";
        Array.from(select.options).forEach(opt => {
            if (opt.value === String(genreId) || opt.value.split('|').includes(String(genreId))) {
                matchedValue = opt.value;
            }
        });
        
        if (matchedValue) {
            select.value = matchedValue;
        } else {
            select.value = genreId;
        }
    }
    
    loadPlatformMovies(0, true);
}

async function openTrailer(id, mediaType) {
    const modal = document.getElementById('trailer-modal');
    const container = document.getElementById('video-container');
    
    container.innerHTML = "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Fragman Aranıyor...</div>";
    modal.classList.add('active');

    const bgIframe = document.querySelector('#video-bg-container iframe');
    if (bgIframe && bgIframe.contentWindow) {
        bgIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    }

    try {
        const res = await fetch(`${BASE_URL}/${mediaType}/${id}/videos?api_key=${API_KEY}`);
        const data = await res.json();
        
        let trailer = data.results.find(v => v.site === "YouTube" && v.type === "Trailer");
        if (!trailer && data.results.length > 0) trailer = data.results.find(v => v.site === "YouTube");
        
        if (trailer) {
            container.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
        } else {
            container.innerHTML = "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Bu yapım için fragman bulunamadı 😔</div>";
        }
    } catch (e) {
        container.innerHTML = "<div style='color:red;text-align:center;padding-top:20%;'>Fragman yüklenirken hata oluştu!</div>";
    }
}

function closeTrailer(event, force = false) {
    if (force || (event && event.target.id === 'trailer-modal')) {
        const modal = document.getElementById('trailer-modal');
        const container = document.getElementById('video-container');
        modal.classList.remove('active');
        container.innerHTML = ""; 
        
        const bgIframe = document.querySelector('#video-bg-container iframe');
        if (bgIframe && bgIframe.contentWindow) {
            bgIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        }
    }
}

async function openDetails(movieId) {
    document.body.style.overflow = "hidden";
    const item = window.movieCache[movieId];
    if (!item) return;
    
    if (!item.media_type || item.media_type === "undefined") {
        item.media_type = (item.first_air_date || item.name && !item.title) ? "tv" : "movie";
    }

    // Quick API validation for legacy items that might have wrong media_type
    try {
        let verifyRes = await fetch(`${BASE_URL}/${item.media_type}/${item.id}?api_key=${API_KEY}&language=tr-TR`);
        let verifyData = await verifyRes.json();
        if (verifyData.status_code === 34) {
            item.media_type = item.media_type === "movie" ? "tv" : "movie";
            window.movieCache[movieId].media_type = item.media_type;
            
            let wl = JSON.parse(localStorage.getItem('watchlist') || '[]');
            let wlIndex = wl.findIndex(w => w.id === item.id);
            if (wlIndex > -1) {
                wl[wlIndex].media_type = item.media_type;
                localStorage.setItem('watchlist', JSON.stringify(wl));
            }
        }
    } catch(e) {}

    window.history.pushState(null, null, '#film/' + movieId);

    const modal = document.getElementById('details-modal');
    
    // Add to recently viewed
    let recent = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    recent = recent.filter(r => r.id !== item.id);
    recent.unshift(item);
    if(recent.length > 10) recent.pop();
    localStorage.setItem('recentlyViewed', JSON.stringify(recent));
    renderRecentlyViewed();

    if (modal) {
        modal.scrollTo(0, 0);
        const detailsContent = modal.querySelector('.details-content');
        if (detailsContent) {
            detailsContent.scrollTop = 0;
        }
    }
    
    
    document.getElementById('details-title').innerText = item.title;
    document.getElementById('details-overview').innerText = item.overview || "Bu yapım için konu özeti bulunmuyor.";
    
    const posterUrl = item.poster_path ? IMAGE_BASE + item.poster_path : 'https://via.placeholder.com/500x750?text=Afiş+Yok';
    const posterImgElem = document.getElementById('details-poster');
    posterImgElem.crossOrigin = "Anonymous";
    
    // Dynamic Theme (ColorThief)
    posterImgElem.onload = function() {
        try {
            if (typeof ColorThief !== 'undefined') {
                const colorThief = new ColorThief();
                const color = colorThief.getColor(posterImgElem);
                if (color) {
                    document.documentElement.style.setProperty('--primary-color', `rgb(${color[0]}, ${color[1]}, ${color[2]})`);
                    
                    // Lighter accent
                    const accentR = Math.min(255, color[0] + 50);
                    const accentG = Math.min(255, color[1] + 50);
                    const accentB = Math.min(255, color[2] + 50);
                    document.documentElement.style.setProperty('--accent-color', `rgb(${accentR}, ${accentG}, ${accentB})`);
                }
            }
        } catch(e) {
            console.log("ColorThief couldn't extract color:", e);
        }
    };
    
    // Cache buster to force CORS reload if already cached without CORS
    posterImgElem.src = posterUrl.includes('?') ? posterUrl + '&cb=' + new Date().getTime() : posterUrl + '?cb=' + new Date().getTime();
    
    const backdropUrl = item.backdrop_path ? BACKDROP_BASE + item.backdrop_path : posterUrl;
    document.getElementById('details-backdrop').style.backgroundImage = `url(${backdropUrl})`;
    
    // Ambilight Injection
    const ambilightEl = document.getElementById('ambilight-bg');
    if (ambilightEl) {
        ambilightEl.style.backgroundImage = `url(${backdropUrl})`;
    }
    
    const rating = item.vote_average ? item.vote_average.toFixed(1) : "N/A";
    const genresHtml = (item.genre_ids || []).map(id => {
        const name = genreMap[id];
        return name ? `<span class="genre-badge" onclick="searchByGenre(${id})" title="Bu türde ara">${name}</span>` : '';
    }).join(' ');
    
    const d = new Date(item.release_date || item.first_air_date || "");
    const formattedDate = d.toString() !== "Invalid Date" ? d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : "Bilinmiyor";
    
    // Default TMDB rating HTML
    const metaContainer = document.getElementById('details-meta');
    metaContainer.innerHTML = `<span id="rating-span"><i class="fas fa-star" style="color:#fbbf24"></i> ${rating}</span> <span>|</span> <span>${formattedDate}</span> <span>|</span> ${genresHtml}`;

    const provContainer = document.getElementById('modal-providers');
    provContainer.style = "margin-top: 15px; display:flex; gap:10px; align-items:center; justify-content: center; flex-wrap: wrap;";
    provContainer.innerHTML = "Platformlar aranıyor...";

    // Modal Provider Fetch (WITH DEEP LINKS)
    fetch(`${BASE_URL}/${item.media_type}/${item.id}/watch/providers?api_key=${API_KEY}`)
        .then(res => res.json())
        .then(data => {
            const tr = data.results && data.results.TR ? data.results.TR : null;
            const provContainer = document.getElementById('modal-providers');
            if (tr && tr.flatrate) {
                let html = "<span style='color:var(--text-muted); font-size:0.95rem; font-weight:bold;'>İzlenebilir:</span> ";
                const watchLink = tr.link || "#";
                tr.flatrate.forEach(p => {
                    html += `<a href="${watchLink}" target="_blank" title="${p.provider_name} Üzerinde İzle"><img src="${IMAGE_BASE + p.logo_path}" style="width:35px; height:35px; border-radius:8px; box-shadow: 0 2px 5px rgba(0,0,0,0.5); cursor:pointer;"></a>`;
                });
                provContainer.innerHTML = html;
            } else {
                provContainer.innerHTML = "<span style='color:var(--text-muted); font-size:0.9rem;'>Türkiye'de dijital yayını yok</span>";
            }
        }).catch(err => {
            const provContainer = document.getElementById('modal-providers');
            if(provContainer) provContainer.innerHTML = "<span style='color:var(--text-muted); font-size:0.9rem;'>Platform bilgisi alınamadı</span>";
        });

    // Full Fetch for Premium Features
    const castContainer = document.getElementById('details-cast');
    const recContainer = document.getElementById('details-recommendations');
    const rightPanel = document.querySelector('.details-right');
    const videoBgContainer = document.getElementById('video-bg-container');
    const backdropEl = document.getElementById('details-backdrop');
    
    // Clear old dynamic elements
    const oldCol = document.getElementById('collection-container');
    if(oldCol) oldCol.remove();
    const oldTv = document.getElementById('tv-guide-container');
    if(oldTv) oldTv.remove();
    
    if(videoBgContainer) {
        videoBgContainer.innerHTML = "";
        videoBgContainer.style.opacity = "0";
    }
    if(backdropEl) backdropEl.style.display = "block";

    castContainer.innerHTML = "<div style='color:#ccc'>Oyuncular yükleniyor...</div>";
    if(recContainer) recContainer.innerHTML = "<div style='color:#ccc'>Öneriler yükleniyor...</div>";

    fetch(`${BASE_URL}/${item.media_type}/${item.id}?api_key=${API_KEY}&language=tr-TR&append_to_response=videos,credits,recommendations,external_ids`)
        .then(res => res.json())
        .then(async fullData => {
            if (fullData.overview) {
                document.getElementById('details-overview').innerText = fullData.overview;
                item.overview = fullData.overview;
                
                let r = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
                let i = r.findIndex(x => x.id === item.id);
                if(i > -1) {
                    r[i].overview = fullData.overview;
                    localStorage.setItem('recentlyViewed', JSON.stringify(r));
                }
            }

            // IMDb Badge
            if (fullData.external_ids && fullData.external_ids.imdb_id) {
                const imdbId = fullData.external_ids.imdb_id;
                const cachedImdb = localStorage.getItem('imdb_' + imdbId);
                if (cachedImdb) {
                    document.getElementById('rating-span').innerHTML = `<a href="https://www.imdb.com/title/${imdbId}" target="_blank" style="text-decoration:none; color:inherit;"><span class="imdb-badge">IMDb</span> ${cachedImdb}</a>`;
                } else {
                    fetch(`https://www.omdbapi.com/?apikey=cfcb7364&i=${imdbId}`)
                        .then(r => r.json())
                        .then(omdbData => {
                            if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") {
                                document.getElementById('rating-span').innerHTML = `<a href="https://www.imdb.com/title/${imdbId}" target="_blank" style="text-decoration:none; color:inherit;"><span class="imdb-badge">IMDb</span> ${omdbData.imdbRating}</a>`;
                                localStorage.setItem('imdb_' + imdbId, omdbData.imdbRating);
                            }
                        }).catch(e => {});
                }
            }

            // Video Background (Only PC)
            if (window.innerWidth > 768 && videoBgContainer && fullData.videos && fullData.videos.results.length > 0) {
                // Try to find a trailer
                let video = fullData.videos.results.find(v => v.site === "YouTube" && v.type === "Trailer");
                if(!video) video = fullData.videos.results.find(v => v.site === "YouTube");
                
                if (video) {
                    videoBgContainer.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${video.key}?autoplay=1&mute=1&controls=0&loop=1&playlist=${video.key}&modestbranding=1&showinfo=0&rel=0&iv_load_policy=3&enablejsapi=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
                    
                    // Şirket interneti engellemesini (Hata 152 / Beyaz Ekran) tespit etmek için ufak bir bağlantı testi
                    fetch('https://www.youtube-nocookie.com/favicon.ico', { mode: 'no-cors' })
                        .then(() => {
                            // Bağlantı başarılı, videoyu göster
                            setTimeout(() => {
                                videoBgContainer.style.opacity = "1";
                                if(backdropEl) backdropEl.style.display = "none"; // Video oynayacağı için resmi kaldır
                            }, 1000);
                        })
                        .catch(() => {
                            // Bağlantı reddedildi (Şirket ağı engelledi)
                            // Videoyu hiç gösterme, arka plandaki resim kalsın.
                            console.warn("YouTube bağlantısı engellendi, video arka planı iptal edildi.");
                        });
                }
            }

            if (fullData.credits && fullData.credits.crew) {
                const director = fullData.credits.crew.find(c => c.job === 'Director');
                if (director) {
                    const safeName = director.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const directorHtml = `<div style="margin-top: 8px; display: inline-block; background: rgba(229, 9, 20, 0.1); padding: 4px 10px; border-radius: 12px; border: 1px solid rgba(229, 9, 20, 0.2);"><span style="cursor:pointer; color:var(--accent-color); font-weight:bold;" onclick="openActorDetails(${director.id}, '${safeName}', true, 'Director')" title="${director.name.replace(/"/g, '&quot;')} filmleri"><i class="fas fa-bullhorn"></i> Yönetmen: ${director.name}</span></div>`;
                    const metaContainer = document.getElementById('details-meta');
                    if (metaContainer) {
                        metaContainer.innerHTML += directorHtml;
                    }
                }
            }
            
            // Başrol Oyuncuları
            if (fullData.credits && fullData.credits.cast) {
                const cast = fullData.credits.cast.slice(0, 10);
                if (cast.length > 0) {
                    let castHtml = "";
                    cast.forEach(actor => {
                        const actorImg = actor.profile_path ? IMAGE_BASE + actor.profile_path : 'https://via.placeholder.com/150x150?text=Foto';
                        const safeActorName = actor.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                        castHtml += `
                            <div class="actor-card" style="cursor:pointer" onclick="openActorDetails(${actor.id}, '${safeActorName}')" onmouseenter="showActorTooltip(this, ${actor.id})" onmouseleave="hideActorTooltip(this)">
                                <img src="${actorImg}" alt="${actor.name}">
                                <div class="actor-name" title="${actor.name}">${actor.name}</div>
                                <div class="actor-tooltip">Yükleniyor...</div>
                            </div>
                        `;
                    });
                    castContainer.innerHTML = castHtml;
                } else {
                    castContainer.innerHTML = "<div style='color:#ccc'>Oyuncu bilgisi bulunamadı.</div>";
                }
            }

            // Recommendations
            if (fullData.recommendations && fullData.recommendations.results && recContainer) {
                const recs = fullData.recommendations.results.slice(0, 10);
                if (recs.length > 0) {
                    let recHtml = "";
                    recs.forEach(rec => {
                        window.movieCache[rec.id] = {
                            id: rec.id, title: rec.title || rec.name, name: rec.title || rec.name, overview: rec.overview,
                            poster_path: rec.poster_path, backdrop_path: rec.backdrop_path,
                            release_date: rec.release_date, first_air_date: rec.first_air_date,
                            vote_average: rec.vote_average, genre_ids: rec.genre_ids,
                            media_type: rec.media_type || item.media_type
                        };
                        const rImg = rec.poster_path ? IMAGE_BASE + rec.poster_path : 'https://via.placeholder.com/100x150?text=Yok';
                        const rTitle = rec.title || rec.name;
                        recHtml += `
                            <div class="recommendation-card" onclick="openDetails(${rec.id})">
                                <img src="${rImg}" alt="${rTitle}">
                                <div class="recommendation-title" title="${rTitle}">${rTitle}</div>
                            </div>
                        `;
                    });
                    recContainer.innerHTML = recHtml;
                } else {
                    recContainer.innerHTML = "<div style='color:#ccc'>Öneri bulunamadı.</div>";
                }
            }

            // TV Show Seasons
            if (item.media_type === "tv" && fullData.seasons && fullData.seasons.length > 0) {
                let seasonOptions = "";
                fullData.seasons.forEach(s => {
                    if (s.season_number > 0) { // Sadece normal sezonlar (Özel gösterimleri çıkar)
                        seasonOptions += `<option value="${s.season_number}">${s.name} (${s.episode_count} Bölüm)</option>`;
                    }
                });
                
                if (seasonOptions) {
                    const tvHtml = `
                        <div id="tv-guide-container" class="collection-section">
                            <h3 class="cast-title">Dizi Sezon Rehberi</h3>
                            <div class="season-select-wrapper">
                                <select class="season-select" onchange="loadSeasonEpisodes(${item.id}, this.value)">
                                    <option value="" disabled selected>Bir sezon seçin...</option>
                                    ${seasonOptions}
                                </select>
                            </div>
                            <div id="episodes-container" class="episode-list"></div>
                        </div>
                    `;
                    castContainer.previousElementSibling.insertAdjacentHTML('beforebegin', tvHtml);
                    
                    const firstSeason = fullData.seasons.find(s => s.season_number > 0) || fullData.seasons[0];
                    if (firstSeason) {
                        document.querySelector('.season-select').value = firstSeason.season_number;
                        loadSeasonEpisodes(item.id, firstSeason.season_number);
                    }
                }
            }

            // Collections
            if (item.media_type === "movie" && fullData.belongs_to_collection) {
                const colRes = await fetch(`${BASE_URL}/collection/${fullData.belongs_to_collection.id}?api_key=${API_KEY}&language=tr-TR`);
                const colData = await colRes.json();
                
                if (colData.parts && colData.parts.length > 0) {
                    colData.parts.sort((a, b) => new Date(a.release_date) - new Date(b.release_date));
                    
                    const collectionTitle = colData.name.replace(/\[Seri\]/gi, "").replace(/Serisi/gi, "").replace(/Collection/gi, "").trim() + " Serisi";
                    let colHtml = `
                        <div id="collection-container" class="collection-section">
                            <h3 class="cast-title">${collectionTitle}</h3>
                            <div class="collection-list">
                    `;
                    
                    colData.parts.forEach(part => {
                        window.movieCache[part.id] = {
                            id: part.id, title: part.title, name: part.title, overview: part.overview,
                            poster_path: part.poster_path, backdrop_path: part.backdrop_path,
                            release_date: part.release_date, vote_average: part.vote_average,
                            genre_ids: part.genre_ids, media_type: "movie"
                        };
                        const pImg = part.poster_path ? IMAGE_BASE + part.poster_path : 'https://via.placeholder.com/100x150?text=Yok';
                        colHtml += `
                            <div class="recommendation-card" onclick="openDetails(${part.id})">
                                <img src="${pImg}" alt="${part.title}" style="${part.id === item.id ? 'outline: 3px solid var(--primary-color); outline-offset: -3px; border-radius: 10px;' : ''}">
                                <div class="recommendation-title" title="${part.title}">${part.title}</div>
                            </div>
                        `;
                    });
                    colHtml += `</div></div>`;
                    
                    if(recContainer) recContainer.previousElementSibling.insertAdjacentHTML('beforebegin', colHtml);
                }
            }
        }).catch(err => {
            console.error("Full fetch error", err);
            castContainer.innerHTML = "<div style='color:red'>Veriler çekilemedi.</div>";
        });
        
    // Modal Actions (Watchlist, Rate, Trailer, Share)
    const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    const isInWatchlist = watchlist.some(m => m.id === item.id);
    const wlText = isInWatchlist ? "Listeden Çıkar" : "Listeme Ekle";
    const wlClass = isInWatchlist ? 'active' : 'inactive';
    
    const wlBtnHtml = `<button id="modal-wl-btn" onclick="toggleWatchlist(this, ${item.id})" class="btn-watchlist ${wlClass}"><i class="fas fa-heart"></i> ${wlText}</button>`;
    
    const isUpcoming = item.release_date && new Date(item.release_date) > new Date();
    
    let rateBtnHtml = "";
    if (!isUpcoming) {
        const savedRatings = JSON.parse(localStorage.getItem('movieRatings') || '{}');
        const myRating = savedRatings[item.id];
        const rateText = myRating ? `⭐ ${myRating}/10` : "İzledim / Puan Ver";
        const rateClass = myRating ? 'active' : 'inactive';
        
        rateBtnHtml = `<div style="position:relative; width:100%; margin-top: 10px;">
            <button onclick="toggleRateMenu(${item.id})" class="btn-watchlist ${rateClass}" style="width:100%;"><i class="fas fa-star"></i> <span id="rate-text-${item.id}">${rateText}</span></button>
            <div id="rate-menu-${item.id}" style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--card-bg); border-radius:10px; padding:10px; box-shadow:0 10px 20px rgba(0,0,0,0.5); z-index:10; border:1px solid var(--glass-border); flex-wrap:wrap; justify-content:center; gap:5px; margin-top:5px;">
                ${[1,2,3,4,5,6,7,8,9,10].map(n => `<button onclick="saveRating(${item.id}, ${n})" style="width:28px; height:28px; border-radius:5px; background:var(--primary-color); color:white; border:none; cursor:pointer;">${n}</button>`).join('')}
                <button onclick="removeRating(${item.id})" style="width:100%; margin-top:5px; padding:5px; border-radius:5px; background:rgba(229,9,20,0.8); color:white; border:none; cursor:pointer;">Puanı Sil</button>
            </div>
        </div>`;
    }
    
    const trailerBtnHtml = `<button onclick="openTrailer(${item.id}, '${item.media_type}')" class="btn-watchlist inactive" style="margin-top: 10px;"><i class="fas fa-play"></i> Fragmanı İzle</button>`;
    const shareBtnHtml = `<button onclick="shareMovie(${item.id})" class="btn-watchlist inactive" style="margin-top: 10px; background:rgba(255,255,255,0.05);"><i class="fas fa-share-alt"></i> Paylaş</button>`;
    
    const actionsDiv = document.querySelector('.details-left');
    if (actionsDiv) {
        // Clear previous buttons
        const oldBtns = actionsDiv.querySelectorAll('.btn-watchlist, [id^="rate-menu-"]');
        oldBtns.forEach(b => { if(!b.closest('#modal-providers')) b.parentElement && b.parentElement.tagName === 'DIV' && b.parentElement.style.position === 'relative' ? b.parentElement.remove() : b.remove() });
        
        const combinedHtml = wlBtnHtml + rateBtnHtml + trailerBtnHtml + shareBtnHtml;
        
        const providersDiv = document.getElementById('modal-providers');
        if (providersDiv) {
            providersDiv.insertAdjacentHTML('beforebegin', combinedHtml);
        } else {
            actionsDiv.insertAdjacentHTML('beforeend', combinedHtml);
        }
    }

    modal.classList.add('active');
    document.body.style.overflow = "hidden";
    
    // History API for Android Back Button behavior
    history.pushState({ modalOpen: true }, "", "#details");
}

async function openActorDetails(actorId, actorName, reset = true, jobType = 'cast', filterGenre = 0) {
    hideActorTooltip();
    
    if (reset) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        closeDetails(null, true);
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
        
        document.getElementById('searchInput').value = actorName;
        const container = document.getElementById('search-results');
        container.innerHTML = "";
        showSkeletons('search-results', 10);
        document.getElementById('loadMoreBtn').style.display = 'none';
        
        document.getElementById('top10-section').style.display = 'none';
        const nowPlaying = document.getElementById('now-playing-section');
        if (nowPlaying) nowPlaying.style.display = 'none';
        const vizyon = document.getElementById('vizyon-section');
        if (vizyon) vizyon.style.display = 'none';
        
        const platformFilters = document.querySelector('.platform-filters');
        if (platformFilters) platformFilters.style.display = 'none';
        
        const sortByFilterOption = document.querySelector('#sortByFilter option[value="order.asc"]');
        if (sortByFilterOption) sortByFilterOption.style.display = jobType === 'Director' ? 'none' : 'block';
    }
    
    try {
        const [personRes, creditsRes] = await Promise.all([
            fetch(`${BASE_URL}/person/${currentActorId}?api_key=${API_KEY}&language=tr-TR`),
            fetch(`${BASE_URL}/person/${currentActorId}/combined_credits?api_key=${API_KEY}&language=tr-TR`)
        ]);
        
        const personData = await personRes.json();
        const data = await creditsRes.json();
        
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
            // Exclude talk shows locally
            movies = movies.filter(m => !(m.genre_ids && (m.genre_ids.includes(10767) || m.genre_ids.includes(10763) || m.genre_ids.includes(10764))));
        }
        
        // Exclude award shows and ceremonies
        const blockedWords = ["award", "oscar", "grammy", "emmy", "golden globe", "bafta", "tony", "ceremony"];
        movies = movies.filter(m => {
            const title = (m.title || m.name || "").toLowerCase();
            return !blockedWords.some(w => title.includes(w));
        });
        
        const mediaType = document.getElementById('mediaTypeFilter')?.value || "all";
        if (mediaType === "movie") {
            movies = movies.filter(m => m.media_type === "movie");
        } else if (mediaType === "tv") {
            movies = movies.filter(m => m.media_type === "tv");
        }
        
        const genreId = parseInt(filterGenre);
        if (genreId > 0) {
            movies = movies.filter(m => m.genre_ids && m.genre_ids.includes(genreId));
        }
        
        const ratingFilter = parseFloat(document.getElementById('ratingFilter')?.value || "0");
        if (ratingFilter > 0) {
            movies = movies.filter(m => m.vote_average >= ratingFilter);
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
                const dateA = new Date(a.release_date || a.first_air_date || "1900-01-01");
                const dateB = new Date(b.release_date || b.first_air_date || "1900-01-01");
                return sortBy.includes("desc") ? dateB - dateA : dateA - dateB;
            });
        } else {
            movies.sort((a, b) => b.popularity - a.popularity);
        }
        
        const startIndex = (currentPage - 1) * 20;
        const endIndex = startIndex + 20;
        const pagedMovies = movies.slice(startIndex, endIndex);
        
        const container = document.getElementById('search-results');
        
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
            
            container.innerHTML = "";
            if (bioText || birthDate || true) { // Always show bio card even if empty bio, to show favorite button
                container.innerHTML = `
                    <div id="actor-bio-card-container" class="actor-bio-card" style="grid-column: 1 / -1; width: 100%; max-width: 800px; margin: 0 auto 20px auto; padding: 20px; background: var(--card-bg); border-radius: 15px; border: 1px solid var(--glass-border); color: var(--text-muted); font-size: 0.95rem;">
                        <div style="display:flex; align-items:flex-start; gap: 20px; margin-bottom: 10px;">
                            <img src="${personData.profile_path ? IMAGE_BASE + personData.profile_path : 'https://via.placeholder.com/60x90'}" style="width: 80px; height: 120px; border-radius: 10px; object-fit: cover; flex-shrink: 0; user-select: none; -webkit-user-drag: none;">
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
                        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: flex-end; align-items: center; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.05);">
                            <span style="font-size: 0.9rem; color: var(--text-muted);">Filmografiyi Filtrele:</span>
                            <select onchange="openActorDetails(${personData.id}, '${personData.name.replace(/'/g, "\\'")}', true, '${jobType}', this.value)" style="background: rgba(0,0,0,0.5); color: white; border: 1px solid var(--glass-border); padding: 6px 12px; border-radius: 20px; outline: none; font-size: 0.9rem; cursor: pointer;">
                                <option value="0" ${filterGenre == 0 ? 'selected' : ''}>Tüm Kategoriler</option>
                                <option value="28" ${filterGenre == 28 ? 'selected' : ''}>Aksiyon</option>
                                <option value="12" ${filterGenre == 12 ? 'selected' : ''}>Macera</option>
                                <option value="16" ${filterGenre == 16 ? 'selected' : ''}>Animasyon</option>
                                <option value="35" ${filterGenre == 35 ? 'selected' : ''}>Komedi</option>
                                <option value="80" ${filterGenre == 80 ? 'selected' : ''}>Suç</option>
                                <option value="99" ${filterGenre == 99 ? 'selected' : ''}>Belgesel</option>
                                <option value="18" ${filterGenre == 18 ? 'selected' : ''}>Dram</option>
                                <option value="10751" ${filterGenre == 10751 ? 'selected' : ''}>Aile</option>
                                <option value="14" ${filterGenre == 14 ? 'selected' : ''}>Fantastik</option>
                                <option value="36" ${filterGenre == 36 ? 'selected' : ''}>Tarih</option>
                                <option value="27" ${filterGenre == 27 ? 'selected' : ''}>Korku</option>
                                <option value="10402" ${filterGenre == 10402 ? 'selected' : ''}>Müzik</option>
                                <option value="9648" ${filterGenre == 9648 ? 'selected' : ''}>Gizem</option>
                                <option value="10749" ${filterGenre == 10749 ? 'selected' : ''}>Romantik</option>
                                <option value="878" ${filterGenre == 878 ? 'selected' : ''}>Bilim Kurgu</option>
                                <option value="53" ${filterGenre == 53 ? 'selected' : ''}>Gerilim</option>
                                <option value="10752" ${filterGenre == 10752 ? 'selected' : ''}>Savaş</option>
                                <option value="37" ${filterGenre == 37 ? 'selected' : ''}>Vahşi Batı</option>
                            </select>
                        </div>
                    </div>
                `;
            }
            
            // Bio kartına kaydırarak yenilenme illüzyonunu kır
            setTimeout(() => {
                const bioCard = document.getElementById('actor-bio-card-container');
                if (bioCard) {
                    bioCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 300);
        }
        
        if (pagedMovies.length === 0 && reset) {
            container.innerHTML = "<div class='loading'>Seçtiğiniz filtrelere uygun yapım bulunamadı.</div>";
            return;
        }
        
        for (let i = 0; i < pagedMovies.length; i++) {
            container.innerHTML += createMovieCard(pagedMovies[i], pagedMovies[i].media_type, "");
            fetchAndInjectProviders(pagedMovies[i].id, pagedMovies[i].media_type);
        }
        
        if (endIndex < movies.length) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        } else {
            document.getElementById('loadMoreBtn').style.display = 'none';
        }
    } catch (e) {
        if (reset) document.getElementById('search-results').innerHTML = "<div class='loading'>Hata oluştu.</div>";
    }
}

function closeDetails(event, force = false, isHistoryEvent = false) {
    if (force || (event && (event.target.id === 'details-modal' || event.target.closest('.close-btn')))) {
        const modal = document.getElementById('details-modal');
        if (modal && modal.classList.contains('active')) {
            modal.classList.remove('active');
            document.body.style.overflow = "auto";
            
            // Dinamik Temayı Sıfırla
            document.documentElement.style.setProperty('--primary-color', '');
            document.documentElement.style.setProperty('--accent-color', '');
            
            // Temizlik
            document.getElementById('modal-providers').innerHTML = "";
            const trailerContainer = document.getElementById('details-trailer-container');
            if (trailerContainer) trailerContainer.innerHTML = "";
            document.getElementById('details-poster').src = "";
            document.getElementById('details-cast').innerHTML = "";
            const vContainer = document.getElementById('video-bg-container');
            if (vContainer) {
                vContainer.innerHTML = "";
                vContainer.style.opacity = "0";
            }
            
            if (!isHistoryEvent) {
                window.history.pushState(null, null, window.location.pathname);
            }
        }
    }
}

// Tarayıcı geri tuşu eventi
window.addEventListener('popstate', (event) => {
    const detailsModal = document.getElementById('details-modal');
    if (detailsModal && detailsModal.classList.contains('active')) {
        closeDetails(null, true, true);
    }
});

// =========================================
// V5: PREMIUM FONKSİYONLAR (Tooltip, TV)
// =========================================

async function loadSeasonEpisodes(tvId, seasonNumber) {
    const container = document.getElementById('episodes-container');
    if (!container) return;
    
    container.innerHTML = "<div class='loading'>Bölümler yükleniyor...</div>";
    try {
        const res = await fetch(`${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${API_KEY}&language=tr-TR`);
        const data = await res.json();
        
        if (data.episodes && data.episodes.length > 0) {
            let html = "";
            data.episodes.forEach(ep => {
                const img = ep.still_path ? IMAGE_BASE + ep.still_path : 'https://via.placeholder.com/120x70?text=Afiş+Yok';
                const airDate = ep.air_date ? new Date(ep.air_date).toLocaleDateString('tr-TR') : 'Bilinmiyor';
                html += `
                    <div class="episode-card">
                        <img src="${img}" alt="${ep.name}">
                        <div class="episode-info">
                            <h4>${ep.episode_number}. ${ep.name}</h4>
                            <p style="color:var(--primary-color); font-size:0.8rem; margin-bottom:5px;">Yayın: ${airDate}</p>
                            <p>${ep.overview || 'Bu bölüm için henüz özet bulunmuyor.'}</p>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        } else {
            container.innerHTML = "<div>Bu sezon için bölüm bulunamadı.</div>";
        }
    } catch(e) {
        container.innerHTML = "<div style='color:red'>Hata oluştu.</div>";
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
    const target = e.target.closest('.cast-list') || e.target.closest('.collection-list');
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

async function loadTrendingActors() {
    const container = document.getElementById('trending-actors-list');
    if (!container) return;
    
    try {
        const [res1, res2, res3, res4] = await Promise.all([
            fetch(`${BASE_URL}/trending/person/week?api_key=${API_KEY}&language=tr-TR&page=1`),
            fetch(`${BASE_URL}/trending/person/week?api_key=${API_KEY}&language=tr-TR&page=2`),
            fetch(`${BASE_URL}/trending/person/week?api_key=${API_KEY}&language=tr-TR&page=3`),
            fetch(`${BASE_URL}/trending/person/week?api_key=${API_KEY}&language=tr-TR&page=4`)
        ]);
        const data1 = await res1.json();
        const data2 = await res2.json();
        const data3 = await res3.json();
        const data4 = await res4.json();
        const allActors = [...data1.results, ...data2.results, ...data3.results, ...data4.results];
        
        let html = "";
        
        // Asya yapımı (Kore, Japon, Çin, Hint vb.) içeriklerle tanınanları filtrele
        const filteredActors = allActors.filter(actor => {
            const hasAsianContent = actor.known_for && actor.known_for.some(m => {
                const lang = m.original_language;
                return ['ko', 'ja', 'zh', 'cn', 'hi', 'th', 'vi', 'tl'].includes(lang);
            });
            return !hasAsianContent && /^[-a-zA-Z0-9\s.,'şğüöçıŞĞÜÖÇİäöüßéèêëàâäôûçñ]+$/.test(actor.name);
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
                    <img src="${profile}" alt="${actor.name}" class="story-img">
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
        container.innerHTML = "<div style='color:red'>Oyuncular yüklenemedi.</div>";
    }
}

async function loadCuratedCollections() {
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
        fetch(`${BASE_URL}/collection/${c.id}?api_key=${API_KEY}&language=tr-TR`)
            .then(res => res.json())
            .then(data => ({ data, c }))
            .catch(() => null)
    );
    
    const results = await Promise.all(fetchPromises);
    
    let html = "";
    for (let res of results) {
        if (res && res.data && res.data.parts && res.data.parts.length > 0) {
            const data = res.data;
            const c = res.c;
            const poster = data.backdrop_path ? BACKDROP_BASE + data.backdrop_path : (data.poster_path ? IMAGE_BASE + data.poster_path : 'https://via.placeholder.com/300x170?text=Koleksiyon');
            html += `
                <div class="movie-card" style="width: 250px; flex-shrink: 0; cursor:pointer;" onclick="openCollection(${data.id})">
                    <img src="${poster}" style="width: 100%; aspect-ratio: 16/9; object-fit: cover;" alt="${data.name}">
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
            if (btn) btn.classList.add('active');
        } else {
            panel.style.display = 'none';
            if (btn) btn.classList.remove('active');
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
    document.getElementById('game-overlay-text').style.display = 'block';
    gameAttempts = 0;

    document.getElementById('game-score-board').style.display = 'flex';
    document.getElementById('game-score-correct').innerText = gameScoreCorrect;
    document.getElementById('game-score-wrong').innerText = gameScoreWrong;

    try {
        // Rastgele 1-10 arası popüler film sayfası
        const randomPage = Math.floor(Math.random() * 20) + 1;
        const res = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&page=${randomPage}&vote_count.gte=500&with_original_language=en|tr&sort_by=popularity.desc`);
        const data = await res.json();
        
        // Seçenekleri oluştur (1 doğru, 3 yanlış)
        const shuffled = data.results.sort(() => 0.5 - Math.random());
        currentGameMovie = shuffled[0];
        currentGameOptions = shuffled.slice(0, 4).sort(() => 0.5 - Math.random());

        // Posteri yükle
        const posterUrl = currentGameMovie.backdrop_path ? BACKDROP_BASE + currentGameMovie.backdrop_path : (currentGameMovie.poster_path ? IMAGE_BASE + currentGameMovie.poster_path : '');
        document.getElementById('game-poster').src = posterUrl;

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
        document.getElementById('game-overlay-text').style.display = 'none';
        
        gameScoreCorrect++;
        document.getElementById('game-score-correct').innerText = gameScoreCorrect;

        // Diğer butonları devre dışı bırak
        Array.from(document.getElementById('game-options').children).forEach(b => b.disabled = true);
        
        // 2.5 saniye sonra otomatik yeni oyun
        setTimeout(startNewGame, 2500);
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
            document.getElementById('game-poster').style.filter = 'blur(0px)';
            document.getElementById('game-overlay-text').style.display = 'none';
            
            gameScoreWrong++;
            document.getElementById('game-score-wrong').innerText = gameScoreWrong;

            // Doğru olanı yeşil yap
            Array.from(document.getElementById('game-options').children).forEach(b => {
                b.disabled = true;
                if(b.innerText === currentGameMovie.title) {
                    b.style.background = '#4CAF50';
                }
            });
            
            // 2.5 saniye sonra otomatik yeni oyun
            setTimeout(startNewGame, 2500);
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

function setGenre(val, btn) {
    // Update hidden select
    document.getElementById('genreFilter').value = val;
    // Update UI
    const siblings = btn.parentElement.querySelectorAll('.genre-pill-btn');
    siblings.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Trigger filter
    applyPlatformFilters();
}
