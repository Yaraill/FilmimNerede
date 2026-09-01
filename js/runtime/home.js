let trendingActorsAutoScrollInterval = null;
let curatedCollectionsAutoScrollInterval = null;

const HOME_TRENDING_ACTORS_CONCURRENCY = 3;
const HOME_COLLECTION_CONCURRENCY = 4;

const HOME_TRENDING_ACTORS_TTL_MS =
    5 * 60 * 1000;

const HOME_COLLECTION_TTL_MS =
    10 * 60 * 1000;

let trendingActorsCache = {
    timestamp: 0,
    actors: null
};

let trendingActorsInFlight = null;

const curatedCollectionCache =
    new Map();

const curatedCollectionInFlight =
    new Map();

function createHomeAbortError() {
    const error =
        new Error('Aborted');

    error.name =
        'AbortError';

    return error;
}

async function runHomeTasksWithConcurrency(
    items,
    limit,
    worker
) {
    const results =
        new Array(items.length);

    let nextIndex = 0;

    const workerCount =
        Math.min(
            limit,
            items.length
        );

    const runners =
        Array.from(
            {
                length:
                    workerCount
            },
            async () => {
                while (true) {
                    const index =
                        nextIndex++;

                    if (
                        index >=
                        items.length
                    ) {
                        return;
                    }

                    results[index] =
                        await worker(
                            items[index],
                            index
                        );
                }
            }
        );

    await Promise.all(
        runners
    );

    return results;
}

function createSharedHomeTask(
    taskFactory,
    onFinally
) {
    const controller =
        new AbortController();

    const entry = {
        controller,
        consumers: 0,
        settled: false,
        promise: null
    };

    entry.promise =
        Promise.resolve()
            .then(
                () =>
                    taskFactory(
                        controller.signal
                    )
            )
            .finally(
                () => {
                    entry.settled =
                        true;

                    if (onFinally) {
                        onFinally(
                            entry
                        );
                    }
                }
            );

    return entry;
}

function consumeSharedHomeTask(
    entry,
    signal = null
) {
    if (
        signal?.aborted
    ) {
        return Promise.reject(
            createHomeAbortError()
        );
    }

    entry.consumers++;

    return new Promise(
        (
            resolve,
            reject
        ) => {
            let released =
                false;

            const release =
                wasAborted => {
                    if (released) {
                        return;
                    }

                    released =
                        true;

                    if (signal) {
                        signal
                            .removeEventListener(
                                'abort',
                                onAbort
                            );
                    }

                    entry.consumers =
                        Math.max(
                            0,
                            entry
                                .consumers -
                                1
                        );

                    if (
                        wasAborted &&
                        entry
                            .consumers ===
                            0 &&
                        !entry.settled &&
                        !entry
                            .controller
                            .signal
                            .aborted
                    ) {
                        entry.controller
                            .abort();
                    }
                };

            const onAbort =
                () => {
                    release(
                        true
                    );

                    reject(
                        createHomeAbortError()
                    );
                };

            if (signal) {
                signal.addEventListener(
                    'abort',
                    onAbort,
                    {
                        once: true
                    }
                );
            }

            entry.promise.then(
                value => {
                    release(
                        false
                    );

                    resolve(
                        value
                    );
                },
                error => {
                    release(
                        false
                    );

                    reject(
                        error
                    );
                }
            );
        }
    );
}

async function fetchTrendingActorsData(
    signal
) {
    const pages =
        Array.from(
            {
                length: 8
            },
            (
                _,
                index
            ) =>
                index + 1
        );

    const pageResults =
        await runHomeTasksWithConcurrency(
            pages,
            HOME_TRENDING_ACTORS_CONCURRENCY,
            async page => {
                try {
                    const response =
                        await fetch(
                            `${BASE_URL}/person/popular?api_key=${API_KEY}&language=tr-TR&page=${page}`,
                            {
                                signal
                            }
                        );

                    if (
                        !response.ok
                    ) {
                        console.warn(
                            `Trending actor page ${page} alınamadı: HTTP ${response.status}`
                        );

                        return {
                            ok: false,
                            results: []
                        };
                    }

                    const data =
                        await response
                            .json();

                    return {
                        ok: true,
                        results:
                            Array.isArray(
                                data
                                    ?.results
                            )
                                ? data
                                    .results
                                : []
                    };
                } catch (error) {
                    if (
                        error.name ===
                        'AbortError'
                    ) {
                        throw error;
                    }

                    console.warn(
                        `Trending actor page ${page} alınamadı:`,
                        error
                    );

                    return {
                        ok: false,
                        results: []
                    };
                }
            }
        );

    const successfulPages =
        pageResults.filter(
            result =>
                result?.ok
        );

    if (
        successfulPages.length ===
        0
    ) {
        throw new Error(
            'Trending actor pages unavailable'
        );
    }

    const allActors =
        successfulPages.flatMap(
            result =>
                result.results
        );

    const actors = [];
    const seenActorIds =
        new Set();

    allActors.forEach(actor => {
        if (
            !actor ||
            actor.adult === true
        ) {
            return;
        }

        const actorId =
            normalizeTmdbId(
                actor.id
            );

        if (
            !actorId ||
            seenActorIds.has(
                actorId
            )
        ) {
            return;
        }

        if (
            typeof actor.name !==
                'string' ||
            !actor.name.trim()
        ) {
            return;
        }

        const knownFor =
            Array.isArray(
                actor.known_for
            )
                ? actor
                    .known_for
                : [];

        if (
            knownFor.length ===
            0
        ) {
            return;
        }

        if (
            knownFor.some(
                work =>
                    work?.adult ===
                    true
            )
        ) {
            return;
        }

        seenActorIds.add(
            actorId
        );

        actors.push({
            id: actorId,
            name:
                actor.name
                    .trim(),
            profile_path:
                isValidTmdbImagePath(
                    actor
                        .profile_path
                )
                    ? actor
                        .profile_path
                    : null
        });
    });

    return actors.slice(
        0,
        20
    );
}

function getTrendingActorsData(
    signal = null
) {
    if (
        signal?.aborted
    ) {
        return Promise.reject(
            createHomeAbortError()
        );
    }

    const cacheAge =
        Date.now() -
        trendingActorsCache
            .timestamp;

    if (
        Array.isArray(
            trendingActorsCache
                .actors
        ) &&
        cacheAge >= 0 &&
        cacheAge <
            HOME_TRENDING_ACTORS_TTL_MS
    ) {
        return Promise.resolve(
            trendingActorsCache
                .actors
        );
    }

    if (
        trendingActorsInFlight
            ?.controller
            .signal
            .aborted
    ) {
        trendingActorsInFlight =
            null;
    }

    if (
        !trendingActorsInFlight
    ) {
        let entry = null;

        entry =
            createSharedHomeTask(
                async sharedSignal => {
                    const actors =
                        await fetchTrendingActorsData(
                            sharedSignal
                        );

                    trendingActorsCache = {
                        timestamp:
                            Date.now(),
                        actors
                    };

                    return actors;
                },
                settledEntry => {
                    if (
                        trendingActorsInFlight ===
                        settledEntry
                    ) {
                        trendingActorsInFlight =
                            null;
                    }
                }
            );

        trendingActorsInFlight =
            entry;
    }

    return consumeSharedHomeTask(
        trendingActorsInFlight,
        signal
    );
}

function getCachedCuratedCollection(
    collectionId
) {
    const cached =
        curatedCollectionCache.get(
            collectionId
        );

    if (!cached) {
        return null;
    }

    const age =
        Date.now() -
        cached.timestamp;

    if (
        age >= 0 &&
        age <
            HOME_COLLECTION_TTL_MS
    ) {
        return cached.data;
    }

    curatedCollectionCache.delete(
        collectionId
    );

    return null;
}

async function fetchCuratedCollectionData(
    collectionId,
    signal
) {
    const response =
        await fetch(
            `${BASE_URL}/collection/${collectionId}?api_key=${API_KEY}&language=tr-TR`,
            {
                signal
            }
        );

    if (!response.ok) {
        throw new Error(
            `Collection HTTP ${response.status}`
        );
    }

    const data =
        await response.json();

    const responseCollectionId =
        normalizeTmdbId(
            data?.id
        );

    if (
        responseCollectionId !==
            collectionId ||
        !Array.isArray(
            data?.parts
        )
    ) {
        console.warn(
            `Collection ${collectionId} için geçersiz TMDB cevabı alındı.`
        );

        return null;
    }

    curatedCollectionCache.set(
        collectionId,
        {
            timestamp:
                Date.now(),
            data
        }
    );

    return data;
}

function getCuratedCollectionData(
    collectionId,
    signal = null
) {
    if (
        signal?.aborted
    ) {
        return Promise.reject(
            createHomeAbortError()
        );
    }

    const cached =
        getCachedCuratedCollection(
            collectionId
        );

    if (cached) {
        return Promise.resolve(
            cached
        );
    }

    let entry =
        curatedCollectionInFlight.get(
            collectionId
        );

    if (
        entry
            ?.controller
            .signal
            .aborted
    ) {
        curatedCollectionInFlight.delete(
            collectionId
        );

        entry = null;
    }

    if (!entry) {
        entry =
            createSharedHomeTask(
                sharedSignal =>
                    fetchCuratedCollectionData(
                        collectionId,
                        sharedSignal
                    ),
                settledEntry => {
                    if (
                        curatedCollectionInFlight.get(
                            collectionId
                        ) ===
                        settledEntry
                    ) {
                        curatedCollectionInFlight.delete(
                            collectionId
                        );
                    }
                }
            );

        curatedCollectionInFlight.set(
            collectionId,
            entry
        );
    }

    return consumeSharedHomeTask(
        entry,
        signal
    );
}

async function loadTop10Trending(
    routeContext = null,
    expectedPage = null
) {
    try {
        const res =
            await fetch(
                `${BASE_URL}/trending/all/week?api_key=${API_KEY}&language=tr-TR`,
                {
                    signal:
                        routeContext
                            ?.signal
                }
            );

        const data =
            await res.json();

        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return;
        }

        const results =
            Array.isArray(
                data?.results
            )
                ? data.results
                : [];

        const top10 =
            results
                .map(item => {
                    const itemId =
                        normalizeTmdbId(
                            item?.id
                        );

                    const mediaType =
                        normalizeMediaType(
                            item
                                ?.media_type
                        );

                    if (
                        !itemId ||
                        !mediaType
                    ) {
                        return null;
                    }

                    const title =
                        String(
                            item.title ||
                            item.name ||
                            'Bilinmiyor'
                        );

                    return {
                        item,
                        itemId,
                        mediaType,
                        title
                    };
                })
                .filter(Boolean)
                .slice(0, 10);

        const container =
            document.getElementById(
                'top10-grid'
            );

        if (!container) {
            return;
        }

        const section =
            document.getElementById(
                'top10-section'
            );

        if (section) {
            section.style.display =
                'block';
        }

        const fragment =
            document
                .createDocumentFragment();

        top10.forEach(
            (
                {
                    item,
                    itemId,
                    mediaType,
                    title
                },
                index
            ) => {
                const poster =
                    getSafeTmdbImageUrl(
                        item.poster_path,
                        IMAGE_BASE,
                        'https://via.placeholder.com/500x750?text=Yok'
                    );

                window.movieCache[
                    itemId
                ] = {
                    id: itemId,
                    title,
                    name: title,
                    release_date:
                        item
                            .release_date ||
                        item
                            .first_air_date,
                    poster_path:
                        item.poster_path,
                    backdrop_path:
                        item.backdrop_path,
                    overview:
                        item.overview,
                    vote_average:
                        item.vote_average,
                    genre_ids:
                        Array.isArray(
                            item.genre_ids
                        )
                            ? item.genre_ids
                            : [],
                    media_type:
                        mediaType
                };

                const card =
                    document
                        .createElement(
                            'div'
                        );

                card.className =
                    'recommendation-card top10-card';

                card.style.cssText =
                    'position:relative;' +
                    'width:140px;' +
                    'margin-left:20px;';

                const number =
                    document
                        .createElement(
                            'span'
                        );

                number.className =
                    'top10-number';

                number.textContent =
                    String(
                        index + 1
                    );

                const image =
                    document
                        .createElement(
                            'img'
                        );

                image.src =
                    poster;

                image.alt =
                    title;

                image.loading =
                    'lazy';

                image.style.cssText =
                    'width:100%;' +
                    'height:210px;' +
                    'object-fit:cover;' +
                    'border-radius:10px;' +
                    'box-shadow:0 5px 15px rgba(0,0,0,0.5);';

                card.append(
                    number,
                    image
                );

                card.addEventListener(
                    'click',
                    () => {
                        openDetails(
                            itemId,
                            mediaType
                        );
                    }
                );

                fragment.appendChild(
                    card
                );
            }
        );

        container.replaceChildren(
            fragment
        );

        makeScrollable(
            container
        );
    } catch (e) {
        if (
            e.name ===
            'AbortError'
        ) {
            return;
        }

        console.error(
            'Top 10 fetching failed',
            e
        );
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
        
        const results =
    Array.isArray(
        data?.results
    )
        ? data.results
        : [];

        let html = '';

        results.forEach(movie => {
            html +=
                createMovieCard(
                    movie,
                    'movie',
                    'now-playing'
                );
        });

        container.innerHTML =
            html;

        // Fetch providers for each movie after rendering cards
        results.forEach(movie => {
            fetchAndInjectProviders(
                movie?.id,
                'movie',
                null,
                routeContext
            );
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
        
        const results =
    Array.isArray(
        data?.results
    )
        ? data.results
        : [];

let html = '';

results.forEach(movie => {
    html +=
        createMovieCard(
            movie,
            'movie',
            'upcoming'
        );
});

container.innerHTML =
    html;
    } catch (error) {
        if (error.name === 'AbortError') return;
        container.innerHTML = "<div class='loading'>Hata oluştu.</div>";
    }
}

async function loadTrendingActors(
    routeContext = null,
    expectedPage = null
) {
    const container =
        document.getElementById(
            'trending-actors-list'
        );

    if (!container) {
        return;
    }

    try {
        const actors =
            await getTrendingActorsData(
                routeContext
                    ?.signal
            );

        if (
            routeContext
                ?.signal
                ?.aborted
        ) {
            return;
        }

        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return;
        }

        const fragment =
            document
                .createDocumentFragment();

        actors.forEach(actor => {
            const actorId =
                normalizeTmdbId(
                    actor?.id
                );

            if (!actorId) {
                return;
            }

            if (
                typeof actor.name !==
                    'string' ||
                !actor.name.trim()
            ) {
                return;
            }

            const actorName =
                actor.name.trim();

            const profile =
                getSafeTmdbImageUrl(
                    actor
                        .profile_path,
                    IMAGE_BASE,
                    'https://via.placeholder.com/150x225?text=Yok'
                );

            const card =
                document
                    .createElement(
                        'div'
                    );

            card.className =
                'story-item';

            const image =
                document
                    .createElement(
                        'img'
                    );

            image.src =
                profile;

            image.alt =
                actorName;

            image.className =
                'story-img';

            image.loading =
                'lazy';

            const name =
                document
                    .createElement(
                        'div'
                    );

            name.className =
                'story-name';

            name.title =
                actorName;

            name.textContent =
                actorName;

            card.append(
                image,
                name
            );

            card.addEventListener(
                'click',
                () => {
                    openActorDetails(
                        actorId,
                        actorName
                    );
                }
            );

            fragment.appendChild(
                card
            );
        });

        if (
            routeContext
                ?.signal
                ?.aborted
        ) {
            return;
        }

        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return;
        }

        container.replaceChildren(
            fragment
        );

        let direction = 1;

        if (
            trendingActorsAutoScrollInterval !==
            null
        ) {
            clearInterval(
                trendingActorsAutoScrollInterval
            );
        }

        trendingActorsAutoScrollInterval =
            setInterval(
                () => {
                    if (
                        !container
                            .classList
                            .contains(
                                'active'
                            )
                    ) {
                        container.scrollLeft +=
                            direction;

                        if (
                            container.scrollLeft >=
                            (
                                container.scrollWidth -
                                container.clientWidth -
                                1
                            )
                        ) {
                            direction =
                                -1;
                        } else if (
                            container.scrollLeft <=
                            0
                        ) {
                            direction =
                                1;
                        }
                    }
                },
                30
            );

        makeScrollable(
            container
        );
    } catch (error) {
        if (
            error.name ===
            'AbortError'
        ) {
            return;
        }

        console.error(
            'Trending actors yüklenemedi:',
            error
        );

        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return;
        }

        container.innerHTML =
            "<div style='color:red'>Oyuncular yüklenemedi.</div>";
    }
}

async function loadCuratedCollections(
    routeContext = null,
    expectedPage = null
) {
    const container =
        document.getElementById(
            'curated-collections-list'
        );

    if (!container) {
        return;
    }

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

    try {
        const results =
            await runHomeTasksWithConcurrency(
                collections,
                HOME_COLLECTION_CONCURRENCY,
                async c => {
                    const collectionId =
                        normalizeTmdbId(
                            c?.id
                        );

                    if (!collectionId) {
                        return null;
                    }

                    try {
                        const data =
                            await getCuratedCollectionData(
                                collectionId,
                                routeContext
                                    ?.signal
                            );

                        if (!data) {
                            return null;
                        }

                        if (
                            routeContext
                                ?.signal
                                ?.aborted
                        ) {
                            throw createHomeAbortError();
                        }

                        const responseCollectionId =
                            normalizeTmdbId(
                                data?.id
                            );

                        if (
                            responseCollectionId !==
                            collectionId
                        ) {
                            return null;
                        }

                        return {
                            data,
                            c,
                            collectionId
                        };
                    } catch (error) {
                        if (
                            error.name ===
                            'AbortError'
                        ) {
                            throw error;
                        }

                        console.warn(
                            `Collection ${collectionId} yüklenemedi:`,
                            error
                        );

                        return null;
                    }
                }
            );

        if (
            routeContext
                ?.signal
                ?.aborted
        ) {
            return;
        }

        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return;
        }

        const fragment =
            document
                .createDocumentFragment();

        results.forEach(result => {
            if (
                !result ||
                !result.data
            ) {
                return;
            }

            const {
                data,
                c,
                collectionId
            } = result;

            const responseCollectionId =
                normalizeTmdbId(
                    data?.id
                );

            if (
                responseCollectionId !==
                collectionId
            ) {
                return;
            }

            const parts =
                Array.isArray(
                    data.parts
                )
                    ? data.parts
                    : [];

            if (
                parts.length ===
                0
            ) {
                return;
            }

            const collectionName =
                String(
                    data.name ||
                    c.title ||
                    'Koleksiyon'
                );

            const posterFallback =
                getSafeTmdbImageUrl(
                    data.poster_path,
                    IMAGE_BASE,
                    'https://via.placeholder.com/300x170?text=Koleksiyon'
                );

            const poster =
                getSafeTmdbImageUrl(
                    data.backdrop_path,
                    BACKDROP_BASE,
                    posterFallback
                );

            const card =
                document
                    .createElement(
                        'div'
                    );

            card.className =
                'movie-card';

            card.title =
                collectionName;

            card.style.cssText =
                'width:250px;' +
                'flex-shrink:0;' +
                'cursor:pointer;';

            const image =
                document
                    .createElement(
                        'img'
                    );

            image.src =
                poster;

            image.alt =
                collectionName;

            image.loading =
                'lazy';

            image.style.cssText =
                'width:100%;' +
                'aspect-ratio:16/9;' +
                'object-fit:cover;';

            const info =
                document
                    .createElement(
                        'div'
                    );

            info.className =
                'movie-info';

            const title =
                document
                    .createElement(
                        'h4'
                    );

            title.style.cssText =
                'margin:10px 0;' +
                'font-size:1.1rem;' +
                'color:var(--text-color);';

            title.textContent =
                c.title;

            const count =
                document
                    .createElement(
                        'p'
                    );

            count.style.cssText =
                'font-size:0.8rem;' +
                'color:var(--text-muted);';

            count.textContent =
                `${parts.length} Film`;

            info.append(
                title,
                count
            );

            card.append(
                image,
                info
            );

            card.addEventListener(
                'click',
                () => {
                    openCollection(
                        collectionId
                    );
                }
            );

            fragment.appendChild(
                card
            );
        });

        if (
            routeContext
                ?.signal
                ?.aborted
        ) {
            return;
        }

        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return;
        }

        container.replaceChildren(
            fragment
        );

        let direction = 1;

        if (
            curatedCollectionsAutoScrollInterval !==
            null
        ) {
            clearInterval(
                curatedCollectionsAutoScrollInterval
            );
        }

        curatedCollectionsAutoScrollInterval =
            setInterval(
                () => {
                    if (
                        !container
                            .classList
                            .contains(
                                'active'
                            )
                    ) {
                        container.scrollLeft +=
                            direction;

                        if (
                            container.scrollLeft >=
                            (
                                container.scrollWidth -
                                container.clientWidth -
                                1
                            )
                        ) {
                            direction =
                                -1;
                        } else if (
                            container.scrollLeft <=
                            0
                        ) {
                            direction =
                                1;
                        }
                    }
                },
                30
            );

        makeScrollable(
            container
        );
    } catch (error) {
        if (
            error.name ===
            'AbortError'
        ) {
            return;
        }

        console.error(
            'Collections error:',
            error
        );
    }
}

async function openCollection(
    collectionId
) {
    const safeCollectionId =
        normalizeTmdbId(
            collectionId
        );

    if (!safeCollectionId) {
        return;
    }

    const routeContext = {
        generation:
            routeGeneration,
        signal:
            currentAbortController
                ?.signal
    };

    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });

    closeDetails(
        null,
        true
    );

    currentMode =
        'search';

    currentPage =
        1;

    document
        .querySelectorAll(
            '.tab-content'
        )
        .forEach(tab =>
            tab.classList.remove(
                'active-tab'
            )
        );

    const platform =
        document.getElementById(
            'platform'
        );

    if (platform) {
        platform.classList.add(
            'active-tab'
        );
    }

    const top10Section =
        document.getElementById(
            'top10-section'
        );

    if (top10Section) {
        top10Section.style.display =
            'none';
    }

    const platformFilters =
        document.querySelector(
            '.platform-filters'
        );

    if (platformFilters) {
        platformFilters.style.display =
            'none';
    }

    const filterControls =
        document.querySelector(
            '.filter-controls'
        );

    if (filterControls) {
        filterControls.style.display =
            'none';
    }

    const container =
        document.getElementById(
            'search-results'
        );

    if (!container) {
        return;
    }

    container.replaceChildren();

    showSkeletons(
        'search-results',
        10
    );

    try {
        const res =
            await fetch(
                `${BASE_URL}/collection/${safeCollectionId}?api_key=${API_KEY}&language=tr-TR`,
                {
                    signal:
                        routeContext.signal
                }
            );

        const data =
            await res.json();

        if (
            routeContext
                .signal
                ?.aborted ||
            routeContext
                .generation !==
                routeGeneration
        ) {
            return;
        }

        const rawName =
            typeof data?.name ===
                'string'
                ? data.name
                : '';

        const cleanName =
            rawName
                .replace(
                    /\s*(Serisi|Koleksiyonu|Collection|Üçlemesi|Efsanesi|\[Seri\])$/gi,
                    ''
                )
                .trim() ||
            'Koleksiyon';

        const overview =
            typeof data?.overview ===
                'string'
                ? data.overview
                : '';

        const parts =
            Array.isArray(
                data?.parts
            )
                ? [...data.parts]
                : [];

        parts.sort(
            (a, b) => {
                const dateA =
                    new Date(
                        a?.release_date ||
                        '2100-01-01'
                    );

                const dateB =
                    new Date(
                        b?.release_date ||
                        '2100-01-01'
                    );

                const timeA =
                    Number.isNaN(
                        dateA.getTime()
                    )
                        ? Date.parse(
                            '2100-01-01'
                        )
                        : dateA
                            .getTime();

                const timeB =
                    Number.isNaN(
                        dateB.getTime()
                    )
                        ? Date.parse(
                            '2100-01-01'
                        )
                        : dateB
                            .getTime();

                return (
                    timeA -
                    timeB
                );
            }
        );

        const header =
            document.createElement(
                'div'
            );

        header.style.cssText =
            'grid-column:1/-1;' +
            'margin-bottom:20px;' +
            'background:var(--card-bg);' +
            'padding:20px;' +
            'border-radius:15px;' +
            'border:1px solid var(--glass-border);';

        const heading =
            document.createElement(
                'h2'
            );

        heading.style.cssText =
            'color:var(--primary-color);' +
            'font-size:2rem;' +
            'margin-bottom:10px;';

        heading.textContent =
            cleanName;

        const overviewElement =
            document.createElement(
                'p'
            );

        overviewElement.style.cssText =
            'color:var(--text-muted);' +
            'font-size:1.1rem;';

        overviewElement.textContent =
            overview;

        header.append(
            heading,
            overviewElement
        );

        container.replaceChildren(
            header
        );

        let cardsHtml = '';

        parts.forEach(item => {
            cardsHtml +=
                createMovieCard(
                    item,
                    'movie',
                    ''
                );
        });

        if (cardsHtml) {
            const template =
                document.createElement(
                    'template'
                );

            // Trusted renderer:
            // createMovieCard() 2A'da
            // external değerler için sertleştirildi.
            template.innerHTML =
                cardsHtml;

            container.appendChild(
                template.content
            );
        }

        parts.forEach(item => {
            fetchAndInjectProviders(
                item?.id,
                'movie',
                item,
                routeContext
            );
        });
    } catch (e) {
        if (
            e.name ===
            'AbortError'
        ) {
            return;
        }

        if (
            routeContext
                .signal
                ?.aborted ||
            routeContext
                .generation !==
                routeGeneration
        ) {
            return;
        }

        container.innerHTML =
            "<div style='color:red'>Hata oluştu.</div>";
    }
}

async function loadSmartRecommendations(
    routeContext = null,
    expectedPage = null
) {
    let rated = [];
    let ratings = {};

    try {
        const parsedRated =
            JSON.parse(
                localStorage.getItem(
                    'ratedMovies'
                ) ||
                '[]'
            );

        if (
            Array.isArray(
                parsedRated
            )
        ) {
            rated =
                parsedRated;
        }
    } catch (error) {
        console.warn(
            'Rated movies okunamadı:',
            error
        );
    }

    try {
        const parsedRatings =
            JSON.parse(
                localStorage.getItem(
                    'movieRatings'
                ) ||
                '{}'
            );

        if (
            parsedRatings !== null &&
            typeof parsedRatings ===
                'object' &&
            !Array.isArray(
                parsedRatings
            )
        ) {
            ratings =
                parsedRatings;
        }
    } catch (error) {
        console.warn(
            'Movie ratings okunamadı:',
            error
        );
    }

    const section =
        document.getElementById(
            'smart-recommendations-section'
        );

    const list =
        document.getElementById(
            'smart-recommendations-list'
        );

    const showNoRatings =
        () => {
            if (section) {
                section.style.display =
                    'block';
            }

            if (list) {
                list.innerHTML =
                    "<p style='color:var(--text-muted); width:100%; text-align:center; padding:20px; grid-column: 1/-1;'>Henüz hiç film puanlamadınız. Profilinize gidip izlediğiniz filmlere puan vererek size özel öneriler alabilirsiniz.</p>";
            }
        };

    if (rated.length === 0) {
        showNoRatings();
        return;
    }

    const ratedWithScores =
        rated
            .map(movie => {
                const movieId =
                    normalizeTmdbId(
                        movie?.id
                    );

                if (!movieId) {
                    return null;
                }

                const mediaType =
                    normalizeMediaType(
                        movie
                            ?.media_type,
                        'movie'
                    );

                if (!mediaType) {
                    return null;
                }

                const ratingKey =
                    String(movieId);

                const storedRating =
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            ratings,
                            ratingKey
                        )
                        ? ratings[
                            ratingKey
                        ]
                        : null;

                const userRating =
                    normalizeUserRating(
                        storedRating
                    ) ?? 5;

                return {
                    ...movie,
                    id: movieId,
                    media_type:
                        mediaType,
                    user_rating:
                        userRating
                };
            })
            .filter(Boolean);

    if (
        ratedWithScores.length ===
        0
    ) {
        showNoRatings();
        return;
    }

    if (section) {
        section.style.display =
            'block';
    }

    showSkeletons(
        'smart-recommendations-list',
        14
    );

    try {
        ratedWithScores.sort(
            (a, b) =>
                b.user_rating -
                a.user_rating
        );

        const topMovies =
            ratedWithScores.slice(
                0,
                5
            );

        let recommendedMovies = [];

        for (
            const movie
            of topMovies
        ) {
            const movieId =
                normalizeTmdbId(
                    movie.id
                );

            const mediaType =
                normalizeMediaType(
                    movie.media_type,
                    'movie'
                );

            if (
                !movieId ||
                !mediaType
            ) {
                continue;
            }

            const res =
                await fetch(
                    `${BASE_URL}/${mediaType}/${movieId}/recommendations?api_key=${API_KEY}&language=tr-TR`,
                    {
                        signal:
                            routeContext
                                ?.signal
                    }
                );

            const data =
                await res.json();

            if (
                Array.isArray(
                    data?.results
                )
            ) {
                recommendedMovies.push(
                    ...data.results
                );
            }
        }

        const blockedGenres = [
            99,
            10767,
            10763,
            10764
        ];

        const blockedTitleWords = [
            'making of',
            'behind the scenes',
            'assembled',
            'the making',
            'xxx',
            'erotic',
            'sex'
        ];

        recommendedMovies =
            recommendedMovies.filter(
                movie => {
                    const movieId =
                        normalizeTmdbId(
                            movie?.id
                        );

                    if (!movieId) {
                        return false;
                    }

                    if (
                        Array.isArray(
                            movie
                                .genre_ids
                        ) &&
                        blockedGenres.some(
                            genre =>
                                movie
                                    .genre_ids
                                    .includes(
                                        genre
                                    )
                        )
                    ) {
                        return false;
                    }

                    const title =
                        String(
                            movie.title ||
                            movie.name ||
                            ''
                        )
                            .toLowerCase();

                    if (
                        blockedTitleWords
                            .some(word =>
                                title.includes(
                                    word
                                )
                            )
                    ) {
                        return false;
                    }

                    if (
                        !movie.poster_path
                    ) {
                        return false;
                    }

                    if (
                        movie.adult ===
                        true
                    ) {
                        return false;
                    }

                    const voteAverage =
                        Number(
                            movie
                                .vote_average
                        );

                    if (
                        !Number.isFinite(
                            voteAverage
                        ) ||
                        voteAverage < 5
                    ) {
                        return false;
                    }

                    movie.id =
                        movieId;

                    return true;
                }
            );

        const seen =
            new Set();

        recommendedMovies =
            recommendedMovies.filter(
                movie => {
                    const movieId =
                        normalizeTmdbId(
                            movie.id
                        );

                    if (!movieId) {
                        return false;
                    }

                    if (
                        seen.has(
                            movieId
                        )
                    ) {
                        return false;
                    }

                    seen.add(
                        movieId
                    );

                    const alreadyRated =
                        normalizeUserRating(
                            ratings[
                                String(
                                    movieId
                                )
                            ]
                        ) !== null;

                    return (
                        !alreadyRated
                    );
                }
            );

        recommendedMovies.sort(
            (a, b) => {
                const scoreA =
                    (
                        Number(
                            a
                                .vote_average
                        ) ||
                        0
                    ) *
                    Math.log10(
                        (
                            Number(
                                a
                                    .vote_count
                            ) ||
                            0
                        ) +
                        1
                    );

                const scoreB =
                    (
                        Number(
                            b
                                .vote_average
                        ) ||
                        0
                    ) *
                    Math.log10(
                        (
                            Number(
                                b
                                    .vote_count
                            ) ||
                            0
                        ) +
                        1
                    );

                return (
                    scoreB -
                    scoreA
                );
            }
        );

        let finalMovies =
            recommendedMovies.slice(
                0,
                14
            );

        if (
            finalMovies.length <
            14
        ) {
            const res =
                await fetch(
                    `${BASE_URL}/discover/movie?api_key=${API_KEY}&language=tr-TR&sort_by=vote_average.desc&vote_count.gte=1000&without_genres=99`,
                    {
                        signal:
                            routeContext
                                ?.signal
                    }
                );

            const data =
                await res.json();

            const extraResults =
                Array.isArray(
                    data?.results
                )
                    ? data.results
                    : [];

            const extra =
                extraResults.filter(
                    movie => {
                        const movieId =
                            normalizeTmdbId(
                                movie?.id
                            );

                        if (!movieId) {
                            return false;
                        }

                        if (
                            seen.has(
                                movieId
                            )
                        ) {
                            return false;
                        }

                        if (
                            normalizeUserRating(
                                ratings[
                                    String(
                                        movieId
                                    )
                                ]
                            ) !== null
                        ) {
                            return false;
                        }

                        if (
                            !movie.poster_path ||
                            movie.adult ===
                                true
                        ) {
                            return false;
                        }

                        const voteAverage =
                            Number(
                                movie
                                    .vote_average
                            );

                        if (
                            !Number.isFinite(
                                voteAverage
                            ) ||
                            voteAverage <
                                7
                        ) {
                            return false;
                        }

                        movie.id =
                            movieId;

                        seen.add(
                            movieId
                        );

                        return true;
                    }
                );

            finalMovies.push(
                ...extra.slice(
                    0,
                    14 -
                    finalMovies.length
                )
            );
        }

        let html = '';

        finalMovies.forEach(item => {
            const itemId =
                normalizeTmdbId(
                    item?.id
                );

            if (!itemId) {
                return;
            }

            const mediaType =
                normalizeMediaType(
                    item
                        ?.media_type,
                    'movie'
                );

            if (!mediaType) {
                return;
            }

            item.id =
                itemId;

            item.media_type =
                mediaType;

            html +=
                createMovieCard(
                    item,
                    mediaType,
                    'smart'
                );
        });

        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return;
        }

        if (list) {
            // Trusted renderer:
            // createMovieCard() 2A'da
            // external veriler için sertleştirildi.
            list.innerHTML =
                html;
        }
    } catch (e) {
        if (
            e.name ===
            'AbortError'
        ) {
            return;
        }

        console.error(
            'Smart Recommendation error',
            e
        );
    }
}