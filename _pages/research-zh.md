---
layout: page
title: 研究
permalink: /research/
description: 当前研究方向与可公开的高层记录；预披露细节不在这里展开。
lang: zh
translation_key: research
nav: true
nav_order: 2
---

<div class="projects">
  {% assign localized_projects = site.projects | where: "lang", "zh" | where: "kind", "research" | sort: "importance" %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for project in localized_projects %}
      {% include projects.liquid %}
    {% endfor %}
  </div>
</div>
