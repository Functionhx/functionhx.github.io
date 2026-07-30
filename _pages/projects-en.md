---
layout: page
title: projects
permalink: /en/projects/
description: Engineering projects and systems work. Every record identifies its current status and source.
lang: en
translation_key: projects
nav: true
nav_order: 1
---

<div class="projects">
  {% assign localized_projects = site.projects | where: "lang", "en" | where: "kind", "project" | sort: "importance" %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for project in localized_projects %}
      {% include projects.liquid %}
    {% endfor %}
  </div>
</div>
