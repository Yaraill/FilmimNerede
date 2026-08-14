async function fetchAndInjectProviders(itemId, mediaType, itemData = null, routeContext = null) {
    if (!mediaType || mediaType === "undefined") {
        if (itemData && (itemData.first_air_date || itemData.name)) {
            mediaType = "tv";
        } else {
            mediaType = "movie";
        }
    }
    try {
        const res = await fetch(`${BASE_URL}/${mediaType}/${itemId}/watch/providers?api_key=${API_KEY}`, { signal: routeContext?.signal });
        if (routeContext && !isRouteContextCurrent(routeContext, parseRoute().page)) return;
        const data = await res.json();
        const tr = data.results && data.results.TR ? data.results.TR : null;
        
        const els = document.querySelectorAll(`.providers-${itemId}`);
        if (els.length === 0) return;

        const filterProvId = parseInt(document.getElementById('providerFilter')?.value || "0");
        let hasProv = false;

        if (tr && tr.flatrate) {
            hasProv = filterProvId === 0 || tr.flatrate.some(p => p.provider_id === filterProvId);
            
            if (hasProv) {
                let html = "";
                tr.flatrate.slice(0,3).forEach(p => {
                    html += `<img src="${IMAGE_BASE}${p.logo_path}" alt="${p.provider_name}" class="provider-logo" title="${p.provider_name}" loading="lazy">`;
                });
                els.forEach(el => el.innerHTML = html);
            }
        } else {
            hasProv = filterProvId === 0;
            if (hasProv) {
                els.forEach(el => el.innerHTML = "<span class='no-provider'>Türkiye'de yayını yok</span>");
            }
        }
        
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error("Provider bilgisi alınamadı", err);
        const els = document.querySelectorAll(`.providers-${itemId}`);
        els.forEach(el => el.innerHTML = "<span class='no-provider'>Platform bilgisi alınamadı</span>");
    }
}