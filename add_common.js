const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf-8');
const target = '<div id="game-result-container"';
const injection = `
            <div class="glass" style="padding:30px; border-radius:20px; text-align:center; max-width:800px; margin: 40px auto;">
                <h2 style="font-size: 2rem; margin-bottom: 15px;"><i class="fas fa-users"></i> Ortak Oyuncu Aracý</h2>
                <p style="color: #ccc; margin-bottom: 25px; font-size: 1.1rem;">Ýki oyuncunun birlikte rol aldýðý filmleri bulun!</p>
                <div style="display:flex; gap:20px; justify-content:center; flex-wrap:wrap;">
                    <input type="text" id="actor1-input" class="premium-search-input" placeholder="1. Oyuncu Adý..." style="flex:1; min-width:200px;">
                    <input type="text" id="actor2-input" class="premium-search-input" placeholder="2. Oyuncu Adý..." style="flex:1; min-width:200px;">
                    <button onclick="findCommonMovies()" class="action-btn" style="padding: 15px 30px; border-radius: 30px; background: linear-gradient(135deg, var(--primary-color), var(--accent-color)); color: white;">Bul</button>
                </div>
                <div id="common-movies-result" style="margin-top: 30px; display:none;">
                    <h3 style="margin-bottom:15px; color:var(--accent-color);">Ortak Filmler</h3>
                    <div id="common-movies-grid" class="movie-grid" style="display:flex; overflow-x:auto; padding-bottom:15px; gap:10px;"></div>
                </div>
            </div>
`;
if (!html.includes('id="actor1-input"')) {
    html = html.replace(target, injection + '\n            ' + target);
    fs.writeFileSync('index.html', html);
}

let js = fs.readFileSync('app.js', 'utf-8');
if (!js.includes('findCommonMovies')) {
    const logic = `
// =========================================
// ORTAK OYUNCU ARACI
// =========================================
async function findCommonMovies() {
    const actor1 = document.getElementById('actor1-input').value.trim();
    const actor2 = document.getElementById('actor2-input').value.trim();
    if (!actor1 || !actor2) {
        alert("Lütfen iki oyuncu adý da giriniz.");
        return;
    }
    
    document.getElementById('common-movies-result').style.display = 'block';
    showSkeletons('common-movies-grid', 5);
    
    try {
        // Find actor 1 ID
        let res1 = await fetch(\`\${BASE_URL}/search/person?api_key=\${API_KEY}&query=\${encodeURIComponent(actor1)}\`);
        let data1 = await res1.json();
        if (data1.results.length === 0) throw new Error(actor1 + " bulunamadý");
        let id1 = data1.results[0].id;
        
        // Find actor 2 ID
        let res2 = await fetch(\`\${BASE_URL}/search/person?api_key=\${API_KEY}&query=\${encodeURIComponent(actor2)}\`);
        let data2 = await res2.json();
        if (data2.results.length === 0) throw new Error(actor2 + " bulunamadý");
        let id2 = data2.results[0].id;
        
        // Discover movies with both
        let res3 = await fetch(\`\${BASE_URL}/discover/movie?api_key=\${API_KEY}&with_people=\${id1},\${id2}&sort_by=popularity.desc\`);
        let data3 = await res3.json();
        
        let html = '';
        if (data3.results.length === 0) {
            html = "<p>Ortak film bulunamadý.</p>";
        } else {
            data3.results.forEach(item => {
                html += createMovieCard(item, 'movie', 'common');
            });
        }
        document.getElementById('common-movies-grid').innerHTML = html;
        makeScrollable(document.getElementById('common-movies-grid'));
        
    } catch(e) {
        document.getElementById('common-movies-grid').innerHTML = "<p style='color:red;'>Hata: " + e.message + "</p>";
    }
}
`;
    js += '\n' + logic;
    fs.writeFileSync('app.js', js);
}

console.log("Common Actor Tool added.");
