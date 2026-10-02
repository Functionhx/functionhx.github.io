/* 网站宠物的加载器：页面加载完、浏览器空闲时才去取 pet.css / pet.js，首屏不多下载一个字节。
 * 站点配置 _config.yml 的 pet.enabled 决定默认是否出现；?pet=on / ?pet=off 只改这台浏览器（预览用），?pet=reset 恢复默认。 */
(function loadPet() {
  "use strict";

  const node = document.getElementById("functionhx-pet-config");
  if (!node) return;
  let config;
  try {
    config = JSON.parse(node.textContent);
  } catch (_error) {
    return;
  }
  const OVERRIDE = "functionhx:pet:override";
  let override = null;
  try {
    const requested = new URLSearchParams(window.location.search).get("pet");
    if (requested === "on" || requested === "off") window.localStorage.setItem(OVERRIDE, requested);
    if (requested === "reset") window.localStorage.removeItem(OVERRIDE);
    override = window.localStorage.getItem(OVERRIDE);
  } catch (_error) {
    // 存储不可用时按站点默认。
  }
  const enabled = override ? override === "on" : config.enabled === true;
  if (!enabled || navigator.connection?.saveData) return;

  let started = false;
  function start() {
    if (started) return;
    started = true;
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = config.style;
    document.head.append(style);
    const script = document.createElement("script");
    script.src = config.script;
    script.async = true;
    document.body.append(script);
  }
  const idle = () => ("requestIdleCallback" in window ? window.requestIdleCallback(start, { timeout: 3000 }) : window.setTimeout(start, 1200));
  // 一般等 load 之后再来；但网络慢时某张图或第三方脚本可能拖住 load 很久，最多等 6 秒。
  const whenLoaded = () => {
    if (document.readyState === "complete") return idle();
    window.addEventListener("load", idle, { once: true });
    window.setTimeout(idle, 6000);
  };
  // Speculation Rules 会在后台预渲染首页和博客页：那时访客还没真正打开它，宠物不能醒来，
  // 否则会多记一次来访、对着没人的页面说话。等页面真正被打开再启动。
  if (document.prerendering) document.addEventListener("prerenderingchange", whenLoaded, { once: true });
  else whenLoaded();
})();
