function openActorDetails(
    actorId,
    actorName,
    reset = true,
    jobType = 'cast',
    filterGenre = 0,
    isFilterChange = false
) {
    const safeActorId =
        normalizeTmdbId(actorId);

    if (!safeActorId) {
        return;
    }

    navigate(
        'actor/' + safeActorId
    );
}

let actorRequestGeneration = 0;
const actorRuntimeCache = new Map();
const actorProviderFilterCache = new Map();

async function renderActor(
    actorId,
    actorName = "",
    reset = true,
    jobType = 'cast',
    filterGenre = 0,
    isFilterChange = false,
    routeContext = null
) {
    const safeActorId =
        normalizeTmdbId(actorId);

    if (!safeActorId) {
        return;
    }

    actorId = safeActorId;

    const requestGeneration = reset
        ? ++actorRequestGeneration
        : actorRequestGeneration;

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
        
        if (requestGeneration !== actorRequestGeneration) return;
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        
        if (!actorName) {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = personData.name;
        }
        
        // EĞER KİŞİ ASLEN BİR YÖNETMENSE VE VARSAYILAN OLARAK 'CAST' GELDİYSE, ONU YÖNETMEN OLARAK DEĞİŞTİR!
        if (jobType === 'cast' && personData.known_for_department === 'Directing') {
            jobType = 'Director';
        }
        
    const rawFilterProvId =
        document.getElementById(
            'providerFilter'
        )?.value || '0';

    const filterProvId =
        rawFilterProvId === '0'
            ? 0
            : (
                normalizeTmdbId(
                    rawFilterProvId
                ) || 0
            );
        
        const creditsRes = await fetch(`${BASE_URL}/person/${currentActorId}/combined_credits?api_key=${API_KEY}&language=tr-TR`, { signal: routeContext?.signal });
        let data = await creditsRes.json();
        
        if (requestGeneration !== actorRequestGeneration) return;
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
                const results =
                    await Promise.all(
                        chunk.map(async m => {
                            try {
                                const movieId =
                                    normalizeTmdbId(
                                        m?.id
                                    );

                                const movieMediaType =
                                    normalizeMediaType(
                                        m?.media_type
                                    );

                                if (
                                    !movieId ||
                                    movieMediaType !==
                                        'movie'
                                ) {
                                    return null;
                                }

                                const cacheKey =
                                    `movie:${movieId}`;

                                let rt;

                                if (
                                    actorRuntimeCache.has(
                                        cacheKey
                                    )
                                ) {
                                    rt =
                                        actorRuntimeCache.get(
                                            cacheKey
                                        );
                                } else {
                                    const res =
                                        await fetch(
                                            `${BASE_URL}/movie/${movieId}?api_key=${API_KEY}&language=tr-TR`,
                                            {
                                                signal:
                                                    routeContext
                                                        ?.signal
                                            }
                                        );

                                    const detail =
                                        await res.json();

                                    const rawRuntime =
                                        detail?.runtime;

                                    rt =
                                        typeof rawRuntime ===
                                            'number' &&
                                        Number.isFinite(
                                            rawRuntime
                                        ) &&
                                        rawRuntime > 0
                                            ? rawRuntime
                                            : 0;

                                    if (res.ok) {
                                        actorRuntimeCache.set(
                                            cacheKey,
                                            rt
                                        );
                                    }
                                }

                                if (
                                    runtimeFilter == '90' &&
                                    rt <= 90 &&
                                    rt > 0
                                ) {
                                    return m;
                                }

                                if (
                                    runtimeFilter == '120' &&
                                    rt > 90 &&
                                    rt <= 105
                                ) {
                                    return m;
                                }

                                if (
                                    runtimeFilter == '150' &&
                                    rt > 105 &&
                                    rt <= 135
                                ) {
                                    return m;
                                }

                                if (
                                    runtimeFilter == '180' &&
                                    rt > 135
                                ) {
                                    return m;
                                }
                            } catch (e) {
                                if (
                                    e.name ===
                                    'AbortError'
                                ) {
                                    throw e;
                                }

                                return null;
                            }

                            return null;
                        })
                    );
                if (requestGeneration !== actorRequestGeneration) return;
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
                        const mediaType = m.media_type;
                        const cacheKey = `${mediaType}:${m.id}`;
                        let data;
                        if (actorProviderFilterCache.has(cacheKey)) {
                            data = actorProviderFilterCache.get(cacheKey);
                        } else {
                            const res = await fetch(
                                `${BASE_URL}/${mediaType}/${m.id}/watch/providers?api_key=${API_KEY}`,
                                { signal: routeContext?.signal }
                            );
                            data = await res.json();
                            if (res.ok) {
                                actorProviderFilterCache.set(cacheKey, data);
                            }
                        }
                        const tr = data.results && data.results[regionStr] ? data.results[regionStr] : null;
                        if (tr && tr.flatrate && tr.flatrate.some(p => p.provider_id === filterProvId)) return m;
                    } catch (e) { if (e.name === 'AbortError') throw e; return null; }
                    return null;
                }));
                if (requestGeneration !== actorRequestGeneration) return;
                validMovies.push(...results.filter(Boolean));
                if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
            }
            movies = validMovies;
        }
        
        if (requestGeneration !== actorRequestGeneration) return;
        if (!isRouteContextCurrent(routeContext, "actor", actorId)) return;
        const startIndex = (currentPage - 1) * 20;
        const endIndex = startIndex + 20;
        const pagedMovies = movies.slice(startIndex, endIndex);
        
        const container = document.getElementById('search-results');
        
        if (
    reset &&
    !isFilterChange
) {
    if (
        !isRouteContextCurrent(
            routeContext,
            'actor',
            actorId
        )
    ) {
        return;
    }

    container.replaceChildren();

    const actorNameText =
        String(
            personData?.name ||
            'Bilinmiyor'
        );

    const biography =
        typeof personData
            ?.biography ===
            'string'
            ? personData.biography
            : '';

    const birthPlace =
        typeof personData
            ?.place_of_birth ===
            'string'
            ? personData
                .place_of_birth
            : '';

    let birthYear = '';

    if (personData?.birthday) {
        const birthDate =
            new Date(
                personData.birthday
            );

        if (
            !Number.isNaN(
                birthDate.getTime()
            )
        ) {
            birthYear =
                String(
                    birthDate
                        .getFullYear()
                );
        }
    }

    const profilePath =
        isValidTmdbImagePath(
            personData
                ?.profile_path
        )
            ? personData
                .profile_path
            : null;

    const profileUrl =
        getSafeTmdbImageUrl(
            profilePath,
            IMAGE_BASE,
            'https://via.placeholder.com/60x90'
        );

    let favoriteActors = [];

    try {
        const parsedFavorites =
            JSON.parse(
                localStorage.getItem(
                    'favoriteActors'
                ) ||
                '[]'
            );

        if (
            Array.isArray(
                parsedFavorites
            )
        ) {
            favoriteActors =
                parsedFavorites;
        }
    } catch (error) {
        console.warn(
            'Favorite actors okunamadı:',
            error
        );
    }

    const isFav =
        favoriteActors.some(
            actor =>
                normalizeTmdbId(
                    actor?.id
                ) === currentActorId
        );

    const favClass =
        isFav
            ? 'active'
            : 'inactive';

    const favText =
        isFav
            ? 'Favorilerden Çıkar'
            : 'Favorilere Ekle';

    const bioCard =
        document.createElement(
            'div'
        );

    bioCard.id =
        'actor-bio-card-container';

    bioCard.className =
        'actor-bio-card';

    bioCard.style.cssText =
        'grid-column:1 / -1;' +
        'width:100%;' +
        'max-width:800px;' +
        'margin:0 auto 20px auto;' +
        'padding:20px;' +
        'background:var(--card-bg);' +
        'border-radius:15px;' +
        'border:1px solid var(--glass-border);' +
        'color:var(--text-muted);' +
        'font-size:0.95rem;';

    const layout =
        document.createElement(
            'div'
        );

    layout.style.cssText =
        'display:flex;' +
        'align-items:flex-start;' +
        'gap:20px;' +
        'margin-bottom:10px;';

    const profileImage =
        document.createElement(
            'img'
        );

    profileImage.src =
        profileUrl;

    profileImage.alt =
        actorNameText;

    profileImage.loading =
        'lazy';

    profileImage.style.cssText =
        'width:80px;' +
        'height:120px;' +
        'border-radius:10px;' +
        'object-fit:cover;' +
        'flex-shrink:0;' +
        'user-select:none;' +
        '-webkit-user-drag:none;';

    const content =
        document.createElement(
            'div'
        );

    content.style.cssText =
        'flex:1;' +
        'min-width:0;';

    const header =
        document.createElement(
            'div'
        );

    header.style.cssText =
        'display:flex;' +
        'justify-content:flex-start;' +
        'align-items:center;' +
        'margin-bottom:10px;' +
        'gap:10px;';

    const title =
        document.createElement(
            'h3'
        );

    title.style.cssText =
        'color:var(--text-color);' +
        'margin:0;' +
        'font-size:1.5rem;' +
        'white-space:nowrap;' +
        'overflow:hidden;' +
        'text-overflow:ellipsis;' +
        'display:inline-block;' +
        'max-width:calc(100% - 60px);';

    title.textContent =
        actorNameText;

    const favoriteButton =
        document.createElement(
            'button'
        );

    favoriteButton.id =
        'modal-actor-fav-btn';

    favoriteButton.type =
        'button';

    favoriteButton.className =
        `btn-watchlist ${favClass}`;

    favoriteButton.title =
        favText;

    favoriteButton.style.cssText =
        'position:relative;' +
        'z-index:10;' +
        'margin-top:0;' +
        'flex-shrink:0;' +
        'border-radius:50%;' +
        'width:35px;' +
        'height:35px;' +
        'padding:0;' +
        'display:flex;' +
        'align-items:center;' +
        'justify-content:center;' +
        'border:none;' +
        'cursor:pointer;';

    const heartIcon =
        document.createElement(
            'i'
        );

    heartIcon.className =
        'fas fa-heart';

    heartIcon.style.fontSize =
        '1.2rem';

    favoriteButton.appendChild(
        heartIcon
    );

    favoriteButton
        .addEventListener(
            'click',
            () => {
                toggleActorFavorite(
                    favoriteButton,
                    currentActorId,
                    actorNameText,
                    profilePath
                );
            }
        );

    header.append(
        title,
        favoriteButton
    );

    const biographyContainer =
        document.createElement(
            'div'
        );

    biographyContainer.style.cssText =
        'max-height:110px;' +
        'overflow-y:auto;' +
        'padding-right:5px;' +
        'white-space:pre-wrap;';

    if (
        birthYear ||
        birthPlace
    ) {
        const birthLabel =
            document.createElement(
                'strong'
            );

        birthLabel.textContent =
            'Doğum:';

        biographyContainer.append(
            birthLabel,
            document.createTextNode(
                ` ${
                    [
                        birthYear,
                        birthPlace
                    ]
                        .filter(Boolean)
                        .join(' ')
                }`
            ),
            document.createElement(
                'br'
            )
        );
    }

    if (biography) {
        biographyContainer.appendChild(
            document.createTextNode(
                biography
            )
        );
    }

    content.append(
        header,
        biographyContainer
    );

    layout.append(
        profileImage,
        content
    );

    bioCard.appendChild(
        layout
    );

    container.appendChild(
        bioCard
    );
    }

    if (isFilterChange) {
        if (
            !isRouteContextCurrent(
                routeContext,
                'actor',
                actorId
            )
        ) {
            return;
        }

        const skels =
            container.querySelectorAll(
                '.skeleton-card'
            );

        skels.forEach(
            skeleton =>
                skeleton.remove()
        );
    }

    if (
        pagedMovies.length === 0 &&
        reset
    ) {
        const emptyMsg =
            filterProvId > 0
                ? (
                    jobType ===
                        'Director'
                        ? 'Yönetmenin bu platformda içeriği yok.'
                        : 'Oyuncunun bu platformda içeriği yok.'
                )
                : 'Seçtiğiniz filtrelere uygun yapım bulunamadı.';

        const existingMsgs =
            container.querySelectorAll(
                '.loading'
            );

        existingMsgs.forEach(
            message =>
                message.remove()
        );

        const emptyElement =
            document.createElement(
                'div'
            );

        emptyElement.className =
            'loading';

        emptyElement.style.cssText =
            'margin-top:20px;' +
            'text-align:center;';

        emptyElement.textContent =
            emptyMsg;

        container.appendChild(
            emptyElement
        );

        container.style.minHeight =
            '';

        document
            .getElementById(
                'loadMoreBtn'
            )
            .style.display =
            'none';

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
        if (requestGeneration !== actorRequestGeneration) return;
        if (!reset) throw e;
        if (reset) document.getElementById('search-results').innerHTML = "<div class='loading'>Hata oluştu.</div>";
    } finally {
        const spinner = document.getElementById('infinite-spinner');
        if (spinner) spinner.style.display = 'none';
    }
}

let currentTooltipTimer = null;
let currentTooltipActorId = null;
function showActorTooltip(
    element,
    actorId
) {
    const safeActorId =
        normalizeTmdbId(
            actorId
        );

    if (
        !element ||
        typeof element
            .getBoundingClientRect !==
            'function' ||
        !safeActorId
    ) {
        return;
    }

    if (currentTooltipTimer) {
        clearTimeout(
            currentTooltipTimer
        );
    }

    currentTooltipActorId =
        safeActorId;

    currentTooltipTimer =
        setTimeout(
            async () => {
                currentTooltipTimer =
                    null;

                if (
                    currentTooltipActorId !==
                        safeActorId ||
                    !element.isConnected
                ) {
                    return;
                }

                let tooltip =
                    document.getElementById(
                        'global-actor-tooltip'
                    );

                if (!tooltip) {
                    tooltip =
                        document.createElement(
                            'div'
                        );

                    tooltip.id =
                        'global-actor-tooltip';

                    tooltip.className =
                        'actor-tooltip';

                    document.body
                        .appendChild(
                            tooltip
                        );
                }

                tooltip.textContent =
                    'Yükleniyor...';

                const rect =
                    element
                        .getBoundingClientRect();

                tooltip.style.position =
                    'fixed';

                tooltip.style.left =
                    (
                        rect.left +
                        rect.width / 2
                    ) + 'px';

                tooltip.style.bottom =
                    (
                        window.innerHeight -
                        rect.top +
                        10
                    ) + 'px';

                tooltip.style.transform =
                    'translateX(-50%) translateY(0)';

                tooltip.classList.add(
                    'active'
                );

                try {
                    const [
                        personResponse,
                        moviesResponse
                    ] =
                        await Promise.all([
                            fetch(
                                `${BASE_URL}/person/${safeActorId}?api_key=${API_KEY}&language=tr-TR`
                            ),
                            fetch(
                                `${BASE_URL}/person/${safeActorId}/combined_credits?api_key=${API_KEY}&language=tr-TR`
                            )
                        ]);

                    const person =
                        await personResponse
                            .json();

                    const movies =
                        await moviesResponse
                            .json();

                    if (
                        currentTooltipActorId !==
                            safeActorId ||
                        !element.isConnected
                    ) {
                        return;
                    }

                    const personName =
                        String(
                            person?.name ||
                            'Bilinmiyor'
                        );

                    let ageText = '';

                    if (
                        person?.birthday
                    ) {
                        const birth =
                            new Date(
                                person.birthday
                            );

                        let endDate =
                            new Date();

                        let datesValid =
                            !Number.isNaN(
                                birth.getTime()
                            );

                        if (
                            person.deathday
                        ) {
                            const death =
                                new Date(
                                    person
                                        .deathday
                                );

                            if (
                                Number.isNaN(
                                    death
                                        .getTime()
                                )
                            ) {
                                datesValid =
                                    false;
                            } else {
                                endDate =
                                    death;
                            }
                        }

                        if (
                            datesValid &&
                            endDate >= birth
                        ) {
                            const age =
                                Math.floor(
                                    (
                                        endDate -
                                        birth
                                    ) /
                                    (
                                        365.25 *
                                        24 *
                                        60 *
                                        60 *
                                        1000
                                    )
                                );

                            if (
                                Number.isFinite(
                                    age
                                ) &&
                                age >= 0 &&
                                age <= 130
                            ) {
                                ageText =
                                    person
                                        .deathday
                                        ? `Vefat (${age} yaşında)`
                                        : `${age} Yaşında`;
                            }
                        }
                    }

                    let place = '';

                    if (
                        typeof person
                            ?.place_of_birth ===
                            'string'
                    ) {
                        const placeParts =
                            person
                                .place_of_birth
                                .split(',');

                        place =
                            String(
                                placeParts
                                    .pop() ||
                                ''
                            ).trim();
                    }

                    const cast =
                        Array.isArray(
                            movies?.cast
                        )
                            ? [
                                ...movies.cast
                            ]
                            : [];

                    const popularityOf =
                        work =>
                            typeof work
                                ?.popularity ===
                                'number' &&
                            Number.isFinite(
                                work.popularity
                            )
                                ? work.popularity
                                : 0;

                    const bestMovies =
                        cast
                            .sort(
                                (a, b) =>
                                    popularityOf(
                                        b
                                    ) -
                                    popularityOf(
                                        a
                                    )
                            )
                            .slice(0, 3);

                    if (
                        currentTooltipActorId !==
                            safeActorId ||
                        !element.isConnected
                    ) {
                        return;
                    }

                    const title =
                        document.createElement(
                            'h4'
                        );

                    title.textContent =
                        personName;

                    const meta =
                        document.createElement(
                            'div'
                        );

                    meta.className =
                        'tt-meta';

                    if (ageText) {
                        meta.appendChild(
                            document
                                .createTextNode(
                                    ageText
                                )
                        );
                    }

                    if (place) {
                        if (ageText) {
                            meta.appendChild(
                                document
                                    .createElement(
                                        'br'
                                    )
                            );
                        }

                        meta.appendChild(
                            document
                                .createTextNode(
                                    place
                                )
                        );
                    }

                    const nodes = [
                        title,
                        meta
                    ];

                    if (
                        bestMovies.length >
                        0
                    ) {
                        const list =
                            document
                                .createElement(
                                    'ul'
                                );

                        list.style.cssText =
                            'padding:0;' +
                            'list-style:none;';

                        bestMovies.forEach(
                            work => {
                                const workName =
                                    String(
                                        work
                                            ?.title ||
                                        work
                                            ?.name ||
                                        'Bilinmiyor'
                                    );

                                const item =
                                    document
                                        .createElement(
                                            'li'
                                        );

                                item.style.cssText =
                                    'white-space:normal;' +
                                    'overflow:visible;';

                                item.textContent =
                                    `• ${workName}`;

                                list.appendChild(
                                    item
                                );
                            }
                        );

                        nodes.push(
                            list
                        );
                    }

                    tooltip.replaceChildren(
                        ...nodes
                    );
                } catch (error) {
                    if (
                        currentTooltipActorId !==
                            safeActorId ||
                        !element.isConnected
                    ) {
                        return;
                    }

                    tooltip.textContent =
                        'Bilgi alınamadı.';
                }
            },
            400
        );
}

function hideActorTooltip(
    element = null
) {
    if (currentTooltipTimer) {
        clearTimeout(
            currentTooltipTimer
        );

        currentTooltipTimer =
            null;
    }

    currentTooltipActorId =
        null;

    const tooltip =
        document.getElementById(
            'global-actor-tooltip'
        );

    if (tooltip) {
        tooltip.classList.remove(
            'active'
        );
    }
}

function toggleActorFavorite(
    btnElem,
    actorId,
    actorName,
    profilePath
) {
    const safeActorId =
        normalizeTmdbId(
            actorId
        );

    if (!safeActorId) {
        return;
    }

    const safeActorName =
        String(
            actorName ||
            'Bilinmiyor'
        );

    const safeProfilePath =
        isValidTmdbImagePath(
            profilePath
        )
            ? profilePath
            : null;

    let favs = [];

    try {
        const parsedFavorites =
            JSON.parse(
                localStorage.getItem(
                    'favoriteActors'
                ) ||
                '[]'
            );

        if (
            Array.isArray(
                parsedFavorites
            )
        ) {
            favs =
                parsedFavorites;
        }
    } catch (error) {
        console.warn(
            'Favorite actors okunamadı:',
            error
        );
    }

    const isAlreadyFavorite =
        favs.some(
            actor =>
                normalizeTmdbId(
                    actor?.id
                ) ===
                safeActorId
        );

    if (isAlreadyFavorite) {
        favs =
            favs.filter(
                actor =>
                    normalizeTmdbId(
                        actor?.id
                    ) !==
                    safeActorId
            );

        if (btnElem) {
            btnElem.classList.remove(
                'active',
                'inactive'
            );

            btnElem.classList.add(
                'inactive'
            );

            btnElem.title =
                'Favorilere Ekle';

            if (
                btnElem.id ===
                'modal-actor-fav-btn'
            ) {
                btnElem.innerHTML =
                    '<i class="fas fa-heart" style="font-size:1.2rem;"></i>';
            }
        }
    } else {
        favs.push({
            id: safeActorId,
            name:
                safeActorName,
            profile_path:
                safeProfilePath
        });

        if (btnElem) {
            btnElem.classList.remove(
                'active',
                'inactive'
            );

            btnElem.classList.add(
                'active'
            );

            btnElem.title =
                'Favorilerden Çıkar';

            if (
                btnElem.id ===
                'modal-actor-fav-btn'
            ) {
                btnElem.innerHTML =
                    '<i class="fas fa-heart" style="font-size:1.2rem;"></i>';
            }
        }
    }

    localStorage.setItem(
        'favoriteActors',
        JSON.stringify(favs)
    );

    const profile =
        document.getElementById(
            'profile'
        );

    if (
        profile &&
        profile.classList.contains(
            'active-tab'
        )
    ) {
        loadProfile();
    }
}

// =========================================
// ORTAK OYUNCU ARACI
// =========================================
let selectedActor1Id = null;
let selectedActor2Id = null;
let actor1Timeout = null;
let actor2Timeout = null;

async function handleActorAutocomplete(
    event,
    actorNum
) {
    if (
        actorNum !== 1 &&
        actorNum !== 2
    ) {
        return;
    }

    const input =
        document.getElementById(
            `actor${actorNum}-input`
        );

    const box =
        document.getElementById(
            `actor${actorNum}-autocomplete`
        );

    if (!input || !box) {
        return;
    }

    if (actorNum === 1) {
        selectedActor1Id =
            null;
    } else {
        selectedActor2Id =
            null;
    }

    const query =
        input.value.trim();

    if (query.length < 2) {
        box.style.display =
            'none';

        return;
    }

    const isCurrentQuery =
        () =>
            input.value.trim() ===
            query;

    if (actorNum === 1) {
        clearTimeout(
            actor1Timeout
        );
    } else {
        clearTimeout(
            actor2Timeout
        );
    }

    const timeout =
        setTimeout(
            async () => {
                try {
                    const res =
                        await fetch(
                            `${BASE_URL}/search/person?api_key=${API_KEY}&query=${encodeURIComponent(query)}&language=tr-TR`
                        );

                    const data =
                        await res.json();

                    if (
                        !isCurrentQuery()
                    ) {
                        return;
                    }

                    let results =
                        Array.isArray(
                            data?.results
                        )
                            ? data.results
                            : [];

                    results =
                        results
                            .filter(
                                item => {
                                    const itemId =
                                        normalizeTmdbId(
                                            item
                                                ?.id
                                        );

                                    const validDepartment =
                                        item
                                            ?.known_for_department ===
                                            'Acting' ||
                                        item
                                            ?.known_for_department ===
                                            'Directing';

                                    const validProfile =
                                        isValidTmdbImagePath(
                                            item
                                                ?.profile_path
                                        );

                                    return (
                                        itemId &&
                                        validDepartment &&
                                        validProfile
                                    );
                                }
                            )
                            .sort(
                                (a, b) => {
                                    const popularityA =
                                        typeof a
                                            ?.popularity ===
                                            'number' &&
                                        Number.isFinite(
                                            a.popularity
                                        )
                                            ? a.popularity
                                            : 0;

                                    const popularityB =
                                        typeof b
                                            ?.popularity ===
                                            'number' &&
                                        Number.isFinite(
                                            b.popularity
                                        )
                                            ? b.popularity
                                            : 0;

                                    return (
                                        popularityB -
                                        popularityA
                                    );
                                }
                            );

                    if (
                        results.length ===
                        0
                    ) {
                        if (
                            isCurrentQuery()
                        ) {
                            box.style.display =
                                'none';
                        }

                        return;
                    }

                    if (
                        !isCurrentQuery()
                    ) {
                        return;
                    }

                    box.replaceChildren();

                    let appendedCount = 0;

                    results
                        .slice(0, 5)
                        .forEach(
                            item => {
                                const itemId =
                                    normalizeTmdbId(
                                        item
                                            ?.id
                                    );

                                if (!itemId) {
                                    return;
                                }

                                const name =
                                    String(
                                        item
                                            ?.name ||
                                        'Bilinmiyor'
                                    );

                                const profile =
                                    getSafeTmdbImageUrl(
                                        item
                                            ?.profile_path,
                                        IMAGE_BASE,
                                        'https://via.placeholder.com/40x60?text=Yok'
                                    );

                                const knownFor =
                                    String(
                                        item
                                            ?.known_for_department ||
                                        'Oyuncu'
                                    );

                                const div =
                                    document
                                        .createElement(
                                            'div'
                                        );

                                div.className =
                                    'suggestion-item';

                                const image =
                                    document
                                        .createElement(
                                            'img'
                                        );

                                image.src =
                                    profile;

                                image.alt =
                                    name;

                                image.className =
                                    'suggestion-img';

                                image.loading =
                                    'lazy';

                                const info =
                                    document
                                        .createElement(
                                            'div'
                                        );

                                info.className =
                                    'suggestion-info';

                                const title =
                                    document
                                        .createElement(
                                            'span'
                                        );

                                title.className =
                                    'suggestion-title';

                                title.textContent =
                                    name;

                                const meta =
                                    document
                                        .createElement(
                                            'span'
                                        );

                                meta.className =
                                    'suggestion-meta';

                                meta.textContent =
                                    knownFor;

                                info.append(
                                    title,
                                    meta
                                );

                                div.append(
                                    image,
                                    info
                                );

                                div.addEventListener(
                                    'click',
                                    () => {
                                        input.value =
                                            name;

                                        if (
                                            actorNum ===
                                            1
                                        ) {
                                            selectedActor1Id =
                                                itemId;
                                        } else {
                                            selectedActor2Id =
                                                itemId;
                                        }

                                        box.style.display =
                                            'none';
                                    }
                                );

                                box.appendChild(
                                    div
                                );

                                appendedCount++;
                            }
                        );

                    if (
                        !isCurrentQuery()
                    ) {
                        return;
                    }

                    box.style.display =
                        appendedCount > 0
                            ? 'block'
                            : 'none';
                } catch (error) {
                    console.error(
                        'Actor Autocomplete Error:',
                        error
                    );
                }
            },
            300
        );

    if (actorNum === 1) {
        actor1Timeout =
            timeout;
    } else {
        actor2Timeout =
            timeout;
    }
}

async function findCommonMovies() {
    const actor1 = document
        .getElementById('actor1-input')
        .value
        .trim();

    const actor2 = document
        .getElementById('actor2-input')
        .value
        .trim();

    if (!actor1 || !actor2) {
        alert("Lütfen iki oyuncu adı da giriniz.");
        return;
    }

    const grid =
        document.getElementById('common-movies-grid');

    document
        .getElementById('common-movies-result')
        .style.display = 'block';

    showSkeletons('common-movies-grid', 5);

    try {
        let id1 = selectedActor1Id;

        if (!id1) {
            const res1 = await fetch(
                `${BASE_URL}/search/person?api_key=${API_KEY}` +
                `&query=${encodeURIComponent(actor1)}` +
                `&language=tr-TR`
            );

            const data1 = await res1.json();

            if (
                !data1.results ||
                data1.results.length === 0
            ) {
                renderSafeError(
                    grid,
                    `${actor1} bulunamadı.`,
                    null,
                    'no-provider'
                );
                return;
            }

            id1 = data1.results[0].id;
        }

        let id2 = selectedActor2Id;

        if (!id2) {
            const res2 = await fetch(
                `${BASE_URL}/search/person?api_key=${API_KEY}` +
                `&query=${encodeURIComponent(actor2)}` +
                `&language=tr-TR`
            );

            const data2 = await res2.json();

            if (
                !data2.results ||
                data2.results.length === 0
            ) {
                renderSafeError(
                    grid,
                    `${actor2} bulunamadı.`,
                    null,
                    'no-provider'
                );
                return;
            }

            id2 = data2.results[0].id;
        }

        id1 = Number(id1);
        id2 = Number(id2);

        if (
            !Number.isSafeInteger(id1) ||
            id1 <= 0 ||
            !Number.isSafeInteger(id2) ||
            id2 <= 0
        ) {
            renderSafeError(
                grid,
                'Geçersiz oyuncu bilgisi.',
                null,
                'no-provider'
            );
            return;
        }

        const res3 = await fetch(
            `${BASE_URL}/discover/movie?api_key=${API_KEY}` +
            `&with_people=${id1},${id2}` +
            `&sort_by=popularity.desc` +
            `&language=tr-TR`
        );

        const data3 = await res3.json();

        let html = '';

        if (
            !data3.results ||
            data3.results.length === 0
        ) {
            html = "<p>Ortak film bulunamadı.</p>";
        } else {
            data3.results.forEach(item => {
                html += createMovieCard(
                    item,
                    'movie',
                    'common'
                );
            });
        }

        grid.innerHTML = html;
        makeScrollable(grid);

    } catch (e) {
        renderSafeError(
            grid,
            'Ortak filmler aranırken bir sorun oluştu. Lütfen tekrar deneyin.',
            e,
            'no-provider'
        );
    }
}