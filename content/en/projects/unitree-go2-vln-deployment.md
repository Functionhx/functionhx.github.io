---
title: "Unitree Go2 VLA / VLN Deployment"
slug: unitree-go2-vln-deployment
date: 2026-07-16T00:00:00+08:00
lastmod: 2026-07-16T00:00:00+08:00
description: "A high-level record of deploying VLA / VLN capabilities on Unitree Go2."
summary: "Model I/O, robot interfaces, the inference path, and safe operating boundaries."
translationKey: project-unitree-go2-vln-deployment
status: research
role: ""
organization: ""
period: ""
featured: false
weight: 40
tags: ["Embodied Navigation", "VLA", "VLN", "Robot Deployment"]
technologies: ["Unitree Go2", "VLA", "VLN", "Inference Deployment"]
links: {}
metrics: []
confidential: false
comments: false
source:
  status: user-provided
  last_verified: 2026-07-16
translation:
  source: content/zh/projects/unitree-go2-vln-deployment.md
  status: review-required
  model: codex-initial-draft
  translated_at: 2026-07-16T00:00:00+08:00
  reviewed: false
---

## Overview

This page records deployment work for VLA / VLN capabilities on Unitree Go2. It does not equate a research model's general capability with a robot system that is ready to operate.

## Problem

Moving from a model to a real robot requires explicit observation and command formats, inference latency, action constraints, state machines, communication-failure handling, and human takeover boundaries. Deployment reliability is a property of the model, system, and safety policy together.

## System Architecture

The public boundary is sensing and task input → model-inference adapter → behavior/action interface → robot execution → telemetry and safety monitoring.

## Limitations

The model version, scenario success rate, dataset, compute hardware, and detailed role are not published because they were not supplied for verification.

<!-- TODO(owner): Add a publishable deployment topology, latency measurements, failure cases, demo, and contribution boundary. -->
