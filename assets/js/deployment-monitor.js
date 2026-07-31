(function initializeDeploymentMonitor() {
  "use strict";

  const root = document.getElementById("site-deployment-monitor");
  if (!root) return;

  const repository = root.dataset.repository;
  const owner = repository.split("/")[0];
  const isEnglish = root.dataset.language === "en";
  const storageKey = `functionhx:deployment:${repository}`;
  const config = window.functionhxDeploymentConfig || {};
  const pollInterval = Math.max(20, Number(config.pollInterval) || 7000);
  const maxWait = Math.max(1000, Number(config.maxWait) || 15 * 60 * 1000);
  const strings = isEnglish
    ? {
        building: "GitHub Pages is building and deploying this commit…",
        failed: "Publishing failed. Open the build details to inspect it.",
        queued: "The commit is queued for GitHub Pages.",
        retrying: "The publishing status is temporarily unavailable; retrying…",
        ready: "The new version is live. Refresh when you are ready.",
        timedOut: "Publishing is taking longer than expected. Check the build details.",
        waiting: "Waiting for GitHub Actions to pick up this commit…",
      }
    : {
        building: "GitHub Pages 正在构建并部署这次提交…",
        failed: "发布失败，请打开构建详情检查。",
        queued: "这次提交已进入 GitHub Pages 队列。",
        retrying: "暂时无法读取发布状态，正在重试…",
        ready: "新版本已经上线，可以刷新查看。",
        timedOut: "发布耗时超出预期，请打开构建详情查看。",
        waiting: "正在等待 GitHub Actions 接收这次提交…",
      };

  const elements = {
    close: document.getElementById("site-deployment-monitor-close"),
    commit: document.getElementById("site-deployment-monitor-commit"),
    elapsed: document.getElementById("site-deployment-monitor-elapsed"),
    progress: document.getElementById("site-deployment-monitor-progress"),
    refresh: document.getElementById("site-deployment-monitor-refresh"),
    run: document.getElementById("site-deployment-monitor-run"),
    status: document.getElementById("site-deployment-monitor-status"),
  };
  const steps = [...root.querySelectorAll("[data-monitor-step]")];
  if (Object.values(elements).some((element) => !element) || !repository || steps.length !== 4) return;

  let current = null;
  let pollTimer = 0;
  let elapsedTimer = 0;
  let pollErrors = 0;

  function readStored() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      return parsed?.sha && parsed?.startedAt ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function saveStored(value) {
    current = value;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch (_error) {
      // The live monitor still works when browser storage is unavailable.
    }
  }

  function clearTimers() {
    window.clearTimeout(pollTimer);
    window.clearInterval(elapsedTimer);
    pollTimer = 0;
    elapsedTimer = 0;
  }

  function formatElapsed() {
    if (!current) return "0:00";
    const seconds = Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function updateElapsed() {
    elements.elapsed.textContent = formatElapsed();
  }

  function updateSteps(stage) {
    const order = ["commit", "queue", "build", "ready"];
    const currentIndex = order.indexOf(stage);
    steps.forEach((step, index) => {
      step.dataset.complete = String(index < currentIndex || (stage === "ready" && index === currentIndex));
      step.dataset.current = String(index === currentIndex && stage !== "ready");
    });
  }

  function render({ message, progress, stage, state = "running" }) {
    root.hidden = false;
    root.dataset.state = state;
    root.dataset.stage = stage;
    elements.status.textContent = message;
    elements.progress.setAttribute("aria-valuenow", String(progress));
    elements.progress.firstElementChild.style.width = `${progress}%`;
    updateSteps(stage);
    updateElapsed();
  }

  async function githubRuns(sha) {
    const url = new URL(`https://api.github.com/repos/${repository}/actions/runs`);
    url.searchParams.set("event", "push");
    url.searchParams.set("head_sha", sha);
    url.searchParams.set("per_page", "5");
    const credential = await window.functionhxGitHubAuth?.restore({ owner, repository }).catch(() => null);
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    };
    if (credential?.token) headers.Authorization = `Bearer ${credential.token}`;
    let response = await window.fetch(url, {
      cache: "no-store",
      headers,
    });
    if ((response.status === 401 || response.status === 403) && headers.Authorization) {
      delete headers.Authorization;
      response = await window.fetch(url, { cache: "no-store", headers });
    }
    if (!response.ok) throw new Error(`GitHub Actions API ${response.status}`);
    const payload = await response.json();
    return (payload.workflow_runs || []).find((run) => run.head_sha === sha) || null;
  }

  function schedulePoll() {
    window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(poll, pollInterval);
  }

  async function poll() {
    if (!current) return;
    if (Date.now() - current.startedAt > maxWait) {
      render({ message: strings.timedOut, progress: 85, stage: "build", state: "failure" });
      clearTimers();
      return;
    }

    try {
      const run = await githubRuns(current.sha);
      pollErrors = 0;
      if (!run) {
        render({ message: strings.waiting, progress: 22, stage: "queue" });
        schedulePoll();
        return;
      }
      if (run.html_url) {
        current.runUrl = run.html_url;
        saveStored(current);
        elements.run.href = run.html_url;
        elements.run.hidden = false;
      }
      if (run.status === "completed") {
        if (run.conclusion === "success") {
          current.state = "success";
          saveStored(current);
          render({ message: strings.ready, progress: 100, stage: "ready", state: "success" });
          elements.refresh.hidden = false;
        } else {
          current.state = "failure";
          saveStored(current);
          render({ message: strings.failed, progress: 100, stage: "build", state: "failure" });
        }
        clearTimers();
        return;
      }
      if (run.status === "queued" || run.status === "waiting" || run.status === "pending") {
        render({ message: strings.queued, progress: 36, stage: "queue" });
      } else {
        render({ message: strings.building, progress: 68, stage: "build" });
      }
      schedulePoll();
    } catch (_error) {
      pollErrors += 1;
      if (pollErrors < 3) {
        render({ message: strings.retrying, progress: 68, stage: "build" });
        schedulePoll();
      } else {
        render({ message: strings.timedOut, progress: 68, stage: "build", state: "failure" });
        clearTimers();
      }
    }
  }

  function watch(commit) {
    const sha = String(commit?.sha || "").trim();
    if (!sha) return;
    clearTimers();
    pollErrors = 0;
    saveStored({
      commitUrl: commit.html_url || `https://github.com/${repository}/commit/${sha}`,
      sha,
      startedAt: Date.now(),
      state: "pending",
    });
    elements.commit.href = current.commitUrl;
    elements.run.hidden = true;
    elements.refresh.hidden = true;
    render({ message: strings.waiting, progress: 15, stage: "commit" });
    elapsedTimer = window.setInterval(updateElapsed, 1000);
    poll();
  }

  function resume() {
    const stored = readStored();
    if (!stored) return;
    current = stored;
    elements.commit.href = current.commitUrl || `https://github.com/${repository}/commit/${current.sha}`;
    if (current.runUrl) {
      elements.run.href = current.runUrl;
      elements.run.hidden = false;
    }
    if (current.state === "success") {
      render({ message: strings.ready, progress: 100, stage: "ready", state: "success" });
      elements.refresh.hidden = false;
      return;
    }
    if (current.state === "failure") {
      render({ message: strings.failed, progress: 100, stage: "build", state: "failure" });
      return;
    }
    render({ message: strings.waiting, progress: 22, stage: "queue" });
    elapsedTimer = window.setInterval(updateElapsed, 1000);
    poll();
  }

  elements.close.addEventListener("click", () => {
    clearTimers();
    root.hidden = true;
    try {
      window.localStorage.removeItem(storageKey);
    } catch (_error) {
      // Nothing else is required when browser storage is unavailable.
    }
    current = null;
  });
  elements.refresh.addEventListener("click", () => window.location.reload());

  window.functionhxDeployment = Object.freeze({ watch });
  resume();
})();
