<script setup lang="ts">
import { onMounted, ref } from "vue";
import { gsap, prefersReducedMotion } from "../motion/gsap";
import { lockScroll } from "../motion/smooth";
import { openRevealGate } from "../stores/ui";

const SEEN_KEY = "kovela.intro";
const root = ref<HTMLElement>();
const visible = ref(true);
const count = ref(0);
const letters = "KOVELA".split("");

function seen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function remember() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* The intro simply replays when storage is blocked. */
  }
}
function preload(src: string) {
  return new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = image.onerror = () => resolve();
    image.src = src;
  });
}
function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

onMounted(async () => {
  if (prefersReducedMotion() || seen() || !root.value) {
    visible.value = false;
    openRevealGate();
    return;
  }
  remember();
  lockScroll(true);
  const assets = Promise.race([
    Promise.all([
      document.fonts.ready,
      preload("/games/angrybirds/screenshot2.png"),
      preload("/games/watermelon/screenshot1.png"),
    ]),
    wait(2600),
  ]);
  const counter = { value: 0 };
  const intro = gsap
    .timeline()
    .from(".intro-mark", { scale: 0.4, rotate: -40, opacity: 0, duration: 1.2 })
    .from(
      ".intro-word span",
      { yPercent: 110, duration: 1, stagger: 0.05 },
      0.15,
    )
    .to(
      counter,
      {
        value: 100,
        duration: 1.5,
        ease: "power2.inOut",
        onUpdate: () => (count.value = Math.round(counter.value)),
      },
      0,
    )
    .to(".intro-bar i", { scaleX: 1, duration: 1.5, ease: "power2.inOut" }, 0);
  await Promise.all([assets, intro.then()]);
  gsap
    .timeline({
      onComplete: () => {
        lockScroll(false);
        visible.value = false;
      },
    })
    .to(".intro-inner > *", {
      yPercent: -40,
      opacity: 0,
      duration: 0.7,
      stagger: 0.04,
      ease: "expo.in",
    })
    .to(
      root.value,
      { clipPath: "inset(0% 0% 100% 0%)", duration: 1.1, ease: "expo.inOut" },
      0.3,
    )
    .call(openRevealGate, [], 0.75);
});
</script>

<template>
  <div v-if="visible" ref="root" class="intro" aria-hidden="true">
    <div class="intro-inner">
      <img
        class="intro-mark"
        src="/brand/kovela-mark.png"
        alt=""
        width="88"
        height="88"
      />
      <p class="intro-word">
        <span v-for="(letter, index) in letters" :key="index">{{ letter }}</span>
      </p>
    </div>
    <div class="intro-foot">
      <span class="intro-tag">MI-VELA GAMES</span>
      <span class="intro-count">{{ String(count).padStart(3, "0") }}</span>
    </div>
    <span class="intro-bar"><i /></span>
  </div>
</template>

<style scoped>
.intro {
  position: fixed;
  z-index: 200;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--paper);
  clip-path: inset(0% 0% 0% 0%);
}
.intro-inner {
  display: grid;
  justify-items: center;
  gap: 22px;
}
.intro-mark {
  width: 88px;
  height: 88px;
  filter: drop-shadow(0 24px 50px rgba(47, 125, 255, 0.35));
}
.intro-word {
  display: flex;
  margin: 0;
  overflow: hidden;
  font-family: var(--font-display);
  font-size: clamp(42px, 8vw, 84px);
  letter-spacing: 0.08em;
  line-height: 1;
}
.intro-word span {
  display: inline-block;
}
.intro-foot {
  position: absolute;
  right: var(--gutter);
  bottom: 34px;
  left: var(--gutter);
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  color: var(--fg-3);
  font-size: 11px;
  letter-spacing: 0.24em;
}
.intro-count {
  color: var(--fg);
  font-family: var(--font-display);
  font-size: clamp(40px, 6vw, 72px);
  letter-spacing: 0.02em;
  line-height: 0.8;
}
.intro-bar {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: var(--line);
}
.intro-bar i {
  display: block;
  height: 100%;
  background: var(--grad);
  transform: scaleX(0);
  transform-origin: left;
}
</style>
