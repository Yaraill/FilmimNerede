/**
 * watchlist-tracker.js
 *
 * Sayfa acildiginda (SPA oldugu icin sadece ilk yuklemede bir kere) kullanicinin
 * watchlist'indeki (localStorage) her film/dizi icin TMDB'den TR yayin durumunu
 * paralel olarak ceker, bir onceki durumla karsilastirir. Yeni bir platformda
 * yayina girmisse ust kisimda bir banner gosterir.
 *
 * Performans: istekler BATCH_SIZE kadar grup halinde paralel atilir, boylece
 * watchlist buyuse bile (50+ film) TMDB'yi tek seferde onlarca istekle
 * bogmadan, hizli sekilde tamamlanir.
 *
 * Bagimliliklar: BASE_URL, API_KEY (config.js icinde tanimli, bu script ondan
 * sonra yuklenmeli).
 */

const WATCHLIST_SEEN_KEY = "watchlist_seen_providers";
const BATCH_SIZE = 8; // ayni anda en fazla kac TMDB istegi atilacak

async function fetchProvidersFor(item) {
    const mediaType = item.media_type || (item.first_air_date ? "tv" : "movie");
    try {
        const res = await fetch(
            `${BASE_URL}/${mediaType}/${item.id}/watch/providers?api_key=${API_KEY}`
        );
        const data = await res.json();
        const tr = data.results && data.results.TR ? data.results.TR : null;
        const currentProviders = tr && tr.flatrate ? tr.flatrate.map((p) => p.provider_name) : [];
        return { id: item.id, title: item.title || item.name, currentProviders, ok: true };
    } catch (err) {
        console.warn("Yayin durumu kontrol edilemedi:", item.id, err);
        return { id: item.id, ok: false };
    }
}

async function checkWatchlistAvailability() {
    const watchlist = JSON.parse(localStorage.getItem("watchlist") || "[]");
    if (watchlist.length === 0) return;

    const seen = JSON.parse(localStorage.getItem(WATCHLIST_SEEN_KEY) || "{}");
    const newlyAvailable = [];

    for (let i = 0; i < watchlist.length; i += BATCH_SIZE) {
        const batch = watchlist.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(batch.map(fetchProvidersFor));

        results.forEach((result) => {
            if (!result.ok) return;

            const hasPreviousRecord = Object.prototype.hasOwnProperty.call(seen, result.id);
            const previousProviders = seen[result.id] || [];
            const newOnes = result.currentProviders.filter((p) => !previousProviders.includes(p));

            // hasPreviousRecord kontrolu: filmi ilk kez kontrol ediyorsak
            // (daha once hic veri yoktu) spam bildirim atmasin, sadece
            // GERCEK bir degisiklikte haber versin.
            if (newOnes.length > 0 && hasPreviousRecord) {
                newlyAvailable.push({ title: result.title, providers: newOnes });
            }

            seen[result.id] = result.currentProviders;
        });
    }

    localStorage.setItem(WATCHLIST_SEEN_KEY, JSON.stringify(seen));

    if (newlyAvailable.length > 0) {
        showWatchlistBanner(newlyAvailable);
    }
}

function showWatchlistBanner(items) {
    const banner = document.createElement("div");
    banner.className = "availability-banner";

    const list = items
        .map(
            (i) =>
                `<p><strong>${i.title}</strong> artik <strong>${i.providers.join(", ")}</strong> uzerinde yayinda!</p>`
        )
        .join("");

    banner.innerHTML = `
        <div class="availability-banner-inner">
            ${list}
            <button class="availability-banner-close" aria-label="Kapat">&times;</button>
        </div>
    `;

    banner.querySelector(".availability-banner-close").addEventListener("click", () => {
        banner.remove();
    });

    document.body.prepend(banner);
}

document.addEventListener("DOMContentLoaded", checkWatchlistAvailability);
