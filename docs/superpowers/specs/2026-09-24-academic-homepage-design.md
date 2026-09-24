# Academic Homepage Design

Date: 2026-09-24
Status: approved by owner 2026-09-24

## Goal

Give Yuchen Fan a second public face. People who arrive through academic
channels (PhD/graduate admissions, advisors, reviewers, conference peers) land
on a concise academic homepage. People who arrive through technical channels
land on the existing technical blog. Every visitor can reach the other face in
one click, so both sides of the profile stay visible.

Reference sites supplied by the owner:

- https://bit-dyn.github.io/ (acad-homepage template, the chosen style)
- https://bit-tyj.github.io/ and https://yfyue-bit.github.io/ (Jon Barron style)

## Decisions

| Topic         | Decision                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| Blog          | `functionhx.github.io` and `fanyuchen.com.cn` remain the technical blog, unchanged       |
| Academic URLs | `functionhx.github.io/academic/` (GitHub Pages) and `scholar.fanyuchen.com.cn` (Tencent) |
| Repository    | New public repo `Functionhx/academic`, independent of the blog                           |
| Template      | RayeRen/acad-homepage (MIT, Jekyll); keep its LICENSE and attribution                    |
| Language      | English at `/`, Chinese at `/zh/`, language switch in the masthead                       |
| Shared data   | None. Each site owns its own text; overlapping items link across                         |
| Layout        | Single page: fixed profile sidebar + anchored sections                                   |

## Architecture

```
push to Functionhx/academic main
  -> GitHub Actions
     |- build with baseurl=/academic -> GitHub Pages -> functionhx.github.io/academic/
     `- build with baseurl=""        -> rsync        -> scholar.fanyuchen.com.cn
```

Two builds are needed because the two hosts serve the site under different
path prefixes. A config overlay (`_config.github.yml`, `_config.tencent.yml`)
sets `url`, `baseurl`, and the cross-link targets per host.

Tencent mirror, reusing the blog's proven pattern:

- Release directory `/var/www/academic/releases/<sha>`, `current` symlink
  switched atomically with `ln -sfn` + `mv -Tf`; old releases stay for rollback.
- `/var/www/academic` owned by `site-deploy` (no sudo). The repo gets the same
  `TENCENT_SSH_KEY` / `TENCENT_KNOWN_HOSTS` secrets as the blog.
- `healthz.json` with the commit SHA is written into both builds; the Tencent
  job verifies `https://scholar.fanyuchen.com.cn/healthz.json` after deploy.
- The Tencent job is `continue-on-error`, matching the blog, so a mirror
  failure never blocks GitHub Pages.

One-time setup:

- DNSPod: `A scholar -> 82.157.7.183` (owner clicks this; Claude gives exact steps).
- nginx site `/etc/nginx/sites-available/academic` for `scholar.fanyuchen.com.cn`,
  root `/var/www/academic/current`, plus `certbot --nginx` for HTTPS.
- GitHub Pages for the repo: source "GitHub Actions".

Out of scope for now: the template's Google Scholar citation crawler, analytics,
comments, and any shared content pipeline between the two sites.

## Page Content

Single page per language. The sidebar stays fixed on desktop and collapses
above the content on mobile.

Sidebar:

- Real photo (the original portrait used on the blog's English homepage).
- Yuchen Fan / 樊宇琛; Undergraduate, Robotics Engineering, Beijing Institute of Technology; Beijing, China.
- Links: Email (functionhx@gmail.com), GitHub (Functionhx), Google Scholar, ORCID, LinkedIn.
- Prominent **Tech Blog →** button.

Sections, in order, each reachable from the masthead:

1. **About** - short bio and research interests (embodied AI, autonomous
   systems, 3D scene intelligence, robot learning, SLAM). Drafted from facts
   already on the blog and GitHub profile; owner approves final wording.
2. **News** - dated one-liners about academic milestones only (acceptances,
   competitions, lab membership). Personal items such as the birthday entry are
   excluded.
3. **Publications** - teaser image left; title, authors with the owner in bold,
   venue, status badge (Accepted / Under Review / Preprint), and [PDF] [Code]
   [Project] buttons where available. Double-blind submissions show only what
   is publicly allowed.
4. **Research** - projects that are not (yet) papers: problem, approach, the
   owner's role, current status, and an "Engineering details →" link to the
   matching blog project page. Candidates: Batch-LIO, 3D Scene Intelligence,
   Formula Student Driverless, RoboAccel. The owner selects the final list.

Known publications (as of 2026-09-24):

- **SinD 2.0: A Multi-City UAV Dataset with Semantic Risk Annotations for
  SOTIF-Oriented Safety Validation at Signalized Intersections.** 19 authors,
  Yuchen Fan 5th; arXiv:2607.16943 (v2, 2026-08-11), cs.RO. Links: arXiv, PDF,
  dataset (github.com/SOTIF-AVLab/SinD). Full author list rendered from the
  arXiv record. Owner's contribution (confirmed by the owner): data annotation
  and the auxiliary 3DGS-based visual simulation extension (Sec. VI-G: BEV map
  prior -> feed-forward 3DGS scene -> DiFix3D enhancement -> vehicle asset
  insertion for egocentric rendering). Shown as a one-line "My contribution"
  note under the entry. Teaser: Fig. 19 (the 3DGS pipeline), cropped from the
  arXiv PDF, which ties the thumbnail to the owner's part of the paper.
- One submission (the decision, under review). Its project page and code are
  anonymous, so during review it is not listed under Publications and its
  anonymous page is not linked. Research carries a high-level item on
  3DGS-based instance image goal navigation (under review) without the paper
  title. The full entry is added after the decision.

Content integrity rule (inherited from the blog): no invented publications,
metrics, outcomes, affiliations, or contributions. Anything unknown stays out
of the page rather than being filled with placeholders.

## Cross-Linking

| Location               | Link                                           |
| ---------------------- | ---------------------------------------------- |
| Academic sidebar + nav | Tech Blog                                      |
| Blog nav (zh and en)   | 学术主页 / Academic, as an external nav item   |
| Blog about pages       | One sentence pointing to the academic homepage |

- Links stay within the same host family: `scholar.fanyuchen.com.cn` ↔
  `fanyuchen.com.cn`, and `functionhx.github.io/academic/` ↔
  `functionhx.github.io`. The blog is a single build shared by both hosts, so
  its academic link uses a relative-host rule: on `fanyuchen.com.cn` it points
  to `scholar.fanyuchen.com.cn`, on `functionhx.github.io` it points to
  `/academic/`. Implemented with a no-JS default (`https://scholar.fanyuchen.com.cn/`)
  plus a tiny dependency-free script that rewrites the href on github.io.
- Language is preserved: zh pages link to zh pages, en to en.
- Blog changes are limited to the nav item and the one sentence, per the blog's
  AGENTS.md rule against redesigning the al-folio visual language.

## Verification

Before any push:

- `bundle exec jekyll build` succeeds for both configs; a link check over both
  `_site` outputs finds no broken internal links or missing assets.
- Local preview checked at desktop and phone width, en and zh (the academic
  template has a single light theme; light and dark apply to the blog changes).
- Blog: `python3 scripts/validate_content.py`, `bundle exec jekyll build`,
  `python3 scripts/check_built_site.py _site`, and `npm run lint:prettier` pass.

After deploy:

- `functionhx.github.io/academic/` and `scholar.fanyuchen.com.cn` both serve the
  new commit (`healthz.json`), over HTTPS.
- Cross-links resolve in all four directions and keep the language.
- The existing blog on both hosts is unchanged apart from the new nav item and sentence.

## Owner Inputs Needed

- Google Scholar profile URL and ORCID iD (not found on the GitHub profile).
- Final Research project list and approval of About/News wording.
- The DNSPod record for `scholar`.
