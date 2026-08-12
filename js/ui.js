
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




function togglePiP(e) {
    if (e) e.stopPropagation();
    const modal = document.getElementById('trailer-modal');
    modal.classList.toggle('pip-mode');
    
    // Enable background scrolling when in PiP mode
    if (modal.classList.contains('pip-mode')) {
        document.body.style.overflow = 'auto';
    } else {
        document.body.style.overflow = 'hidden';
    }
}
window.togglePiP = togglePiP;
