<script setup lang="ts">
import { ref } from "vue";
import { useRoute } from "vue-router";
import IntroLoader from "./components/IntroLoader.vue";
import SiteFooter from "./components/SiteFooter.vue";
import SiteHeader from "./components/SiteHeader.vue";
import { useScrollState } from "./composables/useScrollState";
import { gsap, prefersReducedMotion, ScrollTrigger } from "./motion/gsap";
import { scrollToTarget } from "./motion/smooth";
import { closeRevealGate, openRevealGate } from "./stores/ui";

const route = useRoute();
const curtain = ref<HTMLElement>();
const label = ref("");
const caption = ref("");
const { progress } = useScrollState();

function resetTint() {
  gsap.to(document.documentElement, {
    "--tint": "#f6f4ef",
    duration: 0.6,
    overwrite: "auto",
  });
}

function onLeave(el: Element, done: () => void) {
  closeRevealGate();
  label.value = route.meta.label;
  caption.value = route.meta.caption;
  const cover = curtain.value;
  if (!cover || prefersReducedMotion()) {
    scrollToTarget(0, { immediate: true });
    resetTint();
    done();
    return;
  }
  gsap
    .timeline({
      onComplete: () => {
        scrollToTarget(0, { immediate: true });
        gsap.set(document.documentElement, { "--tint": "#f6f4ef" });
        done();
      },
    })
    .set(cover, { visibility: "visible" })
    .fromTo(
      cover,
      { clipPath: "inset(100% 0% 0% 0%)" },
      { clipPath: "inset(0% 0% 0% 0%)", duration: 0.8, ease: "expo.inOut" },
    )
    .to(el, { y: -90, opacity: 0.3, duration: 0.8, ease: "expo.inOut" }, 0)
    .fromTo(
      cover.querySelectorAll(".curtain-line > *"),
      { yPercent: 110 },
      { yPercent: 0, duration: 0.8, stagger: 0.06, ease: "expo.out" },
      0.38,
    );
}

function onEnter(el: Element, done: () => void) {
  const cover = curtain.value;
  const finish = () => {
    ScrollTrigger.refresh();
    done();
  };
  if (!cover || prefersReducedMotion()) {
    openRevealGate();
    finish();
    return;
  }
  gsap
    .timeline({
      onComplete: () => {
        gsap.set(cover, { visibility: "hidden" });
        finish();
      },
    })
    .to(
      cover.querySelectorAll(".curtain-line > *"),
      { yPercent: -110, duration: 0.5, stagger: 0.04, ease: "expo.in" },
      0.15,
    )
    .to(
      cover,
      { clipPath: "inset(0% 0% 100% 0%)", duration: 0.9, ease: "expo.inOut" },
      0.4,
    )
    .from(
      el,
      { y: 140, duration: 1.2, ease: "expo.out", clearProps: "transform" },
      0.62,
    )
    .call(openRevealGate, [], 0.7);
}

</script>

<template>
  <div class="site">
    <span
      class="scroll-line"
      aria-hidden="true"
      :style="{ transform: `scaleX(${progress})` }"
    />
    <SiteHeader />

    <main id="main" class="site-main">
      <RouterView v-slot="{ Component, route: current }">
        <Transition :css="false" mode="out-in" @leave="onLeave" @enter="onEnter">
          <component :is="Component" :key="current.path" />
        </Transition>
      </RouterView>
    </main>

    <SiteFooter />
  </div>

  <div ref="curtain" class="curtain" aria-hidden="true">
    <div class="curtain-glow" />
    <p class="curtain-line curtain-caption"><span>{{ caption }}</span></p>
    <p class="curtain-line curtain-label"><span>{{ label }}</span></p>
  </div>

  <IntroLoader />
  <div class="grain" aria-hidden="true" />
</template>
