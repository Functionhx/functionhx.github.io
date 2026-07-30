---
layout: page
title: 工具
permalink: /tools/
description: 自己做的小玩意、公开产品与实验性工具；通用照片为原版占位。
lang: zh
translation_key: tools
nav: false
---

<div class="projects">
  {% assign localized_projects = site.projects | where: "lang", "zh" | where: "kind", "tool" | sort: "importance" %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for project in localized_projects %}
      {% include projects.liquid %}
    {% endfor %}
  </div>
</div>
