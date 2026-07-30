---
layout: page
title: tools
permalink: /en/tools/
description: Small things I build, public products, and experimental tools.
lang: en
translation_key: tools
nav: true
nav_order: 3
---

<div class="projects">
  {% assign localized_projects = site.projects | where: "lang", "en" | where: "kind", "tool" | sort: "importance" %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for project in localized_projects %}
      {% include projects.liquid %}
    {% endfor %}
  </div>
</div>
