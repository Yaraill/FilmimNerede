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