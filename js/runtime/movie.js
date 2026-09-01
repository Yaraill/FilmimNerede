function normalizeImdbRating(value) {
    let numeric = null;

    if (typeof value === 'number') {
        numeric = value;
    } else if (
        typeof value === 'string' &&
        /^(?:10(?:\.0+)?|[0-9](?:\.\d+)?)$/.test(
            value.trim()
        )
    ) {
        numeric = Number(value.trim());
    }

    if (
        !Number.isFinite(numeric) ||
        numeric <= 0 ||
        numeric > 10
    ) {
        return null;
    }

    return numeric.toFixed(1);
}


function openDetails(movieId, mediaType = null) {
    const safeMovieId =
        normalizeTmdbId(movieId);

    if (!safeMovieId) {
        return;
    }

    const explicitMediaType =
        normalizeMediaType(mediaType);

    if (explicitMediaType) {
        navigate(
            `movie/${safeMovieId}/${explicitMediaType}`
        );
        return;
    }

    const cachedMediaType =
        normalizeMediaType(
            window.movieCache[
                safeMovieId
            ]?.media_type
        );

    if (cachedMediaType) {
        navigate(
            `movie/${safeMovieId}/${cachedMediaType}`
        );
        return;
    }

    // Legacy route:
    // type bilinmiyorsa renderMovie()
    // mevcut movie -> tv fallback'ini yapacak.
    navigate(
        `movie/${safeMovieId}`
    );
}

async function renderMovie(
    movieId,
    routeContext,
    requestedMediaType = null
) {
    const safeMovieId =
        normalizeTmdbId(movieId);

    if (!safeMovieId) {
        return;
    }

    movieId = safeMovieId;

    requestedMediaType =
        normalizeMediaType(
            requestedMediaType
        );

    const modal =
        document.getElementById(
            'details-modal'
        );
    if (modal) modal.style.display = 'flex';

    document.body.style.overflow = "hidden";
    window.currentMovieId = movieId;

    // Önceki detaydan kalan IMDb ID'nin
    // yeni yapımın episode linklerine sızmasını önle.
    window.currentImdbId = null;

    try {
    let data;
    try {
        if (requestedMediaType === 'tv') {
            let res = await fetch(`${BASE_URL}/tv/${movieId}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
            data = await res.json();
            data.title = data.name;
            data.media_type = "tv";
        } else if (requestedMediaType === 'movie') {
            let res = await fetch(`${BASE_URL}/movie/${movieId}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
            data = await res.json();
            data.media_type = "movie";
        } else {
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
        }
        
        if (routeContext && routeContext.generation !== routeGeneration) {
            return; 
        }
        
        
        const fetchedId =
            normalizeTmdbId(data?.id);

        if (fetchedId === movieId) {
            data.id = movieId;

            data.media_type =
                normalizeMediaType(
                    data.media_type,
                    requestedMediaType
                ) ||
                (
                    data.first_air_date ||
                    (
                        data.name &&
                        !data.title
                    )
                        ? 'tv'
                        : 'movie'
                );

            window.movieCache[movieId] =
                data;
        }
    } catch(e) {
        if (e.name === 'AbortError') return;
        console.error(e);
    }
    
    if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
    
    const item =
        window.movieCache[movieId];

    if (
        !item ||
        typeof item !== 'object'
    ) {
        return;
    }

    item.id = movieId;

    item.media_type =
        normalizeMediaType(
            item.media_type
        ) ||
        (
            item.first_air_date ||
            (
                item.name &&
                !item.title
            )
                ? 'tv'
                : 'movie'
        );

    // Quick API validation for legacy items that might have wrong media_type
    try {
        let verifyRes = await fetch(`${BASE_URL}/${item.media_type}/${item.id}?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        let verifyData = await verifyRes.json();
        if (verifyData.status_code === 34) {
            item.media_type = item.media_type === "movie" ? "tv" : "movie";
            window.movieCache[movieId].media_type = item.media_type;
            
            let wl = [];

            try {
                const parsedWatchlist =
                    JSON.parse(
                        localStorage.getItem(
                            'watchlist'
                        ) ||
                        '[]'
                    );

                if (
                    Array.isArray(
                        parsedWatchlist
                    )
                ) {
                    wl = parsedWatchlist;
                }
            } catch (error) {
                console.warn(
                    'Watchlist okunamadı:',
                    error
                );
            }

            const wlIndex =
                wl.findIndex(
                    entry =>
                        normalizeTmdbId(
                            entry?.id
                        ) === item.id
                );

            if (wlIndex > -1) {
                wl[wlIndex].media_type =
                    item.media_type;

                localStorage.setItem(
                    'watchlist',
                    JSON.stringify(wl)
                );
            }
        }
    } catch(e) {
        if (e.name === 'AbortError') return;
    }

    if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;

    const modal = document.getElementById('details-modal');
    
    // Add to recently viewed
    let recent = [];

    try {
        const parsedRecent =
            JSON.parse(
                localStorage.getItem(
                    'recentlyViewed'
                ) ||
                '[]'
            );

        if (
            Array.isArray(
                parsedRecent
            )
        ) {
            recent = parsedRecent;
        }
    } catch (error) {
        console.warn(
            'Recently viewed okunamadı:',
            error
        );
    }

    recent =
        recent.filter(
            entry =>
                normalizeTmdbId(
                    entry?.id
                ) !== item.id
        );

    recent.unshift(item);

    if (recent.length > 10) {
        recent.pop();
    }

    localStorage.setItem(
        'recentlyViewed',
        JSON.stringify(recent)
    );
    renderRecentlyViewed(routeContext);

    if (modal) {
        modal.scrollTo(0, 0);
        const detailsContent = modal.querySelector('.details-content');
        if (detailsContent) {
            detailsContent.scrollTop = 0;
        }
    }
    
    
    const detailTitle =
        String(
            item.title ||
            item.name ||
            'Bilinmiyor'
        );

    document
        .getElementById('details-title')
        .textContent =
        detailTitle;

    document
        .getElementById('details-overview')
        .textContent =
        item.overview ||
        'Bu yapım için konu özeti bulunmuyor.';

    const posterUrl =
        getSafeTmdbImageUrl(
            item.poster_path,
            IMAGE_BASE,
            'https://via.placeholder.com/500x750?text=Afiş+Yok'
        );

    const posterImgElem =
        document.getElementById(
            'details-poster'
        );

    posterImgElem.crossOrigin =
        'Anonymous';

    posterImgElem.alt =
        detailTitle;
    
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
    
    const backdropUrl =
        getSafeTmdbImageUrl(
            item.backdrop_path,
            BACKDROP_BASE,
            posterUrl
        );

    const detailsBackdrop =
        document.getElementById(
            'details-backdrop'
        );

    if (detailsBackdrop) {
        detailsBackdrop.style.backgroundImage =
            `url("${backdropUrl}")`;
    }

    // Ambilight Injection
    const ambilightEl =
        document.getElementById(
            'ambilight-bg'
        );

    if (ambilightEl) {
        ambilightEl.style.backgroundImage =
            `url("${backdropUrl}")`;
    }
    
    const rawRating =
    item.vote_average;

    const rating =
        typeof rawRating === 'number' &&
        Number.isFinite(rawRating) &&
        rawRating > 0 &&
        rawRating <= 10
            ? rawRating.toFixed(1)
            : 'N/A';

    const metaContainer =
        document.getElementById(
            'details-meta'
        );

    if (metaContainer) {
        const ratingSpan =
            document.createElement(
                'span'
            );

        ratingSpan.id =
            'rating-span';

        const ratingIcon =
            document.createElement(
                'i'
            );

        ratingIcon.className =
            'fas fa-star';

        ratingIcon.style.color =
            '#fbbf24';

        ratingSpan.append(
            ratingIcon,
            document.createTextNode(
                ` ${rating}`
            )
        );

        const mainSeparator =
            document.createElement(
                'span'
            );

        mainSeparator.textContent =
            '|';

        const genresContainer =
            document.createElement(
                'div'
            );

        genresContainer.style.cssText =
            'display:inline-flex;' +
            'flex-wrap:wrap;' +
            'gap:5px;' +
            'max-width:250px;' +
            'align-items:center;';

        let renderedGenreCount = 0;

        const genreIds =
            Array.isArray(
                item.genre_ids
            )
                ? item.genre_ids
                : [];

        genreIds.forEach(rawGenreId => {
            const genreId =
                normalizeTmdbId(
                    rawGenreId
                );

            if (!genreId) {
                return;
            }

            const genreName =
                String(
                    genreMap[genreId] ??
                    ''
                ).trim();

            if (!genreName) {
                return;
            }

            if (renderedGenreCount > 0) {
                const separator =
                    document.createElement(
                        'span'
                    );

                separator.style.cssText =
                    'color:var(--text-muted);' +
                    'font-size:0.7rem;' +
                    'display:flex;' +
                    'align-items:center;' +
                    'justify-content:center;';

                separator.textContent =
                    '•';

                genresContainer.appendChild(
                    separator
                );
            }

            const genreBadge =
                document.createElement(
                    'span'
                );

            genreBadge.className =
                'genre-badge';

            genreBadge.title =
                'Bu türde ara';

            genreBadge.textContent =
                genreName;

            genreBadge.addEventListener(
                'click',
                () => {
                    searchByGenre(
                        genreId
                    );
                }
            );

            genresContainer.appendChild(
                genreBadge
            );

            renderedGenreCount++;
        });

        metaContainer.replaceChildren(
            ratingSpan,
            document.createTextNode(' '),
            mainSeparator,
            document.createTextNode(' '),
            genresContainer
        );
    }
    
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
    

    const provContainer =
    document.getElementById(
        'modal-providers'
    );

    if (provContainer) {
        provContainer.style.cssText =
            'margin-top:15px;' +
            'display:flex;' +
            'gap:10px;' +
            'align-items:center;' +
            'justify-content:center;' +
            'flex-wrap:wrap;';

        provContainer.textContent =
            'Platformlar aranıyor...';
    }

    // Modal Provider Fetch (WITH DEEP LINKS)
    fetch(`${BASE_URL}/${item.media_type}/${item.id}/watch/providers?api_key=${API_KEY}`, { signal: routeContext?.signal })
        .then(res => res.json())
        .then(data => {
            if (!isRouteContextCurrent(routeContext, "movie", movieId)) return;
            const tr =
                data.results &&
                data.results.TR
                    ? data.results.TR
                    : null;

            const provContainer =
                document.getElementById(
                    'modal-providers'
                );

            if (!provContainer) {
                return;
            }

            if (
                tr &&
                Array.isArray(tr.flatrate) &&
                tr.flatrate.length > 0
            ) {
                const watchLink =
                    getSafeHttpUrl(
                        tr.link,
                        '#'
                    );

                const hasWatchLink =
                    watchLink !== '#';

                const label =
                    document.createElement(
                        'span'
                    );

                label.style.cssText =
                    'color:var(--text-muted);' +
                    'font-size:0.95rem;' +
                    'font-weight:bold;';

                label.textContent =
                    'İzlenebilir:';

                const fragment =
                    document.createDocumentFragment();

                fragment.append(
                    label,
                    document.createTextNode(' ')
                );

                tr.flatrate.forEach(provider => {
                    const providerName =
                        String(
                            provider?.provider_name ||
                            'Platform'
                        );

                    const logoUrl =
                        getSafeTmdbImageUrl(
                            provider?.logo_path,
                            IMAGE_BASE,
                            'https://via.placeholder.com/35x35?text=?'
                        );

                    const wrapper =
                        document.createElement(
                            hasWatchLink
                                ? 'a'
                                : 'span'
                        );

                    if (hasWatchLink) {
                        wrapper.href =
                            watchLink;

                        wrapper.target =
                            '_blank';

                        wrapper.rel =
                            'noopener noreferrer';

                        wrapper.title =
                            `${providerName} Üzerinde İzle`;
                    } else {
                        wrapper.title =
                            providerName;
                    }

                    const logo =
                        document.createElement(
                            'img'
                        );

                    logo.src =
                        logoUrl;

                    logo.alt =
                        providerName;

                    logo.loading =
                        'lazy';

                    logo.style.cssText =
                        'width:35px;' +
                        'height:35px;' +
                        'border-radius:8px;' +
                        'box-shadow:0 2px 5px rgba(0,0,0,0.5);' +
                        `cursor:${hasWatchLink ? 'pointer' : 'default'};`;

                    wrapper.appendChild(
                        logo
                    );

                    fragment.appendChild(
                        wrapper
                    );
                });

                provContainer.replaceChildren(
                    fragment
                );
            } else {
                provContainer.innerHTML =
                    "<span style='color:var(--text-muted); font-size:0.9rem;'>Türkiye'de dijital yayını yok</span>";
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
                
                let storedRecent = [];

                try {
                    const parsedRecent =
                        JSON.parse(
                            localStorage.getItem(
                                'recentlyViewed'
                            ) ||
                            '[]'
                        );

                    if (
                        Array.isArray(
                            parsedRecent
                        )
                    ) {
                        storedRecent =
                            parsedRecent;
                    }
                } catch (error) {
                    console.warn(
                        'Recently viewed okunamadı:',
                        error
                    );
                }

                const recentIndex =
                    storedRecent.findIndex(
                        entry =>
                            normalizeTmdbId(
                                entry?.id
                            ) === item.id
                    );

                if (recentIndex > -1) {
                    storedRecent[recentIndex].overview =
                        fullData.overview;

                    localStorage.setItem(
                        'recentlyViewed',
                        JSON.stringify(
                            storedRecent
                        )
                    );
                }
            }

            const runtimeCandidates = [
                fullData.runtime,
                Array.isArray(
                    fullData.episode_run_time
                )
                    ? fullData.episode_run_time[0]
                    : null,
                fullData.last_episode_to_air
                    ?.runtime
            ];

            const runtime =
                runtimeCandidates.find(
                    value =>
                        typeof value === 'number' &&
                        Number.isFinite(value) &&
                        value > 0
                ) ?? null;

            const episodeCount =
                typeof fullData.number_of_episodes ===
                    'number' &&
                Number.isSafeInteger(
                    fullData.number_of_episodes
                ) &&
                fullData.number_of_episodes > 0
                    ? fullData.number_of_episodes
                    : null;

            if (runtime !== null) {
                const metaContainer =
                    document.getElementById(
                        'details-meta'
                    );

                if (
                    metaContainer &&
                    !metaContainer.querySelector(
                        '#runtime-span'
                    )
                ) {
                    const separator =
                        document.createElement(
                            'span'
                        );

                    separator.textContent =
                        '|';

                    const runtimeSpan =
                        document.createElement(
                            'span'
                        );

                    runtimeSpan.id =
                        'runtime-span';

                    let runtimeText =
                        `${runtime} dk`;

                    if (
                        item.media_type === 'tv' &&
                        episodeCount !== null
                    ) {
                        const totalMins =
                            runtime *
                            episodeCount;

                        const hours =
                            Math.floor(
                                totalMins / 60
                            );

                        const mins =
                            totalMins % 60;

                        runtimeText +=
                            ` / Bölüm (Toplam: ${hours}s ${mins}d)`;
                    }

                    runtimeSpan.textContent =
                        runtimeText;

                    metaContainer.append(
                        document.createTextNode(' '),
                        separator,
                        document.createTextNode(' '),
                        runtimeSpan
                    );
                }
            }

            // IMDb Badge
const rawImdbId =
    fullData.external_ids
        ?.imdb_id;

const imdbId =
    isValidImdbId(rawImdbId)
        ? rawImdbId
        : null;

if (imdbId) {
    window.currentImdbId =
        imdbId;

    const renderImdbBadge =
        ratingValue => {
            const normalizedRating =
                normalizeImdbRating(
                    ratingValue
                );

            if (!normalizedRating) {
                return false;
            }

            const ratingSpan =
                document.getElementById(
                    'rating-span'
                );

            if (!ratingSpan) {
                return false;
            }

            const link =
                document.createElement(
                    'a'
                );

            link.href =
                `https://www.imdb.com/title/${imdbId}/`;

            link.target =
                '_blank';

            link.rel =
                'noopener noreferrer';

            link.style.cssText =
                'text-decoration:none;' +
                'color:inherit;';

            const badge =
                document.createElement(
                    'span'
                );

            badge.className =
                'imdb-badge';

            badge.textContent =
                'IMDb';

            link.append(
                badge,
                document.createTextNode(
                    ` ${normalizedRating}`
                )
            );

            ratingSpan.replaceChildren(
                link
            );

            return true;
        };

    const cachedImdb =
        localStorage.getItem(
            'imdb_' + imdbId
        );

    const validCachedImdb =
        normalizeImdbRating(
            cachedImdb
        );

    if (validCachedImdb) {
        renderImdbBadge(
            validCachedImdb
        );
    } else {
        fetch(
            `https://www.omdbapi.com/?apikey=cfcb7364&i=${imdbId}`,
            {
                signal:
                    routeContext?.signal
            }
        )
            .then(response =>
                response.json()
            )
            .then(omdbData => {
                if (
                    !isRouteContextCurrent(
                        routeContext,
                        'movie',
                        movieId
                    )
                ) {
                    return;
                }

                const imdbRating =
                    normalizeImdbRating(
                        omdbData
                            ?.imdbRating
                    );

                if (!imdbRating) {
                    return;
                }

                renderImdbBadge(
                    imdbRating
                );

                localStorage.setItem(
                    'imdb_' + imdbId,
                    imdbRating
                );
            })
            .catch(error => {
                if (
                    error.name ===
                    'AbortError'
                ) {
                    return;
                }
            });
    }
}

            // Video Background (Only PC)
            const backgroundVideos =
                Array.isArray(
                    fullData.videos?.results
                )
                    ? fullData.videos.results
                    : [];

            if (
                window.innerWidth > 768 &&
                videoBgContainer &&
                backgroundVideos.length > 0
            ) {
                let video =
                    backgroundVideos.find(
                        candidate =>
                            candidate?.site ===
                                'YouTube' &&
                            candidate?.type ===
                                'Trailer' &&
                            isValidYouTubeVideoId(
                                candidate?.key
                            )
                    );

                if (!video) {
                    video =
                        backgroundVideos.find(
                            candidate =>
                                candidate?.site ===
                                    'YouTube' &&
                                isValidYouTubeVideoId(
                                    candidate?.key
                                )
                        );
                }

                const validVideoId =
                    video &&
                    isValidYouTubeVideoId(
                        video.key
                    )
                        ? video.key
                        : null;

                if (validVideoId) {
                    const mounted =
                        mountYouTubeEmbed(
                            videoBgContainer,
                            validVideoId,
                            {
                                autoplay: '1',
                                mute: '1',
                                controls: '0',
                                loop: '1',
                                playlist:
                                    validVideoId,
                                modestbranding: '1',
                                showinfo: '0',
                                rel: '0',
                                iv_load_policy: '3',
                                enablejsapi: '1'
                            }
                        );

                    if (mounted) {
                        // Şirket interneti engellemesini
                        // (Hata 152 / Beyaz Ekran)
                        // tespit etmek için mevcut
                        // youtube-nocookie bağlantı testi.
                        fetch(
                            'https://www.youtube-nocookie.com/favicon.ico',
                            {
                                mode: 'no-cors',
                                signal:
                                    routeContext
                                        ?.signal
                            }
                        )
                            .then(() => {
                                if (
                                    !isRouteContextCurrent(
                                        routeContext,
                                        'movie',
                                        movieId
                                    )
                                ) {
                                    return;
                                }

                                // Mevcut 1 saniyelik reveal.
                                setTimeout(
                                    () => {
                                        if (
                                            !isRouteContextCurrent(
                                                routeContext,
                                                'movie',
                                                movieId
                                            )
                                        ) {
                                            return;
                                        }

                                        videoBgContainer
                                            .style
                                            .opacity =
                                            '1';

                                        if (backdropEl) {
                                            backdropEl
                                                .style
                                                .display =
                                                'none';
                                        }
                                    },
                                    1000
                                );
                            })
                            .catch(error => {
                                if (
                                    error.name ===
                                    'AbortError'
                                ) {
                                    return;
                                }

                                // Bağlantı reddedilirse video
                                // görünmez; mevcut backdrop kalır.
                                console.warn(
                                    'YouTube bağlantısı engellendi, video arka planı iptal edildi.'
                                );
                            });
                    }
                }
            }

            if (
                Array.isArray(
                    fullData.credits?.crew
                )
            ) {
                const director =
                    fullData.credits.crew.find(
                        crewMember =>
                            crewMember.job ===
                            'Director'
                    );

                const directorId =
                    normalizeTmdbId(
                        director?.id
                    );

                if (
                    director &&
                    directorId
                ) {
                    const directorName =
                        String(
                            director.name ||
                            'Bilinmiyor'
                        );

                    const directorBadge =
                        document.createElement(
                            'div'
                        );

                    directorBadge.id =
                        'director-badge-container';

                    directorBadge.style.cssText =
                        'margin-top:10px;' +
                        'margin-bottom:10px;' +
                        'display:inline-block;' +
                        'background:rgba(0,0,0,0.6);' +
                        'padding:5px 12px;' +
                        'border-radius:15px;' +
                        'border:1px solid rgba(255,255,255,0.1);' +
                        'box-shadow:0 2px 4px rgba(0,0,0,0.3);' +
                        'backdrop-filter:blur(5px);' +
                        'transition:all 0.5s ease;';

                    const directorLink =
                        document.createElement(
                            'span'
                        );

                    directorLink.style.cssText =
                        'cursor:pointer;' +
                        'color:#fff;' +
                        'font-weight:bold;' +
                        'font-size:0.95rem;' +
                        'text-shadow:0 2px 4px rgba(0,0,0,0.8);';

                    directorLink.title =
                        `${directorName} filmleri`;

                    const directorIcon =
                        document.createElement(
                            'i'
                        );

                    directorIcon.className =
                        'fas fa-bullhorn';

                    directorIcon.style.cssText =
                        'color:var(--accent-color);' +
                        'margin-right:5px;';

                    directorLink.append(
                        directorIcon,
                        document.createTextNode(
                            ` Yönetmen: ${directorName}`
                        )
                    );

                    directorLink.addEventListener(
                        'click',
                        () => {
                            openActorDetails(
                                directorId
                            );
                        }
                    );

                    directorBadge.appendChild(
                        directorLink
                    );

                    const metaContainer =
                        document.getElementById(
                            'details-meta'
                        );

                    if (metaContainer) {
                        metaContainer.appendChild(
                            directorBadge
                        );
                    }

                    const directorBackdrop =
                        getSafeTmdbImageUrl(
                            item.backdrop_path,
                            IMAGE_BASE,
                            null
                        );

                    if (directorBackdrop) {
                        const img =
                            new Image();

                        img.crossOrigin =
                            'Anonymous';

                        img.onload = () => {
                            if (
                                !isRouteContextCurrent(
                                    routeContext,
                                    'movie',
                                    movieId
                                )
                            ) {
                                return;
                            }

                            try {
                                const colorThief =
                                    new ColorThief();

                                const color =
                                    colorThief.getColor(
                                        img
                                    );

                                const rgb =
                                    `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`;

                                const dirBadge =
                                    document.getElementById(
                                        'director-badge-container'
                                    );

                                if (dirBadge) {
                                    dirBadge.style.background =
                                        rgb;

                                    dirBadge.style.boxShadow =
                                        `0 4px 15px rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.5)`;

                                    dirBadge.style.border =
                                        `1px solid rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.8)`;
                                }
                            } catch (error) {
                                // Tema rengi opsiyonel.
                            }
                        };

                        img.src =
                            directorBackdrop;
                    }
                }
            }
            
            // Başrol Oyuncuları
            if (
                Array.isArray(
                    fullData.credits?.cast
                )
            ) {
                const cast =
                    fullData.credits.cast
                        .slice(0, 10);

                const fragment =
                    document.createDocumentFragment();

                let renderedCastCount = 0;

                cast.forEach(actor => {
                    const actorId =
                        normalizeTmdbId(
                            actor?.id
                        );

                    if (!actorId) {
                        return;
                    }

                    const actorName =
                        String(
                            actor.name ||
                            'Bilinmiyor'
                        );

                    const actorImg =
                        getSafeTmdbImageUrl(
                            actor.profile_path,
                            IMAGE_BASE,
                            'https://via.placeholder.com/150x150?text=Foto'
                        );

                    const card =
                        document.createElement(
                            'div'
                        );

                    card.className =
                        'actor-card';

                    card.style.cursor =
                        'pointer';

                    const image =
                        document.createElement(
                            'img'
                        );

                    image.src =
                        actorImg;

                    image.alt =
                        actorName;

                    image.loading =
                        'lazy';

                    const name =
                        document.createElement(
                            'div'
                        );

                    name.className =
                        'actor-name';

                    name.title =
                        actorName;

                    name.textContent =
                        actorName;

                    const tooltip =
                        document.createElement(
                            'div'
                        );

                    tooltip.className =
                        'actor-tooltip';

                    tooltip.textContent =
                        'Yükleniyor...';

                    card.append(
                        image,
                        name,
                        tooltip
                    );

                    card.addEventListener(
                        'click',
                        () => {
                            openActorDetails(
                                actorId
                            );
                        }
                    );

                    card.addEventListener(
                        'mouseenter',
                        () => {
                            showActorTooltip(
                                card,
                                actorId
                            );
                        }
                    );

                    card.addEventListener(
                        'mouseleave',
                        () => {
                            hideActorTooltip(
                                card
                            );
                        }
                    );

                    fragment.appendChild(card);
                    renderedCastCount++;
                });

                if (renderedCastCount > 0) {
                    castContainer.replaceChildren(
                        fragment
                    );
                } else {
                    castContainer.innerHTML =
                        "<div style='color:#ccc'>Oyuncu bilgisi bulunamadı.</div>";
                }
            }

           // Recommendations
            if (
                Array.isArray(
                    fullData.recommendations
                        ?.results
                ) &&
                recContainer
            ) {
                const recs =
                    fullData.recommendations
                        .results
                        .slice(0, 10);

                const fragment =
                    document.createDocumentFragment();

                let renderedRecCount = 0;

                recs.forEach(rec => {
                    const recId =
                        normalizeTmdbId(
                            rec?.id
                        );

                    const recMediaType =
                        normalizeMediaType(
                            rec?.media_type,
                            item.media_type
                        );

                    if (
                        !recId ||
                        !recMediaType
                    ) {
                        return;
                    }

                    const recTitle =
                        String(
                            rec.title ||
                            rec.name ||
                            'Bilinmiyor'
                        );

                    const recImage =
                        getSafeTmdbImageUrl(
                            rec.poster_path,
                            IMAGE_BASE,
                            'https://via.placeholder.com/100x150?text=Yok'
                        );

                    window.movieCache[recId] = {
                        id: recId,
                        title: recTitle,
                        name: recTitle,
                        overview:
                            rec.overview,
                        poster_path:
                            rec.poster_path,
                        backdrop_path:
                            rec.backdrop_path,
                        release_date:
                            rec.release_date,
                        first_air_date:
                            rec.first_air_date,
                        vote_average:
                            rec.vote_average,
                        genre_ids:
                            Array.isArray(
                                rec.genre_ids
                            )
                                ? rec.genre_ids
                                : [],
                        media_type:
                            recMediaType
                    };

                    const card =
                        document.createElement(
                            'div'
                        );

                    card.className =
                        'recommendation-card';

                    const image =
                        document.createElement(
                            'img'
                        );

                    image.src =
                        recImage;

                    image.alt =
                        recTitle;

                    image.loading =
                        'lazy';

                    const title =
                        document.createElement(
                            'div'
                        );

                    title.className =
                        'recommendation-title';

                    title.title =
                        recTitle;

                    title.textContent =
                        recTitle;

                    card.append(
                        image,
                        title
                    );

                    card.addEventListener(
                        'click',
                        () => {
                            openDetails(
                                recId,
                                recMediaType
                            );
                        }
                    );

                    fragment.appendChild(card);
                    renderedRecCount++;
                });

                if (renderedRecCount > 0) {
                    recContainer.replaceChildren(
                        fragment
                    );

                    makeScrollable(
                        recContainer
                    );
                } else {
                    recContainer.innerHTML =
                        "<div style='color:#ccc'>Öneri bulunamadı.</div>";
                }
            }

            // TV Show Seasons
            if (
                item.media_type === 'tv' &&
                Array.isArray(
                    fullData.seasons
                ) &&
                fullData.seasons.length > 0
            ) {
                const validSeasons = [];

                fullData.seasons.forEach(
                    season => {
                        const seasonNumber =
                            typeof season
                                ?.season_number ===
                                'number' &&
                            Number.isSafeInteger(
                                season.season_number
                            ) &&
                            season.season_number > 0
                                ? season.season_number
                                : null;

                        if (
                            seasonNumber === null
                        ) {
                            return;
                        }

                        const episodeCount =
                            typeof season
                                .episode_count ===
                                'number' &&
                            Number.isSafeInteger(
                                season.episode_count
                            ) &&
                            season.episode_count >= 0
                                ? season.episode_count
                                : null;

                        validSeasons.push({
                            seasonNumber,
                            name: String(
                                season.name ||
                                `Sezon ${seasonNumber}`
                            ),
                            episodeCount
                        });
                    }
                );

                if (validSeasons.length > 0) {
                    const guide =
                        document.createElement(
                            'div'
                        );

                    guide.id =
                        'tv-guide-container';

                    guide.className =
                        'collection-section';

                    const heading =
                        document.createElement(
                            'h3'
                        );

                    heading.className =
                        'cast-title';

                    heading.textContent =
                        'Dizi Sezon Rehberi';

                    const selectWrapper =
                        document.createElement(
                            'div'
                        );

                    selectWrapper.className =
                        'season-select-wrapper';

                    const select =
                        document.createElement(
                            'select'
                        );

                    select.className =
                        'season-select';

                    const placeholder =
                        document.createElement(
                            'option'
                        );

                    placeholder.value = '';
                    placeholder.disabled = true;
                    placeholder.selected = true;

                    placeholder.textContent =
                        'Bir sezon seçin...';

                    select.appendChild(
                        placeholder
                    );

                    validSeasons.forEach(
                        season => {
                            const option =
                                document.createElement(
                                    'option'
                                );

                            option.value =
                                String(
                                    season.seasonNumber
                                );

                            option.textContent =
                                season.episodeCount !==
                                null
                                    ? `${season.name} (${season.episodeCount} Bölüm)`
                                    : season.name;

                            select.appendChild(
                                option
                            );
                        }
                    );

                    select.addEventListener(
                        'change',
                        () => {
                            const value =
                                select.value.trim();

                            if (
                                !/^\d+$/.test(
                                    value
                                )
                            ) {
                                return;
                            }

                            const selectedSeason =
                                Number(value);

                            if (
                                !Number.isSafeInteger(
                                    selectedSeason
                                ) ||
                                selectedSeason <= 0
                            ) {
                                return;
                            }

                            loadSeasonEpisodes(
                                item.id,
                                selectedSeason,
                                routeContext
                            );
                        }
                    );

                    selectWrapper.appendChild(
                        select
                    );

                    const episodesContainer =
                        document.createElement(
                            'div'
                        );

                    episodesContainer.id =
                        'episodes-container';

                    episodesContainer.className =
                        'episode-list';

                    guide.append(
                        heading,
                        selectWrapper,
                        episodesContainer
                    );

                    const castHeading =
                        castContainer
                            .previousElementSibling;

                    if (
                        castHeading &&
                        castHeading.parentNode
                    ) {
                        castHeading.parentNode
                            .insertBefore(
                                guide,
                                castHeading
                            );
                    }

                    const firstSeason =
                        validSeasons[0];

                    select.value =
                        String(
                            firstSeason
                                .seasonNumber
                        );

                    loadSeasonEpisodes(
                        item.id,
                        firstSeason.seasonNumber,
                        routeContext
                    );
                }
            }

            // Collections
            if (
                item.media_type === 'movie' &&
                fullData.belongs_to_collection
            ) {
                const collectionId =
                    normalizeTmdbId(
                        fullData
                            .belongs_to_collection
                            .id
                    );

                if (collectionId) {
                    const colRes =
                        await fetch(
                            `${BASE_URL}/collection/${collectionId}?api_key=${API_KEY}&language=tr-TR`,
                            {
                                signal:
                                    routeContext
                                        ?.signal
                            }
                        );

                    const colData =
                        await colRes.json();

                    if (
                        !isRouteContextCurrent(
                            routeContext,
                            'movie',
                            movieId
                        )
                    ) {
                        return;
                    }

                    if (
                        Array.isArray(
                            colData.parts
                        ) &&
                        colData.parts.length > 0
                    ) {
                        colData.parts.sort(
                            (a, b) =>
                                new Date(
                                    a.release_date
                                ) -
                                new Date(
                                    b.release_date
                                )
                        );

                        const rawCollectionName =
                            String(
                                colData.name ||
                                ''
                            );

                        const cleanCollectionName =
                            rawCollectionName
                                .replace(
                                    /\[Seri\]/gi,
                                    ''
                                )
                                .replace(
                                    /Serisi/gi,
                                    ''
                                )
                                .replace(
                                    /Collection/gi,
                                    ''
                                )
                                .trim();

                        const collectionTitle =
                            `${
                                cleanCollectionName ||
                                'Film'
                            } Serisi`;

                        const section =
                            document.createElement(
                                'div'
                            );

                        section.id =
                            'collection-container';

                        section.className =
                            'collection-section';

                        const heading =
                            document.createElement(
                                'h3'
                            );

                        heading.className =
                            'cast-title';

                        heading.textContent =
                            collectionTitle;

                        const list =
                            document.createElement(
                                'div'
                            );

                        list.className =
                            'collection-list';

                        let renderedParts = 0;

                        colData.parts.forEach(
                            part => {
                                const partId =
                                    normalizeTmdbId(
                                        part?.id
                                    );

                                if (!partId) {
                                    return;
                                }

                                const partTitle =
                                    String(
                                        part.title ||
                                        'Bilinmiyor'
                                    );

                                const partImage =
                                    getSafeTmdbImageUrl(
                                        part.poster_path,
                                        IMAGE_BASE,
                                        'https://via.placeholder.com/100x150?text=Yok'
                                    );

                                window.movieCache[
                                    partId
                                ] = {
                                    id: partId,
                                    title:
                                        partTitle,
                                    name:
                                        partTitle,
                                    overview:
                                        part.overview,
                                    poster_path:
                                        part.poster_path,
                                    backdrop_path:
                                        part.backdrop_path,
                                    release_date:
                                        part.release_date,
                                    vote_average:
                                        part.vote_average,
                                    genre_ids:
                                        Array.isArray(
                                            part.genre_ids
                                        )
                                            ? part.genre_ids
                                            : [],
                                    media_type:
                                        'movie'
                                };

                                const card =
                                    document
                                        .createElement(
                                            'div'
                                        );

                                card.className =
                                    'recommendation-card';

                                const image =
                                    document
                                        .createElement(
                                            'img'
                                        );

                                image.src =
                                    partImage;

                                image.alt =
                                    partTitle;

                                image.loading =
                                    'lazy';

                                if (
                                    partId ===
                                    item.id
                                ) {
                                    image.style.cssText =
                                        'outline:3px solid var(--primary-color);' +
                                        'outline-offset:-3px;' +
                                        'border-radius:10px;';
                                }

                                const title =
                                    document
                                        .createElement(
                                            'div'
                                        );

                                title.className =
                                    'recommendation-title';

                                title.title =
                                    partTitle;

                                title.textContent =
                                    partTitle;

                                card.append(
                                    image,
                                    title
                                );

                                card.addEventListener(
                                    'click',
                                    () => {
                                        openDetails(
                                            partId,
                                            'movie'
                                        );
                                    }
                                );

                                list.appendChild(
                                    card
                                );

                                renderedParts++;
                            }
                        );

                        if (renderedParts > 0) {
                            section.append(
                                heading,
                                list
                            );

                            const recHeading =
                                recContainer
                                    ?.previousElementSibling;

                            if (
                                recHeading &&
                                recHeading.parentNode
                            ) {
                                recHeading.parentNode
                                    .insertBefore(
                                        section,
                                        recHeading
                                    );
                            }
                        }
                    }
                }
            }
        }).catch(err => {
            if (err.name === 'AbortError') return;
            console.error("Full fetch error", err);
            castContainer.innerHTML = "<div style='color:red'>Veriler çekilemedi.</div>";
        });
        
    // Modal Actions (Watchlist, Rate, Trailer, Share)
    let watchlist = [];

    try {
        const parsedWatchlist =
            JSON.parse(
                localStorage.getItem(
                    'watchlist'
                ) ||
                '[]'
            );

        if (
            Array.isArray(
                parsedWatchlist
            )
        ) {
            watchlist =
                parsedWatchlist;
        }
    } catch (error) {
        console.warn(
            'Watchlist okunamadı:',
            error
        );
    }

    const isInWatchlist =
        watchlist.some(
            entry =>
                normalizeTmdbId(
                    entry?.id
                ) === item.id
        );

    const wlText =
        isInWatchlist
            ? 'Listeden Çıkar'
            : 'Listeme Ekle';

    const wlClass =
        isInWatchlist
            ? 'active'
            : 'inactive';

    const wlBtnHtml =
        `<button id="modal-wl-btn" onclick="toggleWatchlist(this, ${item.id})" class="btn-watchlist ${wlClass}"><i class="fas fa-heart"></i> ${wlText}</button>`;

    const isUpcoming =
        item.release_date &&
        new Date(
            item.release_date
        ) > new Date();

    let rateBtnHtml = '';

    if (!isUpcoming) {
        let savedRatings = {};

        try {
            const parsedRatings =
                JSON.parse(
                    localStorage.getItem(
                        'movieRatings'
                    ) ||
                    '{}'
                );

            if (
                parsedRatings &&
                typeof parsedRatings ===
                    'object' &&
                !Array.isArray(
                    parsedRatings
                )
            ) {
                savedRatings =
                    parsedRatings;
            }
        } catch (error) {
            console.warn(
                'Movie ratings okunamadı:',
                error
            );
        }

        const myRating =
            normalizeUserRating(
                savedRatings[item.id]
            );

        const hasRating =
            myRating !== null;

        const rateText =
            hasRating
                ? `⭐ ${myRating}/10`
                : 'İzledim / Puan Ver';

        const rateClass =
            hasRating
                ? 'active'
                : 'inactive';

        rateBtnHtml = `
            <div style="position:relative; width:100%; margin-top: 10px;">
                <button
                    onclick="toggleRateMenu(${item.id})"
                    class="btn-watchlist ${rateClass}"
                    style="width:100%;"
                >
                    <i class="fas fa-star"></i>
                    <span id="rate-text-${item.id}">
                        ${rateText}
                    </span>
                </button>

                <div
                    id="rate-menu-${item.id}"
                    style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--card-bg); border-radius:10px; padding:10px; box-shadow:0 10px 20px rgba(0,0,0,0.5); z-index:10; border:1px solid var(--glass-border); flex-wrap:wrap; justify-content:center; gap:5px; margin-top:5px;"
                >
                    ${
                        [1,2,3,4,5,6,7,8,9,10]
                            .map(
                                n =>
                                    `<button onclick="saveRating(${item.id}, ${n})" style="width:28px; height:28px; border-radius:5px; background:var(--primary-color); color:white; border:none; cursor:pointer;">${n}</button>`
                            )
                            .join('')
                    }

                    <button
                        onclick="removeRating(${item.id})"
                        style="width:100%; margin-top:5px; padding:5px; border-radius:5px; background:rgba(229,9,20,0.8); color:white; border:none; cursor:pointer;"
                    >
                        Puanı Sil
                    </button>
                </div>
            </div>
        `;
    }
        
    const safeActionMediaType =
        normalizeMediaType(
            item.media_type
        );

    if (!safeActionMediaType) {
        return;
    }

    const trailerBtnHtml =
        `<button onclick="openTrailer(${item.id}, '${safeActionMediaType}')" class="btn-watchlist inactive" style="margin-top: 10px;"><i class="fas fa-play"></i> Fragmanı İzle</button>`;

    const shareBtnHtml =
        `<button onclick="shareMovie(${item.id})" class="btn-watchlist inactive" style="margin-top: 10px; background:rgba(255,255,255,0.05);"><i class="fas fa-share-alt"></i> Paylaş</button>`;

    
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
    const safeGenreId =
        normalizeTmdbId(
            genreId
        );

    if (!safeGenreId) {
        return;
    }

    genreId =
        safeGenreId;

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
            select.value =
                String(genreId);
        }
    }
    
    loadPlatformMovies(0, true);
}

async function openTrailer(
    id,
    mediaType
) {
    const safeId =
        normalizeTmdbId(id);

    if (!safeId) {
        return;
    }

    const safeMediaType =
        normalizeMediaType(
            mediaType,
            normalizeMediaType(
                window.movieCache[
                    safeId
                ]?.media_type
            )
        );

    if (!safeMediaType) {
        return;
    }

    const modal =
        document.getElementById(
            'trailer-modal'
        );

    const container =
        document.getElementById(
            'video-container'
        );

    if (
        !modal ||
        !container
    ) {
        return;
    }

    container.innerHTML =
        "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Fragman Aranıyor...</div>";

    modal.classList.add(
        'active'
    );

    const bgIframe =
        document.querySelector(
            '#video-bg-container iframe'
        );

    if (
        bgIframe &&
        bgIframe.contentWindow
    ) {
        bgIframe.contentWindow
            .postMessage(
                '{"event":"command","func":"pauseVideo","args":""}',
                '*'
            );
    }

    try {
        const res =
            await fetch(
                `${BASE_URL}/${safeMediaType}/${safeId}/videos?api_key=${API_KEY}`
            );

        const data =
            await res.json();

        const videos =
            Array.isArray(
                data.results
            )
                ? data.results
                : [];

        let trailer =
            videos.find(
                video =>
                    video.site ===
                        'YouTube' &&
                    video.type ===
                        'Trailer' &&
                    isValidYouTubeVideoId(
                        video.key
                    )
            );

        if (!trailer) {
            trailer =
                videos.find(
                    video =>
                        video.site ===
                            'YouTube' &&
                        isValidYouTubeVideoId(
                            video.key
                        )
                );
        }

        if (trailer) {
            mountYouTubeEmbed(
                container,
                trailer.key,
                {
                    autoplay: '1',
                    rel: '0'
                }
            );
        } else {
            container.innerHTML =
                "<div style='color:white;text-align:center;padding-top:20%;font-size:1.2rem'>Bu yapım için fragman bulunamadı 😔</div>";
        }
    } catch (error) {
        container.innerHTML =
            "<div style='color:red;text-align:center;padding-top:20%;'>Fragman yüklenirken hata oluştu!</div>";
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

async function loadSeasonEpisodes(
    tvId,
    seasonNumber,
    routeContext = null
) {
    const safeTvId =
        normalizeTmdbId(tvId);

    if (!safeTvId) {
        return;
    }

    let safeSeasonNumber =
        null;

    if (
        typeof seasonNumber ===
            'number'
    ) {
        safeSeasonNumber =
            seasonNumber;
    } else if (
        typeof seasonNumber ===
            'string' &&
        /^\d+$/.test(
            seasonNumber.trim()
        )
    ) {
        safeSeasonNumber =
            Number(
                seasonNumber.trim()
            );
    }

    if (
        !Number.isSafeInteger(
            safeSeasonNumber
        ) ||
        safeSeasonNumber <= 0
    ) {
        return;
    }

    const container =
        document.getElementById(
            'episodes-container'
        );

    if (!container) {
        return;
    }

    routeContext =
        routeContext ||
        {
            generation:
                routeGeneration,
            signal:
                currentAbortController
                    ?.signal
        };

    container.innerHTML =
        "<div class='loading'>Bölümler yükleniyor...</div>";

    try {
        const res =
            await fetch(
                `${BASE_URL}/tv/${safeTvId}/season/${safeSeasonNumber}?api_key=${API_KEY}&language=tr-TR`,
                {
                    signal:
                        routeContext
                            ?.signal
                }
            );

        const data =
            await res.json();

        if (
            !isRouteContextCurrent(
                routeContext,
                'movie',
                safeTvId
            )
        ) {
            return;
        }

        const episodes =
            Array.isArray(
                data.episodes
            )
                ? data.episodes
                : [];

        if (episodes.length === 0) {
            container.innerHTML =
                '<div>Bu sezon için bölüm bulunamadı.</div>';

            return;
        }

        const fragment =
            document.createDocumentFragment();

        let renderedEpisodes = 0;

        episodes.forEach(ep => {
            const episodeNumber =
                typeof ep
                    ?.episode_number ===
                    'number' &&
                Number.isSafeInteger(
                    ep.episode_number
                ) &&
                ep.episode_number > 0
                    ? ep.episode_number
                    : null;

            if (
                episodeNumber === null
            ) {
                return;
            }

            const episodeName =
                String(
                    ep.name ||
                    'Bilinmiyor'
                );

            const overview =
                typeof ep.overview ===
                    'string' &&
                ep.overview.trim()
                    ? ep.overview
                    : 'Bu bölüm için henüz özet bulunmuyor.';

            const still =
                getSafeTmdbImageUrl(
                    ep.still_path,
                    IMAGE_BASE,
                    'https://via.placeholder.com/120x70?text=Afiş+Yok'
                );

            let airDate =
                'Bilinmiyor';

            if (ep.air_date) {
                const date =
                    new Date(
                        ep.air_date
                    );

                if (
                    !Number.isNaN(
                        date.getTime()
                    )
                ) {
                    airDate =
                        date.toLocaleDateString(
                            'tr-TR'
                        );
                }
            }

            const validCurrentImdbId =
                isValidImdbId(
                    window.currentImdbId
                )
                    ? window.currentImdbId
                    : null;

            const usesImdb =
                Boolean(
                    validCurrentImdbId
                );

            const rawTargetUrl =
                usesImdb
                    ? `https://www.imdb.com/title/${validCurrentImdbId}/episodes?season=${safeSeasonNumber}`
                    : `https://www.themoviedb.org/tv/${safeTvId}/season/${safeSeasonNumber}/episode/${episodeNumber}`;

            const targetUrl =
                getSafeHttpUrl(
                    rawTargetUrl,
                    '#'
                );

            const card =
                document.createElement(
                    'div'
                );

            card.className =
                'episode-card';

            card.style.cssText =
                'cursor:pointer;' +
                'position:relative;' +
                'transition:transform 0.2s;';

            card.title =
                usesImdb
                    ? 'IMDb Sayfasını Aç'
                    : 'TMDB Sayfasını Aç';

            card.addEventListener(
                'mouseover',
                () => {
                    card.style.transform =
                        'scale(1.02)';
                }
            );

            card.addEventListener(
                'mouseout',
                () => {
                    card.style.transform =
                        'scale(1)';
                }
            );

            card.addEventListener(
                'click',
                () => {
                    if (
                        targetUrl === '#'
                    ) {
                        return;
                    }

                    const openedWindow =
                        window.open(
                            targetUrl,
                            '_blank',
                            'noopener,noreferrer'
                        );

                    if (openedWindow) {
                        openedWindow.opener =
                            null;
                    }
                }
            );

            const image =
                document.createElement(
                    'img'
                );

            image.src =
                still;

            image.alt =
                episodeName;

            image.loading =
                'lazy';

            const info =
                document.createElement(
                    'div'
                );

            info.className =
                'episode-info';

            const heading =
                document.createElement(
                    'h4'
                );

            heading.appendChild(
                document.createTextNode(
                    `${episodeNumber}. ${episodeName}`
                )
            );

            if (usesImdb) {
                const imdbIcon =
                    document.createElement(
                        'i'
                    );

                imdbIcon.className =
                    'fab fa-imdb';

                imdbIcon.style.cssText =
                    'color:#f5c518;' +
                    'margin-left:5px;';

                heading.appendChild(
                    imdbIcon
                );
            }

            const dateText =
                document.createElement(
                    'p'
                );

            dateText.style.cssText =
                'color:var(--accent-color);' +
                'font-weight:600;' +
                'font-size:0.8rem;' +
                'margin-bottom:5px;';

            dateText.textContent =
                `Yayın: ${airDate}`;

            const overviewText =
                document.createElement(
                    'p'
                );

            overviewText.textContent =
                overview;

            info.append(
                heading,
                dateText,
                overviewText
            );

            card.append(
                image,
                info
            );

            fragment.appendChild(
                card
            );

            renderedEpisodes++;
        });

        if (renderedEpisodes > 0) {
            container.replaceChildren(
                fragment
            );
        } else {
            container.innerHTML =
                '<div>Bu sezon için bölüm bulunamadı.</div>';
        }
    } catch (error) {
        if (
            error.name ===
            'AbortError'
        ) {
            return;
        }

        container.innerHTML =
            "<div style='color:red'>Hata oluştu.</div>";
    }
}

function shareMovie(id) {
    const safeId =
        normalizeTmdbId(id);

    if (!safeId) {
        return;
    }

    const url =
        `${window.location.origin}${window.location.pathname}#movie/${safeId}`;
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