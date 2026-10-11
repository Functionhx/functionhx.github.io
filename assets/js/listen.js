(function initializeListen() {
  "use strict";

  // 「见山」里的播客页 /notes/podcast/（_includes/listen-series.liquid）。音频只在腾讯云镜像上：在镜像上接管为页内播放器，
  // 在其他主机（GitHub Pages）上把每一集改成镜像上同一集的链接，并显示去哪里收听。
  // 只用 localStorage 记住听到哪一集、第几秒、倍速与音量；不发其他请求。
  const RATES = [1, 1.25, 1.5, 2];
  const pad = (value) => String(value).padStart(2, "0");
  const clock = (seconds) => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const hours = Math.floor(total / 3600);
    const rest = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    return hours ? `${hours}:${rest}` : rest;
  };

  document.querySelectorAll("[data-listen-series]").forEach((section) => {
    const { listenSeries: slug, listenMirror: mirror } = section.dataset;
    const $ = (selector) => section.querySelector(selector);
    const rows = [...section.querySelectorAll("[data-listen-episode]")];
    // 列表按官方页面倒序显示（最新一集在上），上一集 / 下一集 / 连播按编号顺序走。
    const ordered = [...rows].sort((a, b) => a.dataset.listenEpisode.localeCompare(b.dataset.listenEpisode));

    $("[data-listen-filter-wrap]").hidden = false;
    $("[data-listen-filter]").addEventListener("input", (event) => {
      const query = event.target.value.trim().toLowerCase();
      let shown = 0;
      rows.forEach((row) => {
        const visible = !query || row.textContent.toLowerCase().includes(query);
        row.hidden = !visible;
        if (visible) shown += 1;
      });
      $("[data-listen-empty]").hidden = shown > 0;
    });

    let onMirror = false;
    try {
      onMirror = new URL(mirror).origin === window.location.origin;
    } catch {
      onMirror = false;
    }
    if (!onMirror) {
      $("[data-listen-away]").hidden = false;
      rows.forEach((row) => {
        row.querySelector(".listen-episode").href = `${section.dataset.listenPage}#ep-${row.dataset.listenEpisode}`;
      });
      return;
    }

    const player = $("[data-listen-player]");
    const audio = $("[data-listen-audio]");
    const seek = $("[data-listen-seek]");
    const elapsed = $("[data-listen-elapsed]");
    const duration = $("[data-listen-duration]");
    const toggle = $("[data-listen-toggle]");
    const rateButton = $("[data-listen-rate]");
    const volume = $("[data-listen-volume]");
    const storageKey = `functionhx:listen:${slug}`;
    let current = -1;
    let rate = 1;
    let seeking = false;
    let lastSaved = 0;
    let pendingAt = 0; // 预选上次那一集时，元数据加载前要跳到的位置

    function load() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(storageKey) || "null");
        return saved && typeof saved.n === "string" ? saved : null;
      } catch {
        return null;
      }
    }

    function save(force) {
      if (current < 0) return;
      const now = Date.now();
      if (!force && now - lastSaved < 5000) return;
      lastSaved = now;
      try {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            n: ordered[current].dataset.listenEpisode,
            t: Math.floor(pendingAt || audio.currentTime || 0),
            rate,
            volume: audio.volume,
          })
        );
      } catch {
        // 隐私模式等情况下存不了，播放不受影响。
      }
    }

    function titleOf(index) {
      return ordered[index].querySelector(".listen-episode__title").textContent.trim();
    }

    function setRate(value) {
      rate = RATES.includes(value) ? value : 1;
      // 换音频源时浏览器会把 playbackRate 重置为 defaultPlaybackRate，两个都设。
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
      rateButton.textContent = `${rate}×`;
      rateButton.setAttribute("aria-label", `播放速度 ${rate} 倍，点击切换`);
    }

    function updateMediaSession(index) {
      if (!("mediaSession" in navigator) || typeof window.MediaMetadata !== "function") return;
      const cover = section.dataset.listenCover;
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: `${ordered[index].dataset.listenEpisode} ${titleOf(index)}`,
        artist: section.dataset.listenAuthor,
        album: section.dataset.listenTitle,
        artwork: cover ? [{ src: new URL(cover, window.location.href).href, sizes: "400x400", type: "image/webp" }] : [],
      });
    }

    function select(index, { play = true, at = 0 } = {}) {
      if (index < 0 || index >= ordered.length) return;
      rows.forEach((row) => row.querySelector(".listen-episode").removeAttribute("aria-current"));
      current = index;
      const row = ordered[index];
      row.querySelector(".listen-episode").setAttribute("aria-current", "true");
      audio.src = row.querySelector(".listen-episode").dataset.listenSrc;
      audio.playbackRate = rate;
      $("[data-listen-now-label]").textContent =
        at > 0 ? `上次听到 ${clock(at)} · 第 ${row.dataset.listenEpisode} 集` : `正在播放 · 第 ${row.dataset.listenEpisode} 集`;
      $("[data-listen-now-title]").textContent = titleOf(index);
      seek.value = "0";
      seek.max = "0";
      elapsed.textContent = clock(at);
      duration.textContent = row.querySelector(".listen-episode__time").textContent.trim();
      pendingAt = at;
      if (at > 0) {
        audio.addEventListener(
          "loadedmetadata",
          () => {
            audio.currentTime = at;
            pendingAt = 0;
          },
          { once: true }
        );
      }
      updateMediaSession(index);
      if (play) {
        audio.play().catch(() => {
          // 浏览器拦截了自动播放：点一下播放键即可。
        });
      } else {
        audio.preload = "metadata";
        audio.load();
      }
      save(true);
    }

    function step(delta) {
      if (current < 0) return;
      select(Math.min(ordered.length - 1, Math.max(0, current + delta)));
    }

    function skip(seconds) {
      if (current < 0 || !Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + seconds));
    }

    function togglePlay() {
      if (current < 0) select(0);
      else if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    }

    player.hidden = false;
    rows.forEach((row) => {
      row.querySelector(".listen-episode").addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        const index = ordered.indexOf(row);
        if (index === current) togglePlay();
        else select(index);
        if (window.history.replaceState) window.history.replaceState(null, "", `#ep-${row.dataset.listenEpisode}`);
      });
    });
    toggle.addEventListener("click", togglePlay);
    $("[data-listen-prev]").addEventListener("click", () => step(-1));
    $("[data-listen-next]").addEventListener("click", () => step(1));
    $("[data-listen-back]").addEventListener("click", () => skip(-15));
    $("[data-listen-forward]").addEventListener("click", () => skip(15));
    rateButton.addEventListener("click", () => {
      setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]);
      save(true);
    });
    volume.addEventListener("input", () => {
      audio.volume = Number(volume.value);
      save(true);
    });
    seek.addEventListener("input", () => {
      seeking = true;
      elapsed.textContent = clock(Number(seek.value));
    });
    seek.addEventListener("change", () => {
      seeking = false;
      if (Number.isFinite(audio.duration)) audio.currentTime = Number(seek.value);
    });

    audio.addEventListener("loadedmetadata", () => {
      seek.max = String(Math.floor(audio.duration));
      duration.textContent = clock(Math.round(audio.duration)); // 与分集表一致（四舍五入）
    });
    audio.addEventListener("timeupdate", () => {
      if (!seeking) {
        seek.value = String(Math.floor(audio.currentTime));
        elapsed.textContent = clock(audio.currentTime);
      }
      seek.style.setProperty("--listen-progress", `${(audio.currentTime / (audio.duration || 1)) * 100}%`);
      save(false);
    });
    audio.addEventListener("play", () => {
      player.classList.add("is-playing");
      toggle.setAttribute("aria-label", "暂停");
      if (current >= 0) $("[data-listen-now-label]").textContent = `正在播放 · 第 ${ordered[current].dataset.listenEpisode} 集`;
    });
    audio.addEventListener("pause", () => {
      player.classList.remove("is-playing");
      toggle.setAttribute("aria-label", "播放");
      save(true);
    });
    audio.addEventListener("ended", () => {
      if (current + 1 < ordered.length) select(current + 1);
    });
    window.addEventListener("pagehide", () => save(true));

    if ("mediaSession" in navigator) {
      const actions = {
        play: () => audio.play().catch(() => {}),
        pause: () => audio.pause(),
        previoustrack: () => step(-1),
        nexttrack: () => step(1),
        seekbackward: () => skip(-15),
        seekforward: () => skip(15),
      };
      Object.entries(actions).forEach(([action, handler]) => {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch {
          // 旧浏览器不支持某个动作，忽略。
        }
      });
    }

    // 预先选好一集（不出声，浏览器也不允许未经点击就播放）：
    // 链接里的 #ep-NNN（从 GitHub Pages 跳过来）> 上次听到的那一集 > 第一集。
    const saved = load();
    if (saved) {
      setRate(saved.rate);
      if (typeof saved.volume === "number") {
        audio.volume = Math.min(1, Math.max(0, saved.volume));
        volume.value = String(audio.volume);
      }
    }
    const byNumber = (n) => ordered.findIndex((row) => row.dataset.listenEpisode === n);
    const fromHash = window.location.hash.match(/^#ep-(\d+)$/);
    const hashIndex = fromHash ? byNumber(fromHash[1]) : -1;
    const savedIndex = saved ? byNumber(saved.n) : -1;
    if (hashIndex >= 0) {
      select(hashIndex, { play: false, at: savedIndex === hashIndex ? saved.t : 0 });
      // 分集行没有 id，浏览器不会按锚点把整页滚走；这里让播放器进入视野，列表自己滚到这一集。
      const list = $(".listen-episodes");
      list.scrollTop = Math.max(0, ordered[hashIndex].offsetTop - 8);
      window.scrollTo({ top: Math.max(0, player.getBoundingClientRect().top + window.scrollY - 96) });
    } else if (savedIndex >= 0) {
      select(savedIndex, { play: false, at: saved.t });
    } else {
      select(0, { play: false });
    }
  });
})();
