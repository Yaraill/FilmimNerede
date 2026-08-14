const fs = require('fs');

// 1. Fix CSS z-index for navbar
let css = fs.readFileSync('style.css', 'utf-8');
css = css.replace('.navbar {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    padding: 1.5rem 5%;\n    position: sticky;\n    top: 0;\n    z-index: 100;', 
'.navbar {\n    display: flex;\n    justify-content: space-between;\n    align-items: center;\n    padding: 1.5rem 5%;\n    position: sticky;\n    top: 0;\n    z-index: 2500;');

// Also fix autocomplete box z-index if it's too high
css = css.replace('.autocomplete-suggestions {\n    position: absolute;\n    top: 100%;\n    left: 0;\n    right: 0;\n    background: var(--glass-bg);\n    backdrop-filter: blur(10px);\n    -webkit-backdrop-filter: blur(10px);\n    border: 1px solid var(--glass-border);\n    border-radius: 0 0 25px 25px;\n    max-height: 400px;\n    overflow-y: auto;\n    z-index: 1000;\n    display: none;\n    box-shadow: 0 10px 30px rgba(0,0,0,0.5);',
'.autocomplete-suggestions {\n    position: absolute;\n    top: 100%;\n    left: 0;\n    right: 0;\n    background: var(--glass-bg);\n    backdrop-filter: blur(10px);\n    -webkit-backdrop-filter: blur(10px);\n    border: 1px solid var(--glass-border);\n    border-radius: 0 0 25px 25px;\n    max-height: 400px;\n    overflow-y: auto;\n    z-index: 999;\n    display: none;\n    box-shadow: 0 10px 30px rgba(0,0,0,0.5);');
fs.writeFileSync('style.css', css);

// 2. Add click outside to close drawer
let js = fs.readFileSync('app.js', 'utf-8');
if (!js.includes('if (!drawer.contains(e.target) && !btn.contains(e.target))')) {
    const listener = `
    // Close advanced search drawer when clicking outside
    document.addEventListener('click', (e) => {
        const drawer = document.getElementById('advanced-search-panel');
        const btn = document.getElementById('advanced-toggle-btn');
        if (drawer && drawer.style.display === 'block' && btn) {
            if (!drawer.contains(e.target) && !btn.contains(e.target)) {
                drawer.style.display = 'none';
                btn.classList.remove('active');
            }
        }
    });
    `;
    js = js.replace("document.addEventListener('click', (e) => {", listener + "\n    document.addEventListener('click', (e) => {");
    fs.writeFileSync('app.js', js);
}

console.log("Fixed CSS and added click outside listener.");
