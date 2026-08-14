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