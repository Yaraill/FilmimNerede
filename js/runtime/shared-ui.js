function updateCustomOptionVisibility(selectId, value, isVisible) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const option = select.querySelector(`option[value="${value}"]`);
    if (option) {
        option.hidden = !isVisible;
        option.disabled = !isVisible;
    }
    if (select.nextElementSibling && select.nextElementSibling.classList.contains('custom-select-container')) {
        const customOpt = select.nextElementSibling.querySelector(`.custom-option[data-value="${value}"]`);
        if (customOpt) {
            customOpt.style.display = isVisible ? 'block' : 'none';
        }
    }
}


function toggleSelectVisibility(id, show) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = show ? 'inline-block' : 'none';
    const wrapper = el.nextElementSibling;
    if (wrapper && wrapper.classList.contains('custom-select-container')) {
        wrapper.style.display = show ? 'inline-block' : 'none';
    }
}


function showSkeletons(containerId, count = 10) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let html = '';
    for(let i=0; i<count; i++) {
        html += `
            <div class="movie-card" style="border:none; background:transparent;">
                <div class="skeleton" style="width:100%; height:300px; border-radius:10px;"></div>
                <div class="skeleton" style="width:80%; height:20px; margin-top:10px;"></div>
                <div class="skeleton" style="width:50%; height:15px; margin-top:5px;"></div>
            </div>
        `;
    }
    container.innerHTML = html;
}


function switchViewMode(mode) {
    const container = document.getElementById('search-results');
    const gridBtn = document.getElementById('viewGridBtn');
    const listBtn = document.getElementById('viewListBtn');

    if (gridBtn) {
        gridBtn.classList.remove('active');
        gridBtn.setAttribute('aria-pressed', 'false');
    }
    if (listBtn) {
        listBtn.classList.remove('active');
        listBtn.setAttribute('aria-pressed', 'false');
    }

    if (mode === 'list') {
        if (container) container.classList.add('list-view');
        if (listBtn) {
            listBtn.classList.add('active');
            listBtn.setAttribute('aria-pressed', 'true');
        }
    } else {
        if (container) container.classList.remove('list-view');
        if (gridBtn) {
            gridBtn.classList.add('active');
            gridBtn.setAttribute('aria-pressed', 'true');
        }
    }
    if (typeof announceA11y === 'function') {
        announceA11y(mode === 'list' ? 'Liste görünümüne geçildi.' : 'Izgara görünümüne geçildi.');
    }
}


function syncThemeState(isLight) {
    const lightTheme = Boolean(isLight);
    document.body.classList.toggle('light-theme', lightTheme);

    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) {
        const icon = document.createElement('i');
        icon.className = lightTheme ? 'fas fa-moon' : 'fas fa-sun';
        icon.setAttribute('aria-hidden', 'true');
        themeBtn.replaceChildren(icon);
        themeBtn.setAttribute('aria-pressed', lightTheme ? 'true' : 'false');
    }

    return lightTheme;
}

function toggleTheme() {
    const isLight = syncThemeState(!document.body.classList.contains('light-theme'));
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    window.dispatchEvent(new Event('scroll'));
}


function updateCity() {
    currentCity = document.getElementById('citySelect').value;
}


function buyTicket(movieId) {
    if (!currentCity) {
        alert("Lütfen önce yukarıdan şehrinizi seçin!");
        document.getElementById('citySelect').focus();
        return;
    }
    const movie = window.movieCache[movieId];
    if (!movie) return;

    // Biletinial yönlendirme
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(currentCity + ' ' + movie.title + ' bilet al')}`;
    window.open(searchUrl, '_blank');
}


function createMovieCard(item, mediaType = "movie", tabContext = "") {
    if (!item || typeof item !== 'object') {
        return '';
    }

    const itemId =
        normalizeTmdbId(item.id);

    if (!itemId) {
        return '';
    }

    const normalizedMediaType =
        normalizeMediaType(
            mediaType,
            normalizeMediaType(
                item.media_type,
                'movie'
            )
        );

    const title = String(
        item.title ||
        item.name ||
        'Bilinmiyor'
    );

    const releaseDate = String(
        item.release_date ||
        item.first_air_date ||
        ''
    );

    const year =
        releaseDate.split('-')[0];

    const titleWithYear =
        year
            ? `${title} (${year})`
            : title;

    const poster =
        getSafeTmdbImageUrl(
            item.poster_path,
            IMAGE_BASE,
            'https://placehold.co/500x750/1a1a2e/ffffff?text=Afis+Yok'
        );

    const allGenres =
        Array.isArray(item.genre_ids)
            ? item.genre_ids
                .map(id => genreMap[id])
                .filter(Boolean)
                .map(name => String(name))
            : [];

    const genres =
        allGenres.slice(0, 3).join(', ') +
        (
            allGenres.length > 3
                ? '...'
                : ''
        );

    let watchlist = [];

    try {
        const storedWatchlist =
            JSON.parse(
                localStorage.getItem('watchlist') ||
                '[]'
            );

        if (Array.isArray(storedWatchlist)) {
            watchlist = storedWatchlist;
        }
    } catch (error) {
        console.warn(
            'Watchlist okunamadı:',
            error
        );
    }

    const isSaved =
        watchlist.some(
            entry =>
                normalizeTmdbId(entry?.id) ===
                itemId
        )
            ? 'active'
            : '';

    window.movieCache[itemId] = {
        id: itemId,
        title: title,
        name: title,
        release_date:
            item.release_date ||
            item.first_air_date,
        poster_path:
            item.poster_path,
        backdrop_path:
            item.backdrop_path,
        overview:
            item.overview,
        vote_average:
            item.vote_average,
        genre_ids:
            Array.isArray(item.genre_ids)
                ? item.genre_ids
                : [],
        media_type:
            normalizedMediaType
    };

    let dateOrProviderHtml = '';

    if (
        tabContext === 'upcoming' &&
        item.release_date
    ) {
        const date =
            new Date(item.release_date);

        const formattedDate =
            date.toLocaleDateString(
                'tr-TR',
                {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                }
            );

        dateOrProviderHtml = `
            <div
                class="movie-date"
                style="color:var(--primary-color)"
            >
                Vizyon: ${escapeHtml(formattedDate)}
            </div>
        `;
    } else {
        dateOrProviderHtml = `
            <div
                class="movie-date providers-container providers-${itemId}"
            >
                <span
                    style="font-size:0.8rem; color:var(--text-muted)"
                >
                    Platformlar aranıyor...
                </span>
            </div>
        `;
    }

    let buyTicketHtml = '';

    if (
        tabContext === 'now-playing' &&
        normalizedMediaType === 'movie'
    ) {
        buyTicketHtml = `
            <button
                type="button"
                class="action-btn btn-buy-ticket-card"
                onclick="buyTicket(${itemId})"
                aria-label="${escapeHtml(title)} bilet al"
            >
                <i class="fas fa-ticket-alt" aria-hidden="true"></i>
                Bilet Al
            </button>
        `;
    }

    const mediaBadgeLabel =
        normalizedMediaType === 'tv'
            ? 'Dizi'
            : 'Film';

    const overview =
        typeof item.overview === 'string' &&
        item.overview.trim().length > 0
            ? item.overview
            : 'Konu özeti bulunmuyor.';

    return `
        <div
            class="movie-card"
            style="position:relative"
        >
            <div class="media-type-badge">
                ${mediaBadgeLabel}
            </div>

            <button
                type="button"
                class="btn-heart ${isSaved}"
                onclick="toggleWatchlist(this, ${itemId})"
                title="Listeme Ekle/Çıkar"
                aria-label="${isSaved ? 'Listeden çıkar' : 'Listeme ekle'}"
                aria-pressed="${isSaved ? 'true' : 'false'}"
            >
                <i class="fas fa-heart" aria-hidden="true"></i>
            </button>

            <img
                src="${escapeHtml(poster)}"
                alt="${escapeHtml(title)}"
                class="movie-poster"
                style="cursor:pointer"
                onclick="openDetails(${itemId}, '${normalizedMediaType}')"
                onmouseenter="startHoverSlideshow(this, ${itemId})"
                onmouseleave="stopHoverSlideshow(this)"
            >

            <div class="movie-info">
                <div class="movie-meta">
                    <span class="genre-list">
                        ${escapeHtml(genres)}
                    </span>
                </div>

                <div class="movie-title">
                    <button
                        type="button"
                        class="movie-title-btn"
                        onclick="openDetails(${itemId}, '${normalizedMediaType}')"
                        aria-label="${escapeHtml(titleWithYear)} detayları"
                    >
                        ${escapeHtml(titleWithYear)}
                    </button>
                </div>

                <div class="list-view-overview">
                    ${escapeHtml(overview)}
                </div>

                <div
                    class="bottom-group"
                    style="
                        margin-top:auto;
                        display:flex;
                        flex-direction:column;
                        gap:10px;
                        padding-top:10px;
                        width:100%;
                        max-width:280px;
                    "
                >
                    ${dateOrProviderHtml}

                    <div class="card-actions">
                        <button
                            type="button"
                            class="action-btn btn-trailer"
                            onclick="openTrailer(${itemId}, '${normalizedMediaType}')"
                            aria-label="${escapeHtml(title)} fragmanını izle"
                        >
                            <i class="fas fa-play" aria-hidden="true"></i>
                            Fragman
                        </button>

                        ${buyTicketHtml}
                    </div>
                </div>
            </div>
        </div>
    `;
}


let hoverSlideshowTimer = null;
let hoverSlideshowInterval = null;
async function startHoverSlideshow(imgElement, movieId) {
    const safeMovieId =
        normalizeTmdbId(movieId);

    if (!imgElement || !safeMovieId) {
        return;
    }

    if (typeof prefersReducedMotion === 'function' && prefersReducedMotion()) {
        return;
    }

    if (!imgElement.dataset.originalSrc) {
        imgElement.dataset.originalSrc =
            imgElement.src;
    }

    imgElement.dataset.isHovered = 'true';
    movieId = safeMovieId;

    hoverSlideshowTimer = setTimeout(async () => {
        if (imgElement.dataset.isHovered !== 'true') return;
        imgElement.style.transition = "none";

        let images = [imgElement.src];

        if (movieId) {
            if (!window.movieImagesCache) window.movieImagesCache = {};
            if (!window.movieImagesCache[movieId]) {
                try {
                    const item = window.movieCache[movieId];
                    const type =
                        normalizeMediaType(
                            item?.media_type,
                            'movie'
                        );
                    const res = await fetch(`${BASE_URL}/${type}/${movieId}/images?api_key=${API_KEY}`);
                    const data = await res.json();
                    const extraImages =
                        (data.backdrops || [])
                            .slice(0, 5)
                            .map(backdrop =>
                                getSafeTmdbImageUrl(
                                    backdrop?.file_path,
                                    BACKDROP_BASE,
                                    null
                                )
                            )
                            .filter(Boolean);
                    if (extraImages.length > 0) {
                        images = extraImages;
                    }
                    window.movieImagesCache[movieId] = images;
                } catch (e) {}
            } else {
                images = window.movieImagesCache[movieId];
            }
        }

        if (imgElement.dataset.isHovered !== 'true') return;

        if (images.length > 0) {
            imgElement.style.objectFit = 'contain';
            imgElement.style.backgroundColor = 'black';
            let index = 0;
            imgElement.src = images[index];
            if (images.length > 1) {
                hoverSlideshowInterval = setInterval(() => {
                    index = (index + 1) % images.length;
                    imgElement.src = images[index];
                }, 1500);
            }
        }
    }, 600); // 600ms hover delay
}


function stopHoverSlideshow(imgElement) {
    if (!imgElement) return;

    imgElement.dataset.isHovered =
        'false';

    if (hoverSlideshowTimer) {
        clearTimeout(
            hoverSlideshowTimer
        );

        hoverSlideshowTimer = null;
    }

    if (hoverSlideshowInterval) {
        clearInterval(
            hoverSlideshowInterval
        );

        hoverSlideshowInterval = null;
    }

    const originalSrc =
        imgElement.dataset.originalSrc;

    if (originalSrc) {
        imgElement.src =
            originalSrc;
    }

    imgElement.style.transition =
        'transform 0.3s ease';

    imgElement.style.objectFit =
        'cover';

    imgElement.style.backgroundColor =
        'transparent';
}


// =========================================
// MOBILE HAMBURGER MENU
// =========================================
function toggleMobileMenu() {
    const menuToggle = document.getElementById('mobile-menu');
    const navLinks = document.querySelector('.nav-links');
    if (menuToggle && navLinks) {
        const isActive = menuToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
        menuToggle.setAttribute('aria-expanded', isActive ? 'true' : 'false');
    }
}

function closeMobileMenu(restoreFocus = true) {
    const menuToggle = document.getElementById('mobile-menu');
    const navLinks = document.querySelector('.nav-links');
    if (menuToggle && menuToggle.classList.contains('active')) {
        menuToggle.classList.remove('active');
        menuToggle.setAttribute('aria-expanded', 'false');
        if (navLinks) navLinks.classList.remove('active');
        if (restoreFocus) menuToggle.focus();
    }
}

// Close mobile menu when a nav link is clicked
document.querySelectorAll('.nav-links li a, .nav-links li button').forEach(link => {
    link.addEventListener('click', () => {
        closeMobileMenu(false);
    });
});

// =========================================
// CUSTOM SELECTS INITIALIZATION
// =========================================
function closeCustomSelectDropdown(wrapperElem, focusTrigger = false) {
    if (!wrapperElem) return;
    wrapperElem.classList.remove('open');
    const trigger = wrapperElem.querySelector('.custom-select-trigger');
    if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.removeAttribute('aria-activedescendant');
        if (focusTrigger) {
            trigger.focus();
        }
    }
    wrapperElem.querySelectorAll('.custom-option').forEach(o => o.classList.remove('active-focus'));
}

document.addEventListener('DOMContentLoaded', () => {
    const selects = document.querySelectorAll('select.premium-dropdown, select.premium-city-select, select.modern-select');
    selects.forEach((select, selectIdx) => {
        if (select.classList.contains('custom-select-hidden')) return;

        select.classList.add('custom-select-hidden');
        select.setAttribute('aria-hidden', 'true');
        select.setAttribute('tabindex', '-1');

        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-container';
        if (select.style.width === '100%' || select.classList.contains('modern-select')) wrapper.classList.add('full-width');

        const selectId = select.id || ('select-auto-' + selectIdx);
        const labelId = 'custom-label-' + selectId;
        const valId = 'custom-val-' + selectId;
        const listboxId = 'custom-listbox-' + selectId;
        const triggerId = 'custom-trigger-' + selectId;

        const selectLabel = select.getAttribute('aria-label') || (select.labels && select.labels[0]?.textContent) || select.title || 'Filtre';

        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        trigger.id = triggerId;
        trigger.setAttribute('role', 'combobox');
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-controls', listboxId);
        trigger.setAttribute('tabindex', '0');

        const srLabel = document.createElement('span');
        srLabel.id = labelId;
        srLabel.className = 'sr-only';
        srLabel.textContent = selectLabel;

        const selectedOption = select.options[select.selectedIndex];
        let triggerText = selectedOption ? selectedOption.text : 'Seçiniz...';

        const valSpan = document.createElement('span');
        valSpan.id = valId;
        valSpan.className = 'custom-select-value';
        valSpan.textContent = String(triggerText ?? '');

        trigger.setAttribute('aria-labelledby', `${labelId} ${valId}`);
        trigger.setAttribute('aria-label', `${selectLabel}: ${valSpan.textContent}`);

        const triggerIcon = document.createElement('i');
        triggerIcon.className = 'fas fa-chevron-down';
        triggerIcon.setAttribute('aria-hidden', 'true');

        trigger.append(
            srLabel,
            valSpan,
            document.createTextNode(' '),
            triggerIcon
        );

        const optionsWrapper = document.createElement('div');
        optionsWrapper.className = 'custom-options-wrapper';
        optionsWrapper.id = listboxId;
        optionsWrapper.setAttribute('role', 'listbox');
        optionsWrapper.setAttribute('aria-label', selectLabel);
        optionsWrapper.setAttribute('tabindex', '-1');

        const customOptionList = [];

        function getVisibleOptions() {
            return customOptionList.filter(opt => opt.style.display !== 'none' && !opt.classList.contains('disabled'));
        }

        function highlightOption(opt) {
            optionsWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('active-focus'));
            if (opt) {
                opt.classList.add('active-focus');
                opt.scrollIntoView({ block: 'nearest' });
                trigger.setAttribute('aria-activedescendant', opt.id);
            } else {
                trigger.removeAttribute('aria-activedescendant');
            }
        }

        function openDropdown() {
            document.querySelectorAll('.custom-select-container').forEach(c => {
                if (c !== wrapper) closeCustomSelectDropdown(c);
            });
            wrapper.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
            const sel = optionsWrapper.querySelector('.custom-option.selected');
            const visible = getVisibleOptions();
            const target = (sel && visible.includes(sel)) ? sel : visible[0];
            highlightOption(target);
        }

        function closeDropdown(focusTrigger = false) {
            closeCustomSelectDropdown(wrapper, focusTrigger);
        }

        function selectOption(customOption, shouldFocusTrigger = true) {
            const val = customOption.dataset.value;
            if (select.value !== val) {
                select.value = val;
                // EXACTLY ONCE change dispatch!
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            valSpan.textContent = customOption.textContent;
            trigger.setAttribute('aria-label', `${selectLabel}: ${customOption.textContent}`);
            optionsWrapper.querySelectorAll('.custom-option').forEach(opt => {
                opt.classList.remove('selected', 'active-focus');
                opt.setAttribute('aria-selected', 'false');
            });
            customOption.classList.add('selected');
            customOption.setAttribute('aria-selected', 'true');
            closeDropdown(shouldFocusTrigger);
        }

        Array.from(select.options).forEach((option, index) => {
            if (option.disabled && option.value === '') return;

            const customOption = document.createElement('div');
            customOption.className = 'custom-option';
            customOption.id = `${selectId}-opt-${index}`;
            customOption.setAttribute('role', 'option');
            customOption.setAttribute('tabindex', '-1');

            const isSelected = (index === select.selectedIndex);
            if (isSelected) customOption.classList.add('selected');
            customOption.setAttribute('aria-selected', isSelected ? 'true' : 'false');

            customOption.textContent = option.text;
            customOption.dataset.value = option.value;
            if (option.hidden) customOption.style.display = 'none';

            customOption.addEventListener('click', function(e) {
                e.stopPropagation();
                selectOption(this, false);
            });

            optionsWrapper.appendChild(customOption);
            customOptionList.push(customOption);
        });

        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            if (wrapper.classList.contains('open')) {
                closeDropdown(false);
            } else {
                openDropdown();
            }
        });

        trigger.addEventListener('keydown', function(e) {
            const isOpen = wrapper.classList.contains('open');
            const visible = getVisibleOptions();
            const currentFocus = optionsWrapper.querySelector('.custom-option.active-focus');
            let currentIndex = visible.indexOf(currentFocus);

            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (isOpen) {
                    if (currentFocus) {
                        selectOption(currentFocus, true);
                    } else {
                        closeDropdown(true);
                    }
                } else {
                    openDropdown();
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!isOpen) {
                    openDropdown();
                } else {
                    const nextIdx = (currentIndex + 1 < visible.length) ? currentIndex + 1 : 0;
                    highlightOption(visible[nextIdx]);
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (!isOpen) {
                    openDropdown();
                } else {
                    const prevIdx = (currentIndex - 1 >= 0) ? currentIndex - 1 : visible.length - 1;
                    highlightOption(visible[prevIdx]);
                }
            } else if (e.key === 'Home') {
                if (isOpen) {
                    e.preventDefault();
                    if (visible.length > 0) highlightOption(visible[0]);
                }
            } else if (e.key === 'End') {
                if (isOpen) {
                    e.preventDefault();
                    if (visible.length > 0) highlightOption(visible[visible.length - 1]);
                }
            } else if (e.key === 'Escape') {
                if (isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeDropdown(true);
                }
            } else if (e.key === 'Tab') {
                if (isOpen) {
                    // Allow natural tab progression, just close popup
                    closeDropdown(false);
                }
            }
        });

        select.addEventListener('change', () => {
            const currentOpt = select.options[select.selectedIndex];
            if (currentOpt) {
                valSpan.textContent = currentOpt.text;
                trigger.setAttribute('aria-label', `${selectLabel}: ${currentOpt.text}`);
                optionsWrapper.querySelectorAll('.custom-option').forEach(opt => {
                    const isMatch = (opt.dataset.value === currentOpt.value);
                    opt.classList.toggle('selected', isMatch);
                    opt.setAttribute('aria-selected', isMatch ? 'true' : 'false');
                });
            }
        });

        wrapper.appendChild(trigger);
        wrapper.appendChild(optionsWrapper);
        select.parentNode.insertBefore(wrapper, select.nextSibling);
    });

    document.addEventListener('click', (e) => {
        document.querySelectorAll('.custom-select-container').forEach(c => {
            if (!c.contains(e.target)) {
                closeCustomSelectDropdown(c);
            }
        });
    });
});

// =========================================
// ACCESSIBILITY HELPERS (REDUCED MOTION & ANNOUNCER)
// =========================================
function prefersReducedMotion() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
window.prefersReducedMotion = prefersReducedMotion;

let announceA11yTimer = null;
function announceA11y(message) {
    const liveRegion = document.getElementById('a11y-live-region');
    if (liveRegion && message) {
        if (announceA11yTimer) clearTimeout(announceA11yTimer);
        announceA11yTimer = setTimeout(() => {
            liveRegion.textContent = String(message);
        }, 100);
    }
}
window.announceA11y = announceA11y;
window.announceToScreenReader = announceA11y;

// =========================================
// MODAL MANAGER & LIFECYCLE (SPRINT 4)
// =========================================
const ModalManager = {
    stack: [],
    externalOriginTrigger: null,

    hasActiveModal() {
        return this.stack.length > 0;
    },

    getTopModal() {
        return this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
    },

    isModalOpen(modalElem) {
        if (!modalElem) return false;
        return this.stack.some(entry => entry.element === modalElem || entry.id === modalElem.id || entry.id === modalElem);
    },

    openModal(modalElem, triggerElem = null) {
        if (!modalElem) return;

        const trigger = triggerElem || document.activeElement;

        if (modalElem.id === 'details-modal') {
            if (!this.externalOriginTrigger || (trigger && !modalElem.contains(trigger))) {
                this.externalOriginTrigger = trigger;
            }
        }

        const previousTop = this.getTopModal();
        if (previousTop && previousTop.element !== modalElem) {
            if (previousTop.element.contains(document.activeElement)) {
                document.activeElement.blur();
            }
            previousTop.element.setAttribute('aria-hidden', 'true');
            previousTop.element.classList.add('modal-underlay');
            if (!(modalElem.id === 'trailer-modal' && modalElem.classList.contains('pip-mode'))) {
                previousTop.element.inert = true;
            }
        }

        const existingIdx = this.stack.findIndex(entry => entry.element === modalElem);
        if (existingIdx !== -1) {
            this.stack.splice(existingIdx, 1);
        }

        this.stack.push({
            id: modalElem.id,
            element: modalElem,
            trigger: trigger
        });

        modalElem.style.removeProperty('display');
        modalElem.classList.add('active');
        modalElem.classList.remove('modal-underlay');
        modalElem.removeAttribute('aria-hidden');
        modalElem.inert = false;

        if (this.stack.length === 1) {
            const main = document.getElementById('main-content');
            if (main) main.inert = true;
            const navbar = document.querySelector('.navbar');
            if (navbar) navbar.inert = true;
            const footer = document.querySelector('.site-footer');
            if (footer) footer.inert = true;
            const advancedPanel = document.getElementById('advanced-search-panel');
            if (advancedPanel) advancedPanel.inert = true;
            document.body.style.overflow = 'hidden';
        }

        setTimeout(() => {
            if (modalElem.contains(document.activeElement) && document.activeElement !== modalElem) {
                return;
            }
            const closeBtn = modalElem.querySelector('.close-btn');
            if (closeBtn && typeof closeBtn.focus === 'function') {
                closeBtn.focus();
            } else {
                const focusable = modalElem.querySelectorAll(
                    'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                );
                if (focusable.length > 0) {
                    focusable[0].focus();
                }
            }
        }, 50);
    },

    closeModal(modalElem, options = false) {
        if (!modalElem) return;

        const skipFocusRestore = (typeof options === 'boolean') ? options : Boolean(options?.skipFocusRestore);

        const index = this.stack.findIndex(entry => entry.element === modalElem);
        const entry = (index !== -1) ? this.stack.splice(index, 1)[0] : null;

        modalElem.classList.remove('active');
        modalElem.classList.remove('modal-underlay');
        modalElem.setAttribute('aria-hidden', 'true');
        modalElem.inert = true;
        modalElem.style.removeProperty('display');

        const top = this.getTopModal();
        if (top) {
            top.element.classList.remove('modal-underlay');
            top.element.removeAttribute('aria-hidden');
            if (modalElem.contains(document.activeElement)) { document.activeElement.blur(); }
            top.element.inert = false;
            if (!skipFocusRestore) {
                if (entry && entry.trigger && top.element.contains(entry.trigger)) {
                    entry.trigger.focus();
                } else {
                    const closeBtn = top.element.querySelector('.close-btn');
                    if (closeBtn) closeBtn.focus();
                }
            }
        } else {
            const main = document.getElementById('main-content');
            if (main) main.inert = false;
            const navbar = document.querySelector('.navbar');
            if (navbar) navbar.inert = false;
            const footer = document.querySelector('.site-footer');
            if (footer) footer.inert = false;
            const advancedPanel = document.getElementById('advanced-search-panel');
            if (advancedPanel) advancedPanel.inert = false;
            document.body.style.overflow = 'auto';

            if (modalElem.contains(document.activeElement)) { document.activeElement.blur(); }

            if (!skipFocusRestore) {
                let targetTrigger = this.externalOriginTrigger || entry?.trigger;
                if (targetTrigger && !document.contains(targetTrigger)) {
                    const activeSection = document.querySelector('.tab-content.active-tab') || document.getElementById('main-content') || document;
                    if (targetTrigger.id) {
                        targetTrigger = document.getElementById(targetTrigger.id) || targetTrigger;
                    } else if (targetTrigger.getAttribute && targetTrigger.getAttribute('aria-label')) {
                        try {
                            targetTrigger = activeSection.querySelector(`[aria-label="${CSS.escape(targetTrigger.getAttribute('aria-label'))}"]`) || targetTrigger;
                        } catch(e) {}
                    } else if (targetTrigger.className) {
                        try {
                            const sel = '.' + targetTrigger.className.trim().split(/\s+/).join('.');
                            targetTrigger = activeSection.querySelector(sel) || targetTrigger;
                        } catch(e) {}
                    }
                }
                if (targetTrigger && typeof targetTrigger.focus === 'function' && document.contains(targetTrigger)) {
                    if (targetTrigger.offsetParent !== null || targetTrigger.getClientRects().length > 0) {
                        targetTrigger.focus();
                    } else {
                        setTimeout(() => {
                            if (document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement) {
                                return;
                            }
                            if (targetTrigger && document.contains(targetTrigger) && typeof targetTrigger.focus === 'function') {
                                targetTrigger.focus();
                            }
                        }, 50);
                    }
                }
            }
            this.externalOriginTrigger = null;
        }
    },

    handleKeydown(e) {
        if (e.key === 'Tab') {
            const top = this.getTopModal();
            if (!top) return;

            if (top.id === 'trailer-modal' && top.element.classList.contains('pip-mode')) {
                return;
            }

            const focusable = Array.from(top.element.querySelectorAll(
                'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter(el => el.offsetParent !== null || el === document.activeElement);

            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }

            const firstEl = focusable[0];
            const lastEl = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstEl || !top.element.contains(document.activeElement)) {
                    e.preventDefault();
                    lastEl.focus();
                }
            } else {
                if (document.activeElement === lastEl || !top.element.contains(document.activeElement)) {
                    e.preventDefault();
                    firstEl.focus();
                }
            }
        }
    }
};

if (typeof window !== 'undefined') {
    window.ModalManager = ModalManager;
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', (e) => ModalManager.handleKeydown(e));
}