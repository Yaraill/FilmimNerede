const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf-8');
code = code.replace(/<img(.*?)(src=.*?)(>)/gi, (match, p1, p2, p3) => {
    if (match.includes('loading=')) return match;
    return `<img${p1}${p2} loading="lazy"${p3}`;
});
fs.writeFileSync('app.js', code);
console.log('Lazy loading added to app.js');
