function openActorDetails(actorId, actorName, reset = true, jobType = 'cast', filterGenre = 0, isFilterChange = false) {
    navigate('actor/' + actorId);
}

async function renderActor(actorId, actorName = "", reset = true, jobType = 'cast', filterGenre = 0, isFilterChange = false, routeContext = null) {
    routeContext = routeContext || { generation: routeGeneration, signal: currentAbortController?.signal };
    hideActorTooltip();
    
    if (reset) {
        if (!isFilterChange) {
                // Filter clearing moved to top
            }
        
        const detailsModal = document.getElementById('details-modal');
        if (detailsModal) detailsModal.style.display = 'none';

        currentMode = "actor";
        currentActorId = actorId;
        currentJobType = jobType;
        currentPage = 1;
        
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
        document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));
        document.getElementById('platform').classList.add('active-tab');
        const platformLink = document.querySelector('a[onclick*="platform"]');
        if (platformLink) platformLink.classList.add('active');
        
        document.querySelectorAll('.provider-filter-btn').forEach(btn => btn.classList.remove('active'));
        currentProvider = 0;
        
        toggleSelectVisibility('providerFilter', true);
        
        document.getElementById('searchInput').value = actorName;
        const container = document.getElementById('search-results');
        
        if (!isFilterChange) {
            container.innerHTML = "";
            showSkeletons('search-results', 10);
            document.getElementById('loadMoreBtn').style.display = 'none';
        } else {
            container.style.minHeight = container.offsetHeight + 'px';
            const oldMovies = container.querySelectorAll('.movie-card, .no-provider, .loading');
            oldMovies.forEach(m => m.remove());
            
            let skel = "";
            for(let i=0; i<10; i++) {
                skel += `<div class="movie-card skeleton-card" style="border:none; background:transparent;"><div class="skeleton" style="width:100%; height:300px; border-radius:10px;"></div><div class="skeleton" style="width:80%; height:20px; margin-top:10px;"></div><div class="skeleton" style="width:50%; height:15px; margin-top:5px;"></div></div>`;
            }
            container.insertAdjacentHTML('beforeend', skel);
        }
        
        document.getElementById('top10-section').style.display = 'none';
        const nowPlaying = document.getElementById('now-playing-section');
        if (nowPlaying) nowPlaying.style.display = 'none';
        const vizyon = document.getElementById('vizyon-section');
        if (vizyon) vizyon.style.display = 'none';
        
        const platformFilters = document.querySelector('.platform-filters');
        if (platformFilters) platformFilters.style.display = 'none';
        
        // moved below clearAllFilters
    }
    
    if (reset && !isFilterChange) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        clearAllFilters();
    }
    
    if (reset) {
        updateCustomOptionVisibility('sortByFilter', 'order.asc', jobType !== 'Director');
    }

    try {
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;

        const personRes = await fetch(`${BASE_URL}/person/${currentActorId}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        const personData = await personRes.json();
        
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        
        if (!actorName) {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = personData.name;
        }
        
        // EĞER KİŞİ ASLEN BİR YÖNETMENSE VE VARSAYILAN OLARAK 'CAST' GELDİYSE, ONU YÖNETMEN OLARAK DEĞİŞTİR!
        if (jobType === 'cast' && personData.known_for_department === 'Directing') {
            jobType = 'Director';
        }
        
        const filterProvId = parseInt(document.getElementById('providerFilter')?.value || "0");
        
        const creditsRes = await fetch(`${BASE_URL}/person/${currentActorId}/combined_credits?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        let data = await creditsRes.json();
        
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        
        let movies = [];
        if (jobType === 'Director') {
            movies = data.crew ? data.crew.filter(c => c.job === 'Director') : [];
            // Remove duplicates
            const seen = new Set();
            movies = movies.filter(item => {
                const duplicate = seen.has(item.id);
                seen.add(item.id);
                return !duplicate && item.poster_path;
            });
        } else {
            movies = data.cast || [];
            const seenCast = new Set();
            movies = movies.filter(item => {
                const isDup = seenCast.has(item.id);
                seenCast.add(item.id);
                return !isDup;
            });
            // Exclude talk shows locally
            movies = movies.filter(m => !(m.genre_ids && (m.genre_ids.includes(10767) || m.genre_ids.includes(10763) || m.genre_ids.includes(10764))));
        }
        
        // Exclude documentaries (genre 99) from actor/director filmography
        movies = movies.filter(m => !(m.genre_ids && m.genre_ids.includes(99)));

        // Exclude award shows, ceremonies, making-of, behind-the-scenes
        const blockedWords = ["award", "oscar", "grammy", "emmy", "golden globe", "bafta", "tony", "ceremony", "making of", "behind the scenes", "the making", "assembled", "a film by", "road to", "story of"];
        movies = movies.filter(m => {
            const title = (m.title || m.name || "").toLowerCase();
            return !blockedWords.some(w => title.includes(w));
        });

        // Only keep items with a poster (no poster = likely a minor production)
        movies = movies.filter(m => m.poster_path);
        
        
        const mediaType = document.getElementById('mediaTypeFilter')?.value || "all";
        if (mediaType === "movie") {
            movies = movies.filter(m => m.media_type === "movie");
        } else if (mediaType === "tv") {
            movies = movies.filter(m => m.media_type === "tv");
        }
        
        const genreFilterStr = document.getElementById('genreFilter')?.value || "";
        if (genreFilterStr !== "") {
            const selectedGenresArr = genreFilterStr.split(',').map(g => parseInt(g)).filter(g => !isNaN(g));
            if (selectedGenresArr.length > 0) {
                movies = movies.filter(m => m.genre_ids && selectedGenresArr.every(g => m.genre_ids.includes(g)));
            }
        } else if (filterGenre > 0) {
            movies = movies.filter(m => m.genre_ids && m.genre_ids.includes(parseInt(filterGenre)));
        }
        
        const yearFilterStr = document.getElementById('yearFilter')?.value || "";
        if (yearFilterStr !== "") {
            movies = movies.filter(m => {
                const y = m.release_date ? m.release_date.split('-')[0] : (m.first_air_date ? m.first_air_date.split('-')[0] : "");
                return y === yearFilterStr;
            });
        }
        
        const ratingFilter = parseFloat(document.getElementById('ratingFilter')?.value || "0");
        if (ratingFilter > 0) {
            movies = movies.filter(m => m.vote_average >= ratingFilter);
        }
        
        const runtimeFilter = document.getElementById('runtimeFilter')?.value || "";
        if (runtimeFilter !== "") {
            movies = movies.filter(m => m.media_type === "movie");
            
            const validMovies = [];
            const maxToCheck = Math.min(movies.length, 60);
            for (let i = 0; i < maxToCheck; i += 20) {
                const chunk = movies.slice(i, Math.min(i + 20, maxToCheck));
                const results = await Promise.all(chunk.map(async m => {
                    try {
                        const res = await fetch(`${BASE_URL}/movie/${m.id}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
                        const detail = await res.json();
                        const rt = detail.runtime || 0;
                        if (runtimeFilter == '90' && rt <= 90 && rt > 0) return m;
                        if (runtimeFilter == '120' && rt > 90 && rt <= 105) return m;
                        if (runtimeFilter == '150' && rt > 105 && rt <= 135) return m;
                        if (runtimeFilter == '180' && rt > 135) return m;
                    } catch (e) { if (e.name === 'AbortError') throw e; return null; }
                    return null;
                }));
                validMovies.push(...results.filter(Boolean));
                if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
            }
            movies = validMovies;
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
                const dA = a.release_date || a.first_air_date;
                const dB = b.release_date || b.first_air_date;
                const dateA = dA ? new Date(dA).getTime() : 0;
                const dateB = dB ? new Date(dB).getTime() : 0;
                return sortBy.includes("desc") ? dateB - dateA : dateA - dateB;
            });
        } else {
            movies.sort((a, b) => b.popularity - a.popularity);
        }
        
        if (filterProvId > 0) {
            const regionStr = (filterProvId === 1899 || filterProvId === 384) ? 'US' : 'TR';
            const validMovies = [];
            const maxToCheck = Math.min(movies.length, 60);
            for (let i = 0; i < maxToCheck; i += 20) {
                const chunk = movies.slice(i, Math.min(i + 20, maxToCheck));
                const results = await Promise.all(chunk.map(async m => {
                    try {
                        const res = await fetch(`${BASE_URL}/${m.media_type}/${m.id}/watch/providers?api_key=${API_KEY}`, { signal: routeContext?.signal });
                        const data = await res.json();
                        const tr = data.results && data.results[regionStr] ? data.results[regionStr] : null;
                        if (tr && tr.flatrate && tr.flatrate.some(p => p.provider_id === filterProvId)) return m;
                    } catch (e) { if (e.name === 'AbortError') throw e; return null; }
                    return null;
                }));
                validMovies.push(...results.filter(Boolean));
                if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
            }
            movies = validMovies;
        }
        
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        const startIndex = (currentPage - 1) * 20;
        const endIndex = startIndex + 20;
        const pagedMovies = movies.slice(startIndex, endIndex);
        
        const container = document.getElementById('search-results');
        
        let bioCardHtml = "";
        if (reset) {
            let bioText = personData.biography ? personData.biography : "";
            const birthDate = personData.birthday ? new Date(personData.birthday).getFullYear() : "";
            const birthPlace = personData.place_of_birth || "";
            let bioHtml = "";
            if(birthDate || birthPlace) bioHtml += `<strong>Doğum:</strong> ${birthDate} ${birthPlace} <br>`;
            bioHtml += bioText;
            
            // Check if favorite
            let favs = JSON.parse(localStorage.getItem('favoriteActors') || '[]');
            const isFav = favs.some(a => a.id === currentActorId);
            const favText = isFav ? "Favorilerden Çıkar" : "Favorilere Ekle";
            const favClass = isFav ? "active" : "inactive";
            
            if (!isFilterChange) {
                if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
                container.innerHTML = "";
                if (bioText || birthDate || true) { // Always show bio card even if empty bio, to show favorite button
                    bioCardHtml = `
                    <div id="actor-bio-card-container" class="actor-bio-card" style="grid-column: 1 / -1; width: 100%; max-width: 800px; margin: 0 auto 20px auto; padding: 20px; background: var(--card-bg); border-radius: 15px; border: 1px solid var(--glass-border); color: var(--text-muted); font-size: 0.95rem;">
                        <div style="display:flex; align-items:flex-start; gap: 20px; margin-bottom: 10px;">
                            <img src="${personData.profile_path ? IMAGE_BASE + personData.profile_path : 'https://via.placeholder.com/60x90'}" style="width: 80px; height: 120px; border-radius: 10px; object-fit: cover; flex-shrink: 0; user-select: none; -webkit-user-drag: none;" loading="lazy">
                            <div style="flex: 1; min-width: 0;">
                                <div style="display:flex; justify-content: flex-start; align-items: center; margin-bottom: 10px; gap: 10px;">
                                    <h3 style="color: var(--text-color); margin: 0; font-size: 1.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: calc(100% - 60px);">${personData.name}</h3>
                                    <button id="modal-actor-fav-btn" class="btn-watchlist ${favClass}" style="position:relative; z-index:10; margin-top:0; flex-shrink:0; border-radius:50%; width:35px; height:35px; padding:0; display:flex; align-items:center; justify-content:center; border:none; cursor:pointer;" onclick="toggleActorFavorite(this, ${personData.id}, '${personData.name.replace(/'/g, "\\'")}', '${personData.profile_path}')">
                                        <i class="fas fa-heart" style="font-size:1.2rem;"></i>
                                    </button>
                                </div>
                                <div style="max-height: 110px; overflow-y: auto; padding-right: 5px;">
                                    ${bioHtml}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                    container.innerHTML = bioCardHtml;
                }
            }
        }
        
        if (isFilterChange) {
            if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
            const skels = container.querySelectorAll('.skeleton-card');
            skels.forEach(s => s.remove());
        }
        
        if (pagedMovies.length === 0 && reset) {
            const emptyMsg = filterProvId > 0 ? (jobType === 'Director' ? "Yönetmenin bu platformda içeriği yok." : "Oyuncunun bu platformda içeriği yok.") : "Seçtiğiniz filtrelere uygun yapım bulunamadı.";
            if (!isFilterChange) {
                container.innerHTML = `
                    <div id="actor-bio-card-container" style="margin-bottom:30px;">
                        ${bioCardHtml}
                    </div>
                    <div class='loading' style='margin-top:20px; text-align:center;'>${emptyMsg}</div>
                `;
            } else {
                const existingMsgs = container.querySelectorAll('.loading');
                existingMsgs.forEach(m => m.remove());
                container.insertAdjacentHTML('beforeend', `<div class='loading' style='margin-top:20px; text-align:center;'>${emptyMsg}</div>`);
            }
            container.style.minHeight = '';
            document.getElementById('loadMoreBtn').style.display = 'none';
            return;
        }
        
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        for (let i = 0; i < pagedMovies.length; i++) {
            container.insertAdjacentHTML('beforeend', createMovieCard(pagedMovies[i], pagedMovies[i].media_type, ""));
            fetchAndInjectProviders(pagedMovies[i].id, pagedMovies[i].media_type, null, routeContext);
        }
        
        if (endIndex < movies.length) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        } else {
            document.getElementById('loadMoreBtn').style.display = 'none';
        }
        
        container.style.minHeight = '';
        
    } catch (e) {
        if (e.name === 'AbortError') return;
        if (reset) document.getElementById('search-results').innerHTML = "<div class='loading'>Hata oluştu.</div>";
    } finally {
        const spinner = document.getElementById('infinite-spinner');
        if (spinner) spinner.style.display = 'none';
    }
}