---
layout: page
title: Kaggle Agent
description: Kaggle 竞赛实验、分数、额度与待决策状态监控。
permalink: /tools/kaggle-agent/
lang: zh
translation_key: kaggle-agent
kind: tool
importance: 2
category: fun
img: assets/img/1.jpg
---

用于汇总 Kaggle 竞赛的 CV / LB 分数、目标差距、当日额度与待决策实验。下方监控每五分钟请求一次公开 JSON 数据源；如果数据源尚未部署或不可访问，页面会明确显示“数据暂不可用”。

{% include kaggle-monitor.liquid %}

[打开 Kaggle Agent dashboard](https://functionhx.github.io/kaggle-agent/)
