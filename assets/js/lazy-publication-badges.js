(function initializeLazyPublicationBadges() {
  "use strict";

  const badgeRoot = document.querySelector(".altmetric-embed, .__dimensions_badge_embed__")?.closest(".publications");
  if (!badgeRoot) return;

  let loaded = false;

  function appendScript(source) {
    if (document.querySelector(`script[src="${source}"]`)) return;
    const script = document.createElement("script");
    script.async = true;
    script.src = source;
    document.head.append(script);
  }

  function loadBadges() {
    if (loaded) return;
    loaded = true;
    appendScript("https://d1bxh8uas1mnw7.cloudfront.net/assets/embed.js");
    appendScript("https://badge.dimensions.ai/badge.js");
  }

  if (!("IntersectionObserver" in window)) {
    window.addEventListener("load", loadBadges, { once: true });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      loadBadges();
    },
    { rootMargin: "600px 0px" }
  );
  observer.observe(badgeRoot);
})();
