/* Motion for the Chinese Function shell; the existing site runtime owns theme and navigation. */
(() => {
  "use strict";
  const root = document.documentElement;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const animations = new Set();
  let frame = 0;
  const updateHeader = () => {
    root.dataset.functionScrolled = String(window.scrollY > 70);
    frame = 0;
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!frame) frame = requestAnimationFrame(updateHeader);
    },
    { passive: true }
  );
  window.addEventListener("pageshow", updateHeader);
  updateHeader();

  const reveal = (element, delay = 0) => {
    if (motion.matches || !element.animate) return;
    const animation = element.animate(
      [
        { opacity: 0, transform: "translateY(18px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 680, delay, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" }
    );
    animations.add(animation);
    animation.finished.then(
      () => animations.delete(animation),
      () => animations.delete(animation)
    );
  };
  let observer;
  if (!motion.matches && "IntersectionObserver" in window) {
    document.querySelectorAll(".function-intro-copy > *, .function-portrait").forEach((element, index) => reveal(element, index * 65));
    observer = new IntersectionObserver(
      (entries) => {
        let delay = 0;
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target, delay);
          delay += 45;
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08 }
    );
    document
      .querySelectorAll(".function-directory-link, .function-timeline-heading, .function-event")
      .forEach((element) => observer.observe(element));
  }
  document.addEventListener("focusin", (event) => {
    animations.forEach((animation) => {
      if (animation.effect?.target?.contains(event.target)) animation.finish();
    });
  });
  motion.addEventListener("change", () => {
    if (!motion.matches) return;
    observer?.disconnect();
    animations.forEach((animation) => animation.finish());
  });
})();
