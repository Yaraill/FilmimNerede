const PROVIDER_CACHE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_CACHE_MAX_SIZE = 300;
const PROVIDER_MAX_CONCURRENT_REQUESTS = 5;
const PROVIDER_VIEWPORT_MARGIN_PX = 150;

const providerDataCache = new Map();
const providerDataCacheTimestamps = new Map();
const providerInflightRequests = new Map();
const providerInflightTasks = new Map();
const providerRequestQueue = [];
const providerQueuedTasks = new Map();
const providerObservedElements =
    typeof WeakMap === 'function' ? new WeakMap() : new Map();

let activeProviderRequestCount = 0;
let providerQueueDrainScheduled = false;
let providerQueueSequence = 0;
let providerVisibilityObserver = null;

function createProviderAbortError() {
    if (typeof DOMException === 'function') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
}

function getCachedProviderData(cacheKey) {
    if (!providerDataCache.has(cacheKey)) {
        return null;
    }

    const cachedAt = providerDataCacheTimestamps.get(cacheKey);
    if (typeof cachedAt === 'number') {
        if (Date.now() - cachedAt > PROVIDER_CACHE_TTL_MS) {
            providerDataCache.delete(cacheKey);
            providerDataCacheTimestamps.delete(cacheKey);
            return null;
        }
    } else {
        providerDataCacheTimestamps.set(cacheKey, Date.now());
    }

    const value = providerDataCache.get(cacheKey);
    providerDataCache.delete(cacheKey);
    providerDataCache.set(cacheKey, value);
    return value;
}

function setCachedProviderData(cacheKey, data) {
    if (providerDataCache.has(cacheKey)) {
        providerDataCache.delete(cacheKey);
        providerDataCacheTimestamps.delete(cacheKey);
    }

    while (providerDataCache.size >= PROVIDER_CACHE_MAX_SIZE) {
        const oldestKey = providerDataCache.keys().next().value;
        if (oldestKey === undefined) break;
        providerDataCache.delete(oldestKey);
        providerDataCacheTimestamps.delete(oldestKey);
    }

    providerDataCache.set(cacheKey, data);
    providerDataCacheTimestamps.set(cacheKey, Date.now());
}

function isProviderContainerNearViewport(el) {
    if (!el || el.isConnected === false) {
        return false;
    }
    if (typeof el.getBoundingClientRect !== 'function') {
        return true;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
        return false;
    }
    const viewportHeight =
        window.innerHeight || document.documentElement?.clientHeight || 900;
    const viewportWidth =
        window.innerWidth || document.documentElement?.clientWidth || 1440;
    return (
        rect.bottom >= -PROVIDER_VIEWPORT_MARGIN_PX &&
        rect.top <= viewportHeight + PROVIDER_VIEWPORT_MARGIN_PX &&
        rect.right >= -PROVIDER_VIEWPORT_MARGIN_PX &&
        rect.left <= viewportWidth + PROVIDER_VIEWPORT_MARGIN_PX
    );
}

function getProviderVisibilityObserver() {
    if (providerVisibilityObserver) {
        return providerVisibilityObserver;
    }
    if (typeof IntersectionObserver !== 'function') {
        return null;
    }
    providerVisibilityObserver = new IntersectionObserver(
        entries => {
            entries.forEach(entry => {
                const el = entry.target;
                if (!el.isConnected) {
                    providerVisibilityObserver.unobserve(el);
                    providerObservedElements.delete(el);
                    return;
                }
                if (entry.isIntersecting) {
                    const keys = providerObservedElements.get(el);
                    providerVisibilityObserver.unobserve(el);
                    providerObservedElements.delete(el);
                    if (keys) {
                        keys.forEach(key => promoteQueuedProviderTask(key));
                    }
                }
            });
        },
        { rootMargin: `${PROVIDER_VIEWPORT_MARGIN_PX}px` }
    );
    return providerVisibilityObserver;
}

function observeProviderContainers(task, containers) {
    const observer = getProviderVisibilityObserver();
    if (!observer || !containers || containers.length === 0) {
        return;
    }
    containers.forEach(el => {
        if (!el || el.isConnected === false) return;
        let keys = providerObservedElements.get(el);
        if (!keys) {
            keys = new Set();
            providerObservedElements.set(el, keys);
            observer.observe(el);
        }
        keys.add(task.cacheKey);
        task.observedElements.add(el);
    });
}

function unobserveProviderTaskContainers(task) {
    if (!task || !task.observedElements || task.observedElements.size === 0) {
        return;
    }
    const observer = providerVisibilityObserver;
    task.observedElements.forEach(el => {
        const keys = providerObservedElements.get(el);
        if (keys) {
            keys.delete(task.cacheKey);
            if (keys.size === 0) {
                providerObservedElements.delete(el);
                if (observer) {
                    observer.unobserve(el);
                }
            }
        } else if (observer) {
            observer.unobserve(el);
        }
    });
    task.observedElements.clear();
}

function promoteQueuedProviderTask(cacheKey) {
    const task = providerQueuedTasks.get(cacheKey);
    if (!task || task.priority >= 1) {
        return;
    }
    task.priority = 1;
    unobserveProviderTaskContainers(task);
}

function cancelProviderTask(task) {
    if (!task) return;
    task.aborted = true;
    if (providerQueuedTasks.get(task.cacheKey) === task) {
        providerQueuedTasks.delete(task.cacheKey);
        const idx = providerRequestQueue.indexOf(task);
        if (idx !== -1) {
            providerRequestQueue.splice(idx, 1);
        }
        unobserveProviderTaskContainers(task);
        task.reject(createProviderAbortError());
        return;
    }
    if (providerInflightTasks.get(task.cacheKey) === task) {
        providerInflightTasks.delete(task.cacheKey);
        if (
            task.inflightPromise &&
            providerInflightRequests.get(task.cacheKey) === task.inflightPromise
        ) {
            providerInflightRequests.delete(task.cacheKey);
        }
        task.controller?.abort();
    }
}

function wrapProviderPromiseForCaller(promise, signal, task) {
    if (!signal) {
        if (task) {
            task.callers.add(null);
        }
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(createProviderAbortError());
    }

    const callerToken = { signal };
    if (task) {
        task.callers.add(callerToken);
    }

    return new Promise((resolve, reject) => {
        const onAbort = () => {
            if (task) {
                task.callers.delete(callerToken);
                if (task.callers.size === 0) {
                    cancelProviderTask(task);
                }
            }
            reject(createProviderAbortError());
        };

        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener('abort', onAbort);
                if (task) {
                    task.callers.delete(callerToken);
                }
                resolve(value);
            },
            err => {
                signal.removeEventListener('abort', onAbort);
                if (task) {
                    task.callers.delete(callerToken);
                }
                reject(err);
            }
        );
    });
}

function scheduleProviderQueueDrain() {
    if (providerQueueDrainScheduled) {
        return;
    }
    providerQueueDrainScheduled = true;
    if (typeof queueMicrotask === 'function') {
        queueMicrotask(drainProviderQueue);
    } else {
        Promise.resolve().then(drainProviderQueue);
    }
}

function pickNextQueuedProviderTask() {
    if (providerRequestQueue.length === 0) {
        return null;
    }
    let bestIndex = 0;
    for (let i = 1; i < providerRequestQueue.length; i++) {
        const candidate = providerRequestQueue[i];
        const currentBest = providerRequestQueue[bestIndex];
        if (
            candidate.priority > currentBest.priority ||
            (candidate.priority === currentBest.priority &&
                candidate.seq < currentBest.seq)
        ) {
            bestIndex = i;
        }
    }
    return providerRequestQueue.splice(bestIndex, 1)[0];
}

function drainProviderQueue() {
    providerQueueDrainScheduled = false;

    while (
        activeProviderRequestCount < PROVIDER_MAX_CONCURRENT_REQUESTS &&
        providerRequestQueue.length > 0
    ) {
        const task = pickNextQueuedProviderTask();
        if (!task) break;

        providerQueuedTasks.delete(task.cacheKey);
        unobserveProviderTaskContainers(task);

        if (
            task.aborted ||
            task.callers.size === 0 ||
            task.controller?.signal?.aborted
        ) {
            task.reject(createProviderAbortError());
            continue;
        }

        const cached = getCachedProviderData(task.cacheKey);
        if (cached !== null) {
            task.resolve(cached);
            continue;
        }

        activeProviderRequestCount++;
        providerInflightTasks.set(task.cacheKey, task);

        const fetchOptions = task.controller
            ? { signal: task.controller.signal }
            : undefined;

        const inflightPromise = fetch(task.url, fetchOptions)
            .then(async res => {
                if (!res.ok) {
                    throw new Error(`Watch providers HTTP ${res.status}`);
                }
                const json = await res.json();
                if (json?.success === false) {
                    throw new Error('Watch providers API error');
                }
                setCachedProviderData(task.cacheKey, json);
                return json;
            })
            .then(
                json => {
                    task.resolve(json);
                    return json;
                },
                err => {
                    task.reject(err);
                    throw err;
                }
            )
            .finally(() => {
                if (providerInflightRequests.get(task.cacheKey) === inflightPromise) {
                    providerInflightRequests.delete(task.cacheKey);
                }
                if (providerInflightTasks.get(task.cacheKey) === task) {
                    providerInflightTasks.delete(task.cacheKey);
                }
                activeProviderRequestCount = Math.max(
                    0,
                    activeProviderRequestCount - 1
                );
                drainProviderQueue();
            });

        task.inflightPromise = inflightPromise;
        inflightPromise.catch(() => {});
        providerInflightRequests.set(task.cacheKey, inflightPromise);
    }
}

function enqueueProviderFetch(cacheKey, url, containers, routeContext) {
    const signal = routeContext?.signal || null;
    if (signal?.aborted) {
        return Promise.reject(createProviderAbortError());
    }

    const isVisible =
        containers && containers.length > 0
            ? Array.from(containers).some(isProviderContainerNearViewport)
            : false;

    const existingInflight = providerInflightRequests.get(cacheKey);
    if (existingInflight) {
        const inflightTask = providerInflightTasks.get(cacheKey) || null;
        if (!inflightTask?.aborted && !inflightTask?.controller?.signal?.aborted) {
            return wrapProviderPromiseForCaller(
                existingInflight,
                signal,
                inflightTask
            );
        }
    }

    let task = providerQueuedTasks.get(cacheKey);
    if (task) {
        if (isVisible) {
            promoteQueuedProviderTask(cacheKey);
        } else if (task.priority === 0) {
            observeProviderContainers(task, containers);
        }
        return wrapProviderPromiseForCaller(task.promise, signal, task);
    }

    let taskResolve;
    let taskReject;
    const taskPromise = new Promise((resolve, reject) => {
        taskResolve = resolve;
        taskReject = reject;
    });
    taskPromise.catch(() => {});

    task = {
        cacheKey,
        url,
        priority: isVisible ? 1 : 0,
        seq: ++providerQueueSequence,
        aborted: false,
        inflightPromise: null,
        observedElements: new Set(),
        callers: new Set(),
        controller:
            typeof AbortController === 'function' ? new AbortController() : null,
        promise: taskPromise,
        resolve: taskResolve,
        reject: taskReject
    };

    if (!isVisible) {
        observeProviderContainers(task, containers);
    }

    const callerPromise = wrapProviderPromiseForCaller(
        task.promise,
        signal,
        task
    );

    providerQueuedTasks.set(cacheKey, task);
    providerRequestQueue.push(task);
    scheduleProviderQueueDrain();

    return callerPromise;
}

async function fetchAndInjectProviders(
    itemId,
    mediaType,
    itemData = null,
    routeContext = null
) {
    const safeItemId =
        normalizeTmdbId(
            itemId
        );

    if (!safeItemId) {
        return;
    }

    let safeMediaType =
        normalizeMediaType(
            mediaType
        );

    if (!safeMediaType) {
        safeMediaType =
            typeof inferItemMediaType === 'function'
                ? inferItemMediaType(itemData, 'movie')
                : (
                    itemData &&
                    (
                        itemData.first_air_date ||
                        (itemData.name && !itemData.title)
                    )
                        ? 'tv'
                        : 'movie'
                );
    }

    const cacheKey =
        `${safeMediaType}:${safeItemId}`;

    const getContainers = () => {
        const typed = document.querySelectorAll(
            `.providers-${safeMediaType}-${safeItemId}`
        );
        if (typed.length > 0) {
            return typed;
        }
        return document.querySelectorAll(
            `.providers-${safeItemId}:not([data-media-type]), .providers-${safeItemId}[data-media-type="${safeMediaType}"]`
        );
    };

    const renderStaticMessage =
        (
            containers,
            text
        ) => {
            containers.forEach(
                container => {
                    const message =
                        document
                            .createElement(
                                'span'
                            );

                    message.className =
                        'no-provider';

                    message.textContent =
                        text;

                    container
                        .replaceChildren(
                            message
                        );
                }
            );
        };

    const renderProviderLogos = (containers, providersList, badgeText = null) => {
        const visibleProviders = providersList.slice(0, 3);
        containers.forEach(container => {
            const fragment = document.createDocumentFragment();
            visibleProviders.forEach(provider => {
                const providerName = String(
                    provider?.provider_name || 'Platform'
                );
                const logoUrl = getSafeTmdbImageUrl(
                    provider?.logo_path,
                    IMAGE_BASE,
                    'assets/placeholder.svg'
                );
                const image = document.createElement('img');
                image.src = logoUrl;
                image.alt = badgeText
                    ? `${providerName} (${badgeText})`
                    : providerName;
                image.title = badgeText
                    ? `${providerName} (${badgeText})`
                    : providerName;
                image.loading = 'lazy';
                image.className = 'provider-logo';
                fragment.appendChild(image);
            });
            if (badgeText) {
                const badge = document.createElement('span');
                badge.className = 'no-provider provider-access-badge';
                badge.style.marginLeft = '6px';
                badge.style.fontSize = '0.72rem';
                badge.textContent = badgeText;
                fragment.appendChild(badge);
            }
            container.replaceChildren(fragment);
        });
    };

    try {
        if (routeContext?.signal?.aborted) {
            return;
        }

        let data = getCachedProviderData(cacheKey);

        if (data === null) {
            const containers = getContainers();
            const requestUrl = `${BASE_URL}/${safeMediaType}/${safeItemId}/watch/providers`;
            data = await enqueueProviderFetch(
                cacheKey,
                requestUrl,
                containers,
                routeContext
            );
        }

        if (
            routeContext &&
            !isRouteContextCurrent(
                routeContext,
                parseRoute().page
            )
        ) {
            return;
        }

        const results =
            data &&
            typeof data.results ===
                'object'
                ? data.results
                : null;

        const tr =
            results &&
            results.TR &&
            typeof results.TR ===
                'object'
                ? results.TR
                : null;

        const els =
            getContainers();

        if (els.length === 0) {
            return;
        }

        const rawFilterProvId =
            document.getElementById(
                'providerFilter'
            )?.value || '0';

        const filterProvId =
            rawFilterProvId === '0'
                ? 0
                : normalizeTmdbId(
                    rawFilterProvId
                );

        if (filterProvId === null) {
            return;
        }

        const flatRate =
            Array.isArray(tr?.flatrate)
                ? tr.flatrate
                : [];
        const freeProviders = [
            ...(Array.isArray(tr?.free) ? tr.free : []),
            ...(Array.isArray(tr?.ads) ? tr.ads : [])
        ];
        const rentBuyProviders = [];
        const seenRentBuy = new Set();
        [
            ...(Array.isArray(tr?.rent) ? tr.rent : []),
            ...(Array.isArray(tr?.buy) ? tr.buy : [])
        ].forEach(p => {
            const pid = normalizeTmdbId(p?.provider_id);
            if (pid && !seenRentBuy.has(pid)) {
                seenRentBuy.add(pid);
                rentBuyProviders.push(p);
            }
        });

        const matchesFilter = list =>
            filterProvId === 0 ||
            list.some(
                provider =>
                    normalizeTmdbId(provider?.provider_id) === filterProvId
            );

        if (flatRate.length > 0 && matchesFilter(flatRate)) {
            renderProviderLogos(els, flatRate, null);
            return;
        }

        if (freeProviders.length > 0 && matchesFilter(freeProviders)) {
            renderProviderLogos(els, freeProviders, 'Ücretsiz');
            return;
        }

        if (rentBuyProviders.length > 0 && matchesFilter(rentBuyProviders)) {
            renderProviderLogos(els, rentBuyProviders, 'Kiralık / Satın Al');
            return;
        }

        renderStaticMessage(
            els,
            filterProvId > 0
                ? 'Seçili platformda yayını yok'
                : "Türkiye'de dijital yayını bulunamadı"
        );
    } catch (err) {
        if (
            err.name ===
            'AbortError'
        ) {
            return;
        }

        console.error(
            'Provider bilgisi alınamadı',
            err
        );

        const els =
            getContainers();

        renderStaticMessage(
            els,
            'Platform bilgisi alınamadı'
        );
    }
}
