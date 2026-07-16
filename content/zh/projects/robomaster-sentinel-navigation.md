---
title: "RoboMaster 哨兵导航与定位"
slug: robomaster-sentinel-navigation
date: 2026-07-16T00:00:00+08:00
lastmod: 2026-07-16T00:00:00+08:00
description: "RoboMaster 哨兵机器人导航与定位经历的工程记录。"
summary: "面向动态对抗环境的定位、地图、规划与恢复机制问题。"
translationKey: project-robomaster-sentinel-navigation
status: completed
role: ""
organization: ""
period: ""
featured: false
weight: 30
tags: ["机器人导航", "定位", "RoboMaster"]
technologies: ["Localization", "Navigation", "RoboMaster"]
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

本页记录 RoboMaster 哨兵导航与定位经历，并将其与雷达站多传感器融合经历区分开来。未提供的赛季、队伍与个人职责不会被推断。

## Problem

动态对抗环境中的导航需要持续处理定位漂移、动态障碍、局部可通行性、路径重规划以及系统异常后的恢复。

## System Architecture

公开结构按“传感器输入 → 状态估计 → 地图与代价表示 → 全局 / 局部规划 → 底盘接口 → 运行监控”组织。

## Limitations

当前不展示未经核验的比赛结果、导航指标、硬件参数或个人贡献比例。

<!-- TODO(owner): 补充赛季、职责、复现场景、调试案例和公开证据。 -->
