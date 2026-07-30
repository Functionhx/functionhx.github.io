---
layout: page
title: 项目
permalink: /projects/
description: 工程项目与系统实践。每条记录均标注当前状态与信息来源。
lang: zh
translation_key: projects
nav: true
nav_order: 1
---

<div class="projects">
  {% assign localized_projects = site.projects | where: "lang", "zh" | where: "kind", "project" | sort: "importance" %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for project in localized_projects %}
      {% include projects.liquid %}
    {% endfor %}
  </div>
</div>
