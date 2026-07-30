---
layout: page
title: research
permalink: /en/research/
description: Current research directions and public high-level records; pre-disclosure details are intentionally omitted.
lang: en
translation_key: research
nav: true
nav_order: 2
---

<div class="projects">
  {% assign localized_projects = site.projects | where: "lang", "en" | where: "kind", "research" | sort: "importance" %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for project in localized_projects %}
      {% include projects.liquid %}
    {% endfor %}
  </div>
</div>
