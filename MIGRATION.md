# Migration Notes

## Architecture change

The site moved from a single-language PaperMod blog to native Hugo multilingual content directories:

- canonical Chinese: `content/zh/` at `/`
- reviewable English: `content/en/` at `/en/`
- portfolio facts: `data/showcase/`
- project-owned layouts and styles: `layouts/` and `assets/css/extended/`

Legacy files under the original `content/` subdirectories remain in Git for history. Because each language now has its own `contentDir`, those files are not built directly; migrated pages and aliases own the public routes.

## URL compatibility

| Previous route | Current route | Strategy |
| --- | --- | --- |
| `/posts/` | `/notes/` | section alias |
| `/posts/hello-world/` | `/notes/hello-world/` | page alias; archived and excluded from home |
| `/critiques/` | `/notes/critiques/` | section alias |
| `/critiques/example/` | `/notes/critiques/example/` | page alias |
| `/bugs/` | `/notes/debugging/` | section alias |
| `/thoughts/` | `/notes/thoughts/` | section alias |
| `/works/` | `/projects/` | section alias |
| `/resume/` | `/about/resume/` | page alias |

`/search/`, `/archives/`, `/fx/`, and `/write/` remain available. Do not remove legacy source files until production access logs and inbound links have been reviewed.

## Existing feature disposition

- Two-row header: retained and rebuilt for bilingual navigation and current-page language switching.
- PaperMod theme toggle: retained; brand colors now use shared light/dark tokens.
- Search: retained and made language-aware.
- Giscus: retained; interface language and theme follow the page.
- Critiques: retained under Notes with old-route aliases and its specialist layout.
- Sveltia CMS: retained at `/write/`; collections now author canonical Chinese content.
- Seven visual effects, `/fx/`, and the floating gear: retained; every effect now defaults off.
- Love-note and footer-entry Easter eggs: source retained behind `params.legacyInteractions`; disabled by default for the professional site.
- Hello World: retained as an archive and hidden from Latest Notes.
- Résumé placeholder: replaced by a data-driven overview; verified dates and a PDF remain an owner task.

## Deployment caution

The repository contains an active GitHub Pages deployment workflow, while the project brief states Cloudflare Pages. No Cloudflare account setting is stored here, and the public `functionhx.github.io` hostname is consistent with GitHub Pages. The GitHub workflow remains enabled until the canonical host and deployment owner are confirmed. See `docs/deployment.md` before changing either pipeline.
