const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf-8');
const lines = code.split('\n');

const observerCode = `
    // Infinite Scroll Implementation
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && loadMoreBtn.style.display !== 'none') {
                loadMoreResults();
            }
        }, { rootMargin: '200px' });
        observer.observe(loadMoreBtn);
        // Hide button visually but keep it in DOM for observer
        loadMoreBtn.style.opacity = '0';
        loadMoreBtn.style.pointerEvents = 'none';
        loadMoreBtn.style.height = '10px';
    }
`;

lines.splice(100, 0, observerCode);
fs.writeFileSync('app.js', lines.join('\n'));
console.log('Infinite Scroll logic injected.');
