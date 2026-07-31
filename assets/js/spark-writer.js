(function initializeSparkWriter() {
  "use strict";

  const root = document.getElementById("site-spark-writer");
  const toggle = document.getElementById("site-inline-editor-toggle");
  const authDialog = document.getElementById("site-inline-editor-auth");

  if (!root || !toggle || !authDialog) return;
  if (!(toggle.dataset.editorAction || "").startsWith("spark-")) return;

  const repository = root.dataset.repository;
  const owner = root.dataset.owner;
  const branch = root.dataset.branch;
  const isEnglish = root.dataset.language === "en";
  const isEntryPage = root.dataset.initialMode === "edit";
  const createDraftKey = `functionhx:spark-writer:${repository}:${branch}:new`;

  const strings = isEnglish
    ? {
        authFailed: "GitHub connection failed.",
        authMissing: "Paste a fine-grained token first.",
        authRememberFailed: "Connected for this page, but this browser could not remember the token securely.",
        authRemembered: "Connected as @Functionhx and remembered on this private device.",
        authSuccess: "Connected as @Functionhx for this browser session.",
        collision: "That URL slug already exists. Change it in Publishing settings.",
        commitConflict: "One of these files changed on GitHub. Reopen it before publishing your changes.",
        commitFailed: "The Spark entry could not be published.",
        commitSuccess: "Both languages were committed together. Follow the publishing progress in the corner.",
        confirmDiscard: "Discard this browser draft?",
        connected: "Disconnect @Functionhx",
        disconnectConfirm: "Forget the trusted GitHub token on this device?",
        disconnected: "The trusted GitHub connection was removed from this device.",
        draftChanged: "Saved in this browser as you type. Nothing has been sent to GitHub.",
        draftFailed: "This browser could not save the draft.",
        draftRestored: "Recovered the draft saved in this browser.",
        draftSaved: "Saved in this browser. Nothing has been sent to GitHub.",
        editing: "Loading both language files…",
        editingFailed: "Both language files could not be loaded.",
        idle: "Start writing. Changes will be saved in this browser automatically.",
        incompleteEn: "Add an English title and body before publishing.",
        incompleteZh: "Add a Chinese title and body before publishing.",
        invalidDate: "Choose a valid date and time in Publishing settings.",
        invalidSlug: "The URL slug may contain only lowercase letters, numbers, and hyphens.",
        noChanges: "There are no unpublished changes.",
        publishing: "Creating one commit for both languages…",
        translationCanceled: "Translation canceled; the Chinese draft is unchanged.",
        translationFailed: "The English draft could not be translated.",
        translationReady: "English translation is ready for review and remains a local draft.",
        translating: "Waiting for DeepSeek to translate the Chinese draft…",
        translateMissing: "Add a Chinese title and body before translating.",
        overwriteTranslation: "Replace the current English draft with a new DeepSeek translation?",
        verify: "Verifying this token and repository access…",
        viewCommit: "View the commit on GitHub →",
      }
    : {
        authFailed: "GitHub 连接失败。",
        authMissing: "请先粘贴 fine-grained token。",
        authRememberFailed: "本页已经连接，但这个浏览器无法安全地记住令牌。",
        authRemembered: "已连接为 @Functionhx，并记住这台私人电脑。",
        authSuccess: "本次浏览器会话已连接为 @Functionhx。",
        collision: "这个网址短名已经存在，请在“发布设置”里换一个。",
        commitConflict: "这组文件已经在 GitHub 上发生变化，请重新打开后再发布。",
        commitFailed: "无法发布这条闪耀。",
        commitSuccess: "中英文已在同一个 Commit 中提交，请在右下角查看发布进度。",
        confirmDiscard: "丢弃这份浏览器草稿？",
        connected: "退出 @Functionhx",
        disconnectConfirm: "从这台设备移除已记住的 GitHub 令牌？",
        disconnected: "已从这台设备移除 GitHub 连接。",
        draftChanged: "正在随写随存；内容仍只在这个浏览器中，尚未发送到 GitHub。",
        draftFailed: "这个浏览器无法保存草稿。",
        draftRestored: "已恢复保存在这个浏览器中的草稿。",
        draftSaved: "已自动保存在这个浏览器中，尚未发送到 GitHub。",
        editing: "正在载入这条闪耀的中英文内容…",
        editingFailed: "无法载入完整的中英文内容。",
        idle: "直接开始写，修改会自动保存在这个浏览器中。",
        incompleteEn: "发布前还需要补齐英文标题和正文。",
        incompleteZh: "发布前还需要补齐中文标题和正文。",
        invalidDate: "请在“发布设置”里填写有效的日期与时间。",
        invalidSlug: "网址短名只能包含小写字母、数字和连字符。",
        noChanges: "当前没有尚未发布的修改。",
        publishing: "正在为中英文创建同一个 Commit…",
        translationCanceled: "已取消翻译，中文稿保持不变。",
        translationFailed: "无法生成英文译稿。",
        translationReady: "英文译稿已经生成，请检查；内容仍是本地草稿。",
        translating: "正在等待 DeepSeek 翻译中文稿…",
        translateMissing: "请先填写中文标题和正文。",
        overwriteTranslation: "用新的 DeepSeek 翻译覆盖当前英文稿？",
        verify: "正在验证令牌和仓库权限…",
        viewCommit: "在 GitHub 查看 Commit →",
      };

  const fields = {
    zh: {
      body: document.getElementById("site-spark-writer-body-zh"),
      complete: document.getElementById("site-spark-writer-complete-zh"),
      panel: document.getElementById("site-spark-writer-panel-zh"),
      summary: document.getElementById("site-spark-writer-summary-zh"),
      tab: document.getElementById("site-spark-writer-tab-zh"),
      title: document.getElementById("site-spark-writer-title-zh"),
    },
    en: {
      body: document.getElementById("site-spark-writer-body-en"),
      complete: document.getElementById("site-spark-writer-complete-en"),
      panel: document.getElementById("site-spark-writer-panel-en"),
      summary: document.getElementById("site-spark-writer-summary-en"),
      tab: document.getElementById("site-spark-writer-tab-en"),
      title: document.getElementById("site-spark-writer-title-en"),
    },
  };

  const elements = {
    authCancel: document.getElementById("site-inline-editor-auth-cancel"),
    authConnect: document.getElementById("site-inline-editor-auth-connect"),
    authRemember: document.getElementById("site-inline-editor-auth-remember"),
    authStatus: document.getElementById("site-inline-editor-auth-status"),
    close: document.getElementById("site-spark-writer-close"),
    comments: document.getElementById("site-spark-writer-comments"),
    connect: document.getElementById("site-spark-writer-connect"),
    create: document.getElementById("site-spark-create"),
    date: document.getElementById("site-spark-writer-date"),
    discard: document.getElementById("site-spark-writer-discard"),
    heading: document.getElementById("site-spark-writer-heading"),
    kind: document.getElementById("site-spark-writer-kind"),
    message: document.getElementById("site-spark-writer-message"),
    publish: document.getElementById("site-spark-writer-publish"),
    result: document.getElementById("site-spark-writer-result"),
    slug: document.getElementById("site-spark-writer-slug"),
    status: document.getElementById("site-spark-writer-status"),
    token: document.getElementById("site-inline-editor-token"),
    translate: document.getElementById("site-spark-writer-translate"),
  };

  const requiredElements = Object.entries(elements)
    .filter(([name]) => name !== "create")
    .map(([, element]) => element);
  if (!fields.zh.body || !fields.en.body || requiredElements.some((element) => element === null)) {
    return;
  }

  let activeToken = "";
  let activeTrigger = toggle;
  let busy = false;
  let currentLanguage = isEnglish ? "en" : "zh";
  let currentMode = "create";
  let currentTranslationKey = "";
  let currentDraftKey = createDraftKey;
  let draftTimer = 0;
  let initialSnapshot = "";
  let pendingPublish = false;
  let slugIsAutomatic = true;
  let sourcePaths = { zh: "", en: "" };
  let originals = { zh: null, en: null };
  let restorePromise = Promise.resolve(null);
  const disconnectedLabel = elements.connect.querySelector("span")?.textContent.trim() || "GitHub";

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDateTime(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function defaultSlug(date = new Date()) {
    return `spark-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(
      date.getSeconds()
    )}`;
  }

  function slugify(value) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
  }

  function setStatus(message, state = "") {
    elements.status.textContent = message;
    if (state) elements.status.dataset.state = state;
    else delete elements.status.dataset.state;
  }

  function setAuthStatus(message, state = "") {
    elements.authStatus.textContent = message;
    if (state) elements.authStatus.dataset.state = state;
    else delete elements.authStatus.dataset.state;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    elements.close.disabled = nextBusy;
    elements.connect.disabled = nextBusy;
    elements.discard.disabled = nextBusy;
    elements.publish.disabled = nextBusy;
    elements.translate.disabled = nextBusy;
    elements.authConnect.disabled = nextBusy;
  }

  function autoSize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 304)}px`;
  }

  function selectLanguage(language, focus = false) {
    currentLanguage = language;
    for (const candidate of ["zh", "en"]) {
      const selected = candidate === language;
      fields[candidate].tab.setAttribute("aria-selected", String(selected));
      fields[candidate].panel.hidden = !selected;
    }
    autoSize(fields[language].body);
    if (focus) fields[language].title.focus();
  }

  function readValues() {
    return {
      comments: elements.comments.checked,
      date: elements.date.value,
      en: {
        body: fields.en.body.value,
        summary: fields.en.summary.value,
        title: fields.en.title.value,
      },
      kind: elements.kind.value,
      message: elements.message.value,
      slug: elements.slug.value,
      zh: {
        body: fields.zh.body.value,
        summary: fields.zh.summary.value,
        title: fields.zh.title.value,
      },
    };
  }

  function writeValues(values) {
    for (const language of ["zh", "en"]) {
      const localized = values[language] || {};
      fields[language].title.value = localized.title || "";
      fields[language].summary.value = localized.summary || "";
      fields[language].body.value = localized.body || "";
      autoSize(fields[language].body);
    }
    elements.kind.value = values.kind === "log" ? "log" : "note";
    elements.date.value = values.date || localDateTime();
    elements.slug.value = values.slug || defaultSlug();
    elements.comments.checked = values.comments !== false;
    elements.message.value = values.message || "";
    updateCompletion();
  }

  function snapshot() {
    const values = readValues();
    delete values.message;
    return JSON.stringify(values);
  }

  function isDirty() {
    return snapshot() !== initialSnapshot;
  }

  function languageComplete(language) {
    return Boolean(fields[language].title.value.trim() && fields[language].body.value.trim());
  }

  function updateCompletion() {
    for (const language of ["zh", "en"]) {
      fields[language].complete.dataset.complete = String(languageComplete(language));
    }
  }

  function saveDraft(showStatus = false) {
    try {
      if (isDirty()) {
        window.localStorage.setItem(
          currentDraftKey,
          JSON.stringify({
            mode: currentMode,
            savedAt: new Date().toISOString(),
            slugIsAutomatic,
            sourcePaths,
            translationKey: currentTranslationKey,
            values: readValues(),
          })
        );
        if (showStatus) setStatus(strings.draftSaved, "success");
      } else {
        window.localStorage.removeItem(currentDraftKey);
        if (showStatus) setStatus(strings.noChanges);
      }
    } catch (_error) {
      if (showStatus) setStatus(strings.draftFailed, "error");
    }
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(window.localStorage.getItem(currentDraftKey) || "null");
      if (!draft || !draft.values) return false;
      writeValues(draft.values);
      slugIsAutomatic = draft.slugIsAutomatic !== false;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function scheduleDraftSave() {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      saveDraft(false);
      setStatus(strings.draftSaved, "success");
    }, 350);
  }

  function handleChange() {
    updateCompletion();
    setStatus(strings.draftChanged);
    elements.result.hidden = true;
    scheduleDraftSave();
  }

  function splitSource(source) {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error("Missing YAML front matter");
    return {
      body: source.slice(match[0].length).replace(/\r\n/g, "\n"),
      frontMatter: match[1].replace(/\r\n/g, "\n"),
      newline: source.includes("\r\n") ? "\r\n" : "\n",
    };
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
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
    return raw;
  }

  function extractYamlBoolean(frontMatter, key) {
    return extractYamlScalar(frontMatter, key).toLowerCase() === "true";
  }

  function setYamlValue(frontMatter, key, value, type = "string") {
    let serialized = JSON.stringify(String(value));
    if (type === "boolean") serialized = value ? "true" : "false";
    if (type === "raw") serialized = String(value);
    const pattern = new RegExp(`^${key}:.*$`, "m");
    if (pattern.test(frontMatter)) return frontMatter.replace(pattern, `${key}: ${serialized}`);
    return `${frontMatter.replace(/\s+$/, "")}\n${key}: ${serialized}`;
  }

  function toInputDate(value) {
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    return match ? `${match[1]}T${match[2]}` : localDateTime();
  }

  function toJekyllDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
    return `${value.replace("T", " ")}:00 +0800`;
  }

  function plainSummary(body) {
    return body
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
      .replace(/[*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function composeCreatedSource(language, values, path) {
    const localized = values[language];
    const description = localized.summary.trim() || plainSummary(localized.body);
    const date = toJekyllDate(values.date);
    const translationKey = `spark-${values.slug}`;
    const permalink = language === "en" ? `/en/spark/${values.slug}/` : `/spark/${values.slug}/`;
    const lines = [
      "---",
      "layout: post",
      `title: ${JSON.stringify(localized.title.trim())}`,
      `slug: ${JSON.stringify(values.slug)}`,
      `date: ${date}`,
      "published: true",
      `description: ${JSON.stringify(description)}`,
      `permalink: ${permalink}`,
      `lang: ${language}`,
      `locale: ${language}`,
      `translation_key: ${translationKey}`,
      `kind: ${values.kind}`,
      "tags: []",
      "categories: []",
      "related_posts: false",
      `giscus_comments: ${values.comments ? "true" : "false"}`,
      "---",
      "",
      localized.body.replace(/\r\n/g, "\n").trimEnd(),
      "",
    ];
    return { content: lines.join("\n"), path };
  }

  function composeEditedSource(language, values) {
    const original = originals[language];
    if (!original) throw new Error(`Missing ${language} source`);
    const localized = values[language];
    const description = localized.summary.trim() || plainSummary(localized.body);
    let frontMatter = original.frontMatter;
    frontMatter = setYamlValue(frontMatter, "title", localized.title.trim());
    frontMatter = setYamlValue(frontMatter, "description", description);
    frontMatter = setYamlValue(frontMatter, "date", toJekyllDate(values.date), "raw");
    frontMatter = setYamlValue(frontMatter, "kind", values.kind, "raw");
    frontMatter = setYamlValue(frontMatter, "giscus_comments", values.comments, "boolean");
    const normalized = `---\n${frontMatter}\n---\n${localized.body.replace(/\r\n/g, "\n").trimEnd()}\n`;
    const content = original.newline === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
    return { content, path: sourcePaths[language] };
  }

  function composePair() {
    const values = readValues();
    if (currentMode === "create") {
      const datePrefix = values.date.slice(0, 10);
      return {
        en: composeCreatedSource("en", values, `_posts/${datePrefix}-${values.slug}-en.md`),
        zh: composeCreatedSource("zh", values, `_posts/${datePrefix}-${values.slug}-zh.md`),
      };
    }
    return {
      en: composeEditedSource("en", values),
      zh: composeEditedSource("zh", values),
    };
  }

  function validate() {
    if (!languageComplete("zh")) {
      selectLanguage("zh");
      setStatus(strings.incompleteZh, "error");
      fields.zh.title.focus();
      return false;
    }
    if (!languageComplete("en")) {
      selectLanguage("en");
      setStatus(strings.incompleteEn, "error");
      fields.en.title.focus();
      return false;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(elements.slug.value)) {
      setStatus(strings.invalidSlug, "error");
      root.querySelector(".site-spark-writer__settings").open = true;
      elements.slug.focus();
      return false;
    }
    if (!toJekyllDate(elements.date.value)) {
      setStatus(strings.invalidDate, "error");
      root.querySelector(".site-spark-writer__settings").open = true;
      elements.date.focus();
      return false;
    }
    return true;
  }

  function encodePath(path) {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
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
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      headers,
      method: options.method || "GET",
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404 && options.allowNotFound) return null;
    if (!response.ok) {
      const error = new Error(payload.message || `GitHub API ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadRemoteSource(language, path) {
    const remote = await githubRequest(
      `/repos/${repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
      activeToken ? { token: activeToken } : {}
    );
    if (remote.type !== "file" || !remote.content || !remote.sha) throw new Error(`Unsupported ${language} source`);
    const binary = window.atob(remote.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const source = new TextDecoder().decode(bytes);
    return { ...splitSource(source), sha: remote.sha, source };
  }

  function valuesFromSources(zhSource, enSource) {
    const zhFrontMatter = zhSource.frontMatter;
    const enFrontMatter = enSource.frontMatter;
    return {
      comments: extractYamlBoolean(zhFrontMatter, "giscus_comments"),
      date: toInputDate(extractYamlScalar(zhFrontMatter, "date")),
      en: {
        body: enSource.body,
        summary: extractYamlScalar(enFrontMatter, "description"),
        title: extractYamlScalar(enFrontMatter, "title"),
      },
      kind: extractYamlScalar(zhFrontMatter, "kind") || "note",
      message: "",
      slug: extractYamlScalar(zhFrontMatter, "slug"),
      zh: {
        body: zhSource.body,
        summary: extractYamlScalar(zhFrontMatter, "description"),
        title: extractYamlScalar(zhFrontMatter, "title"),
      },
    };
  }

  function prepareCreate() {
    currentMode = "create";
    currentTranslationKey = "";
    currentDraftKey = createDraftKey;
    sourcePaths = { zh: "", en: "" };
    originals = { zh: null, en: null };
    slugIsAutomatic = true;
    const now = new Date();
    writeValues({
      comments: true,
      date: localDateTime(now),
      en: { body: "", summary: "", title: "" },
      kind: "note",
      message: "",
      slug: defaultSlug(now),
      zh: { body: "", summary: "", title: "" },
    });
    initialSnapshot = snapshot();
    const restored = restoreDraft();
    elements.slug.readOnly = false;
    elements.heading.textContent = elements.heading.dataset.newHeading;
    elements.result.hidden = true;
    setStatus(restored ? strings.draftRestored : strings.idle, restored ? "success" : "");
  }

  async function prepareEdit(config) {
    currentMode = "edit";
    currentTranslationKey = config.translationKey;
    currentDraftKey = `functionhx:spark-writer:${repository}:${branch}:${currentTranslationKey}`;
    sourcePaths = { en: config.enPath, zh: config.zhPath };
    originals = { zh: null, en: null };
    elements.slug.readOnly = true;
    elements.heading.textContent = elements.heading.dataset.editHeading;
    elements.result.hidden = true;
    setStatus(strings.editing);
    setBusy(true);
    try {
      const [zhSource, enSource] = await Promise.all([loadRemoteSource("zh", sourcePaths.zh), loadRemoteSource("en", sourcePaths.en)]);
      originals = { en: enSource, zh: zhSource };
      writeValues(valuesFromSources(zhSource, enSource));
      initialSnapshot = snapshot();
      slugIsAutomatic = false;
      const restored = restoreDraft();
      setStatus(restored ? strings.draftRestored : strings.noChanges, restored ? "success" : "");
      window.requestAnimationFrame(() => fields[currentLanguage].title.focus());
    } catch (error) {
      setStatus(`${strings.editingFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      setBusy(false);
    }
  }

  function revealWriter() {
    root.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    if (isEntryPage) document.body.classList.add("site-spark-entry-writing");
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openCreate(trigger = elements.create || toggle) {
    if (!root.hidden && currentMode === "create") {
      selectLanguage(currentLanguage, true);
      return;
    }
    if (!root.hidden) saveDraft(false);
    activeTrigger = trigger;
    prepareCreate();
    revealWriter();
    selectLanguage(isEnglish ? "en" : "zh");
    window.requestAnimationFrame(() => fields[currentLanguage].title.focus());
  }

  function openEdit(config, trigger = toggle) {
    if (!root.hidden) saveDraft(false);
    activeTrigger = trigger;
    revealWriter();
    selectLanguage(isEnglish ? "en" : "zh");
    prepareEdit(config);
  }

  function closeWriter() {
    saveDraft(false);
    root.hidden = true;
    document.body.classList.remove("site-spark-entry-writing");
    toggle.setAttribute("aria-expanded", "false");
    if (activeTrigger && typeof activeTrigger.focus === "function") activeTrigger.focus();
  }

  function openAuthDialog(shouldPublish = false) {
    pendingPublish = shouldPublish;
    setAuthStatus("");
    elements.token.value = "";
    if (typeof authDialog.showModal === "function") authDialog.showModal();
    else authDialog.setAttribute("open", "");
    window.requestAnimationFrame(() => elements.token.focus());
  }

  function closeAuthDialog() {
    elements.token.value = "";
    if (typeof authDialog.close === "function") authDialog.close();
    else authDialog.removeAttribute("open");
  }

  function setConnection(session) {
    activeToken = session?.token || "";
    const connectLabel = elements.connect.querySelector("span");
    if (connectLabel) connectLabel.textContent = activeToken ? strings.connected : disconnectedLabel;
    elements.connect.dataset.connected = String(Boolean(activeToken));
  }

  async function restoreGitHubSession() {
    const session = await window.functionhxGitHubAuth?.restore({ owner, repository }).catch(() => null);
    setConnection(session);
    return session;
  }

  async function saveGitHubSession(token) {
    const remember = elements.authRemember.checked;
    if (!window.functionhxGitHubAuth) return { failed: remember, remembered: false };
    try {
      return await window.functionhxGitHubAuth.save({ owner, remember, repository, token });
    } catch (_error) {
      await window.functionhxGitHubAuth.save({ owner, remember: false, repository, token }).catch(() => undefined);
      return { failed: true, remembered: false };
    }
  }

  async function disconnectGitHub(ask = true) {
    if (ask && !window.confirm(strings.disconnectConfirm)) return;
    await window.functionhxGitHubAuth?.forget({ repository }).catch(() => undefined);
    setConnection(null);
    setStatus(strings.disconnected);
  }

  async function handleConnectButton() {
    await restorePromise;
    if (activeToken) {
      await disconnectGitHub(true);
      return;
    }
    openAuthDialog(false);
  }

  async function connectGitHub() {
    const candidate = elements.token.value.trim();
    if (!candidate) {
      setAuthStatus(strings.authMissing, "error");
      return;
    }
    setBusy(true);
    setAuthStatus(strings.verify);
    try {
      const [user, repo] = await Promise.all([
        githubRequest("/user", { token: candidate }),
        githubRequest(`/repos/${repository}`, { token: candidate }),
      ]);
      if (String(user.login).toLowerCase() !== owner.toLowerCase() || !repo.permissions?.push) {
        throw new Error("This token is not @Functionhx with repository write access.");
      }
      const saved = await saveGitHubSession(candidate);
      setConnection({ token: candidate });
      setAuthStatus(saved.failed ? strings.authRememberFailed : saved.remembered ? strings.authRemembered : strings.authSuccess, "success");
      const continuePublishing = pendingPublish;
      pendingPublish = false;
      window.setTimeout(
        () => {
          closeAuthDialog();
          if (continuePublishing) publishPair();
        },
        saved.failed ? 900 : 350
      );
    } catch (error) {
      setConnection(null);
      setAuthStatus(`${strings.authFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      elements.token.value = "";
      setBusy(false);
    }
  }

  async function verifyTargets(pair) {
    if (currentMode === "create") {
      const existing = await Promise.all(
        ["zh", "en"].map((language) =>
          githubRequest(`/repos/${repository}/contents/${encodePath(pair[language].path)}?ref=${encodeURIComponent(branch)}`, {
            allowNotFound: true,
            token: activeToken,
          })
        )
      );
      if (existing.some(Boolean)) throw new Error(strings.collision);
      return;
    }

    const remotes = await Promise.all(
      ["zh", "en"].map((language) =>
        githubRequest(`/repos/${repository}/contents/${encodePath(pair[language].path)}?ref=${encodeURIComponent(branch)}`, {
          token: activeToken,
        })
      )
    );
    if (remotes.some((remote, index) => remote.sha !== originals[["zh", "en"][index]].sha)) {
      throw new Error(strings.commitConflict);
    }
  }

  async function createAtomicCommit(pair) {
    const head = await githubRequest(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, {
      token: activeToken,
    });
    const headSha = head.object?.sha;
    if (!headSha) throw new Error("The branch head is unavailable.");
    const parent = await githubRequest(`/repos/${repository}/git/commits/${headSha}`, {
      token: activeToken,
    });
    const baseTree = parent.tree?.sha;
    if (!baseTree) throw new Error("The branch tree is unavailable.");

    const tree = await githubRequest(`/repos/${repository}/git/trees`, {
      body: {
        base_tree: baseTree,
        tree: ["zh", "en"].map((language) => ({
          content: pair[language].content,
          mode: "100644",
          path: pair[language].path,
          type: "blob",
        })),
      },
      method: "POST",
      token: activeToken,
    });

    const values = readValues();
    const defaultMessage = currentMode === "create" ? `content: add Spark "${values.slug}"` : `content: update Spark "${values.slug}"`;
    const commit = await githubRequest(`/repos/${repository}/git/commits`, {
      body: {
        message: values.message.trim() || defaultMessage,
        parents: [headSha],
        tree: tree.sha,
      },
      method: "POST",
      token: activeToken,
    });
    await githubRequest(`/repos/${repository}/git/refs/heads/${encodeURIComponent(branch)}`, {
      body: { force: false, sha: commit.sha },
      method: "PATCH",
      token: activeToken,
    });
    return { commit, tree };
  }

  function adoptCommittedPair(pair, result) {
    const values = readValues();
    currentMode = "edit";
    currentTranslationKey = `spark-${values.slug}`;
    currentDraftKey = `functionhx:spark-writer:${repository}:${branch}:${currentTranslationKey}`;
    sourcePaths = { en: pair.en.path, zh: pair.zh.path };
    for (const language of ["zh", "en"]) {
      const parsed = splitSource(pair[language].content);
      const treeItem = result.tree.tree?.find((item) => item.path === pair[language].path);
      originals[language] = {
        ...parsed,
        sha: treeItem?.sha || "",
        source: pair[language].content,
      };
    }
    elements.slug.readOnly = true;
    elements.heading.textContent = elements.heading.dataset.editHeading;
    initialSnapshot = snapshot();
  }

  async function publishPair() {
    await restorePromise;
    if (busy || !validate()) return;
    if (!isDirty()) {
      setStatus(strings.noChanges);
      return;
    }
    if (!activeToken) {
      openAuthDialog(true);
      return;
    }

    setBusy(true);
    setStatus(strings.publishing);
    elements.result.hidden = true;
    const modeBeforeCommit = currentMode;
    const draftKeyBeforeCommit = currentDraftKey;
    try {
      const pair = composePair();
      await verifyTargets(pair);
      const result = await createAtomicCommit(pair);
      window.localStorage.removeItem(draftKeyBeforeCommit);
      if (modeBeforeCommit === "create") {
        adoptCommittedPair(pair, result);
      } else {
        for (const language of ["zh", "en"]) {
          const parsed = splitSource(pair[language].content);
          const treeItem = result.tree.tree?.find((item) => item.path === pair[language].path);
          originals[language] = {
            ...parsed,
            sha: treeItem?.sha || originals[language].sha,
            source: pair[language].content,
          };
        }
        initialSnapshot = snapshot();
      }
      setStatus(strings.commitSuccess, "success");
      if (result.commit.html_url) {
        elements.result.href = result.commit.html_url;
        elements.result.textContent = strings.viewCommit;
        elements.result.hidden = false;
      }
      window.functionhxDeployment?.watch(result.commit);
    } catch (error) {
      if (error.status === 401 || error.status === 403) await disconnectGitHub(false);
      const knownMessage = [strings.collision, strings.commitConflict].includes(error.message);
      setStatus(knownMessage ? error.message : `${strings.commitFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      setBusy(false);
    }
  }

  function discardDraft() {
    if (isDirty() && !window.confirm(strings.confirmDiscard)) return;
    window.localStorage.removeItem(currentDraftKey);
    if (currentMode === "create") {
      prepareCreate();
      selectLanguage(isEnglish ? "en" : "zh", true);
      return;
    }
    if (originals.zh && originals.en) {
      writeValues(valuesFromSources(originals.zh, originals.en));
      initialSnapshot = snapshot();
      setStatus(strings.noChanges);
    }
  }

  async function translateChineseDraft() {
    if (!languageComplete("zh")) {
      selectLanguage("zh");
      setStatus(strings.translateMissing, "error");
      fields.zh.title.focus();
      return;
    }
    if (
      (fields.en.title.value.trim() || fields.en.summary.value.trim() || fields.en.body.value.trim()) &&
      !window.confirm(strings.overwriteTranslation)
    ) {
      return;
    }
    if (!window.functionhxDeepSeek?.translate) {
      setStatus(strings.translationFailed, "error");
      return;
    }

    elements.translate.disabled = true;
    setStatus(strings.translating);
    try {
      const translated = await window.functionhxDeepSeek.translate({
        body: fields.zh.body.value,
        summary: fields.zh.summary.value,
        title: fields.zh.title.value,
      });
      fields.en.title.value = translated.title;
      fields.en.summary.value = translated.summary;
      fields.en.body.value = translated.body;
      if (currentMode === "create" && slugIsAutomatic) {
        const generated = slugify(translated.title);
        if (generated) elements.slug.value = generated;
      }
      autoSize(fields.en.body);
      updateCompletion();
      scheduleDraftSave();
      elements.result.hidden = true;
      selectLanguage("en");
      setStatus(strings.translationReady, "success");
    } catch (error) {
      if (error.name === "AbortError") {
        setStatus(strings.translationCanceled);
      } else {
        setStatus(`${strings.translationFailed} ${error.message || ""}`.trim(), "error");
      }
    } finally {
      elements.translate.disabled = false;
    }
  }

  toggle.addEventListener("click", () => {
    if (toggle.dataset.editorAction === "spark-create") {
      openCreate(toggle);
      return;
    }
    openEdit(
      {
        enPath: root.dataset.sourcePathEn,
        translationKey: root.dataset.translationKey,
        zhPath: root.dataset.sourcePathZh,
      },
      toggle
    );
  });

  if (elements.create) elements.create.addEventListener("click", () => openCreate(elements.create));
  elements.close.addEventListener("click", closeWriter);
  elements.discard.addEventListener("click", discardDraft);
  elements.connect.addEventListener("click", handleConnectButton);
  elements.publish.addEventListener("click", publishPair);
  elements.translate.addEventListener("click", translateChineseDraft);
  fields.zh.tab.addEventListener("click", () => selectLanguage("zh", true));
  fields.en.tab.addEventListener("click", () => selectLanguage("en", true));

  document.addEventListener("click", (event) => {
    const editTrigger = event.target.closest("[data-spark-edit]");
    if (!editTrigger) return;
    openEdit(
      {
        enPath: editTrigger.dataset.sourcePathEn,
        translationKey: editTrigger.dataset.translationKey,
        zhPath: editTrigger.dataset.sourcePathZh,
      },
      editTrigger
    );
  });

  for (const language of ["zh", "en"]) {
    for (const field of [fields[language].title, fields[language].summary, fields[language].body]) {
      field.addEventListener("input", () => {
        if (currentMode === "create" && language === "en" && field === fields.en.title && slugIsAutomatic) {
          const generated = slugify(fields.en.title.value);
          if (generated) elements.slug.value = generated;
        }
        if (field === fields[language].body) autoSize(field);
        handleChange();
      });
    }
  }

  for (const field of [elements.comments, elements.date, elements.kind, elements.message]) {
    field.addEventListener("input", handleChange);
    field.addEventListener("change", handleChange);
  }
  elements.slug.addEventListener("input", () => {
    slugIsAutomatic = false;
    elements.slug.value = slugify(elements.slug.value);
    handleChange();
  });

  elements.authCancel.addEventListener("click", () => {
    pendingPublish = false;
    closeAuthDialog();
  });
  elements.authConnect.addEventListener("click", connectGitHub);
  authDialog.addEventListener("close", () => {
    elements.token.value = "";
  });
  elements.token.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connectGitHub();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !root.hidden && !authDialog.open) closeWriter();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !root.hidden) publishPair();
  });

  window.addEventListener("functionhx:github-auth-changed", (event) => {
    if (event.detail?.repository !== repository) return;
    restorePromise = restoreGitHubSession();
  });
  restorePromise = restoreGitHubSession();

  selectLanguage(currentLanguage);
})();
