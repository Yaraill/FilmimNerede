const PLATFORM_FILTER_DEFAULTS = Object.freeze({
    media: 'all',
    genres: [],
    year: '',
    rating: '0',
    runtime: '',
    sort: 'popularity.desc',
    provider: '0'
});

const PLATFORM_MIN_YEAR = 1920;
const PLATFORM_MAX_YEAR = 2030;

function parseYearFilterValue(rawValue) {
    if (typeof rawValue !== 'string') return null;
    const trimmed = rawValue.trim();
    if (!trimmed) return null;

    const rangeMatch = trimmed.match(/^(\d{4})-(\d{4})$/);
    if (rangeMatch) {
        let startYear = Number.parseInt(rangeMatch[1], 10);
        let endYear = Number.parseInt(rangeMatch[2], 10);
        if (
            startYear < PLATFORM_MIN_YEAR ||
            startYear > PLATFORM_MAX_YEAR ||
            endYear < PLATFORM_MIN_YEAR ||
            endYear > PLATFORM_MAX_YEAR
        ) {
            return null;
        }
        if (startYear === endYear) {
            const singleStr = String(startYear);
            return {
                value: singleStr,
                mode: 'single',
                year: startYear,
                startYear,
                endYear: startYear,
                label: singleStr
            };
        }
        if (startYear > endYear) {
            const temp = startYear;
            startYear = endYear;
            endYear = temp;
        }
        return {
            value: `${startYear}-${endYear}`,
            mode: 'range',
            startYear,
            endYear,
            label: `${startYear} - ${endYear}`
        };
    }

    if (/^\d{4}$/.test(trimmed)) {
        const yearNum = Number.parseInt(trimmed, 10);
        if (yearNum < PLATFORM_MIN_YEAR || yearNum > PLATFORM_MAX_YEAR) {
            return null;
        }
        return {
            value: trimmed,
            mode: 'single',
            year: yearNum,
            startYear: yearNum,
            endYear: yearNum,
            label: trimmed
        };
    }

    return null;
}

function normalizeYearFilterValue(rawValue) {
    const parsed = parseYearFilterValue(rawValue);
    return parsed ? parsed.value : PLATFORM_FILTER_DEFAULTS.year;
}

function applyCustomYearFilter(rawFrom, rawTo) {
    const errorEl = document.getElementById('yearFilterError');
    const showYearError = message => {
        if (!errorEl) return;
        errorEl.textContent = message;
        errorEl.hidden = false;
    };

    const fromStr = String(rawFrom ?? '').trim();
    const toStr = String(rawTo ?? '').trim();

    if (!fromStr && !toStr) {
        syncPlatformSelect('yearFilter', '');
        applyPlatformFilters();
        return true;
    }

    if ((fromStr && !/^\d{4}$/.test(fromStr)) || (toStr && !/^\d{4}$/.test(toStr))) {
        showYearError(`${PLATFORM_MIN_YEAR} - ${PLATFORM_MAX_YEAR} arası 4 haneli yıl girin.`);
        return false;
    }

    const fromNum = fromStr ? Number.parseInt(fromStr, 10) : null;
    const toNum = toStr ? Number.parseInt(toStr, 10) : null;
    if (
        (fromNum !== null && (fromNum < PLATFORM_MIN_YEAR || fromNum > PLATFORM_MAX_YEAR)) ||
        (toNum !== null && (toNum < PLATFORM_MIN_YEAR || toNum > PLATFORM_MAX_YEAR))
    ) {
        showYearError(`Yıl ${PLATFORM_MIN_YEAR} ile ${PLATFORM_MAX_YEAR} arasında olmalı.`);
        return false;
    }

    let nextValue = '';
    if (fromNum !== null && toNum !== null) {
        const start = Math.min(fromNum, toNum);
        const end = Math.max(fromNum, toNum);
        nextValue = start === end ? String(start) : `${start}-${end}`;
    } else {
        nextValue = String(fromNum ?? toNum);
    }

    syncPlatformSelect('yearFilter', nextValue);
    applyPlatformFilters();
    return true;
}

function applyCustomYearFilterFromInputs() {
    const fromVal = document.getElementById('yearFromInput')?.value || '';
    const toVal = document.getElementById('yearToInput')?.value || '';
    return applyCustomYearFilter(fromVal, toVal);
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        ['yearFromInput', 'yearToInput'].forEach(inputId => {
            const input = document.getElementById(inputId);
            if (!input) return;
            input.addEventListener('input', () => {
                const err = document.getElementById('yearFilterError');
                if (err) {
                    err.hidden = true;
                    err.textContent = '';
                }
            });
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCustomYearFilterFromInputs();
                }
            });
        });
        renderActiveFilterChips();
    });
}

const TR_SUBSCRIPTION_PROVIDERS = Object.freeze({
    8: 'Netflix',
    119: 'Amazon Prime',
    337: 'Disney+',
    1899: 'HBO Max',
    11: 'MUBI',
    1826: 'TOD TV',
    1904: 'TV+',
    2235: 'tabii',
    1791: 'Exxen',
    342: 'puhutv'
});

function getSubscribedProviderIds() {
    const storedIds = safeReadStorage('userSubscribedProviders', []);
    return [...new Set(storedIds.map(normalizeTmdbId).filter(id =>
        Object.hasOwn(TR_SUBSCRIPTION_PROVIDERS, id)
    ))];
}

function isMyPlatformsFilterEnabled() {
    return safeReadStorage('myPlatformsFilterActive', false) === true;
}

function isMyPlatformsModeActive() {
    return currentProvider === 0 &&
        document.getElementById('platform')?.classList.contains('active-tab') &&
        isMyPlatformsFilterEnabled() &&
        getSubscribedProviderIds().length > 0;
}

function syncMyPlatformsUi() {
    const subscribedIds = getSubscribedProviderIds();
    document.getElementById('my-platforms-count-badge').textContent = subscribedIds.length;
    document.getElementById('my-platforms-toggle-btn')
        .setAttribute('aria-pressed', String(Boolean(isMyPlatformsModeActive())));

    document.querySelectorAll('.my-platform-chip').forEach(chip => {
        const pid = Number(chip.dataset.providerId);
        const subscribed = subscribedIds.includes(pid);
        chip.setAttribute('aria-pressed', String(subscribed));
        document.getElementById(`btn-prov-${pid}`)
            ?.classList.toggle('my-platform-subscribed', subscribed);
    });

    renderActiveFilterChips();
}

function toggleMyPlatformsPicker(forceOpen) {
    const picker = document.getElementById('my-platforms-picker');
    if (!picker) return;
    const isOpen = typeof forceOpen === 'boolean' ? forceOpen : picker.hidden;
    picker.hidden = !isOpen;
    document.getElementById('my-platforms-edit-btn')
        ?.setAttribute('aria-expanded', String(isOpen));
}

function refreshMyPlatformsResults() {
    const activeRouteContext = {
        generation: routeGeneration,
        signal: currentAbortController?.signal
    };
    const route = parseRoute();
    if (route.page === 'actor') {
        renderActor(currentActorId, document.getElementById('searchInput').value, true, currentJobType, 0, true, activeRouteContext);
    } else if (route.page === 'search') {
        const state = getPlatformFilterStateFromUi();
        const searchRoute = buildSearchRoute(route.query, state);
        saveSearchFilterStateToSession(route.query, state);
        if (location.hash !== `#${searchRoute}`) {
            navigate(searchRoute, { replace: true, searchFilterChange: true });
        } else {
            document.getElementById('searchInput').value = route.query;
            searchMovie(true, true, activeRouteContext);
        }
    } else if (route.page === 'platform') {
        const platformRoute = buildPlatformRoute();
        if (location.hash !== `#${platformRoute}`) {
            navigate(platformRoute);
        } else {
            loadPlatformMovies(0, true, true, activeRouteContext);
        }
    }
}

function toggleSubscribedProvider(pid) {
    const providerId = normalizeTmdbId(pid);
    if (!Object.hasOwn(TR_SUBSCRIPTION_PROVIDERS, providerId)) return;

    const wasActive = isMyPlatformsModeActive();
    const subscribedIds = new Set(getSubscribedProviderIds());
    if (subscribedIds.has(providerId)) {
        subscribedIds.delete(providerId);
    } else {
        subscribedIds.add(providerId);
    }

    if (!safeWriteStorage('userSubscribedProviders', [...subscribedIds])) return;
    if (subscribedIds.size === 0) safeWriteStorage('myPlatformsFilterActive', false);
    syncMyPlatformsUi();
    if (wasActive) refreshMyPlatformsResults();
}

function toggleMyPlatformsFilter() {
    if (getSubscribedProviderIds().length === 0) {
        toggleMyPlatformsPicker(true);
        announceA11y('Önce en az bir abonelik seçin.');
        return;
    }

    const enabled = !isMyPlatformsModeActive();
    if (!safeWriteStorage('myPlatformsFilterActive', enabled)) return;
    if (enabled && currentProvider > 0) syncSingleProviderFilter(0);
    syncMyPlatformsUi();
    refreshMyPlatformsResults();
}

function getPlatformSelectValues(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return new Set();
    return new Set(
        Array.from(select.options)
            .filter(option => !option.disabled)
            .map(option => option.value)
    );
}

function getPlatformGenreValues() {
    return Array.from(
        document.querySelectorAll('.genre-pill-btn[onclick^="setGenre"]')
    )
        .map(button => {
            const match = button
                .getAttribute('onclick')
                ?.match(/^setGenre\('([^']*)'/);
            return match ? match[1] : null;
        })
        .filter(value => value !== null && value !== '');
}

function sanitizePlatformFilterState(queryString = '') {
    const params = new URLSearchParams(queryString);
    const allowedMedia = getPlatformSelectValues('mediaTypeFilter');
    const allowedRatings = getPlatformSelectValues('ratingFilter');
    const allowedRuntimes = getPlatformSelectValues('runtimeFilter');
    const allowedSorts = getPlatformSelectValues('sortByFilter');
    const allowedProviders = getPlatformSelectValues('providerFilter');
    const genreOrder = getPlatformGenreValues();
    const requestedGenres = new Set(
        (params.get('genres') || '')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
    );

    const sanitizedGenres =
        genreOrder.filter(
            value =>
                requestedGenres.has(value)
        );

    requestedGenres.forEach(value => {
        if (
            /^[1-9]\d{0,5}$/.test(value) &&
            !sanitizedGenres.includes(value)
        ) {
            sanitizedGenres.push(value);
        }
    });

    const readAllowed = (key, allowed, fallback) => {
        const value = params.get(key);
        return value !== null && allowed.has(value)
            ? value
            : fallback;
    };

    return {
        media: readAllowed('media', allowedMedia, PLATFORM_FILTER_DEFAULTS.media),
        genres: sanitizedGenres,
        year: normalizeYearFilterValue(params.get('year') ?? ''),
        rating: readAllowed('rating', allowedRatings, PLATFORM_FILTER_DEFAULTS.rating),
        runtime: readAllowed('runtime', allowedRuntimes, PLATFORM_FILTER_DEFAULTS.runtime),
        sort: readAllowed('sort', allowedSorts, PLATFORM_FILTER_DEFAULTS.sort),
        provider: readAllowed('provider', allowedProviders, PLATFORM_FILTER_DEFAULTS.provider)
    };
}

function getPlatformFilterStateFromUi() {
    const params = new URLSearchParams();
    const media = document.getElementById('mediaTypeFilter')?.value || 'all';
    const genres = document.getElementById('genreFilter')?.value || '';
    const year = document.getElementById('yearFilter')?.value || '';
    const rating = document.getElementById('ratingFilter')?.value || '0';
    const runtime = document.getElementById('runtimeFilter')?.value || '';
    const sort = document.getElementById('sortByFilter')?.value || 'popularity.desc';

    params.set('media', media);
    params.set('genres', genres);
    params.set('year', year);
    params.set('rating', rating);
    params.set('runtime', runtime);
    params.set('sort', sort);
    params.set('provider', String(currentProvider || 0));

    return sanitizePlatformFilterState(params.toString());
}

function getActivePlatformFilterEntries() {
    const { media, genres, year, rating, runtime, sort, provider } = getPlatformFilterStateFromUi();
    const entries = [];
    const selectedOptionLabel = id => document.getElementById(id)?.selectedOptions?.[0]?.text || '';

    if (media !== PLATFORM_FILTER_DEFAULTS.media) {
        entries.push({
            label: selectedOptionLabel('mediaTypeFilter'),
            clear: () => syncPlatformMediaType(PLATFORM_FILTER_DEFAULTS.media)
        });
    }

    if (genres.length > 0) {
        const genrePills = Array.from(
            document.querySelectorAll('.genre-pill-btn[onclick^="setGenre"]'),
            button => ({
                value: button.getAttribute('onclick').match(/^setGenre\('([^']*)'/)?.[1],
                label: button.textContent.trim()
            })
        );

        genres.forEach(genre => {
            const pill = genrePills.find(({ value }) => value === genre);
            const group = genrePills.find(({ value }) => value?.split('|').includes(genre));
            entries.push({
                label: pill?.label || genreMap[genre] || group?.label || 'Tür ' + genre,
                clear: () => syncPlatformGenres(
                    getPlatformFilterStateFromUi().genres.filter(value => value !== genre)
                )
            });
        });
    }

    const yearLabel = parseYearFilterValue(year)?.label;
    if (yearLabel) {
        entries.push({ label: yearLabel, clear: () => syncPlatformSelect('yearFilter', '') });
    }

    if (rating !== PLATFORM_FILTER_DEFAULTS.rating) {
        entries.push({
            label: `IMDb ${rating}.0+`,
            clear: () => syncPlatformSelect('ratingFilter', PLATFORM_FILTER_DEFAULTS.rating)
        });
    }

    if (runtime !== PLATFORM_FILTER_DEFAULTS.runtime) {
        entries.push({
            label: selectedOptionLabel('runtimeFilter'),
            clear: () => syncPlatformSelect('runtimeFilter', PLATFORM_FILTER_DEFAULTS.runtime)
        });
    }

    if (sort !== PLATFORM_FILTER_DEFAULTS.sort) {
        entries.push({
            label: selectedOptionLabel('sortByFilter'),
            clear: () => syncPlatformSelect('sortByFilter', PLATFORM_FILTER_DEFAULTS.sort)
        });
    }

    if (provider !== PLATFORM_FILTER_DEFAULTS.provider) {
        entries.push({
            label: TR_SUBSCRIPTION_PROVIDERS[provider],
            clear: () => syncSingleProviderFilter(0)
        });
    } else if (isMyPlatformsFilterEnabled() && getSubscribedProviderIds().length > 0) {
        entries.push({
            label: 'Sadece Aboneliklerim',
            clear: () => {
                if (!safeWriteStorage('myPlatformsFilterActive', false)) return false;
                syncMyPlatformsUi();
                return true;
            }
        });
    }

    return entries;
}

function renderActiveFilterChips() {
    const container = document.getElementById('active-filter-chips');
    if (!container) return;

    const entries = getActivePlatformFilterEntries();
    const drawerClearButton = document.getElementById('drawer-clear-filters-btn');
    const focused = document.activeElement;
    const focusedIndex = Array.from(container.querySelectorAll('button')).indexOf(focused);
    const fragment = document.createDocumentFragment();

    entries.forEach(({ label, clear }) => {
        const chip = document.createElement('span');
        chip.className = 'active-filter-chip';

        const text = document.createElement('span');
        text.textContent = label;

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'active-filter-chip-remove';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', `${label} filtresini kaldır`);
        removeButton.addEventListener('click', () => {
            if (clear() === false) return;
            renderActiveFilterChips();
            refreshPlatformFilterResults();
        });

        chip.append(text, removeButton);
        fragment.append(chip);
    });

    if (entries.length > 0) {
        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.className = 'clear-all-filters-btn';
        clearButton.textContent = 'Filtreleri Temizle';
        clearButton.addEventListener('click', resetAllPlatformFilters);
        fragment.append(clearButton);
    }

    container.replaceChildren(fragment);
    container.hidden = entries.length === 0;
    if (drawerClearButton) drawerClearButton.hidden = container.hidden;

    if (focusedIndex >= 0) {
        const buttons = container.querySelectorAll('button');
        const next = buttons[Math.min(focusedIndex, buttons.length - 1)] ||
            document.getElementById('advanced-toggle-btn');
        next?.focus({ preventScroll: true });
    } else if (container.hidden && drawerClearButton && focused === drawerClearButton) {
        document.querySelector('#advanced-search-panel > .close-btn')?.focus();
    }
}

function buildPlatformFilterParams(state) {
    const params = new URLSearchParams();

    if (state.media !== PLATFORM_FILTER_DEFAULTS.media) {
        params.set('media', state.media);
    }
    if (state.genres.length > 0) {
        params.set('genres', state.genres.join(','));
    }
    if (state.year !== PLATFORM_FILTER_DEFAULTS.year) {
        params.set('year', state.year);
    }
    if (state.rating !== PLATFORM_FILTER_DEFAULTS.rating) {
        params.set('rating', state.rating);
    }
    if (state.runtime !== PLATFORM_FILTER_DEFAULTS.runtime) {
        params.set('runtime', state.runtime);
    }
    if (state.sort !== PLATFORM_FILTER_DEFAULTS.sort) {
        params.set('sort', state.sort);
    }
    if (state.provider !== PLATFORM_FILTER_DEFAULTS.provider) {
        params.set('provider', state.provider);
    }

    return params;
}

function buildPlatformRoute(state = getPlatformFilterStateFromUi()) {
    const queryString = buildPlatformFilterParams(state).toString();
    return queryString ? `platform?${queryString}` : 'platform';
}

function buildSearchRoute(query, state = getPlatformFilterStateFromUi()) {
    const filters = buildPlatformFilterParams(state).toString();
    const route = `search?q=${encodeURIComponent(query)}`;
    return filters ? `${route}&${filters}` : route;
}

function syncPlatformSelect(selectId, value) {
    const select =
        document.getElementById(
            selectId
        );

    if (!select) {
        return;
    }

    if (selectId === 'yearFilter') {
        const resolvedYear = normalizeYearFilterValue(String(value ?? ''));
        select.value = resolvedYear;
        const fromInput = document.getElementById('yearFromInput');
        const toInput = document.getElementById('yearToInput');
        const clearBtn = document.getElementById('yearRangeClearBtn');
        const yearErr = document.getElementById('yearFilterError');
        if (yearErr) {
            yearErr.hidden = true;
            yearErr.textContent = '';
        }
        const parsedSynced = parseYearFilterValue(resolvedYear);
        if (fromInput && toInput) {
            if (parsedSynced?.mode === 'single') {
                fromInput.value = String(parsedSynced.year);
                toInput.value = '';
            } else if (parsedSynced?.mode === 'range') {
                fromInput.value = String(parsedSynced.startYear);
                toInput.value = String(parsedSynced.endYear);
            } else {
                fromInput.value = '';
                toInput.value = '';
            }
        }
        if (clearBtn) {
            clearBtn.hidden = !parsedSynced;
        }
        return;
    }

    select.value = value;

    const selectedOption =
        select.options[
            select.selectedIndex
        ];

    const wrapper =
        select.nextElementSibling;

    if (
        !wrapper ||
        !wrapper.classList.contains(
            'custom-select-container'
        )
    ) {
        return;
    }

    const trigger =
        wrapper.querySelector(
            '.custom-select-trigger'
        );

    const valueElement =
        wrapper.querySelector(
            '.custom-select-value'
        );

    if (
        valueElement &&
        selectedOption
    ) {
        valueElement.textContent =
            selectedOption.text;
    }

    if (
        trigger &&
        selectedOption
    ) {
        const selectLabel =
            select.getAttribute(
                'aria-label'
            ) ||
            select.title ||
            'Filtre';

        trigger.setAttribute(
            'aria-label',
            `${selectLabel}: ${selectedOption.text}`
        );
    }

    wrapper
        .querySelectorAll(
            '.custom-option'
        )
        .forEach(option => {
            const isSelected =
                option.dataset.value ===
                String(value);

            option.classList.toggle(
                'selected',
                isSelected
            );

            option.setAttribute(
                'aria-selected',
                isSelected
                    ? 'true'
                    : 'false'
            );
        });
}

function syncPlatformMediaType(media) {
    syncPlatformSelect('mediaTypeFilter', media);
    document
        .querySelectorAll('.segment-btn[onclick^="setMediaType"]')
        .forEach(button => {
            const match = button
                .getAttribute('onclick')
                ?.match(/^setMediaType\('([^']*)'/);
            button.classList.toggle(
                'active',
                Boolean(match && match[1] === media)
            );
        });
}

function syncPlatformGenres(genres) {
    const selectedGenreSet = new Set(genres);
    selectedGenres = [...genres];
    const genreFilter = document.getElementById('genreFilter');
    if (genreFilter) {
        genreFilter.value = selectedGenres.join(',');
    }

    document.querySelectorAll('.genre-pill-btn[onclick^="setGenre"]').forEach(button => {
        const match = button
            .getAttribute('onclick')
            ?.match(/^setGenre\('([^']*)'/);
        if (!match) return;
        const value = match[1];
        const matchesSelectedGenre =
            selectedGenreSet.has(value) ||
            value
                .split('|')
                .some(part =>
                    selectedGenreSet.has(part)
                );

        button.classList.toggle(
            'active',
            value === ''
                ? selectedGenres.length === 0
                : matchesSelectedGenre
        );
    });

    const genrePillContainer =
        document.querySelector(
            '.premium-genre-pills'
        );

    if (genrePillContainer) {
        genrePillContainer
            .querySelectorAll(
                '.route-only-genre-pill'
            )
            .forEach(button =>
                button.remove()
            );

        const representedGenreIds =
            new Set();

        genrePillContainer
            .querySelectorAll(
                '.genre-pill-btn[onclick^="setGenre"]'
            )
            .forEach(button => {
                const match =
                    button
                        .getAttribute(
                            'onclick'
                        )
                        ?.match(
                            /^setGenre\('([^']*)'/
                        );

                if (!match) {
                    return;
                }

                String(match[1])
                    .split('|')
                    .filter(Boolean)
                    .forEach(value =>
                        representedGenreIds.add(
                            value
                        )
                    );
            });

        genres.forEach(value => {
            const genreValue =
                String(value);

            if (
                representedGenreIds.has(
                    genreValue
                ) ||
                !/^[1-9]\d{0,5}$/.test(
                    genreValue
                )
            ) {
                return;
            }

            const numericGenreId =
                Number.parseInt(
                    genreValue,
                    10
                );

            const genreName =
                String(
                    genreMap[
                        numericGenreId
                    ] ||
                    `Tür ${genreValue}`
                );

            const button =
                document.createElement(
                    'button'
                );

            button.type = 'button';

            button.className =
                'genre-pill-btn route-only-genre-pill active';

            button.textContent =
                genreName;

            button.addEventListener(
                'click',
                () => {
                    setGenre(
                        genreValue,
                        button
                    );
                }
            );

            genrePillContainer.appendChild(
                button
            );
        });
    }
}

function restorePlatformFilterState(state) {
    syncPlatformMediaType(state.media);
    syncPlatformSelect('yearFilter', state.year);
    syncPlatformSelect('ratingFilter', state.rating);
    syncPlatformSelect('runtimeFilter', state.runtime);
    syncPlatformSelect('sortByFilter', state.sort);
    syncPlatformGenres(state.genres);
    syncSingleProviderFilter(Number(state.provider) || 0);
    syncMyPlatformsUi();
}

function syncSingleProviderFilter(providerId) {
    currentProvider = providerId;
    syncPlatformSelect('providerFilter', String(providerId));
    document.querySelectorAll('.provider-filter-btn').forEach(button => {
        button.classList.toggle(
            'active',
            button.id === `btn-prov-${providerId}` && providerId > 0
        );
    });
}

function navigateToCurrentPlatformFilters(options = {}) {
    navigate(buildPlatformRoute(), options);
}
function resetPlatformView(routeContext = null) {
    if (
        window.isHistoryRestoration &&
        currentMode === "search" &&
        routeContext?.platformQuery === "" &&
        document.getElementById('search-results').children.length > 0
    ) {
        // Preserve existing search results on history back/forward
        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
        document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));
        document.getElementById('platform').classList.add('active-tab');
        const platformLink = document.querySelector('a[onclick*="platform"]');
        if (platformLink) platformLink.classList.add('active');
        syncMyPlatformsUi();
        return;
    }

    if (
        routeContext?.returningFromDetails &&
        window.isHistoryRestoration &&
        currentMode === "platform" &&
        document.getElementById(
            'search-results'
        )?.children.length > 0
    ) {
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

        document
            .getElementById(
                'platform'
            )
            ?.classList.add(
                'active-tab'
            );

        const platformLink =
            document.querySelector(
                'a[onclick*="platform"]'
            );

        if (platformLink) {
            platformLink.classList.add(
                'active'
            );
        }

        syncMyPlatformsUi();
        return;
    }
    
    document.getElementById('searchInput').value = "";
    
    // Fallbacks for removed filters
    const gF = document.getElementById('genreFilter');
    if (gF) gF.value = "";
    
    const mT = document.getElementById('mediaTypeFilter');
    if (mT) mT.value = "all";
    
    const rF = document.getElementById('ratingFilter');
    if (rF) rF.value = "0";
    
    const sB = document.getElementById('sortByFilter');
    if (sB) {
        sB.value = "popularity.desc";
        updateCustomOptionVisibility('sortByFilter', 'order.asc', false);
    }
    
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active-tab'));
    document.querySelectorAll('.nav-links a').forEach(link => link.classList.remove('active'));
    document.getElementById('platform').classList.add('active-tab');
    const platformLink = document.querySelector('a[onclick*="platform"]');
    if (platformLink) platformLink.classList.add('active');
    
    document.getElementById('top10-section').style.display = 'block';
    const platformSelector = document.querySelector('.platform-selector');
    if (platformSelector) platformSelector.style.display = 'flex';
    const platformFilters = document.querySelector('.platform-filters');
    if (platformFilters) platformFilters.style.display = 'block';
    const platformSelection = document.getElementById('platform-selection-area');
    if (platformSelection) platformSelection.style.display = 'block';
    const filterControls = document.querySelector('.filter-controls');
    if (filterControls) filterControls.style.display = 'flex';
    
    const state = sanitizePlatformFilterState(routeContext?.platformQuery || "");
    restorePlatformFilterState(state);

    const canonicalRoute = buildPlatformRoute(state);
    if (window.location.hash.slice(1) !== canonicalRoute) {
        navigate(canonicalRoute, { replace: true });
        return;
    }

    const isPlatformFilterChange =
        !window.isHistoryRestoration &&
        currentMode === 'platform' &&
        document.getElementById(
            'search-results'
        )?.children.length > 0;

    loadPlatformMovies(
        currentProvider,
        true,
        Boolean(
            window.isHistoryRestoration ||
            isPlatformFilterChange
        ),
        routeContext
    );
}


function saveSearchFilterStateToSession(query, state = getPlatformFilterStateFromUi()) {
    try {
        if (!query) return;
        sessionStorage.setItem('search_filter_state', JSON.stringify({
            q: String(query).trim(),
            filters: buildPlatformFilterParams(state).toString()
        }));
    } catch (e) {}
}

function restoreSearchFilterStateFromSession(query) {
    try {
        const raw = sessionStorage.getItem('search_filter_state');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.q === String(query).trim() && typeof parsed.filters === 'string' && parsed.filters.length > 0) {
            const state = sanitizePlatformFilterState(parsed.filters);
            restorePlatformFilterState(state);
            return true;
        }
    } catch (e) {}
    return false;
}

function applyPlatformFilters({ refreshUnchangedPlatform = false } = {}) {
    if (currentMode === "actor") {
        syncSingleProviderFilter(normalizeTmdbId(document.getElementById('providerFilter').value) || 0);
        if (currentProvider > 0) safeWriteStorage('myPlatformsFilterActive', false);
        syncMyPlatformsUi();
        renderActor(currentActorId, document.getElementById('searchInput').value, true, currentJobType, 0, true);
    } else if (currentMode === "search") {
        const query = (currentSearchQuery || document.getElementById('searchInput')?.value || '').trim();
        if (!query) return;

        const state = getPlatformFilterStateFromUi();
        saveSearchFilterStateToSession(query, state);
        navigate(buildSearchRoute(query, state), { replace: true, searchFilterChange: true });
    } else if (refreshUnchangedPlatform && location.hash === '#' + buildPlatformRoute()) {
        refreshMyPlatformsResults();
    } else {
        navigateToCurrentPlatformFilters();
    }
}

function refreshPlatformFilterResults() {
    if (currentMode === 'actor') {
        refreshMyPlatformsResults();
    } else if (currentMode === 'platform' || currentMode === 'search') {
        applyPlatformFilters({ refreshUnchangedPlatform: true });
    }
}


function handlePlatformButtonClick(pid) {
    const providerId = currentProvider === pid ? 0 : pid;
    if (pid > 0) safeWriteStorage('myPlatformsFilterActive', false);
    syncSingleProviderFilter(providerId);
    syncMyPlatformsUi();
    applyPlatformFilters();
}


let platformRequestGeneration = 0;
const PLATFORM_RUNTIME_CACHE_MAX_SIZE = 300;
const PLATFORM_RUNTIME_CONCURRENCY = 5;
const platformMovieRuntimeCache = new Map();

function getCachedPlatformMovieRuntime(movieId) {
    const safeId = normalizeTmdbId(movieId);
    if (!safeId) return null;
    const key = `movie:${safeId}`;
    if (platformMovieRuntimeCache.has(key)) {
        const val = platformMovieRuntimeCache.get(key);
        platformMovieRuntimeCache.delete(key);
        platformMovieRuntimeCache.set(key, val);
        return val;
    }
    const cachedMedia = typeof getCachedMedia === 'function'
        ? getCachedMedia(safeId, 'movie')
        : null;
    const cachedRt = Number(cachedMedia?.runtime);
    if (Number.isFinite(cachedRt) && cachedRt > 0) {
        return cachedRt;
    }
    return null;
}

function setCachedPlatformMovieRuntime(movieId, runtimeVal) {
    const safeId = normalizeTmdbId(movieId);
    if (!safeId || !Number.isFinite(runtimeVal) || runtimeVal <= 0) return;
    const key = `movie:${safeId}`;
    if (platformMovieRuntimeCache.has(key)) {
        platformMovieRuntimeCache.delete(key);
    }
    while (platformMovieRuntimeCache.size >= PLATFORM_RUNTIME_CACHE_MAX_SIZE) {
        const oldestKey = platformMovieRuntimeCache.keys().next().value;
        if (oldestKey === undefined) break;
        platformMovieRuntimeCache.delete(oldestKey);
    }
    platformMovieRuntimeCache.set(key, runtimeVal);
}

async function fetchMovieRuntimesBounded(items, routeContext, requestGeneration) {
    const output = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
        while (nextIndex < items.length) {
            if (requestGeneration !== platformRequestGeneration || currentMode !== 'platform') return;
            if (routeContext?.signal?.aborted) return;

            const idx = nextIndex++;
            const item = items[idx];
            const cachedRuntime = getCachedPlatformMovieRuntime(item?.id);
            if (cachedRuntime !== null) {
                output[idx] = { item, runtime: cachedRuntime };
                continue;
            }

            try {
                const detailRes = await fetch(
                    `${BASE_URL}/movie/${item.id}?language=tr-TR`,
                    { signal: routeContext?.signal }
                );
                if (!detailRes.ok) {
                    output[idx] = { item, runtime: null };
                    continue;
                }
                const detailData = await detailRes.json();
                const rtVal = Number(detailData?.runtime);
                const validRuntime = (Number.isFinite(rtVal) && rtVal > 0) ? rtVal : null;
                if (validRuntime !== null) {
                    setCachedPlatformMovieRuntime(item.id, validRuntime);
                }
                output[idx] = { item, runtime: validRuntime };
            } catch (e) {
                if (e?.name === 'AbortError') throw e;
                output[idx] = { item, runtime: null };
            }
        }
    }

    const workerCount = Math.min(PLATFORM_RUNTIME_CONCURRENCY, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return output;
}

function renderRuntimeFilterNotice(tvOnly = false) {
    const message = tvOnly
        ? 'Süre filtresi yalnızca filmler için geçerlidir. Dizileri görmek için süre filtresini kaldırın.'
        : 'Süre filtresi seçili olduğu için yalnızca filmler gösteriliyor.';
    return `<div class="filter-scope-note" role="status">${escapeHtml(message)}</div>`;
}

async function loadPlatformMovies(providerId = 0, reset = true, isFilterChange = false, routeContext = null) {
    const requestGeneration = reset
        ? ++platformRequestGeneration
        : platformRequestGeneration;

    if (reset) {
        if (!isFilterChange && routeContext?.platformQuery == null) clearAllFilters();
        currentPage = 1;
        document.getElementById('search-results').innerHTML = "";
        document.getElementById('loadMoreBtn').style.display = 'none';
        updateCustomOptionVisibility('sortByFilter', 'order.asc', false);
        const sortSelect = document.getElementById('sortByFilter');
        if (sortSelect && sortSelect.value === 'order.asc') sortSelect.value = 'popularity.desc';
        
        if (!isFilterChange) {
            const scrollBehavior = (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) ? 'auto' : 'smooth';
            window.scrollTo({ top: 0, behavior: scrollBehavior });
        }
        syncSingleProviderFilter(providerId);
        syncMyPlatformsUi();
        
        // Sync platform dropdown
        const platSelect = document.getElementById('discover-platform');
        if (platSelect) platSelect.value = currentProvider;
        
        currentPage = 1;
        currentMode = "platform";
        const container = document.getElementById('search-results');
        
        if (isFilterChange) {
            container.style.minHeight = container.offsetHeight + 'px';
            const oldMovies = container.querySelectorAll('.movie-card, .no-provider, .loading');
            oldMovies.forEach(m => m.remove());
            
            let skel = "";
            for(let i=0; i<10; i++) {
                skel += `<div class="movie-card skeleton-card" style="border:none; background:transparent;"><div class="skeleton" style="width:100%; height:300px; border-radius:10px;"></div><div class="skeleton" style="width:80%; height:20px; margin-top:10px;"></div><div class="skeleton" style="width:50%; height:15px; margin-top:5px;"></div></div>`;
            }
            container.insertAdjacentHTML('beforeend', skel);
        } else {
            container.innerHTML = "<div class='loading'>İçerikler Yükleniyor...</div>";
        }
        document.getElementById('loadMoreBtn').style.display = 'none';
    }

    const subscribedIds = providerId === 0 && isMyPlatformsModeActive()
        ? getSubscribedProviderIds()
        : [];
    const genre = document.getElementById('genreFilter')?.value || "";
    const rating = document.getElementById('ratingFilter')?.value || "0";
    const mediaType = document.getElementById('mediaTypeFilter')?.value || "all";
    const yearVal = document.getElementById('yearFilter')?.value || "";
    
    const runtime = document.getElementById('runtimeFilter') ? document.getElementById('runtimeFilter').value : "";
    const typesToFetch = (mediaType === "all" ? ["movie", "tv"] : [mediaType])
        .filter(type => !(type === "tv" && runtime));
    let allResults = [];
    let maxTotalPages = 1;
    const sortBy = document.getElementById('sortByFilter') ? document.getElementById('sortByFilter').value : 'popularity.desc';
    
    try {
        const typePayloads = await Promise.all(typesToFetch.map(async (type) => {
            let url = `${BASE_URL}/discover/${type}?language=tr-TR&page=${currentPage}&include_adult=false&vote_count.gte=1000&without_keywords=210024,198385,195669`;
            
            // Exclude Talk shows (10767), News (10763), Reality (10764)
            url += `&without_genres=10767,10763,10764,99`;

            if (providerId > 0) {
                url += `&watch_region=TR`;
                url += `&with_watch_providers=${providerId}`;
            } else if (subscribedIds.length > 0) {
                url += `&watch_region=TR&with_watch_providers=${subscribedIds.join('|')}`;
            }
            if (genre) url += `&with_genres=${encodeURIComponent(genre)}`;
            if (rating > 0) url += `&vote_average.gte=${rating}`;
            
            const parsedYear = parseYearFilterValue(yearVal);
            if (parsedYear) {
                if (parsedYear.mode === 'single') {
                    if (type === "movie") url += `&primary_release_year=${parsedYear.year}`;
                    else url += `&first_air_date_year=${parsedYear.year}`;
                } else {
                    if (type === "movie") {
                        url += `&primary_release_date.gte=${parsedYear.startYear}-01-01&primary_release_date.lte=${parsedYear.endYear}-12-31`;
                    } else {
                        url += `&first_air_date.gte=${parsedYear.startYear}-01-01&first_air_date.lte=${parsedYear.endYear}-12-31`;
                    }
                }
            }
            
            let apiSortBy = sortBy;
            if (type === "tv") {
                if (sortBy === "primary_release_date.desc") apiSortBy = "first_air_date.desc";
                else if (sortBy === "primary_release_date.asc") apiSortBy = "first_air_date.asc";
            }
            url += `&sort_by=${apiSortBy}`;

            if (runtime) {
                if (runtime == '90') {
                    url += `&with_runtime.lte=90`;
                } else if (runtime == '120') {
                    url += `&with_runtime.gte=90&with_runtime.lte=105`;
                } else if (runtime == '150') {
                    url += `&with_runtime.gte=105&with_runtime.lte=135`;
                } else if (runtime == '180') {
                    url += `&with_runtime.gte=135`;
                }
            }
            
            const res = await fetch(url, { signal: routeContext?.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            
            if (requestGeneration !== platformRequestGeneration || currentMode !== "platform") return null;
            if (routeContext && !isRouteContextCurrent(routeContext, "platform")) return null;

            const totalPages = Number.isFinite(Number(data?.total_pages)) ? Number(data.total_pages) : 1;
            let validResults = [];

            if (data.results && data.results.length > 0) {
                let results = data.results;
                
                // Fetch strict runtime details if filter is active
                if (runtime && type === "movie") {
                    results = results.slice(0, 20);
                    const detailedResults = await fetchMovieRuntimesBounded(
                        results,
                        routeContext,
                        requestGeneration
                    );
                    
                    if (requestGeneration !== platformRequestGeneration || currentMode !== "platform") return null;

                    results = detailedResults.filter(detail => {
                        const rt = detail?.runtime;
                        if (!Number.isFinite(rt) || rt <= 0) return false;
                        if (runtime == '90') return rt <= 90;
                        if (runtime == '120') return rt > 90 && rt <= 105;
                        if (runtime == '150') return rt > 105 && rt <= 135;
                        if (runtime == '180') return rt > 135;
                        return true;
                    }).map(detail => detail.item);
                }

                validResults = results
                    .filter(m => !m.title?.toLowerCase().includes('making of') && !m.name?.toLowerCase().includes('making of') && !m.title?.toLowerCase().includes('marvel studios assembled') && !m.title?.toLowerCase().includes('the odyssey: the making of'))
                    .map(item => {
                        item.media_type = type;
                        return item;
                    });
            }

            return { totalPages, validResults };
        }));

        if (requestGeneration !== platformRequestGeneration || currentMode !== "platform") return;
        if (routeContext && !isRouteContextCurrent(routeContext, "platform")) return;

        const container = document.getElementById('search-results');
        if (typesToFetch.length === 0) {
            if (reset) {
                container.innerHTML = renderRuntimeFilterNotice(true);
                container.style.minHeight = '';
            }
            return;
        }

        for (const payload of typePayloads) {
            if (!payload) return;
            if (payload.totalPages > maxTotalPages) {
                maxTotalPages = payload.totalPages;
            }
            if (payload.validResults.length > 0) {
                allResults = allResults.concat(payload.validResults);
            }
        }

        const getDateVal = (item) => {
            const parsed = Date.parse(item.release_date || item.first_air_date || '');
            return Number.isFinite(parsed) ? parsed : 0;
        };

        if (sortBy === 'vote_average.desc') {
            allResults.sort((a, b) => Number(b.vote_average || 0) - Number(a.vote_average || 0));
        } else if (sortBy === 'vote_count.desc') {
            allResults.sort((a, b) => Number(b.vote_count || 0) - Number(a.vote_count || 0));
        } else if (sortBy === 'primary_release_date.desc') {
            allResults.sort((a, b) => getDateVal(b) - getDateVal(a));
        } else if (sortBy === 'primary_release_date.asc') {
            allResults.sort((a, b) => getDateVal(a) - getDateVal(b));
        } else {
            allResults.sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0));
        }
        
        const runtimeNotice = reset && runtime && mediaType === "all"
            ? renderRuntimeFilterNotice()
            : '';
        
        if (allResults.length === 0 && reset) {
            container.innerHTML = runtimeNotice + "<div class='loading'>Bu filtrelere uygun içerik bulunamadı.</div>";
            if (currentPage < maxTotalPages) {
                document.getElementById('loadMoreBtn').style.display = 'inline-block';
            }
            return;
        }
        
        let html = runtimeNotice;
        for (let i = 0; i < allResults.length; i++) {
            html += createMovieCard(
                allResults[i],
                allResults[i].media_type,
                ""
            );
        }

        if (reset) {
            container.innerHTML = html;
        } else {
            container.insertAdjacentHTML(
                'beforeend',
                html
            );
        }

        const seenProviderKeys = new Set();
        for (let i = 0; i < allResults.length; i++) {
            const item = allResults[i];
            const itemId = normalizeTmdbId(item?.id);
            const itemType = normalizeMediaType(item?.media_type, 'movie');
            if (!itemId || !itemType) continue;
            const key = `${itemType}:${itemId}`;
            if (seenProviderKeys.has(key)) continue;
            seenProviderKeys.add(key);
            fetchAndInjectProviders(
                itemId,
                itemType,
                item,
                routeContext
            );
        }
        
        if (allResults.length > 0 || currentPage < maxTotalPages) {
            document.getElementById('loadMoreBtn').style.display = 'inline-block';
        }
        if (reset) container.style.minHeight = '';
    } catch (error) {
        if (error.name === 'AbortError') return;
        if (requestGeneration !== platformRequestGeneration) return;
        if (!reset) throw error;
        if (reset) document.getElementById('search-results').style.minHeight = '';
        console.error("loadPlatformMovies error:", error);
        if (reset) {
            renderSafeError(
                'search-results',
                'İçerikler yüklenirken bir sorun oluştu. Lütfen tekrar deneyin.',
                error
            );
        }
    } finally {
        const spinner = document.getElementById('infinite-spinner');
        if (spinner) spinner.style.display = 'none';
    }
}



// --- PREMIUM FILTER UI LOGIC ---
function setMediaType(val, btn) {
    // Update hidden select
    document.getElementById('mediaTypeFilter').value = val;
    // Update UI
    const siblings = btn.parentElement.querySelectorAll('.segment-btn');
    siblings.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Trigger filter
    applyPlatformFilters();
}

let selectedGenres = [];

function setGenre(val, btn) {
    const hepsiBtn = btn.parentElement.querySelector('.genre-pill-btn[onclick*="\'\'"]');
    
    if (val === '') {
        selectedGenres = [];
        const siblings = btn.parentElement.querySelectorAll('.genre-pill-btn');
        siblings.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    } else {
        if (hepsiBtn) hepsiBtn.classList.remove('active');
        
        if (selectedGenres.includes(val)) {
            selectedGenres = selectedGenres.filter(g => g !== val);
            btn.classList.remove('active');
        } else {
            selectedGenres.push(val);
            btn.classList.add('active');
        }
        
        if (selectedGenres.length === 0) {
            if (hepsiBtn) hepsiBtn.classList.add('active');
        }
    }
    
    document.getElementById('genreFilter').value = selectedGenres.join(',');
    applyPlatformFilters();
}

function clearAllFilters() {
    resetPlatformFilterControls();
    safeWriteStorage('myPlatformsFilterActive', false);
    syncMyPlatformsUi();
}

function resetAllPlatformFilters() {
    clearAllFilters();
    refreshPlatformFilterResults();
}

function resetPlatformFilterControls() {
    const gf = document.getElementById('genreFilter');
    if (gf) gf.value = '';
    const yf = document.getElementById('yearFilter');
    if (yf) yf.value = '';
    const sf = document.getElementById('sortByFilter');
    if (sf) sf.value = 'popularity.desc';
    const rf = document.getElementById('ratingFilter');
    if (rf) rf.value = '0';
    const rtf = document.getElementById('runtimeFilter');
    if (rtf) rtf.value = '';
    const mtf = document.getElementById('mediaTypeFilter');
    if (mtf) mtf.value = 'all';
    
    document.querySelectorAll('.segment-btn[onclick^="setMediaType"]').forEach(btn => btn.classList.remove('active'));
    const allMediaBtn = document.querySelector('.segment-btn[onclick="setMediaType(\'all\', this)"]');
    if (allMediaBtn) allMediaBtn.classList.add('active');
    
    syncPlatformSelect(
        'mediaTypeFilter',
        'all'
    );

    syncPlatformSelect(
        'yearFilter',
        ''
    );

    syncPlatformSelect(
        'ratingFilter',
        '0'
    );

    syncSingleProviderFilter(0);

    syncPlatformSelect(
        'runtimeFilter',
        ''
    );

    syncPlatformSelect(
        'sortByFilter',
        'popularity.desc'
    );
    
    document
        .querySelectorAll(
            '.route-only-genre-pill'
        )
        .forEach(button =>
            button.remove()
        );

    selectedGenres = [];
    document.querySelectorAll('.genre-pill-btn').forEach(b => b.classList.remove('active'));
    const hepsiBtn = document.querySelector('.genre-pill-btn[onclick*="\'\'"]');
    if (hepsiBtn) hepsiBtn.classList.add('active');
}
