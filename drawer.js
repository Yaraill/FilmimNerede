const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf-8');

// The original filter controls
const filterControlsRegex = /<div class="filter-controls glass"[\s\S]*?<\/div>\s*<\/div>/;
const match = html.match(filterControlsRegex);

if (match) {
    const originalFilters = match[0];
    const newFilters = originalFilters.replace('<div class="filter-controls glass"', '<div id="advanced-search-panel" class="drawer" style="display:none;"');
    
    // Create the button to toggle it
    const toggleBtnHtml = `
    <div class="filter-toggle-container glass" style="flex: 1; min-width: 300px; display: flex; align-items: center; justify-content: center; padding: 20px; border-radius: 20px;">
        <button id="advanced-toggle-btn" onclick="toggleAdvancedSearch()" class="action-btn" style="padding: 15px 30px; font-size: 1.2rem; border-radius: 30px; background: linear-gradient(135deg, var(--primary-color), var(--accent-color)); color: white; box-shadow: 0 5px 15px rgba(229,9,20,0.4);"><i class="fas fa-sliders-h"></i> Geliþmiþ Filtreler</button>
        <div class="view-mode-controls" style="display: flex; gap: 5px; margin-left: 20px;">
            <button onclick="switchViewMode('grid')" id="viewGridBtn" class="action-btn active" style="padding: 8px 15px; border-radius: 20px; background: rgba(0,0,0,0.5); color: white;"><i class="fas fa-th"></i></button>
            <button onclick="switchViewMode('list')" id="viewListBtn" class="action-btn" style="padding: 8px 15px; border-radius: 20px; background: rgba(0,0,0,0.5); color: white;"><i class="fas fa-list"></i></button>
        </div>
    </div>
    `;
    
    // Extract the view controls from newFilters because we moved them to the toggle button area
    let cleanDrawerFilters = newFilters.replace(/<div class="view-mode-controls"[\s\S]*?<\/div>/, '');
    
    // Replace the original with the toggle button
    html = html.replace(originalFilters, toggleBtnHtml);
    
    // Add the drawer to the end of the body
    html = html.replace('</body>', cleanDrawerFilters + '\n</body>');
    fs.writeFileSync('index.html', html);
    console.log("Drawer HTML added.");
}

let css = fs.readFileSync('style.css', 'utf-8');
if (!css.includes('.drawer {')) {
    const drawerCss = `
/* Geliþmiþ Filtreler Drawer */
.drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: 350px;
    height: 100vh;
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(20px);
    border-left: 1px solid rgba(255,255,255,0.1);
    z-index: 4000;
    padding: 30px 20px;
    box-shadow: -10px 0 30px rgba(0,0,0,0.5);
    overflow-y: auto;
    animation: slideInRight 0.3s ease;
}
.light-theme .drawer {
    background: rgba(255, 255, 255, 0.95);
    border-left: 1px solid rgba(0,0,0,0.1);
}
@keyframes slideInRight {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
}
`;
    css += '\n' + drawerCss;
    fs.writeFileSync('style.css', css);
}

// In app.js, make sure toggleAdvancedSearch handles the new drawer
let js = fs.readFileSync('app.js', 'utf-8');
if (js.includes('function toggleAdvancedSearch() {')) {
    // Modify toggleAdvancedSearch to just toggle the class or display, and add close button inside drawer if missing
    // Actually the existing function sets display: 'none' and 'block'.
    console.log("JS function exists.");
}

