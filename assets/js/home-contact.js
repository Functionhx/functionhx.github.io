(() => {
  const trigger = document.querySelector('.contact-icons a[title="WeChat"]');
  const dialog = document.getElementById("wechat-qr-dialog");
  const qqTrigger = document.querySelector('.contact-icons a[title="QQ · 2994114386"]');
  const qqMailTrigger = document.querySelector('.contact-icons a[title="QQ Mail"]');
  const copyStatus = document.getElementById("contact-copy-status");
  let copyStatusTimer = 0;

  function isEnglishDocument() {
    return document.documentElement.lang.toLowerCase().startsWith("en");
  }

  function announce(message) {
    if (!copyStatus) return;
    window.clearTimeout(copyStatusTimer);
    copyStatus.textContent = message;
    copyStatus.dataset.visible = "true";
    copyStatusTimer = window.setTimeout(() => {
      copyStatus.removeAttribute("data-visible");
      copyStatus.textContent = "";
    }, 2200);
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (_error) {
        // Fall through for browsers that expose Clipboard API without granting it.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("aria-hidden", "true");
    textarea.setAttribute("readonly", "");
    Object.assign(textarea.style, {
      height: "1px",
      left: "-9999px",
      opacity: "0",
      position: "fixed",
      top: "0",
      width: "1px",
    });
    const previouslyFocused = document.activeElement;
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_error) {
      copied = false;
    }
    textarea.remove();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true });
    return copied;
  }

  function isPlainPrimaryClick(event) {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  function enhanceCopyBeforeLaunch(anchor, value, destinationName) {
    if (!anchor) return;
    anchor.setAttribute("data-no-page-loader", "");
    anchor.addEventListener("click", async (event) => {
      if (!isPlainPrimaryClick(event)) return;
      event.preventDefault();
      const copied = await copyText(value);
      const isEnglish = isEnglishDocument();
      announce(
        copied
          ? isEnglish
            ? `${value} copied. Opening ${destinationName}…`
            : `已复制 ${value}，正在打开${destinationName}…`
          : isEnglish
            ? `Copy failed. Opening ${destinationName}…`
            : `复制失败，正在打开${destinationName}…`
      );
      const launchEvent = new CustomEvent("functionhx:contact-launch", {
        bubbles: true,
        cancelable: true,
        detail: { copyText: value, href: anchor.href },
      });
      if (anchor.dispatchEvent(launchEvent)) window.location.assign(anchor.href);
    });
  }

  if (qqTrigger) {
    qqTrigger.setAttribute("aria-label", "QQ · 2994114386");
  }
  if (qqMailTrigger) qqMailTrigger.setAttribute("aria-label", "QQ Mail · 2994114386@qq.com");
  enhanceCopyBeforeLaunch(qqTrigger, "2994114386", "QQ");
  enhanceCopyBeforeLaunch(qqMailTrigger, "2994114386@qq.com", isEnglishDocument() ? "QQ Mail" : "QQ 邮箱");

  if (!trigger || !dialog) return;

  const close = () => {
    if (typeof dialog.close === "function") dialog.close();
    else {
      dialog.removeAttribute("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  };

  trigger.setAttribute("aria-controls", dialog.id);
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("data-no-page-loader", "");

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    trigger.setAttribute("aria-expanded", "true");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });

  dialog.addEventListener("close", () => trigger.setAttribute("aria-expanded", "false"));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
})();
