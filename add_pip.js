const fs = require('fs');

// 1. Update index.html to add PiP button
let html = fs.readFileSync('index.html', 'utf-8');
if (!html.includes('togglePiP')) {
    html = html.replace('<span class="close-btn" onclick="closeTrailer(null, true)">&times;</span>',
        '<span class="close-btn" onclick="closeTrailer(null, true)" title="Kapat">&times;</span>\n        <span class="pip-btn" onclick="togglePiP(event)" title="Yüzen Oynatýcý (PiP)" style="position:absolute; top:-38px; right: 40px; color:white; font-size: 24px; cursor: pointer; transition: color 0.2s;"><i class="fas fa-compress-alt"></i></span>');
    fs.writeFileSync('index.html', html);
}

// 2. Update style.css to add PiP classes
let css = fs.readFileSync('style.css', 'utf-8');
if (!css.includes('.pip-mode')) {
    const pipCss = `
/* Yüzen Oynatýcý (PiP) Mode */
.modal.pip-mode {
    background-color: transparent;
    pointer-events: none; /* Let clicks pass through overlay */
    align-items: flex-end;
    justify-content: flex-end;
    padding: 20px;
    z-index: 9999;
}
.modal.pip-mode .modal-content {
    width: 350px;
    max-width: 100%;
    pointer-events: auto; /* Enable clicks on the video */
    animation: slideInBottomRight 0.3s ease;
    box-shadow: 0 10px 30px rgba(0,0,0,0.8);
    border-radius: 12px;
}
.modal.pip-mode .close-btn {
    top: -30px;
    right: 0px;
    font-size: 28px;
    text-shadow: 0 2px 4px rgba(0,0,0,0.8);
}
.modal.pip-mode .pip-btn i:before {
    content: "\\f065"; /* fa-expand-alt */
}
@keyframes slideInBottomRight {
    from { transform: translateY(100px) scale(0.8); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
}
`;
    css += '\n' + pipCss;
    fs.writeFileSync('style.css', css);
}

// 3. Update js/ui.js to add togglePiP function
let uiJs = fs.readFileSync('js/ui.js', 'utf-8');
if (!uiJs.includes('togglePiP')) {
    const pipJs = `
function togglePiP(e) {
    if (e) e.stopPropagation();
    const modal = document.getElementById('trailer-modal');
    modal.classList.toggle('pip-mode');
    
    // Enable background scrolling when in PiP mode
    if (modal.classList.contains('pip-mode')) {
        document.body.style.overflow = 'auto';
    } else {
        document.body.style.overflow = 'hidden';
    }
}
window.togglePiP = togglePiP;
`;
    uiJs += '\n' + pipJs;
    fs.writeFileSync('js/ui.js', uiJs);
}

console.log("PiP added.");
