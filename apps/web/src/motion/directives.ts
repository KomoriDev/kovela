import type { Directive } from "vue";
import { finePointer, gsap, prefersReducedMotion } from "./gsap";

type Cleanup = () => void;
const cleanups = new WeakMap<HTMLElement, Cleanup[]>();

function track(el: HTMLElement, cleanup: Cleanup) {
  const list = cleanups.get(el) ?? [];
  list.push(cleanup);
  cleanups.set(el, list);
}
function release(el: HTMLElement) {
  cleanups.get(el)?.forEach((cleanup) => cleanup());
  cleanups.delete(el);
}

/**
 * Pulls an element toward the pointer while hovered. The value is the pull strength
 * (0.35 by default). Apply it to an element no other tween translates.
 */
export const vMagnetic: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    if (!finePointer() || prefersReducedMotion()) return;
    const strength = binding.value ?? 0.35;
    const xTo = gsap.quickTo(el, "x", { duration: 0.7, ease: "power3.out" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.7, ease: "power3.out" });
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      xTo((event.clientX - (rect.left + rect.width / 2)) * strength);
      yTo((event.clientY - (rect.top + rect.height / 2)) * strength);
    };
    const leave = () => {
      xTo(0);
      yTo(0);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    track(el, () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(el);
    });
  },
  unmounted: release,
};

/** Exposes the pointer position as --mx / --my so CSS can paint a spotlight. */
export const vSpotlight: Directive<HTMLElement> = {
  mounted(el) {
    if (!finePointer()) return;
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      el.style.setProperty("--my", `${event.clientY - rect.top}px`);
    };
    el.addEventListener("pointermove", move);
    track(el, () => el.removeEventListener("pointermove", move));
  },
  unmounted: release,
};
