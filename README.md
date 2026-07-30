# Empty bilingual site shell

This repository publishes six sections:

- Home
- Projects
- Research
- Open Source
- Notes
- About

The homepage also contains one Kaggle competition progress card. It reads `https://functionhx.github.io/kaggle-agent/data/dashboard.json` and refreshes every five minutes.

The public interface otherwise keeps only Chinese/English switching and light/dark mode. It contains no profile, article, timeline, contact, résumé, analytics, comment, search, CMS, or showcase archive.

## Validate locally

```bash
git submodule update --init --recursive
python3 scripts/validate_content.py
hugo --cleanDestinationDir --minify
python3 scripts/check_built_site.py public
```

The previous full site remains recoverable from Git history at commit `a845d47`.
