const fs = require('fs');
let appJs = fs.readFileSync('app.js', 'utf-8');

// Fix localStorage key
appJs = appJs.replace(/localStorage\.getItem\('rated_movies'\)/g, "localStorage.getItem('ratedMovies')");

// Fix encoding for the message
appJs = appJs.replace(/Hen.z hi. film puanlamad.n.z. Profilinize gidip izledi.iniz filmlere puan vererek size .zel .neriler alabilirsiniz./g, "Henüz hiç film puanlamadýnýz. Profilinize gidip izlediðiniz filmlere puan vererek size özel öneriler alabilirsiniz.");

// Add a check to fix the drawer animation: "butona týklayýnca pat diye kapanýyor hala"
// Let's modify toggleAdvancedSearch to use the closing animation
appJs = appJs.replace(
`    if (panel) {
        if (panel.style.display === 'none' || panel.style.display === '') {
            panel.style.display = 'block';
            panel.classList.remove('closing');
            if (btn) btn.classList.add('active');
        } else {
            panel.classList.add('closing');
            setTimeout(() => {
                panel.style.display = 'none';
                panel.classList.remove('closing');
                if (btn) btn.classList.remove('active');
            }, 300);
        }
    }`,
`    if (panel) {
        if (panel.style.display === 'none' || panel.style.display === '') {
            panel.style.display = 'block';
            panel.classList.remove('closing');
            if (btn) btn.classList.add('active');
        } else if (!panel.classList.contains('closing')) {
            panel.classList.add('closing');
            setTimeout(() => {
                panel.style.display = 'none';
                panel.classList.remove('closing');
                if (btn) btn.classList.remove('active');
            }, 300);
        }
    }`);

fs.writeFileSync('app.js', appJs);
console.log("Fixed app.js");
