let trendingActorsAutoScrollInterval = null;
let curatedCollectionsAutoScrollInterval = null;
let trendingActorsRenderToken = 0;
let curatedCollectionsRenderToken = 0;

const HOME_TRENDING_ACTORS_CONCURRENCY = 3;
const HOME_TRENDING_ACTORS_STAGE1_PAGES = 3;
const HOME_COLLECTION_CONCURRENCY = 4;
const HOME_INITIAL_COLLECTION_COUNT = 6;

const HOME_TRENDING_ACTORS_TTL_MS =
    5 * 60 * 1000;

const HOME_COLLECTION_TTL_MS =
    10 * 60 * 1000;

const HOME_CURATED_COLLECTIONS = [
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

let trendingActorsCache = {
    timestamp: 0,
    actors: null
};

let trendingActorsInFlight = null;

const curatedCollectionCache =
    new Map();

const curatedCollectionInFlight =
    new Map();

let activeCollectionFetches = 0;
const collectionFetchWaiters = [];

function createHomeAbortError() {
    const error =
        new Error('Aborted');

    error.name =
        'AbortError';

    return error;
}

function getHomeSizedImageBase(size, fallbackBase) {
    if (typeof getSizedTmdbImageBase === 'function') {
        return getSizedTmdbImageBase(size, fallbackBase);
    }
    const base =
        typeof fallbackBase === 'string' && fallbackBase
            ? fallbackBase
            : 'https://image.tmdb.org/t/p/w500';
    return base.replace(/\/t\/p\/[^/]+$/, `/t/p/${size}`);
}

/**
 * Waits until a visible home section nears the viewport via IntersectionObserver,
 * with a deterministic fallback timer so offscreen or headless layouts never stall.
 */
function waitForHomeSectionVisible(target, signal = null, fallbackDelayMs = 250) {
    if (signal?.aborted) {
        return Promise.reject(createHomeAbortError());
    }
    if (!target || target.offsetParent === null || typeof IntersectionObserver !== 'function') {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        let observer = null;
        let fallbackTimer = null;

        const cleanup = () => {
            if (observer) {
                observer.disconnect();
                observer = null;
            }
            if (fallbackTimer !== null) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
        };

        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };

        const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(createHomeAbortError());
        };

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting || entry.intersectionRatio > 0)) {
                    finish();
                }
            },
            { rootMargin: '250px' }
        );
        observer.observe(target);

        fallbackTimer = setTimeout(finish, fallbackDelayMs);
    });
}

/**
 * Defers secondary home batches to idle time or immediate user interaction,
 * while supporting abort signals and synchronous flush for direct callers.
 */
function waitForHomeDeferredStage(
    container = null,
    signal = null,
    { idleTimeoutMs = 450, fallbackDelayMs = 120, externalControl = null } = {}
) {
    if (signal?.aborted) {
        return Promise.reject(createHomeAbortError());
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        let idleId = null;
        let timerId = null;

        const interactionEvents = ['scroll', 'pointerenter', 'focusin'];

        const cleanup = () => {
            if (idleId !== null && typeof cancelIdleCallback === 'function') {
                cancelIdleCallback(idleId);
                idleId = null;
            }
            if (timerId !== null) {
                clearTimeout(timerId);
                timerId = null;
            }
            if (container) {
                interactionEvents.forEach(evt => {
                    container.removeEventListener(evt, finish);
                });
            }
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
            if (externalControl && externalControl.flush === finish) {
                externalControl.flush = null;
            }
        };

        const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };

        const onAbort = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(createHomeAbortError());
        };

        if (externalControl) {
            externalControl.flush = finish;
        }

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        if (container) {
            interactionEvents.forEach(evt => {
                container.addEventListener(evt, finish, { once: true, passive: true });
            });
        }

        if (typeof requestIdleCallback === 'function') {
            idleId = requestIdleCallback(() => finish(), { timeout: idleTimeoutMs });
        } else {
            timerId = setTimeout(finish, fallbackDelayMs);
        }
    });
}

function acquireCollectionFetchSlot(signal = null) {
    if (signal?.aborted) {
        return Promise.reject(createHomeAbortError());
    }
    if (activeCollectionFetches < HOME_COLLECTION_CONCURRENCY) {
        activeCollectionFetches++;
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const entry = {};

        const cleanup = () => {
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
        };

        const onAbort = () => {
            const idx = collectionFetchWaiters.indexOf(entry);
            if (idx !== -1) {
                collectionFetchWaiters.splice(idx, 1);
            }
            cleanup();
            reject(createHomeAbortError());
        };

        entry.resolve = () => {
            cleanup();
            activeCollectionFetches++;
            resolve();
        };

        if (signal) {
            signal.addEventListener('abort', onAbort, { once: true });
        }

        collectionFetchWaiters.push(entry);
    });
}

function releaseCollectionFetchSlot() {
    activeCollectionFetches = Math.max(0, activeCollectionFetches - 1);
    while (activeCollectionFetches < HOME_COLLECTION_CONCURRENCY && collectionFetchWaiters.length > 0) {
        const next = collectionFetchWaiters.shift();
        next.resolve();
    }
}

function startHorizontalAutoScroll(container, setTimer, getTimer) {
    const existing = getTimer();
    if (existing !== null) {
        clearInterval(existing);
        setTimer(null);
    }

    if (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) {
        return;
    }

    let direction = 1;
    const timer = setInterval(() => {
        if (
            document.hidden ||
            !container.isConnected ||
            container.offsetParent === null ||
            container.classList.contains('active')
        ) {
            return;
        }

        container.scrollLeft += direction;

        if (
            container.scrollLeft >=
            container.scrollWidth - container.clientWidth - 1
        ) {
            direction = -1;
        } else if (container.scrollLeft <= 0) {
            direction = 1;
        }
    }, 30);

    setTimer(timer);
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

function filterValidTrendingActors(successfulPages) {
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

        const actorPopularity =
            Number(
                actor.popularity
            );

        if (
            !Number.isFinite(
                actorPopularity
            ) ||
            actorPopularity < 10
        ) {
            return;
        }

        if (
            !isValidTmdbImagePath(
                actor.profile_path
            )
        ) {
            return;
        }

        const actorName =
            actor.name
                .trim()
                .normalize('NFC');

        if (
            actor.known_for_department !==
            'Acting'
        ) {
            return;
        }

        const hasOnlyLatinNameChars =
            /^[\p{Script=Latin}\p{M}\s.'’\-]+$/u
                .test(
                    actorName
                );

        if (
            !hasOnlyLatinNameChars
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

        const nonAdultKnownFor =
            knownFor.filter(
                work =>
                    work &&
                    work.adult !== true
            );

        if (
            nonAdultKnownFor.length ===
            0
        ) {
            return;
        }

        const hasRecognizableWork =
            nonAdultKnownFor.some(
                work => {
                    const voteCount =
                        Number(
                            work?.vote_count
                        );

                    return (
                        Number.isFinite(
                            voteCount
                        ) &&
                        voteCount >= 250
                    );
                }
            );

        if (
            !hasRecognizableWork
        ) {
            return;
        }

        seenActorIds.add(
            actorId
        );

        actors.push({
            id: actorId,
            name:
                actorName,
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

async function fetchTrendingActorPage(page, signal) {
    try {
        const response =
            await fetch(
                `${BASE_URL}/person/popular?language=tr-TR&page=${page}`,
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

async function fetchTrendingActorsData(
    signal,
    { notifyStage1 = null, deferControl = null } = {}
) {
    const stage1Pages =
        Array.from(
            {
                length: HOME_TRENDING_ACTORS_STAGE1_PAGES
            },
            (_, index) => index + 1
        );

    const stage2Pages =
        Array.from(
            {
                length: 8 - HOME_TRENDING_ACTORS_STAGE1_PAGES
            },
            (_, index) => index + HOME_TRENDING_ACTORS_STAGE1_PAGES + 1
        );

    const stage1Results =
        await runHomeTasksWithConcurrency(
            stage1Pages,
            HOME_TRENDING_ACTORS_CONCURRENCY,
            page => fetchTrendingActorPage(page, signal)
        );

    const stage1Successful =
        stage1Results.filter(result => result?.ok);

    if (
        stage1Successful.length > 0 &&
        typeof notifyStage1 === 'function' &&
        !signal?.aborted
    ) {
        const partialActors =
            filterValidTrendingActors(stage1Successful);
        if (partialActors.length > 0) {
            notifyStage1(partialActors);
        }
    }

    if (deferControl?.shouldDefer && !signal?.aborted) {
        await waitForHomeDeferredStage(
            deferControl.container || null,
            signal,
            {
                idleTimeoutMs: 400,
                fallbackDelayMs: 120,
                externalControl: deferControl
            }
        );
    }

    const stage2Results =
        await runHomeTasksWithConcurrency(
            stage2Pages,
            HOME_TRENDING_ACTORS_CONCURRENCY,
            page => fetchTrendingActorPage(page, signal)
        );

    const successfulPages =
        [...stage1Results, ...stage2Results].filter(
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

    return filterValidTrendingActors(successfulPages);
}

function getTrendingActorsData(
    signal = null,
    { onStage1Actors = null, deferStage2 = false, container = null } = {}
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
        const stage1Listeners = new Set();
        const deferControl = {
            shouldDefer: Boolean(deferStage2),
            container,
            flush: null
        };

        if (typeof onStage1Actors === 'function') {
            stage1Listeners.add(onStage1Actors);
        }

        entry =
            createSharedHomeTask(
                async sharedSignal => {
                    const actors =
                        await fetchTrendingActorsData(
                            sharedSignal,
                            {
                                deferControl,
                                notifyStage1: partialActors => {
                                    entry.stage1Actors = partialActors;
                                    stage1Listeners.forEach(listener => {
                                        try {
                                            listener(partialActors);
                                        } catch (err) {}
                                    });
                                }
                            }
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

        entry.stage1Listeners = stage1Listeners;
        entry.stage1Actors = null;
        entry.deferControl = deferControl;

        trendingActorsInFlight =
            entry;
    } else {
        if (!deferStage2 && trendingActorsInFlight.deferControl) {
            trendingActorsInFlight.deferControl.shouldDefer = false;
            if (typeof trendingActorsInFlight.deferControl.flush === 'function') {
                trendingActorsInFlight.deferControl.flush();
            }
        }
        if (typeof onStage1Actors === 'function') {
            if (Array.isArray(trendingActorsInFlight.stage1Actors) && trendingActorsInFlight.stage1Actors.length > 0) {
                onStage1Actors(trendingActorsInFlight.stage1Actors);
            } else if (trendingActorsInFlight.stage1Listeners) {
                trendingActorsInFlight.stage1Listeners.add(onStage1Actors);
            }
        }
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
    await acquireCollectionFetchSlot(signal);
    try {
        const response =
            await fetch(
                `${BASE_URL}/collection/${collectionId}?language=tr-TR`,
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
    } finally {
        releaseCollectionFetchSlot();
    }
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
                `${BASE_URL}/trending/all/week?language=tr-TR`,
                {
                    signal:
                        routeContext
                            ?.signal
                }
            );

        if (!res.ok) {
            throw new Error(`Top 10 HTTP ${res.status}`);
        }

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

        const top10PosterBase =
            getHomeSizedImageBase('w342', IMAGE_BASE);

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
                        top10PosterBase,
                        'assets/placeholder.svg'
                    );

                const cachedEntry = {
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

                if (typeof setCachedMedia === 'function') {
                    setCachedMedia(cachedEntry, mediaType);
                } else {
                    window.movieCache[itemId] = cachedEntry;
                    window.movieCache[`${mediaType}:${itemId}`] = cachedEntry;
                }

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

                image.decoding =
                    'async';

                image.width = 140;
                image.height = 210;

                image.style.cssText =
                    'width:100%;' +
                    'height:210px;' +
                    'object-fit:cover;' +
                    'border-radius:10px;' +
                    'box-shadow:0 5px 15px rgba(0,0,0,0.5);';

                card.setAttribute('role', 'button');
                card.setAttribute('tabindex', '0');
                card.setAttribute('aria-label', `Top 10 - ${index + 1}: ${title}`);

                card.append(
                    number,
                    image
                );

                const activateTop10 = () => {
                    openDetails(
                        itemId,
                        mediaType
                    );
                };

                card.addEventListener(
                    'click',
                    activateTop10
                );

                card.addEventListener(
                    'keydown',
                    (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            activateTop10();
                        }
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

    if (!container || container.querySelector('.movie-card:not(.skeleton-card)')) return;
    
    container.style.display = "";
    showSkeletons('now-playing-grid', 10);
    try {
        const res = await fetch(`${BASE_URL}/movie/now_playing?language=tr-TR&region=TR&page=1`, { signal: routeContext?.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        if (routeContext && expectedPage && !isRouteContextCurrent(routeContext, expectedPage)) return;
        
        const results =
    Array.isArray(
        data?.results
    )
        ? data.results
        : [];

        const html = typeof createMovieCardsBatch === 'function'
            ? createMovieCardsBatch(results, 'movie', 'now-playing')
            : results.map(movie => createMovieCard(movie, 'movie', 'now-playing')).join('');

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
    if (!container || container.querySelector('.movie-card:not(.skeleton-card)')) return;
    
    container.style.display = "";
    container.innerHTML = "<div class='loading'>Gelecek filmler çekiliyor...</div>";
    try {
        const today = new Date().toLocaleDateString('sv-SE');
        const response = await fetch(`${BASE_URL}/discover/movie?language=tr-TR&region=TR&with_release_type=2|3&release_date.gte=${today}&sort_by=release_date.asc&popularity.gte=15&page=1`, { signal: routeContext?.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (routeContext && !isRouteContextCurrent(routeContext, "vizyon")) return;
        
        const results =
    Array.isArray(
        data?.results
    )
        ? data.results
        : [];

const html = typeof createMovieCardsBatch === 'function'
    ? createMovieCardsBatch(results, 'movie', 'upcoming')
    : results.map(movie => createMovieCard(movie, 'movie', 'upcoming')).join('');

container.innerHTML =
    html;
    } catch (error) {
        if (error.name === 'AbortError') return;
        container.innerHTML = "<div class='loading'>Hata oluştu.</div>";
    }
}

function buildTrendingActorCard(actor, actorImageBase) {
    const actorId =
        normalizeTmdbId(
            actor?.id
        );

    if (!actorId) {
        return null;
    }

    if (
        typeof actor.name !==
            'string' ||
        !actor.name.trim()
    ) {
        return null;
    }

    const actorName =
        actor.name.trim();

    const profile =
        getSafeTmdbImageUrl(
            actor
                .profile_path,
            actorImageBase,
            'assets/placeholder.svg'
        );

    const card =
        document
            .createElement(
                'div'
            );

    card.className =
        'story-item';

    card.dataset.actorId =
        String(actorId);

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

    image.decoding =
        'async';

    image.width = 80;
    image.height = 80;

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

    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${actorName} detaylarını görüntüle`);

    card.append(
        image,
        name
    );

    const activateActor = () => {
        openActorDetails(
            actorId,
            actorName
        );
    };

    card.addEventListener(
        'click',
        activateActor
    );

    card.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activateActor();
            }
        }
    );

    return card;
}

function renderTrendingActorsIntoContainer(container, actors, { appendOnly = false } = {}) {
    const actorImageBase =
        getHomeSizedImageBase('w185', IMAGE_BASE);

    if (appendOnly) {
        const existingIds = new Set(
            Array.from(container.querySelectorAll('.story-item[data-actor-id]'))
                .map(el => el.dataset.actorId)
        );
        if (existingIds.size > 0) {
            const appendFragment = document.createDocumentFragment();
            actors.forEach(actor => {
                const actorId = normalizeTmdbId(actor?.id);
                if (!actorId || existingIds.has(String(actorId))) {
                    return;
                }
                const card = buildTrendingActorCard(actor, actorImageBase);
                if (card) {
                    appendFragment.appendChild(card);
                }
            });
            if (appendFragment.childNodes.length > 0) {
                container.appendChild(appendFragment);
            }
            return;
        }
    }

    const fragment =
        document
            .createDocumentFragment();

    actors.forEach(actor => {
        const card = buildTrendingActorCard(actor, actorImageBase);
        if (card) {
            fragment.appendChild(card);
        }
    });

    container.replaceChildren(
        fragment
    );
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

    const renderToken =
        ++trendingActorsRenderToken;

    const isStillValid = () => {
        if (renderToken !== trendingActorsRenderToken) {
            return false;
        }
        if (routeContext?.signal?.aborted) {
            return false;
        }
        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return false;
        }
        return true;
    };

    let renderedStage1 = false;

    try {
        const actors =
            await getTrendingActorsData(
                routeContext
                    ?.signal,
                {
                    deferStage2: Boolean(routeContext),
                    container,
                    onStage1Actors: partialActors => {
                        if (!isStillValid()) {
                            return;
                        }
                        renderTrendingActorsIntoContainer(container, partialActors, { appendOnly: false });
                        renderedStage1 = true;
                        startHorizontalAutoScroll(
                            container,
                            timer => { trendingActorsAutoScrollInterval = timer; },
                            () => trendingActorsAutoScrollInterval
                        );
                        makeScrollable(container);
                    }
                }
            );

        if (!isStillValid()) {
            return;
        }

        renderTrendingActorsIntoContainer(
            container,
            actors,
            { appendOnly: renderedStage1 }
        );

        startHorizontalAutoScroll(
            container,
            timer => { trendingActorsAutoScrollInterval = timer; },
            () => trendingActorsAutoScrollInterval
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

        if (!isStillValid()) {
            return;
        }

        container.innerHTML =
            "<div style='color:red'>Oyuncular yüklenemedi.</div>";
    }
}

function buildCuratedCollectionCard(result, backdropBase, posterBase) {
    if (!result || !result.data) {
        return null;
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
        return null;
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
        return null;
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
            posterBase,
            'assets/placeholder.svg'
        );

    const poster =
        getSafeTmdbImageUrl(
            data.backdrop_path,
            backdropBase,
            posterFallback
        );

    const card =
        document
            .createElement(
                'div'
            );

    card.className =
        'movie-card';

    card.dataset.collectionId =
        String(collectionId);

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

    image.decoding =
        'async';

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

    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${collectionName}, ${parts.length} Film`);

    card.append(
        image,
        info
    );

    const activateCollection = () => {
        openCollection(
            collectionId
        );
    };

    card.addEventListener(
        'click',
        activateCollection
    );

    card.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activateCollection();
            }
        }
    );

    return card;
}

async function fetchCuratedCollectionBatch(batch, signal) {
    return runHomeTasksWithConcurrency(
        batch,
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
                        signal
                    );

                if (!data) {
                    return null;
                }

                if (signal?.aborted) {
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

    const renderToken =
        ++curatedCollectionsRenderToken;

    const isStillValid = () => {
        if (renderToken !== curatedCollectionsRenderToken) {
            return false;
        }
        if (routeContext?.signal?.aborted) {
            return false;
        }
        if (
            routeContext &&
            expectedPage &&
            !isRouteContextCurrent(
                routeContext,
                expectedPage
            )
        ) {
            return false;
        }
        return true;
    };

    const backdropBase =
        getHomeSizedImageBase('w780', BACKDROP_BASE);

    const posterBase =
        getHomeSizedImageBase('w342', IMAGE_BASE);

    try {
        const allCached = HOME_CURATED_COLLECTIONS.every(c =>
            Boolean(getCachedCuratedCollection(c.id))
        );

        if (allCached) {
            const fragment = document.createDocumentFragment();
            HOME_CURATED_COLLECTIONS.forEach(c => {
                const data = getCachedCuratedCollection(c.id);
                const card = buildCuratedCollectionCard(
                    { data, c, collectionId: c.id },
                    backdropBase,
                    posterBase
                );
                if (card) {
                    fragment.appendChild(card);
                }
            });
            if (!isStillValid()) {
                return;
            }
            container.replaceChildren(fragment);
            startHorizontalAutoScroll(
                container,
                timer => { curatedCollectionsAutoScrollInterval = timer; },
                () => curatedCollectionsAutoScrollInterval
            );
            makeScrollable(container);
            return;
        }

        if (routeContext) {
            const section = document.getElementById('collections-section') || container;
            await waitForHomeSectionVisible(section, routeContext.signal, 250);
            if (!isStillValid()) {
                return;
            }
        }

        const initialBatch =
            HOME_CURATED_COLLECTIONS.slice(0, HOME_INITIAL_COLLECTION_COUNT);

        const deferredBatch =
            HOME_CURATED_COLLECTIONS.slice(HOME_INITIAL_COLLECTION_COUNT);

        const stage1Results =
            await fetchCuratedCollectionBatch(
                initialBatch,
                routeContext?.signal
            );

        if (!isStillValid()) {
            return;
        }

        const stage1Fragment =
            document.createDocumentFragment();

        stage1Results.forEach(result => {
            const card = buildCuratedCollectionCard(
                result,
                backdropBase,
                posterBase
            );
            if (card) {
                stage1Fragment.appendChild(card);
            }
        });

        container.replaceChildren(
            stage1Fragment
        );

        startHorizontalAutoScroll(
            container,
            timer => { curatedCollectionsAutoScrollInterval = timer; },
            () => curatedCollectionsAutoScrollInterval
        );

        makeScrollable(
            container
        );

        if (deferredBatch.length === 0) {
            return;
        }

        const deferredAllCached = deferredBatch.every(c =>
            Boolean(getCachedCuratedCollection(c.id))
        );

        if (routeContext && !deferredAllCached) {
            await waitForHomeDeferredStage(
                container,
                routeContext.signal,
                { idleTimeoutMs: 500, fallbackDelayMs: 150 }
            );
            if (!isStillValid()) {
                return;
            }
        }

        const stage2Results =
            await fetchCuratedCollectionBatch(
                deferredBatch,
                routeContext?.signal
            );

        if (!isStillValid()) {
            return;
        }

        const existingIds = new Set(
            Array.from(container.querySelectorAll('[data-collection-id]'))
                .map(el => el.dataset.collectionId)
        );

        const stage2Fragment =
            document.createDocumentFragment();

        stage2Results.forEach(result => {
            if (!result || existingIds.has(String(result.collectionId))) {
                return;
            }
            const card = buildCuratedCollectionCard(
                result,
                backdropBase,
                posterBase
            );
            if (card) {
                stage2Fragment.appendChild(card);
            }
        });

        if (stage2Fragment.childNodes.length > 0) {
            container.appendChild(stage2Fragment);
        }
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

    const scrollBehavior = (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) ? 'auto' : 'smooth';
    window.scrollTo({
        top: 0,
        behavior: scrollBehavior
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
        const data =
            await getCuratedCollectionData(
                safeCollectionId,
                routeContext.signal
            );

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

        if (!data) {
            throw new Error('Koleksiyon verisi alınamadı');
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

        const cardsHtml = typeof createMovieCardsBatch === 'function'
            ? createMovieCardsBatch(parts, 'movie', '')
            : parts.map(item => createMovieCard(item, 'movie', '')).join('');

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
    const rated = typeof safeReadStorage === 'function'
        ? safeReadStorage('ratedMovies', [])
        : [];
    const ratings = typeof safeReadStorage === 'function'
        ? safeReadStorage('movieRatings', {})
        : {};

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
                list.innerHTML = `
                    <div class="recommendations-empty-state" style="grid-column: 1 / -1; text-align: center; padding: 30px 15px; color: var(--text-muted);">
                        <i class="fas fa-magic" style="font-size: 2rem; color: var(--primary-color); margin-bottom: 12px; display: block;" aria-hidden="true"></i>
                        <h4 style="color: var(--text-color); margin-bottom: 8px;">Henüz Yeterli Puanlama Yok</h4>
                        <p style="max-width: 450px; margin: 0 auto; line-height: 1.5;">İzlediğiniz film veya dizilere puan vererek zevkinize özel akıllı önerileri burada görebilirsiniz.</p>
                    </div>
                `;
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
                    inferItemMediaType(
                        movie,
                        'movie'
                    );

                if (!mediaType) {
                    return null;
                }

                const userRating =
                    (typeof getUserRatingForMedia === 'function'
                        ? getUserRatingForMedia(
                              ratings,
                              movieId,
                              mediaType
                          )
                        : normalizeUserRating(
                              ratings[String(movieId)]
                          )) ?? 5;

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
        const isHomeBackgroundCall =
            Boolean(routeContext) &&
            !document.getElementById('profile')?.classList.contains('active-tab');

        if (isHomeBackgroundCall) {
            await waitForHomeDeferredStage(
                null,
                routeContext.signal,
                { idleTimeoutMs: 600, fallbackDelayMs: 200 }
            );
            if (
                expectedPage &&
                !isRouteContextCurrent(routeContext, expectedPage)
            ) {
                return;
            }
        }

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

        const recommendationChunks =
            await runHomeTasksWithConcurrency(
                topMovies,
                3,
                async movie => {
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
                        return [];
                    }

                    const res =
                        await fetch(
                            `${BASE_URL}/${mediaType}/${movieId}/recommendations?language=tr-TR`,
                            {
                                signal:
                                    routeContext
                                        ?.signal
                            }
                        );

                    if (!res.ok) {
                        return [];
                    }

                    const data =
                        await res.json();

                    if (
                        !Array.isArray(
                            data?.results
                        )
                    ) {
                        return [];
                    }

                    return data.results.map(rec => ({
                        ...rec,
                        media_type:
                            normalizeMediaType(
                                rec?.media_type,
                                mediaType
                            ) || mediaType
                    }));
                }
            );

        let recommendedMovies =
            recommendationChunks.flat();

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

                    const recMediaType =
                        inferItemMediaType(
                            movie,
                            'movie'
                        );

                    const compositeKey =
                        `${recMediaType}:${movieId}`;

                    if (
                        seen.has(
                            compositeKey
                        )
                    ) {
                        return false;
                    }

                    seen.add(
                        compositeKey
                    );

                    const alreadyRated =
                        (typeof getUserRatingForMedia === 'function'
                            ? getUserRatingForMedia(
                                  ratings,
                                  movieId,
                                  recMediaType
                              )
                            : normalizeUserRating(
                                  ratings[
                                      String(
                                          movieId
                                      )
                                  ]
                              )) !== null;

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
                    `${BASE_URL}/discover/movie?language=tr-TR&sort_by=vote_average.desc&vote_count.gte=1000&without_genres=99`,
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

                        const compositeKey =
                            `movie:${movieId}`;

                        if (
                            seen.has(
                                compositeKey
                            )
                        ) {
                            return false;
                        }

                        const alreadyRatedExtra =
                            (typeof getUserRatingForMedia === 'function'
                                ? getUserRatingForMedia(
                                      ratings,
                                      movieId,
                                      'movie'
                                  )
                                : normalizeUserRating(
                                      ratings[
                                          String(
                                              movieId
                                          )
                                      ]
                                  )) !== null;

                        if (alreadyRatedExtra) {
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
                        movie.media_type =
                            'movie';

                        seen.add(
                            compositeKey
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

        const normalizedFinalMovies = [];

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

            normalizedFinalMovies.push(item);
        });

        const html = typeof createMovieCardsBatch === 'function'
            ? createMovieCardsBatch(normalizedFinalMovies, null, 'smart')
            : normalizedFinalMovies.map(item => createMovieCard(item, item.media_type, 'smart')).join('');

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

            finalMovies.forEach(item => {
                const itemId =
                    normalizeTmdbId(
                        item?.id
                    );

                const mediaType =
                    normalizeMediaType(
                        item?.media_type,
                        'movie'
                    );

                if (
                    !itemId ||
                    !mediaType
                ) {
                    return;
                }

                fetchAndInjectProviders(
                    itemId,
                    mediaType,
                    item,
                    routeContext
                );
            });
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