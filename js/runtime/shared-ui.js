function updateCustomOptionVisibility(selectId, value, isVisible) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const option = select.querySelector(`option[value="${value}"]`);
    if (option) {
        option.hidden = !isVisible;
        option.disabled = !isVisible;
    }
    if (select.nextElementSibling && select.nextElementSibling.classList.contains('custom-select-container')) {
        const customOpt = select.nextElementSibling.querySelector(`.custom-option[data-value="${value}"]`);
        if (customOpt) {
            customOpt.style.display = isVisible ? 'block' : 'none';
        }
    }
}


function toggleSelectVisibility(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = show ? 'inline-block' : 'none';
    const wrapper = el.nextElementSibling;
    if (wrapper && wrapper.classList.contains('custom-select-container')) {
        wrapper.style.display = show ? 'inline-block' : 'none';
    }
}


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


function switchViewMode(mode) {
    const container = document.getElementById('search-results');
    const nowPlayingContainer = document.getElementById('now-playing-grid');
    const vizyonContainer = document.getElementById('upcoming-movies');
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


function createMovieCard(item, mediaType = "movie", tabContext = "") {
    const title = item.title || item.name;
    const year = (item.release_date || item.first_air_date || "").split('-')[0];
    const titleWithYear = year ? `${title} (${year})` : title;
    
    const poster = item.poster_path ? IMAGE_BASE + item.poster_path : 'https://placehold.co/500x750/1a1a2e/ffffff?text=Afis+Yok';
    const rating = item.vote_average ? item.vote_average.toFixed(1) : "N/A";
    
    const allGenres = (item.genre_ids || []).map(id => genreMap[id]).filter(Boolean);
    const genres = allGenres.slice(0, 3).join(', ') + (allGenres.length > 3 ? '...' : '');

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
                <div class="list-view-overview">
                    ${(item.overview && item.overview.trim().length > 0) ? item.overview : "Konu özeti bulunmuyor."}
                </div>
                <div class="bottom-group" style="margin-top: auto; display: flex; flex-direction: column; gap: 10px; padding-top: 10px; width: 100%; max-width: 280px;">
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
    imgElement.dataset.isHovered = 'true';
    
    hoverSlideshowTimer = setTimeout(async () => {
        if (imgElement.dataset.isHovered !== 'true') return;
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
        
        if (imgElement.dataset.isHovered !== 'true') return;
        
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
    imgElement.dataset.isHovered = 'false';
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

