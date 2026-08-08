---
layout: page
title: Magic Bridge Privacy Policy
permalink: /en/privacy/magic-bridge/
description: Local data processing, GitHub authentication, and privacy information for Magic Bridge.
lang: en
translation_key: magic-bridge-privacy
nav: false
---

Last updated: August 8, 2026

Magic Bridge is a macOS utility connecting Apple Notes, Magic Notes, and this website. It follows two principles: notes stay local, and identity access stays minimal.

## Local note data

- The Apple Notes database is processed read-only on the Mac only after the user explicitly starts a migration.
- A checklist hand-off package carries checked state to Magic Notes. It is readable only by the current user and is removed after import.
- Note titles, bodies, attachments, and checklist content are not sent to this site, Cloudflare, GitHub, or any other server.

## Website connection data

When the user selects “Connect website,” Magic Bridge uses the system browser and GitHub OAuth to verify identity. The service processes the GitHub user ID, login, and OAuth credentials supplied by GitHub. OAuth credentials are never embedded in the app; the Mac stores only a server-sealed session in Keychain.

A PKCE authorization code lasts no more than five minutes and is deleted after use. A sealed session lasts up to 30 days and can be disconnected and removed from Keychain at any time. Network requests are served by Cloudflare Workers, and authentication is provided by GitHub.

## Use and sharing

Identity data is used only to verify the site owner and establish the personal-site connection. Magic Bridge has no advertising or cross-site tracking, does not sell personal data, and does not use note content for analytics or training.

## Controls and contact

Users can disconnect inside Magic Bridge and revoke authorization in GitHub’s authorized-app settings. For questions or deletion requests concerning connection data, contact [functionhx@gmail.com](mailto:functionhx@gmail.com).
