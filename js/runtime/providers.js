const PROVIDER_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PROVIDER_CACHE_MAX_SIZE = 500;
const PROVIDER_MAX_CONCURRENT_REQUESTS = 6;
const PROVIDER_VIEWPORT_MARGIN_PX = 400;
const PROVIDER_PERSIST_STORAGE_KEY = 'filmimnerede_provider_cache_v1';

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
let providerRateLimitUntil = 0;
let providerRateLimitTimer = null;
let deferredProviderObserver = null;
let providerPersistenceHydrated = false;
let providerPersistTimer = null;
const deferredProviderCallbacks =
    typeof WeakMap === 'function' ? new WeakMap() : new Map();

function compactProviderEntriesList(list) {
    if (!Array.isArray(list)) return [];
    const compact = [];
    for (const entry of list) {
        const pid = typeof normalizeTmdbId === 'function'
            ? normalizeTmdbId(entry?.provider_id)
            : (Number(entry?.provider_id) || null);
        if (!pid) continue;
        compact.push({
            provider_id: pid,
            provider_name: String(entry?.provider_name || 'Platform').slice(0, 80),
            logo_path: typeof entry?.logo_path === 'string' ? entry.logo_path : ''
        });
    }
    return compact;
}

function compactTrProviderPayload(data) {
    const tr = data && typeof data.results === 'object' && data.results?.TR && typeof data.results.TR === 'object'
        ? data.results.TR
        : null;
    if (!tr) return {};
    const compactTr = {};
    ['flatrate', 'free', 'ads', 'rent', 'buy'].forEach(bucket => {
        const items = compactProviderEntriesList(tr[bucket]);
        if (items.length > 0) {
            compactTr[bucket] = items;
        }
    });
    return compactTr;
}

function hydratePersistedProviderCache() {
    if (providerPersistenceHydrated) return;
    providerPersistenceHydrated = true;
    try {
        if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return;
        const raw = localStorage.getItem(PROVIDER_PERSIST_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.entries)) return;
        const now = Date.now();
        for (const item of parsed.entries) {
            if (!Array.isArray(item) || item.length < 3) continue;
            const [key, cachedAt, compactTr] = item;
            if (typeof key !== 'string' || !/^(?:movie|tv):\d+$/.test(key)) continue;
            if (typeof cachedAt !== 'number' || now - cachedAt > PROVIDER_CACHE_TTL_MS) continue;
            if (!compactTr || typeof compactTr !== 'object') continue;
            if (providerDataCache.size >= PROVIDER_CACHE_MAX_SIZE) break;
            providerDataCache.set(key, { results: { TR: compactTr } });
            providerDataCacheTimestamps.set(key, cachedAt);
        }
    } catch {
        // Corrupt or unavailable persistent provider cache is safely ignored.
    }
}

function flushPersistedProviderCache() {
    providerPersistTimer = null;
    try {
        if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
        const now = Date.now();
        const entries = [];
        for (const [key, data] of providerDataCache.entries()) {
            const cachedAt = providerDataCacheTimestamps.get(key) || now;
            if (now - cachedAt > PROVIDER_CACHE_TTL_MS) continue;
            entries.push([key, cachedAt, compactTrProviderPayload(data)]);
        }
        const sliceStart = Math.max(0, entries.length - PROVIDER_CACHE_MAX_SIZE);
        const recentEntries = entries.slice(sliceStart);
        try {
            localStorage.setItem(PROVIDER_PERSIST_STORAGE_KEY, JSON.stringify({ v: 1, entries: recentEntries }));
        } catch {
            // Quota exceeded: retry with half the most recent entries.
            const halved = recentEntries.slice(Math.floor(recentEntries.length / 2));
            try {
                localStorage.setItem(PROVIDER_PERSIST_STORAGE_KEY, JSON.stringify({ v: 1, entries: halved }));
            } catch {
                // Storage write failure leaves in-memory cache intact.
            }
        }
    } catch {
        // Ignore unexpected storage failures.
    }
}

function schedulePersistProviderCache() {
    if (providerPersistTimer !== null) return;
    if (typeof setTimeout !== 'function') {
        flushPersistedProviderCache();
        return;
    }
    providerPersistTimer = setTimeout(flushPersistedProviderCache, 350);
}

function parseProviderRetryAfterSeconds(response) {
    const rawHeader = typeof response?.headers?.get === 'function'
        ? response.headers.get('Retry-After')
        : '';
    if (!rawHeader) return 5;
    const numeric = Number(rawHeader);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.min(65, Math.max(1, Math.ceil(numeric)));
    }
    const parsedDate = Date.parse(rawHeader);
    if (Number.isFinite(parsedDate)) {
        const diffSeconds = Math.ceil((parsedDate - Date.now()) / 1000);
        return Math.min(65, Math.max(1, diffSeconds));
    }
    return 5;
}

function scheduleProviderRateLimitResume() {
    if (providerRateLimitTimer !== null) return;
    const delayMs = Math.max(200, providerRateLimitUntil - Date.now());
    providerRateLimitTimer = setTimeout(() => {
        providerRateLimitTimer = null;
        drainProviderQueue();
    }, delayMs);
}

function getDeferredProviderObserver() {
    if (deferredProviderObserver) return deferredProviderObserver;
    if (typeof IntersectionObserver !== 'function') return null;
    deferredProviderObserver = new IntersectionObserver(
        entries => {
            entries.forEach(entry => {
                const el = entry.target;
                if (!el.isConnected) {
                    deferredProviderObserver.unobserve(el);
                    deferredProviderCallbacks.delete(el);
                    return;
                }
                if (entry.isIntersecting) {
                    const callback = deferredProviderCallbacks.get(el);
                    deferredProviderObserver.unobserve(el);
                    deferredProviderCallbacks.delete(el);
                    if (typeof callback === 'function') {
                        callback();
                    }
                }
            });
        },
        { rootMargin: '500px' }
    );
    return deferredProviderObserver;
}

function createProviderAbortError() {
    if (typeof DOMException === 'function') {
        return new DOMException('The operation was aborted.', 'AbortError');
    }
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
}

function getCachedProviderData(cacheKey) {
    hydratePersistedProviderCache();
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
    hydratePersistedProviderCache();
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

    const compacted = { results: { TR: compactTrProviderPayload(data) } };
    providerDataCache.set(cacheKey, compacted);
    providerDataCacheTimestamps.set(cacheKey, Date.now());
    schedulePersistProviderCache();
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

    if (Date.now() < providerRateLimitUntil) {
        if (providerRequestQueue.length > 0) {
            scheduleProviderRateLimitResume();
        }
        return;
    }

    while (
        activeProviderRequestCount < PROVIDER_MAX_CONCURRENT_REQUESTS &&
        providerRequestQueue.length > 0
    ) {
        if (Date.now() < providerRateLimitUntil) {
            scheduleProviderRateLimitResume();
            break;
        }

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

        let requeuedFor429 = false;
        const inflightPromise = fetch(task.url, fetchOptions)
            .then(async res => {
                if (res.status === 429) {
                    const waitSeconds = parseProviderRetryAfterSeconds(res);
                    providerRateLimitUntil = Math.max(
                        providerRateLimitUntil,
                        Date.now() + waitSeconds * 1000
                    );
                    if (
                        !task.aborted &&
                        task.callers.size > 0 &&
                        !task.controller?.signal?.aborted &&
                        (task.retries || 0) < 2
                    ) {
                        task.retries = (task.retries || 0) + 1;
                        requeuedFor429 = true;
                        const retryErr = new Error('Watch providers rate limited (429)');
                        retryErr.isRetry429 = true;
                        throw retryErr;
                    }
                    throw new Error('Watch providers HTTP 429');
                }
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
                    if (requeuedFor429 && err?.isRetry429) {
                        return null;
                    }
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
                if (requeuedFor429 && !task.aborted && task.callers.size > 0 && !task.controller?.signal?.aborted) {
                    providerQueuedTasks.set(task.cacheKey, task);
                    providerRequestQueue.unshift(task);
                    scheduleProviderRateLimitResume();
                    return;
                }
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

function dedupeProvidersList(providersList) {
    const visibleProviders = [];
    const seenProviders = new Set();
    providersList.forEach(provider => {
        const pid = normalizeTmdbId(provider?.provider_id);
        const key = pid ? `id:${pid}` : `name:${String(provider?.provider_name || '')}`;
        if (!seenProviders.has(key)) {
            seenProviders.add(key);
            visibleProviders.push(provider);
        }
    });
    return visibleProviders;
}

function resolveProviderDisplayModel(data) {
    const results =
        data && typeof data.results === 'object'
            ? data.results
            : null;
    const tr =
        results && results.TR && typeof results.TR === 'object'
            ? results.TR
            : null;

    const rawFilterProvId =
        typeof document !== 'undefined'
            ? (document.getElementById('providerFilter')?.value || '0')
            : '0';

    const filterProvId =
        rawFilterProvId === '0'
            ? 0
            : normalizeTmdbId(rawFilterProvId);

    if (filterProvId === null) {
        return null;
    }

    const flatRate = Array.isArray(tr?.flatrate) ? tr.flatrate : [];
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

    const subscribedIds = filterProvId === 0 && typeof isMyPlatformsModeActive === 'function' && isMyPlatformsModeActive()
        ? getSubscribedProviderIds()
        : [];
    const matchesSubscription = provider =>
        subscribedIds.includes(normalizeTmdbId(provider?.provider_id));
    const categories = [
        [flatRate, null],
        [freeProviders, 'Ücretsiz'],
        [rentBuyProviders, 'Kiralık / Satın Al']
    ];
    for (const [providers, badgeText] of categories) {
        if (providers.length === 0) continue;
        if (subscribedIds.length > 0) {
            const subscribed = providers.filter(matchesSubscription);
            if (subscribed.length === 0) continue;
            return {
                type: 'logos',
                providers: dedupeProvidersList([...subscribed, ...providers.filter(p => !matchesSubscription(p))]),
                badgeText
            };
        }
        if (filterProvId > 0 && !providers.some(p => normalizeTmdbId(p?.provider_id) === filterProvId)) {
            continue;
        }
        return {
            type: 'logos',
            providers: dedupeProvidersList(providers),
            badgeText
        };
    }

    return {
        type: 'message',
        text: subscribedIds.length > 0
            ? 'Seçili aboneliklerde yayını yok'
            : filterProvId > 0
                ? 'Seçili platformda yayını yok'
                : "Türkiye'de dijital yayını bulunamadı"
    };
}

function getSyncCachedProvidersHtml(itemId, mediaType) {
    const safeItemId = typeof normalizeTmdbId === 'function' ? normalizeTmdbId(itemId) : (Number(itemId) || null);
    const safeMediaType = typeof normalizeMediaType === 'function'
        ? normalizeMediaType(mediaType)
        : (mediaType === 'tv' ? 'tv' : (mediaType === 'movie' ? 'movie' : null));
    if (!safeItemId || !safeMediaType) return null;

    const data = getCachedProviderData(`${safeMediaType}:${safeItemId}`);
    if (data === null) return null;

    const model = resolveProviderDisplayModel(data);
    if (!model) return null;

    const safeEscHtml = typeof escapeHtml === 'function' ? escapeHtml : value => String(value ?? '');
    const safeEscAttr = typeof escapeAttr === 'function' ? escapeAttr : safeEscHtml;

    if (model.type === 'message') {
        return `<span class="no-provider">${safeEscHtml(model.text)}</span>`;
    }

    const logosHtml = model.providers.map(provider => {
        const providerName = String(provider?.provider_name || 'Platform');
        const label = model.badgeText ? `${providerName} (${model.badgeText})` : providerName;
        const logoUrl = getSafeTmdbImageUrl(provider?.logo_path, IMAGE_BASE, '/assets/placeholder.svg');
        return `<img src="${safeEscAttr(logoUrl)}" alt="${safeEscAttr(label)}" title="${safeEscAttr(label)}" loading="lazy" class="provider-logo">`;
    }).join('');

    const badgeHtml = model.badgeText
        ? `<span class="no-provider provider-access-badge" style="margin-left:6px;font-size:0.72rem">${safeEscHtml(model.badgeText)}</span>`
        : '';

    return `${logosHtml}${badgeHtml}`;
}

async function fetchAndInjectProviders(
    itemId,
    mediaType,
    itemData = null,
    routeContext = null,
    options = null
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
        const visibleProviders = [];
        const seenProviders = new Set();
        providersList.forEach(provider => {
            const pid = normalizeTmdbId(provider?.provider_id);
            const key = pid ? `id:${pid}` : `name:${String(provider?.provider_name || '')}`;
            if (!seenProviders.has(key)) {
                seenProviders.add(key);
                visibleProviders.push(provider);
            }
        });
        containers.forEach(container => {
            const fragment = document.createDocumentFragment();
            visibleProviders.forEach(provider => {
                const providerName = String(
                    provider?.provider_name || 'Platform'
                );
                const logoUrl = getSafeTmdbImageUrl(
                    provider?.logo_path,
                    IMAGE_BASE,
                    '/assets/placeholder.svg'
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
            if (options?.deferUntilVisible === true) {
                if (containers.length === 0) {
                    return;
                }
                const nearViewport = Array.from(containers).some(isProviderContainerNearViewport);
                if (!nearViewport) {
                    const deferredObserver = getDeferredProviderObserver();
                    if (deferredObserver) {
                        containers.forEach(container => {
                            if (!container || container.isConnected === false) return;
                            if (deferredProviderCallbacks.has(container)) return;
                            deferredProviderCallbacks.set(container, () => {
                                if (routeContext?.signal?.aborted) return;
                                fetchAndInjectProviders(safeItemId, safeMediaType, itemData, routeContext, {
                                    deferUntilVisible: false
                                });
                            });
                            deferredObserver.observe(container);
                        });
                        return;
                    }
                }
            }
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

        const els =
            getContainers();

        if (els.length === 0) {
            return;
        }

        const displayModel = resolveProviderDisplayModel(data);
        if (!displayModel) {
            return;
        }

        if (displayModel.type === 'logos') {
            renderProviderLogos(els, displayModel.providers, displayModel.badgeText);
            return;
        }

        renderStaticMessage(els, displayModel.text);
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
