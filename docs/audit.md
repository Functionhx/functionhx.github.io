# Site Audit — 2026-07-16

## Baseline

- Branch: `redesign-v2`
- Generator: Hugo Extended 0.163.1
- Theme: PaperMod submodule at `154d006e0182dfc7da38008323976b02e6bfab4a`
- Content: one Chinese content tree with posts, critiques, bugs, thoughts, works, search, archives, résumé, and FX pages
- Deployment in repository: GitHub Pages via `.github/workflows/hugo.yaml`

After initializing the theme submodule, the baseline production build completes with 35 pages and 10 aliases. Hugo reports upstream deprecation warnings for language properties but no build error.

## Preserved Custom Surface

The project overrides PaperMod with a two-row header, a global search field, Giscus comments, critique-specific list/single templates, Sveltia CMS, seven optional pointer/motion effects, an `/fx/` laboratory, a floating FX control, a love-note Easter egg, and a footer shortcut to `/write/`.

## Findings

The current header hard-codes Chinese labels and root-relative search, and it replaces PaperMod's multilingual switcher. Site identity, email, navigation, résumé, and home content are outdated. Visual tokens are not centralized, several motion effects default to on, and no structured showcase, translation workflow, content validator, link checker, or test suite exists.

The Sveltia password hash is a client-visible convenience gate, not an authorization boundary; GitHub repository permissions remain the real control. No API key was found in tracked files.

No Cloudflare Pages configuration exists in the repository. The public `github.io` URL and active workflow indicate GitHub Pages, while one post describes Cloudflare Pages. The redesign retains the working GitHub Pages workflow until deployment ownership is confirmed and documents the Cloudflare build settings separately.

## Migration Policy

Legacy content files remain in place. The multilingual content tree will provide compatibility pages or aliases for old URLs. PaperMod stays untouched; all customization remains in project overrides. Claims without verified evidence, dates, links, or contribution boundaries are omitted from public output or left as source comments for later review.
