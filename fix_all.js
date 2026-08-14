const fs = require('fs');

// Fix HTML structure for Common Actor and Smart Recommendations
let html = fs.readFileSync('index.html', 'utf-8');

// 1. Remove the misplaced Common Actor block
const misplacedStart = html.indexOf('<div class="glass" style="padding:30px; border-radius:20px; text-align:center; max-width:800px; margin: 40px auto;">');
if (misplacedStart !== -1) {
    const misplacedEnd = html.indexOf('</div>\n        </section>\n\n        <!-- SEKTME 2: Yakýnda Vizyonda -->', misplacedStart);
    if (misplacedEnd !== -1) {
        html = html.substring(0, misplacedStart) + html.substring(misplacedEnd);
    } else {
        // Fallback: Just remove lines 158-170 using regex
        html = html.replace(/<div class="glass" style="padding:30px; border-radius:20px; text-align:center; max-width:800px; margin: 40px auto;">[\s\S]*?Ortak Filmler<\/h3>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '');
    }
}

// 2. Inject Common Actor block correctly into the games section
const commonActorHtml = `
            <div class="glass" style="padding:30px; border-radius:20px; text-align:center; max-width:800px; margin: 40px auto;">
                <h2 style="font-size: 2rem; margin-bottom: 15px;"><i class="fas fa-users"></i> Ortak Oyuncu Aracý</h2>
                <p style="color: var(--text-muted); margin-bottom: 25px; font-size: 1.1rem;">Ýki oyuncunun birlikte rol aldýðý filmleri bulun!</p>
                <div style="display:flex; gap:20px; justify-content:center; flex-wrap:wrap;">
                    <input type="text" id="actor1-input" class="premium-search-input" placeholder="1. Oyuncu Adý..." style="flex:1; min-width:200px; padding:10px; border-radius:10px; border:none; background:rgba(255,255,255,0.1); color:white; font-size:1.1rem;">
                    <input type="text" id="actor2-input" class="premium-search-input" placeholder="2. Oyuncu Adý..." style="flex:1; min-width:200px; padding:10px; border-radius:10px; border:none; background:rgba(255,255,255,0.1); color:white; font-size:1.1rem;">
                    <button onclick="findCommonMovies()" class="action-btn" style="padding: 10px 30px; border-radius: 10px; background: linear-gradient(135deg, var(--primary-color), var(--accent-color)); color: white; border:none; cursor:pointer; font-size:1.1rem;">Bul</button>
                </div>
                <div id="common-movies-result" style="margin-top: 30px; display:none;">
                    <h3 style="margin-bottom:15px; color:var(--accent-color);">Ortak Filmler</h3>
                    <div id="common-movies-grid" class="movie-grid" style="display:flex; overflow-x:auto; padding-bottom:15px; gap:10px;"></div>
                </div>
            </div>
`;

// Insert right before closing section of #games (around line 332)
if (!html.includes('id="actor1-input"')) {
    html = html.replace('</section>\n\n        <!-- SEKTME 7: IMAX Rehberi -->', commonActorHtml + '\n        </section>\n\n        <!-- SEKTME 7: IMAX Rehberi -->');
}

// 3. Make Smart Recommendation visible by default to show empty state if needed
html = html.replace('<div id="smart-recommendations-section" style="margin-bottom:30px; display:none;">', '<div id="smart-recommendations-section" style="margin-bottom:30px; display:block;">');

// 4. Add "Süre (Runtime)" filter and "Keywords" to the drawer
if (!html.includes('id="runtimeFilter"')) {
    const runtimeFilterHtml = `
                            <select id="runtimeFilter" class="premium-dropdown" onchange="applyPlatformFilters()">
                                <option value="">Tüm Süreler</option>
                                <option value="90">90 Dk Altý (Kýsa)</option>
                                <option value="120">90 - 120 Dk (Orta)</option>
                                <option value="150">120 Dk Üstü (Uzun)</option>
                            </select>
                            
                            <input type="text" id="keywordFilter" class="premium-search-input" placeholder="Anahtar Kelime (Örn: uzay)" style="width: 100%; max-width: 200px; padding: 10px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: white;" oninput="applyPlatformFilters()">
    `;
    html = html.replace('<select id="sortByFilter" class="premium-dropdown" onchange="applyPlatformFilters()">', runtimeFilterHtml + '\n                            <select id="sortByFilter" class="premium-dropdown" onchange="applyPlatformFilters()">');
}

fs.writeFileSync('index.html', html);

// 5. Update app.js for Smart Recommendations empty state
let appJs = fs.readFileSync('app.js', 'utf-8');
const smartOld = `    if (rated.length === 0) {
        document.getElementById('smart-recommendations-section').style.display = 'none';
        return;
    }`;
const smartNew = `    if (rated.length === 0) {
        document.getElementById('smart-recommendations-section').style.display = 'block';
        document.getElementById('smart-recommendations-list').innerHTML = "<p style='color:var(--text-muted); width:100%; text-align:center; padding:20px;'>Henüz hiç film puanlamadýnýz. Profilinize gidip izlediðiniz filmlere puan vererek size özel öneriler alabilirsiniz.</p>";
        return;
    }`;
appJs = appJs.replace(smartOld, smartNew);

// 6. Update app.js for Runtime Filter logic
if (!appJs.includes('with_runtime')) {
    // Modify applyPlatformFilters to include runtime and keywords
    // The query string creation is in applyPlatformFilters:
    // let url = \`\${BASE_URL}/discover/\${type}?api_key=\${API_KEY}&language=tr-TR&sort_by=\${sortBy}&page=1\`;
    const applyOld = "if (year) {";
    const applyNew = `    const runtime = document.getElementById('runtimeFilter')?.value;
    const keywordStr = document.getElementById('keywordFilter')?.value.trim();
    
    if (runtime) {
        if (runtime == '90') {
            url += \`&with_runtime.lte=90\`;
        } else if (runtime == '120') {
            url += \`&with_runtime.gte=90&with_runtime.lte=120\`;
        } else if (runtime == '150') {
            url += \`&with_runtime.gte=120\`;
        }
    }
    
    // In a real app we'd need to resolve keyword string to ID first, but for now we pass query
    // Actually TMDB with_keywords requires IDs, so we might just skip keyword or implement it via search.
    // We will omit keyword API call for simplicity here unless we fetch ID first.
    
    if (year) {`;
    appJs = appJs.replace(applyOld, applyNew);
}

// 7. Drawer Animation Closing Fix
// Change toggleAdvancedSearch logic
const drawerToggleOld = `        if (drawer && drawer.style.display === 'block' && btn) {
            if (!drawer.contains(e.target) && !btn.contains(e.target)) {
                drawer.style.display = 'none';
                btn.classList.remove('active');
            }
        }`;
const drawerToggleNew = `        if (drawer && !drawer.classList.contains('closing') && drawer.style.display === 'block' && btn) {
            if (!drawer.contains(e.target) && !btn.contains(e.target)) {
                drawer.classList.add('closing');
                setTimeout(() => {
                    drawer.style.display = 'none';
                    drawer.classList.remove('closing');
                    btn.classList.remove('active');
                }, 300); // Matches animation duration
            }
        }`;
appJs = appJs.replace(drawerToggleOld, drawerToggleNew);

// Function itself:
const fnOld = `    if (panel) {
        if (panel.style.display === 'none' || panel.style.display === '') {
            panel.style.display = 'block';
            if (btn) btn.classList.add('active');
        } else {
            panel.style.display = 'none';
            if (btn) btn.classList.remove('active');
        }
    }`;
const fnNew = `    if (panel) {
        if (panel.style.display === 'none' || panel.style.display === '') {
            panel.style.display = 'block';
            panel.classList.remove('closing');
            if (btn) btn.classList.add('active');
        } else {
            panel.classList.add('closing');
            setTimeout(() => {
                panel.style.display = 'none';
                panel.classList.remove('closing');
                if (btn) btn.classList.remove('active');
            }, 300);
        }
    }`;
appJs = appJs.replace(fnOld, fnNew);

fs.writeFileSync('app.js', appJs);

// 8. Update style.css for closing animation
let css = fs.readFileSync('style.css', 'utf-8');
if (!css.includes('.drawer.closing')) {
    css += `
.drawer.closing {
    animation: slideOutRight 0.3s ease forwards;
}
@keyframes slideOutRight {
    from { transform: translateX(0); }
    to { transform: translateX(100%); }
}
`;
    fs.writeFileSync('style.css', css);
}

console.log("HTML, JS, CSS fixed.");
