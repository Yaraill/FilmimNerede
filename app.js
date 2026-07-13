// =========================================
// API Ayarları
// =========================================
const API_KEY = "24e682394f9c71a770ddae8f3686036e";
const BASE_URL = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

let genreMap = {}; 
let currentCity = ""; 
window.movieCache = {}; // Hata Çözümü: Filmleri hafızada tutarız (Tırnak çakışmasını engeller)

let currentProvider = 0; // 0 = Hepsi
let currentPage = 1;
let currentMode = "platform"; // "platform", "search", "actor"
let currentSearchQuery = "";
let currentActorId = 0;

document.addEventListener('DOMContentLoaded', () => {
    // V5 Theme check
    if (localStorage.getItem('theme') === 'light') {
        document.body.classList.add('light-theme');
        if(document.getElementById('themeToggleBtn')) document.getElementById('themeToggleBtn').innerHTML = '<i class="fas fa-moon"></i>';
    }
    
    // Load default tab
    loadNowPlaying();
    loadGenres();
    
    // Close autocomplete when clicking outside
    document.addEventListener('click', (e) => {
        const box = document.getElementById('autocomplete-box');
        const input = document.getElementById('searchInput');
        if (box && input && e.target !== input && e.target !== box && !box.contains(e.target)) {
            box.style.display = 'none';
        }
    });
});

function resetPlatformView() {
    document.getElementById('searchInput').value = "";
    document.getElementById('genreFilter').value = "";
    document.getElementById('mediaTypeFilter').value = "all";
    document.getElementById('ratingFilter').value = "0";
    if (document.getElementById('sortByFilter')) document.getElementById('sortByFilter').value = "popularity.desc";
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
    document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));
    document.getElementById('platform').classList.add('active-tab');
    const platformLink = document.querySelector('a[onclick*="platform"]');
    if (platformLink) platformLink.classList.add('active');
    
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
        if(nowPlayingContainer) nowPlayingContainer.classList.add('list-view');
        if(vizyonContainer) vizyonContainer.classList.add('list-view');
        if(watchlistContainer) watchlistContainer.classList.add('list-view');
        if(document.getElementById('viewListBtn')) document.getElementById('viewListBtn').classList.add('active');
    } else {
        if(container) container.classList.remove('list-view');
        if(nowPlayingContainer) nowPlayingContainer.classList.remove('list-view');
        if(vizyonContainer) vizyonContainer.classList.remove('list-view');
        if(watchlistContainer) watchlistContainer.classList.remove('list-view');
        if(document.getElementById('viewGridBtn')) document.getElementById('viewGridBtn').classList.add('active');
    }
}

function toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    if(document.getElementById('themeToggleBtn')) {
        document.getElementById('themeToggleBtn').innerHTML = isLight ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
    }
}

async function surpriseMe() {
    closeDetails(null, true);
    resetPlatformView();
    // Pick from top 50 popular pages to ensure high quality
    const randomPage = Math.floor(Math.random() * 50) + 1; 
    try {
        const res = await fetch(`${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&page=${randomPage}&vote_count.gte=1000&sort_by=popularity.desc`);
        const data = await res.json();
        const randomMovie = data.results[Math.floor(Math.random() * data.results.length)];
        if (randomMovie) {
            randomMovie.media_type = "movie"; // FIX: ensure media_type is set for credits fetch
            window.movieCache[randomMovie.id] = randomMovie;
            openDetails(randomMovie.id);
        }
    } catch(e) {
        console.error("Surprise Me Error:", e);
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
        
        movieData.genres.forEach(g => genreMap[g.id] = g.name);
        tvData.genres.forEach(g => genreMap[g.id] = g.name);
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
    } else if (tabId === 'watchlist') {
        loadWatchlist();
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
            <img src="${poster}" alt="${title}" class="movie-poster" style="cursor:pointer" onclick="openDetails(${item.id})">
            <div class="movie-info">
                <div class="movie-meta">
                    <span class="rating"><i class="fas fa-star"></i> ${rating}</span>
                    <span class="genre-list">${genres}</span>
                </div>
                <div class="movie-title" title="${title}" style="cursor:pointer" onclick="openDetails(${item.id})">${titleWithYear}</div>
                ${dateOrProviderHtml}
                <div class="card-actions">
                    <button class="action-btn btn-trailer" onclick="openTrailer(${item.id}, '${mediaType}')">
                        <i class="fas fa-play"></i> Fragman
                    </button>
                </div>
                ${buyTicketHtml}
            </div>
        </div>
    `;
}

async function fetchAndInjectProviders(itemId, mediaType) {
    try {
        const res = await fetch(`${BASE_URL}/${mediaType}/${itemId}/watch/providers?api_key=${API_KEY}`);
        const data = await res.json();
        const tr = data.results && data.results.TR ? data.results.TR : null;
        
        let html = "";
        if (tr && tr.flatrate) {
            tr.flatrate.forEach(p => {
                html += `<img src="${IMAGE_BASE + p.logo_path}" alt="${p.provider_name}" class="provider-logo" title="${p.provider_name}">`;
            });
        } else {
            html = "<div class='no-provider'>Türkiye'de yayını yok</div>";
        }
        
        const els = document.querySelectorAll(`.providers-${itemId}`);
        els.forEach(el => el.innerHTML = html);
    } catch (e) {
        const els = document.querySelectorAll(`.providers-${itemId}`);
        els.forEach(el => el.innerHTML = "<div class='no-provider'>Bilgi alınamadı</div>");
        console.error("Provider Hatası", e);
    }
}

async function loadNowPlaying() {
    const container = document.getElementById('now-playing-grid');
    if (container.children.length > 0) return;
    
    container.style.display = "grid";
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
        openActorDetails(currentActorId, document.getElementById('searchInput').value, true);
    } else if (currentMode === "search") {
        searchMovie(true);
    } else {
        loadPlatformMovies(currentProvider, true, true); // true for isFilterChange
    }
}

async function loadPlatformMovies(providerId = 0, reset = true, isFilterChange = false) {
    if (reset) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Toggle off if already selected, unless it's just a filter change
        if (!isFilterChange && providerId > 0 && currentProvider === providerId) {
            providerId = 0;
            currentProvider = 0;
        } else {
            currentProvider = providerId;
        }
        
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

    const genre = document.getElementById('genreFilter').value;
    const rating = document.getElementById('ratingFilter').value;
    const mediaType = document.getElementById('mediaTypeFilter').value;
    
    let typesToFetch = mediaType === "all" ? ["movie", "tv"] : [mediaType];
    let allResults = [];
    
    try {
        for (let type of typesToFetch) {
            let url = `${BASE_URL}/discover/${type}?api_key=${API_KEY}&language=tr-TR&page=${currentPage}&include_adult=false&vote_count.gte=1000&without_keywords=210024,198385,195669`;
            
            // Exclude Talk shows (10767), News (10763), Reality (10764)
            url += `&without_genres=10767,10763,10764`;

            if (providerId > 0) {
                if (providerId !== 1899) { // HBO Max is global
                    url += `&watch_region=TR`;
                }
                url += `&with_watch_providers=${providerId}`;
            }
            if (genre) url += `&with_genres=${encodeURIComponent(genre)}`;
            if (rating > 0) url += `&vote_average.gte=${rating}`;
            
            const sortBy = document.getElementById('sortByFilter') ? document.getElementById('sortByFilter').value : 'popularity.desc';
            url += `&sort_by=${sortBy}`;
            
            const res = await fetch(url);
            const data = await res.json();
            
            data.results.forEach(item => {
                item.media_type = type;
                allResults.push(item);
            });
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
        if (reset) document.getElementById('search-results').innerHTML = "<div class='loading'>Hata oluştu.</div>";
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
        
        const container = document.getElementById('search-results');
        container.innerHTML = "<div class='loading'>Aranıyor...</div>";
        document.getElementById('loadMoreBtn').style.display = 'none';
        if (!currentSearchQuery) return;
    }

    try {
        const res = await fetch(`${BASE_URL}/search/multi?api_key=${API_KEY}&language=tr-TR&query=${encodeURIComponent(currentSearchQuery)}&page=${currentPage}&include_adult=false`);
        const data = await res.json();
        
        // Filter out people, animes, and talk shows locally
        let filtered = data.results.filter(item => {
            if (item.media_type === "person") return false;
            if (item.genre_ids && (item.genre_ids.includes(10767) || item.genre_ids.includes(10763) || item.genre_ids.includes(10764))) return false; 
            if (item.genre_ids && item.genre_ids.includes(16) && item.origin_country && item.origin_country.includes("JP")) return false; // Basic Anime filter
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
        if (reset) document.getElementById('search-results').innerHTML = "<div class='loading'>Hata oluştu.</div>";
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
                if (item.genre_ids && item.genre_ids.includes(16) && item.origin_country && item.origin_country.includes("JP")) return false;
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
        openActorDetails(currentActorId, document.getElementById('searchInput').value, false);
    }
}

function toggleWatchlist(btnElem, movieId) {
    const item = window.movieCache[movieId];
    if (!item) return;
    
    let watchlist = JSON.parse(localStorage.getItem('watchlist')) || [];
    const existingIndex = watchlist.findIndex(w => w.id === item.id);
    
    if (existingIndex > -1) {
        watchlist.splice(existingIndex, 1);
        btnElem.style.color = "white";
        if (btnElem.id === "modal-wl-btn") {
            btnElem.style.background = "rgba(255,255,255,0.2)";
            btnElem.innerHTML = '<i class="fas fa-heart"></i> Listeme Ekle';
        } else {
            btnElem.classList.remove('active');
        }
    } else {
        watchlist.push(item);
        btnElem.style.color = "var(--primary-color)";
        if (btnElem.id === "modal-wl-btn") {
            btnElem.style.background = "var(--primary-color)";
            btnElem.innerHTML = '<i class="fas fa-heart"></i> Listeden Çıkar';
        } else {
            btnElem.classList.add('active');
        }
    }
    
    localStorage.setItem('watchlist', JSON.stringify(watchlist));

    if (document.getElementById('watchlist').classList.contains('active-tab')) {
        loadWatchlist();
    }
}

function loadWatchlist() {
    const container = document.getElementById('watchlist-grid');
    let watchlist = JSON.parse(localStorage.getItem('watchlist')) || [];
    
    if (watchlist.length === 0) {
        container.innerHTML = "<div class='loading'>Listeniz şu an boş. Hemen kalp ikonuna tıklayarak film ekleyin!</div>";
        return;
    }
    
    container.innerHTML = "";
    watchlist.forEach(item => {
        container.innerHTML += createMovieCard(item, item.media_type || "movie", "");
        fetchAndInjectProviders(item.id, item.media_type || "movie");
    });
}

function searchByGenre(genreId) {
    closeDetails(null, true);
    resetPlatformView();
    
    const select = document.getElementById('genreFilter');
    let matchedValue = "";
    Array.from(select.options).forEach(opt => {
        if (opt.value === String(genreId) || opt.value.split('|').includes(String(genreId))) {
            matchedValue = opt.value;
        }
    });
    
    if (matchedValue) {
        select.value = matchedValue;
    } else {
        // Fallback
        select.value = genreId;
    }
    
    loadPlatformMovies(0, true);
}

async function openTrailer(id, mediaType) {
    const modal = document.getElementById('trailer-modal');
    const container = document.getElementById('video-container');
    
    container.innerHTML = "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Fragman Aranıyor...</div>";
    modal.classList.add('active');

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
    if (force || event.target.id === 'trailer-modal') {
        const modal = document.getElementById('trailer-modal');
        const container = document.getElementById('video-container');
        modal.classList.remove('active');
        container.innerHTML = ""; 
    }
}

async function openDetails(movieId) {
    document.body.style.overflow = "hidden";
    const item = window.movieCache[movieId];
    if (!item) return;

    const modal = document.getElementById('details-modal');
    
    document.getElementById('details-title').innerText = item.title;
    document.getElementById('details-overview').innerText = item.overview || "Bu yapım için konu özeti bulunmuyor.";
    
    const posterUrl = item.poster_path ? IMAGE_BASE + item.poster_path : 'https://via.placeholder.com/500x750?text=Afiş+Yok';
    document.getElementById('details-poster').src = posterUrl;
    
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

    // Fetch IMDB rating asynchronously
    fetch(`${BASE_URL}/${item.media_type}/${item.id}/external_ids?api_key=${API_KEY}`)
        .then(res => res.json())
        .then(extData => {
            if (extData.imdb_id) {
                const cachedImdb = localStorage.getItem('imdb_' + extData.imdb_id);
                if (cachedImdb) {
                    document.getElementById('rating-span').innerHTML = `<a href="https://www.imdb.com/title/${extData.imdb_id}" target="_blank" style="text-decoration:none; color:inherit;"><span class="imdb-badge">IMDb</span> ${cachedImdb}</a>`;
                } else {
                    fetch(`https://www.omdbapi.com/?apikey=cfcb7364&i=${extData.imdb_id}`)
                        .then(r => r.json())
                        .then(omdbData => {
                            if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") {
                                document.getElementById('rating-span').innerHTML = `<a href="https://www.imdb.com/title/${extData.imdb_id}" target="_blank" style="text-decoration:none; color:inherit;"><span class="imdb-badge">IMDb</span> ${omdbData.imdbRating}</a>`;
                                localStorage.setItem('imdb_' + extData.imdb_id, omdbData.imdbRating);
                            }
                        }).catch(err => console.error("OMDb API hatası:", err));
                }
            }
        }).catch(err => console.error("TMDB external_ids hatası:", err));

        // Add Watchlist Button to Modal
        const watchlist = JSON.parse(localStorage.getItem('watchlist')) || [];
        const isInWatchlist = watchlist.some(w => w.id === item.id);
        const wlText = isInWatchlist ? 'Listeden Çıkar' : 'Listeme Ekle';
        const wlColor = isInWatchlist ? 'var(--primary-color)' : 'rgba(255,255,255,0.2)';
        
        const wlBtnHtml = `<button id="modal-wl-btn" onclick="toggleWatchlist(this, ${item.id})" class="btn-buy-ticket" style="margin-top: 15px; width: 100%; border-radius: 20px; font-weight: bold; font-size: 1.1rem; background: ${wlColor};"><i class="fas fa-heart"></i> ${wlText}</button>`;
        
        const actionsDiv = document.querySelector('.details-left');
        if (actionsDiv) {
            const existingBtn = document.getElementById('modal-wl-btn');
            if (existingBtn) existingBtn.remove();
            actionsDiv.insertAdjacentHTML('beforeend', wlBtnHtml);
        }

        modal.classList.add('active');
        document.body.style.overflow = "hidden";
    
    const castContainer = document.getElementById('details-cast');
    castContainer.innerHTML = "<div style='color:#ccc'>Oyuncular yükleniyor...</div>";
    
    try {
        const res = await fetch(`${BASE_URL}/${item.media_type}/${item.id}/credits?api_key=${API_KEY}&language=tr-TR`);
        const data = await res.json();
        const cast = data.cast.slice(0, 10);
        
        if (cast.length === 0) {
            castContainer.innerHTML = "<div style='color:#ccc'>Oyuncu bilgisi bulunamadı.</div>";
            return;
        }
        
        let castHtml = "";
        cast.forEach(actor => {
            const actorImg = actor.profile_path ? IMAGE_BASE + actor.profile_path : 'https://via.placeholder.com/150x150?text=Foto';
            castHtml += `
                <div class="actor-card" style="cursor:pointer" onclick="openActorDetails(${actor.id}, '${actor.name.replace(/'/g, "\\'")}')">
                    <img src="${actorImg}" alt="${actor.name}">
                    <div class="actor-name" title="${actor.name}">${actor.name}</div>
                </div>
            `;
        });
        castContainer.innerHTML = castHtml;
        
    } catch (e) {
        castContainer.innerHTML = "<div style='color:red'>Oyuncular çekilemedi.</div>";
    }

    // Load Recommendations
    const recContainer = document.getElementById('details-recommendations');
    if (recContainer) {
        recContainer.innerHTML = "<div style='color:#ccc'>Öneriler yükleniyor...</div>";
        fetch(`${BASE_URL}/${item.media_type}/${item.id}/recommendations?api_key=${API_KEY}&language=tr-TR`)
            .then(res => res.json())
            .then(data => {
                const recs = data.results.slice(0, 10);
                if (recs.length === 0) {
                    recContainer.innerHTML = "<div style='color:#ccc'>Öneri bulunamadı.</div>";
                    return;
                }
                let recHtml = "";
                recs.forEach(rec => {
                    // Cache the recommended item
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
            }).catch(() => recContainer.innerHTML = "<div style='color:red'>Öneriler çekilemedi.</div>");
    }
}

async function openActorDetails(actorId, actorName, reset = true) {
    if (reset) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        closeDetails(null, true);
        currentMode = "actor";
        currentActorId = actorId;
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
        container.innerHTML = `<div class='loading'>${actorName} yapımları çekiliyor...</div>`;
        document.getElementById('loadMoreBtn').style.display = 'none';
    }
    
    try {
        const [personRes, creditsRes] = await Promise.all([
            fetch(`${BASE_URL}/person/${currentActorId}?api_key=${API_KEY}&language=tr-TR`),
            fetch(`${BASE_URL}/person/${currentActorId}/combined_credits?api_key=${API_KEY}&language=tr-TR`)
        ]);
        
        const personData = await personRes.json();
        const data = await creditsRes.json();
        
        let movies = data.cast || [];
        
        // Exclude talk shows locally
        movies = movies.filter(m => !(m.genre_ids && (m.genre_ids.includes(10767) || m.genre_ids.includes(10763) || m.genre_ids.includes(10764))));
        
        const mediaType = document.getElementById('mediaTypeFilter').value;
        if (mediaType === "movie") {
            movies = movies.filter(m => m.media_type === "movie");
        } else if (mediaType === "tv") {
            movies = movies.filter(m => m.media_type === "tv");
        }
        
        const genreId = parseInt(document.getElementById('genreFilter').value);
        if (genreId) {
            movies = movies.filter(m => m.genre_ids && m.genre_ids.includes(genreId));
        }
        
        const ratingFilter = parseFloat(document.getElementById('ratingFilter').value);
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
            
            container.innerHTML = "";
            if (bioText || birthDate) {
                container.innerHTML = `
                    <div class="actor-bio-card" style="grid-column: 1 / -1; width: 100%; max-width: 800px; margin: 0 auto 20px auto; padding: 20px; background: var(--card-bg); border-radius: 15px; border: 1px solid var(--glass-border); color: var(--text-muted); font-size: 0.95rem;">
                        <div style="display:flex; align-items:flex-start; gap: 20px; margin-bottom: 10px;">
                            <img src="${personData.profile_path ? IMAGE_BASE + personData.profile_path : 'https://via.placeholder.com/60x90'}" style="width: 80px; height: 120px; border-radius: 10px; object-fit: cover; flex-shrink: 0;">
                            <div style="max-height: 150px; overflow-y: auto; padding-right: 10px;">
                                <h3 style="color: var(--text-color); margin: 0 0 5px 0; font-size: 1.5rem;">${personData.name}</h3>
                                ${bioHtml}
                            </div>
                        </div>
                    </div>
                `;
            }
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

function closeDetails(event, force = false) {
    if (force || event.target.id === 'details-modal' || event.target.closest('.close-btn')) {
        const modal = document.getElementById('details-modal');
        modal.classList.remove('active');
        document.body.style.overflow = "auto";
    }
}
