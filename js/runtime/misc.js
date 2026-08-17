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