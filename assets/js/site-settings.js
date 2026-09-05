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
  const uiSettingsPath = root.dataset.uiSettingsPath;
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
        commitSuccess: "Settings saved. Publishing the new version…",
        connected: "Disconnect @Functionhx",
        disconnectConfirm: "Forget the trusted GitHub token on this device?",
        disconnected: "The trusted GitHub connection was removed from this device.",
        defaultMessage: "site: update site settings",
        incompleteNew: "Add a Chinese title and URL slug. English can be translated later.",
        invalidOrder: "Navigation order must be a number from 1 to 999.",
        invalidSlug: "The URL slug may contain only lowercase letters, numbers, and hyphens.",
        loading: window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...",
        missingChinese: "Add a Chinese title or description before translating.",
        noChanges: "No unpublished changes.",
        pending: "Changes are not published yet.",
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
        commitSuccess: "设置已保存，正在发布新版本…",
        connected: "退出 @Functionhx",
        disconnectConfirm: "从这台设备移除已记住的 GitHub 令牌？",
        disconnected: "已从这台设备移除 GitHub 连接。",
        defaultMessage: "site: update site settings",
        incompleteNew: "新栏目只需填写中文名称和网址短名；英文可以稍后补充。",
        invalidOrder: "导航顺序必须是 1 到 999 之间的数字。",
        invalidSlug: "网址短名只能包含小写字母、数字和连字符。",
        loading: window.functionhxSitePreferences?.getLoadingText?.() || "Thinking...",
        missingChinese: "请先填写中文名称或中文简介。",
        noChanges: "没有待发布的修改。",
        pending: "修改尚未发布。",
        translationCanceled: "已取消翻译，中文内容保持不变。",
        translationFailed: "无法生成英文翻译。",
        translationReady: "英文内容已经生成，请检查后再提交；目前尚未发布。",
        translating: "正在等待 DeepSeek 翻译中文内容…",
        overwriteTranslation: "用新的 DeepSeek 翻译覆盖当前英文内容？",
        verify: "正在验证令牌和仓库权限…",
        viewCommit: "在 GitHub 查看 Commit →",
      };

  const draftKey = `functionhx:settings-draft:${repository}`;
  const confirmDialog = document.getElementById("site-settings-confirm");
  const confirmation = {
    heading: document.getElementById("site-settings-confirm-heading"),
    copy: document.getElementById("site-settings-confirm-copy"),
    stay: document.getElementById("site-settings-confirm-stay"),
    keep: document.getElementById("site-settings-confirm-keep"),
    discard: document.getElementById("site-settings-confirm-discard"),
  };
  const elements = {
    ownerDetails: document.getElementById("site-settings-owner"),
    footer: document.getElementById("site-settings-footer"),
    saveState: document.getElementById("site-settings-save-state"),
    reset: document.getElementById("site-settings-reset"),
    refresh: document.getElementById("site-settings-refresh"),
    preferenceStatus: document.getElementById("site-settings-preference-status"),
    filter: document.getElementById("site-settings-filter"),
    filterEmpty: document.getElementById("site-settings-filter-empty"),
    authCancel: document.getElementById("site-settings-auth-cancel"),
    authConnect: document.getElementById("site-settings-auth-connect"),
    authRemember: document.getElementById("site-settings-auth-remember"),
    authStatus: document.getElementById("site-settings-auth-status"),
    ownerAccess: document.getElementById("site-owner-access-toggle"),
    ownerAccessNote: document.getElementById("site-owner-access-note"),
    clear: document.getElementById("site-settings-clear"),
    close: document.getElementById("site-settings-close"),
    commit: document.getElementById("site-settings-commit"),
    connect: document.getElementById("site-settings-connect"),
    descriptionEn: document.getElementById("site-settings-description-en"),
    descriptionZh: document.getElementById("site-settings-description-zh"),
    format: document.getElementById("site-settings-format"),
    font: document.getElementById("site-settings-font"),
    loadingCopy: document.getElementById("site-settings-loading-copy"),
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
  const navigationDensityInputs = [...document.querySelectorAll("[data-navigation-density]")];

  if (Object.values(elements).some((element) => !element) || !sectionToggles.length || !navigationDensityInputs.length || !uiSettingsPath) {
    return;
  }

  let confirmRequest = null;
  let lastSettingsFocus = elements.close;
  let allowNavigation = false;
  let publishing = false;
  let lastCommitSha = "";
  let draftStored = true;
  let authController = null;
  const commitLabel = elements.commit.textContent.trim();
  const newSectionInputs = [
    elements.titleZh,
    elements.titleEn,
    elements.descriptionZh,
    elements.descriptionEn,
    elements.slug,
    elements.order,
    elements.format,
    elements.newVisible,
  ];
  let activeToken = "";
  let authCompletionTimer = 0;
  let busy = false;
  let pendingCommit = false;
  let slugIsAutomatic = true;
  let restorePromise = Promise.resolve(null);
  let authVersion = 0;
  let authAttempt = 0;
  let ownerAccessVersion = 0;
  let commitAuthorization = null;
  let setupAfterConnect = false;
  let protectionState = { enabled: false, locked: false };
  const disconnectedLabel = elements.connect.querySelector("span")?.textContent.trim() || "GitHub";

  async function syncOwnerAccess() {
    const operation = ++ownerAccessVersion;
    const state = await window.functionhxGitHubAuth.protection({ owner, repository }).catch(() => ({ enabled: false, locked: false }));
    if (operation !== ownerAccessVersion) return;
    protectionState = state;
    const locked = state.enabled && !activeToken;
    elements.ownerAccess.textContent = state.enabled
      ? activeToken
        ? isEnglish
          ? "Lock now"
          : "立即锁定"
        : isEnglish
          ? "Unlock with Touch ID"
          : "使用 Touch ID 解锁"
      : isEnglish
        ? "Set up Touch ID"
        : "绑定 Touch ID";
    elements.ownerAccessNote.textContent = state.enabled
      ? locked
        ? isEnglish
          ? "Use your owner password and Touch ID to unlock this page."
          : "输入站长密码，再通过 Touch ID 解锁本页。"
        : isEnglish
          ? "This page is unlocked. Refreshing or leaving the page locks it again."
          : "本页已解锁；刷新或离开页面后会重新锁定。"
      : isEnglish
        ? "Connect GitHub once, then bind a password and Touch ID."
        : "首次连接 GitHub 后，可绑定站长密码与 Touch ID。";
    const label = elements.connect.querySelector("span");
    if (label)
      label.textContent = state.enabled
        ? activeToken
          ? isEnglish
            ? "Lock now"
            : "立即锁定"
          : isEnglish
            ? "Unlock owner access"
            : "解锁站长"
        : activeToken
          ? strings.connected
          : disconnectedLabel;
  }

  async function setupOwnerAccess(shouldCommit = false) {
    const result = await window.functionhxOwnerUnlock.open({ owner, repository, setup: true });
    await syncOwnerAccess();
    if (result?.success) {
      setStatus(isEnglish ? "Password and Touch ID are ready for this browser." : "已为当前浏览器绑定站长密码与 Touch ID。", "success");
      if (shouldCommit) await commitSettings();
    }
  }

  async function requestOwnerAccess(shouldCommit = false) {
    await syncOwnerAccess();
    if (!protectionState.enabled) {
      openAuth(shouldCommit);
      return;
    }
    const result = await window.functionhxOwnerUnlock.open({ owner, repository });
    if (result?.reconnect) {
      setupAfterConnect = true;
      openAuth(shouldCommit);
    } else if (result?.success) {
      await restoreGitHubSession();
      if (activeToken && shouldCommit) await commitSettings();
      else if (activeToken) setStatus(isEnglish ? "Owner access is unlocked for this page." : "本页站长权限已解锁。", "success");
    }
  }

  async function handleOwnerAccess() {
    await restorePromise;
    await syncOwnerAccess();
    if (protectionState.enabled && activeToken) {
      window.functionhxGitHubAuth.lock({ repository });
      setStatus(isEnglish ? "Owner access is locked." : "站长权限已锁定。");
    } else if (protectionState.enabled) {
      await requestOwnerAccess();
    } else if (activeToken) {
      await setupOwnerAccess();
    } else {
      setupAfterConnect = true;
      openAuth(false);
    }
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
    elements.authConnect.disabled = nextBusy;
    elements.clear.disabled = nextBusy;
    elements.close.disabled = false;
    elements.commit.disabled = nextBusy || !hasPendingSettings();
    elements.commit.textContent = publishing ? (isEnglish ? "Saving…" : "正在保存…") : commitLabel;
    elements.commit.setAttribute("aria-busy", String(publishing));
    elements.reset.disabled = nextBusy;
    newSectionInputs.forEach((input) => {
      input.disabled = nextBusy;
    });
    elements.connect.disabled = nextBusy;
    elements.ownerAccess.disabled = nextBusy;
    elements.translate.disabled = nextBusy;
    sectionToggles.forEach((input) => {
      input.disabled = nextBusy;
    });
    navigationDensityInputs.forEach((input) => {
      input.disabled = nextBusy;
    });
    updateSaveState();
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
    window.functionhxOwnerUi?.closePrimaryNavigation?.();
    syncPersonalization();
    openDialog(dialog);
    if (hasPendingSettings()) previewNavigationDensity();
    updateSaveState();
    toggle.setAttribute("aria-expanded", "true");
    syncOwnerAccess();
  }

  function finishClosingSettings() {
    document.documentElement.dataset.navDensity = root.dataset.initialNavigationDensity;
    closeDialog(dialog);
    toggle.setAttribute("aria-expanded", "false");
    restoreSettingsFocus();
  }

  function restoreSettingsFocus() {
    const target = toggle.getClientRects().length ? toggle : document.querySelector('[data-nav-toggle="navbarNav"]');
    target?.focus({ preventScroll: true });
  }

  function askConfirmation({ heading, copy, keep = "", discard = "", stay }) {
    if (confirmRequest) return confirmRequest.promise;
    const request = { focus: root.contains(document.activeElement) ? document.activeElement : lastSettingsFocus };
    request.promise = new Promise((resolve) => {
      request.resolve = resolve;
    });
    confirmRequest = request;
    confirmation.heading.textContent = heading;
    confirmation.copy.textContent = copy;
    confirmation.stay.textContent = stay || (isEnglish ? "Keep editing" : "继续编辑");
    confirmation.keep.textContent = keep;
    confirmation.keep.hidden = !keep;
    confirmation.discard.textContent = discard;
    confirmation.discard.hidden = !discard;
    openDialog(confirmDialog);
    confirmation.stay.focus();
    return request.promise;
  }

  function resolveConfirmation(value = "stay") {
    const request = confirmRequest;
    confirmRequest = null;
    closeDialog(confirmDialog);
    request?.focus?.focus({ preventScroll: true });
    request?.resolve(value);
  }

  async function guardChanges(action, navigating = false) {
    if (publishing) {
      setStatus(isEnglish ? "Saving your changes. Please wait before leaving." : "正在保存修改，请稍候再离开。");
      return;
    }
    if (busy) return;
    if (hasPendingSettings()) {
      persistDraft();
      const choice = await askConfirmation({
        heading: isEnglish ? "You have unpublished changes" : "还有修改尚未发布",
        copy: draftStored
          ? isEnglish
            ? "Keep the draft to continue in this tab later. It will not update the public site."
            : "保留后可在当前标签页继续编辑，刷新也能找回；网站暂时不会更新。"
          : isEnglish
            ? "This browser cannot save a draft. Keep editing or discard these changes."
            : "当前浏览器无法暂存草稿。请继续编辑，或明确放弃修改。",
        keep: draftStored
          ? navigating
            ? isEnglish
              ? "Keep draft and continue"
              : "保留草稿并继续"
            : isEnglish
              ? "Keep draft and close"
              : "保留草稿并关闭"
          : "",
        discard: isEnglish ? "Discard changes" : "放弃修改",
      });
      if (choice === "stay") return;
      if (choice === "discard") resetSettings();
    }
    if (navigating) allowNavigation = true;
    action();
  }

  function closeSettings() {
    return guardChanges(finishClosingSettings);
  }

  function updateSaveState() {
    const count = changedSections().length + Number(navigationDensityChanged()) + Number(hasNewSection());
    elements.saveState.textContent = count
      ? isEnglish
        ? `${count} unpublished change${count === 1 ? "" : "s"}`
        : `${count} 项修改待发布`
      : strings.noChanges;
    elements.saveState.dataset.dirty = String(count > 0);
    elements.reset.hidden = !count;
    elements.reset.disabled = busy;
    elements.commit.disabled = busy || !count;
    elements.clear.disabled = busy || !hasNewSection();
    elements.footer.hidden = !elements.ownerDetails.open && !count && !publishing && !lastCommitSha;
    root.dataset.dirty = String(count > 0);
    sectionToggles.forEach((input) => {
      const row = input.closest("li");
      row.dataset.changed = String(input.checked !== (input.dataset.initialVisible === "true"));
      const label = row.querySelector("[data-section-visibility]");
      if (label) label.textContent = input.checked ? (isEnglish ? "Shown" : "显示中") : isEnglish ? "Hidden" : "已隐藏";
    });
  }

  function persistDraft() {
    const values = readNewSection();
    // Drafts contain only form content, never tokens, passwords, or passkeys.
    const draft = {
      version: 1,
      density: { initial: root.dataset.initialNavigationDensity, value: selectedNavigationDensity() },
      sections: changedSections().map((input) => ({ key: input.dataset.translationKey, value: input.checked })),
      newSection: {
        ...values,
        titleZh: elements.titleZh.value,
        titleEn: elements.titleEn.value,
        descriptionZh: elements.descriptionZh.value,
        descriptionEn: elements.descriptionEn.value,
        order: elements.order.value,
      },
      slugIsAutomatic,
    };
    try {
      if (hasPendingSettings()) window.sessionStorage.setItem(draftKey, JSON.stringify(draft));
      else window.sessionStorage.removeItem(draftKey);
      draftStored = true;
    } catch (_error) {
      draftStored = false;
    }
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(draftKey) || "null");
      if (draft?.version !== 1) return;
      let densityConflict = false;
      if (draft.density?.value !== draft.density?.initial && ["auto", "compact", "relaxed"].includes(draft.density?.value)) {
        if (draft.density.initial === root.dataset.initialNavigationDensity) {
          navigationDensityInputs.forEach((input) => {
            input.checked = input.value === draft.density.value;
          });
        } else if (draft.density.value !== root.dataset.initialNavigationDensity) densityConflict = true;
      }
      for (const change of Array.isArray(draft.sections) ? draft.sections : []) {
        const input = sectionToggles.find((item) => item.dataset.translationKey === change.key);
        if (input && typeof change.value === "boolean") input.checked = change.value;
      }
      const values = draft.newSection || {};
      for (const key of ["titleZh", "titleEn", "descriptionZh", "descriptionEn", "slug", "order", "format"]) {
        if (typeof values[key] === "string") elements[key].value = values[key];
      }
      if (typeof values.visible === "boolean") elements.newVisible.checked = values.visible;
      slugIsAutomatic = draft.slugIsAutomatic !== false;
      if (hasPendingSettings()) {
        elements.ownerDetails.open = true;
        if (hasNewSection()) elements.newDetails.open = true;
        setStatus(
          densityConflict
            ? isEnglish
              ? "Draft restored. Navigation spacing changed online; the latest spacing was kept."
              : "已找回草稿。线上导航间距已有更新，已保留最新间距。"
            : isEnglish
              ? "Unpublished draft restored for this tab."
              : "已找回当前标签页的未发布草稿。"
        );
      }
      persistDraft();
    } catch (_error) {
      /* A missing or unreadable draft must not block settings. */
    }
  }

  function settingsChanged() {
    persistDraft();
    updateSaveState();
    setStatus(
      hasPendingSettings() && !draftStored
        ? isEnglish
          ? "Draft storage is unavailable. Keep this page open until you publish."
          : "草稿暂存不可用，发布前请勿离开本页。"
        : ""
    );
    root.querySelectorAll('[aria-invalid="true"]').forEach((input) => {
      input.removeAttribute("aria-invalid");
    });
  }

  function resetSettings() {
    sectionToggles.forEach((input) => {
      input.checked = input.dataset.initialVisible === "true";
    });
    navigationDensityInputs.forEach((input) => {
      input.checked = input.value === root.dataset.initialNavigationDensity;
    });
    clearNewSection();
    previewNavigationDensity();
    settingsChanged();
  }

  async function confirmDiscard(action, heading) {
    const choice = await askConfirmation({
      heading,
      copy: isEnglish
        ? "These unpublished edits will be removed. Your published site and reading preferences stay as they are."
        : "将清除这些未发布的内容，线上网站与阅读偏好不受影响。",
      discard: isEnglish ? "Discard changes" : "放弃修改",
    });
    if (choice === "discard") action();
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

  function selectedNavigationDensity() {
    return navigationDensityInputs.find((input) => input.checked)?.value || "auto";
  }

  function navigationDensityChanged() {
    return selectedNavigationDensity() !== root.dataset.initialNavigationDensity;
  }

  function hasPendingSettings() {
    return changedSections().length > 0 || navigationDensityChanged() || hasNewSection();
  }

  function previewNavigationDensity() {
    document.documentElement.dataset.navDensity = selectedNavigationDensity();
  }

  function currentFontSetting() {
    return window.functionhxSitePreferences?.getFont?.() || document.documentElement.dataset.siteFont || "system";
  }

  function currentLoadingCopySetting() {
    return window.functionhxSitePreferences?.getLoadingCopy?.() || document.documentElement.dataset.loadingCopy || "thinking";
  }

  function syncPersonalization() {
    elements.font.value = currentFontSetting();
    elements.loadingCopy.value = currentLoadingCopySetting();
  }

  function selectFont(setting) {
    window.functionhxSitePreferences?.setFont?.(setting);
    syncPersonalization();
    showPreferenceStatus("functionhx:site-font", elements.font.value);
  }

  function showPreferenceStatus(key, value) {
    let saved = false;
    try {
      saved = window.localStorage.getItem(key) === value;
    } catch (_error) {
      /* Page-only preference. */
    }
    elements.preferenceStatus.hidden = false;
    elements.preferenceStatus.textContent = saved
      ? isEnglish
        ? "Saved in this browser."
        : "已保存到当前浏览器。"
      : isEnglish
        ? "Applied to this page; browser storage is unavailable."
        : "已应用到本页；当前浏览器无法保存偏好。";
  }

  function selectLoadingCopy(setting) {
    window.functionhxSitePreferences?.setLoadingCopy?.(setting);
    syncPersonalization();
    showPreferenceStatus("functionhx:loading-copy", elements.loadingCopy.value);
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
    return Boolean(
      values.titleZh ||
      values.titleEn ||
      values.descriptionZh ||
      values.descriptionEn ||
      values.slug ||
      values.format !== "page" ||
      values.order !== 50 ||
      values.visible !== true
    );
  }

  function validateNewSection(values) {
    if (!hasNewSection(values)) return true;
    if (!values.titleZh || !values.slug) {
      elements.newDetails.open = true;
      setStatus(strings.incompleteNew, "error");
      const invalid = values.titleZh ? elements.slug : elements.titleZh;
      invalid.setAttribute("aria-invalid", "true");
      invalid.focus();
      return false;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) {
      elements.newDetails.open = true;
      setStatus(strings.invalidSlug, "error");
      elements.slug.setAttribute("aria-invalid", "true");
      elements.slug.focus();
      return false;
    }
    if (!Number.isInteger(values.order) || values.order < 1 || values.order > 999) {
      elements.newDetails.open = true;
      setStatus(strings.invalidOrder, "error");
      elements.order.setAttribute("aria-invalid", "true");
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
    settingsChanged();
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
    if (elements.titleEn.value.trim() || elements.descriptionEn.value.trim()) {
      const choice = await askConfirmation({
        heading: strings.overwriteTranslation,
        copy: isEnglish ? "The Chinese source will stay unchanged." : "中文原文不变。",
        keep: isEnglish ? "Translate again" : "重新翻译",
        stay: isEnglish ? "Cancel" : "取消",
      });
      if (choice !== "keep") return;
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
      settingsChanged();
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
    const write = options.method && options.method !== "GET";
    if (write && (!commitAuthorization || commitAuthorization.version !== authVersion || commitAuthorization.token !== activeToken)) {
      throw new DOMException("Owner access changed before this write.", "AbortError");
    }
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
      signal: options.signal || (write ? commitAuthorization.controller.signal : undefined),
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

  function setNavigationDensity(source, density) {
    if (!/^(?:auto|compact|relaxed)$/.test(density)) throw new Error("Unsupported navigation density");
    const replacement = `navigation_density: ${density}`;
    if (/^navigation_density:.*$/m.test(source)) return source.replace(/^navigation_density:.*$/m, replacement);
    return `${source.trimEnd()}\n${replacement}\n`;
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
    const translationPending = isEn && !values.titleEn;
    const title = isEn ? values.titleEn || values.titleZh : values.titleZh;
    const description = isEn ? values.descriptionEn || "English translation pending. Read the Chinese source." : values.descriptionZh;
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
    if (translationPending) frontMatter.push("translation_pending: true");

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
    } else if (translationPending) {
      body = `> English translation pending. [Read the Chinese page](/${values.slug}/).\n`;
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

  async function prepareTreeEntries(headSha, sectionChanges, newSection, navigationDensity) {
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

    const uiEntries = [];
    if (navigationDensity !== root.dataset.initialNavigationDensity) {
      const source = await fetchFileAt(uiSettingsPath, headSha);
      uiEntries.push({
        content: setNavigationDensity(source, navigationDensity),
        mode: "100644",
        path: uiSettingsPath,
        type: "blob",
      });
    }

    if (!hasNewSection(newSection)) return [...existingEntries, ...uiEntries];
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
      ...uiEntries,
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
    authAttempt += 1;
    pendingCommit = shouldCommit;
    setAuthStatus("");
    elements.token.value = "";
    openDialog(authDialog);
    window.requestAnimationFrame(() => elements.token.focus());
  }

  function closeAuth() {
    authAttempt += 1;
    authController?.abort();
    authController = null;
    window.clearTimeout(authCompletionTimer);
    setBusy(false);
    pendingCommit = false;
    setupAfterConnect = false;
    elements.token.value = "";
    closeDialog(authDialog);
  }

  function setConnection(session) {
    activeToken = session?.token || "";
    const connectLabel = elements.connect.querySelector("span");
    if (connectLabel) connectLabel.textContent = activeToken ? strings.connected : disconnectedLabel;
    elements.connect.dataset.connected = String(Boolean(activeToken));
    syncOwnerAccess();
  }

  async function verifyRestoredOwner(session, operation) {
    if (operation !== authVersion) return null;
    if (!session?.token) {
      setConnection(null);
      return null;
    }

    // The eager owner bootstrap or another authoring surface may already have
    // verified this browser session. Reuse that page-level trust decision
    // instead of issuing a duplicate identity request when settings load lazily.
    if (document.documentElement.dataset.ownerVerified === "true") {
      setConnection(session);
      return session;
    }

    // The encrypted device vault was written only after an owner/repository
    // check. Restore the local authoring controls immediately, then refresh the
    // identity in the background. GitHub remains the authority for every write;
    // only an explicit authentication failure should revoke this local state.
    setConnection(session);
    window.functionhxOwnerUi?.setVerified?.(true, session.remembered === true);

    try {
      const user = await githubRequest("/user", { token: session.token });
      if (operation !== authVersion) return null;
      if (String(user.login || "").toLowerCase() !== owner.toLowerCase()) {
        await window.functionhxGitHubAuth?.forget({ repository }).catch(() => undefined);
        setConnection(null);
        window.functionhxOwnerUi?.setVerified?.(false);
        return null;
      }
      return session;
    } catch (error) {
      if (operation !== authVersion) return null;
      if (error.status === 401) {
        await window.functionhxGitHubAuth?.forget({ repository }).catch(() => undefined);
        setConnection(null);
        window.functionhxOwnerUi?.setVerified?.(false);
        return null;
      }

      // Keep the locally restored author controls available for a later retry
      // when GitHub is temporarily unreachable. Writes are still verified by
      // their GitHub API requests.
      return session;
    }
  }

  async function restoreGitHubSession() {
    const operation = ++authVersion;
    const session = await window.functionhxGitHubAuth?.restore({ owner, repository }).catch(() => null);
    return verifyRestoredOwner(session, operation);
  }

  async function saveGitHubSession(token) {
    const remember = elements.authRemember.checked;
    if (!window.functionhxGitHubAuth) return { failed: remember, remembered: false };
    if (setupAfterConnect && protectionState.enabled && protectionState.locked) {
      return window.functionhxGitHubAuth.save({ owner, remember: false, repository, token });
    }
    try {
      return await window.functionhxGitHubAuth.save({ owner, remember, repository, token });
    } catch (_error) {
      await window.functionhxGitHubAuth.save({ owner, remember: false, repository, token }).catch(() => undefined);
      return { failed: true, remembered: false };
    }
  }

  async function disconnectGitHub(ask = true) {
    if (ask) {
      const choice = await askConfirmation({
        heading: strings.disconnectConfirm,
        copy: isEnglish
          ? "Your draft stays here. Publishing again will require a GitHub connection."
          : "设置草稿会保留；下次发布时需要重新连接 GitHub。",
        discard: isEnglish ? "Remove connection" : "移除连接",
        stay: isEnglish ? "Cancel" : "取消",
      });
      if (choice !== "discard") return;
    }
    await window.functionhxGitHubAuth?.forget({ repository }).catch(() => undefined);
    setConnection(null);
    setStatus(strings.disconnected);
  }

  async function handleConnectButton() {
    await restorePromise;
    if (activeToken) {
      if (protectionState.enabled) window.functionhxGitHubAuth.lock({ repository });
      else await disconnectGitHub(true);
      return;
    }
    await requestOwnerAccess(false);
  }

  async function connectGitHub() {
    if (busy) return;
    const attempt = authAttempt;
    authController = new AbortController();
    const candidate = elements.token.value.trim();
    if (!candidate) {
      setAuthStatus(strings.authMissing, "error");
      return;
    }
    setBusy(true);
    setAuthStatus(strings.verify);
    try {
      const [user, repo] = await Promise.all([
        githubRequest("/user", { token: candidate, signal: authController.signal }),
        githubRequest(`/repos/${repository}`, { token: candidate, signal: authController.signal }),
      ]);
      if (!authDialog.open || attempt !== authAttempt) return;
      if (String(user.login).toLowerCase() !== owner.toLowerCase() || !repo.permissions?.push) {
        throw new Error("This token is not @Functionhx with repository write access.");
      }
      const saved = await saveGitHubSession(candidate);
      if (!authDialog.open || attempt !== authAttempt) return;
      setConnection({ token: candidate });
      setAuthStatus(saved.failed ? strings.authRememberFailed : saved.remembered ? strings.authRemembered : strings.authSuccess, "success");
      const continueCommit = pendingCommit;
      const continueSetup = setupAfterConnect;
      pendingCommit = false;
      window.clearTimeout(authCompletionTimer);
      authCompletionTimer = window.setTimeout(
        () => {
          closeAuth();
          if (continueSetup) setupOwnerAccess(continueCommit);
          else if (continueCommit) commitSettings();
        },
        saved.failed ? 900 : 350
      );
    } catch (error) {
      if (attempt !== authAttempt || !authDialog.open) return;
      setConnection(null);
      setAuthStatus(`${strings.authFailed} ${error.message || ""}`.trim(), "error");
    } finally {
      if (attempt === authAttempt) {
        elements.token.value = "";
        authController = null;
        setBusy(false);
      }
    }
  }

  async function commitSettings() {
    await restorePromise;
    if (busy) return;
    const sectionChanges = changedSections();
    const newSection = readNewSection();
    const navigationDensity = selectedNavigationDensity();
    if (!validateNewSection(newSection)) return;
    if (!sectionChanges.length && !hasNewSection(newSection) && !navigationDensityChanged()) {
      setStatus(strings.noChanges);
      return;
    }
    if (!activeToken) {
      await requestOwnerAccess(true);
      return;
    }

    publishing = true;
    setBusy(true);
    commitAuthorization = { version: authVersion, token: activeToken, controller: new AbortController() };
    setStatus(isEnglish ? "Saving your changes…" : "正在保存修改…");
    elements.refresh.hidden = true;
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
      const entries = await prepareTreeEntries(headSha, sectionChanges, newSection, navigationDensity);
      const commit = await createAtomicCommit(entries, headSha, baseTree, newSection);

      sectionChanges.forEach((input) => {
        input.dataset.initialVisible = String(input.checked);
      });
      root.dataset.initialNavigationDensity = navigationDensity;
      clearNewSection();
      setStatus(strings.commitSuccess, "success");
      if (commit.html_url) {
        elements.result.href = commit.html_url;
        elements.result.textContent = strings.viewCommit;
        elements.result.hidden = false;
      }
      lastCommitSha = commit.sha;
      window.functionhxDeployment?.watch(commit);
    } catch (error) {
      if (error.status === 401 || error.status === 403) await disconnectGitHub(false);
      const message =
        error.message === strings.collision
          ? error.message
          : error.status === 409 || error.status === 422
            ? isEnglish
              ? "The site changed while saving. Your draft is intact; try saving again."
              : "保存期间站点有了新修改。草稿已保留，请重新保存。"
            : `${strings.commitFailed} ${isEnglish ? "Your draft is intact; retry when ready." : "草稿已保留，可重试。"} ${error.message || ""}`.trim();
      setStatus(message, "error");
    } finally {
      commitAuthorization = null;
      publishing = false;
      setBusy(false);
      updateSaveState();
    }
  }

  toggle.addEventListener("click", openSettings);
  root.addEventListener("focusin", (event) => {
    lastSettingsFocus = event.target;
  });
  elements.close.addEventListener("click", closeSettings);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSettings();
  });
  dialog.addEventListener("close", () => {
    document.documentElement.dataset.navDensity = root.dataset.initialNavigationDensity;
    toggle.setAttribute("aria-expanded", "false");
    restoreSettingsFocus();
  });
  confirmation.stay.addEventListener("click", () => resolveConfirmation());
  confirmation.keep.addEventListener("click", () => resolveConfirmation("keep"));
  confirmation.discard.addEventListener("click", () => resolveConfirmation("discard"));
  confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    resolveConfirmation();
  });
  confirmDialog.addEventListener("close", () => {
    if (confirmRequest && !confirmDialog.open) resolveConfirmation();
  });
  sectionToggles.forEach((input) => {
    input.addEventListener("change", settingsChanged);
    input.closest("li").addEventListener("click", (event) => {
      if (!event.target.closest("label, input, a, button") && !input.disabled) input.click();
    });
  });
  navigationDensityInputs.forEach((input) => {
    input.addEventListener("change", () => {
      previewNavigationDensity();
      settingsChanged();
    });
  });
  elements.ownerDetails.addEventListener("toggle", updateSaveState);
  elements.font.addEventListener("change", () => selectFont(elements.font.value));
  elements.loadingCopy.addEventListener("change", () => selectLoadingCopy(elements.loadingCopy.value));
  newSectionInputs.forEach((input) => {
    input.addEventListener("input", () => {
      if (input === elements.titleEn && slugIsAutomatic) elements.slug.value = slugify(input.value);
      if (input === elements.slug) slugIsAutomatic = false;
      settingsChanged();
    });
    input.addEventListener("change", settingsChanged);
  });
  // Normalize on leaving the slug field, never while typing a trailing hyphen.
  elements.slug.addEventListener("blur", () => {
    const normalized = slugify(elements.slug.value);
    if (normalized !== elements.slug.value) {
      elements.slug.value = normalized;
      settingsChanged();
    }
  });
  elements.clear.addEventListener("click", () => confirmDiscard(clearNewSection, isEnglish ? "Clear the new section?" : "清空新栏目？"));
  elements.reset.addEventListener("click", () =>
    confirmDiscard(resetSettings, isEnglish ? "Discard all unpublished changes?" : "放弃全部未发布的修改？")
  );
  elements.translate.addEventListener("click", translateNewSection);
  elements.connect.addEventListener("click", handleConnectButton);
  elements.ownerAccess.addEventListener("click", handleOwnerAccess);
  elements.commit.addEventListener("click", commitSettings);
  elements.authCancel.addEventListener("click", closeAuth);
  elements.authConnect.addEventListener("click", connectGitHub);
  elements.token.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      connectGitHub();
    }
  });
  authDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAuth();
  });
  authDialog.addEventListener("close", () => {
    if (authDialog.open) return;
    authAttempt += 1;
    authController?.abort();
    authController = null;
    window.clearTimeout(authCompletionTimer);
    authCompletionTimer = 0;
    pendingCommit = false;
    setupAfterConnect = false;
    elements.token.value = "";
  });
  elements.filter.addEventListener("input", () => {
    const query = elements.filter.value.trim().toLocaleLowerCase();
    let count = 0;
    sectionToggles.forEach((input) => {
      const row = input.closest("li");
      row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
      if (!row.hidden) count += 1;
    });
    elements.filterEmpty.hidden = count > 0;
  });
  dialog.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !event.isComposing) {
      event.preventDefault();
      if (!elements.commit.disabled) commitSettings();
    }
  });
  root.querySelectorAll(".site-settings__segmented a").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (link.hasAttribute("aria-current")) return;
      guardChanges(() => window.location.assign(link.href), true);
    });
  });
  elements.refresh.addEventListener("click", () => guardChanges(() => window.location.reload(), true));
  window.addEventListener("beforeunload", (event) => {
    if (allowNavigation || (!hasPendingSettings() && !publishing)) return;
    persistDraft();
    event.preventDefault();
    event.returnValue = "";
    window.setTimeout(() => window.functionhxSitePreferences?.hideLoading?.(), 0);
  });
  window.addEventListener("pageshow", () => {
    allowNavigation = false;
  });
  window.addEventListener("functionhx:deployment-changed", (event) => {
    if (!lastCommitSha || event.detail?.sha !== lastCommitSha) return;
    if (!hasPendingSettings())
      setStatus(event.detail.message, event.detail.state === "failure" ? "error" : event.detail.state === "success" ? "success" : "");
    elements.refresh.hidden = event.detail.state !== "success";
  });
  window.addEventListener("functionhx:github-auth-changed", (event) => {
    if (event.detail?.repository !== repository) return;
    if (!event.detail.connected) commitAuthorization?.controller.abort();
    restorePromise = restoreGitHubSession();
  });
  restorePromise = restoreGitHubSession();
  syncPersonalization();
  restoreDraft();
  updateSaveState();
})();
