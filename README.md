# Yuchen Fan — personal research hub

This Hugo site is a bilingual home for research, engineering projects, useful
tools, finished writing, evolving notes, and chronological work logs.

The homepage is organized around two layers:

- a live workspace for Rebuttal Reader, Kaggle monitoring, and direct shortcuts;
- durable editorial archives for projects, research, writing, notes, logs, open
  source, and profile context.

Chinese under `content/zh/` is the source of truth. English under `content/en/`
keeps the same relative path and `translationKey`. Shared public facts live in
`data/showcase/hub.yaml`.

## Local preview

```bash
git submodule update --init --recursive
hugo server -D
```

## Validation

```bash
python3 scripts/validate_content.py
python3 scripts/showcase/validate.py
hugo --cleanDestinationDir --minify
python3 scripts/check_built_site.py public
```

## Maintenance

- Add verified project, research, tool, and publication summaries to
  `data/showcase/hub.yaml`.
- Add local writing, notes, and logs as matched Markdown files under
  `content/zh/` and `content/en/`.
- Follow `docs/content-pipeline.md` when indexing articles from Zhihu,
  Xiaohongshu, or WeChat Official Accounts.
- Keep live Kaggle data at
  `https://functionhx.github.io/kaggle-agent/data/dashboard.json`; the homepage
  refreshes it every five minutes and shows an honest unavailable state.
