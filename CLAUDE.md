# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the site-identity and content rules and takes precedence. This
file covers commands and the cross-file architecture.

## Commands

```bash
bundle install && npm ci          # setup
bundle exec jekyll serve          # http://localhost:4000/
```

Full validation (same order CI uses):

```bash
python3 scripts/validate_content.py     # source contracts; needs PyYAML
npm run lint:prettier                   # enforced in CI
bundle exec jekyll build
python3 scripts/check_built_site.py _site
```

Tests are independent Node scripts, each run on its own — there is no runner and
no watch mode. `npm run` with the script name is how you run "a single test":

```bash
npm run test:spark-writer        # node test/spark_writer.mjs
node test/inline_editor.mjs      # equivalent, and how to run any one directly
```

CI (`.github/workflows/deploy.yml`) runs only `validate_content.py`,
`lint:prettier`, `test:github-auth-vault`, `test:dialog-interactions`,
`test:search-access`, the build, and `check_built_site.py`. Every other
`test:*` script is manual — run the ones covering what you touched.
`npm run test:visual` is currently dead: `test/visual/` does not exist.

## Validation is a contract system, not just a linter

This is the most important thing to know before editing anything under
`assets/js/`, `assets/css/`, `_includes/`, `deploy/`, or `_config.yml`.

`scripts/validate_content.py` asserts that **exact string literals** are present
(and sometimes absent) in specific files: API call shapes in
`inline-editor.js`, `content-creator.js`, `spark-writer.js`,
`spark-vault-client.js`, `site-settings.js`, `github-auth-vault.js`,
`deployment-monitor.js`, `spark-vault/worker.mjs`, nginx config, Liquid
includes, and SHA-256 hashes of brand image assets. `test/style_contract.js`
does the same for CSS (`max-width` values, `::backdrop` rules, media queries).

Consequences:

- Renaming a variable, changing `method: "PUT"`, or reformatting a fetch call
  fails CI even when behavior is unchanged.
- Some checks are **negative**: e.g. `spark-writer.js` must _not_ contain
  `/git/trees`, `method: "PATCH"`, or a bearer-token header, because private
  Spark must never write directly to the public repo.
- When a contract genuinely needs to change, change the validator in the same
  commit and treat it as a deliberate decision, not a test fix.

`scripts/check_built_site.py` validates the rendered `_site`: the exact route
list, `html lang="zh-CN"`, browser titles ending in `· Function` /
`· Magic`, required control IDs, the no-JS navigation fallback, absence of the
global footer, that the retired `/cv/` routes are never regenerated, and that
`function.css` / `function.js` load on every page, and that no `/en/` output,
English search index, English sitemap entry, or hreflang alternate is generated.

## Chinese-only model

The site is Chinese-only (owner decision 2026-09-24). Every record is a
`<slug>-zh.md` file with `lang: zh` and a `translation_key`; `validate_content.py`
rejects `lang: en`, and `REQUIRED_ROUTES` in it pins the permalinks of every
top-level page — adding a new top-level section means editing that table. The
site design lives in `assets/css/function*.css`, `assets/js/function.js`, and
`_includes/home-zh.liquid`. Some shared includes still branch on
`page_lang == 'en'`; those branches are unreachable.

`_plugins/private_content_guard.rb` aborts the build if any record has
`private: true`, `published: false`, `draft: true`, or an owner/draft
`visibility`. Unfinished work cannot sit in this repo; it belongs in the
encrypted vault.

## Content Security Policy

`_plugins/content_security_policy.rb` replaces the theme's permissive CSP `<meta>` after the
files are written (after jekyll-minifier, so hashes match the served bytes). Each page gets
`script-src 'self'` + the exact external script files it references + a `sha256` for each of
its inline scripts; no `'unsafe-inline'`, no blanket `https:`. Consequences:

- Inline event attributes (`onclick=`, `onload=`, `onerror=` …) are blocked and **fail the
  build**. Use a `data-*` attribute handled by the delegated listener the plugin injects
  (`data-async-style`, `data-back-to-top`, `data-hide-repo-on-error`, …) or a script file.
- Inline `<script>` blocks are fine — they are hashed automatically.
- A new third-party script host must be referenced as a `<script src>` in the page (it is
  then allowed per file); scripts injected at runtime from other hosts need an entry in the
  plugin (see `BADGE_SOURCES`).
- `check_built_site.py` re-computes every hash and rejects weak `script-src` values.

The Tencent mirror adds HSTS, `frame-ancestors`, `nosniff` etc. as real headers through
`deploy/nginx/functionhx-security-headers.conf` (installed to `/etc/nginx/snippets/`). nginx
drops inherited `add_header`s in any location that sets its own, so every such location
re-includes the snippet; `validate_content.py` enforces that.

## Headless homepage (terminal + agent)

`_plugins/headless_site.rb` generates, after every build, two browser-free versions of the site from
the same content (posts, `_projects`, `_news`; demo projects with `translation_key: demo-*` and any
record with `headless: false` are excluded; identity and what each audience may see live in
`_data/headless.yml`):

- **Terminal, for humans** — `/cli.py` is an interactive curses TUI (stdlib only, Python 3.6+;
  tabs, `/` command palette, reader, search, scannable WeChat QR), run with
  `curl -fsSL https://functionhx.github.io/cli.py | python3 -`. Its source is `terminal/cli.py`
  (excluded from the build; the plugin injects the content at the `DATA = None` placeholder).
  `/cli` is the static ANSI card (`python3 cli.py --card`, so the build needs `python3`).
- **Agent, for machines** — `/llms.txt` is the trunk; `/agent/*.md` are branches that link back
  to it; every post / project / news item / section page gets a leaf at `<url>index.html.md`;
  `/llms-full.txt` and `/api/*.json` complete it. No ANSI codes, Chinese only (the academic
  homepage link is the one English exception).

The WeChat QR is drawn from `_data/terminal_qr.yml` (module matrix + the PNG's SHA-256, made by
`scripts/terminal_qr.py`, which round-trip-decodes it); `validate_content.py` fails if the PNG
changes without regenerating it. Every HTML page starts with a comment naming both entry points
and carries `<link rel="alternate">` to its Markdown leaf. On the Tencent mirror nginx negotiates:
`Accept: text/markdown` → leaf, `Accept: application/json` on `/` → `/api/profile.json`,
curl/wget/HTTPie/xh → `/cli` on `/` (also over plain HTTP) and the leaf elsewhere; set
`mirror_negotiation: true` in `_data/headless.yml` once that config is live. `check_built_site.py`
verifies the whole tree (links resolve, JSON parses, no ANSI in agent files, no demo content, the
TUI compiles and prints).

## Theme override ledger

The theme runtime comes from the pinned `al_folio_core` gem. Local files in
`_includes/` and `_layouts/` that shadow gem files are recorded in
`.al-folio-overrides.yml` with upstream and local SHA-256 hashes. Editing such a
file means updating its `local_sha256`; the ledger is how a gem upgrade
surfaces which overrides drifted.

## Owner-only browser subsystems

A large part of `assets/js/` is an in-page editing suite that only activates
after owner verification (`owner-unlock.js`, `github-auth-vault.js`,
`owner-ui.js`, gated by `data-owner-verified` / `data-owner-mode` attributes on
`<html>`). It is dependency-free browser JavaScript and must stay that way.

- `inline-editor.js` / `content-creator.js` — edit and create pages, posts and
  sections in place, committing to this repo via the GitHub Contents/Git APIs
  with a fine-grained token encrypted in IndexedDB.
- `site-settings.js` — the settings panel. Two kinds of change, two paths:
  - **Appearance** (font, loading copy, season effect, wind strength, away-title delay, navigation
    spacing, easter-egg hints and the sealed letter) applies **instantly**: the panel
    auto-saves `settings.json` on the `site-settings` branch, and every page reads it
    through `runtime-settings.js` (GitHub contents API, cached in localStorage and
    applied from the head script before first paint). Nothing here needs a rebuild. A
    quiet background commit later syncs the same values into `_data/site_ui.yml` /
    `_data/eggs.yml` on `main` so the built-in fallback catches up (used when the API
    is unreachable, e.g. mainland China, and on a visitor's very first load).
  - **Structure** (showing/hiding sections, creating a section) changes generated
    pages, so it still goes through "保存并发布" as a commit to `main`.
    Anything new that is purely presentational should join the first path: add it to
    `sanitize()` in `runtime-settings.js` (allow-list: the file is public and only the
    owner can write it, but pages still trust only known fields and values), to
    `liveSettingsFromForm()` / `adoptLiveSettings()` in `site-settings.js`, and keep a
    baked default in `_data/site_ui.yml` with a check in `validate_content.py`.
- `spark-writer.js` + `spark-vault-client.js` — the Spark flow, which uses a
  _different_ credential path (GitHub App + opaque encrypted session) and never
  touches the public repo directly.
- `deployment-monitor.js` — follows the Actions run for the commit just made.

## Out-of-repo services

Three services live in this repo but are excluded from the Jekyll build. The
first two run on the owner's Tencent Cloud server:

- `magic-search/server.py` — semantic ranking over the build-time index.
  `_plugins/magic_search_generator.rb` generates `assets/search/index-zh.json`
  at build time; the browser runs local BM25 and merges remote rankings when
  available, so search must degrade gracefully when the service is offline.
- `spark-vault/` — zero-knowledge store for private Spark entries, committing
  ciphertext to a separate private repository. Read `spark-vault/README.md`
  before touching anything in it; its security boundary (per-note data keys,
  passphrase + passkey wrapping, the decoy quick gate) is deliberate.
- `letter-mailer/` — a Cloudflare Worker (not Tencent: mainland servers cannot
  reach Gmail) that emails the six-digit PIN for the homepage letter easter egg
  after checking the secret phrase. Gmail credentials, the phrase and the PIN
  live only in Worker secrets; see `letter-mailer/README.md`.

## Performance plumbing

- `_plugins/async_external_styles.rb` rewrites the built HTML: third-party
  stylesheets load asynchronously (with a `<noscript>` fallback), Google Fonts is
  replaced by a `<meta>` that `site-preferences.js` loads only for fonts that need
  it, and MathJax becomes `async` and is moved after `mathjax-setup.js`. Never add
  a render-blocking or synchronous third-party resource back to `<head>`.
- Icon fonts (Font Awesome, Academicons, Scholar Icons), vanilla-back-to-top and the Latin
  heading serif are self-hosted in `assets/third-party/<name>-<version>/`, wired through
  `_config.yml` `third_party_libraries` and `_layouts/default.liquid`. Do not name the directory
  `vendor` (`.gitignore` swallows it). Upgrading means a new directory plus the `?v=` in the
  config URL. The easter-egg fonts still come from jsDelivr and fall back to system fonts.
- Font Awesome ships as a **subset** of the icons the site uses (`css/subset.min.css` +
  `webfonts/*-subset.woff2`, ~13 KB instead of ~320 KB). After using a new `fa-…` icon, build and
  run `python3 scripts/subset_fontawesome.py` (needs `pip install fonttools brotli`; it also
  rewrites the `?v=` in `_config.yml`). `check_built_site.py` fails on icons missing from the subset.
- Noto Serif SC (headings) is a self-hosted **subset** of the characters the built site renders in
  the serif (`assets/fonts/noto-serif-sc/`, generated by `scripts/subset_serif_font.py`). Its
  `@font-face` is declared after the jsDelivr unicode-range slices, so new characters (a new post
  title) still render from the CDN until the script is rerun; `check_built_site.py` prints how
  many are pending. Rerun it after publishing posts with new title characters.
- `_plugins/unused_icon_styles.rb` drops the Academicons / Scholar Icons stylesheets from pages
  that use none of their classes; `_plugins/image_aspect_ratio.rb` adds `aspect-ratio` (read from
  the image file) to local `<img>`s without numeric width/height to prevent layout shift;
  `_plugins/css_bundles.rb` merges adjacent same-origin head stylesheets into
  `/assets/css/bundles/<md5>.css` (only strictly adjacent ones, so cascade order is unchanged;
  links with `id`/`media`/`data-*` are left alone). Blocking stylesheets went from 13 to ~5.
- Non-critical stylesheets load with `media="print" data-async-style` (eggs.css, external CSS);
  the CSP plugin's delegated listener flips them to `all` once loaded.
- A CSP `<meta>` stops Chrome's preload scanner, so every parser-blocking script used to cost one
  round trip in series (≈4 s DOMContentLoaded at GitHub Pages latency, and the page loader stays up
  until DOMContentLoaded). `_plugins/preload_hints.rb` therefore writes `<link rel="preload">` for
  the page's same-origin stylesheets and scripts at the top of `<head>`. Do not "fix" this by making
  the body scripts `defer`: `function.js` (hero reveal) and `site-preferences.js` (font) must run
  before first paint, otherwise the page paints fully and then flashes.
- `eggs.js` times the "在等你回来" tab title in `away-timer-worker.js`: main-thread timers in a
  background tab are aligned to ~1 s, so a 0.5 s setting would show after 1 s. It must stay a
  same-origin file (the site CSP allows workers only from `'self'`) and the
  code falls back to a plain timer if the Worker cannot start.
- `deploy/nginx/fanyuchen.com.cn.conf` caches any `/assets/…?v=<hash>` URL for a year
  (`immutable`); URLs without `?v=` are revalidated. The file is applied to the server by hand,
  CI does not deploy it.
- `_layouts/default.liquid` carries Speculation Rules (hover prerender of site
  links); `navigation-performance.js` keeps hover prefetch for other browsers and
  registers the Service Worker.
- `sw.js` (root, Liquid front matter, excluded from Prettier) caches versioned
  `/assets/…?v=` files cache-first, other `/assets/` files stale-while-revalidate,
  and site pages network-first with a 0.6 s fallback to cache, and pre-fetches the navbar pages into the page cache after load. It only touches
  routes listed at build time, so other projects under the same origin
  (`/contrail/` …) are untouched. Emergency stop: set `KILL_SWITCH = true` and
  deploy; per-browser debugging: `?sw=off` / `?sw=on`.

## Deployment

Pushing to `main` builds once and deploys to two targets: GitHub Pages, and a
Tencent Cloud mirror at `fanyuchen.com.cn` published as an atomic symlink swap
and then verified by comparing the commit SHA in `/healthz.json`. The mirror job
is `continue-on-error`; a green Pages deploy does not prove the mirror updated.
