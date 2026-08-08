---
layout: page
title: Magic Bridge
description: A safer handshake between Apple Notes, Magic Notes, and the personal site.
permalink: /en/tools/macapp/magic-bridge/
github: https://github.com/Functionhx/magic-bridge
lang: en
translation_key: macapp-magic-bridge
kind: tool
importance: 11
category: macapp
img: assets/img/tools/macos/magic-bridge.webp
og_image: /assets/img/tools/macos/magic-bridge.webp
image_alt: Magic Bridge app icon
image_width: 640
image_height: 640
app_visual: bridge
platform: macOS 14+
distribution_label: Open source · Local build
product_note: It separates two privileged operations—reading Apple Notes and connecting the personal site—from the notes editor itself.
---

{% include macapp-detail-hero.liquid %}

## One bridge, two paths

Magic Bridge is not another notes app. It is the native permission boundary around Magic Notes, working only when a migration or connection is explicitly requested so privileged operations remain visible, controllable, and auditable.

- Restores native checklist state from a consistent, read-only Apple Notes snapshot.
- Hands off a one-time `0600` migration package locally and removes it after import.
- Connects the personal site through the system OAuth window and PKCE S256.
- GitHub tokens and OAuth secrets remain server-side; the Mac stores only a sealed session.

## Get it

The complete source and Xcode project are available today. The Release configuration already prepares sandbox and privacy declarations, but this site links to source until Apple Developer signing and notarization are complete.
