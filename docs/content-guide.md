# Content Guide

## Source of truth

Write canonical content in `content/zh/`. English files in `content/en/` mirror the same relative path and `translationKey`. Public identity, links, metrics, project summaries, research status, and timeline facts belong in `data/showcase/`, not repeated in templates.

## Create content

```bash
hugo new content content/zh/notes/my-note.md
hugo new content content/zh/projects/my-project.md
hugo new content content/zh/research/my-topic.md
```

Use lowercase kebab-case filenames. Keep `draft: true` until the Chinese page, status, contribution boundary, and evidence have been reviewed.

Project/research status must be one of:

- `completed`
- `active`
- `research`
- `manuscript-in-preparation`
- `patent-disclosure-in-preparation`
- `archived`

Do not turn team outcomes into individual claims. Do not infer dates, metrics, affiliations, paper status, patent status, or links. Put missing editorial material in an HTML comment such as `<!-- TODO(owner): add verified demo URL. -->`; omit empty public headings.

## Project page structure

Use only sections with verified content: Overview, Problem, My Role, System Architecture, Key Engineering Decisions, Failure Cases & Debugging, Results, Limitations, What I Learned, and Links & Evidence. `links` may contain `code`, `demo`, `report`, `paper`, and `website`; leave unknown URLs empty.

For confidential or pre-disclosure work, set `confidential: true`, keep the public description high-level, and never publish core implementation details before authorization.

## Before commit

```bash
python scripts/validate_content.py
python scripts/showcase/validate.py
python -m unittest discover -s tests -v
hugo --minify
python scripts/check_built_site.py public
```

Preview both languages, light/dark themes, mobile widths, focus states, and reduced motion. When a URL changes, add `aliases` and update `MIGRATION.md`.
