

// API Ayarları


// Kart Oluşturma Ortak Fonksiyonu


// V5: PREMIUM FONKSİYONLAR (Tooltip, TV)



async function loadSeasonEpisodes(tvId, seasonNumber) {
    const container = document.getElementById('episodes-container');
    if (!container) return;
    
    container.innerHTML = "<div class='loading'>Bölümler yükleniyor...</div>";
    try {
        const res = await fetch(`${BASE_URL}/tv/${tvId}/season/${seasonNumber}?api_key=${API_KEY}&language=tr-TR`);
        const data = await res.json();
        
        if (data.episodes && data.episodes.length > 0) {
            let html = "";
            data.episodes.forEach(ep => {
                const img = ep.still_path ? IMAGE_BASE + ep.still_path : 'https://via.placeholder.com/120x70?text=Afiş+Yok';
                const airDate = ep.air_date ? new Date(ep.air_date).toLocaleDateString('tr-TR') : 'Bilinmiyor';
                
                const imdbUrl = window.currentImdbId ? `https://www.imdb.com/title/${window.currentImdbId}/episodes?season=${seasonNumber}` : `https://www.themoviedb.org/tv/${tvId}/season/${seasonNumber}/episode/${ep.episode_number}`;
                
                html += `
                    <div class="episode-card" style="cursor:pointer; position:relative; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'" onclick="window.open('${imdbUrl}', '_blank')" title="IMDb Sayfasını Aç">
                        <img src="${img}" alt="${ep.name}" loading="lazy">
                        <div class="episode-info">
                            <h4>${ep.episode_number}. ${ep.name} <i class="fab fa-imdb" style="color:#f5c518; margin-left:5px;"></i></h4>
                            <p style="color:var(--accent-color); font-weight:600; font-size:0.8rem; margin-bottom:5px;">Yayın: ${airDate}</p>
                            <p>${ep.overview || 'Bu bölüm için henüz özet bulunmuyor.'}</p>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        } else {
            container.innerHTML = "<div>Bu sezon için bölüm bulunamadı.</div>";
        }
    } catch(e) {
        container.innerHTML = "<div style='color:red'>Hata oluştu.</div>";
    }
}

let currentTooltipTimer = null;
function showActorTooltip(element, actorId) {
    if (currentTooltipTimer) clearTimeout(currentTooltipTimer);
    
    currentTooltipTimer = setTimeout(async () => {
        let tooltip = document.getElementById('global-actor-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'global-actor-tooltip';
            tooltip.className = 'actor-tooltip';
            document.body.appendChild(tooltip);
        }
        
        tooltip.innerHTML = "Yükleniyor...";
        
        // Calculate position
        const rect = element.getBoundingClientRect();
        tooltip.style.position = 'fixed';
        tooltip.style.left = (rect.left + rect.width / 2) + 'px';
        tooltip.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
        tooltip.style.transform = 'translateX(-50%) translateY(0)';
        tooltip.classList.add('active');
        
        try {
            const [pRes, mRes] = await Promise.all([
                fetch(`${BASE_URL}/person/${actorId}?api_key=${API_KEY}&language=tr-TR`),
                fetch(`${BASE_URL}/person/${actorId}/combined_credits?api_key=${API_KEY}&language=tr-TR`)
            ]);
            
            const person = await pRes.json();
            const movies = await mRes.json();
            
            let ageHtml = "";
            if (person.birthday) {
                const birth = new Date(person.birthday);
                const end = person.deathday ? new Date(person.deathday) : new Date();
                const age = Math.floor((end - birth) / (365.25 * 24 * 60 * 60 * 1000));
                ageHtml = person.deathday ? `Vefat (${age} yaşında)` : `${age} Yaşında`;
            }
            
            const place = person.place_of_birth ? `<br>${person.place_of_birth.split(',').pop().trim()}` : "";
            
            const bestMovies = (movies.cast || []).sort((a,b) => b.popularity - a.popularity).slice(0, 3);
            let moviesHtml = "";
            bestMovies.forEach(m => {
                moviesHtml += `<li style="white-space: normal; overflow: visible;">• ${m.title || m.name}</li>`;
            });
            
            tooltip.innerHTML = `
                <h4>${person.name}</h4>
                <div class="tt-meta">${ageHtml} ${place}</div>
                ${moviesHtml ? `<ul style="padding: 0; list-style: none;">${moviesHtml}</ul>` : ''}
            `;
        } catch(e) {
            tooltip.innerHTML = "Bilgi alınamadı.";
        }
    }, 400);
}

function hideActorTooltip(element = null) {
    if (currentTooltipTimer) clearTimeout(currentTooltipTimer);
    const tooltip = document.getElementById('global-actor-tooltip');
    if (tooltip) {
        tooltip.classList.remove('active');
    }
}



// Sürükle Bırak Kaydırma (Drag to Scroll)


// MOBILE HAMBURGER MENU


function toggleMobileMenu() {
    const menuToggle = document.getElementById('mobile-menu');
    const navLinks = document.querySelector('.nav-links');
    if (menuToggle && navLinks) {
        menuToggle.classList.toggle('active');
        navLinks.classList.toggle('active');
    }
}

// Close mobile menu when a nav link is clicked
document.querySelectorAll('.nav-links li a, .nav-links li button').forEach(link => {
    link.addEventListener('click', () => {
        const menuToggle = document.getElementById('mobile-menu');
        const navLinks = document.querySelector('.nav-links');
        if (menuToggle && menuToggle.classList.contains('active')) {
            menuToggle.classList.remove('active');
            navLinks.classList.remove('active');
        }
    });
});



// CUSTOM SELECTS INITIALIZATION


document.addEventListener('DOMContentLoaded', () => {
    const selects = document.querySelectorAll('select.premium-dropdown, select.premium-city-select, select.modern-select');
    selects.forEach(select => {
        if (select.classList.contains('custom-select-hidden')) return;
        
        select.classList.add('custom-select-hidden');
        
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-container';
        if (select.style.width === '100%' || select.classList.contains('modern-select')) wrapper.classList.add('full-width');
        
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        
        const selectedOption = select.options[select.selectedIndex];
        let triggerText = selectedOption ? selectedOption.text : "Seçiniz...";
        
        trigger.innerHTML = `<span>${triggerText}</span> <i class="fas fa-chevron-down"></i>`;
        
        const optionsWrapper = document.createElement('div');
        optionsWrapper.className = 'custom-options-wrapper';
        
        Array.from(select.options).forEach((option, index) => {
            if (option.disabled && option.value === "") return;
            
            const customOption = document.createElement('div');
            customOption.className = 'custom-option';
            if (index === select.selectedIndex) customOption.classList.add('selected');
            customOption.textContent = option.text;
            customOption.dataset.value = option.value;
            
            customOption.addEventListener('click', function(e) {
                e.stopPropagation();
                select.value = this.dataset.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof select.onchange === 'function') {
                    select.onchange(new Event('change'));
                }
                
                trigger.querySelector('span').textContent = this.textContent;
                optionsWrapper.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                this.classList.add('selected');
                wrapper.classList.remove('open');
            });
            optionsWrapper.appendChild(customOption);
        });
        
        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            document.querySelectorAll('.custom-select-container').forEach(c => {
                if (c !== wrapper) c.classList.remove('open');
            });
            wrapper.classList.toggle('open');
        });
        
        wrapper.appendChild(trigger);
        wrapper.appendChild(optionsWrapper);
        select.parentNode.insertBefore(wrapper, select.nextSibling);
    });
    
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-container').forEach(c => {
            c.classList.remove('open');
        });
    });
});

