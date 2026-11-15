<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import { AFDIAN_ORDERS_URL, astroboxUrl, games } from "../data/games";
import { vMagnetic } from "../motion/directives";
import { gsap, MEDIA } from "../motion/gsap";
import { scrollToTarget } from "../motion/smooth";
import { useGsap } from "../motion/useGsap";

const root = ref<HTMLElement>();
const letters = "KOVELA".split("");

useGsap(root, () => {
  const mm = gsap.matchMedia();
  mm.add(MEDIA.motion, () => {
    gsap.from(".mark-letter", {
      yPercent: 100,
      ease: "none",
      stagger: 0.08,
      scrollTrigger: {
        trigger: ".footer-mark",
        start: "top bottom",
        end: "bottom bottom",
        scrub: 0.8,
        invalidateOnRefresh: true,
      },
    });
  });
});
</script>

<template>
  <footer ref="root" class="footer">
    <div class="shell footer-top">
      <div class="footer-lead">
        <p class="eyebrow">Kovela</p>
        <p class="footer-title">为每一份热爱，<br />认真回应。</p>
      </div>
      <nav class="footer-cols" aria-label="页脚导航">
        <div>
          <h2>站点</h2>
          <RouterLink to="/">总览</RouterLink>
          <RouterLink to="/about">关于</RouterLink>
          <a :href="AFDIAN_ORDERS_URL" target="_blank" rel="noopener noreferrer"
            >订单查询<span aria-hidden="true">↗</span></a
          >
        </div>
        <div>
          <h2>游戏</h2>
          <a
            v-for="game in games"
            :key="game.id"
            :href="astroboxUrl(game.productId)"
            target="_blank"
            rel="noopener noreferrer"
            >{{ game.name }}<span aria-hidden="true">↗</span></a
          >
        </div>
        <div>
          <h2>资源</h2>
          <a href="https://abox.run/docs" target="_blank" rel="noopener noreferrer"
            >AstroBox 文档<span aria-hidden="true">↗</span></a
          >
          <a
            href="https://qm.qq.com/q/WRPKz0HsQQ"
            target="_blank"
            rel="noopener noreferrer"
            >官方 QQ 群<span aria-hidden="true">↗</span></a
          >
        </div>
      </nav>
    </div>

    <div class="footer-mark" aria-hidden="true">
      <span v-for="(letter, index) in letters" :key="index" class="mark-cell"
        ><span class="mark-letter">{{ letter }}</span></span
      >
    </div>

    <div class="shell footer-base">
      <span>© 2026 KomoriDev · Kovela</span>
      <span>独立开发者授权服务 · 非爱发电官方产品</span>
      <button
        v-magnetic="0.3"
        type="button"
        class="to-top"
        @click="scrollToTarget(0)"
      >
        回到顶部
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.footer {
  position: relative;
  overflow: hidden;
  padding-top: clamp(80px, 10vw, 140px);
  border-top: 1px solid var(--line);
  background:
    radial-gradient(60% 50% at 50% 100%, rgba(18, 169, 214, 0.12), transparent 70%),
    #efece5;
}
.footer-top {
  display: grid;
  grid-template-columns: 1.1fr 1.4fr;
  gap: 48px;
}
.footer-title {
  margin: 0;
  font-size: clamp(28px, 3.4vw, 48px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.25;
}
.footer-cols {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}
.footer-cols div {
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 12px;
}
.footer-cols h2 {
  margin: 0 0 8px;
  color: var(--fg-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
}
.footer-cols a,
.footer-cols button {
  display: inline-flex;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fg-2);
  font-size: 15px;
  text-decoration: none;
  transition: color 0.3s;
}
.footer-cols a span {
  opacity: 0.5;
  transition: transform 0.5s var(--ease-out);
}
.footer-cols a:hover,
.footer-cols button:hover {
  color: var(--fg);
}
.footer-cols a:hover span {
  transform: translate(2px, -2px);
}
.footer-mark {
  display: flex;
  justify-content: center;
  margin-top: clamp(60px, 8vw, 110px);
  font-family: var(--font-display);
  font-size: clamp(90px, 25vw, 400px);
  letter-spacing: 0.01em;
  line-height: 0.74;
}
.mark-cell {
  display: inline-block;
  overflow: hidden;
  padding-top: 0.04em;
}
.mark-letter {
  display: inline-block;
  background: linear-gradient(180deg, #121419 0%, rgba(18, 20, 25, 0.06) 92%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.footer-base {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-block: 26px 30px;
  border-top: 1px solid var(--line);
  color: var(--fg-3);
  font-size: 12.5px;
}
.to-top {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: none;
  color: var(--fg-2);
  font-size: 12.5px;
  transition: background 0.3s, color 0.3s;
}
.to-top:hover {
  background: var(--fg);
  color: var(--paper);
}
@media (max-width: 860px) {
  .footer-top {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .footer-cols {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
