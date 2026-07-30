# Yuchen Fan

Bilingual research, projects, tools, writing, notes, and logs built as a
content-adapted replica of the MIT-licensed
[al-folio](https://github.com/alshedivat/al-folio) v1.1 demo.

## Local development

```bash
bundle install
npm ci
bundle exec jekyll serve
```

Open `http://localhost:4000/` for Chinese and
`http://localhost:4000/en/` for English.

## Content

- Add paired top-level pages under `_pages/`.
- Add paired projects and tools under `_projects/`.
- Add paired writing, notes, and logs under `_posts/`.
- Add paired courses under `_teachings/` and paired books under `_books/`.
- Give every pair the same `translation_key` and set `lang: zh` or `lang: en`.
- Keep external articles as canonical links until an owner-provided Markdown
  source or export is available.
- Mark retained upstream examples with `placeholder: true` and
  `source: al-folio v1.1 demo`. Never present them as owner achievements.

## Validation

```bash
python3 scripts/validate_content.py
bundle exec jekyll build
python3 scripts/check_built_site.py _site
```

The homepage Kaggle monitor reads
`https://functionhx.github.io/kaggle-agent/data/dashboard.json` every five
minutes and displays an unavailable state when that source is offline.
