(function initializeInlineEditor() {
  "use strict";

  const root = document.getElementById("site-inline-editor");
  const toggle = document.getElementById("site-inline-editor-toggle");
  const renderedContent = document.getElementById("site-rendered-content");
  const authDialog = document.getElementById("site-inline-editor-auth");

  if (!root || !toggle || !renderedContent || !authDialog) return;

  const repository = root.dataset.repository;
  const owner = root.dataset.owner;
  const branch = root.dataset.branch;
  const defaultSourcePath = root.dataset.sourcePath;
  const isEnglish = root.dataset.language === "en";

  function isAllowedSource(path) {
    return typeof path === "string" && /^_(pages|posts|projects|news|teachings|books)\//.test(path) && !path.includes("..") && !path.includes("\\");
  }

  if (!isAllowedSource(defaultSourcePath)) {
    toggle.hidden = true;
    return;
  }

  const strings = isEnglish
    ? {
        authFailed: "GitHub connection failed.",
        authMissing: "Paste a fine-grained token first.",
        authRememberFailed: "Connected for this page, but this browser could not remember the token securely.",
        authRemembered: "Connected as @Functionhx and remembered on this private device.",
        authSuccess: "Connected as @Functionhx for this browser session.",
        commitConflict:
          "GitHub has a newer source. Your changes are preserved. To load GitHub’s version, choose “Discard local draft”; otherwise copy your work and merge it manually.",
        commitFailed: "The commit could not be created.",
        commitSuccess: "Commit created. Follow the publishing progress in the corner.",
        confirmDiscard: "Discard the browser draft and restore the current GitHub version?",
        confirmSwitch: "This file has uncommitted changes. Save them as a browser draft and open the other file?",
        connected: "Disconnect @Functionhx",
        disconnectConfirm: "Forget the trusted GitHub token on this device?",
        disconnected: "The trusted GitHub connection was removed from this device.",
        draftChanged: "Changes are local only and have not been committed.",
        draftFailed: "This browser could not save the local draft.",
        draftRestored: "Recovered a browser draft. Nothing has been sent to GitHub.",
        draftSaved: "Draft saved in this browser. Nothing has been sent to GitHub.",
        loading: window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...",
        loadingFailed: "The Markdown source could not be loaded from GitHub.",
        noChanges: "No uncommitted changes.",
        saving: "Creating a commit on GitHub…",
        untitled: "Untitled",
        verify: "Verifying this token and repository access…",
        viewCommit: "View commit on GitHub →",
      }
    : {
        authFailed: "GitHub 连接失败。",
        authMissing: "请先粘贴 fine-grained token。",
        authRememberFailed: "本页已经连接，但这个浏览器无法安全地记住令牌。",
        authRemembered: "已连接为 @Functionhx，并记住这台私人电脑。",
        authSuccess: "本次浏览器会话已连接为 @Functionhx。",
        commitConflict: "GitHub 源文件已经变化，当前修改仍保留。若要载入 GitHub 最新版，请点“丢弃本地草稿”；否则请先复制当前内容并手工合并。",
        commitFailed: "无法创建 Commit。",
        commitSuccess: "Commit 已创建，请在右下角查看发布进度。",
        confirmDiscard: "丢弃浏览器草稿，恢复到 GitHub 当前版本？",
        confirmSwitch: "当前文件还有未提交的修改。保存为浏览器草稿并打开另一个文件？",
        connected: "退出 @Functionhx",
        disconnectConfirm: "从这台设备移除已记住的 GitHub 令牌？",
        disconnected: "已从这台设备移除 GitHub 连接。",
        draftChanged: "修改仍只在本页和浏览器草稿中，尚未 Commit。",
        draftFailed: "这个浏览器无法保存本地草稿。",
        draftRestored: "已恢复浏览器草稿；内容尚未发送到 GitHub。",
        draftSaved: "草稿已保存在这个浏览器中；内容尚未发送到 GitHub。",
        loading: window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...",
        loadingFailed: "无法从 GitHub 载入 Markdown 源文件。",
        noChanges: "当前没有尚未提交的修改。",
        saving: "正在 GitHub 上创建 Commit…",
        untitled: "无标题",
        verify: "正在验证令牌和仓库权限…",
        viewCommit: "在 GitHub 查看 Commit →",
      };

  const elements = {
    authCancel: document.getElementById("site-inline-editor-auth-cancel"),
    authConnect: document.getElementById("site-inline-editor-auth-connect"),
    authRemember: document.getElementById("site-inline-editor-auth-remember"),
    authStatus: document.getElementById("site-inline-editor-auth-status"),
    body: document.getElementById("site-inline-editor-body"),
    bodyPanel: document.getElementById("site-inline-editor-body-panel"),
    bodyTab: document.getElementById("site-inline-editor-body-tab"),
    close: document.getElementById("site-inline-editor-close"),
    comments: document.getElementById("site-inline-editor-comments"),
    commit: document.getElementById("site-inline-editor-commit"),
    connect: document.getElementById("site-inline-editor-connect"),
    description: document.getElementById("site-inline-editor-description"),
    discard: document.getElementById("site-inline-editor-discard"),
    form: document.getElementById("site-inline-editor-form"),
    frontMatter: document.getElementById("site-inline-editor-front-matter"),
    message: document.getElementById("site-inline-editor-message"),
    metadataPanel: document.getElementById("site-inline-editor-metadata-panel"),
    metadataTab: document.getElementById("site-inline-editor-metadata-tab"),
    path: document.getElementById("site-inline-editor-path"),
    previewBody: document.getElementById("site-inline-editor-preview-body"),
    previewTitle: document.getElementById("site-inline-editor-preview-title"),
    published: document.getElementById("site-inline-editor-published"),
    result: document.getElementById("site-inline-editor-result"),
    save: document.getElementById("site-inline-editor-save"),
    status: document.getElementById("site-inline-editor-status"),
    title: document.getElementById("site-inline-editor-title"),
    token: document.getElementById("site-inline-editor-token"),
  };

  let activeToken = "";
  let activeSourcePath = defaultSourcePath;
  let baseSha = "";
  let sourceText = "";
  let sourceNewline = "\n";
  let editorLoaded = false;
  let editorBusy = false;
  let draftTimer = 0;
  let previewTimer = 0;
  let previousScrollY = 0;
  let restorePromise = Promise.resolve(null);
  let activeTrigger = toggle;
  let loadVersion = 0;
  let editorSession = 0;
  let authVersion = 0;
  let authMutationDepth = 0;
  let authCompletionTimer = 0;
  let verifiedAuthClose = false;
  let commitVersion = 0;
  let commitInFlight = false;
  let authorActionStates = [];
  let commitControlStates = [];
  let pendingCommit = null;
  let conflictRemote = null;
  const disconnectedLabel = elements.connect.querySelector("span")?.textContent.trim() || "GitHub";

  function contentEndpoint(path = activeSourcePath) {
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `/repos/${repository}/contents/${encodedPath}`;
  }

  function draftKey(path = activeSourcePath) {
    return `functionhx:inline-editor:${repository}:${branch}:${path}`;
  }

  function defaultCommitMessage(path = activeSourcePath) {
    return `content: update "${path}"`;
  }

  function setStatus(message, state = "") {
    elements.status.removeAttribute("data-loading-placeholder");
    elements.status.textContent = message;
    if (state) elements.status.dataset.state = state;
    else delete elements.status.dataset.state;
  }

  function setAuthStatus(message, state = "") {
    elements.authStatus.textContent = message;
    if (state) elements.authStatus.dataset.state = state;
    else delete elements.authStatus.dataset.state;
  }

  function setBusy(busy) {
    editorBusy = Boolean(busy || commitInFlight);
    elements.commit.disabled = editorBusy || !isDirty();
    elements.save.disabled = editorBusy;
    elements.discard.disabled = editorBusy;
    elements.authConnect.disabled = editorBusy;
  }

  function setAuthorActionsDisabled(disabled) {
    if (disabled) {
      if (authorActionStates.length) return;
      const controls = new Set([toggle, ...document.querySelectorAll("[data-author-action]")]);
      authorActionStates = [...controls].map((control) => ({
        ariaDisabled: control.getAttribute("aria-disabled"),
        control,
        disabled: "disabled" in control ? control.disabled : null,
      }));
      authorActionStates.forEach(({ control }) => {
        if ("disabled" in control) control.disabled = true;
        control.setAttribute("aria-disabled", "true");
      });
      return;
    }

    authorActionStates.forEach(({ ariaDisabled, control, disabled: wasDisabled }) => {
      if (wasDisabled !== null) control.disabled = wasDisabled;
      if (ariaDisabled === null) control.removeAttribute("aria-disabled");
      else control.setAttribute("aria-disabled", ariaDisabled);
    });
    authorActionStates = [];
  }

  function setCommitControlsDisabled(disabled) {
    const controls = [
      elements.title,
      elements.description,
      elements.published,
      elements.comments,
      elements.body,
      elements.frontMatter,
      elements.message,
      elements.bodyTab,
      elements.metadataTab,
      elements.close,
      elements.connect,
    ];
    if (disabled) {
      if (commitControlStates.length) return;
      commitControlStates = controls.map((control) => ({ control, disabled: control.disabled }));
      commitControlStates.forEach(({ control }) => {
        control.disabled = true;
      });
      return;
    }
    commitControlStates.forEach(({ control, disabled: wasDisabled }) => {
      control.disabled = wasDisabled;
    });
    commitControlStates = [];
  }

  function setCommitLock(locked) {
    commitInFlight = locked;
    root.setAttribute("aria-busy", String(locked));
    setAuthorActionsDisabled(locked);
    setCommitControlsDisabled(locked);
    setBusy(locked);
  }

  function splitSource(source) {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error("Missing YAML front matter");
    sourceNewline = source.includes("\r\n") ? "\r\n" : "\n";
    return {
      frontMatter: match[1].replace(/\r\n/g, "\n"),
      body: source.slice(match[0].length).replace(/\r\n/g, "\n"),
    };
  }

  function composeSource() {
    const frontMatter = elements.frontMatter.value.replace(/\r\n/g, "\n");
    const body = elements.body.value.replace(/\r\n/g, "\n");
    const composed = `---\n${frontMatter}\n---\n${body}`;
    return sourceNewline === "\r\n" ? composed.replace(/\n/g, "\r\n") : composed;
  }

  function extractYamlScalar(frontMatter, key) {
    const match = frontMatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    if (!match) return "";
    const raw = match[1].trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw);
      } catch (_error) {
        return raw.slice(1, -1);
      }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) {
      return raw.slice(1, -1).replace(/''/g, "'");
    }
    return raw;
  }

  function extractYamlBoolean(frontMatter, key) {
    return extractYamlScalar(frontMatter, key).toLowerCase() === "true";
  }

  function hasYamlKey(frontMatter, key) {
    return new RegExp(`^${key}:`, "m").test(frontMatter);
  }

  function setYamlScalar(frontMatter, key, value, type = "string") {
    const serialized = type === "boolean" ? (value ? "true" : "false") : JSON.stringify(String(value));
    const pattern = new RegExp(`^${key}:.*$`, "m");
    if (pattern.test(frontMatter)) return frontMatter.replace(pattern, `${key}: ${serialized}`);
    return `${frontMatter.replace(/\s+$/, "")}\n${key}: ${serialized}`;
  }

  function syncMetadataFromFrontMatter() {
    const frontMatter = elements.frontMatter.value;
    elements.title.value = extractYamlScalar(frontMatter, "title");
    elements.description.value = extractYamlScalar(frontMatter, "description");
    elements.published.checked = hasYamlKey(frontMatter, "published") ? extractYamlBoolean(frontMatter, "published") : true;
    elements.comments.checked = extractYamlBoolean(frontMatter, "giscus_comments");
  }

  function updateMetadataField(key, value, type = "string") {
    elements.frontMatter.value = setYamlScalar(elements.frontMatter.value, key, value, type);
  }

  function hydrateEditor(source) {
    const parsed = splitSource(source);
    elements.frontMatter.value = parsed.frontMatter;
    elements.body.value = parsed.body;
    syncMetadataFromFrontMatter();
    elements.message.value = defaultCommitMessage();
    schedulePreview();
    updateDirtyState();
  }

  function isDirty() {
    return Boolean(sourceText) && composeSource() !== sourceText;
  }

  function updateDirtyState() {
    elements.commit.disabled = editorBusy || !isDirty();
    elements.discard.disabled = editorBusy || !isDirty();
  }

  function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function formatInline(value) {
    let formatted = escapeHtml(value);
    const codeSpans = [];
    formatted = formatted.replace(/`([^`]+)`/g, (_match, code) => {
      const index = codeSpans.push(`<code>${code}</code>`) - 1;
      return `\u0000CODE${index}\u0000`;
    });
    formatted = formatted.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/|#)[^\s)]+)\)/g, '<a href="$2">$1</a>');
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    formatted = formatted.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    formatted = formatted.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    formatted = formatted.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
    return formatted.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => codeSpans[Number(index)]);
  }

  function renderMarkdown(markdown) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const output = [];
    let paragraph = [];
    let listType = "";
    let inFence = false;
    let fenceLines = [];

    function closeParagraph() {
      if (!paragraph.length) return;
      output.push(`<p>${paragraph.map(formatInline).join("<br>")}</p>`);
      paragraph = [];
    }

    function closeList() {
      if (!listType) return;
      output.push(`</${listType}>`);
      listType = "";
    }

    function closeBlocks() {
      closeParagraph();
      closeList();
    }

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        closeBlocks();
        if (inFence) {
          output.push(`<pre><code>${escapeHtml(fenceLines.join("\n"))}</code></pre>`);
          fenceLines = [];
          inFence = false;
        } else {
          inFence = true;
        }
        continue;
      }
      if (inFence) {
        fenceLines.push(line);
        continue;
      }
      if (!line.trim()) {
        closeBlocks();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        closeBlocks();
        const level = heading[1].length;
        output.push(`<h${level}>${formatInline(heading[2])}</h${level}>`);
        continue;
      }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
        closeBlocks();
        output.push("<hr>");
        continue;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        closeBlocks();
        output.push(`<blockquote><p>${formatInline(quote[1])}</p></blockquote>`);
        continue;
      }
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (unordered || ordered) {
        closeParagraph();
        const requestedType = ordered ? "ol" : "ul";
        if (listType && listType !== requestedType) closeList();
        if (!listType) {
          listType = requestedType;
          output.push(`<${listType}>`);
        }
        output.push(`<li>${formatInline((unordered || ordered)[1])}</li>`);
        continue;
      }
      closeList();
      paragraph.push(line);
    }

    if (inFence) output.push(`<pre><code>${escapeHtml(fenceLines.join("\n"))}</code></pre>`);
    closeBlocks();
    return output.join("\n");
  }

  function updatePreview() {
    elements.previewTitle.textContent = elements.title.value || strings.untitled;
    elements.previewBody.innerHTML = renderMarkdown(elements.body.value);
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      window.MathJax.typesetPromise([elements.previewBody]).catch(() => {});
    }
  }

  function schedulePreview() {
    window.clearTimeout(previewTimer);
    const session = editorSession;
    previewTimer = window.setTimeout(() => {
      if (session === editorSession) updatePreview();
    }, 120);
  }

  function saveDraft(showStatus = false) {
    if (!sourceText) return;
    const storageKey = draftKey();
    try {
      if (isDirty()) {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            baseSha,
            source: composeSource(),
            updatedAt: new Date().toISOString(),
          })
        );
        if (showStatus) setStatus(strings.draftSaved, "success");
      } else {
        window.localStorage.removeItem(storageKey);
        if (showStatus) setStatus(strings.noChanges);
      }
    } catch (_error) {
      if (showStatus) setStatus(strings.draftFailed, "error");
    }
  }

  function scheduleDraftSave() {
    window.clearTimeout(draftTimer);
    const session = editorSession;
    draftTimer = window.setTimeout(() => {
      if (session === editorSession) saveDraft(false);
    }, 350);
  }

  function handleEditorChange() {
    updateDirtyState();
    setStatus(strings.draftChanged);
    schedulePreview();
    scheduleDraftSave();
    elements.result.hidden = true;
  }

  function decodeBase64Utf8(encoded) {
    const binary = window.atob(encoded.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return window.btoa(binary);
  }

  async function githubRequest(endpoint, options = {}) {
    const headers = {
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
      ...options.headers,
    };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;

    const response = await window.fetch(`https://api.github.com${endpoint}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `GitHub API ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadSource() {
    const requestedPath = activeSourcePath;
    const endpoint = contentEndpoint(requestedPath);
    const storageKey = draftKey(requestedPath);
    const requestVersion = ++loadVersion;
    const session = editorSession;
    setStatus(window.functionhxSitePreferences?.getLoadingText?.() || strings.loading);
    setBusy(true);
    elements.form.hidden = true;
    try {
      await waitForTokenRestore();
      if (requestVersion !== loadVersion || session !== editorSession || requestedPath !== activeSourcePath) return;

      const requestToken = activeToken;
      let remote;
      try {
        remote = await githubRequest(`${endpoint}?ref=${encodeURIComponent(branch)}`, {
          token: requestToken,
        });
      } catch (error) {
        if ((error.status !== 401 && error.status !== 403) || !requestToken) throw error;
        await clearExpiredGitHubSession(requestToken);
        if (requestVersion !== loadVersion || session !== editorSession || requestedPath !== activeSourcePath) return;
        remote = await githubRequest(`${endpoint}?ref=${encodeURIComponent(branch)}`);
      }
      if (requestVersion !== loadVersion || session !== editorSession || requestedPath !== activeSourcePath) return;
      if (remote.type !== "file" || !remote.content || !remote.sha) throw new Error("Unsupported source");
      sourceText = decodeBase64Utf8(remote.content);
      baseSha = remote.sha;
      conflictRemote = null;

      let draft = null;
      try {
        draft = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      } catch (_error) {
        draft = null;
      }

      if (draft && typeof draft.source === "string" && draft.source !== sourceText) {
        hydrateEditor(draft.source);
        baseSha = draft.baseSha || remote.sha;
        setStatus(strings.draftRestored, "success");
      } else {
        hydrateEditor(sourceText);
        setStatus(strings.noChanges);
      }
      editorLoaded = true;
      elements.form.hidden = false;
      window.requestAnimationFrame(() => {
        if (session === editorSession && requestedPath === activeSourcePath && !root.hidden) elements.title.focus();
      });
    } catch (error) {
      if (requestVersion !== loadVersion || session !== editorSession) return;
      setStatus(`${strings.loadingFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      if (requestVersion === loadVersion && session === editorSession) setBusy(false);
    }
  }

  function activateSource(path) {
    const requestedPath = path || defaultSourcePath;
    if (!isAllowedSource(requestedPath)) return false;
    if (requestedPath === activeSourcePath) return true;
    if (commitInFlight) return false;

    if (editorLoaded && isDirty()) {
      if (!window.confirm(strings.confirmSwitch)) return false;
      saveDraft(false);
    }
    window.clearTimeout(draftTimer);
    window.clearTimeout(previewTimer);
    loadVersion += 1;
    editorSession += 1;
    activeSourcePath = requestedPath;
    root.dataset.sourcePath = requestedPath;
    elements.path.textContent = requestedPath;
    baseSha = "";
    sourceText = "";
    sourceNewline = "\n";
    conflictRemote = null;
    editorLoaded = false;
    elements.form.hidden = true;
    elements.result.hidden = true;
    elements.body.value = "";
    elements.frontMatter.value = "";
    elements.previewBody.replaceChildren();
    elements.previewTitle.textContent = "";
    return true;
  }

  function openEditor(trigger = toggle) {
    if (commitInFlight) return;
    if (!activateSource(trigger.dataset.sourcePath || defaultSourcePath)) return;
    activeTrigger = trigger;
    if (root.hidden) {
      previousScrollY = window.scrollY;
      editorSession += 1;
    }
    root.hidden = false;
    document.body.classList.add("site-inline-editor-active");
    root.scrollIntoView({ block: "start" });
    if (!editorLoaded) loadSource();
    else window.requestAnimationFrame(() => elements.title.focus());
  }

  function closeEditor() {
    if (commitInFlight) return;
    saveDraft(false);
    window.clearTimeout(draftTimer);
    window.clearTimeout(previewTimer);
    loadVersion += 1;
    editorSession += 1;
    root.hidden = true;
    document.body.classList.remove("site-inline-editor-active");
    window.requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }));
    if (activeTrigger && typeof activeTrigger.focus === "function") activeTrigger.focus();
  }

  function openAuthDialog(commitSnapshot = null) {
    pendingCommit = commitSnapshot;
    setAuthStatus("");
    elements.token.value = "";
    if (typeof authDialog.showModal === "function") authDialog.showModal();
    else authDialog.setAttribute("open", "");
    window.requestAnimationFrame(() => elements.token.focus());
  }

  function finalizeAuthDialogClose() {
    const keepVerifiedSession = verifiedAuthClose;
    verifiedAuthClose = false;
    window.clearTimeout(authCompletionTimer);
    authCompletionTimer = 0;
    pendingCommit = null;
    elements.token.value = "";
    if (!keepVerifiedSession) authVersion += 1;
    setBusy(false);
  }

  function closeAuthDialog({ verified = false } = {}) {
    verifiedAuthClose = verified;
    if (!verified) pendingCommit = null;
    elements.token.value = "";
    if (typeof authDialog.close === "function") authDialog.close();
    else {
      authDialog.removeAttribute("open");
      finalizeAuthDialogClose();
    }
  }

  function setConnection(session) {
    activeToken = session?.token || "";
    const connectLabel = elements.connect.querySelector("span");
    if (connectLabel) connectLabel.textContent = activeToken ? strings.connected : disconnectedLabel;
    elements.connect.dataset.connected = String(Boolean(activeToken));
    window.functionhxOwnerUi?.setVerified?.(Boolean(activeToken), session?.remembered === true);
  }

  async function withSuppressedAuthEvents(action) {
    authMutationDepth += 1;
    try {
      return await action();
    } finally {
      authMutationDepth -= 1;
    }
  }

  async function restoreGitHubSession() {
    const operation = ++authVersion;
    const session = await window.functionhxGitHubAuth?.restore({ owner, repository }).catch(() => null);
    if (operation !== authVersion) return null;
    setConnection(session);
    return session;
  }

  async function waitForTokenRestore() {
    let awaited;
    do {
      awaited = restorePromise;
      await awaited;
    } while (awaited !== restorePromise);
  }

  async function saveGitHubSession(token) {
    const remember = elements.authRemember.checked;
    if (!window.functionhxGitHubAuth) return { failed: remember, remembered: false };
    return withSuppressedAuthEvents(async () => {
      try {
        return await window.functionhxGitHubAuth.save({ owner, remember, repository, token });
      } catch (_error) {
        await window.functionhxGitHubAuth.save({ owner, remember: false, repository, token }).catch(() => undefined);
        return { failed: true, remembered: false };
      }
    });
  }

  async function disconnectGitHub(ask = true) {
    if (ask && !window.confirm(strings.disconnectConfirm)) return;
    const operation = ++authVersion;
    setConnection(null);
    restorePromise = Promise.resolve(null);
    await withSuppressedAuthEvents(() => window.functionhxGitHubAuth?.forget({ repository }).catch(() => undefined));
    if (operation !== authVersion) return;
    setConnection(null);
    setStatus(strings.disconnected);
  }

  async function clearExpiredGitHubSession(token) {
    if (!token || token !== activeToken) return;
    const operation = ++authVersion;
    setConnection(null);
    restorePromise = Promise.resolve(null);
    await withSuppressedAuthEvents(() => window.functionhxGitHubAuth?.forget({ repository }).catch(() => undefined));
    if (operation === authVersion) setConnection(null);
  }

  async function handleConnectButton() {
    await waitForTokenRestore();
    if (authDialog.open) return;
    if (activeToken) {
      await disconnectGitHub(true);
      return;
    }
    openAuthDialog(null);
  }

  async function connectGitHub() {
    const candidate = elements.token.value.trim();
    if (!candidate) {
      setAuthStatus(strings.authMissing, "error");
      return;
    }

    const operation = ++authVersion;
    setBusy(true);
    setAuthStatus(strings.verify);
    try {
      const [user, repo] = await Promise.all([
        githubRequest("/user", { token: candidate }),
        githubRequest(`/repos/${repository}`, { token: candidate }),
      ]);
      if (operation !== authVersion || !authDialog.open) return;
      if (String(user.login).toLowerCase() !== owner.toLowerCase() || !repo.permissions?.push) {
        throw new Error("This token is not @Functionhx with repository write access.");
      }
      const saved = await saveGitHubSession(candidate);
      if (operation !== authVersion || !authDialog.open) {
        if (!activeToken || activeToken === candidate) {
          await withSuppressedAuthEvents(() => window.functionhxGitHubAuth?.forget({ repository }).catch(() => undefined));
        }
        return;
      }
      const session = { remembered: saved.remembered === true, token: candidate };
      setConnection(session);
      restorePromise = Promise.resolve(session);
      setAuthStatus(saved.failed ? strings.authRememberFailed : saved.remembered ? strings.authRemembered : strings.authSuccess, "success");
      window.clearTimeout(authCompletionTimer);
      authCompletionTimer = window.setTimeout(
        () => {
          if (operation !== authVersion || !authDialog.open) return;
          const continueCommit = pendingCommit;
          pendingCommit = null;
          closeAuthDialog({ verified: true });
          if (continueCommit) commitChanges(continueCommit);
        },
        saved.failed ? 900 : 350
      );
    } catch (error) {
      if (operation !== authVersion) return;
      setConnection(null);
      setAuthStatus(`${strings.authFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      elements.token.value = "";
      if (operation === authVersion) setBusy(false);
    }
  }

  function createCommitSnapshot() {
    if (!editorLoaded || !isDirty()) return null;
    const path = activeSourcePath;
    return Object.freeze({
      baseSha,
      endpoint: contentEndpoint(path),
      message: elements.message.value.trim() || defaultCommitMessage(path),
      path,
      session: editorSession,
      source: composeSource(),
      storageKey: draftKey(path),
    });
  }

  function isCurrentCommit(operation, snapshot) {
    return operation === commitVersion && snapshot.session === editorSession && snapshot.path === activeSourcePath;
  }

  async function commitChanges(requestedSnapshot = null) {
    const snapshot = requestedSnapshot || createCommitSnapshot();
    if (!snapshot) {
      setStatus(strings.noChanges);
      return;
    }
    if (commitInFlight || snapshot.session !== editorSession || snapshot.path !== activeSourcePath) return;

    const operation = ++commitVersion;
    let requestAuth = false;
    setCommitLock(true);
    setStatus(strings.saving);
    elements.result.hidden = true;
    try {
      await waitForTokenRestore();
      if (!isCurrentCommit(operation, snapshot)) return;
      if (!activeToken) {
        requestAuth = true;
        return;
      }

      const commitToken = activeToken;
      const authorizationVersion = authVersion;
      const remote = await githubRequest(`${snapshot.endpoint}?ref=${encodeURIComponent(branch)}`, {
        token: commitToken,
      });
      if (!isCurrentCommit(operation, snapshot) || authorizationVersion !== authVersion || commitToken !== activeToken) return;
      if (remote.sha !== snapshot.baseSha) {
        conflictRemote = Object.freeze({
          path: snapshot.path,
          session: snapshot.session,
          sha: remote.sha,
          source: decodeBase64Utf8(remote.content || ""),
        });
        saveDraft(false);
        throw new Error(strings.commitConflict);
      }

      const result = await githubRequest(snapshot.endpoint, {
        method: "PUT",
        token: commitToken,
        body: {
          message: snapshot.message,
          content: encodeBase64Utf8(snapshot.source),
          sha: remote.sha,
          branch,
        },
      });
      if (!isCurrentCommit(operation, snapshot) || authorizationVersion !== authVersion || commitToken !== activeToken) return;

      sourceText = snapshot.source;
      baseSha = result.content?.sha || snapshot.baseSha;
      conflictRemote = null;
      window.localStorage.removeItem(snapshot.storageKey);
      updateDirtyState();
      setStatus(strings.commitSuccess, "success");
      if (result.commit?.html_url) {
        elements.result.href = result.commit.html_url;
        elements.result.textContent = strings.viewCommit;
        elements.result.hidden = false;
      }
      window.functionhxDeployment?.watch(result.commit);
    } catch (error) {
      if (!isCurrentCommit(operation, snapshot)) return;
      if ((error.status === 401 || error.status === 403) && activeToken) {
        await clearExpiredGitHubSession(activeToken);
        if (isCurrentCommit(operation, snapshot)) requestAuth = true;
      } else {
        const message = error.message === strings.commitConflict ? error.message : `${strings.commitFailed} ${error.message || ""}`.trim();
        setStatus(message, "error");
      }
    } finally {
      if (operation === commitVersion) {
        setCommitLock(false);
        if (requestAuth && snapshot.session === editorSession && snapshot.path === activeSourcePath) openAuthDialog(snapshot);
      }
    }
  }

  /*
   * Commit state is deliberately captured before the first await above. Do not
   * move path/source/SHA/message reads into the network section: a delayed
   * token restore or Contents API response must never retarget a commit.
   */

  function selectPanel(panel) {
    const showBody = panel === "body";
    elements.bodyTab.setAttribute("aria-selected", String(showBody));
    elements.metadataTab.setAttribute("aria-selected", String(!showBody));
    elements.bodyPanel.hidden = !showBody;
    elements.metadataPanel.hidden = showBody;
    (showBody ? elements.body : elements.frontMatter).focus();
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest('[data-author-action="source-edit"]');
    if (!trigger) return;
    if (commitInFlight || trigger.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    openEditor(trigger);
  });
  if (toggle.dataset.editorAction === "source-edit") toggle.addEventListener("click", () => openEditor(toggle));
  elements.close.addEventListener("click", closeEditor);
  elements.connect.addEventListener("click", handleConnectButton);
  elements.authCancel.addEventListener("click", () => {
    closeAuthDialog();
  });
  elements.authConnect.addEventListener("click", connectGitHub);
  authDialog.addEventListener("close", () => {
    finalizeAuthDialogClose();
  });
  elements.token.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connectGitHub();
  });
  elements.save.addEventListener("click", () => saveDraft(true));
  elements.commit.addEventListener("click", () => commitChanges());
  elements.bodyTab.addEventListener("click", () => selectPanel("body"));
  elements.metadataTab.addEventListener("click", () => selectPanel("metadata"));

  elements.title.addEventListener("input", () => {
    updateMetadataField("title", elements.title.value);
    handleEditorChange();
  });
  elements.description.addEventListener("input", () => {
    updateMetadataField("description", elements.description.value);
    handleEditorChange();
  });
  elements.published.addEventListener("change", () => {
    updateMetadataField("published", elements.published.checked, "boolean");
    handleEditorChange();
  });
  elements.comments.addEventListener("change", () => {
    updateMetadataField("giscus_comments", elements.comments.checked, "boolean");
    handleEditorChange();
  });
  elements.body.addEventListener("input", handleEditorChange);
  elements.frontMatter.addEventListener("input", () => {
    syncMetadataFromFrontMatter();
    handleEditorChange();
  });

  elements.discard.addEventListener("click", () => {
    if (!isDirty() || !window.confirm(strings.confirmDiscard)) return;
    window.localStorage.removeItem(draftKey());
    if (conflictRemote && conflictRemote.path === activeSourcePath && conflictRemote.session === editorSession) {
      sourceText = conflictRemote.source;
      baseSha = conflictRemote.sha;
      conflictRemote = null;
    }
    hydrateEditor(sourceText);
    setStatus(strings.noChanges);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("site-inline-editor-active") && !authDialog.open) {
      closeEditor();
    }
  });

  window.addEventListener("functionhx:github-auth-changed", (event) => {
    if (event.detail?.repository !== repository) return;
    if (authMutationDepth > 0) return;
    restorePromise = restoreGitHubSession();
  });
  restorePromise = restoreGitHubSession();

  if (hasYamlKey(elements.frontMatter.value, "published") || hasYamlKey(elements.frontMatter.value, "giscus_comments")) {
    syncMetadataFromFrontMatter();
  }
})();
