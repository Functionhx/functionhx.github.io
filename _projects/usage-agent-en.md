---
layout: page
title: Usage Agent
description: Automatic daily token usage and cost tracking for AI coding tools.
permalink: /en/tools/usage-agent/
lang: en
translation_key: usage-agent
kind: tool
importance: 3
category: fun
---

Aggregates daily token usage and estimated cost across AI coding tools (Claude Code, Codex, OpenCode). Each machine parses its own logs locally and publishes only aggregate numbers as public JSON; the monitor below reads that endpoint every five minutes and reports explicitly when it is unavailable.

What is published is limited to daily totals and a per-model breakdown — **no project names, file paths, or message content**.

{% include usage-monitor.liquid %}

[Open the full dashboard](https://functionhx.github.io/usage-agent/)
