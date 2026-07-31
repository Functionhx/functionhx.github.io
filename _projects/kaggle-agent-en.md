---
layout: page
title: Kaggle Agent
description: Monitor experiments, scores, quota, and pending decisions.
permalink: /en/tools/kaggle-agent/
lang: en
translation_key: kaggle-agent
kind: tool
importance: 2
category: fun
img: https://arcprize.org/media/images/blog/arc-agi-task-1ae2feb7.png?v=2
---

Tracks Kaggle competition CV / LB scores, target gap, daily quota, and experiments awaiting a decision. The monitor below requests the public JSON endpoint every five minutes; when the endpoint is not deployed or unavailable, it reports that state explicitly.

{% include kaggle-monitor.liquid %}

[Open the Kaggle Agent dashboard](https://functionhx.github.io/kaggle-agent/)
