# 樊宇琛 / Yuchen Fan

Bilingual research, projects, tools, writing, notes, and logs built on the
MIT-licensed [al-folio](https://github.com/alshedivat/al-folio) v1.1 starter.

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
- Keep the public presentation faithful to al-folio v1.1. Upstream sample
  records may remain where owner content is not yet available.

## Online editing

The pencil icon in the site header opens the repository in GitHub's official
[github.dev web editor](https://github.dev/Functionhx/functionhx.github.io).
It is a browser-based VS Code experience intended for desktop editing. Sign in
to GitHub, edit the Markdown files, then use Source Control to `Commit & Push`;
the commit triggers the normal GitHub Pages deployment.

Create Chinese and English records with the same `slug` and
`translation_key`. Their `lang`, `permalink`, and body content remain separate.
Set `published: false` while either language is still a draft, and turn it on
only after both records are ready.

Owner-authored posts may enable `giscus_comments: true`. Comments are stored in
this repository's GitHub Discussions through Giscus.

## Validation

```bash
python3 scripts/validate_content.py
bundle exec jekyll build
python3 scripts/check_built_site.py _site
```

The homepage Kaggle monitor reads
`https://functionhx.github.io/kaggle-agent/data/dashboard.json` every five
minutes and displays an unavailable state when that source is offline.
