# FilmimNerede (FilmRehberi)

Turkish movie/TV guide PWA: where to watch in Turkey (TMDB TR providers), details, actors, watchlist, games.

## Stack
- Vanilla JS (ES6+, classic `<script>` globals, no modules/bundler/framework), HTML5, CSS3
- TMDB API (direct, key in `js/runtime/config.js`) + Netlify Functions proxies: `omdb.js`, `tmdb.js`
- Hosting: Netlify (`publish = "."`), PWA via `service-worker.js`
- Dev only: Node 22, puppeteer + jsdom for tests. No lint, no type-check, no build step.

## Commands
- Run: serve the root statically (e.g. `npx netlify dev` for functions too)
- Test all: `npm test` (same as CI, `.github/workflows/ci.yml`)
- Fast check: `npm run test:static`; then the relevant `npm run test:<area>`
- Tests start their own local server; no manual server needed.

## Structure
- `index.html` — app shell, all views/modals; loads scripts in fixed order (config → security → state → router → shared-ui → … → app.js)
- `js/runtime/*.js` — all app logic, one file per area (home, movie, actor, platform, search, profile, providers, misc)
- `js/runtime/security.js` — escaping, media-key/cache/storage helpers, TMDB proxy fallback (patches global `fetch`)
- `app.js` — bootstrap, theme, global listeners; `style.css` — all styles, dark default + `body.light-theme`
- `netlify/functions/` — serverless proxies; `tests/*-regression.js` — one script per area
- Full architecture + rules: `GEMINI.md` (Turkish)

## Conventions
- Everything is global: script order in `index.html` matters; check for name collisions before adding a top-level function.
- Always use composite keys `${mediaType}:${id}` via `getMediaKey` / `getCachedMedia` / `setCachedMedia` (movie and tv ids collide).
- Provider queries use region `TR` only; never add a `US` exception.
- Dynamic HTML: `escapeHtml()` text, `escapeAttr()` attributes, `sanitizeExternalUrl()`/`getSafeHttpUrl()` links.
- Storage via `safeReadStorage` / `safeWriteStorage`, not raw `localStorage`.
- Colors via CSS vars (`--bg-color`, `--text-color`, `--card-bg`, `--border-color`…); no inline layout styles in HTML (breaks `@media` rules); toggle classes, not `el.style`.
- Icon buttons need `aria-label`; decorative icons `aria-hidden="true"`.

## Release sync
- Changing a runtime JS file: bump its `?v=N` in `index.html` AND the same entry in `ASSETS_TO_CACHE` (static-smoke enforces), and bump `CACHE_NAME` (`filmimnerede-vNN`) in `service-worker.js` so clients update.

## Workflow
- After code changes, run the verify skill before saying done.
- Build or test failures: delegate to the build-error-resolver agent.
- Unsure about a library API: ask the docs-lookup agent first.
- Before committing a feature: run the code-reviewer agent.
- Commit messages: conventional style with version tag, e.g. `fix(runtime): ... (v99)`.
- Reply in Turkish.

## Don't
- Don't deploy to Netlify unless explicitly asked.
- Don't add frameworks, bundlers or npm runtime deps.
- Don't edit `node_modules/` or commit `FilmimNerede_Hatalar.txt` / `PROJE_ANALIZ_RAPORU.md` without asking.
