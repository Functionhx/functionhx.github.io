# Deployment

## Verified repository behavior

`.github/workflows/hugo.yaml` currently deploys `main` to GitHub Pages with Hugo Extended 0.163.1 and the PaperMod submodule. The public hostname `https://functionhx.github.io/` matches that setup. This workflow remains enabled to avoid an unreviewed production cutover.

Before every deploy, the workflow installs Python dependencies, validates bilingual content and showcase data, runs unit tests, and builds Hugo. The build output is `public/` and is intentionally ignored by Git.

## Cloudflare Pages settings

The repository contains no Cloudflare account or project configuration. Configure these values in Workers & Pages:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | repository root |
| Build output directory | `public` |
| `HUGO_VERSION` | `0.163.1` |
| `PYTHON_VERSION` | `3.12` |

Recommended build command:

```bash
git submodule update --init --recursive && python -m pip install -r requirements.txt && python scripts/validate_content.py && python scripts/showcase/validate.py && python -m unittest discover -s tests -v && hugo --gc --minify
```

Cloudflare's [Hugo guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-hugo-site/) documents `public` as the output directory, `HUGO_VERSION` for pinning, and `CF_PAGES_URL` for preview canonicals. If Cloudflare preview URLs must be canonical inside previews, append `--baseURL "$CF_PAGES_URL"` there. Keep the configured `baseURL` for production while `functionhx.github.io` remains the canonical public host.

## Secrets and release decisions

`DEEPSEEK_API_KEY` belongs in GitHub Actions secrets only; the normal site build and Cloudflare deployment do not need it. The translation workflow runs separately and opens a draft PR.

Before disabling GitHub Pages or switching the canonical URL, confirm:

1. which Cloudflare Pages project owns production;
2. the final production domain and DNS;
3. canonical and `baseURL` behavior for production and previews;
4. redirect coverage and analytics/search-console ownership;
5. that a Cloudflare deployment passes the same validators and Hugo build.
