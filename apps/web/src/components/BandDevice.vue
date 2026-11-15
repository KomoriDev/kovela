<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { Frame, GameShot } from "../data/games";
import { prefersReducedMotion } from "../motion/gsap";

const props = withDefaults(
  defineProps<{
    shots: GameShot[];
    frame: Frame;
    /** Cycle through shots while the band is on screen. */
    autoplay?: boolean;
    interval?: number;
    /** Render screenshot pager dots under the band. */
    controls?: boolean;
    label?: string;
  }>(),
  { autoplay: true, interval: 4200, controls: false, label: "实机画面" },
);

const root = ref<HTMLElement>();
const front = ref(0);
let timer = 0;
let visible = false;
let observer: IntersectionObserver | undefined;

function arm() {
  window.clearInterval(timer);
  if (
    !props.autoplay ||
    !visible ||
    document.hidden ||
    props.shots.length < 2 ||
    prefersReducedMotion()
  )
    return;
  timer = window.setInterval(() => {
    front.value = (front.value + 1) % props.shots.length;
  }, props.interval);
}
function pause() {
  window.clearInterval(timer);
}
function pick(index: number) {
  front.value = index;
  arm();
}

onMounted(() => {
  document.addEventListener("visibilitychange", arm);
  observer = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting;
    arm();
  });
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => {
  window.clearInterval(timer);
  observer?.disconnect();
  document.removeEventListener("visibilitychange", arm);
});
</script>

<template>
  <figure
    ref="root"
    class="band"
    :data-frame="frame"
    @pointerenter="pause"
    @pointerleave="arm"
  >
    <div class="device">
      <span class="strap strap-a" aria-hidden="true" />
      <span class="strap strap-b" aria-hidden="true" />
      <div class="body">
        <div class="screen">
          <img
            v-for="(shot, index) in shots"
            :key="shot.src"
            :src="shot.src"
            :alt="index === front ? `${label} · ${shot.caption}` : ''"
            :aria-hidden="index !== front"
            :class="{ 'is-front': index === front }"
            :style="shot.focus ? { objectPosition: shot.focus } : undefined"
            decoding="async"
          />
          <span class="glare" aria-hidden="true" />
        </div>
      </div>
    </div>
    <figcaption v-if="controls && shots.length > 1" class="pager">
      <button
        v-for="(shot, index) in shots"
        :key="shot.src"
        type="button"
        :aria-label="`${label} ${index + 1}：${shot.caption}`"
        :aria-pressed="index === front"
        @click="pick(index)"
      />
    </figcaption>
  </figure>
</template>

<style scoped>
/* Consumers size the band through the inherited --band-w custom property. */
.band {
  --w: var(--band-w, 220px);
  position: relative;
  display: grid;
  justify-items: center;
  width: var(--w);
  margin: 0;
}
.band[data-frame="land"] {
  --w: var(--band-w, 460px);
}

.device {
  position: relative;
  width: 100%;
}
.body {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: calc(var(--w) * 0.045);
  border-radius: 46% / 19.5%;
  background:
    linear-gradient(160deg, #3a3f49 0%, #15171c 38%, #0b0c0f 62%, #2b2f37 100%);
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    inset 0 1px 1px rgba(255, 255, 255, 0.22),
    inset 0 -2px 6px rgba(0, 0, 0, 0.7),
    0 40px 70px -30px rgba(28, 38, 58, 0.45),
    0 30px 110px -40px var(--band-glow, rgba(47, 125, 255, 0.4));
}
.band[data-frame="land"] .body {
  border-radius: 19.5% / 46%;
  padding: calc(var(--w) * 0.02);
}
.screen {
  position: relative;
  overflow: hidden;
  aspect-ratio: 212 / 520;
  border-radius: 44% / 18%;
  background: #000;
  isolation: isolate;
}
.band[data-frame="land"] .screen {
  aspect-ratio: 520 / 212;
  border-radius: 18% / 44%;
}
.screen img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transform: scale(1.06);
  filter: blur(6px);
  transition:
    opacity 0.9s var(--ease-out),
    transform 1.4s var(--ease-out),
    filter 0.9s var(--ease-out);
}
.screen img.is-front {
  opacity: 1;
  transform: none;
  filter: none;
}
.glare {
  position: absolute;
  z-index: 2;
  inset: 0;
  background: linear-gradient(
    125deg,
    rgba(255, 255, 255, 0.16) 0%,
    rgba(255, 255, 255, 0.03) 28%,
    transparent 46%
  );
  pointer-events: none;
}

.strap {
  position: absolute;
  left: 50%;
  width: 74%;
  height: 46%;
  translate: -50% 0;
  /* Soft white silicone strap that dissolves into the paper ground. */
  background: linear-gradient(90deg, #dedbd4 0%, #f4f2ee 30%, #fbfaf8 50%, #f4f2ee 70%, #dedbd4 100%);
  box-shadow: inset 0 0 0 1px rgba(18, 20, 25, 0.05);
  pointer-events: none;
}
.strap-a {
  bottom: 70%;
  border-radius: 40% 40% 0 0 / 18% 18% 0 0;
  mask: linear-gradient(to top, #000 20%, transparent 95%);
}
.strap-b {
  top: 70%;
  border-radius: 0 0 40% 40% / 0 0 18% 18%;
  mask: linear-gradient(to bottom, #000 20%, transparent 95%);
}
.band[data-frame="land"] .strap {
  top: 50%;
  bottom: auto;
  left: auto;
  width: 40%;
  height: 74%;
  translate: 0 -50%;
  background: linear-gradient(180deg, #dedbd4 0%, #f4f2ee 30%, #fbfaf8 50%, #f4f2ee 70%, #dedbd4 100%);
}
.band[data-frame="land"] .strap-a {
  right: 72%;
  border-radius: 18% 0 0 18% / 40% 0 0 40%;
  mask: linear-gradient(to left, #000 20%, transparent 95%);
}
.band[data-frame="land"] .strap-b {
  left: 72%;
  border-radius: 0 18% 18% 0 / 0 40% 40% 0;
  mask: linear-gradient(to right, #000 20%, transparent 95%);
}

.pager {
  position: relative;
  z-index: 2;
  display: flex;
  gap: 8px;
  margin-top: 26px;
}
.band[data-frame="port"] .pager {
  margin-top: calc(var(--w) * 0.32);
}
.pager button {
  width: 22px;
  height: 4px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: rgba(18, 20, 25, 0.16);
  transition:
    width 0.6s var(--ease-out),
    background 0.4s;
}
.pager button[aria-pressed="true"] {
  width: 44px;
  background: var(--fg);
}
.pager button:hover {
  background: rgba(18, 20, 25, 0.4);
}
</style>
