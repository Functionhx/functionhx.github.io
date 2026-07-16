# Showcase Synchronization

## Public fact source

`data/showcase/` is the shared factual layer for the website and future external materials:

- `profile.yaml`: identity, education, positioning, focus
- `projects.yaml` and `research.yaml`: records, routes, statuses
- `achievements.yaml`: verified achievements
- `open_source.yaml`: contribution count, categories, ecosystems
- `links.yaml`: enabled and intentionally unavailable profiles
- `timeline.yaml`: direction-level chronology

Every file contains source/status metadata and a verification date. Update facts here first. The validator checks required bilingual fields, IDs, URLs, dates, statuses, and duplicates.

## Generate artifacts

```bash
python scripts/showcase/validate.py
python scripts/showcase/export_public_json.py
python scripts/showcase/render_github_profile.py
python scripts/showcase/render_resume_data.py
python scripts/showcase/render_portfolio_index.py
```

Outputs:

- `static/showcase.json` → deployed as `/showcase.json`
- `public/showcase.json` → ignored build artifact
- `generated/github-profile-section.md`
- `generated/resume-data.json`
- `generated/portfolio-index.md`

Regenerate and review diffs whenever showcase YAML changes. Commit the tracked outputs in the same PR as their source data.

## External synchronization

These scripts intentionally do not write to another repository. To update the Functionhx profile README, résumé master repository, portfolio PPT, or pinned-project descriptions:

1. regenerate and review artifacts here;
2. copy only the relevant generated section into a branch of the target repository;
3. open a PR that links back to the source commit;
4. verify formatting and facts in the target context;
5. merge manually.

For PPT work, treat `resume-data.json` as input data, not a finished slide. Never infer a missing link, metric, date, publication, or patent from a project name.
