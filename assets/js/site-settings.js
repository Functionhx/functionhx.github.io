(function initializeSiteSettings() {
  "use strict";

  const dialog = document.getElementById("site-settings-dialog");
  const root = document.getElementById("site-settings");
  const toggle = document.getElementById("site-settings-toggle");
  const authDialog = document.getElementById("site-settings-auth");

  if (!dialog || !root || !toggle || !authDialog) return;

  const repository = root.dataset.repository;
  const owner = root.dataset.owner;
  const branch = root.dataset.branch;
  const isEnglish = root.dataset.language === "en";

  const strings = isEnglish
    ? {
        authFailed: "GitHub connection failed.",
        authMissing: "Paste a fine-grained token first.",
        authRememberFailed: "Connected for this page, but this browser could not remember the token securely.",
        authRemembered: "Connected as @Functionhx and remembered on this private device.",
        authSuccess: "Connected as @Functionhx for this settings session.",
        collision: "That section already exists. Choose another URL slug.",
        commitFailed: "The site settings could not be committed.",
        commitSuccess: "Settings committed. Follow the publishing progress in the corner.",
        connected: "Disconnect @Functionhx",
        disconnectConfirm: "Forget the trusted GitHub token on this device?",
        disconnected: "The trusted GitHub connection was removed from this device.",
        defaultMessage: "site: update sections",
        incompleteNew: "Add both titles and a URL slug for the new section.",
        invalidOrder: "Navigation order must be a number from 1 to 999.",
        invalidSlug: "The URL slug may contain only lowercase letters, numbers, and hyphens.",
        loading: "Preparing all changed bilingual section files…",
        missingChinese: "Add a Chinese title or description before translating.",
        noChanges: "There are no section changes to commit.",
        pending: "Changes are ready in this panel but have not been committed.",
        translationCanceled: "Translation canceled; the Chinese fields are unchanged.",
        translationFailed: "The English fields could not be translated.",
        translationReady: "English fields are ready for review. Nothing has been published.",
        translating: "Waiting for DeepSeek to translate the Chinese fields…",
        overwriteTranslation: "Replace the current English fields with a new DeepSeek translation?",
        verify: "Verifying this token and repository access…",
        viewCommit: "View the commit on GitHub →",
      }
    : {
        authFailed: "GitHub 连接失败。",
        authMissing: "请先粘贴 fine-grained token。",
        authRememberFailed: "本页已经连接，但这个浏览器无法安全地记住令牌。",
        authRemembered: "已连接为 @Functionhx，并记住这台私人电脑。",
        authSuccess: "本次设置会话已连接为 @Functionhx。",
        collision: "这个栏目已经存在，请更换网址短名。",
        commitFailed: "无法提交站点设置。",
        commitSuccess: "设置已提交，请在右下角查看发布进度。",
        connected: "退出 @Functionhx",
        disconnectConfirm: "从这台设备移除已记住的 GitHub 令牌？",
        disconnected: "已从这台设备移除 GitHub 连接。",
        defaultMessage: "site: update sections",
        incompleteNew: "新栏目需要同时填写中英文名称和网址短名。",
        invalidOrder: "导航顺序必须是 1 到 999 之间的数字。",
        invalidSlug: "网址短名只能包含小写字母、数字和连字符。",
        loading: "正在准备所有发生变化的中英文栏目文件…",
        missingChinese: "请先填写中文名称或中文简介。",
        noChanges: "当前没有需要提交的栏目修改。",
        pending: "修改已保留在这个面板中，但尚未提交。",
        translationCanceled: "已取消翻译，中文内容保持不变。",
        translationFailed: "无法生成英文翻译。",
        translationReady: "英文内容已经生成，请检查后再提交；目前尚未发布。",
        translating: "正在等待 DeepSeek 翻译中文内容…",
        overwriteTranslation: "用新的 DeepSeek 翻译覆盖当前英文内容？",
        verify: "正在验证令牌和仓库权限…",
        viewCommit: "在 GitHub 查看 Commit →",
      };

  const elements = {
    authCancel: document.getElementById("site-settings-auth-cancel"),
    authConnect: document.getElementById("site-settings-auth-connect"),
    authRemember: document.getElementById("site-settings-auth-remember"),
    authStatus: document.getElementById("site-settings-auth-status"),
    clear: document.getElementById("site-settings-clear"),
    close: document.getElementById("site-settings-close"),
    commit: document.getElementById("site-settings-commit"),
    connect: document.getElementById("site-settings-connect"),
    descriptionEn: document.getElementById("site-settings-description-en"),
    descriptionZh: document.getElementById("site-settings-description-zh"),
    format: document.getElementById("site-settings-format"),
    newDetails: document.getElementById("site-settings-new"),
    newVisible: document.getElementById("site-settings-new-visible"),
    order: document.getElementById("site-settings-order"),
    result: document.getElementById("site-settings-result"),
    slug: document.getElementById("site-settings-slug"),
    status: document.getElementById("site-settings-status"),
    titleEn: document.getElementById("site-settings-title-en"),
    titleZh: document.getElementById("site-settings-title-zh"),
    token: document.getElementById("site-settings-token"),
    translate: document.getElementById("site-settings-translate"),
  };
  const sectionToggles = [...document.querySelectorAll("[data-section-toggle]")];

  if (Object.values(elements).some((element) => !element) || !sectionToggles.length) return;

  let activeToken = "";
  let busy = false;
  let pendingCommit = false;
  let slugIsAutomatic = true;
  let restorePromise = Promise.resolve(null);
  const disconnectedLabel = elements.connect.querySelector("span")?.textContent.trim() || "GitHub";

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
    elements.authConnect.disabled = nextBusy;
    elements.clear.disabled = nextBusy;
    elements.close.disabled = nextBusy;
    elements.commit.disabled = nextBusy;
    elements.connect.disabled = nextBusy;
    elements.translate.disabled = nextBusy;
    sectionToggles.forEach((input) => {
      input.disabled = nextBusy;
    });
  }

  function openDialog(target) {
    if (typeof target.showModal === "function") target.showModal();
    else target.setAttribute("open", "");
  }

  function closeDialog(target) {
    if (typeof target.close === "function") target.close();
    else target.removeAttribute("open");
  }

  function openSettings() {
    openDialog(dialog);
    toggle.setAttribute("aria-expanded", "true");
  }

  function closeSettings() {
    closeDialog(dialog);
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }

  function slugify(value) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  function changedSections() {
    return sectionToggles.filter((input) => input.checked !== (input.dataset.initialVisible === "true"));
  }

  function readNewSection() {
    return {
      descriptionEn: elements.descriptionEn.value.trim(),
      descriptionZh: elements.descriptionZh.value.trim(),
      format: elements.format.value,
      order: Number(elements.order.value),
      slug: elements.slug.value.trim(),
      titleEn: elements.titleEn.value.trim(),
      titleZh: elements.titleZh.value.trim(),
      visible: elements.newVisible.checked,
    };
  }

  function hasNewSection(values = readNewSection()) {
    return Boolean(values.titleZh || values.titleEn || values.descriptionZh || values.descriptionEn || values.slug);
  }

  function validateNewSection(values) {
    if (!hasNewSection(values)) return true;
    if (!values.titleZh || !values.titleEn || !values.slug) {
      elements.newDetails.open = true;
      setStatus(strings.incompleteNew, "error");
      (values.titleZh ? (values.titleEn ? elements.slug : elements.titleEn) : elements.titleZh).focus();
      return false;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) {
      elements.newDetails.open = true;
      setStatus(strings.invalidSlug, "error");
      elements.slug.focus();
      return false;
    }
    if (!Number.isInteger(values.order) || values.order < 1 || values.order > 999) {
      elements.newDetails.open = true;
      setStatus(strings.invalidOrder, "error");
      elements.order.focus();
      return false;
    }
    return true;
  }

  function clearNewSection() {
    elements.titleZh.value = "";
    elements.titleEn.value = "";
    elements.descriptionZh.value = "";
    elements.descriptionEn.value = "";
    elements.slug.value = "";
    elements.order.value = "50";
    elements.format.value = "page";
    elements.newVisible.checked = true;
    slugIsAutomatic = true;
    setStatus(changedSections().length ? strings.pending : strings.noChanges);
  }

  async function translateNewSection() {
    const title = elements.titleZh.value.trim();
    const summary = elements.descriptionZh.value.trim();
    if (!title && !summary) {
      elements.newDetails.open = true;
      setStatus(strings.missingChinese, "error");
      elements.titleZh.focus();
      return;
    }
    if ((elements.titleEn.value.trim() || elements.descriptionEn.value.trim()) && !window.confirm(strings.overwriteTranslation)) {
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
        body: "",
        summary,
        title,
      });
      elements.titleEn.value = translated.title;
      elements.descriptionEn.value = translated.summary;
      if (slugIsAutomatic) elements.slug.value = slugify(translated.title);
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

  function encodePath(path) {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  function decodeBase64Utf8(encoded) {
    const binary = window.atob(encoded.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
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

  function setNavigationVisibility(source, visible) {
    const replacement = `nav: ${visible ? "true" : "false"}`;
    if (/^nav:.*$/m.test(source)) return source.replace(/^nav:.*$/m, replacement);
    const closing = source.indexOf("\n---", 4);
    if (closing < 0) throw new Error("Missing YAML front matter");
    return `${source.slice(0, closing)}\n${replacement}${source.slice(closing)}`;
  }

  function projectGridBody(language, slug) {
    return `<div class="projects">
  {% assign localized_projects = site.projects | where: "lang", "${language}" | where: "section_key", "${slug}" | sort: "importance" %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for project in localized_projects %}
      {% include projects.liquid %}
    {% endfor %}
  </div>
</div>
`;
  }

  function createPageSource(language, values) {
    const isEn = language === "en";
    const title = isEn ? values.titleEn : values.titleZh;
    const description = isEn ? values.descriptionEn : values.descriptionZh;
    const permalink = isEn ? `/en/${values.slug}/` : `/${values.slug}/`;
    const layout = values.format === "profiles" ? "profiles" : "page";
    const frontMatter = [
      "---",
      `layout: ${layout}`,
      `title: ${JSON.stringify(title)}`,
      `permalink: ${permalink}`,
      `description: ${JSON.stringify(description)}`,
      `lang: ${language}`,
      `translation_key: section-${values.slug}`,
      `settings_file_stem: ${values.slug}`,
      `nav: ${values.visible ? "true" : "false"}`,
      `nav_order: ${values.order}`,
    ];

    let body = "";
    if (values.format === "posts") {
      frontMatter.push(`kind: ${values.slug}`);
      frontMatter.push(`empty_text: ${JSON.stringify(isEn ? "No entries yet." : "暂无内容。")}`);
      body = "{% include post-lane.liquid %}\n";
    } else if (values.format === "projects") {
      body = projectGridBody(language, values.slug);
    } else if (values.format === "profiles") {
      frontMatter.push("profiles: []");
    } else if (values.format === "repositories") {
      body = "{% include repositories-index.liquid %}\n";
    }

    frontMatter.push("---", "");
    return `${frontMatter.join("\n")}${body ? `${body}` : ""}`;
  }

  async function fetchFileAt(path, ref) {
    const remote = await githubRequest(`/repos/${repository}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, {
      token: activeToken,
    });
    if (remote.type !== "file" || !remote.content) throw new Error(`Unsupported source: ${path}`);
    return decodeBase64Utf8(remote.content);
  }

  async function prepareTreeEntries(headSha, sectionChanges, newSection) {
    const existingEntries = await Promise.all(
      sectionChanges.flatMap((input) =>
        ["zh", "en"].map(async (language) => {
          const path = input.dataset[`sourcePath${language === "zh" ? "Zh" : "En"}`];
          if (!path) throw new Error(`Missing ${language} source for ${input.dataset.translationKey}`);
          const source = await fetchFileAt(path, headSha);
          return {
            content: setNavigationVisibility(source, input.checked),
            mode: "100644",
            path,
            type: "blob",
          };
        })
      )
    );

    if (!hasNewSection(newSection)) return existingEntries;
    const newPaths = {
      en: `_pages/${newSection.slug}-en.md`,
      zh: `_pages/${newSection.slug}-zh.md`,
    };
    const collisions = await Promise.all(
      ["zh", "en"].map((language) =>
        githubRequest(`/repos/${repository}/contents/${encodePath(newPaths[language])}?ref=${encodeURIComponent(headSha)}`, {
          allowNotFound: true,
          token: activeToken,
        })
      )
    );
    if (collisions.some(Boolean)) throw new Error(strings.collision);

    return [
      ...existingEntries,
      ...["zh", "en"].map((language) => ({
        content: createPageSource(language, newSection),
        mode: "100644",
        path: newPaths[language],
        type: "blob",
      })),
    ];
  }

  async function createAtomicCommit(entries, headSha, baseTree, newSection) {
    const tree = await githubRequest(`/repos/${repository}/git/trees`, {
      body: { base_tree: baseTree, tree: entries },
      method: "POST",
      token: activeToken,
    });
    const message = hasNewSection(newSection) ? `site: add section "${newSection.slug}"` : strings.defaultMessage;
    const commit = await githubRequest(`/repos/${repository}/git/commits`, {
      body: { message, parents: [headSha], tree: tree.sha },
      method: "POST",
      token: activeToken,
    });
    await githubRequest(`/repos/${repository}/git/refs/heads/${encodeURIComponent(branch)}`, {
      body: { force: false, sha: commit.sha },
      method: "PATCH",
      token: activeToken,
    });
    return commit;
  }

  function openAuth(shouldCommit = false) {
    pendingCommit = shouldCommit;
    setAuthStatus("");
    elements.token.value = "";
    openDialog(authDialog);
    window.requestAnimationFrame(() => elements.token.focus());
  }

  function closeAuth() {
    elements.token.value = "";
    closeDialog(authDialog);
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
    openAuth(false);
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
      const continueCommit = pendingCommit;
      pendingCommit = false;
      window.setTimeout(
        () => {
          closeAuth();
          if (continueCommit) commitSettings();
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

  async function commitSettings() {
    await restorePromise;
    if (busy) return;
    const sectionChanges = changedSections();
    const newSection = readNewSection();
    if (!validateNewSection(newSection)) return;
    if (!sectionChanges.length && !hasNewSection(newSection)) {
      setStatus(strings.noChanges);
      return;
    }
    if (!activeToken) {
      openAuth(true);
      return;
    }

    setBusy(true);
    setStatus(strings.loading);
    elements.result.hidden = true;
    try {
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
      const entries = await prepareTreeEntries(headSha, sectionChanges, newSection);
      const commit = await createAtomicCommit(entries, headSha, baseTree, newSection);

      sectionChanges.forEach((input) => {
        input.dataset.initialVisible = String(input.checked);
      });
      clearNewSection();
      setStatus(strings.commitSuccess, "success");
      if (commit.html_url) {
        elements.result.href = commit.html_url;
        elements.result.textContent = strings.viewCommit;
        elements.result.hidden = false;
      }
      window.functionhxDeployment?.watch(commit);
    } catch (error) {
      if (error.status === 401 || error.status === 403) await disconnectGitHub(false);
      const message = error.message === strings.collision ? error.message : `${strings.commitFailed} ${error.message || ""}`.trim();
      setStatus(message, "error");
    } finally {
      setBusy(false);
    }
  }

  toggle.addEventListener("click", openSettings);
  elements.close.addEventListener("click", closeSettings);
  dialog.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
  });
  sectionToggles.forEach((input) => {
    input.addEventListener("change", () => {
      setStatus(strings.pending);
      elements.result.hidden = true;
    });
  });
  for (const input of [
    elements.titleZh,
    elements.titleEn,
    elements.descriptionZh,
    elements.descriptionEn,
    elements.order,
    elements.format,
    elements.newVisible,
  ]) {
    input.addEventListener("input", () => setStatus(strings.pending));
    input.addEventListener("change", () => setStatus(strings.pending));
  }
  elements.titleEn.addEventListener("input", () => {
    if (slugIsAutomatic) elements.slug.value = slugify(elements.titleEn.value);
  });
  elements.slug.addEventListener("input", () => {
    slugIsAutomatic = false;
    elements.slug.value = slugify(elements.slug.value);
    setStatus(strings.pending);
  });
  elements.clear.addEventListener("click", clearNewSection);
  elements.translate.addEventListener("click", translateNewSection);
  elements.connect.addEventListener("click", handleConnectButton);
  elements.commit.addEventListener("click", commitSettings);
  elements.authCancel.addEventListener("click", () => {
    pendingCommit = false;
    closeAuth();
  });
  elements.authConnect.addEventListener("click", connectGitHub);
  elements.token.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connectGitHub();
  });
  authDialog.addEventListener("close", () => {
    elements.token.value = "";
  });
  window.addEventListener("functionhx:github-auth-changed", (event) => {
    if (event.detail?.repository !== repository) return;
    restorePromise = restoreGitHubSession();
  });
  restorePromise = restoreGitHubSession();
})();
