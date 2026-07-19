# Visual Design Guide

The site combines Apple-inspired editorial storytelling with a restrained macOS Liquid Glass spatial layer: calm, precise, content-first, and technically credible. It must not imitate Apple branding, logos, product imagery, proprietary wallpaper, or a complete operating-system interface.

## Reference Principles

- Emil Kowalski’s MIT-licensed [`apple-design` skill](https://github.com/emilkowalski/skills/tree/main/skills/apple-design) informs interaction feedback, spatial consistency, typography, restraint, and reduced-motion behavior.
- Apple’s [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) provide the hierarchy, harmony, consistency, accessibility, and layout baseline.
- The browser-based [`macOS 27` Kimi demo](https://macos27.kimi.page/) is a visual benchmark for layered glass, window depth, and a functional Dock. No code, wallpaper, branding, or assets are copied from it.
- The website remains a research portfolio, not a consumer-product advertisement. Evidence, status, contribution boundaries, and readable technical content take priority over spectacle.

## Visual Rules

- Use the platform system-font stack and size-specific tracking.
- Use white and soft gray in light mode; near-black gray rather than pure black in dark mode.
- Keep one functional blue accent. Purposeful blue, silver, teal, and warm wallpaper gradients may establish spatial depth; status warnings may use a restrained warm color.
- Build rhythm with full-width sections, large headings, whitespace, and rules—not a grid of small cards.
- Project visuals must be explicitly illustrative architecture motifs, never simulated experimental results.
- Use translucent material only where it communicates hierarchy: the global navigation, hero workspace, project information layers, and a few major content windows.
- The hero may borrow familiar window and Dock affordances because they are functional links. It must remain a portfolio, not a draggable desktop simulation.
- Avoid glass-card stacks, bento dashboards, pill soup, particles, neon, copied macOS screens, decorative tech grids, and ungrounded AI imagery.

## Interaction Rules

- Give controls feedback on press using short `:active` states.
- Animate only `transform` and `opacity` for routine transitions.
- Keep motion subtle and reversible; do not block input during animation.
- Honor `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast`.
- Every glass surface needs an opaque reduced-transparency fallback and must stay readable over its background in both themes.

## Implementation

Shared tokens live in `assets/css/extended/00-design-system.css`. Header chrome lives in `header-redesign.css`; homepage storytelling lives in `home.css`; project and About surfaces live in `showcase-pages.css`. Preserve PaperMod overrides and never patch the upstream theme.
