# Personal Hub Design

## Product definition

This site is Yuchen Fan's long-lived personal digital hub. A visitor should be
able to understand the person, inspect current work, launch a useful tool, read
an article or note, and follow ongoing activity without the homepage becoming a
résumé or a dashboard.

The content model has five distinct tempos:

1. **Now** — live or frequently refreshed state such as Kaggle experiments.
2. **Work** — durable project, research, and open-source records with status and
   evidence boundaries.
3. **Tools** — products that can be launched and used, such as Rebuttal Reader.
4. **Writing** — finished essays, including indexed work first published on
   Zhihu, Xiaohongshu, WeChat Official Accounts, or this site.
5. **Garden and logs** — evolving thoughts and chronological work notes.

The homepage is a routing surface for those tempos, not a duplicate of every
archive.

## Homepage sequence

1. A compact identity and purpose statement.
2. One functional workspace containing the featured tool, current focus, and
   the live Kaggle monitor.
3. A small project dock for direct access to active surfaces.
4. Conventional editorial registers for work and knowledge.
5. A restrained about/contact close.

Only the workspace and global controls use translucent material. Work, writing,
and logs use normal document layouts.

## Visual language

- System sans-serif typography, with monospace reserved for live state, dates,
  indices, and provenance.
- Warm neutral paper in light mode and soft near-black in dark mode.
- A single warm orange accent for active state and links.
- A quiet wallpaper gradient inside the live workspace only.
- Generous whitespace, strong rules, and aligned editorial rows after the
  workspace.
- Rounded geometry is limited to glass controls and the workspace. Archive rows
  remain mostly square.

Avoid giant name-only heroes, bento grids, floating card collections, neon,
particle effects, copied operating-system chrome, and decorative metrics.

## Interaction

- Controls move one pixel on pointer-down.
- Hover and focus use clear color or underline changes.
- Workspace transitions use only opacity and transform.
- `prefers-reduced-motion` removes movement while preserving state changes.
- The site remains readable and navigable when JavaScript is unavailable.

## Content rules

- `data/showcase/hub.yaml` is the shared fact source for homepage modules and
  archive summaries.
- Chinese is authored first; English is maintained in the same record.
- Tools include a canonical URL and a visible status.
- External articles retain their original platform and canonical URL. Full text
  is copied locally only when the owner supplies an export or canonical
  Markdown source.
- Live modules always expose an honest unavailable state.
