import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);
gsap.defaults({ ease: "expo.out", duration: 1.1 });

/** Media queries shared by every page timeline. */
export const MEDIA = {
  motion: "(prefers-reduced-motion: no-preference)",
  reduced: "(prefers-reduced-motion: reduce)",
  desktop: "(min-width: 900px)",
  fine: "(hover: hover) and (pointer: fine)",
} as const;

export function prefersReducedMotion(): boolean {
  return window.matchMedia(MEDIA.reduced).matches;
}

export function finePointer(): boolean {
  return window.matchMedia(MEDIA.fine).matches;
}

export { gsap, ScrollTrigger };
