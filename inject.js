const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf-8');
const searchStr = '            </div>\r\n        </section>';
const searchStr2 = '            </div>\n        </section>';
const replacement = `            </div>
            
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
        </section>`;
if (html.includes(searchStr)) {
    html = html.replace(searchStr, replacement);
} else if (html.includes(searchStr2)) {
    html = html.replace(searchStr2, replacement);
} else {
    // Just inject before Sektme 7
    html = html.replace('<!-- SEKTME 7: IMAX Rehberi -->', replacement.replace('            </div>\n', '') + '\n\n        <!-- SEKTME 7: IMAX Rehberi -->');
}
fs.writeFileSync('index.html', html);
console.log("Injected");
