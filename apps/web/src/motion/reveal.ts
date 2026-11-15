import { gsap, ScrollTrigger } from "./gsap";

/** Lifts every `[data-reveal]` inside `scope` into place as it enters the viewport. */
export function revealOnScroll(scope: Element): void {
  const items = gsap.utils.toArray<HTMLElement>("[data-reveal]", scope);
  if (!items.length) return;
  gsap.set(items, { y: 64, opacity: 0 });
  ScrollTrigger.batch(items, {
    start: "top 90%",
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, {
        y: 0,
        opacity: 1,
        duration: 1.4,
        stagger: 0.09,
        overwrite: true,
      }),
  });
}

/** Slides each masked `.line` of every `[data-lines]` block up from below. */
export function revealLines(scope: Element): void {
  gsap.utils.toArray<HTMLElement>("[data-lines]", scope).forEach((block) => {
    gsap.from(block.querySelectorAll(".line > span"), {
      yPercent: 115,
      duration: 1.5,
      stagger: 0.1,
      scrollTrigger: { trigger: block, start: "top 88%", once: true },
    });
  });
}

/** Tweens the page backdrop toward each `[data-tint]` section while it holds the viewport centre. */
export function tintOnScroll(scope: Element, instant = false): void {
  gsap.utils.toArray<HTMLElement>("[data-tint]", scope).forEach((section) => {
    ScrollTrigger.create({
      trigger: section,
      start: "top 55%",
      end: "bottom 55%",
      onToggle: (self) => {
        if (!self.isActive) return;
        gsap.to(document.documentElement, {
          "--tint": section.dataset.tint,
          duration: instant ? 0 : 1.2,
          ease: "power2.out",
          overwrite: "auto",
        });
      },
    });
  });
}
