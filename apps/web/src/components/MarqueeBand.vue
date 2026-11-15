<script setup lang="ts">
import { ref } from "vue";
import { gsap, MEDIA, ScrollTrigger } from "../motion/gsap";
import { useGsap } from "../motion/useGsap";

const props = defineProps<{ items: string[]; reverse?: boolean; outline?: boolean }>();
const root = ref<HTMLElement>();

useGsap(root, () => {
  const track = root.value?.querySelector<HTMLElement>(".track");
  if (!track || !root.value) return;
  const mm = gsap.matchMedia();
  mm.add(MEDIA.motion, () => {
    const loop = gsap.fromTo(
      track,
      { xPercent: props.reverse ? -50 : 0 },
      {
        xPercent: props.reverse ? 0 : -50,
        duration: 36,
        ease: "none",
        repeat: -1,
      },
    );
    const skewTo = gsap.quickTo(track, "skewX", { duration: 0.6, ease: "power3.out" });
    let settle: gsap.core.Tween | undefined;
    ScrollTrigger.create({
      trigger: root.value,
      start: "top bottom",
      end: "bottom top",
      onUpdate(self) {
        const velocity = self.getVelocity();
        const boost = Math.min(1 + Math.abs(velocity) / 220, 7);
        gsap.to(loop, { timeScale: boost, duration: 0.2, overwrite: true });
        skewTo(gsap.utils.clamp(-9, 9, velocity / -260));
        settle?.kill();
        settle = gsap.delayedCall(0.12, () => {
          skewTo(0);
          gsap.to(loop, { timeScale: 1, duration: 1.4, ease: "power2.out", overwrite: true });
        });
      },
    });
  });
});
</script>

<template>
  <div ref="root" class="marquee" :class="{ 'is-outline': outline }" aria-hidden="true">
    <div class="track">
      <div v-for="copy in 2" :key="copy" class="group">
        <template v-for="round in 2" :key="round">
          <span v-for="item in items" :key="`${round}-${item}`" class="item">
            {{ item }}
            <svg class="star" viewBox="0 0 24 24" width="28" height="28">
              <path
                d="M12 1.5c.6 5.6 4.9 9.9 10.5 10.5-5.6.6-9.9 4.9-10.5 10.5C11.4 16.9 7.1 12.6 1.5 12 7.1 11.4 11.4 7.1 12 1.5Z"
                fill="currentColor"
              />
            </svg>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.marquee {
  overflow: hidden;
  padding-block: clamp(18px, 3vw, 34px);
  border-block: 1px solid var(--line);
  user-select: none;
}
.track {
  display: flex;
  width: max-content;
  will-change: transform;
}
.group {
  display: flex;
  flex: none;
}
.item {
  display: inline-flex;
  align-items: center;
  gap: clamp(22px, 3vw, 44px);
  padding-right: clamp(22px, 3vw, 44px);
  font-family: var(--font-display);
  font-size: clamp(44px, 8vw, 118px);
  letter-spacing: 0.01em;
  line-height: 1;
  white-space: nowrap;
}
.is-outline .item {
  color: transparent;
  -webkit-text-stroke: 1px rgba(18, 20, 25, 0.3);
}
.star {
  flex: none;
  width: 0.38em;
  height: 0.38em;
  color: var(--brand-b);
}
.is-outline .star {
  color: rgba(18, 20, 25, 0.25);
}
</style>
