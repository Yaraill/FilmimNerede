// =========================================
// API Ayarları
// =========================================






// =========================================
// ROUTER SYSTEM (HASH ROUTING)
// =========================================


document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'auto' });
    }, 10);
});

window.addEventListener('load', () => {
    setTimeout(() => {
        window.scrollTo(0, 0);
    }, 100);
});



document.addEventListener('DOMContentLoaded', () => {
    // V5 Theme check
    const isLightTheme = localStorage.getItem('theme') === 'light';
    syncThemeState(isLightTheme);
    
    // Load default tab
    loadGenres();
    
    // Close autocomplete when clicking outside
    
    // Close advanced search drawer when clicking outside
    document.addEventListener('click', (e) => {
        const drawer = document.getElementById('advanced-search-panel');
        const btn = document.getElementById('advanced-toggle-btn');
        if (drawer && !drawer.classList.contains('closing') && drawer.style.display === 'block' && btn) {
            const modalActive = window.ModalManager && window.ModalManager.hasActiveModal();
            if (!modalActive && !drawer.contains(e.target) && !btn.contains(e.target)) {
                toggleAdvancedSearch();
            }
        }
    });
    
    document.addEventListener('click', (e) => {
        const box = document.getElementById('autocomplete-box');
        const input = document.getElementById('searchInput');
        if (box && input && e.target !== input && e.target !== box && !box.contains(e.target)) {
            box.querySelectorAll('.suggestion-item').forEach(item => {
                item.classList.remove('active');
                item.setAttribute('aria-selected', 'false');
            });
            box.style.display = 'none';
            input.setAttribute('aria-expanded', 'false');
            input.removeAttribute('aria-activedescendant');
        }

        [1, 2].forEach(num => {
            const aBox = document.getElementById(`actor${num}-autocomplete`);
            const aInput = document.getElementById(`actor${num}-input`);
            if (aBox && aInput && e.target !== aInput && e.target !== aBox && !aBox.contains(e.target)) {
                aBox.querySelectorAll('.suggestion-item').forEach(item => {
                    item.classList.remove('active');
                    item.setAttribute('aria-selected', 'false');
                });
                aBox.style.display = 'none';
                aInput.setAttribute('aria-expanded', 'false');
                aInput.removeAttribute('aria-activedescendant');
            }
        });
    });

    // Keyboard shortcuts (Strict Modal-First Precedence)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // 1. If an accessible modal is active, top-most modal takes absolute precedence
            if (window.ModalManager && window.ModalManager.hasActiveModal()) {
                const topModal = window.ModalManager.getTopModal();
                if (topModal) {
                    if (topModal.id === 'trailer-modal') {
                        closeTrailer(null, true);
                    } else if (topModal.id === 'details-modal') {
                        closeDetails(null, true);
                    } else if (topModal.id === 'random-modal') {
                        closeRandom(null, true);
                    } else if (topModal.id === 'actor-modal') {
                        closeActor(null, true);
                    } else {
                        window.ModalManager.closeModal(topModal.element);
                    }
                }
                return;
            }

            // 2. Background UI Escape handling (only when NO modal is active)
            // 2a. Any open custom select
            const openCustomSelect = document.querySelector('.custom-select-container.open');
            if (openCustomSelect) {
                if (typeof closeCustomSelectDropdown === 'function') {
                    closeCustomSelectDropdown(openCustomSelect, true);
                } else {
                    openCustomSelect.classList.remove('open');
                    const trigger = openCustomSelect.querySelector('.custom-select-trigger');
                    if (trigger) {
                        trigger.setAttribute('aria-expanded', 'false');
                        trigger.focus();
                    }
                }
                return;
            }

            // 2b. Any open autocomplete suggestions
            let closedAutocomplete = false;
            const searchBox = document.getElementById('autocomplete-box');
            if (searchBox && searchBox.style.display !== 'none') {
                if (typeof closeSearchAutocomplete === 'function') {
                    closeSearchAutocomplete();
                } else {
                    searchBox.style.display = 'none';
                    const sInput = document.getElementById('searchInput');
                    if (sInput) {
                        sInput.setAttribute('aria-expanded', 'false');
                        sInput.removeAttribute('aria-activedescendant');
                    }
                }
                closedAutocomplete = true;
            }
            [1, 2].forEach(num => {
                const aBox = document.getElementById(`actor${num}-autocomplete`);
                if (aBox && aBox.style.display !== 'none') {
                    aBox.querySelectorAll('.suggestion-item').forEach(item => {
                        item.classList.remove('active');
                        item.setAttribute('aria-selected', 'false');
                    });
                    aBox.style.display = 'none';
                    const aInput = document.getElementById(`actor${num}-input`);
                    if (aInput) {
                        aInput.setAttribute('aria-expanded', 'false');
                        aInput.removeAttribute('aria-activedescendant');
                    }
                    closedAutocomplete = true;
                }
            });
            if (closedAutocomplete) return;

            // 2c. Open mobile menu
            const navLinks = document.getElementById('nav-links') || document.querySelector('.nav-links');
            const mobileToggle = document.getElementById('mobile-menu');
            if (navLinks && navLinks.classList.contains('active')) {
                if (typeof closeMobileMenu === 'function') {
                    closeMobileMenu();
                } else {
                    navLinks.classList.remove('active');
                    if (mobileToggle) {
                        mobileToggle.classList.remove('is-active');
                        mobileToggle.setAttribute('aria-expanded', 'false');
                        mobileToggle.focus();
                    }
                }
                return;
            }

            // 2d. Open advanced search drawer
            const advancedPanel = document.getElementById('advanced-search-panel');
            const advancedBtn = document.getElementById('advanced-toggle-btn');
            if (advancedPanel && advancedPanel.style.display === 'block' && !advancedPanel.classList.contains('closing')) {
                if (typeof toggleAdvancedSearch === 'function') {
                    toggleAdvancedSearch();
                } else {
                    advancedPanel.classList.add('closing');
                    if (advancedBtn) {
                        advancedBtn.setAttribute('aria-expanded', 'false');
                        advancedBtn.classList.remove('active');
                        advancedBtn.focus();
                    }
                    setTimeout(() => {
                        advancedPanel.style.display = 'none';
                        advancedPanel.classList.remove('closing');
                    }, 300);
                }
                return;
            }
        }
    });

    // Parallax scroll effect for navbar
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY;
        const navbar = document.querySelector('.navbar');
        if (navbar) {
            if (scrolled > 50) {
                if (document.body.classList.contains('light-theme')) {
                    navbar.style.background = 'rgba(255, 255, 255, 0.5)';
                    navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.1)';
                } else {
                    navbar.style.background = 'rgba(15, 23, 42, 0.5)';
                    navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.5)';
                }
            } else {
                navbar.style.background = 'rgba(255, 255, 255, 0.05)';
                navbar.style.boxShadow = '0 4px 30px rgba(0, 0, 0, 0.1)';
            }
        }
    });

    // Initialize Router
    window.addEventListener("hashchange", handleRoute);
    window.addEventListener("popstate", handleRoute);
    
    const currentState = history.state || {};
    if (!currentState.filmRehberiRouter) {
        history.replaceState(
            {
                ...currentState,
                filmRehberiRouter: { index: 0 }
            },
            "",
            window.location.href
        );
    }
    
    handleRoute();

    // Infinite Scroll Implementation
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && loadMoreBtn.style.display !== 'none') {
                loadMoreResults();
            }
        }, { rootMargin: '200px' });
        observer.observe(loadMoreBtn);
        // Hide button visually but keep it in DOM for observer
        loadMoreBtn.style.opacity = '0';
        loadMoreBtn.style.pointerEvents = 'none';
        loadMoreBtn.style.height = '10px';
    }

});

async function loadGenres() {
    try {
        const [
            movieRes,
            tvRes
        ] =
            await Promise.all([
                fetch(
                    `${BASE_URL}/genre/movie/list?api_key=${API_KEY}&language=tr-TR`
                ),
                fetch(
                    `${BASE_URL}/genre/tv/list?api_key=${API_KEY}&language=tr-TR`
                )
            ]);

        const movieData =
            await movieRes.json();

        const tvData =
            await tvRes.json();

        const normalizeGenres =
            value => {
                const genres =
                    Array.isArray(value)
                        ? value
                        : [];

                return genres
                    .map(genre => {
                        const genreId =
                            normalizeTmdbId(
                                genre?.id
                            );

                        const genreName =
                            String(
                                genre?.name ||
                                ''
                            ).trim();

                        if (
                            !genreId ||
                            !genreName
                        ) {
                            return null;
                        }

                        return {
                            id: genreId,
                            name:
                                genreName
                        };
                    })
                    .filter(Boolean);
            };

        const movieGenres =
            normalizeGenres(
                movieData
                    ?.genres
            );

        const tvGenres =
            normalizeGenres(
                tvData
                    ?.genres
            );

        window.genresCache = {
            movie:
                movieGenres,
            tv:
                tvGenres
        };

        genreMap = {};

        movieGenres.forEach(
            genre => {
                genreMap[
                    genre.id
                ] =
                    genre.name;
            }
        );

        tvGenres.forEach(
            genre => {
                genreMap[
                    genre.id
                ] =
                    genre.name;
            }
        );

        const discoverGenres =
            document.getElementById(
                'discover-genres'
            );

        if (!discoverGenres) {
            return;
        }

        const uniqueGenres =
            new Map();

        [
            ...movieGenres,
            ...tvGenres
        ].forEach(genre => {
            if (
                !uniqueGenres.has(
                    genre.id
                )
            ) {
                uniqueGenres.set(
                    genre.id,
                    genre
                );
            }
        });

        const sortedGenres =
            Array.from(
                uniqueGenres.values()
            )
                .sort(
                    (a, b) =>
                        a.name.localeCompare(
                            b.name,
                            'tr'
                        )
                );

        const fragment =
            document
                .createDocumentFragment();

        sortedGenres.forEach(
            genre => {
                const label =
                    document
                        .createElement(
                            'label'
                        );

                label.className =
                    'genre-pill-checkbox';

                const input =
                    document
                        .createElement(
                            'input'
                        );

                input.type =
                    'checkbox';

                input.value =
                    String(
                        genre.id
                    );

                input.className =
                    'discover-genre-cb';

                const text =
                    document
                        .createElement(
                            'span'
                        );

                text.className =
                    'genre-pill-text';

                text.textContent =
                    genre.name;

                label.append(
                    input,
                    text
                );

                fragment.appendChild(
                    label
                );
            }
        );

        discoverGenres
            .replaceChildren(
                fragment
            );
    } catch (e) {
        console.error(
            'Türler çekilemedi',
            e
        );
    }
}

function switchTab(event, tabId) {
    if (event) event.preventDefault();
    navigate(tabId);
}

function renderSection(tabId, routeContext = null) {
    const routePage = tabId;
    if (tabId === 'home') tabId = 'now-playing';

    clearAllFilters();
    toggleSelectVisibility('providerFilter', false);
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
    document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));

    const tabEl = document.getElementById(tabId);
    if(tabEl) tabEl.classList.add('active-tab');
    
    const link = document.querySelector(`.nav-links a[onclick*="${tabId}"]`);
    if(link) link.classList.add('active');

    if (tabId === 'now-playing') {
        loadNowPlaying(routeContext, routePage);
        loadTop10Trending(routeContext, routePage);
        loadTrendingActors(routeContext, routePage);
        loadCuratedCollections(routeContext, routePage);
        renderRecentlyViewed(routeContext);
        loadSmartRecommendations(routeContext, routePage);
    } else if (tabId === 'vizyon') {
        loadUpcomingMovies(routeContext);
    } else if (tabId === 'platform') {
        resetPlatformView(routeContext);
    } else if (tabId === 'profile') {
        loadProfile(routeContext);
    }
}


























// =========================================
// AKILLI NER ALGORTMASI (Puanlananlara Gre)
// =========================================



