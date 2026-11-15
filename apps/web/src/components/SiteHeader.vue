<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useScrollState } from "../composables/useScrollState";
import { vMagnetic } from "../motion/directives";
import { gsap, prefersReducedMotion } from "../motion/gsap";
import { AFDIAN_ORDERS_URL } from "../data/games";

const links = [
  { to: "/", label: "总览", caption: "Overview" },
  { to: "/about", label: "关于", caption: "About" },
];

const route = useRoute();
const nav = ref<HTMLElement>();
const indicator = ref<HTMLElement>();
const hovered = ref<string>();
const { y, direction } = useScrollState();

const scrolled = computed(() => y.value > 24);
const hidden = computed(() => y.value > 180 && direction.value > 0);
const lit = computed(() => hovered.value ?? route.path);

function linkFor(path: string) {
  return nav.value?.querySelector<HTMLElement>(`[data-path="${path}"]`);
}
function moveTo(path: string, instant = false) {
  const target = linkFor(path);
  if (!target || !indicator.value) return;
  const props = { x: target.offsetLeft, width: target.offsetWidth, opacity: 1 };
  if (instant || prefersReducedMotion()) gsap.set(indicator.value, props);
  else
    gsap.to(indicator.value, {
      ...props,
      duration: 0.7,
      ease: "expo.out",
      overwrite: true,
    });
}
function enter(path: string) {
  hovered.value = path;
  moveTo(path);
}
function settle() {
  hovered.value = undefined;
  moveTo(route.path);
}
function onResize() {
  moveTo(route.path, true);
}

watch(
  () => route.path,
  async (path) => {
    await nextTick();
    moveTo(path);
  },
);
onMounted(async () => {
  moveTo(route.path, true);
  window.addEventListener("resize", onResize);
  await document.fonts.ready;
  moveTo(route.path, true);
});
onBeforeUnmount(() => window.removeEventListener("resize", onResize));
</script>

<template>
  <header
    class="site-header"
    :class="{ 'is-scrolled': scrolled, 'is-hidden': hidden }"
  >
    <div class="bar">
      <RouterLink to="/" class="brand" aria-label="Kovela 总览">
        <img src="/brand/kovela-mark.png" alt="" width="34" height="34" />
        <span>Kovela</span>
      </RouterLink>

      <nav ref="nav" class="nav" aria-label="主导航" @pointerleave="settle">
        <span ref="indicator" class="nav-indicator" aria-hidden="true" />
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          :data-path="link.to"
          class="nav-link"
          :class="{ 'is-lit': lit === link.to }"
          @pointerenter="enter(link.to)"
          @focus="enter(link.to)"
          @blur="settle"
        >
          <span>{{ link.label }}</span>
          <small>{{ link.caption }}</small>
        </RouterLink>
      </nav>

      <div class="actions">
        <a
          v-magnetic="0.25"
          class="order-button"
          :href="AFDIAN_ORDERS_URL"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="订单查询（在爱发电打开）"
        >
          <span class="order-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v1a2.5 2.5 0 0 0 0 5v1a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-1a2.5 2.5 0 0 0 0-5v-1Z"
                stroke="currentColor"
                stroke-width="1.6"
              />
              <path
                d="M14 6v12"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-dasharray="2 3"
              />
            </svg>
          </span>
          <span class="order-text">订单查询</span>
          <svg class="order-out" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </a>
      </div>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  position: fixed;
  z-index: 50;
  inset: 0 0 auto;
  padding: 14px var(--gutter);
  pointer-events: none;
  transition: transform 0.7s var(--ease-out);
}
.site-header.is-hidden {
  transform: translateY(-120%);
}
.bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  max-width: var(--max);
  height: 60px;
  margin-inline: auto;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  pointer-events: auto;
  transition:
    background 0.5s var(--ease-out),
    border-color 0.5s var(--ease-out),
    box-shadow 0.5s var(--ease-out),
    backdrop-filter 0.5s var(--ease-out);
}
.is-scrolled .bar {
  border-color: var(--line);
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 20px 50px -30px var(--shadow);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  justify-self: start;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  color: var(--fg);
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.01em;
  text-decoration: none;
}
.brand img {
  width: 34px;
  height: 34px;
  transition: transform 0.8s var(--ease-out);
}
.brand:hover img {
  transform: rotate(-12deg) scale(1.06);
}

.nav {
  position: relative;
  display: flex;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
}
.nav-indicator {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 0;
  width: 0;
  border-radius: 999px;
  background: var(--fg);
  box-shadow:
    0 10px 24px -10px rgba(18, 20, 25, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  opacity: 0;
}
.nav-link {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 9px 20px;
  border-radius: 999px;
  color: var(--fg-2);
  font-size: 14.5px;
  font-weight: 560;
  letter-spacing: 0.02em;
  text-decoration: none;
  transition: color 0.45s var(--ease-out);
}
.nav-link small {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.55;
}
.nav-link.is-lit {
  color: var(--paper);
}
.nav-link:focus-visible {
  outline-offset: 2px;
}

.actions {
  display: flex;
  justify-content: flex-end;
}
.order-button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 18px 0 6px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.6);
  color: var(--fg);
  font-size: 14px;
  font-weight: 560;
  letter-spacing: 0.04em;
  text-decoration: none;
  transition:
    background 0.4s var(--ease-out),
    color 0.4s var(--ease-out),
    border-color 0.4s var(--ease-out);
}
.order-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--grad);
  color: #fff;
  transition: transform 0.6s var(--ease-out);
}
.order-button:hover {
  border-color: transparent;
  background: var(--fg);
  color: var(--paper);
}
.order-button:hover .order-icon {
  transform: rotate(-18deg);
}
.order-out {
  margin-left: -4px;
  opacity: 0.5;
  transition:
    transform 0.5s var(--ease-out),
    opacity 0.3s;
}
.order-button:hover .order-out {
  opacity: 1;
  transform: translate(2px, -2px);
}

@media (max-width: 720px) {
  .site-header {
    padding: 10px 12px;
  }
  .bar {
    height: 54px;
    padding: 0 6px;
  }
  .brand span,
  .nav-link small,
  .order-text,
  .order-out {
    display: none;
  }
  .brand {
    padding: 0;
  }
  .nav-link {
    padding: 8px 18px;
  }
  .order-button {
    width: 44px;
    height: 44px;
    padding: 0;
    justify-content: center;
  }
}
</style>
