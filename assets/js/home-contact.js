(() => {
  const trigger = document.querySelector('.contact-icons a[title="WeChat"]');
  const dialog = document.getElementById("wechat-qr-dialog");
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
