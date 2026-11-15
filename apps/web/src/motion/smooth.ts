import Lenis from "lenis";
import { gsap, prefersReducedMotion, ScrollTrigger } from "./gsap";

let lenis: Lenis | undefined;

function raf(time: number) {
  lenis?.raf(time * 1000);
}

/** Starts inertial scrolling driven by the GSAP ticker so ScrollTrigger stays in sync. */
export function startSmooth(): void {
  if (lenis || prefersReducedMotion()) return;
  lenis = new Lenis({ lerp: 0.085, smoothWheel: true, autoRaf: false });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);
}

export function stopSmooth(): void {
  gsap.ticker.remove(raf);
  lenis?.destroy();
  lenis = undefined;
}

export function scrollToTarget(
  target: string | HTMLElement | number,
  options: { offset?: number; immediate?: boolean } = {},
): void {
  const { offset = 0, immediate = false } = options;
  if (lenis) {
    lenis.scrollTo(target, {
      offset,
      immediate,
      force: true,
      duration: 1.6,
      easing: (t) => 1 - Math.pow(1 - t, 4),
    });
    return;
  }
  const behavior: ScrollBehavior =
    immediate || prefersReducedMotion() ? "auto" : "smooth";
  if (typeof target === "number") {
    window.scrollTo({ top: target + offset, behavior });
    return;
  }
  const el =
    typeof target === "string" ? document.querySelector(target) : target;
  if (!(el instanceof HTMLElement)) return;
  const top = el.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo({ top, behavior });
}

/** Freezes page scrolling while an overlay owns the viewport. */
export function lockScroll(locked: boolean): void {
  if (locked) lenis?.stop();
  else lenis?.start();
  document.documentElement.classList.toggle("is-locked", locked);
}
