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
        noChanges: "No unpublished changes.",
        pending: "Changes are not published yet.",
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
        noChanges: "没有待发布的修改。",
        pending: "修改尚未发布。",
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
    titleZh: document.getElementById("site-settings-title-zh"),
    token: document.getElementById("site-settings-token"),
  };
  const sectionToggles = [...document.querySelectorAll("[data-section-toggle]")];
  const eggSection = document.getElementById("site-settings-eggs");
  const eggInputs = [...document.querySelectorAll("[data-egg-public]")];
  const letterFields = {
    phrase: document.getElementById("site-settings-letter-phrase"),
    pin: document.getElementById("site-settings-letter-pin"),
    pinHint: document.getElementById("site-settings-letter-hint"),
    title: document.getElementById("site-settings-letter-title"),
    text: document.getElementById("site-settings-letter-text"),
    sign: document.getElementById("site-settings-letter-sign"),
  };
  const letterSeal = document.getElementById("site-settings-letter-seal");
  const letterStatus = document.getElementById("site-settings-letter-status");
  const eggsPath = "_data/eggs.yml";
  const seasonInputs = [...root.querySelectorAll('input[name="site-settings-season"]')];
  const windInput = document.getElementById("site-settings-wind");
  const windValue = document.getElementById("site-settings-wind-value");
  const windTest = document.getElementById("site-settings-wind-test");
  const awayInput = document.getElementById("site-settings-away-delay");
  const awayValue = document.getElementById("site-settings-away-delay-value");
  const trainingCardVisibleInput = document.getElementById("site-settings-training-card-visible");
  const eggIds = ["turbo", "dog", "terminal", "fx", "love", "night", "idle", "console", "tab", "bottle", "archive", "letter"];
  let initialEggPublic = {};
  let publishedLetter = null;
  try {
    initialEggPublic = JSON.parse(eggSection?.dataset.initialEggPublic || "{}") || {};
    publishedLetter = JSON.parse(eggSection?.dataset.initialLetter || "null");
  } catch (_error) {
    initialEggPublic = {};
  }
  // 刚加密、尚未发布的信（只含密文）。
  let sealedLetter = null;
  const navigationDensityInputs = [...document.querySelectorAll("[data-navigation-density]")];

  if (Object.values(elements).some((element) => !element) || !sectionToggles.length || !navigationDensityInputs.length || !uiSettingsPath) {
    return;
  }

  // 外观类设置（字体、加载文案、季节氛围、风力、导航间距、彩蛋线索和那封信）不需要重新构建：
  // 改动后自动保存到仓库 site-settings 分支的 settings.json，所有访客的页面直接读它，马上生效。
  // 构建时写进 _data 的值（baked）只是取不到实时设置时的后备，会在后台静默同步回主分支。
  // 只有栏目的显示与隐藏这类需要重新生成页面的改动，才用「保存并发布」。
  const baked = {
    density: root.dataset.initialNavigationDensity,
    font: root.dataset.initialSiteFont,
    loadingCopy: root.dataset.initialLoadingCopy,
    season: root.dataset.initialSeasonEffect,
    wind: Number(root.dataset.initialWindStrength ?? 100),
    away: Number(root.dataset.initialAwayTitleDelay ?? 500),
    trainingCardVisible: root.dataset.initialTrainingCardVisible !== "false",
    eggPublic: { ...initialEggPublic },
    letter: publishedLetter,
  };
  let liveSaveTimer = 0;
  let liveSaving = false;
  let liveQueued = false;
  let bakedTimer = 0;
  let workChain = Promise.resolve();

  let confirmRequest = null;
  let lastSettingsFocus = elements.close;
  let allowNavigation = false;
  let publishing = false;
  let lastCommitSha = "";
  let draftStored = true;
  let authController = null;
  const commitLabel = elements.commit.textContent.trim();
  const newSectionInputs = [elements.titleZh, elements.descriptionZh, elements.slug, elements.order, elements.format, elements.newVisible];
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
  let openSettingsAfterLogin = false;
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
    updateSaveState();
    refreshLiveFromRemote();
    toggle.setAttribute("aria-expanded", "true");
    syncOwnerAccess();
  }

  function ownerIsVerified() {
    return document.documentElement.dataset.ownerVerified === "true";
  }

  // 登录成功后进入站长模式（铅笔出现），并打开站点设置。
  function finishOwnerLogin() {
    openSettingsAfterLogin = false;
    if (!ownerIsVerified()) return;
    window.functionhxOwnerUi?.setOwnerMode?.(true);
    openSettings();
  }

  // 齿轮按钮：已验证的站长直接打开设置；其他人先走站长登录
  // （已绑定 Touch ID 时是密码 + Touch ID，否则是连接 GitHub）。
  async function handleSettingsToggle() {
    // eggs.js 在长按齿轮（或 Alt+Enter）时打上 ownerIntent；访客普通点击由彩蛋图鉴处理。
    const ownerIntent = toggle.dataset.ownerIntent === "true";
    delete toggle.dataset.ownerIntent;
    await restorePromise;
    if (ownerIsVerified()) {
      window.functionhxOwnerUi?.setOwnerMode?.(true);
      openSettings();
      return;
    }
    if (!ownerIntent && window.functionhxEggs) return;
    openSettingsAfterLogin = true;
    await requestOwnerAccess(false);
    // 解锁路径在这里已经完成；连接 GitHub 的路径在 connectGitHub 成功后继续。
    if (openSettingsAfterLogin && ownerIsVerified()) finishOwnerLogin();
  }

  function finishClosingSettings() {
    document.documentElement.dataset.navDensity = root.dataset.initialNavigationDensity;
    previewPersonalization(
      root.dataset.initialSiteFont,
      root.dataset.initialLoadingCopy,
      root.dataset.initialSeasonEffect,
      Number(root.dataset.initialWindStrength ?? 100),
      Number(root.dataset.initialAwayTitleDelay ?? 500)
    );
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
    const count = changedSections().length + Number(hasNewSection());
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
      sections: changedSections().map((input) => ({ key: input.dataset.translationKey, value: input.checked })),
      newSection: {
        ...values,
        titleZh: elements.titleZh.value,
        descriptionZh: elements.descriptionZh.value,
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
      for (const change of Array.isArray(draft.sections) ? draft.sections : []) {
        const input = sectionToggles.find((item) => item.dataset.translationKey === change.key);
        if (input && typeof change.value === "boolean") input.checked = change.value;
      }
      const values = draft.newSection || {};
      for (const key of ["titleZh", "descriptionZh", "slug", "order", "format"]) {
        if (typeof values[key] === "string") elements[key].value = values[key];
      }
      if (typeof values.visible === "boolean") elements.newVisible.checked = values.visible;
      slugIsAutomatic = draft.slugIsAutomatic !== false;
      if (hasPendingSettings()) {
        if (changedSections().length || hasNewSection()) elements.ownerDetails.open = true;
        if (hasNewSection()) elements.newDetails.open = true;
        setStatus(isEnglish ? "Unpublished draft restored for this tab." : "已找回当前标签页的未发布草稿。");
      }
      persistDraft();
    } catch (_error) {
      /* A missing or unreadable draft must not block settings. */
    }
  }

  function settingsChanged() {
    persistDraft();
    updateSaveState();
    scheduleLiveSave();
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
    clearNewSection();
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
    return changedSections().length > 0 || hasNewSection();
  }

  function previewNavigationDensity() {
    document.documentElement.dataset.navDensity = selectedNavigationDensity();
  }

  // 字体、加载文案、季节氛围、风力、导航间距和彩蛋是实时生效的外观设置：改动先在本页预览，
  // 随后自动保存到 site-settings 分支的 settings.json（saveLiveSettings），不用等构建。
  function hasOption(select, value) {
    return [...select.options].some((option) => option.value === value);
  }

  function selectedFont() {
    return elements.font.value || root.dataset.initialSiteFont;
  }

  function selectedLoadingCopy() {
    return elements.loadingCopy.value || root.dataset.initialLoadingCopy;
  }

  function fontChanged() {
    return selectedFont() !== root.dataset.initialSiteFont;
  }

  function loadingCopyChanged() {
    return selectedLoadingCopy() !== root.dataset.initialLoadingCopy;
  }

  function selectedSeason() {
    return seasonInputs.find((input) => input.checked)?.value || root.dataset.initialSeasonEffect;
  }

  function seasonChanged() {
    return selectedSeason() !== root.dataset.initialSeasonEffect;
  }

  function checkSeason(value) {
    seasonInputs.forEach((input) => {
      input.checked = input.value === value;
    });
  }

  function selectedWind() {
    const value = windInput ? Number(windInput.value) : Number(root.dataset.initialWindStrength ?? 100);
    return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 200) : 100;
  }

  function windChanged() {
    return selectedWind() !== Number(root.dataset.initialWindStrength ?? 100);
  }

  function selectedAway() {
    const value = awayInput ? Number(awayInput.value) : Number(root.dataset.initialAwayTitleDelay ?? 500);
    return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 5000) : 500;
  }

  function awayChanged() {
    return selectedAway() !== Number(root.dataset.initialAwayTitleDelay ?? 500);
  }

  function selectedTrainingCardVisible() {
    return trainingCardVisibleInput ? trainingCardVisibleInput.checked : root.dataset.initialTrainingCardVisible !== "false";
  }

  function trainingCardVisibleChanged() {
    return selectedTrainingCardVisible() !== (root.dataset.initialTrainingCardVisible !== "false");
  }

  function previewPersonalization(
    font = selectedFont(),
    copy = selectedLoadingCopy(),
    season = selectedSeason(),
    wind = selectedWind(),
    away = selectedAway()
  ) {
    document.documentElement.dataset.awayTitleDelay = String(away);
    window.functionhxSitePreferences?.setFont?.(font);
    window.functionhxSitePreferences?.setLoadingCopy?.(copy);
    window.functionhxSeasons?.setWind?.(wind);
    window.functionhxSeasons?.set?.(season);
  }

  function syncPersonalization() {
    if (!hasOption(elements.font, elements.font.value)) elements.font.value = root.dataset.initialSiteFont;
    if (!hasOption(elements.loadingCopy, elements.loadingCopy.value)) elements.loadingCopy.value = root.dataset.initialLoadingCopy;
    if (windInput && windValue) windValue.textContent = selectedWind() === 0 ? "关" : `${selectedWind()}%`;
    if (awayInput && awayValue) awayValue.textContent = selectedAway() === 0 ? "立即" : `${(selectedAway() / 1000).toFixed(1)} 秒`;
  }

  // ---------- 实时生效的外观设置 ----------
  function liveDirty() {
    return (
      fontChanged() ||
      loadingCopyChanged() ||
      seasonChanged() ||
      windChanged() ||
      awayChanged() ||
      navigationDensityChanged() ||
      trainingCardVisibleChanged() ||
      eggsChanged() ||
      letterChanged()
    );
  }

  function setLiveStatus(message, state = "") {
    const node = elements.preferenceStatus;
    node.hidden = !message;
    node.textContent = message;
    if (state) node.dataset.state = state;
    else delete node.dataset.state;
  }

  function liveSettingsFromForm() {
    const publicMap = {};
    eggInputs.forEach((input) => {
      publicMap[input.dataset.eggPublic] = input.checked;
    });
    return {
      version: 1,
      site_font: selectedFont(),
      loading_copy: selectedLoadingCopy(),
      season_effect: selectedSeason(),
      wind_strength: selectedWind(),
      away_title_delay: selectedAway(),
      navigation_density: selectedNavigationDensity(),
      training_card_visible: selectedTrainingCardVisible(),
      eggs: { public: publicMap, letter: sealedLetter || publishedLetter || null },
    };
  }

  // 保存、同步、发布都用同一份授权对象，排队一个一个来。
  function exclusive(task) {
    const run = workChain.then(task, task);
    workChain = run.catch(() => {});
    return run;
  }

  function scheduleLiveSave() {
    window.clearTimeout(liveSaveTimer);
    if (!liveDirty()) return;
    setLiveStatus(isEnglish ? "Applying…" : "正在让修改生效…");
    liveSaveTimer = window.setTimeout(saveLiveSettings, 700);
  }

  function saveLiveSettings() {
    window.clearTimeout(liveSaveTimer);
    if (liveSaving) {
      liveQueued = true;
      return workChain;
    }
    return exclusive(saveLiveNow);
  }

  async function saveLiveNow() {
    await restorePromise;
    if (!liveDirty()) return;
    if (!activeToken) {
      setLiveStatus("需要先连接 GitHub，修改才会对所有访客生效。", "error");
      // 不在排队链里等弹窗：连接成功后会回到 commitSettings，那里会先把这些修改存下来。
      if (!authDialog.open) requestOwnerAccess(true);
      return;
    }
    liveSaving = true;
    const snapshot = liveSettingsFromForm();
    commitAuthorization = { version: authVersion, token: activeToken, controller: new AbortController() };
    try {
      await writeRuntimeSettings(snapshot);
      applySavedLive(snapshot);
      setLiveStatus("已生效：所有访客约 1–3 分钟内就会看到。", "success");
      scheduleBakedSync();
    } catch (error) {
      if (error.status === 401 || error.status === 403) await disconnectGitHub(false);
      setLiveStatus(`没能让修改生效：${error.message || "请稍后重试"}（本页已保留预览）`, "error");
    } finally {
      commitAuthorization = null;
      liveSaving = false;
      updateSaveState();
      if (liveQueued) {
        liveQueued = false;
        scheduleLiveSave();
      }
    }
  }

  // 写 site-settings 分支上的 settings.json（分支还不存在就从主分支新建）。
  async function writeRuntimeSettings(settings) {
    const api = window.functionhxRuntimeSettings;
    if (!api) throw new Error("实时设置模块没有加载。");
    const base = `/repos/${repository}`;
    const file = `${base}/contents/${api.file}`;
    const content = encodeBase64Utf8(`${JSON.stringify(settings, null, 2)}\n`);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let existing = await githubRequest(`${file}?ref=${encodeURIComponent(api.branch)}`, { allowNotFound: true, token: activeToken });
      if (!existing) {
        const ref = await githubRequest(`${base}/git/ref/heads/${encodeURIComponent(api.branch)}`, { allowNotFound: true, token: activeToken });
        if (!ref) {
          const head = await githubRequest(`${base}/git/ref/heads/${encodeURIComponent(branch)}`, { token: activeToken });
          await githubRequest(`${base}/git/refs`, {
            body: { ref: `refs/heads/${api.branch}`, sha: head.object.sha },
            method: "POST",
            token: activeToken,
          });
        }
        existing = null;
      }
      try {
        await githubRequest(file, {
          body: { branch: api.branch, content, message: "site: live appearance settings", ...(existing?.sha ? { sha: existing.sha } : {}) },
          method: "PUT",
          token: activeToken,
        });
        return;
      } catch (error) {
        // 另一处刚好也在写：重新取一次 sha 再试一遍。
        if (attempt === 0 && (error.status === 409 || error.status === 422)) continue;
        throw error;
      }
    }
  }

  function encodeBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary);
  }

  // 保存成功：把这些值记作「线上现状」，并交给 runtime-settings.js 更新本机缓存和整页。
  function applySavedLive(settings) {
    root.dataset.initialSiteFont = settings.site_font;
    root.dataset.initialLoadingCopy = settings.loading_copy;
    root.dataset.initialSeasonEffect = settings.season_effect;
    root.dataset.initialWindStrength = String(settings.wind_strength);
    root.dataset.initialAwayTitleDelay = String(settings.away_title_delay);
    root.dataset.initialNavigationDensity = settings.navigation_density;
    root.dataset.initialTrainingCardVisible = String(settings.training_card_visible);
    initialEggPublic = { ...settings.eggs.public };
    if (sealedLetter) {
      publishedLetter = sealedLetter;
      sealedLetter = null;
      if (letterStatus) letterStatus.textContent = "这封信已生效。";
    }
    window.functionhxRuntimeSettings?.store?.(settings);
    syncPersonalization();
  }

  // 打开面板时取一份最新的（跳过缓存），在没有未保存修改的前提下把控件对上线上现状。
  function adoptLiveSettings(live = {}) {
    const page = document.documentElement.dataset;
    if (page.publishedSiteFont) root.dataset.initialSiteFont = page.publishedSiteFont;
    if (page.publishedLoadingCopy) root.dataset.initialLoadingCopy = page.publishedLoadingCopy;
    if (page.publishedSeasonEffect) root.dataset.initialSeasonEffect = page.publishedSeasonEffect;
    if (page.publishedWindStrength !== undefined) root.dataset.initialWindStrength = page.publishedWindStrength;
    if (page.publishedAwayTitleDelay !== undefined) root.dataset.initialAwayTitleDelay = page.publishedAwayTitleDelay;
    if (page.publishedTrainingCardVisible !== undefined) root.dataset.initialTrainingCardVisible = page.publishedTrainingCardVisible;
    if (live.navigation_density) root.dataset.initialNavigationDensity = live.navigation_density;
    if (typeof live.training_card_visible === "boolean") root.dataset.initialTrainingCardVisible = String(live.training_card_visible);
    if (live.eggs?.public) initialEggPublic = { ...initialEggPublic, ...live.eggs.public };
    if (live.eggs && "letter" in live.eggs) publishedLetter = live.eggs.letter;
    elements.font.value = root.dataset.initialSiteFont;
    elements.loadingCopy.value = root.dataset.initialLoadingCopy;
    checkSeason(root.dataset.initialSeasonEffect);
    if (trainingCardVisibleInput) trainingCardVisibleInput.checked = root.dataset.initialTrainingCardVisible !== "false";
    if (windInput) windInput.value = root.dataset.initialWindStrength ?? "100";
    if (awayInput) awayInput.value = root.dataset.initialAwayTitleDelay ?? "500";
    navigationDensityInputs.forEach((input) => {
      input.checked = input.value === root.dataset.initialNavigationDensity;
    });
    eggInputs.forEach((input) => {
      input.checked = initialEggPublic[input.dataset.eggPublic] === true;
    });
    syncPersonalization();
  }

  async function refreshLiveFromRemote() {
    const api = window.functionhxRuntimeSettings;
    if (!api) return;
    await restorePromise;
    try {
      const settings = await api.refresh({ fresh: true, token: activeToken });
      if (settings && !liveDirty() && !liveSaving) adoptLiveSettings(settings);
    } catch (_error) {
      /* 取不到就用页面上已有的值。 */
    }
    if (bakedDrift()) scheduleBakedSync(3000);
  }

  // ---------- 把实时设置同步回主分支（后备） ----------
  function bakedDrift() {
    const liveWind = Number(root.dataset.initialWindStrength ?? 100);
    const liveAway = Number(root.dataset.initialAwayTitleDelay ?? 500);
    const liveTrainingCardVisible = root.dataset.initialTrainingCardVisible !== "false";
    return (
      root.dataset.initialNavigationDensity !== baked.density ||
      root.dataset.initialSiteFont !== baked.font ||
      root.dataset.initialLoadingCopy !== baked.loadingCopy ||
      root.dataset.initialSeasonEffect !== baked.season ||
      liveWind !== baked.wind ||
      liveAway !== baked.away ||
      liveTrainingCardVisible !== baked.trainingCardVisible ||
      eggIds.some((id) => (initialEggPublic[id] === true) !== (baked.eggPublic[id] === true)) ||
      JSON.stringify(publishedLetter || null) !== JSON.stringify(baked.letter || null)
    );
  }

  function scheduleBakedSync(delay = 20000) {
    window.clearTimeout(bakedTimer);
    bakedTimer = window.setTimeout(() => exclusive(syncBakedNow), delay);
  }

  async function bakedEntries(headSha) {
    const entries = [];
    const liveWind = Number(root.dataset.initialWindStrength ?? 100);
    const liveAway = Number(root.dataset.initialAwayTitleDelay ?? 500);
    const liveTrainingCardVisible = root.dataset.initialTrainingCardVisible !== "false";
    const uiChanged =
      root.dataset.initialNavigationDensity !== baked.density ||
      root.dataset.initialSiteFont !== baked.font ||
      root.dataset.initialLoadingCopy !== baked.loadingCopy ||
      root.dataset.initialSeasonEffect !== baked.season ||
      liveWind !== baked.wind ||
      liveAway !== baked.away ||
      liveTrainingCardVisible !== baked.trainingCardVisible;
    if (uiChanged) {
      let source = await fetchFileAt(uiSettingsPath, headSha);
      if (root.dataset.initialNavigationDensity !== baked.density) source = setNavigationDensity(source, root.dataset.initialNavigationDensity);
      if (root.dataset.initialSiteFont !== baked.font) source = setSiteUiValue(source, "site_font", root.dataset.initialSiteFont);
      if (root.dataset.initialLoadingCopy !== baked.loadingCopy) source = setSiteUiValue(source, "loading_copy", root.dataset.initialLoadingCopy);
      if (root.dataset.initialSeasonEffect !== baked.season) source = setSiteUiValue(source, "season_effect", root.dataset.initialSeasonEffect);
      if (liveWind !== baked.wind) source = setSiteUiValue(source, "wind_strength", String(liveWind));
      if (liveAway !== baked.away) source = setSiteUiValue(source, "away_title_delay", String(liveAway));
      if (liveTrainingCardVisible !== baked.trainingCardVisible) {
        source = setSiteUiValue(source, "training_card_visible", String(liveTrainingCardVisible));
      }
      entries.push({ content: source, mode: "100644", path: uiSettingsPath, type: "blob" });
    }
    const eggsDiffer =
      eggIds.some((id) => (initialEggPublic[id] === true) !== (baked.eggPublic[id] === true)) ||
      JSON.stringify(publishedLetter || null) !== JSON.stringify(baked.letter || null);
    if (eggsDiffer) entries.push({ content: eggsSource(publishedLetter, initialEggPublic), mode: "100644", path: eggsPath, type: "blob" });
    return entries;
  }

  function markBakedSynced() {
    baked.density = root.dataset.initialNavigationDensity;
    baked.font = root.dataset.initialSiteFont;
    baked.loadingCopy = root.dataset.initialLoadingCopy;
    baked.season = root.dataset.initialSeasonEffect;
    baked.wind = Number(root.dataset.initialWindStrength ?? 100);
    baked.away = Number(root.dataset.initialAwayTitleDelay ?? 500);
    baked.trainingCardVisible = root.dataset.initialTrainingCardVisible !== "false";
    baked.eggPublic = { ...initialEggPublic };
    baked.letter = publishedLetter;
  }

  // 后台静默提交：让构建写进页面的后备值追上实时设置。没有提示、不打断；失败了下次打开面板时再试。
  async function syncBakedNow() {
    if (!activeToken || busy || publishing || liveSaving || !bakedDrift()) return;
    commitAuthorization = { version: authVersion, token: activeToken, controller: new AbortController() };
    try {
      const head = await githubRequest(`/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, { token: activeToken });
      const headSha = head.object?.sha;
      if (!headSha) return;
      const parent = await githubRequest(`/repos/${repository}/git/commits/${headSha}`, { token: activeToken });
      const entries = await bakedEntries(headSha);
      if (entries.length) await createAtomicCommit(entries, headSha, parent.tree.sha, null, "site: sync live appearance settings");
      markBakedSynced();
    } catch (_error) {
      /* 后备同步失败不影响实时设置。 */
    } finally {
      commitAuthorization = null;
    }
  }

  function selectFont(setting) {
    elements.font.value = setting;
    previewPersonalization();
    syncPersonalization();
    settingsChanged();
  }

  function selectLoadingCopy(setting) {
    elements.loadingCopy.value = setting;
    previewPersonalization();
    syncPersonalization();
    settingsChanged();
  }

  function eggsChanged() {
    return eggInputs.some((input) => input.checked !== (initialEggPublic[input.dataset.eggPublic] === true));
  }

  function letterChanged() {
    return sealedLetter !== null;
  }

  // 在浏览器里用暗号和六位密码加密信；只有密文会进入发布。
  async function sealLetterDraft() {
    if (!window.functionhxEggs?.sealLetter || !letterSeal) return;
    letterSeal.disabled = true;
    letterStatus.textContent = "正在加密…";
    try {
      sealedLetter = await window.functionhxEggs.sealLetter({
        phrase: letterFields.phrase.value,
        pin: letterFields.pin.value.trim(),
        pinHint: letterFields.pinHint.value.trim(),
        title: letterFields.title.value.trim(),
        text: letterFields.text.value,
        sign: letterFields.sign.value.trim(),
      });
      letterFields.phrase.value = "";
      letterFields.pin.value = "";
      letterStatus.textContent = "已加密。暗号和密码已从表单清除，正在让这封信生效…";
    } catch (error) {
      sealedLetter = null;
      letterStatus.textContent = error.message || "加密失败。";
    } finally {
      letterSeal.disabled = false;
      settingsChanged();
    }
  }

  function yamlString(value) {
    return JSON.stringify(String(value));
  }

  function eggsSource(letter, publicMap = null) {
    const lines = [
      "# 首页彩蛋：哪些彩蛋在图鉴里公开触发线索，以及那封加密的信。",
      "# 由站点设置里的「彩蛋」一栏发布，不要手改 letter：它是浏览器里用暗号和六位密码加密后的密文。",
      "public:",
      ...eggIds.map((id) => {
        const input = eggInputs.find((item) => item.dataset.eggPublic === id);
        const value = publicMap ? publicMap[id] === true : input ? input.checked : initialEggPublic[id] === true;
        return `  ${id}: ${value ? "true" : "false"}`;
      }),
    ];
    if (letter) {
      if (letter.v !== 2 || ![letter.salt, letter.iv, letter.data].every((part) => /^[A-Za-z0-9+/=]+$/.test(String(part || "")))) {
        throw new Error("Unsupported letter ciphertext");
      }
      lines.push("letter:", "  v: 2", `  salt: ${yamlString(letter.salt)}`, `  iv: ${yamlString(letter.iv)}`, `  data: ${yamlString(letter.data)}`);
    } else {
      lines.push("letter:");
    }
    return `${lines.join("\n")}\n`;
  }

  function readNewSection() {
    return {
      descriptionZh: elements.descriptionZh.value.trim(),
      format: elements.format.value,
      order: Number(elements.order.value),
      slug: elements.slug.value.trim(),
      titleZh: elements.titleZh.value.trim(),
      visible: elements.newVisible.checked,
    };
  }

  function hasNewSection(values = readNewSection()) {
    return Boolean(
      values.titleZh || values.descriptionZh || values.slug || values.format !== "page" || values.order !== 50 || values.visible !== true
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
    elements.descriptionZh.value = "";
    elements.slug.value = "";
    elements.order.value = "50";
    elements.format.value = "page";
    elements.newVisible.checked = true;
    slugIsAutomatic = true;
    settingsChanged();
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

  const siteUiChoices = Object.freeze({
    loading_copy: /^(?:thinking|loading|thinking-zh|loading-zh)$/,
    wind_strength: /^(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|200)$/,
    away_title_delay: /^(?:[0-9]|[1-9][0-9]{1,2}|[1-4][0-9]{3}|5000)$/,
    season_effect: /^(?:off|auto|snow|sakura|rain|leaves)$/,
    site_font: /^[a-z][a-z0-9-]{1,40}$/,
    training_card_visible: /^(?:true|false)$/,
  });

  function setSiteUiValue(source, key, value) {
    if (!siteUiChoices[key]?.test(value)) throw new Error(`Unsupported ${key}`);
    const replacement = `${key}: ${value}`;
    const pattern = new RegExp(`^${key}:.*$`, "m");
    if (pattern.test(source)) return source.replace(pattern, replacement);
    return `${source.trimEnd()}\n${replacement}\n`;
  }

  function projectGridBody(slug) {
    return `<div class="projects">
  {% assign localized_projects = site.projects | where: "lang", "zh" | where: "section_key", "${slug}" | sort: "importance" %}
  <div class="row row-cols-1 row-cols-md-3">
    {% for project in localized_projects %}
      {% include projects.liquid %}
    {% endfor %}
  </div>
</div>
`;
  }

  function createPageSource(values) {
    const layout = values.format === "profiles" ? "profiles" : "page";
    const frontMatter = [
      "---",
      `layout: ${layout}`,
      `title: ${JSON.stringify(values.titleZh)}`,
      `permalink: /${values.slug}/`,
      `description: ${JSON.stringify(values.descriptionZh)}`,
      "lang: zh",
      `translation_key: section-${values.slug}`,
      `settings_file_stem: ${values.slug}`,
      `nav: ${values.visible ? "true" : "false"}`,
      `nav_order: ${values.order}`,
    ];

    let body = "";
    if (values.format === "posts") {
      frontMatter.push(`kind: ${values.slug}`);
      frontMatter.push(`empty_text: ${JSON.stringify("暂无内容。")}`);
      body = "{% include post-lane.liquid %}\n";
    } else if (values.format === "projects") {
      body = projectGridBody(values.slug);
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
      sectionChanges.map(async (input) => {
        const path = input.dataset.sourcePathZh;
        if (!path) throw new Error(`Missing source for ${input.dataset.translationKey}`);
        const source = await fetchFileAt(path, headSha);
        return {
          content: setNavigationVisibility(source, input.checked),
          mode: "100644",
          path,
          type: "blob",
        };
      })
    );

    // 顺手把实时设置的后备值也带上（有差异才会有条目）。
    const uiEntries = await bakedEntries(headSha);

    if (!hasNewSection(newSection)) return [...existingEntries, ...uiEntries];
    const newPath = `_pages/${newSection.slug}-zh.md`;
    const collision = await githubRequest(`/repos/${repository}/contents/${encodePath(newPath)}?ref=${encodeURIComponent(headSha)}`, {
      allowNotFound: true,
      token: activeToken,
    });
    if (collision) throw new Error(strings.collision);

    return [...existingEntries, ...uiEntries, { content: createPageSource(newSection), mode: "100644", path: newPath, type: "blob" }];
  }

  async function createAtomicCommit(entries, headSha, baseTree, newSection, customMessage = "") {
    const tree = await githubRequest(`/repos/${repository}/git/trees`, {
      body: { base_tree: baseTree, tree: entries },
      method: "POST",
      token: activeToken,
    });
    const message = customMessage || (newSection && hasNewSection(newSection) ? `site: add section "${newSection.slug}"` : strings.defaultMessage);
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
      const continueSettings = openSettingsAfterLogin;
      window.functionhxOwnerUi?.setVerified?.(true, saved.remembered === true);
      pendingCommit = false;
      window.clearTimeout(authCompletionTimer);
      authCompletionTimer = window.setTimeout(
        () => {
          closeAuth();
          if (continueSettings) finishOwnerLogin();
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
    // 外观类修改如果还在排队，先让它们生效。
    if (liveDirty()) await saveLiveSettings();
    return exclusive(commitNow);
  }

  async function commitNow() {
    if (busy) return;
    const sectionChanges = changedSections();
    const newSection = readNewSection();
    if (!validateNewSection(newSection)) return;
    if (!hasPendingSettings()) {
      setStatus(strings.noChanges);
      return;
    }
    if (!activeToken) {
      if (!authDialog.open) requestOwnerAccess(true);
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
      const entries = await prepareTreeEntries(headSha, sectionChanges, newSection);
      const commit = await createAtomicCommit(entries, headSha, baseTree, newSection);
      markBakedSynced();

      sectionChanges.forEach((input) => {
        input.dataset.initialVisible = String(input.checked);
      });
      syncPersonalization();
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

  toggle.addEventListener("click", handleSettingsToggle);
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
    previewPersonalization(
      root.dataset.initialSiteFont,
      root.dataset.initialLoadingCopy,
      root.dataset.initialSeasonEffect,
      Number(root.dataset.initialWindStrength ?? 100),
      Number(root.dataset.initialAwayTitleDelay ?? 500)
    );
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
  eggInputs.forEach((input) => input.addEventListener("change", settingsChanged));
  letterSeal?.addEventListener("click", sealLetterDraft);
  Object.values(letterFields).forEach((field) =>
    field?.addEventListener("input", () => {
      // 加密之后又改了内容：旧密文作废，需要重新加密。
      if (!sealedLetter) return;
      sealedLetter = null;
      letterStatus.textContent = "内容有改动，请重新填写暗号和密码并加密。";
      settingsChanged();
    })
  );
  elements.font.addEventListener("change", () => selectFont(elements.font.value));
  elements.loadingCopy.addEventListener("change", () => selectLoadingCopy(elements.loadingCopy.value));
  seasonInputs.forEach((input) =>
    input.addEventListener("change", () => {
      previewPersonalization();
      syncPersonalization();
      settingsChanged();
    })
  );
  windInput?.addEventListener("input", () => {
    previewPersonalization();
    syncPersonalization();
    settingsChanged();
  });
  windTest?.addEventListener("click", () => window.functionhxSeasons?.testGust?.());
  awayInput?.addEventListener("input", () => {
    previewPersonalization();
    syncPersonalization();
    settingsChanged();
  });
  newSectionInputs.forEach((input) => {
    input.addEventListener("input", () => {
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
    openSettingsAfterLogin = false;
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
  adoptLiveSettings(window.functionhxRuntimeSettings?.current?.() || {});
  restoreDraft();
  updateSaveState();
})();
