let trendingActorsAutoScrollInterval = null;
let curatedCollectionsAutoScrollInterval = null;

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
        if (trendingActorsAutoScrollInterval !== null) {
            clearInterval(trendingActorsAutoScrollInterval);
        }
        trendingActorsAutoScrollInterval = setInterval(() => {
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
    if (curatedCollectionsAutoScrollInterval !== null) {
        clearInterval(curatedCollectionsAutoScrollInterval);
    }
    curatedCollectionsAutoScrollInterval = setInterval(() => {
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
    const routeContext = {
        generation: routeGeneration,
        signal: currentAbortController?.signal
    };
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
        const res = await fetch(
            `${BASE_URL}/collection/${collectionId}?api_key=${API_KEY}&language=tr-TR`,
            { signal: routeContext.signal }
        );
        const data = await res.json();
        
        if (
            routeContext.signal?.aborted ||
            routeContext.generation !== routeGeneration
        ) return;
        
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
            fetchAndInjectProviders(item.id, 'movie', item, routeContext);
        });
    } catch (e) {
        if (e.name === 'AbortError') return;
        if (
            routeContext.signal?.aborted ||
            routeContext.generation !== routeGeneration
        ) return;
        container.innerHTML = "<div style='color:red'>Hata oluştu.</div>";
    }
}

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