const fs = require('fs');

// 1. HTML: Add container for Smart Recommendations in now-playing tab
let html = fs.readFileSync('index.html', 'utf-8');
if (!html.includes('id="smart-recommendations-section"')) {
    const target = '<div id="collections-section" style="margin-bottom:30px;">';
    const injection = `
            <div id="smart-recommendations-section" style="margin-bottom:30px; display:none;">
                <div class="section-header"><h2>Puanladýklarýnýza Göre Sizin Ýçin Öneriler</h2></div>
                <div id="smart-recommendations-list" class="movie-grid" style="display:flex; overflow-x:auto; padding-bottom:20px; gap:15px;"></div>
            </div>
`;
    html = html.replace(target, injection + target);
    fs.writeFileSync('index.html', html);
}

// 2. JS: Add the logic to app.js
let js = fs.readFileSync('app.js', 'utf-8');
if (!js.includes('loadSmartRecommendations')) {
    const logic = `
// =========================================
// AKILLI ÖNERÝ ALGORÝTMASI (Puanlananlara Göre)
// =========================================
async function loadSmartRecommendations() {
    let rated = JSON.parse(localStorage.getItem('rated_movies')) || [];
    if (rated.length === 0) {
        document.getElementById('smart-recommendations-section').style.display = 'none';
        return;
    }
    
    // Count genres
    let genreCounts = {};
    rated.forEach(movie => {
        if (movie.genre_ids) {
            movie.genre_ids.forEach(id => {
                genreCounts[id] = (genreCounts[id] || 0) + 1;
            });
        }
    });
    
    // Get top genre
    let topGenreId = Object.keys(genreCounts).sort((a,b) => genreCounts[b] - genreCounts[a])[0];
    if (!topGenreId) return;
    
    document.getElementById('smart-recommendations-section').style.display = 'block';
    showSkeletons('smart-recommendations-list', 10);
    
    try {
        const res = await fetch(\`\${BASE_URL}/discover/movie?api_key=\${API_KEY}&language=tr-TR&with_genres=\${topGenreId}&sort_by=popularity.desc\`);
        const data = await res.json();
        
        let html = '';
        data.results.slice(0, 10).forEach(item => {
            html += createMovieCard(item, 'movie', 'smart');
        });
        document.getElementById('smart-recommendations-list').innerHTML = html;
        makeScrollable(document.getElementById('smart-recommendations-list'));
    } catch(e) {
        console.error("Smart Recommendation error", e);
    }
}
`;
    js += '\n' + logic;
    
    // Inject call to loadSmartRecommendations() into DOMContentLoaded
    // Since DOMContentLoaded is at the top, we just replace `renderRecentlyViewed();` with `renderRecentlyViewed(); loadSmartRecommendations();`
    js = js.replace('renderRecentlyViewed();', 'renderRecentlyViewed();\n    loadSmartRecommendations();');
    
    fs.writeFileSync('app.js', js);
}
console.log("Smart Recommendations added.");
