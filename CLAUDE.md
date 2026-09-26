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
- `site-settings.js` — section manager; publishes navigation layout into
  `_data/site_ui.yml`.
- `spark-writer.js` + `spark-vault-client.js` — the Spark flow, which uses a
  _different_ credential path (GitHub App + opaque encrypted session) and never
  touches the public repo directly.
- `deployment-monitor.js` — follows the Actions run for the commit just made.

## Out-of-repo services

Two services live in this repo but are excluded from the Jekyll build and run on
the owner's Tencent Cloud server:

- `magic-search/server.py` — semantic ranking over the build-time index.
  `_plugins/magic_search_generator.rb` generates `assets/search/index-zh.json`
  at build time; the browser runs local BM25 and merges remote rankings when
  available, so search must degrade gracefully when the service is offline.
- `spark-vault/` — zero-knowledge store for private Spark entries, committing
  ciphertext to a separate private repository. Read `spark-vault/README.md`
  before touching anything in it; its security boundary (per-note data keys,
  passphrase + passkey wrapping, the decoy quick gate) is deliberate.

## Deployment

Pushing to `main` builds once and deploys to two targets: GitHub Pages, and a
Tencent Cloud mirror at `fanyuchen.com.cn` published as an atomic symlink swap
and then verified by comparing the commit SHA in `/healthz.json`. The mirror job
is `continue-on-error`; a green Pages deploy does not prove the mirror updated.
