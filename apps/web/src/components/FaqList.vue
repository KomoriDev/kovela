<script setup lang="ts">
import { nextTick, ref } from "vue";
import { questions } from "../data/faq";
import { gsap, prefersReducedMotion, ScrollTrigger } from "../motion/gsap";

const open = ref<number>();
const panels = ref<HTMLElement[]>([]);

async function toggle(index: number) {
  const previous = open.value;
  open.value = previous === index ? undefined : index;
  await nextTick();
  const duration = prefersReducedMotion() ? 0 : 0.7;
  if (previous !== undefined && panels.value[previous])
    gsap.to(panels.value[previous], { height: 0, duration, ease: "expo.out" });
  if (open.value !== undefined && panels.value[open.value])
    gsap.to(panels.value[open.value], {
      height: "auto",
      duration,
      ease: "expo.out",
      onComplete: () => ScrollTrigger.refresh(),
    });
}
</script>

<template>
  <ol class="faq">
    <li
      v-for="(item, index) in questions"
      :key="item.q"
      class="faq-item"
      :class="{ 'is-open': open === index }"
    >
      <h3>
        <button
          :id="`faq-q-${index}`"
          type="button"
          :aria-expanded="open === index"
          :aria-controls="`faq-a-${index}`"
          @click="toggle(index)"
        >
          <span class="faq-index">{{ String(index + 1).padStart(2, "0") }}</span>
          <span class="faq-q">{{ item.q }}</span>
          <span class="faq-sign" aria-hidden="true" />
        </button>
      </h3>
      <div
        :id="`faq-a-${index}`"
        ref="panels"
        class="faq-panel"
        role="region"
        :aria-labelledby="`faq-q-${index}`"
        :inert="open !== index"
      >
        <p>{{ item.a }}</p>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.faq {
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
  list-style: none;
}
.faq-item {
  border-bottom: 1px solid var(--line);
}
.faq h3 {
  margin: 0;
}
.faq button {
  display: grid;
  grid-template-columns: 56px 1fr 28px;
  align-items: center;
  width: 100%;
  padding: 26px 0;
  border: 0;
  background: none;
  color: var(--fg);
  text-align: left;
}
.faq-index {
  color: var(--fg-3);
  font-family: var(--font-display);
  font-size: 15px;
  letter-spacing: 0.08em;
  transition: color 0.4s;
}
.faq-q {
  font-size: clamp(16px, 1.6vw, 20px);
  font-weight: 600;
  letter-spacing: -0.005em;
  transition: transform 0.6s var(--ease-out);
}
.faq button:hover .faq-q {
  transform: translateX(8px);
}
.is-open .faq-index,
.faq button:hover .faq-index {
  color: var(--brand-b);
}
.faq-sign {
  position: relative;
  justify-self: end;
  width: 28px;
  height: 28px;
  border: 1px solid var(--line-2);
  border-radius: 50%;
  transition:
    transform 0.6s var(--ease-out),
    background 0.3s,
    border-color 0.3s;
}
.faq-sign::before,
.faq-sign::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 1.5px;
  border-radius: 2px;
  background: currentColor;
  translate: -50% -50%;
  transition: transform 0.6s var(--ease-out);
}
.faq-sign::after {
  transform: rotate(90deg);
}
.is-open .faq-sign {
  border-color: transparent;
  background: var(--fg);
  color: var(--paper);
  transform: rotate(180deg);
}
.is-open .faq-sign::after {
  transform: rotate(0deg);
}
.faq-panel {
  height: 0;
  overflow: hidden;
}
.faq-panel p {
  max-width: 720px;
  margin: 0;
  padding: 0 0 28px 56px;
  color: var(--fg-2);
  font-size: 15px;
  line-height: 1.9;
}
@media (max-width: 640px) {
  .faq button {
    grid-template-columns: 40px 1fr 28px;
    padding: 22px 0;
  }
  .faq-panel p {
    padding-left: 40px;
  }
}
</style>
