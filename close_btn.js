const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf-8');
if (!html.includes('onclick="toggleAdvancedSearch()" class="close-btn"')) {
    html = html.replace('<div id="advanced-search-panel" class="drawer" style="display:none;">',
        '<div id="advanced-search-panel" class="drawer" style="display:none;">\n    <span class="close-btn" onclick="toggleAdvancedSearch()" style="top:10px; right:20px; z-index:100; color:var(--text-color);">&times;</span>');
    fs.writeFileSync('index.html', html);
}
