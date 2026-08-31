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
    let currentPage = "home";
    let currentId = null;

    if (hash.startsWith("movie/")) {
        currentPage = "movie";
        currentId = hash.split("/")[1];
    } else if (hash.startsWith("actor/")) {
        currentPage = "actor";
        currentId = hash.split("/")[1];
    } else if (hash.startsWith("search")) {
        currentPage = "search";
    } else if (hash) {
        currentPage = hash;
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
    currentRouterIndex = currentIndex;

    handleRoute();
}

function parseRoute() {
    const hash = window.location.hash.slice(1);

    if (!hash) {
        return { page: "home" };
    }

    if (hash.startsWith("movie/")) {
        const parts = hash.split("/");
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

    if (hash.startsWith("film/")) {
        const id = hash.split("/")[1];

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
            page: "platform"
        };
    }

    if (hash.startsWith("actor/")) {
        return {
            page: "actor",
            id: hash.split("/")[1]
        };
    }

    if (hash.startsWith("search")) {
        const parts = hash.split("?");
        const queryString = parts[1] || "";
        const params = new URLSearchParams(queryString);

        return {
            page: "search",
            query: params.get("q")
        };
    }

    return {
        page: hash
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
        signal: currentAbortController.signal
    };

    const detailsModal =
        document.getElementById('details-modal');

    const actorModal =
        document.getElementById('actor-modal');

    if (detailsModal) {
        detailsModal.style.display = 'none';
        detailsModal.classList.remove('active');

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

    if (actorModal) {
        actorModal.style.display = 'none';
    }

    document.body.style.overflow = "auto";

    if (window.player) {
        window.player.destroy();
        window.player = null;
    }

    const trailerModal =
        document.getElementById('trailer-modal');

    if (trailerModal) {
        trailerModal.style.display = 'none';
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

                searchMovie(
                    true,
                    false,
                    routeContext
                );
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
