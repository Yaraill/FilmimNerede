const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf-8');
const regex = /<input type="text" id="keywordFilter"[\s\S]*?oninput="applyPlatformFilters\(\)">/g;
html = html.replace(regex, '');
fs.writeFileSync('index.html', html);
console.log("Keyword filter removed.");
