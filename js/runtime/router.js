if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

const SITE_ORIGIN = 'https://filmimnerede.netlify.app';
const DEFAULT_ROBOTS_CONTENT = 'index, follow, max-image-preview:large, max-snippet:-1';
const NOINDEX_ROBOTS_CONTENT = 'noindex, follow';
const DEFAULT_SEO_DESCRIPTION = "FilmimNerede ile Türkiye'de vizyona girecek filmleri, popüler dizileri takip edin. Hangi platformda yayınlandıklarını öğrenin, fragman izleyin ve kendi izleme listenizi oluşturun.";

let routeGeneration = 0;
let currentAbortController = null;

function shouldHandleLinkClickInSpa(event) {
    if (!event) return true;
    if (event.defaultPrevented) return false;
    if (typeof event.button === 'number' && event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    return true;
}

function splitPathAndQuery(rawUrl) {
    const raw = String(rawUrl || '/');
    const qIdx = raw.indexOf('?');
    if (qIdx === -1) {
        return { pathname: raw || '/', search: '', queryString: '' };
    }
    const pathname = raw.slice(0, qIdx) || '/';
    const queryString = raw.slice(qIdx + 1);
    return {
        pathname,
        search: queryString ? `?${queryString}` : '',
        queryString
    };
}

function normalizePathname(rawPath) {
    const path = String(rawPath || '/').trim();
    if (!path || path === '/') return '/';
    const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
    const trimmed = withLeadingSlash.replace(/\/+$/, '');
    return trimmed || '/';
}

function getCurrentAppUrl() {
    if (typeof window === 'undefined' || !window.location) return '/';
    const pathname = normalizePathname(window.location.pathname || '/');
    const search = window.location.search || '';
    return `${pathname}${search}`;
}

function buildAppUrl(route) {
    const raw = String(route || '').trim();
    if (!raw) return '/';

    const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
    const { pathname: rawPath, queryString } = splitPathAndQuery(withoutHash);
    const cleaned = rawPath.replace(/^\/+|\/+$/g, '');
    const suffix = queryString ? `?${queryString}` : '';

    if (!cleaned || cleaned === 'home' || cleaned === 'now-playing' || cleaned === 'index.html') {
        return '/';
    }
    if (cleaned === 'vizyon' || cleaned === 'upcoming') {
        return '/vizyon';
    }
    if (cleaned === 'platform' || cleaned === 'nerede-izlerim' || cleaned === 'search') {
        return `/nerede-izlerim${suffix}`;
    }
    if (cleaned === 'profile' || cleaned === 'profilim') {
        return '/profilim';
    }
    if (cleaned === 'games' || cleaned === 'oyunlar') {
        return '/oyunlar';
    }
    if (cleaned === 'imax') {
        return '/imax';
    }
    if (cleaned.startsWith('movie/')) {
        const parts = cleaned.split('/');
        const id = parts[1] || '';
        const type = parts[2];
        if (parts.length === 3 && type === 'movie') return `/film/${id}`;
        if (parts.length === 3 && type === 'tv') return `/dizi/${id}`;
        return `/${cleaned}`;
    }
    if (cleaned.startsWith('film/')) {
        const parts = cleaned.split('/');
        return parts.length === 2 ? `/film/${parts[1]}` : `/${cleaned}`;
    }
    if (cleaned.startsWith('dizi/')) {
        const parts = cleaned.split('/');
        return parts.length === 2 ? `/dizi/${parts[1]}` : `/${cleaned}`;
    }
    if (cleaned.startsWith('actor/') || cleaned.startsWith('oyuncu/')) {
        const parts = cleaned.split('/');
        return parts.length === 2 ? `/oyuncu/${parts[1]}` : `/${cleaned}`;
    }
    if (cleaned === 's' || cleaned.startsWith('s/')) {
        return `/${cleaned}`;
    }
    if (cleaned === 'secki' || cleaned.startsWith('secki/')) {
        return `/${cleaned}${suffix}`;
    }
    if (cleaned === 'list') {
        return `/list${suffix}`;
    }
    return `/${cleaned}${suffix}`;
}

function isCurrentAppRoute(route) {
    if (typeof window === 'undefined' || !window.location) return false;
    return !window.location.hash && getCurrentAppUrl() === buildAppUrl(route);
}

function replaceAppUrl(targetUrl) {
    if (typeof window === 'undefined' || !window.location) return;
    const { pathname, search } = splitPathAndQuery(targetUrl);
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
        history.replaceState(history.state, '', targetUrl);
    } else {
        window.location.pathname = pathname;
        window.location.search = search;
        if ('hash' in window.location) {
            window.location.hash = '';
        }
    }
}

function setMetaTagContent(selector, attrName, attrValue, content) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    let el = document.querySelector(selector);
    if (!el && document.head && typeof document.createElement === 'function') {
        el = document.createElement('meta');
        el.setAttribute(attrName, attrValue);
        document.head.appendChild(el);
    }
    if (el) {
        el.setAttribute('content', content);
    }
}

function setCanonicalHref(href) {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    let link = document.querySelector('link[rel="canonical"]');
    if (!link && document.head && typeof document.createElement === 'function') {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
    }
    if (link) {
        link.setAttribute('href', href);
    }
}

function updateRouteSeoMeta({
    title,
    description = DEFAULT_SEO_DESCRIPTION,
    canonical = `${SITE_ORIGIN}/`,
    robots = DEFAULT_ROBOTS_CONTENT
} = {}) {
    if (typeof document === 'undefined') return;
    if (title) {
        document.title = title;
        setMetaTagContent('meta[property="og:title"]', 'property', 'og:title', title);
        setMetaTagContent('meta[name="twitter:title"]', 'name', 'twitter:title', title);
    }
    if (description) {
        setMetaTagContent('meta[name="description"]', 'name', 'description', description);
        setMetaTagContent('meta[property="og:description"]', 'property', 'og:description', description);
        setMetaTagContent('meta[name="twitter:description"]', 'name', 'twitter:description', description);
    }
    if (canonical) {
        setCanonicalHref(canonical);
        setMetaTagContent('meta[property="og:url"]', 'property', 'og:url', canonical);
    }
    if (robots) {
        setMetaTagContent('meta[name="robots"]', 'name', 'robots', robots);
    }
}

function getDefaultRouteSeoMeta(route) {
    const pathname = typeof window !== 'undefined' && window.location
        ? normalizePathname(window.location.pathname || '/')
        : '/';

    switch (route?.page) {
        case 'vizyon':
            return {
                title: 'Yakında Vizyona Girecek Filmler | FilmimNerede',
                description: "Türkiye sinemalarında yakında vizyona girecek filmleri, çıkış tarihlerini ve fragmanlarını keşfedin.",
                canonical: `${SITE_ORIGIN}/vizyon`,
                robots: DEFAULT_ROBOTS_CONTENT
            };
        case 'platform':
            return {
                title: 'Nerede İzlerim? Türkiye Dijital Platform Arama Motoru | FilmimNerede',
                description: "Netflix, Amazon Prime Video, Disney+, Max, MUBI, TOD TV, TV+, tabii, Exxen ve puhutv Türkiye kataloglarında film ve dizi arayın.",
                canonical: `${SITE_ORIGIN}/nerede-izlerim`,
                robots: DEFAULT_ROBOTS_CONTENT
            };
        case 'search': {
            const q = String(route.query || '').trim();
            return {
                title: q ? `"${q}" Arama Sonuçları | FilmimNerede` : 'Nerede İzlerim? | FilmimNerede',
                description: q ? `FilmimNerede üzerinde "${q}" için film, dizi ve dijital yayın platformu arama sonuçları.` : DEFAULT_SEO_DESCRIPTION,
                canonical: `${SITE_ORIGIN}/nerede-izlerim`,
                robots: NOINDEX_ROBOTS_CONTENT
            };
        }
        case 'profile':
            return {
                title: 'Profilim — İzleme Listem ve İstatistiklerim | FilmimNerede',
                description: 'İzleme listeniz, dizi bölüm takibiniz, puanladığınız yapımlar ve kişisel sinema istatistikleriniz.',
                canonical: `${SITE_ORIGIN}/profilim`,
                robots: NOINDEX_ROBOTS_CONTENT
            };
        case 'games':
            return {
                title: 'Sinema Oyunları ve Ortak Oyuncu Aracı | FilmimNerede',
                description: 'Afişten film tahmin oyunu oynayın ve iki oyuncunun birlikte rol aldığı ortak yapımları keşfedin.',
                canonical: `${SITE_ORIGIN}/oyunlar`,
                robots: DEFAULT_ROBOTS_CONTENT
            };
        case 'imax':
            return {
                title: 'Türkiye IMAX Salonları Rehberi (İstanbul, Ankara, İzmir, Bursa, Adana) | FilmimNerede',
                description: "Türkiye'deki aktif IMAX Lazer ve Dijital IMAX sinema salonlarının il, ilçe ve teknoloji bazlı tam rehberi.",
                canonical: `${SITE_ORIGIN}/imax`,
                robots: DEFAULT_ROBOTS_CONTENT
            };
        case 'movie': {
            const mediaSlug = route.mediaType === 'tv' ? 'dizi' : (route.mediaType === 'movie' ? 'film' : 'movie');
            return {
                title: 'Yapım Detayları | FilmimNerede',
                description: "Yapımın Türkiye dijital yayın platformları, IMDb puanı, fragmanı ve oyuncu kadrosu bilgileri.",
                canonical: `${SITE_ORIGIN}/${mediaSlug}/${route.id}`,
                robots: DEFAULT_ROBOTS_CONTENT
            };
        }
        case 'actor':
            return {
                title: 'Oyuncu Filmografisi | FilmimNerede',
                description: 'Oyuncu veya yönetmenin yer aldığı tüm film ve diziler ile Türkiye yayın platformları.',
                canonical: `${SITE_ORIGIN}/oyuncu/${route.id}`,
                robots: DEFAULT_ROBOTS_CONTENT
            };
        case 'list':
            return {
                title: 'Paylaşılan Film & Dizi Seçkisi | FilmimNerede',
                description: 'FilmimNerede üzerinden paylaşılan özel film ve dizi seçkisi.',
                canonical: `${SITE_ORIGIN}${pathname}`,
                robots: NOINDEX_ROBOTS_CONTENT
            };
        case 'invalid':
        case 'not-found':
            return {
                title: 'Sayfa Bulunamadı (404) | FilmimNerede',
                description: 'Aradığınız sayfa FilmimNerede üzerinde bulunamadı.',
                canonical: `${SITE_ORIGIN}/`,
                robots: NOINDEX_ROBOTS_CONTENT
            };
        case 'now-playing':
        case 'home':
        default:
            return {
                title: 'FilmimNerede - Türkiye Film & Dizi Rehberi',
                description: DEFAULT_SEO_DESCRIPTION,
                canonical: `${SITE_ORIGIN}/`,
                robots: DEFAULT_ROBOTS_CONTENT
            };
    }
}

function syncResolvedMediaRoute(id, mediaType) {
    const safeId = typeof normalizeTmdbId === 'function' ? normalizeTmdbId(id) : Number(id);
    const safeType = typeof normalizeMediaType === 'function'
        ? normalizeMediaType(mediaType)
        : (mediaType === 'tv' || mediaType === 'movie' ? mediaType : null);
    if (!safeId || !safeType || typeof window === 'undefined' || !window.location) return;

    const targetUrl = `/${safeType === 'tv' ? 'dizi' : 'film'}/${safeId}`;
    const currentPath = normalizePathname(window.location.pathname || '/');
    if (currentPath === `/movie/${safeId}`) {
        replaceAppUrl(targetUrl);
        lastRenderedRoute = targetUrl;
    }
}

function parseRouteIdentityFromLocation() {
    const route = parseRoute({ readOnly: true });
    let currentPage = route.page || 'home';
    if (currentPage === 'now-playing') currentPage = 'home';
    const currentId = route.id ?? null;
    return { currentPage, currentId };
}

function isRouteContextCurrent(routeContext, expectedPage, expectedId = null) {
    if (!routeContext) return false;
    if (routeContext.signal && routeContext.signal.aborted) return false;
    if (routeContext.generation !== routeGeneration) return false;

    const { currentPage, currentId } = parseRouteIdentityFromLocation();
    if (currentPage !== expectedPage) return false;

    if (
        expectedId !== null &&
        String(currentId) !== String(expectedId)
    ) {
        return false;
    }

    return true;
}

function isValidRouteId(value) {
    if (!/^[1-9]\d*$/.test(value)) return false;
    if (value.length > 15) return false;

    const id = Number(value);
    return Number.isSafeInteger(id);
}

function navigate(route, options = {}) {
    const { replace = false, searchFilterChange = false } = options;
    const url = buildAppUrl(route);

    if (getCurrentAppUrl() === url && !window.location.hash && !searchFilterChange) {
        return;
    }

    const currentState = (typeof history !== 'undefined' && history.state) || {};

    if (!replace) {
        const currentRoute = parseCleanUrl(getCurrentAppUrl(), { readOnly: true });
        const targetRoute = parseCleanUrl(url, { readOnly: true });
        if (currentRoute.page !== 'movie' && targetRoute.page === 'movie') {
            const prevIndex = Number.isInteger(currentState?.filmRehberiRouter?.index)
                ? currentState.filmRehberiRouter.index
                : 0;
            window.detailsModalOriginIndex = prevIndex;
        }
    }

    let currentIndex = currentState.filmRehberiRouter
        ? currentState.filmRehberiRouter.index
        : 0;

    if (!replace) {
        currentIndex++;
    }

    const newState = {
        ...currentState,
        filmRehberiRouter: {
            index: currentIndex
        }
    };

    if (typeof history !== 'undefined') {
        if (replace && typeof history.replaceState === 'function') {
            history.replaceState(newState, "", url);
        } else if (!replace && typeof history.pushState === 'function') {
            history.pushState(newState, "", url);
        }
    }

    window._justNavigated = true;
    window.isHistoryRestoration = false;
    currentRouterIndex = currentIndex;

    handleRoute({ searchFilterChange });
}

function parseRoute({ readOnly = false } = {}) {
    const rawHash = typeof window !== 'undefined' && window.location?.hash
        ? window.location.hash.slice(1)
        : '';

    if (rawHash && rawHash !== 'main-content') {
        const { pathname: hashPathOnly, queryString: hashQuery } = splitPathAndQuery(rawHash);
        const cleanedHashPath = hashPathOnly.replace(/^\/+|\/+$/g, '');

        let targetUrl = buildAppUrl(rawHash);
        if (cleanedHashPath.startsWith('film/')) {
            const id = cleanedHashPath.split('/')[1] || '';
            targetUrl = isValidRouteId(id) ? `/film/${id}` : '/nerede-izlerim';
        } else if (cleanedHashPath.startsWith('movie/')) {
            const parts = cleanedHashPath.split('/');
            const id = parts[1] || '';
            const type = parts[2];
            if (parts.length === 3 && type !== 'movie' && type !== 'tv') {
                targetUrl = `/movie/${id}/${type}`;
            }
        } else if (cleanedHashPath === 'search' && hashQuery && typeof URLSearchParams === 'function') {
            const params = new URLSearchParams(hashQuery);
            if (!params.has('q')) {
                targetUrl = '/nerede-izlerim';
            }
        }

        if (!readOnly) {
            replaceAppUrl(targetUrl);
        } else {
            return parseCleanUrl(targetUrl, { readOnly: true });
        }
    }

    return parseCleanUrl(getCurrentAppUrl(), { readOnly });
}

function parseCleanUrl(appUrl, { readOnly = false } = {}) {
    const { pathname: rawPathname, queryString } = splitPathAndQuery(appUrl);
    const pathname = normalizePathname(rawPathname);
    const path = pathname === '/' ? '' : pathname.slice(1);

    if (!path || path === 'index.html' || path === 'home' || path === 'now-playing') {
        if (!readOnly && path) {
            replaceAppUrl('/');
        }
        return { page: 'home' };
    }

    if (path === 'vizyon' || path === 'upcoming') {
        if (!readOnly && path === 'upcoming') {
            replaceAppUrl('/vizyon');
        }
        return { page: 'vizyon' };
    }

    if (path === 'nerede-izlerim' || path === 'platform' || path === 'search') {
        const params = typeof URLSearchParams === 'function' ? new URLSearchParams(queryString) : null;
        if (!readOnly && (path === 'platform' || path === 'search')) {
            replaceAppUrl(queryString ? `/nerede-izlerim?${queryString}` : '/nerede-izlerim');
        }
        if (params && params.has('q')) {
            return {
                page: 'search',
                query: params.get('q'),
                filterQuery: queryString
            };
        }
        if (path === 'search') {
            return {
                page: 'search',
                query: null,
                filterQuery: queryString
            };
        }
        return {
            page: 'platform',
            platformQuery: queryString
        };
    }

    if (path === 'profilim' || path === 'profile') {
        if (!readOnly && path === 'profile') {
            replaceAppUrl('/profilim');
        }
        return { page: 'profile' };
    }

    if (path === 'oyunlar' || path === 'games') {
        if (!readOnly && path === 'games') {
            replaceAppUrl('/oyunlar');
        }
        return { page: 'games' };
    }

    if (path === 'imax') {
        return { page: 'imax' };
    }

    if (path.startsWith('film/')) {
        const parts = path.split('/');
        if (parts.length !== 2) {
            return { page: 'invalid' };
        }
        return {
            page: 'movie',
            id: parts[1],
            mediaType: 'movie'
        };
    }

    if (path.startsWith('dizi/')) {
        const parts = path.split('/');
        if (parts.length !== 2) {
            return { page: 'invalid' };
        }
        return {
            page: 'movie',
            id: parts[1],
            mediaType: 'tv'
        };
    }

    if (path.startsWith('movie/')) {
        const parts = path.split('/');
        if (parts.length > 3) {
            return { page: 'invalid' };
        }
        const id = parts[1];
        const type = parts[2];
        if (type === 'movie') {
            if (!readOnly && isValidRouteId(id)) replaceAppUrl(`/film/${id}`);
            return { page: 'movie', id, mediaType: 'movie' };
        }
        if (type === 'tv') {
            if (!readOnly && isValidRouteId(id)) replaceAppUrl(`/dizi/${id}`);
            return { page: 'movie', id, mediaType: 'tv' };
        }
        if (type) {
            return { page: 'invalid' };
        }
        return {
            page: 'movie',
            id,
            mediaType: null
        };
    }

    if (path.startsWith('oyuncu/') || path.startsWith('actor/')) {
        const parts = path.split('/');
        if (parts.length !== 2) {
            return { page: 'invalid' };
        }
        const id = parts[1];
        if (!readOnly && path.startsWith('actor/') && isValidRouteId(id)) {
            replaceAppUrl(`/oyuncu/${id}`);
        }
        return {
            page: 'actor',
            id
        };
    }

    if (path === 'list') {
        return { page: 'list', listQuery: queryString, listPath: '' };
    }

    if (path === 's' || path.startsWith('s/')) {
        return {
            page: 'list',
            listQuery: queryString,
            listPath: '',
            shortId: path.slice('s'.length).replace(/^\/+|\/+$/g, '')
        };
    }

    if (path === 'secki' || path.startsWith('secki/')) {
        return {
            page: 'list',
            listQuery: queryString,
            listPath: path.slice('secki'.length).replace(/^\/+/, '')
        };
    }

    return { page: 'not-found' };
}

window.isHistoryRestoration = false;
let currentRouterIndex = -1;
let lastRenderedRoute = null;

function handleRoute({ searchFilterChange = false } = {}) {
    if (window.location.hash === '#main-content') {
        const mainEl = document.getElementById('main-content');
        if (mainEl) {
            mainEl.focus();
        }
        replaceAppUrl(getCurrentAppUrl());
        return;
    }

    const route = parseRoute();
    const currentUrl = getCurrentAppUrl();

    if (route.page !== 'movie') {
        window.detailsModalOriginIndex = null;
        window.isRandomMode = false;
        window.randomModeSource = 'discover';
    }

    if (lastRenderedRoute === currentUrl && !searchFilterChange) {
        return;
    }

    const newIndex =
        (typeof history !== 'undefined' && history.state?.filmRehberiRouter?.index) ?? 0;

    if (currentRouterIndex === -1) {
        currentRouterIndex = newIndex;
        window.isHistoryRestoration = false;
    } else if (!window._justNavigated) {
        window.isHistoryRestoration =
            (newIndex !== currentRouterIndex);

        currentRouterIndex = newIndex;
    }

    window._justNavigated = false;

    const shouldRestoreDetailsFocus =
        Boolean(window.isNavigatingBack);

    window.isNavigatingBack = false;

    lastRenderedRoute = currentUrl;

    if (currentAbortController) {
        currentAbortController.abort();
    }

    if (typeof AbortController === 'function') {
        currentAbortController = new AbortController();
    }

    const generation =
        ++routeGeneration;

    const routeContext = {
        generation,
        signal: currentAbortController?.signal,
        platformQuery: route.page === 'platform'
            ? (route.platformQuery || '')
            : null,
        listQuery: route.page === 'list' ? (route.listQuery || '') : null,
        listPath: route.page === 'list' ? (route.listPath || '') : null,
        shortId: route.page === 'list' ? (route.shortId || '') : null,
        returningFromDetails:
            shouldRestoreDetailsFocus
    };

    if (route.page !== 'movie' && route.page !== 'actor') {
        window.lastNonMovieRoute = route.page;
    }

    const detailsModal =
        document.getElementById('details-modal');

    const actorModal =
        document.getElementById('actor-modal');

    const trailerModal =
        document.getElementById('trailer-modal');

    const preserveTrailerPip =
        Boolean(
            trailerModal &&
            trailerModal.classList.contains(
                'active'
            ) &&
            trailerModal.classList.contains(
                'pip-mode'
            )
        );

    const randomModal =
        document.getElementById('random-modal');

    // Transient overlays must never survive a real route/history change.
    if (
        trailerModal &&
        !preserveTrailerPip
    ) {
        if (
            window.ModalManager &&
            window.ModalManager.isModalOpen(
                trailerModal
            )
        ) {
            window.ModalManager.closeModal(
                trailerModal,
                {
                    skipFocusRestore: true
                }
            );
        } else if (
            trailerModal.classList.contains(
                'active'
            )
        ) {
            trailerModal.classList.remove(
                'active'
            );
            trailerModal.setAttribute(
                'aria-hidden',
                'true'
            );
            trailerModal.inert = true;
        }
    }

    if (randomModal) {
        if (window.ModalManager && window.ModalManager.isModalOpen(randomModal)) {
            window.ModalManager.closeModal(randomModal, { skipFocusRestore: true });
        } else if (randomModal.classList.contains('active')) {
            randomModal.classList.remove('active');
            randomModal.setAttribute('aria-hidden', 'true');
            randomModal.inert = true;
        }
    }

    const shareListModal = document.getElementById('share-list-modal');
    if (shareListModal) {
        if (shareListModal.classList.contains('active') && typeof cancelShareListSearch === 'function') {
            cancelShareListSearch();
        }
        if (window.ModalManager && window.ModalManager.isModalOpen(shareListModal)) {
            window.ModalManager.closeModal(shareListModal, { skipFocusRestore: true });
        } else if (shareListModal.classList.contains('active')) {
            shareListModal.classList.remove('active');
            shareListModal.setAttribute('aria-hidden', 'true');
            shareListModal.inert = true;
        }
    }

    if (detailsModal && route.page !== 'movie') {
        if (window.ModalManager && window.ModalManager.isModalOpen(detailsModal)) {
            window.ModalManager.closeModal(detailsModal, {
                skipFocusRestore: !shouldRestoreDetailsFocus
            });
        } else {
            detailsModal.style.display = 'none';
            detailsModal.classList.remove('active');
            detailsModal.setAttribute('aria-hidden', 'true');
        }

        const dt = document.getElementById('details-title');
        if (dt) dt.innerText = "";

        const p =
            document.getElementById('modal-providers');

        if (p) {
            p.innerHTML = "";
        }

        const trailerContainer =
            document.getElementById(
                'details-trailer-container'
            );

        if (trailerContainer) {
            trailerContainer.innerHTML = "";
        }

        const detailsPoster =
            document.getElementById('details-poster');

        if (detailsPoster) {
            detailsPoster.removeAttribute('src');
        }

        const detailsCast =
            document.getElementById('details-cast');

        if (detailsCast) {
            detailsCast.innerHTML = "";
        }

        const vContainer =
            document.getElementById(
                'video-bg-container'
            );

        if (vContainer) {
            vContainer.innerHTML = "";
        }

        document.documentElement.style.removeProperty(
            '--primary-color'
        );

        document.documentElement.style.removeProperty(
            '--accent-color'
        );
    }

    if (actorModal && route.page !== 'actor') {
        if (window.ModalManager && window.ModalManager.isModalOpen(actorModal)) {
            window.ModalManager.closeModal(actorModal, { skipFocusRestore: true });
        } else {
            actorModal.style.display = 'none';
            actorModal.classList.remove('active');
            actorModal.setAttribute('aria-hidden', 'true');
        }
    }

    if (window.player) {
        window.player.destroy();
        window.player = null;
    }

    if (!window.ModalManager || !window.ModalManager.hasActiveModal()) {
        document.body.style.overflow = "auto";
    }

    if (
        preserveTrailerPip &&
        route.page !== 'movie' &&
        route.page !== 'actor'
    ) {
        [
            document.getElementById(
                'main-content'
            ),
            document.querySelector(
                '.navbar'
            ),
            document.querySelector(
                '.site-footer'
            ),
            document.getElementById(
                'advanced-search-panel'
            )
        ].forEach(element => {
            if (element) {
                element.inert = false;
            }
        });

        document.body.style.overflow =
            'auto';
    }

    updateRouteSeoMeta(getDefaultRouteSeoMeta(route));

    switch (route.page) {
        case "movie":
            if (!isValidRouteId(route.id)) {
                navigate(
                    'platform',
                    { replace: true }
                );
                break;
            }

            renderMovie(
                route.id,
                routeContext,
                route.mediaType
            );
            break;

        case "actor":
            if (!isValidRouteId(route.id)) {
                navigate(
                    'home',
                    { replace: true }
                );
                break;
            }

            renderActor(
                route.id,
                "",
                true,
                "cast",
                0,
                false,
                routeContext
            );
            break;

        case "search":
            if (route.query) {
                const queryStr =
                    route.query.trim();

                if (!queryStr) {
                    navigate(
                        'platform',
                        { replace: true }
                    );
                    break;
                }

                document
                    .querySelectorAll(
                        '.tab-content'
                    )
                    .forEach(tab =>
                        tab.classList.remove(
                            'active-tab'
                        )
                    );

                document
                    .querySelectorAll(
                        '.nav-links a'
                    )
                    .forEach(link =>
                        link.classList.remove(
                            'active'
                        )
                    );

                const tabEl =
                    document.getElementById(
                        'platform'
                    );

                if (tabEl) {
                    tabEl.classList.add(
                        'active-tab'
                    );
                }

                const navLink =
                    document.querySelector(
                        '.nav-links a[onclick*="platform"]'
                    );

                if (navLink) {
                    navLink.classList.add(
                        'active'
                    );
                }

                const searchInput =
                    document.getElementById(
                        'searchInput'
                    );

                if (searchInput) {
                    searchInput.value =
                        queryStr;
                }

                const filterParams = new URLSearchParams(route.filterQuery);
                if (Object.keys(PLATFORM_FILTER_DEFAULTS).some(key => filterParams.has(key))) {
                    const state = sanitizePlatformFilterState(route.filterQuery);
                    restorePlatformFilterState(state);
                    saveSearchFilterStateToSession(queryStr, state);
                } else if (!searchFilterChange && !restoreSearchFilterStateFromSession(queryStr)) {
                    restorePlatformFilterState(sanitizePlatformFilterState(''));
                }
                syncMyPlatformsUi();

                if (
                    window.isHistoryRestoration &&
                    currentMode === 'search' &&
                    renderedSearchRoute === buildSearchRoute(queryStr) &&
                    document.getElementById('search-results')?.children.length > 0
                ) {
                    break;
                }

                searchMovie(true, searchFilterChange, routeContext);
            } else {
                navigate(
                    'platform',
                    { replace: true }
                );
            }

            break;

        case "list":
            renderSection("list", routeContext);
            break;

        case "invalid":
        case "not-found":
            renderSection("not-found", routeContext);
            break;

        case "vizyon":
        case "now-playing":
        case "platform":
        case "profile":
        case "games":
        case "imax":
            renderSection(
                route.page,
                routeContext
            );
            break;

        case "home":
        default:
            renderSection(
                "home",
                routeContext
            );
            break;
    }
}
