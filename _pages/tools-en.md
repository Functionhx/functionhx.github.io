---
layout: page
title: tools
permalink: /en/tools/
description: Browser tools and native applications built for macOS.
lang: en
translation_key: tools
nav: true
nav_order: 10
---

{% assign localized_projects = site.projects | where: "lang", "en" | where: "kind", "tool" | sort: "importance" %}
{% assign online_tools = localized_projects | where_exp: "project", "project.category != 'macapp'" %}
{% assign mac_apps = localized_projects | where: "category", "macapp" %}

<nav class="tool-family-nav" aria-label="Tool categories">
  <a href="#online-tools">Online tools <span>{{ online_tools | size }}</span></a>
  <a href="#macapp">MacAPP <span>{{ mac_apps | size }}</span></a>
</nav>

<section id="online-tools" class="tool-family" aria-labelledby="online-tools-title">
  <header class="tool-family__heading">
    <div>
      <p class="tool-family__eyebrow">WEB · EXPERIMENTS</p>
      <h2 id="online-tools-title">Online tools</h2>
    </div>
    <p>Small products and experiments that open in a browser.</p>
  </header>
  <div class="projects">
    <div class="row row-cols-1 row-cols-md-3">
      {% for project in online_tools %}
        {% include projects.liquid %}
      {% endfor %}
    </div>
  </div>
</section>

<section id="macapp" class="tool-family tool-family--macapp" aria-labelledby="macapp-title">
  <header class="tool-family__heading">
    <div>
      <p class="tool-family__eyebrow">NATIVE · MACOS</p>
      <h2 id="macapp-title">MacAPP</h2>
    </div>
    <p>Native Mac apps built around workflows I actually use.</p>
  </header>
  <div class="macapp-grid">
    {% for project in mac_apps %}
      {% include macapp-card.liquid project=project %}
    {% endfor %}
  </div>
</section>
