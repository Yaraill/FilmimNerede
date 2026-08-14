const fs = require('fs');
const code = fs.readFileSync('app.js', 'utf-8');

// A very naive but effective way to split app.js for Vanilla JS:
// We just split by the comment headers that already exist.
const parts = code.split('// =========================================');

let apiCode = "";
let uiCode = "";
let stateCode = "";
let mainCode = "";
let gameCode = "";

parts.forEach(part => {
    if (part.includes('API Ayarlarý') || part.includes('let genreMap')) {
        stateCode += part + '\n';
    } else if (part.includes('loadNowPlaying()') || part.includes('loadUpcomingMovies') || part.includes('fetchAPI')) {
        apiCode += part + '\n';
    } else if (part.includes('createMovieCard') || part.includes('toggleTheme')) {
        uiCode += part + '\n';
    } else {
        mainCode += part + '\n';
    }
});

fs.mkdirSync('js', { recursive: true });
fs.writeFileSync('js/state.js', stateCode);
fs.writeFileSync('js/api.js', apiCode);
fs.writeFileSync('js/ui.js', uiCode);
fs.writeFileSync('js/main.js', mainCode);
console.log("Files generated");
