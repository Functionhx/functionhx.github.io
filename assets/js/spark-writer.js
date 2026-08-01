(function initializeSparkWriter() {
  "use strict";

  const root = document.getElementById("site-spark-writer");
  const toggle = document.getElementById("site-inline-editor-toggle");
  const authDialog = document.getElementById("site-inline-editor-auth");

  if (!root || !toggle) return;

  const repository = root.dataset.repository;
  const branch = root.dataset.branch;
  const isEnglish = root.dataset.language === "en";
  const isEntryPage = root.dataset.initialMode === "edit";
  const createDraftKey = `functionhx:spark-writer:${repository}:${branch}:new`;
  const vaultClient = window.functionhxSparkVault;
  let vaultEndpoint = "";
  let vaultConfigurationError = "";

  try {
    const configuredEndpoint = window.functionhxSparkVaultConfig?.endpoint || root.dataset.vaultEndpoint || "";
    vaultEndpoint = vaultClient?.normalizeEndpoint(configuredEndpoint) || "";
  } catch (error) {
    vaultConfigurationError = error.message || "Invalid Spark Vault endpoint.";
  }

  const strings = isEnglish
    ? {
        authFailed: "GitHub sign-in failed.",
        authSuccess: "GitHub owner verified.",
        collision: "That URL slug already exists. Change it in Publishing settings.",
        commitConflict: "This Spark changed after you opened it. Reopen it before saving again.",
        commitFailed: "The Spark entry could not be saved.",
        commitPrivateSuccess: "Encrypted and saved privately. No Markdown was written to the public site repository.",
        commitPublicSuccess: "Chinese source published. The English mirror displays a pending notice until a translation is added.",
        confirmDiscard: "Discard this encrypted browser draft?",
        connected: "Lock Spark Vault",
        connecting: "Opening GitHub sign-in…",
        disconnectConfirm: "Lock Spark Vault and forget this device session?",
        disconnected: "Spark Vault was locked and its device session was removed.",
        draftChanged: "Encrypting an autosave on this device. Nothing has been sent to GitHub.",
        draftFailed: "This browser could not encrypt the local draft.",
        draftRestored: "Recovered the encrypted draft saved on this device.",
        draftSaved: "Encrypted on this device. Nothing has been sent to GitHub.",
        editing: window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...",
        editingFailed: "This Spark could not be loaded.",
        idle: "Start writing. Changes will be encrypted on this device automatically.",
        incompleteZh: "Add a Chinese title and body before saving.",
        invalidDate: "Choose a valid date and time in Publishing settings.",
        invalidSlug: "The URL slug may contain only lowercase letters, numbers, and hyphens.",
        noChanges: "There are no unsaved changes.",
        privateDraftsEmpty: "No private Spark drafts were found in the encrypted vault.",
        privateDraftsFailed: "Private drafts could not be loaded.",
        privateDraftsFound: (count) => String(count) + (count === 1 ? " encrypted private draft found." : " encrypted private drafts found."),
        privateDraftsLoading: window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...",
        privateDraftOpen: "Continue editing",
        saving: "Encrypting the private record…",
        decoyLoaded: "Private space opened.",
        decoySaved: "Saved in this private space.",
        unlocking: "Waiting for the independent passphrase and passkey…",
        translationCanceled: "Translation canceled; the Chinese draft is unchanged.",
        translationFailed: "The English draft could not be translated.",
        translationReady: "English translation is ready for review and remains an encrypted device draft.",
        translating: "Waiting for DeepSeek to translate the Chinese draft…",
        translateMissing: "Add a Chinese title and body before translating.",
        overwriteTranslation: "Replace the current English draft with a new DeepSeek translation?",
        vaultNotConfigured: "Spark Vault is not configured yet. This draft remains encrypted on this device only.",
        vaultUnlocked: "Spark Vault unlocked for this tab only.",
        viewCommit: "View the public commit on GitHub →",
      }
    : {
        authFailed: "GitHub 登录失败。",
        authSuccess: "已验证 GitHub 站长身份。",
        collision: "这个网址短名已经存在，请在“发布设置”里换一个。",
        commitConflict: "这条 Spark 在打开后已经发生变化，请重新打开再保存。",
        commitFailed: "无法保存这条 Spark。",
        commitPrivateSuccess: "已加密保存为私密稿；公开网站仓库中没有写入 Markdown。",
        commitPublicSuccess: "中文公开版本已保存；英文未完成时会显示待翻译提示，请在右下角查看部署进度。",
        confirmDiscard: "丢弃这份加密浏览器草稿？",
        connected: "锁定 Spark 私密库",
        connecting: "正在打开 GitHub 登录…",
        disconnectConfirm: "锁定 Spark 私密库，并从这台设备移除登录状态？",
        disconnected: "Spark 私密库已锁定，并移除了这台设备的登录状态。",
        draftChanged: "正在为这台设备加密随写随存；内容尚未发送到 GitHub。",
        draftFailed: "这个浏览器无法加密保存本地草稿。",
        draftRestored: "已恢复这台设备上的加密草稿。",
        draftSaved: "已加密保存在这台设备中，尚未发送到 GitHub。",
        editing: window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...",
        editingFailed: "无法载入这条 Spark。",
        idle: "直接开始写，修改会自动加密保存在这台设备中。",
        incompleteZh: "保存前还需要补齐中文标题和正文。",
        invalidDate: "请在“发布设置”里填写有效的日期与时间。",
        invalidSlug: "网址短名只能包含小写字母、数字和连字符。",
        noChanges: "当前没有尚未保存的修改。",
        privateDraftsEmpty: "加密私密库中没有 Spark 草稿。",
        privateDraftsFailed: "无法载入私密草稿。",
        privateDraftsFound: (count) => "已解密载入 " + String(count) + " 条私密草稿。",
        privateDraftsLoading: window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...",
        privateDraftOpen: "继续编辑",
        saving: "正在加密私密记录…",
        decoyLoaded: "已打开私密空间。",
        decoySaved: "已保存到当前私密空间。",
        unlocking: "正在等待独立口令与通行密钥…",
        translationCanceled: "已取消翻译，中文稿保持不变。",
        translationFailed: "无法生成英文译稿。",
        translationReady: "英文译稿已经生成，请检查；内容仍是设备加密草稿。",
        translating: "正在等待 DeepSeek 翻译中文稿…",
        translateMissing: "请先填写中文标题和正文。",
        overwriteTranslation: "用新的 DeepSeek 翻译覆盖当前英文稿？",
        vaultNotConfigured: "Spark 私密库尚未配置；当前草稿只会加密保存在这台设备中。",
        vaultUnlocked: "Spark 私密库已解锁；根密钥只保留在当前标签页内存中。",
        viewCommit: "在 GitHub 查看公开 Commit →",
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
    announce: document.getElementById("site-spark-writer-announce"),
    close: document.getElementById("site-spark-writer-close"),
    comments: document.getElementById("site-spark-writer-comments"),
    connect: document.getElementById("site-spark-writer-connect"),
    create: document.getElementById("site-spark-create"),
    date: document.getElementById("site-spark-writer-date"),
    discard: document.getElementById("site-spark-writer-discard"),
    drafts: document.getElementById("site-spark-drafts"),
    draftsClose: document.getElementById("site-spark-drafts-close"),
    draftsList: document.getElementById("site-spark-drafts-list"),
    draftsPanel: document.getElementById("site-spark-drafts-panel"),
    draftsStatus: document.getElementById("site-spark-drafts-status"),
    heading: document.getElementById("site-spark-writer-heading"),
    kind: document.getElementById("site-spark-writer-kind"),
    message: document.getElementById("site-spark-writer-message"),
    publish: document.getElementById("site-spark-writer-publish"),
    published: document.getElementById("site-spark-writer-published"),
    result: document.getElementById("site-spark-writer-result"),
    slug: document.getElementById("site-spark-writer-slug"),
    status: document.getElementById("site-spark-writer-status"),
    translate: document.getElementById("site-spark-writer-translate"),
  };

  const optionalElements = new Set(["create", "drafts", "draftsClose", "draftsList", "draftsPanel", "draftsStatus"]);
  const requiredElements = Object.entries(elements)
    .filter(([name]) => !optionalElements.has(name))
    .map(([, element]) => element);
  if (!fields.zh.body || !fields.en.body || requiredElements.some((element) => element === null)) return;

  let activeTrigger = toggle;
  let busy = false;
  let currentLanguage = isEnglish ? "en" : "zh";
  let currentMode = "create";
  let currentTranslationKey = "";
  let currentDraftKey = createDraftKey;
  let currentVaultPublic = null;
  let currentVaultPublished = false;
  let currentVaultSha = "";
  let draftTimer = 0;
  let draftWritePromise = Promise.resolve();
  let initialSnapshot = "";
  let originalValues = null;
  let originals = { zh: null, en: null };
  let restorePromise = Promise.resolve(null);
  let slugIsAutomatic = true;
  let sourcePaths = { zh: "", en: "" };
  let vaultSession = null;
  let decoyMode = false;
  const disconnectedLabel = elements.connect.querySelector("span")?.textContent.trim() || "GitHub";
  const decoyNotes = [
    {
      date: "2026-08-01T21:10",
      decoy: true,
      id: "next-stage",
      kind: "note",
      published: false,
      title: { en: "", zh: "阶段记录：下一步" },
      values: {
        announce: false,
        comments: false,
        date: "2026-08-01T21:10",
        en: { body: "", summary: "", title: "" },
        kind: "note",
        message: "",
        published: false,
        slug: "next-stage",
        zh: {
          body: "最近想把手头的事情重新排一下优先级。先完成正在推进的原型，再决定哪些想法值得继续投入。",
          summary: "重新整理近期优先级。",
          title: "阶段记录：下一步",
        },
      },
    },
    {
      date: "2026-07-28T23:40",
      decoy: true,
      id: "site-notes",
      kind: "note",
      published: false,
      title: { en: "", zh: "暂不公开的主页想法" },
      values: {
        announce: false,
        comments: false,
        date: "2026-07-28T23:40",
        en: { body: "", summary: "", title: "" },
        kind: "note",
        message: "",
        published: false,
        slug: "site-notes",
        zh: {
          body: "主页还是应该保持安静，只在需要时出现工具。动画可以有，但不能抢走内容本身的注意力。",
          summary: "关于主页节奏的备忘。",
          title: "暂不公开的主页想法",
        },
      },
    },
  ];

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDateTime(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function defaultSlug(date = new Date()) {
    return `spark-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
      date.getMinutes()
    )}${pad(date.getSeconds())}`;
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

  function setDraftsStatus(message, state = "") {
    if (!elements.draftsStatus) return;
    elements.draftsStatus.textContent = message;
    if (state) elements.draftsStatus.dataset.state = state;
    else delete elements.draftsStatus.dataset.state;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    elements.close.disabled = nextBusy;
    elements.connect.disabled = nextBusy;
    elements.discard.disabled = nextBusy;
    if (elements.drafts) elements.drafts.disabled = nextBusy;
    elements.publish.disabled = nextBusy;
    elements.published.disabled = nextBusy;
    elements.translate.disabled = nextBusy;
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
      announce: elements.announce.checked,
      comments: elements.comments.checked,
      date: elements.date.value,
      en: {
        body: fields.en.body.value,
        summary: fields.en.summary.value,
        title: fields.en.title.value,
      },
      kind: elements.kind.value,
      message: elements.message.value,
      published: elements.published.checked,
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
    elements.announce.checked = values.announce === true;
    elements.date.value = values.date || localDateTime();
    elements.slug.value = values.slug || defaultSlug();
    elements.comments.checked = values.comments !== false;
    elements.published.checked = values.published === true;
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

  function draftStorageId(key) {
    return `spark-draft:${key}`;
  }

  async function forgetDraft(key = currentDraftKey) {
    window.localStorage.removeItem(key);
    await window.functionhxGitHubAuth?.forgetOpaque?.({ id: draftStorageId(key) }).catch(() => undefined);
  }

  async function persistDraft(showStatus = false) {
    try {
      window.localStorage.removeItem(currentDraftKey);
      if (!isDirty()) {
        await forgetDraft(currentDraftKey);
        if (showStatus) setStatus(strings.noChanges);
        return;
      }
      if (!window.functionhxGitHubAuth?.saveOpaque) throw new Error("Encrypted device storage is unavailable.");
      await window.functionhxGitHubAuth.saveOpaque({
        id: draftStorageId(currentDraftKey),
        value: JSON.stringify({
          mode: currentMode,
          savedAt: new Date().toISOString(),
          slugIsAutomatic,
          sourcePaths,
          translationKey: currentTranslationKey,
          values: readValues(),
        }),
      });
      if (showStatus) setStatus(strings.draftSaved, "success");
    } catch (_error) {
      if (showStatus) setStatus(strings.draftFailed, "error");
    }
  }

  function saveDraft(showStatus = false) {
    draftWritePromise = draftWritePromise.catch(() => undefined).then(() => persistDraft(showStatus));
    return draftWritePromise;
  }

  async function restoreDraft() {
    try {
      await draftWritePromise.catch(() => undefined);
      let serialized = await window.functionhxGitHubAuth?.restoreOpaque?.({ id: draftStorageId(currentDraftKey) });
      const legacy = window.localStorage.getItem(currentDraftKey) || "";
      window.localStorage.removeItem(currentDraftKey);
      if (!serialized && legacy) {
        serialized = legacy;
        await window.functionhxGitHubAuth?.saveOpaque?.({ id: draftStorageId(currentDraftKey), value: legacy }).catch(() => undefined);
      }
      const draft = JSON.parse(serialized || "null");
      if (!draft?.values) return false;
      if (typeof draft.values.published !== "boolean") draft.values.published = elements.published.checked;
      writeValues(draft.values);
      slugIsAutomatic = draft.slugIsAutomatic !== false;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function scheduleDraftSave() {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => saveDraft(true), 350);
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

  function toInputDate(value) {
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    return match ? `${match[1]}T${match[2]}` : localDateTime();
  }

  function validate() {
    if (!languageComplete("zh")) {
      selectLanguage("zh");
      setStatus(strings.incompleteZh, "error");
      fields.zh.title.focus();
      return false;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(elements.slug.value)) {
      setStatus(strings.invalidSlug, "error");
      root.querySelector(".site-spark-writer__settings").open = true;
      elements.slug.focus();
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(elements.date.value)) {
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

  async function githubRequest(endpoint) {
    const response = await window.fetch(`https://api.github.com${endpoint}`, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      method: "GET",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || `GitHub API ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadRemoteSource(language, path) {
    const remote = await githubRequest(`/repos/${repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
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
      announce: extractYamlBoolean(zhFrontMatter, "announce"),
      comments: extractYamlBoolean(zhFrontMatter, "giscus_comments"),
      date: toInputDate(extractYamlScalar(zhFrontMatter, "date")),
      en: {
        body: enSource.body,
        summary: extractYamlScalar(enFrontMatter, "description"),
        title: extractYamlScalar(enFrontMatter, "title"),
      },
      kind: extractYamlScalar(zhFrontMatter, "kind") || "note",
      message: "",
      published: true,
      slug: extractYamlScalar(zhFrontMatter, "slug"),
      zh: {
        body: zhSource.body,
        summary: extractYamlScalar(zhFrontMatter, "description"),
        title: extractYamlScalar(zhFrontMatter, "title"),
      },
    };
  }

  function setConnection(session) {
    vaultSession = session || null;
    const connectLabel = elements.connect.querySelector("span");
    const unlocked = Boolean(vaultSession && vaultClient?.isUnlocked?.(vaultEndpoint));
    if (connectLabel) connectLabel.textContent = unlocked ? strings.connected : disconnectedLabel;
    elements.connect.dataset.connected = String(unlocked);
  }

  function vaultReady() {
    return Boolean(vaultClient && vaultEndpoint && !vaultConfigurationError);
  }

  async function restoreVaultSession() {
    if (!vaultReady()) {
      setConnection(null);
      return null;
    }
    const session = await vaultClient.restore(vaultEndpoint).catch(() => null);
    setConnection(session);
    return session;
  }

  async function ensureVaultSession() {
    await restorePromise;
    if (!vaultReady()) {
      setStatus(`${strings.vaultNotConfigured}${vaultConfigurationError ? ` ${vaultConfigurationError}` : ""}`, "error");
      return null;
    }
    if (vaultSession) return vaultSession;
    setStatus(strings.connecting);
    try {
      const session = await vaultClient.login(vaultEndpoint, {
        returnTo: `${window.location.pathname}${window.location.search}`,
      });
      setConnection(session);
      setStatus(strings.authSuccess, "success");
      return session;
    } catch (error) {
      setConnection(null);
      setStatus(`${strings.authFailed} ${error.message || ""}`.trim(), "error");
      return null;
    }
  }

  async function ensureVaultUnlocked() {
    const session = await ensureVaultSession();
    if (!session) return null;
    if (vaultClient.isUnlocked?.(vaultEndpoint)) return { decoy: false, unlocked: true };
    setStatus(strings.unlocking);
    try {
      const result = await vaultClient.unlock(vaultEndpoint);
      if (result?.decoy) {
        decoyMode = true;
        setStatus(strings.decoyLoaded, "success");
        setConnection(session);
        return result;
      }
      decoyMode = false;
      setConnection(session);
      setStatus(strings.vaultUnlocked, "success");
      return result;
    } catch (error) {
      setStatus(`${strings.authFailed} ${error.message || ""}`.trim(), "error");
      return null;
    }
  }

  async function disconnectVault(ask = true) {
    if (ask && !window.confirm(strings.disconnectConfirm)) return;
    if (vaultReady()) await vaultClient.logout(vaultEndpoint).catch(() => undefined);
    decoyMode = false;
    setConnection(null);
    setStatus(strings.disconnected);
  }

  async function handleConnectButton() {
    await restorePromise;
    if (vaultSession && vaultClient.isUnlocked?.(vaultEndpoint)) {
      await disconnectVault(true);
      return;
    }
    await ensureVaultUnlocked();
  }

  async function vaultRequest(path, options = {}) {
    try {
      return await vaultClient.request(vaultEndpoint, path, options);
    } catch (error) {
      if (error.status === 401) setConnection(null);
      throw error;
    }
  }

  function privateTransportValues(values, sealed) {
    return {
      announce: false,
      comments: false,
      date: values.date,
      en: { body: "", summary: "", title: "" },
      kind: values.kind,
      message: "",
      published: false,
      slug: values.slug,
      zh: { body: sealed, summary: "", title: "Private Spark" },
    };
  }

  async function hydrateVaultNote(note) {
    if (!note) return note;
    const sealed = note.sealed || note.values?.zh?.body || "";
    if (!vaultClient.isSealed?.(sealed)) return note;
    const values = await vaultClient.openValues(vaultEndpoint, note.id, sealed);
    values.published = note.published === true;
    return {
      ...note,
      date: values.date,
      kind: values.kind,
      published: note.published === true,
      title: { en: values.en?.title || "", zh: values.zh?.title || "" },
      values,
      zeroKnowledge: true,
    };
  }

  async function hydrateVaultNotes(notes) {
    const hydrated = [];
    for (const note of notes) hydrated.push(await hydrateVaultNote(note));
    return hydrated;
  }

  async function privatePayloadValues(values) {
    const sealed = await vaultClient.sealValues(vaultEndpoint, values.slug, values);
    return privateTransportValues(values, sealed);
  }

  function renderPrivateDrafts(notes) {
    elements.draftsList.replaceChildren();
    const drafts = notes.filter((note) => note.published === false);
    setDraftsStatus(drafts.length ? strings.privateDraftsFound(drafts.length) : strings.privateDraftsEmpty);
    for (const note of drafts) {
      const item = document.createElement("li");
      const meta = document.createElement("div");
      meta.className = "site-spark-draft-meta";
      const title = document.createElement("strong");
      title.textContent = note.title?.zh || note.title?.en || note.id;
      const detail = document.createElement("span");
      detail.textContent = String(note.date || "")
        .slice(0, 16)
        .replace("T", " ");
      meta.append(title, detail);

      const open = document.createElement("button");
      open.type = "button";
      open.className = "site-spark-draft-open";
      open.textContent = strings.privateDraftOpen;
      open.addEventListener("click", () => {
        elements.draftsPanel.hidden = true;
        if (note.decoy) openDecoyNote(note, open);
        else openEdit({ translationKey: `spark-${note.id}`, vaultId: note.id }, open);
      });
      item.append(meta, open);
      elements.draftsList.append(item);
    }
  }

  async function loadPrivateDrafts() {
    if (!elements.draftsPanel) return;
    const access = await ensureVaultUnlocked();
    if (!access) return;
    if (!root.hidden) closeWriter();
    elements.draftsPanel.hidden = false;
    elements.draftsList.replaceChildren();
    if (access.decoy) {
      renderPrivateDrafts(decoyNotes);
      return;
    }
    setDraftsStatus(window.functionhxSitePreferences?.getLoadingText?.() || strings.privateDraftsLoading);
    setBusy(true);
    try {
      const payload = await vaultRequest("/api/notes");
      renderPrivateDrafts(await hydrateVaultNotes(Array.isArray(payload.notes) ? payload.notes : []));
    } catch (error) {
      setDraftsStatus(`${strings.privateDraftsFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      setBusy(false);
    }
  }

  function resetVaultState() {
    currentVaultPublic = null;
    currentVaultPublished = false;
    currentVaultSha = "";
    originalValues = null;
    originals = { zh: null, en: null };
  }

  async function prepareCreate() {
    currentMode = "create";
    decoyMode = false;
    currentTranslationKey = "";
    currentDraftKey = createDraftKey;
    sourcePaths = { zh: "", en: "" };
    resetVaultState();
    slugIsAutomatic = true;
    const now = new Date();
    writeValues({
      announce: false,
      comments: true,
      date: localDateTime(now),
      en: { body: "", summary: "", title: "" },
      kind: "note",
      message: "",
      published: false,
      slug: defaultSlug(now),
      zh: { body: "", summary: "", title: "" },
    });
    initialSnapshot = snapshot();
    const restored = await restoreDraft();
    elements.slug.readOnly = false;
    elements.heading.textContent = elements.heading.dataset.newHeading;
    elements.result.hidden = true;
    setStatus(restored ? strings.draftRestored : strings.idle, restored ? "success" : "");
  }

  function noteIdFromConfig(config) {
    if (config.vaultId) return config.vaultId;
    return String(config.translationKey || "").replace(/^spark-/, "");
  }

  async function loadVaultNote(id, requiredNote) {
    if (!id || !vaultSession) return null;
    try {
      const payload = await vaultRequest(`/api/notes/${encodeURIComponent(id)}`);
      return hydrateVaultNote(payload.note || null);
    } catch (error) {
      if (error.status === 404 && !requiredNote) return null;
      throw error;
    }
  }

  function adoptLoadedVaultNote(note) {
    currentVaultSha = note.sha || "";
    currentVaultPublished = note.published === true;
    currentVaultPublic = note.public || null;
    sourcePaths = note.public?.paths || sourcePaths;
    const values = { ...note.values, message: "", published: note.published === true };
    writeValues(values);
    originalValues = structuredClone(values);
  }

  async function prepareEdit(config) {
    currentMode = "edit";
    decoyMode = false;
    currentTranslationKey = config.translationKey;
    currentDraftKey = `functionhx:spark-writer:${repository}:${branch}:${currentTranslationKey}`;
    sourcePaths = { en: config.enPath || "", zh: config.zhPath || "" };
    resetVaultState();
    elements.slug.readOnly = true;
    elements.heading.textContent = elements.heading.dataset.editHeading;
    elements.result.hidden = true;
    setStatus(window.functionhxSitePreferences?.getLoadingText?.() || strings.editing);
    setBusy(true);
    try {
      await restorePromise;
      if (config.vaultId && !(await ensureVaultUnlocked())) return;
      const id = noteIdFromConfig(config);
      const note = await loadVaultNote(id, Boolean(config.vaultId));
      if (note) {
        adoptLoadedVaultNote(note);
      } else {
        if (!sourcePaths.zh || !sourcePaths.en) throw new Error("The public source paths are unavailable.");
        const [zhSource, enSource] = await Promise.all([loadRemoteSource("zh", sourcePaths.zh), loadRemoteSource("en", sourcePaths.en)]);
        originals = { en: enSource, zh: zhSource };
        const values = valuesFromSources(zhSource, enSource);
        writeValues(values);
        originalValues = structuredClone(values);
        currentVaultPublished = true;
        currentVaultPublic = {
          paths: { ...sourcePaths },
          shas: { en: enSource.sha, zh: zhSource.sha },
        };
      }
      initialSnapshot = snapshot();
      slugIsAutomatic = false;
      const restored = await restoreDraft();
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
    if (isEntryPage) document.body.classList.add("site-spark-entry-writing");
    root.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function openCreate(trigger = elements.create || toggle) {
    if (elements.draftsPanel) elements.draftsPanel.hidden = true;
    if (!root.hidden && currentMode === "create") {
      selectLanguage(currentLanguage, true);
      return;
    }
    if (!root.hidden) await saveDraft(false);
    activeTrigger = trigger;
    await prepareCreate();
    revealWriter();
    selectLanguage(isEnglish ? "en" : "zh");
    window.requestAnimationFrame(() => fields[currentLanguage].title.focus());
  }

  function openDecoyNote(note, trigger = toggle) {
    currentMode = "decoy";
    decoyMode = true;
    currentTranslationKey = `spark-${note.id}`;
    currentDraftKey = `functionhx:spark-decoy:${note.id}`;
    sourcePaths = { en: "", zh: "" };
    resetVaultState();
    activeTrigger = trigger;
    elements.slug.readOnly = true;
    elements.heading.textContent = elements.heading.dataset.editHeading;
    elements.result.hidden = true;
    writeValues(structuredClone(note.values));
    initialSnapshot = snapshot();
    originalValues = structuredClone(note.values);
    revealWriter();
    selectLanguage("zh", true);
    setStatus(strings.decoyLoaded, "success");
    window.requestAnimationFrame(() => fields.zh.body.focus());
  }

  async function openEdit(config, trigger = toggle) {
    if (elements.draftsPanel) elements.draftsPanel.hidden = true;
    if (!root.hidden) await saveDraft(false);
    activeTrigger = trigger;
    revealWriter();
    selectLanguage(isEnglish ? "en" : "zh");
    await prepareEdit(config);
  }

  function closeWriter() {
    saveDraft(false);
    root.hidden = true;
    document.body.classList.remove("site-spark-entry-writing");
    if (activeTrigger && typeof activeTrigger.focus === "function") activeTrigger.focus();
  }

  function publicStateForMigration() {
    if (currentVaultSha || !currentVaultPublished) return undefined;
    if (!currentVaultPublic?.paths?.zh || !currentVaultPublic?.paths?.en) return undefined;
    if (!currentVaultPublic?.shas?.zh || !currentVaultPublic?.shas?.en) return undefined;
    return currentVaultPublic;
  }

  function adoptSavedNote(note) {
    currentMode = "edit";
    currentTranslationKey = `spark-${note.id}`;
    currentDraftKey = `functionhx:spark-writer:${repository}:${branch}:${currentTranslationKey}`;
    currentVaultSha = note.sha || "";
    currentVaultPublished = note.published === true;
    currentVaultPublic = note.public || null;
    sourcePaths = note.public?.paths || { zh: "", en: "" };
    elements.published.checked = note.published === true;
    elements.message.value = "";
    elements.slug.readOnly = true;
    elements.heading.textContent = elements.heading.dataset.editHeading;
    initialSnapshot = snapshot();
    originalValues = structuredClone(readValues());
  }

  async function publishPair() {
    await restorePromise;
    if (busy || !validate()) return;
    if (!isDirty()) {
      setStatus(strings.noChanges);
      return;
    }
    if (currentMode === "decoy" || decoyMode) {
      await saveDraft(false);
      initialSnapshot = snapshot();
      setStatus(strings.decoySaved, "success");
      return;
    }
    const values = readValues();
    const desiredPublished = values.published === true;
    const access = desiredPublished ? await ensureVaultSession() : await ensureVaultUnlocked();
    if (!access || access.decoy) return;

    setBusy(true);
    setStatus(strings.saving);
    elements.result.hidden = true;
    const draftKeyBeforeSave = currentDraftKey;
    try {
      const payload = {
        expectedSha: currentVaultSha,
        message: values.message.trim(),
        public: publicStateForMigration(),
        values: desiredPublished ? values : await privatePayloadValues(values),
      };
      const saved = await vaultRequest(`/api/notes/${encodeURIComponent(values.slug)}`, {
        body: payload,
        method: "PUT",
      });
      let note = await hydrateVaultNote(saved.note);
      currentVaultSha = note.sha || "";
      currentVaultPublished = note.published === true;
      currentVaultPublic = note.public || null;
      let commit = null;
      if (desiredPublished) {
        const published = await vaultRequest(`/api/notes/${encodeURIComponent(values.slug)}/publish`, {
          body: { expectedSha: note.sha, message: values.message.trim() },
          method: "POST",
        });
        note = await hydrateVaultNote(published.note);
        commit = published.commit;
      } else if (note.published) {
        const unpublished = await vaultRequest(`/api/notes/${encodeURIComponent(values.slug)}/unpublish`, {
          body: { expectedSha: note.sha, message: values.message.trim() },
          method: "POST",
        });
        note = await hydrateVaultNote(unpublished.note);
        commit = unpublished.commit;
      }

      await forgetDraft(draftKeyBeforeSave);
      adoptSavedNote(note);
      await forgetDraft(currentDraftKey);
      setStatus(note.published ? strings.commitPublicSuccess : strings.commitPrivateSuccess, "success");
      if (commit?.html_url) {
        elements.result.href = commit.html_url;
        elements.result.textContent = strings.viewCommit;
        elements.result.hidden = false;
      }
      if (commit) window.functionhxDeployment?.watch(commit);
    } catch (error) {
      const known = {
        public_collision: strings.collision,
        public_conflict: strings.commitConflict,
        vault_conflict: strings.commitConflict,
      }[error.code];
      setStatus(known || `${strings.commitFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (isDirty() && !window.confirm(strings.confirmDiscard)) return;
    await forgetDraft(currentDraftKey);
    if (currentMode === "create") {
      await prepareCreate();
      selectLanguage(isEnglish ? "en" : "zh", true);
      return;
    }
    if (originalValues) {
      writeValues(structuredClone(originalValues));
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
      if (error.name === "AbortError") setStatus(strings.translationCanceled);
      else setStatus(`${strings.translationFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      elements.translate.disabled = false;
    }
  }

  if (elements.create) elements.create.addEventListener("click", () => openCreate(elements.create));
  if ((toggle.dataset.editorAction || "").startsWith("spark-")) {
    toggle.addEventListener("click", () => {
      if (toggle.dataset.editorAction === "spark-create") openCreate(toggle);
      else {
        openEdit(
          {
            enPath: root.dataset.sourcePathEn,
            translationKey: root.dataset.translationKey,
            zhPath: root.dataset.sourcePathZh,
          },
          toggle
        );
      }
    });
  }
  if (elements.drafts) elements.drafts.addEventListener("click", loadPrivateDrafts);
  if (elements.draftsClose) {
    elements.draftsClose.addEventListener("click", () => {
      elements.draftsPanel.hidden = true;
      elements.drafts.focus();
    });
  }
  elements.close.addEventListener("click", closeWriter);
  elements.discard.addEventListener("click", discardDraft);
  elements.connect.addEventListener("click", handleConnectButton);
  elements.publish.addEventListener("click", publishPair);
  elements.translate.addEventListener("click", translateChineseDraft);
  fields.zh.tab.addEventListener("click", () => selectLanguage("zh", true));
  fields.en.tab.addEventListener("click", () => selectLanguage("en", true));

  document.addEventListener("click", (event) => {
    const authorTrigger = event.target.closest("[data-author-action]");
    if (authorTrigger?.dataset.authorAction === "spark-create") {
      openCreate(authorTrigger);
      return;
    }
    if (authorTrigger?.dataset.authorAction === "spark-drafts") {
      loadPrivateDrafts();
      return;
    }
    if (authorTrigger?.dataset.authorAction === "spark-edit") {
      openEdit(
        {
          enPath: authorTrigger.dataset.sourcePathEn,
          translationKey: authorTrigger.dataset.translationKey,
          zhPath: authorTrigger.dataset.sourcePathZh,
        },
        authorTrigger
      );
      return;
    }
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

  for (const field of [elements.announce, elements.comments, elements.date, elements.kind, elements.message, elements.published]) {
    field.addEventListener("input", handleChange);
    field.addEventListener("change", handleChange);
  }
  elements.slug.addEventListener("input", () => {
    slugIsAutomatic = false;
    elements.slug.value = slugify(elements.slug.value);
    handleChange();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !root.hidden && !authDialog?.open) closeWriter();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !root.hidden) publishPair();
  });

  window.addEventListener("functionhx:spark-vault-auth-changed", (event) => {
    if (event.detail?.endpoint !== vaultEndpoint) return;
    if (!event.detail.connected) setConnection(null);
  });

  restorePromise = restoreVaultSession();
  selectLanguage(currentLanguage);
  if (new URLSearchParams(window.location.search).get("compose") === "1") openCreate(toggle);
})();
