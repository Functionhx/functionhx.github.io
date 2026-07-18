# Repository Guidelines

## Site Identity & Scope

This repository is the bilingual research portfolio of Yuchen Fan (樊宇琛): a robotics engineering undergraduate at Beijing Institute of Technology working across robotics, autonomous systems, embodied AI, 3D scene intelligence, and AI systems engineering. The site should remain a durable research homepage, engineering portfolio, technical notebook, and open-source record—not a one-off résumé page.

Chinese under `content/zh/` is the source of truth. English under `content/en/` is a translation and must keep the same relative path and `translationKey`. Every public claim must identify its status and source. Never invent metrics, publications, patents, affiliations, project outcomes, or individual contributions. Mark ongoing work accurately and keep confidential or pre-disclosure technical details high-level.

## Architecture & File Ownership

The stack is Hugo Extended 0.163.1 with the PaperMod Git submodule. Use `hugo.yaml` for multilingual and site configuration, `layouts/` for project overrides, `assets/css/extended/` for styles, `static/` for copied assets, and `data/showcase/` as the shared public fact source. Do not edit `themes/PaperMod` directly; prefer layout overrides and extended CSS.

Existing custom features—including the two-row header, search, Giscus, critiques, Sveltia CMS, `/fx/`, motion controls, and hidden interactions—must not be removed casually. Preserve, compatibility-refactor, or explicitly disable them in configuration with a migration note.

## Visual Direction

Use an Apple-inspired editorial product language without copying Apple trademarks or assets. Prefer system typography, neutral white/soft-gray surfaces, one blue accent, generous whitespace, strong type hierarchy, and a small number of large narrative sections. Avoid blue-purple gradients, bento-card dashboards, pill-heavy metadata, particle fields, fake device UI, decorative grids, and other generic AI-generated design signals.

Motion must provide immediate feedback and remain restrained: pressed controls respond on pointer-down, reversible transitions follow consistent paths, and reduced-motion users receive static or cross-fade alternatives. Keep optional legacy effects in `/fx/` and disabled by default. See `docs/design.md` before changing the homepage, header, shared tokens, or project presentation.

## Development & Validation

- `git submodule update --init --recursive` fetches PaperMod.
- `hugo server -D` previews all content, including drafts.
- `python scripts/validate_content.py` validates front matter, translations, and internal links.
- `python scripts/showcase/validate.py` validates the shared fact source.
- `hugo --minify` performs the production build.
- `python scripts/check_built_site.py public` checks built links and multilingual SEO metadata.

Run a Hugo build after every functional change. After JavaScript edits, load the affected pages and check the browser console. New pages must work in light and dark themes, on mobile and desktop, with keyboard navigation, and with `prefers-reduced-motion`. Keep pages readable without JavaScript.

## Content, URLs & Translation

Use lowercase kebab-case slugs. Match project front matter to the archetype and omit empty public sections. When changing a URL, add `aliases` or an explicit redirect; do not silently break legacy links.

DeepSeek is a local/CI authoring tool only. Read `DEEPSEEK_API_KEY` from the environment, never from source or browser JavaScript. Machine translation must create a reviewable draft or pull request, preserve human-locked English, and never overwrite content marked `translation_locked: true` or reviewed. Do not log secrets.

## Code & Review Conventions

Follow nearby formatting: two spaces for YAML, CSS, and JavaScript; four spaces for Hugo templates. Keep browser JavaScript dependency-free and effects restrained. Use focused commit subjects such as `feat(i18n): ...`, `feat(home): ...`, `content: ...`, and `fix: ...`.

Pull requests must summarize user-visible changes, affected URLs, migration behavior, and validation results. Include desktop/mobile screenshots for visual changes and identify any unverified content, external configuration, or manual review still required. Final handoff must include a change summary and clear maintenance instructions.
