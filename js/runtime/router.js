if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
}

let routeGeneration = 0;
let currentAbortController = null;

function isRouteContextCurrent(routeContext, expectedPage, expectedId = null) {
    if (!routeContext) return false;
    if (routeContext.signal && routeContext.signal.aborted) return false;
    if (routeContext.generation !== routeGeneration) return false;

    const hash = window.location.hash.slice(1);
    const hashPath = hash.split("?")[0];
    let currentPage = "home";
    let currentId = null;

    if (hashPath.startsWith("movie/")) {
        currentPage = "movie";
        currentId = hashPath.split("/")[1];
    } else if (hashPath.startsWith("actor/")) {
        currentPage = "actor";
        currentId = hashPath.split("/")[1];
    } else if (hashPath === "search") {
        currentPage = "search";
    } else if (hashPath) {
        currentPage = hashPath;
    }

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
    const { replace = false } = options;
    const url = '#' + route;

    if (window.location.hash === url) {
        return;
    }

    const currentState = history.state || {};

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

    if (replace) {
        history.replaceState(newState, "", url);
    } else {
        history.pushState(newState, "", url);
    }
    
    window._justNavigated = true;
    window.isHistoryRestoration = false;
    currentRouterIndex = currentIndex;

    handleRoute();
}

function parseRoute() {
    const hash = window.location.hash.slice(1);

    if (!hash) {
        return { page: "home" };
    }

    const querySeparator = hash.indexOf("?");
    const path = querySeparator === -1
        ? hash
        : hash.slice(0, querySeparator);
    const queryString = querySeparator === -1
        ? ""
        : hash.slice(querySeparator + 1);

    if (path.startsWith("movie/")) {
        const parts = path.split("/");
        const id = parts[1];
        const type = parts[2];
        if (type === 'movie' || type === 'tv') {
            return {
                page: "movie",
                id: id,
                mediaType: type
            };
        } else if (type) {
            return { page: "invalid" };
        }
        return {
            page: "movie",
            id: id,
            mediaType: null
        };
    }

    if (path.startsWith("film/")) {
        const id = path.split("/")[1];

        if (isValidRouteId(id)) {
            window.history.replaceState(
                window.history.state,
                "",
                `#movie/${id}`
            );

            return {
                page: "movie",
                id
            };
        }

        window.history.replaceState(
            window.history.state,
            "",
            "#platform"
        );

        return {
            page: "platform",
            platformQuery: ""
        };
    }

    if (path.startsWith("actor/")) {
        return {
            page: "actor",
            id: path.split("/")[1]
        };
    }

    if (path === "search") {
        const params = new URLSearchParams(queryString);

        return {
            page: "search",
            query: params.get("q")
        };
    }

    if (path === "platform") {
        return {
            page: "platform",
            platformQuery: queryString
        };
    }

    return {
        page: path
    };
}

window.isHistoryRestoration = false;
let currentRouterIndex = -1;
let lastRenderedHash = null;

function handleRoute() {
    const newIndex = history.state?.filmRehberiRouter?.index ?? 0;
    if (currentRouterIndex === -1) {
        currentRouterIndex = newIndex;
        window.isHistoryRestoration = false;
    } else if (!window._justNavigated) {
        window.isHistoryRestoration = (newIndex !== currentRouterIndex);
        currentRouterIndex = newIndex;
    }
    window._justNavigated = false;
    const shouldRestoreDetailsFocus = Boolean(window.isNavigatingBack);
    window.isNavigatingBack = false;
    
    const route = parseRoute();

    const currentHash =
        window.location.hash || "#home";

    if (lastRenderedHash === currentHash) {
        return;
    }

    lastRenderedHash = currentHash;

    if (currentAbortController) {
        currentAbortController.abort();
    }

    currentAbortController =
        new AbortController();

    const generation =
        ++routeGeneration;

    const routeContext = {
        generation,
        signal: currentAbortController.signal,
        platformQuery: route.page === 'platform'
            ? (route.platformQuery || '')
            : null
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

    const randomModal =
        document.getElementById('random-modal');

    // Transient overlays must never survive a real route/history change.
    if (trailerModal) {
        if (window.ModalManager && window.ModalManager.isModalOpen(trailerModal)) {
            window.ModalManager.closeModal(trailerModal, { skipFocusRestore: true });
        } else if (trailerModal.classList.contains('active')) {
            trailerModal.classList.remove('active');
            trailerModal.setAttribute('aria-hidden', 'true');
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
            detailsPoster.src = "";
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
                    '',
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

                if (window.isHistoryRestoration && typeof currentSearchQuery !== 'undefined' && currentSearchQuery === queryStr && document.getElementById('search-results')?.children.length > 0) {
                    // DOM is already populated, let history api restore scroll position
                } else {
                    searchMovie(true, false, routeContext);
                }
            } else {
                navigate(
                    'platform',
                    { replace: true }
                );
            }

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
