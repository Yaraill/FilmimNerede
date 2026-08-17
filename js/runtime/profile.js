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