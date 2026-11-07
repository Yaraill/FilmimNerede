# FilmimNerede — Proje Kuralları ve Mimari Rehberi (GEMINI.md)

Bu dosya, **FilmimNerede** projesi üzerinde çalışan yapay zeka ajanları için mimari yapıyı, kodlama standartlarını, veri bütünlüğü kurallarını ve dağıtım sınırlarını tanımlar.

---

## 1. Mimari ve Aktif Dosya Yapısı

Proje, Vanilla JavaScript (ES6+), HTML5, CSS3 ve Netlify Functions (`omdb.js`) üzerinde çalışan bir Progressive Web App (PWA) uygulamasıdır.

### Aktif Çalışma Zamanı (Runtime) Dosyaları
- `index.html` — Ana uygulama kabuğu, sekme görünümleri ve modallar.
- `style.css` — Koyu (varsayılan) ve açık (`body.light-theme`) tema değişkenleri, bileşen stilleri ve responsive (`@media`) kuralları.
- `js/runtime/config.js` — Sabitler, API URL'leri, platform kimlikleri (`MAJOR_PLATFORMS`) ve IMAX verileri.
- `js/runtime/security.js` — XSS koruma yardımcıları (`escapeHtml`, `escapeAttr`, `sanitizeExternalUrl`), medya anahtarı yardımcıları (`inferItemMediaType`, `getMediaKey`, `getCachedMedia`, `setCachedMedia`) ve güvenli depolama sarmalayıcıları (`safeReadStorage`, `safeWriteStorage`).
- `js/runtime/state.js` — Global uygulama durumu (`movieCache`, `watchlist`, `ratedMovies`, `recentlyViewed`, filtre durumları).
- `js/runtime/router.js` — Hash tabanlı SPA yönlendiricisi (`#home`, `#upcoming`, `#platforms`, `#profile`, `#games`, `#imax`, `#movie/:id/:type`, `#actor/:id`).
- `js/runtime/shared-ui.js` — Film/dizi kartı üretimi (`createMovieCard`), hover slayt gösterisi, iskelet yükleyiciler ve mobil menü erişilebilirlik senkronizasyonu (`syncMobileMenuA11y`).
- `js/runtime/providers.js` — TMDB `watch/providers` (`TR` bölgesi) sorgulama, istek tekilleştirme ve kart rozeti enjeksiyonu (`flatrate`, `free`/`ads`, `rent`/`buy`).
- `js/runtime/platform.js` — "Nerede İzlerim?" sekmesi keşif, filtreleme, sıralama ve sayfalama mantığı.
- `js/runtime/search.js` — Çoklu arama (`search/multi`), yerel filtreleme ve otomatik tamamlama (`autocomplete`).
- `js/runtime/movie.js` — Film/dizi detay modalı (`openDetails`, `renderMovie`), OMDb puan entegrasyonu ve paylaşım bağlantıları.
- `js/runtime/actor.js` — Oyuncu detay görünümü, filmografi filtreleri ve "Ortak Yapımlar" (`findCommonMovies`) aracı.
- `js/runtime/home.js` — Vizyondakiler, Yakında, Özel Koleksiyonlar, Gündemdeki İsimler ve Akıllı Öneriler (`loadSmartRecommendations`).
- `js/runtime/profile.js` — İzleme listesi, kullanıcı puanları, son incelenenler, profil istatistikleri, tam izleme süresi hesabı ve JSON yedekleme/geri yükleme.
- `js/runtime/misc.js` — Afiş tahmin oyunu (`startNewGame`), rastgele film seçici, yatay sürükleme (`makeScrollable`) ve yardımcı etkileşimler.
- `app.js` — Başlangıç yükleyicisi (`DOMContentLoaded`), tema geçişi ve global olay dinleyicileri.
- `service-worker.js` — Çevrimdışı önbellekleme (`CACHE_NAME` ve `ASSETS_TO_CACHE`).
- `netlify/functions/omdb.js` & `netlify.toml` — OMDb sunucusuz proxy fonksiyonu ve HTTP güvenlik başlıkları.

### Atıl (Legacy) Dosyalar — DOKUNULMAMALI
- `js/api.js`, `js/main.js`, `js/state.js`, `js/ui.js` dosyaları eski mimariden kalmadır ve `index.html` içinde **kullanılmamaktadır**.
- `tests/static-smoke.js` bu dosyaların `index.html` içinde referans edilmediğini doğrular. Değişiklikleri her zaman `js/runtime/*.js` altında yapın.

---

## 2. Veri Bütünlüğü ve Medya Anahtarı Kuralları

1. **Bileşik Anahtar (`${mediaType}:${id}`) Zorunluluğu:**
   - TMDB üzerinde bir film (`movie`) ve bir dizi (`tv`) aynı sayısal `id` değerine sahip olabilir.
   - Önbellek (`movieCache`), izleme listesi (`watchlist`), puanlananlar (`ratedMovies`) ve son incelenenler (`recentlyViewed`) işlemlerinde her zaman `getMediaKey(id, mediaType)`, `getCachedMedia(id, mediaType)` ve `setCachedMedia(item, fallbackType)` yardımcılarını kullanın.
   - Kart üstü platform konteynerlerinde `.providers-${mediaType}-${id}` sınıfını koruyun.
2. **Türkiye (`TR`) Bölge Standardı:**
   - Tüm dijital platform sorgularında (`watch_region` ve `watch/providers` sonuçları) `TR` bölgesi baz alınır; herhangi bir platform için `US` istisnası eklemeyin.
3. **Güvenli Depolama (`localStorage` / `sessionStorage`):**
   - Doğrudan `localStorage.setItem` yerine kota aşımı ve gizli sekme hatalarını yakalayan `safeReadStorage` / `safeWriteStorage` fonksiyonlarını tercih edin.

---

## 3. UI, Tema ve Responsive Tasarım Kuralları

1. **Inline Layout Stillerinden Kaçının:**
   - `index.html` içinde ızgara (`grid-template-columns: repeat(7, 1fr)` vb.) veya esnek kutu (`display: flex`) yerleşimlerini inline `style="..."` ile **sabitlemeyin**. Inline stiller `style.css` içindeki `@media (max-width: 768px)` kurallarını ezerek mobil görünümü bozar.
2. **Açık ve Koyu Tema Uyumluluğu (`body.light-theme`):**
   - Renk, arka plan ve kenarlık tanımlarken sabit `white` / `rgba(255,255,255,...)` inline değerleri yerine CSS değişkenlerini (`var(--bg-color)`, `var(--text-color)`, `var(--card-bg)`, `var(--nav-bg)`, `var(--border-color)`) kullanın.
   - JavaScript içinde `navbar.style.background = ...` gibi temayı ezen inline stiller atamak yerine CSS sınıfları (`.scrolled` vb.) kullanın.
3. **Erişilebilirlik (A11y):**
   - İkon butonlarında `aria-label` tanımlayın ve dekoratif FontAwesome ikonlarına `aria-hidden="true"` ekleyin (ekran okuyuculara ham Unicode sızmasını önleyin).

---

## 4. Güvenlik, Test ve Dağıtım Kuralları

1. **XSS Koruması:**
   - `innerHTML` içine yerleştirilen tüm dinamik metinlerde `escapeHtml()`, özniteliklerde `escapeAttr()` ve dış bağlantılarda `sanitizeExternalUrl()` kullanın.
2. **Service Worker Senkronizasyonu:**
   - `index.html` içindeki `<script src="js/runtime/...?v=X">` sürüm parametreleri ile `service-worker.js` içindeki `ASSETS_TO_CACHE` listesi birebir aynı olmalıdır (`node tests/static-smoke.js` bunu denetler).
3. **Doğrulama ve Dağıtım:**
   - Her kod değişikliğinden sonra en az `node tests/static-smoke.js` ve ilgili regresyon testlerini (`tests/*.js`) çalıştırın.
   - Kullanıcı açıkça istemeden **Netlify'a otomatik deploy yapmayın**; önce yerel test onayı alın.
