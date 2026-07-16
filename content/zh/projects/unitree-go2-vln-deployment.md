---
title: "Unitree Go2 VLA / VLN 实机部署"
slug: unitree-go2-vln-deployment
date: 2026-07-16T00:00:00+08:00
lastmod: 2026-07-16T00:00:00+08:00
description: "Unitree Go2 上 VLA / VLN 能力实机部署的高层记录。"
summary: "关注模型输入输出、机器人接口、推理链路和安全运行边界。"
translationKey: project-unitree-go2-vln-deployment
status: research
role: ""
organization: ""
period: ""
featured: false
weight: 40
tags: ["具身导航", "VLA", "VLN", "实机部署"]
technologies: ["Unitree Go2", "VLA", "VLN", "Inference Deployment"]
links: {}
metrics: []
confidential: false
comments: false
source:
  status: user-provided
  last_verified: 2026-07-16
translation:
  source_language: zh-cn
  status: canonical
  reviewed: true
---

## Overview

本页记录 Unitree Go2 上 VLA / VLN 能力的实机部署经历。它不把研究模型的通用能力等同于可直接运行的机器人系统。

## Problem

从模型到实机需要明确观测与指令格式、推理延迟、动作约束、状态机、通信故障和人工接管边界。部署可靠性来自模型、系统和安全策略的共同约束。

## System Architecture

公开页面按“传感与任务输入 → 模型推理适配 → 行为 / 动作接口 → 机器人执行 → 遥测与安全监控”的边界组织。

## Limitations

当前不公开未提供的模型版本、场景成功率、数据集、硬件算力或个人职责细节。

<!-- TODO(owner): 添加可公开的部署拓扑、延迟测量、失败案例、演示与个人贡献边界。 -->
