const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf-8');

// Find the erroneous <!DOCTYPE html> inside <main>
const badIdx = html.indexOf('<!DOCTYPE html>', 10); // Start searching after the real doctype
if (badIdx !== -1) {
    // Find the end of the duplicate header section which is right before <div id="smart-recommendations-section"
    const endIdx = html.indexOf('<div id="smart-recommendations-section"', badIdx);
    if (endIdx !== -1) {
        html = html.substring(0, badIdx) + html.substring(endIdx);
    }
}

// Fix corrupted characters
html = html.replace(/Puanlad.klar.n.za G.re Sizin ..in .neriler/g, 'Puanladýklarýnýza Göre Sizin Ýçin Öneriler');
html = html.replace(/T.m S.reler/g, 'Tüm Süreler');
html = html.replace(/Dk Alt. \(K.sa\)/g, 'Dk Altý (Kýsa)');
html = html.replace(/Dk .st. \(Uzun\)/g, 'Dk Üstü (Uzun)');

fs.writeFileSync('index.html', html);
console.log("Fixed HTML corruption and encoding");
