# Repository Guidelines

## Site identity

This repository is the Chinese-only personal site of Yuchen Fan (樊宇琛), a
Robotics Engineering undergraduate at Beijing Institute of Technology. It
collects research, engineering projects, useful tools, writing, notes, and work
logs.

The site is Chinese-only (owner decision 2026-09-24). Do not add English
pages, `lang: en` records, `/en/` routes, hreflang alternates, or translation
tooling. Do not invent
publications, metrics, project outcomes, affiliations, or individual
contributions. Ongoing and pre-disclosure work must stay accurately labeled and
high-level.

## Architecture

The site is built with Jekyll and the MIT-licensed al-folio v1.1 starter. The
runtime theme is provided by the pinned `al_folio_core` and companion gems in
`Gemfile.lock`.

- `_config.yml` owns site and feature configuration.
- `_pages/` owns top-level pages.
- `_projects/` owns projects and tools.
- `_posts/` owns writing, notes, and logs.
- `_news/` owns short announcements.
- `_data/` owns social and supporting data.
- `_includes/` and `_layouts/` contain only site-specific overrides of the theme.

Preserve the upstream al-folio visual language. Do not redesign its typography,
spacing, cards, navigation, search, or theme system unless the owner explicitly
requests a deviation. Keep the upstream `LICENSE`.

Approved deviation (owner request 2026-09-26): article pages (`_layouts/post.liquid`,
`assets/css/post.css`, `assets/js/post.js`) follow the claude.dev blog layout — warm
paper palette, a hero aligned to the text column, and a sticky left rail with the
section tree and reading progress. Anthropic's proprietary fonts must never be
committed or loaded; articles use the site font preference.

## Development

```bash
bundle install
npm ci
bundle exec jekyll serve
```

Validate before publishing:

```bash
python3 scripts/validate_content.py
bundle exec jekyll build
python3 scripts/check_built_site.py _site
```

The public site must support light and dark themes,
desktop and mobile layouts, keyboard navigation, and a readable no-JavaScript
fallback. Browser JavaScript remains dependency-free.

## Publishing

The owner explicitly deploys from `main`. Use focused commits and push only
after the full build passes. GitHub Actions publishes `_site` through GitHub
Pages.
