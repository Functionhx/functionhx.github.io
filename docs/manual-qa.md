# Manual Browser QA

Use this checklist after deployment or whenever Header, CSS, JavaScript, Giscus, or content layouts change.

## Viewports and themes

Test `/` and `/en/` at approximately 1440×900, 768×1024, and 390×844.

- Confirm the Hero, focus cards, project grid, timeline, Open Source panel, and Contact CTA do not overflow.
- Check light, dark, and system-auto modes; reload after each manual choice.
- Verify body text, code, tables, cards, badges, buttons, Header, Footer, search, FX panel, and focus rings in both themes.
- Confirm the mobile Header search wraps cleanly and horizontal navigation remains usable.

## Navigation and language

- From `/projects/batch-lio/`, switch to `/en/projects/batch-lio/` and back.
- Confirm theme preference survives the language switch.
- On an untranslated taxonomy page, confirm the language control clearly falls back to the other language's home.
- Test search in both languages and visit each primary navigation section.
- Check legacy redirects including `/posts/hello-world/`, `/critiques/example/`, `/works/`, and `/resume/`.

## Interaction and accessibility

- Navigate the full Header, cards, links, theme control, FX gear, and form controls with the keyboard.
- Confirm visible focus states, correct reading order, and Escape-to-close on the FX popover.
- Enable one FX option, reload, then disable it. Verify all options default off in a fresh browser profile.
- Emulate `prefers-reduced-motion: reduce`; Hero motion and optional effects must stop.
- Check images for meaningful alt text and ensure content remains readable with JavaScript disabled.

## Console and integrations

- Open the browser console on Home, one project, one research page, Search, `/fx/`, and `/write/`; expect no errors.
- On a page with Giscus, switch themes and confirm the iframe follows the site theme and page language.
- Inspect network requests for missing assets, accidental API keys, or unexpected large third-party scripts.
- Run Lighthouse on Home and one project page; investigate material performance, accessibility, SEO, or CLS regressions.
