# Visual Design Guide

The site uses a Swiss-editorial research-periodical language: direct, typographic, evidence-first, and deliberately distinct from consumer-product interfaces. The default homepage should feel like the cover and index of a publication that is continuously updated—not a résumé template, dashboard, or simulated operating system.

## Reference Principles

- International Typographic Style informs the grid, asymmetric composition, large sans-serif type, strict alignment, and use of rules.
- Research journals and technical catalogues inform numbering, record structure, status visibility, and restrained metadata.
- The site remains a bilingual research portfolio. Evidence, source status, contribution boundaries, and readable technical content take priority over spectacle.
- The July 2026 spatial homepage direction is retired. Window chrome, Dock affordances, wallpaper gradients, and Liquid Glass are not part of the default site.

## Visual Rules

- Use the platform system sans-serif stack for display and body copy; use the system monospace stack for indices, labels, dates, statuses, and navigation.
- Use warm paper and near-black surfaces rather than pure white and pure black. Keep one high-energy cobalt accent.
- Establish hierarchy with scale, weight, whitespace, rules, and full-width color fields.
- Prefer ledgers, registers, and editorial rows over cards. Cards are reserved for content that genuinely needs a bounded object.
- Large type may be dramatic, but body text must remain compact, calm, and readable.
- Use square corners by default. Avoid floating surfaces, soft drop shadows, glossy materials, gradients, or decorative blur.
- Project pages must continue to expose status and evidence boundaries. Do not use illustrative graphics that could be mistaken for experimental results.
- Avoid bento dashboards, pill metadata, glass cards, operating-system metaphors, particles, neon, decorative tech grids, generic AI imagery, and fake terminal aesthetics.

## Layout Rules

- The homepage reads as a sequence: cover, focus index, selected-work ledger, research timeline, open-source record, notes, and contact.
- Use a maximum 1280 px editorial canvas with a consistent outer gutter.
- Desktop sections may use a narrow index column and a wide content column. Mobile layouts collapse into one reading order without hiding substantive content.
- The two-row header remains functional, but is styled as an opaque editorial masthead rather than a floating control surface.
- Conventional pages inherit the same scale, rules, square geometry, and monospace metadata.

## Interaction Rules

- Controls respond on pointer-down with a one-pixel translation or similarly immediate feedback.
- Hover changes should be structural and obvious: color inversion, underline, or cobalt fill.
- Animate only `transform` and `opacity` for routine transitions; avoid decorative entrance sequences.
- Honor `prefers-reduced-motion` and `prefers-contrast`. The default design uses opaque surfaces, so reduced-transparency users receive the same visual hierarchy without a special glass fallback.
- Keyboard focus must remain visible on every interactive element.

## Implementation

Shared tokens live in `assets/css/extended/00-design-system.css`. The editorial masthead lives in `header-redesign.css`; homepage composition lives in `home.css`; project and About surfaces live in `showcase-pages.css`.

Preserve PaperMod through project-owned overrides and never patch `themes/PaperMod` directly. Keep optional legacy effects under `/fx/` and disabled by default.
