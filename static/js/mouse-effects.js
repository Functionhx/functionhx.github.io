// Optional visual effects. All effects default to off and respect reduced motion.
(function () {
  'use strict';

  var DEFAULTS = {
    magnetic: false,
    tilt: false,
    spotlight: false,
    ripple: false,
    shimmer: false,
    cursor: false,
    reveal: false
  };
  var isEnglish = document.documentElement.lang === 'en';
  var effects = [
    ['magnetic', isEnglish ? 'Magnetic links' : '链接磁吸'],
    ['tilt', isEnglish ? 'Card tilt' : '卡片倾斜'],
    ['spotlight', isEnglish ? 'Pointer spotlight' : '光标聚光灯'],
    ['ripple', isEnglish ? 'Click ripple' : '点击涟漪'],
    ['shimmer', isEnglish ? 'Hover shimmer' : '悬停扫光'],
    ['cursor', isEnglish ? 'Custom pointer' : '自定义光标'],
    ['reveal', isEnglish ? 'Scroll reveal' : '滚动入场']
  ];

  function readSetting(name) {
    try {
      return window.localStorage.getItem('fx:' + name);
    } catch (error) {
      return null;
    }
  }

  function writeSetting(name, value) {
    try {
      window.localStorage.setItem('fx:' + name, value);
    } catch (error) {
      // Storage can be unavailable in hardened browsing modes.
    }
  }

  function fxOn(name) {
    var value = readSetting(name);
    if (value === 'on') return true;
    if (value === 'off') return false;
    return DEFAULTS[name] === true;
  }

  function ready(callback) {
    if (document.readyState !== 'loading') callback();
    else document.addEventListener('DOMContentLoaded', callback, { once: true });
  }

  function magnetic() {
    var strength = 0.22;
    document.querySelectorAll('.menu a, .header-actions a, .header-actions button').forEach(function (element) {
      element.addEventListener('mousemove', function (event) {
        var rect = element.getBoundingClientRect();
        var x = event.clientX - (rect.left + rect.width / 2);
        var y = event.clientY - (rect.top + rect.height / 2);
        element.style.transform = 'translate(' + (x * strength).toFixed(1) + 'px,' + (y * strength).toFixed(1) + 'px)';
      });
      element.addEventListener('mouseleave', function () {
        element.style.transform = '';
      });
    });
  }

  function tilt() {
    var maxAngle = 4;
    var selector = '.crit-card, .post-entry, .first-entry, .project-card, .focus-card, .fx-demo-card';
    document.querySelectorAll(selector).forEach(function (card) {
      card.addEventListener('mousemove', function (event) {
        var rect = card.getBoundingClientRect();
        var x = (event.clientX - rect.left) / rect.width;
        var y = (event.clientY - rect.top) / rect.height;
        var rotateY = (x - 0.5) * maxAngle * 2;
        var rotateX = -(y - 0.5) * maxAngle * 2;
        card.style.transform = 'perspective(900px) rotateX(' + rotateX.toFixed(2) + 'deg) rotateY(' + rotateY.toFixed(2) + 'deg)';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  function spotlight() {
    var overlay = document.createElement('div');
    var frame = null;
    var x = 0;
    var y = 0;
    overlay.className = 'cursor-spotlight';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);
    window.addEventListener('pointermove', function (event) {
      x = event.clientX;
      y = event.clientY;
      if (frame) return;
      frame = window.requestAnimationFrame(function () {
        overlay.style.setProperty('--mx', x + 'px');
        overlay.style.setProperty('--my', y + 'px');
        frame = null;
      });
    }, { passive: true });
  }

  function ripple() {
    document.addEventListener('click', function (event) {
      var ring = document.createElement('span');
      ring.className = 'fx-ripple';
      ring.setAttribute('aria-hidden', 'true');
      ring.style.left = event.clientX + 'px';
      ring.style.top = event.clientY + 'px';
      document.body.appendChild(ring);
      ring.addEventListener('animationend', function () {
        ring.remove();
      }, { once: true });
    });
  }

  function shimmer() {
    document.body.classList.add('fx-shimmer-on');
  }

  function cursor() {
    var dot = document.createElement('div');
    var ring = document.createElement('div');
    var ringX = 0;
    var ringY = 0;
    var mouseX = 0;
    var mouseY = 0;
    var frame = null;
    dot.className = 'fx-cursor-dot';
    ring.className = 'fx-cursor-ring';
    dot.setAttribute('aria-hidden', 'true');
    ring.setAttribute('aria-hidden', 'true');
    document.body.classList.add('fx-cursor-on');
    document.body.appendChild(dot);
    document.body.appendChild(ring);

    function drawRing() {
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;
      ring.style.transform = 'translate(' + ringX.toFixed(1) + 'px,' + ringY.toFixed(1) + 'px)';
      if (Math.abs(mouseX - ringX) > 0.2 || Math.abs(mouseY - ringY) > 0.2) {
        frame = window.requestAnimationFrame(drawRing);
      } else {
        frame = null;
      }
    }

    window.addEventListener('pointermove', function (event) {
      mouseX = event.clientX;
      mouseY = event.clientY;
      dot.style.transform = 'translate(' + mouseX + 'px,' + mouseY + 'px)';
      if (!frame) frame = window.requestAnimationFrame(drawRing);
    }, { passive: true });
  }

  function reveal() {
    var targets = document.querySelectorAll('.post-entry, .first-entry, .crit-card, .project-card, .focus-card, .fx-demo-card');
    targets.forEach(function (element) {
      element.classList.add('fx-reveal');
    });
    if (!('IntersectionObserver' in window)) {
      targets.forEach(function (element) {
        element.classList.add('fx-revealed');
      });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('fx-revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    targets.forEach(function (element) {
      observer.observe(element);
    });
  }

  function renderFxToggles(container) {
    if (!container) return;
    container.innerHTML = '';
    effects.forEach(function (effect) {
      var row = document.createElement('label');
      var checkbox = document.createElement('input');
      row.className = 'fx-row';
      checkbox.type = 'checkbox';
      checkbox.checked = fxOn(effect[0]);
      checkbox.addEventListener('change', function () {
        writeSetting(effect[0], checkbox.checked ? 'on' : 'off');
        window.location.reload();
      });
      row.appendChild(checkbox);
      row.appendChild(document.createTextNode(effect[1]));
      container.appendChild(row);
    });
  }

  function initGear() {
    var button = document.createElement('button');
    var panel = document.createElement('div');
    var labPath = isEnglish ? '/en/fx/' : '/fx/';
    button.type = 'button';
    button.className = 'fx-gear';
    button.textContent = '⚙';
    button.title = isEnglish ? 'Optional visual effects' : '可选视觉特效';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'fx-popover');
    panel.id = 'fx-popover';
    panel.className = 'fx-pop';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', button.title);
    panel.innerHTML = '<div class="fx-pop-inner"><p class="fx-note">' +
      (isEnglish ? 'Effects are local to this browser and default to off.' : '特效仅保存在当前浏览器，默认全部关闭。') +
      '</p><div class="fx-toggles"></div><a class="fx-lab-link" href="' + labPath + '">' +
      (isEnglish ? 'Open effects lab' : '打开特效实验室') + '</a></div>';
    document.body.appendChild(button);
    document.body.appendChild(panel);
    renderFxToggles(panel.querySelector('.fx-toggles'));

    function closePanel() {
      panel.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      var willOpen = !panel.classList.contains('open');
      panel.classList.toggle('open', willOpen);
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    document.addEventListener('click', function (event) {
      if (panel.classList.contains('open') && !panel.contains(event.target) && event.target !== button) closePanel();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && panel.classList.contains('open')) {
        closePanel();
        button.focus();
      }
    });
  }

  window.FX_RENDER_TOGGLES = renderFxToggles;

  ready(function () {
    var motionAllowed = window.matchMedia('(hover: hover)').matches &&
      window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
    var handlers = {
      magnetic: magnetic,
      tilt: tilt,
      spotlight: spotlight,
      ripple: ripple,
      shimmer: shimmer,
      cursor: cursor,
      reveal: reveal
    };
    if (motionAllowed) {
      Object.keys(handlers).forEach(function (name) {
        if (!fxOn(name)) return;
        try {
          handlers[name]();
        } catch (error) {
          window.console.warn('Optional effect failed:', name, error);
        }
      });
    }
    initGear();
  });
})();
