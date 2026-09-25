---
layout: page
title: Usage Agent
description: 每日 AI 编程工具 token 用量与花费的自动统计。
permalink: /tools/usage-agent/
lang: zh
translation_key: usage-agent
kind: tool
importance: 3
category: fun
---

汇总 Claude Code、Codex、OpenCode 等 AI 编程工具的每日 token 用量与估算花费。各机器在本地解析自身日志后，只把聚合数字发布成公开 JSON；下方的监控每五分钟读取一次该数据源，数据源不可用时会明确显示“数据暂不可用”。

公开的只有每日总额与按模型拆分，**不含项目名、文件路径或任何对话内容**。

{% include usage-monitor.liquid %}

[打开完整图表](https://functionhx.github.io/usage-agent/)
