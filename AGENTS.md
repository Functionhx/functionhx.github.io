# Repository Guidelines

## Site identity

This repository is the bilingual personal site of Yuchen Fan (樊宇琛), a
Robotics Engineering undergraduate at Beijing Institute of Technology. It
collects research, engineering projects, useful tools, writing, notes, and work
logs.

Chinese content is the source of truth. Every public page or collection record
must have an English counterpart with the same `translation_key`. Do not invent
publications, metrics, project outcomes, affiliations, or individual
contributions. Ongoing and pre-disclosure work must stay accurately labeled and
high-level.

## Architecture

The site is built with Jekyll and the MIT-licensed al-folio v1.1 starter. The
runtime theme is provided by the pinned `al_folio_core` and companion gems in
`Gemfile.lock`.

- `_config.yml` owns site and feature configuration.
- `_pages/` owns bilingual top-level pages.
- `_projects/` owns bilingual projects and tools.
- `_posts/` owns writing, notes, and logs.
- `_news/` owns short bilingual announcements.
- `_data/` owns social and supporting data.
- `_includes/` and `_layouts/` contain only bilingual compatibility overrides.

Preserve the upstream al-folio visual language. Do not redesign its typography,
spacing, cards, navigation, search, or theme system unless the owner explicitly
requests a deviation. Keep the upstream `LICENSE`.

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

The public site must support Chinese and English, light and dark themes,
desktop and mobile layouts, keyboard navigation, and a readable no-JavaScript
fallback. Browser JavaScript remains dependency-free.

## Publishing

The owner explicitly deploys from `main`. Use focused commits and push only
after the full build passes. GitHub Actions publishes `_site` through GitHub
Pages.
