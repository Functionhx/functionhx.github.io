# Empty bilingual site shell

This repository intentionally publishes only six empty sections:

- Home
- Projects
- Research
- Open Source
- Notes
- About

The public interface keeps Chinese/English switching and light/dark mode. It contains no profile, project, research, article, timeline, contact, résumé, analytics, comment, search, CMS, or showcase data.

## Validate locally

```bash
git submodule update --init --recursive
python3 scripts/validate_content.py
hugo --cleanDestinationDir --minify
python3 scripts/check_built_site.py public
```

The previous full site remains recoverable from Git history at commit `a845d47`.
