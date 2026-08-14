function openDetails(movieId) {
    navigate('movie/' + movieId);
}

async function renderMovie(movieId, routeContext) {
    const modal = document.getElementById('details-modal');
    if (modal) modal.style.display = 'flex';

    document.body.style.overflow = "hidden";
    window.currentMovieId = movieId;

    try {
    let data;
    try {
        let res = await fetch(`${BASE_URL}/movie/${movieId}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        data = await res.json();
        if (data.status_code === 34) {
            res = await fetch(`${BASE_URL}/tv/${movieId}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
            data = await res.json();
            data.title = data.name;
            data.media_type = "tv";
        } else {
            data.media_type = "movie";
        }
        
        if (routeContext && routeContext.generation !== routeGeneration) {
            return; 
        }
        
        if (data.id) {
            window.movieCache[movieId] = data;
        }
    } catch(e) {
        if (e.name === 'AbortError') return;
        console.error(e);
    }
    
    if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
    
    const item = window.movieCache[movieId];
    if (!item) return;
    
    if (!item.media_type || item.media_type === "undefined") {
        item.media_type = (item.first_air_date || item.name && !item.title) ? "tv" : "movie";
    }

    // Quick API validation for legacy items that might have wrong media_type
    try {
        let verifyRes = await fetch(`${BASE_URL}/${item.media_type}/${item.id}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        let verifyData = await verifyRes.json();
        if (verifyData.status_code === 34) {
            item.media_type = item.media_type === "movie" ? "tv" : "movie";
            window.movieCache[movieId].media_type = item.media_type;
            
            let wl = JSON.parse(localStorage.getItem('watchlist') || '[]');
            let wlIndex = wl.findIndex(w => w.id === item.id);
            if (wlIndex > -1) {
                wl[wlIndex].media_type = item.media_type;
                localStorage.setItem('watchlist', JSON.stringify(wl));
            }
        }
    } catch(e) {
        if (e.name === 'AbortError') return;
    }

    if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;

    const modal = document.getElementById('details-modal');
    
    // Add to recently viewed
    let recent = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
    recent = recent.filter(r => r.id !== item.id);
    recent.unshift(item);
    if(recent.length > 10) recent.pop();
    localStorage.setItem('recentlyViewed', JSON.stringify(recent));
    renderRecentlyViewed();

    if (modal) {
        modal.scrollTo(0, 0);
        const detailsContent = modal.querySelector('.details-content');
        if (detailsContent) {
            detailsContent.scrollTop = 0;
        }
    }
    
    
    document.getElementById('details-title').innerText = item.title;
    document.getElementById('details-overview').innerText = item.overview || "Bu yapım için konu özeti bulunmuyor.";
    
    const posterUrl = item.poster_path ? IMAGE_BASE + item.poster_path : 'https://via.placeholder.com/500x750?text=Afiş+Yok';
    const posterImgElem = document.getElementById('details-poster');
    posterImgElem.crossOrigin = "Anonymous";
    
    // Dynamic Theme (ColorThief)
    posterImgElem.onload = function() {
        if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
        try {
            if (typeof ColorThief !== 'undefined') {
                const colorThief = new ColorThief();
                const color = colorThief.getColor(posterImgElem);
                if (color) {
                    document.documentElement.style.setProperty('--primary-color', `rgb(${color[0]}, ${color[1]}, ${color[2]})`);
                    
                    // Lighter accent
                    const accentR = Math.min(255, color[0] + 50);
                    const accentG = Math.min(255, color[1] + 50);
                    const accentB = Math.min(255, color[2] + 50);
                    document.documentElement.style.setProperty('--accent-color', `rgb(${accentR}, ${accentG}, ${accentB})`);
                }
            }
        } catch(e) {
            console.log("ColorThief couldn't extract color:", e);
        }
    };
    
    // Cache buster to force CORS reload if already cached without CORS
    posterImgElem.src = posterUrl.includes('?') ? posterUrl + '&cb=' + new Date().getTime() : posterUrl + '?cb=' + new Date().getTime();
    
    const backdropUrl = item.backdrop_path ? BACKDROP_BASE + item.backdrop_path : posterUrl;
    document.getElementById('details-backdrop').style.backgroundImage = `url(${backdropUrl})`;
    
    // Ambilight Injection
    const ambilightEl = document.getElementById('ambilight-bg');
    if (ambilightEl) {
        ambilightEl.style.backgroundImage = `url(${backdropUrl})`;
    }
    
    const rating = item.vote_average ? item.vote_average.toFixed(1) : "N/A";
    const genresHtml = (item.genre_ids || []).map(id => {
        const name = genreMap[id];
        return name ? `<span class="genre-badge" onclick="searchByGenre(${id})" title="Bu türde ara">${name}</span>` : '';
    }).join(' <span style="color:var(--text-muted); font-size: 0.7rem; display:flex; align-items:center; justify-content:center;">&bull;</span> ');
    
    const d = new Date(item.release_date || item.first_air_date || "");
    const formattedDate = d.toString() !== "Invalid Date" ? d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : "Bilinmiyor";
    
    const dateBadge = document.getElementById('details-date-badge');
    if (dateBadge) {
        if (formattedDate !== "Bilinmiyor") {
            dateBadge.innerText = formattedDate;
            dateBadge.style.display = "block";
        } else {
            dateBadge.style.display = "none";
        }
    }
    
    // Default TMDB rating HTML
    const metaContainer = document.getElementById('details-meta');
    metaContainer.innerHTML = `<span id="rating-span"><i class="fas fa-star" style="color:#fbbf24"></i> ${rating}</span> <span>|</span> <div style="display:inline-flex; flex-wrap:wrap; gap:5px; max-width:250px; align-items:center;">${genresHtml}</div>`;

    const provContainer = document.getElementById('modal-providers');
    provContainer.style = "margin-top: 15px; display:flex; gap:10px; align-items:center; justify-content: center; flex-wrap: wrap;";
    provContainer.innerHTML = "Platformlar aranıyor...";

    // Modal Provider Fetch (WITH DEEP LINKS)
    fetch(`${BASE_URL}/${item.media_type}/${item.id}/watch/providers?api_key=${API_KEY}`, { signal: routeContext?.signal })
        .then(res => res.json())
        .then(data => {
            if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
            const tr = data.results && data.results.TR ? data.results.TR : null;
            const provContainer = document.getElementById('modal-providers');
            if (tr && tr.flatrate) {
                let html = "<span style='color:var(--text-muted); font-size:0.95rem; font-weight:bold;'>İzlenebilir:</span> ";
                const watchLink = tr.link || "#";
                tr.flatrate.forEach(p => {
                    html += `<a href="${watchLink}" target="_blank" title="${p.provider_name} Üzerinde İzle"><img src="${IMAGE_BASE + p.logo_path}" style="width:35px; height:35px; border-radius:8px; box-shadow: 0 2px 5px rgba(0,0,0,0.5); cursor:pointer;" loading="lazy"></a>`;
                });
                provContainer.innerHTML = html;
            } else {
                provContainer.innerHTML = "<span style='color:var(--text-muted); font-size:0.9rem;'>Türkiye'de dijital yayını yok</span>";
            }
        }).catch(err => {
            if (err.name === 'AbortError') return;
            const provContainer = document.getElementById('modal-providers');
            if(provContainer) provContainer.innerHTML = "<span style='color:var(--text-muted); font-size:0.9rem;'>Platform bilgisi alınamadı</span>";
        });

    // Full Fetch for Premium Features
    const castContainer = document.getElementById('details-cast');
    const recContainer = document.getElementById('details-recommendations');
    const rightPanel = document.querySelector('.details-right');
    const videoBgContainer = document.getElementById('video-bg-container');
    const backdropEl = document.getElementById('details-backdrop');
    
    // Clear old dynamic elements
    const oldCol = document.getElementById('collection-container');
    if(oldCol) oldCol.remove();
    const oldTv = document.getElementById('tv-guide-container');
    if(oldTv) oldTv.remove();
    
    if(videoBgContainer) {
        videoBgContainer.innerHTML = "";
        videoBgContainer.style.opacity = "0";
    }
    if(backdropEl) backdropEl.style.display = "block";

    castContainer.innerHTML = "<div style='color:#ccc'>Oyuncular yükleniyor...</div>";
    if(recContainer) recContainer.innerHTML = "<div style='color:#ccc'>Öneriler yükleniyor...</div>";

    fetch(`${BASE_URL}/${item.media_type}/${item.id}?api_key=${API_KEY}&language=tr-TR&append_to_response=videos,credits,recommendations,external_ids`, { signal: routeContext?.signal })
        .then(res => res.json())
        .then(async fullData => {
            if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
            if (fullData.overview) {
                document.getElementById('details-overview').innerText = fullData.overview;
                item.overview = fullData.overview;
                
                let r = JSON.parse(localStorage.getItem('recentlyViewed') || '[]');
                let i = r.findIndex(x => x.id === item.id);
                if(i > -1) {
                    r[i].overview = fullData.overview;
                    localStorage.setItem('recentlyViewed', JSON.stringify(r));
                }
            }

            const runtime = fullData.runtime || (fullData.episode_run_time && fullData.episode_run_time.length > 0 ? fullData.episode_run_time[0] : (fullData.last_episode_to_air && fullData.last_episode_to_air.runtime ? fullData.last_episode_to_air.runtime : null));
            if (runtime) {
                const metaContainer = document.getElementById('details-meta');
                if (metaContainer && !metaContainer.innerHTML.includes(runtime + ' dk')) {
                    let runtimeHtml = ` <span>|</span> <span>${runtime} dk`;
                    if (item.media_type === "tv" && fullData.number_of_episodes > 0) {
                        const totalMins = runtime * fullData.number_of_episodes;
                        const hours = Math.floor(totalMins / 60);
                        const mins = totalMins % 60;
                        runtimeHtml += ` / Bölüm (Toplam: ${hours}s ${mins}d)`;
                    }
                    runtimeHtml += `</span>`;
                    metaContainer.innerHTML += runtimeHtml;
                }
            }

            // IMDb Badge
            if (fullData.external_ids && fullData.external_ids.imdb_id) {
                const imdbId = fullData.external_ids.imdb_id;
                window.currentImdbId = imdbId;
                const cachedImdb = localStorage.getItem('imdb_' + imdbId);
                if (cachedImdb) {
                    document.getElementById('rating-span').innerHTML = `<a href="https://www.imdb.com/title/${imdbId}" target="_blank" style="text-decoration:none; color:inherit;"><span class="imdb-badge">IMDb</span> ${cachedImdb}</a>`;
                } else {
                    fetch(`https://www.omdbapi.com/?apikey=cfcb7364&i=${imdbId}`, { signal: routeContext?.signal })
                        .then(r => r.json())
                        .then(omdbData => {
                            if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
                            if (omdbData.imdbRating && omdbData.imdbRating !== "N/A") {
                                document.getElementById('rating-span').innerHTML = `<a href="https://www.imdb.com/title/${imdbId}" target="_blank" style="text-decoration:none; color:inherit;"><span class="imdb-badge">IMDb</span> ${omdbData.imdbRating}</a>`;
                                localStorage.setItem('imdb_' + imdbId, omdbData.imdbRating);
                            }
                        }).catch(e => {
                            if (e.name === 'AbortError') return;
                        });
                }
            }

            // Video Background (Only PC)
            if (window.innerWidth > 768 && videoBgContainer && fullData.videos && fullData.videos.results.length > 0) {
                // Try to find a trailer
                let video = fullData.videos.results.find(v => v.site === "YouTube" && v.type === "Trailer");
                if(!video) video = fullData.videos.results.find(v => v.site === "YouTube");
                
                if (video) {
                    videoBgContainer.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${video.key}?autoplay=1&mute=1&controls=0&loop=1&playlist=${video.key}&modestbranding=1&showinfo=0&rel=0&iv_load_policy=3&enablejsapi=1" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
                    
                    // Şirket interneti engellemesini (Hata 152 / Beyaz Ekran) tespit etmek için ufak bir bağlantı testi
                    fetch('https://www.youtube-nocookie.com/favicon.ico', { mode: 'no-cors', signal: routeContext?.signal })
                        .then(() => {
                            if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
                            // Bağlantı başarılı, videoyu göster
                            setTimeout(() => {
                                if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
                                videoBgContainer.style.opacity = "1";
                                if(backdropEl) backdropEl.style.display = "none"; // Video oynayacağı için resmi kaldır
                            }, 1000);
                        })
                        .catch((err) => {
                            if (err.name === 'AbortError') return;
                            // Bağlantı reddedildi (Şirket ağı engelledi)
                            // Videoyu hiç gösterme, arka plandaki resim kalsın.
                            console.warn("YouTube bağlantısı engellendi, video arka planı iptal edildi.");
                        });
                }
            }

            if (fullData.credits && fullData.credits.crew) {
                const director = fullData.credits.crew.find(c => c.job === 'Director');
                if (director) {
                    const safeName = director.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                    const directorHtml = `<div id="director-badge-container" style="margin-top: 10px; margin-bottom: 10px; display: inline-block; background: rgba(0, 0, 0, 0.6); padding: 5px 12px; border-radius: 15px; border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 2px 4px rgba(0,0,0,0.3); backdrop-filter: blur(5px); transition: all 0.5s ease;"><span style="cursor:pointer; color:#fff; font-weight:bold; font-size: 0.95rem; text-shadow: 0 2px 4px rgba(0,0,0,0.8);" onclick="openActorDetails(${director.id}, '${safeName}', true, 'Director')" title="${director.name.replace(/"/g, '&quot;')} filmleri"><i class="fas fa-bullhorn" style="color: var(--accent-color); margin-right: 5px;"></i> Yönetmen: ${director.name}</span></div>`;
                    const metaContainer = document.getElementById('details-meta');
                    if (metaContainer) {
                        metaContainer.innerHTML += directorHtml;
                    }
                    if (item.backdrop_path) {
                        const backdrop = IMAGE_BASE + item.backdrop_path;
                        const img = new Image();
                        img.crossOrigin = "Anonymous";
                        img.onload = () => {
                            if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
                            try {
                                const colorThief = new ColorThief();
                                const color = colorThief.getColor(img);
                                const rgb = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`;
                                const dirBadge = document.getElementById('director-badge-container');
                                if (dirBadge) {
                                    dirBadge.style.background = rgb;
                                    dirBadge.style.boxShadow = `0 4px 15px rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.5)`;
                                    dirBadge.style.border = `1px solid rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`;
                                }
                            } catch(e) {}
                        };
                        img.src = backdrop;
                    }
                }
            }
            
            // Başrol Oyuncuları
            if (fullData.credits && fullData.credits.cast) {
                const cast = fullData.credits.cast.slice(0, 10);
                if (cast.length > 0) {
                    let castHtml = "";
                    cast.forEach(actor => {
                        const actorImg = actor.profile_path ? IMAGE_BASE + actor.profile_path : 'https://via.placeholder.com/150x150?text=Foto';
                        const safeActorName = actor.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                        castHtml += `
                            <div class="actor-card" style="cursor:pointer" onclick="openActorDetails(${actor.id}, '${safeActorName}')" onmouseenter="showActorTooltip(this, ${actor.id})" onmouseleave="hideActorTooltip(this)">
                                <img src="${actorImg}" alt="${actor.name}" loading="lazy">
                                <div class="actor-name" title="${actor.name}">${actor.name}</div>
                                <div class="actor-tooltip">Yükleniyor...</div>
                            </div>
                        `;
                    });
                    castContainer.innerHTML = castHtml;
                } else {
                    castContainer.innerHTML = "<div style='color:#ccc'>Oyuncu bilgisi bulunamadı.</div>";
                }
            }

            // Recommendations
            if (fullData.recommendations && fullData.recommendations.results && recContainer) {
                const recs = fullData.recommendations.results.slice(0, 10);
                if (recs.length > 0) {
                    let recHtml = "";
                    recs.forEach(rec => {
                        window.movieCache[rec.id] = {
                            id: rec.id, title: rec.title || rec.name, name: rec.title || rec.name, overview: rec.overview,
                            poster_path: rec.poster_path, backdrop_path: rec.backdrop_path,
                            release_date: rec.release_date, first_air_date: rec.first_air_date,
                            vote_average: rec.vote_average, genre_ids: rec.genre_ids,
                            media_type: rec.media_type || item.media_type
                        };
                        const rImg = rec.poster_path ? IMAGE_BASE + rec.poster_path : 'https://via.placeholder.com/100x150?text=Yok';
                        const rTitle = rec.title || rec.name;
                        recHtml += `
                            <div class="recommendation-card" onclick="openDetails(${rec.id})">
                                <img src="${rImg}" alt="${rTitle}" loading="lazy">
                                <div class="recommendation-title" title="${rTitle}">${rTitle}</div>
                            </div>
                        `;
                    });
                    recContainer.innerHTML = recHtml;
                    makeScrollable(recContainer);
                } else {
                    recContainer.innerHTML = "<div style='color:#ccc'>Öneri bulunamadı.</div>";
                }
            }

            // TV Show Seasons
            if (item.media_type === "tv" && fullData.seasons && fullData.seasons.length > 0) {
                let seasonOptions = "";
                fullData.seasons.forEach(s => {
                    if (s.season_number > 0) { // Sadece normal sezonlar (Özel gösterimleri çıkar)
                        seasonOptions += `<option value="${s.season_number}">${s.name} (${s.episode_count} Bölüm)</option>`;
                    }
                });
                
                if (seasonOptions) {
                    const tvHtml = `
                        <div id="tv-guide-container" class="collection-section">
                            <h3 class="cast-title">Dizi Sezon Rehberi</h3>
                            <div class="season-select-wrapper">
                                <select class="season-select" onchange="loadSeasonEpisodes(${item.id}, this.value)">
                                    <option value="" disabled selected>Bir sezon seçin...</option>
                                    ${seasonOptions}
                                </select>
                            </div>
                            <div id="episodes-container" class="episode-list"></div>
                        </div>
                    `;
                    castContainer.previousElementSibling.insertAdjacentHTML('beforebegin', tvHtml);
                    
                    const firstSeason = fullData.seasons.find(s => s.season_number > 0) || fullData.seasons[0];
                    if (firstSeason) {
                        document.querySelector('.season-select').value = firstSeason.season_number;
                        loadSeasonEpisodes(item.id, firstSeason.season_number, routeContext);
                    }
                }
            }

            // Collections
            if (item.media_type === "movie" && fullData.belongs_to_collection) {
                const colRes = await fetch(`${BASE_URL}/collection/${fullData.belongs_to_collection.id}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
                const colData = await colRes.json();
                
                if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
                
                if (colData.parts && colData.parts.length > 0) {
                    colData.parts.sort((a, b) => new Date(a.release_date) - new Date(b.release_date));
                    
                    const collectionTitle = colData.name.replace(/\[Seri\]/gi, "").replace(/Serisi/gi, "").replace(/Collection/gi, "").trim() + " Serisi";
                    let colHtml = `
                        <div id="collection-container" class="collection-section">
                            <h3 class="cast-title">${collectionTitle}</h3>
                            <div class="collection-list">
                    `;
                    
                    colData.parts.forEach(part => {
                        window.movieCache[part.id] = {
                            id: part.id, title: part.title, name: part.title, overview: part.overview,
                            poster_path: part.poster_path, backdrop_path: part.backdrop_path,
                            release_date: part.release_date, vote_average: part.vote_average,
                            genre_ids: part.genre_ids, media_type: "movie"
                        };
                        const pImg = part.poster_path ? IMAGE_BASE + part.poster_path : 'https://via.placeholder.com/100x150?text=Yok';
                        colHtml += `
                            <div class="recommendation-card" onclick="openDetails(${part.id})">
                                <img src="${pImg}" alt="${part.title}" style="${part.id === item.id ? 'outline: 3px solid var(--primary-color); outline-offset: -3px; border-radius: 10px;' : ''}" loading="lazy">
                                <div class="recommendation-title" title="${part.title}">${part.title}</div>
                            </div>
                        `;
                    });
                    colHtml += `</div></div>`;
                    
                    if(recContainer) recContainer.previousElementSibling.insertAdjacentHTML('beforebegin', colHtml);
                }
            }
        }).catch(err => {
            if (err.name === 'AbortError') return;
            console.error("Full fetch error", err);
            castContainer.innerHTML = "<div style='color:red'>Veriler çekilemedi.</div>";
        });
        
    // Modal Actions (Watchlist, Rate, Trailer, Share)
    const watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
    const isInWatchlist = watchlist.some(m => m.id === item.id);
    const wlText = isInWatchlist ? "Listeden Çıkar" : "Listeme Ekle";
    const wlClass = isInWatchlist ? 'active' : 'inactive';
    
    const wlBtnHtml = `<button id="modal-wl-btn" onclick="toggleWatchlist(this, ${item.id})" class="btn-watchlist ${wlClass}"><i class="fas fa-heart"></i> ${wlText}</button>`;
    
    const isUpcoming = item.release_date && new Date(item.release_date) > new Date();
    
    let rateBtnHtml = "";
    if (!isUpcoming) {
        const savedRatings = JSON.parse(localStorage.getItem('movieRatings') || '{}');
        const myRating = savedRatings[item.id];
        const rateText = myRating ? `⭐ ${myRating}/10` : "İzledim / Puan Ver";
        const rateClass = myRating ? 'active' : 'inactive';
        
        rateBtnHtml = `<div style="position:relative; width:100%; margin-top: 10px;">
            <button onclick="toggleRateMenu(${item.id})" class="btn-watchlist ${rateClass}" style="width:100%;"><i class="fas fa-star"></i> <span id="rate-text-${item.id}">${rateText}</span></button>
            <div id="rate-menu-${item.id}" style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--card-bg); border-radius:10px; padding:10px; box-shadow:0 10px 20px rgba(0,0,0,0.5); z-index:10; border:1px solid var(--glass-border); flex-wrap:wrap; justify-content:center; gap:5px; margin-top:5px;">
                ${[1,2,3,4,5,6,7,8,9,10].map(n => `<button onclick="saveRating(${item.id}, ${n})" style="width:28px; height:28px; border-radius:5px; background:var(--primary-color); color:white; border:none; cursor:pointer;">${n}</button>`).join('')}
                <button onclick="removeRating(${item.id})" style="width:100%; margin-top:5px; padding:5px; border-radius:5px; background:rgba(229,9,20,0.8); color:white; border:none; cursor:pointer;">Puanı Sil</button>
            </div>
        </div>`;
    }
    
    const trailerBtnHtml = `<button onclick="openTrailer(${item.id}, '${item.media_type}')" class="btn-watchlist inactive" style="margin-top: 10px;"><i class="fas fa-play"></i> Fragmanı İzle</button>`;
    const shareBtnHtml = `<button onclick="shareMovie(${item.id})" class="btn-watchlist inactive" style="margin-top: 10px; background:rgba(255,255,255,0.05);"><i class="fas fa-share-alt"></i> Paylaş</button>`;
    
    const actionsDiv = document.querySelector('.details-left');
    if (actionsDiv) {
        // Clear previous buttons
        const oldBtns = actionsDiv.querySelectorAll('.btn-watchlist, [id^="rate-menu-"]');
        oldBtns.forEach(b => { if(!b.closest('#modal-providers')) b.parentElement && b.parentElement.tagName === 'DIV' && b.parentElement.style.position === 'relative' ? b.parentElement.remove() : b.remove() });
        
        const combinedHtml = wlBtnHtml + rateBtnHtml + trailerBtnHtml + shareBtnHtml;
        
        const providersDiv = document.getElementById('modal-providers');
        if (providersDiv) {
            providersDiv.insertAdjacentHTML('beforebegin', combinedHtml);
        } else {
            actionsDiv.insertAdjacentHTML('beforeend', combinedHtml);
        }
    }

    if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;

    modal.classList.add('active');
    document.body.style.overflow = "hidden";
    
    // History API handled centrally
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.error(e);
    }
}

function searchByGenre(genreId) {
    closeDetails(null, true);
    resetPlatformView();
    
    const select = document.getElementById('genreFilter');
    if (select) {
        let matchedValue = "";
        Array.from(select.options).forEach(opt => {
            if (opt.value === String(genreId) || opt.value.split('|').includes(String(genreId))) {
                matchedValue = opt.value;
            }
        });
        
        if (matchedValue) {
            select.value = matchedValue;
        } else {
            select.value = genreId;
        }
    }
    
    loadPlatformMovies(0, true);
}

async function openTrailer(id, mediaType) {
    const modal = document.getElementById('trailer-modal');
    const container = document.getElementById('video-container');
    
    container.innerHTML = "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Fragman Aranıyor...</div>";
    modal.classList.add('active');

    const bgIframe = document.querySelector('#video-bg-container iframe');
    if (bgIframe && bgIframe.contentWindow) {
        bgIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    }

    try {
        const res = await fetch(`${BASE_URL}/${mediaType}/${id}/videos?api_key=${API_KEY}`);
        const data = await res.json();
        
        let trailer = data.results.find(v => v.site === "YouTube" && v.type === "Trailer");
        if (!trailer && data.results.length > 0) trailer = data.results.find(v => v.site === "YouTube");
        
        if (trailer) {
            container.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${trailer.key}?autoplay=1&rel=0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
        } else {
            container.innerHTML = "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Bu yapım için fragman bulunamadı 😔</div>";
        }
    } catch (e) {
        container.innerHTML = "<div style='color:red;text-align:center;padding-top:20%;'>Fragman yüklenirken hata oluştu!</div>";
    }
}

function closeTrailer(event, force = false) {
    if (force || (event && event.target.id === 'trailer-modal')) {
        const modal = document.getElementById('trailer-modal');
        const container = document.getElementById('video-container');
        modal.classList.remove('active');
        container.innerHTML = ""; 
        
        const bgIframe = document.querySelector('#video-bg-container iframe');
        if (bgIframe && bgIframe.contentWindow) {
            bgIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
        }
    }
}

function closeDetails(event, force = false) {
    if (force || (event && (event.target.id === 'details-modal' || event.target.closest('.close-btn')))) {
        const hash = window.location.hash || "";
        if (!hash.startsWith('#movie/')) return;
        
        const state = history.state;
        if (state && state.filmRehberiRouter && state.filmRehberiRouter.index > 0) {
            history.back();
        } else {
            navigate('platform', { replace: true });
        }
    }
}

// =========================================
// V5: PREMIUM FONKSİYONLAR (Tooltip, TV)
// =========================================

async function loadSeasonEpisodes(tvId, seasonNumber, routeContext = null) {
    const container = document.getElementById('episodes-container');
    if (!container) return;
    
    // Güvenli Snapshot
    routeContext = routeContext || { generation: routeGeneration, signal: currentAbortController?.signal };
    
    container.innerHTML = "<div class='loading'>Bölümler yükleniyor...</div>";
    try {
        const res = await fetch(`${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        const data = await res.json();
        
        if (!isRouteContextCurrent(routeContext, "movie", tvId)) return;
        
        if (data.episodes && data.episodes.length > 0) {
            let html = "";
            data.episodes.forEach(ep => {
                const img = ep.still_path ? IMAGE_BASE + ep.still_path : 'https://via.placeholder.com/120x70?text=Afiş+Yok';
                const airDate = ep.air_date ? new Date(ep.air_date).toLocaleDateString('tr-TR') : 'Bilinmiyor';
                
                const imdbUrl = window.currentImdbId ? `https://www.imdb.com/title/${window.currentImdbId}/episodes?season=${seasonNumber}` : `https://www.themoviedb.org/tv/${tvId}/season/${seasonNumber}/episode/${ep.episode_number}`;
                
                html += `
                    <div class="episode-card" style="cursor:pointer; position:relative; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'" onclick="window.open('${imdbUrl}', '_blank')" title="IMDb Sayfasını Aç">
                        <img src="${img}" alt="${ep.name}" loading="lazy">
                        <div class="episode-info">
                            <h4>${ep.episode_number}. ${ep.name} <i class="fab fa-imdb" style="color:#f5c518; margin-left:5px;"></i></h4>
                            <p style="color:var(--accent-color); font-weight:600; font-size:0.8rem; margin-bottom:5px;">Yayın: ${airDate}</p>
                            <p>${ep.overview || 'Bu bölüm için henüz özet bulunmuyor.'}</p>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        } else {
            container.innerHTML = "<div>Bu sezon için bölüm bulunamadı.</div>";
        }
    } catch(e) {
        if (e.name === 'AbortError') return;
        container.innerHTML = "<div style='color:red'>Hata oluştu.</div>";
    }
}