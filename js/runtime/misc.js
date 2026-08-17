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