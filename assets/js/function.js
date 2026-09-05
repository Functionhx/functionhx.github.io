/* Motion for the Chinese Function shell; the existing site runtime owns theme and navigation. */
(() => {
  "use strict";
  const root = document.documentElement;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const desktop = window.matchMedia("(min-width: 900px)");
  const hero = document.querySelector(".function-intro");
  const animations = new Set();
  let frame = 0;
  const updateHeader = () => {
    const scrolled = String(window.scrollY > 70);
    if (root.dataset.functionScrolled !== scrolled) root.dataset.functionScrolled = scrolled;
    if (hero) {
      const shift = motion.matches || !desktop.matches ? 0 : Math.min(44, Math.max(0, -hero.getBoundingClientRect().top) * 0.09);
      hero.style.setProperty("--portrait-shift", `${shift.toFixed(1)}px`);
    }
    frame = 0;
  };
  const scheduleUpdate = () => {
    if (!frame) frame = requestAnimationFrame(updateHeader);
  };
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  desktop.addEventListener("change", scheduleUpdate);
  window.addEventListener("pageshow", updateHeader);
  updateHeader();

  const reveal = (element, delay = 0, portrait = false) => {
    if (motion.matches || !element.animate) return;
    const animation = element.animate(
      portrait
        ? [{ opacity: 0.45 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(22px)" },
            { opacity: 1, transform: "translateY(0)" },
          ],
      { duration: portrait ? 1100 : 850, delay, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" }
    );
    animations.add(animation);
    animation.finished.then(
      () => animations.delete(animation),
      () => animations.delete(animation)
    );
  };
  let observer;
  if (!motion.matches && "IntersectionObserver" in window) {
    document.querySelectorAll(".function-intro-copy > *").forEach((element, index) => reveal(element, 100 + index * 85));
    const portrait = document.querySelector(".function-portrait img");
    if (portrait) reveal(portrait, 0, true);
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
      .querySelectorAll(".function-introduction > *, .function-directory, .function-timeline-heading, .function-event, .function-home .social")
      .forEach((element) => observer.observe(element));
  }
  document.addEventListener("focusin", (event) => {
    animations.forEach((animation) => {
      if (animation.effect?.target?.contains(event.target)) animation.finish();
    });
  });
  motion.addEventListener("change", () => {
    scheduleUpdate();
    if (!motion.matches) return;
    observer?.disconnect();
    animations.forEach((animation) => animation.finish());
  });
})();
