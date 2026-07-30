# Repository Guidelines

## Public scope

This repository is a minimal bilingual site shell. The only public pages are Home, Projects, Research, Open Source, Notes, and About in Chinese and English. The homepage additionally contains one Kaggle competition progress card that fetches `https://functionhx.github.io/kaggle-agent/data/dashboard.json` every five minutes. Do not add other personal information, descriptions, posts, project records, research records, contact details, feeds, search, comments, analytics, CMS features, or decorative interactions unless the owner explicitly changes this scope.

Chinese pages live under `content/zh/`; English pages live under `content/en/`. Both languages must keep the same relative paths and matching `translationKey` values. Section files contain front matter only.

## Architecture

Use Hugo Extended 0.163.1 with the PaperMod submodule. Do not edit `themes/PaperMod` directly. Keep project changes in `hugo.yaml`, `layouts/`, and `assets/css/extended/`.

The interface must retain:

- all six section links;
- the Kaggle progress card on both language versions of the homepage;
- Chinese/English switching on every page;
- light/dark switching with system preference as the default;
- keyboard focus states, responsive layout, and reduced-motion support.

## Validation

Run after every change:

```bash
python3 scripts/validate_content.py
hugo --cleanDestinationDir --minify
python3 scripts/check_built_site.py public
```
