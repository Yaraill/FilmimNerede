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
