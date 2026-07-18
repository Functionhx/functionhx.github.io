# Visual Design Guide

The site uses an Apple-inspired editorial product language: calm, precise, content-first, and technically credible. It must not imitate Apple branding, logos, product imagery, or proprietary assets.

## Reference Principles

- Emil Kowalski’s MIT-licensed [`apple-design` skill](https://github.com/emilkowalski/skills/tree/main/skills/apple-design) informs interaction feedback, spatial consistency, typography, restraint, and reduced-motion behavior.
- Apple’s [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) provide the hierarchy, harmony, consistency, accessibility, and layout baseline.
- The website remains a research portfolio, not a consumer-product advertisement. Evidence, status, contribution boundaries, and readable technical content take priority over spectacle.

## Visual Rules

- Use the platform system-font stack and size-specific tracking.
- Use white and soft gray in light mode; near-black gray rather than pure black in dark mode.
- Keep one functional blue accent. Status warnings may use a restrained warm color.
- Build rhythm with full-width sections, large headings, whitespace, and rules—not a grid of small cards.
- Project visuals must be explicitly illustrative architecture motifs, never simulated experimental results.
- Avoid blue-purple gradients, glass-card stacks, bento dashboards, pill soup, particles, neon, and fake device mockups.

## Interaction Rules

- Give controls feedback on press using short `:active` states.
- Animate only `transform` and `opacity` for routine transitions.
- Keep motion subtle and reversible; do not block input during animation.
- Honor `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast`.

## Implementation

Shared tokens live in `assets/css/extended/00-design-system.css`. Header chrome lives in `header-redesign.css`; homepage storytelling lives in `home.css`; project and About surfaces live in `showcase-pages.css`. Preserve PaperMod overrides and never patch the upstream theme.
