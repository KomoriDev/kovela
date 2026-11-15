<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import BandDevice from "../components/BandDevice.vue";
import HeroVisual from "../components/HeroVisual.vue";
import MarqueeBand from "../components/MarqueeBand.vue";
import { AFDIAN_ORDERS_URL, astroboxUrl, games } from "../data/games";
import { vMagnetic, vSpotlight } from "../motion/directives";
import { gsap, MEDIA, prefersReducedMotion } from "../motion/gsap";
import { revealLines, revealOnScroll, tintOnScroll } from "../motion/reveal";
import { scrollToTarget } from "../motion/smooth";
import { useGsap } from "../motion/useGsap";
import { revealGate } from "../stores/ui";

const root = ref<HTMLElement>();

// Two shots per game keep the pinned gallery a comfortable length.
const reel = games.flatMap((game) =>
  game.shots.slice(0, 2).map((shot) => ({ game, shot })),
);
const stats = [
  { value: String(games.length).padStart(2, "0"), label: "款手环游戏" },
  { value: "01", label: "个订单号即可激活" },
  { value: "00", label: "激活后的网络依赖" },
];
const steps = [
  {
    title: "在 AstroBox 安装",
    text: "点击「在 AstroBox 获取」，在 AstroBox 中把游戏安装到手环。免费游戏到这一步就可以开玩了。",
  },
  {
    title: "在爱发电支持",
    text: "想解锁付费内容，就在爱发电完成支持。订单完成后，订单号会通过私信送到你手里。",
  },
  {
    title: "激活，离线畅玩",
    text: "在 AstroBox 的 Kovela 插件中用账号或订单号验证，许可证自动写入手环，之后不再需要网络。",
  },
];

function explore() {
  scrollToTarget("#games", { offset: -24 });
}

useGsap(root, (context) => {
  const el = root.value;
  if (!el) return;
  tintOnScroll(el, prefersReducedMotion());

  const mm = gsap.matchMedia();
  mm.add(MEDIA.motion, () => {
    gsap.set(".hero .line > span", { yPercent: 115 });
    gsap.set(".hero-fade", { opacity: 0, y: 34 });
    void revealGate().then(() =>
      context.add(() => {
        gsap
          .timeline()
          .to(".hero .line > span", { yPercent: 0, duration: 1.6, stagger: 0.12 })
          .to(".hero-fade", { opacity: 1, y: 0, duration: 1.4, stagger: 0.08 }, 0.35);
      }),
    );

    gsap.to(".hero-copy", {
      yPercent: -14,
      opacity: 0,
      ease: "none",
      scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true },
    });

    revealLines(el);
    revealOnScroll(el);

    gsap.utils.toArray<HTMLElement>(".chapter", el).forEach((chapter) => {
      const along = { trigger: chapter, start: "top bottom", end: "bottom top", scrub: true };
      gsap.fromTo(
        chapter.querySelector(".cover"),
        { clipPath: "inset(16% 14% 16% 14% round 48px)" },
        {
          clipPath: "inset(0% 0% 0% 0% round 28px)",
          ease: "none",
          scrollTrigger: { trigger: chapter, start: "top 90%", end: "top 20%", scrub: true },
        },
      );
      gsap.fromTo(
        chapter.querySelector(".cover img"),
        { scale: 1.32, yPercent: -7 },
        { scale: 1.06, yPercent: 7, ease: "none", scrollTrigger: along },
      );
      gsap.fromTo(
        chapter.querySelector(".chapter-word"),
        { xPercent: 12 },
        { xPercent: -30, ease: "none", scrollTrigger: along },
      );
      gsap.from(chapter.querySelector(".chapter-band"), {
        yPercent: 45,
        rotate: 10,
        ease: "none",
        scrollTrigger: { trigger: chapter, start: "top bottom", end: "center center", scrub: 1 },
      });
    });

    const bars = gsap.utils.toArray<HTMLElement>(".step-bar i", el);
    const nums = gsap.utils.toArray<HTMLElement>(".step-num", el);
    const flow = gsap.timeline({
      scrollTrigger: { trigger: ".steps", start: "top 75%", end: "bottom 55%", scrub: 0.8 },
    });
    bars.forEach((bar, index) => {
      flow
        .fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: "none", duration: 1 })
        .to(nums[index], { color: "#121419", duration: 0.3, ease: "none" }, "<0.1");
    });

    gsap.from(".finale-orb", {
      scale: 0.4,
      opacity: 0,
      ease: "none",
      scrollTrigger: { trigger: ".finale", start: "top bottom", end: "center center", scrub: true },
    });
  });

  mm.add(`${MEDIA.motion} and ${MEDIA.desktop}`, () => {
    const track = el.querySelector<HTMLElement>(".gallery-track");
    if (!track) return;
    const distance = () => track.scrollWidth - window.innerWidth;
    const slide = gsap.to(track, {
      x: () => -distance(),
      ease: "none",
      scrollTrigger: {
        trigger: ".gallery",
        start: "top top",
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });
    gsap.to(".gallery-progress i", {
      scaleX: 1,
      ease: "none",
      scrollTrigger: {
        trigger: ".gallery",
        start: "top top",
        end: () => `+=${distance()}`,
        scrub: true,
        invalidateOnRefresh: true,
      },
    });
    gsap.utils.toArray<HTMLElement>(".reel-card", el).forEach((card) => {
      gsap.fromTo(
        card.querySelector(".reel-device"),
        { rotate: -6, yPercent: 8 },
        {
          rotate: 6,
          yPercent: -8,
          ease: "none",
          scrollTrigger: {
            trigger: card,
            containerAnimation: slide,
            start: "left right",
            end: "right left",
            scrub: true,
          },
        },
      );
    });
  });
});
</script>

<template>
  <div ref="root" class="overview">
    <!-- Hero -->
    <section class="hero" data-tint="#f6f4ef">
      <HeroVisual />
      <div class="hero-copy shell">
        <p class="eyebrow hero-fade">
          <span class="eyebrow-dot" />小米 Vela 手环 · 小游戏
        </p>
        <h1 class="display hero-title">
          <span class="line"><span>方寸之间，</span></span>
          <span class="line"><span class="grad-text">自有天地。</span></span>
        </h1>
        <p class="lede hero-lede hero-fade">
          为小米 Vela 手环精心打磨的小游戏。在 AstroBox 一键安装；付费内容在爱发电支持后激活，从此离线畅玩。
        </p>
        <div class="hero-actions hero-fade">
          <a v-magnetic="0.2" class="btn btn-primary" href="#games" @click.prevent="explore">
            探索游戏
            <span class="btn-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 5v14m0 0 6-6m-6 6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </a>
          <a
            v-magnetic="0.2"
            class="btn no-icon"
            :href="AFDIAN_ORDERS_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            查询订单
          </a>
        </div>
      </div>
      <div class="hero-meta shell hero-fade">
        <dl class="stats">
          <div v-for="stat in stats" :key="stat.label">
            <dt class="latin">{{ stat.value }}</dt>
            <dd>{{ stat.label }}</dd>
          </div>
        </dl>
        <span class="scroll-cue" aria-hidden="true">Scroll<i /></span>
      </div>
    </section>

    <MarqueeBand :items="['Angry Birds', 'Billiard', 'Pāo', 'Watermelon', 'Mi-Vela']" />

    <!-- Games -->
    <section id="games" class="games-intro shell" data-tint="#f6f4ef">
      <div class="section-head">
        <div>
          <p class="section-index" data-reveal><b>01</b><i />GAMES</p>
          <h2 class="title" data-lines>
            <span class="line"><span>四款游戏，</span></span>
            <span class="line"><span>为手腕重新打磨。</span></span>
          </h2>
        </div>
        <p class="lede games-lede" data-reveal>
          从操作到画面，都按手环的方寸屏幕重新适配。抬起手腕，就是一局。
        </p>
      </div>
    </section>

    <article
      v-for="(game, index) in games"
      :key="game.id"
      class="chapter"
      :class="{ 'is-flip': index % 2 === 1 }"
      :data-tint="game.tint"
      :style="{ '--accent': game.accent, '--accent-2': game.accent2 }"
      :aria-labelledby="`game-${game.id}`"
    >
      <span class="chapter-word latin" aria-hidden="true">{{ game.word }}</span>
      <div class="shell chapter-grid">
        <div class="chapter-media">
          <figure v-spotlight class="cover">
            <img :src="game.cover" :alt="`${game.name} 封面`" width="1200" height="800" loading="lazy" />
          </figure>
          <div class="chapter-band" :data-frame="game.frame">
            <BandDevice
              :shots="game.shots"
              :frame="game.frame"
              :label="game.name"
              controls
              :style="{ '--band-glow': game.accent }"
            />
          </div>
        </div>
        <div class="chapter-copy">
          <p class="section-index" data-reveal>
            <b>{{ String(index + 1).padStart(2, "0") }}</b><i />{{ game.word }}
          </p>
          <div class="chapter-title" data-reveal>
            <img :src="game.logo" alt="" width="56" height="56" />
            <h3 :id="`game-${game.id}`">{{ game.name }}</h3>
          </div>
          <p class="chapter-tagline" data-reveal>{{ game.tagline }}</p>
          <p class="lede" data-reveal>{{ game.description }}</p>
          <ul class="facts" data-reveal>
            <li v-for="fact in game.facts" :key="fact">{{ fact }}</li>
          </ul>
          <div class="chapter-actions" data-reveal>
            <a
              v-magnetic="0.2"
              class="btn btn-primary"
              :href="astroboxUrl(game.productId)"
              target="_blank"
              rel="noopener noreferrer"
            >
              在 AstroBox 获取
              <span class="btn-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
            </a>
            <a
              v-if="game.purchase"
              v-magnetic="0.2"
              class="btn no-icon"
              :href="game.purchase.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ game.purchase.label }}
              <svg class="btn-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </a>
          </div>
          <p class="chapter-note" data-reveal>
            {{
              game.purchase
                ? "AstroBox 免费安装 · 付费内容在爱发电支持后激活"
                : "完全免费 · 在 AstroBox 一键安装到手环"
            }}
          </p>
        </div>
      </div>
    </article>

    <!-- Gallery -->
    <section class="gallery" data-tint="#f6f4ef" aria-labelledby="gallery-title">
      <div class="gallery-track">
        <div class="reel-intro">
          <p class="section-index"><b>02</b><i />ON THE WRIST</p>
          <h2 id="gallery-title" class="title">实机画面</h2>
          <p class="lede">真实手环截屏。横屏拉弓，竖屏合成，每一帧都跑在你的手腕上。</p>
          <span class="gallery-progress" aria-hidden="true"><i /></span>
        </div>
        <figure
          v-for="(item, index) in reel"
          :key="item.shot.src"
          class="reel-card"
          :data-frame="item.game.frame"
          :style="{ '--accent': item.game.accent }"
        >
          <div class="reel-device">
            <BandDevice
              :shots="[item.shot]"
              :frame="item.game.frame"
              :label="item.game.name"
              :autoplay="false"
              :style="{ '--band-glow': item.game.accent }"
            />
          </div>
          <figcaption>
            <span class="latin">{{ String(index + 1).padStart(2, "0") }}</span>
            <strong>{{ item.game.name }}</strong>
            <em>{{ item.shot.caption }}</em>
          </figcaption>
        </figure>
      </div>
    </section>

    <!-- Flow -->
    <section class="flow shell" data-tint="#f6f4ef" aria-labelledby="flow-title">
      <div class="section-head">
        <div>
          <p class="section-index" data-reveal><b>03</b><i />HOW IT WORKS</p>
          <h2 id="flow-title" class="title" data-lines>
            <span class="line"><span>三步，</span></span>
            <span class="line"><span>从支持到开玩。</span></span>
          </h2>
        </div>
        <RouterLink to="/about" class="flow-more" data-reveal>
          了解激活原理
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12h13m0 0-5-5m5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </RouterLink>
      </div>
      <ol class="steps">
        <li v-for="(step, index) in steps" :key="step.title" class="step" data-reveal>
          <span class="step-bar" aria-hidden="true"><i /></span>
          <span class="step-num latin">{{ String(index + 1).padStart(2, "0") }}</span>
          <h3>{{ step.title }}</h3>
          <p>{{ step.text }}</p>
        </li>
      </ol>
    </section>

    <!-- Finale -->
    <section class="finale" data-tint="#f6f4ef">
      <span class="finale-orb" aria-hidden="true" />
      <div class="shell finale-inner">
        <p class="eyebrow" data-reveal><span class="eyebrow-dot" />Already a supporter</p>
        <h2 class="display finale-title" data-lines>
          <span class="line"><span>已经支持过了？</span></span>
          <span class="line"><span class="grad-text">查一查你的订单。</span></span>
        </h2>
        <div class="finale-actions" data-reveal>
          <a
            v-magnetic="0.25"
            class="btn btn-primary"
            :href="AFDIAN_ORDERS_URL"
            target="_blank"
            rel="noopener noreferrer"
          >
            在爱发电查看订单
            <span class="btn-icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
          </a>
          <RouterLink v-magnetic="0.2" to="/about" class="btn no-icon">关于 Kovela</RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ---------- hero ---------- */

.hero {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 100svh;
  padding: 140px 0 40px;
  overflow: hidden;
}
.hero-copy {
  position: relative;
  z-index: 2;
  display: grid;
  justify-items: start;
  gap: 28px;
  margin-bottom: clamp(48px, 9vh, 110px);
}
.hero-title {
  max-width: 9.5em;
}
.hero-lede {
  max-width: 30em;
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
}
.hero-meta {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding-top: 26px;
  border-top: 1px solid var(--line);
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: clamp(24px, 5vw, 72px);
  margin: 0;
}
.stats div {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.stats dt {
  font-size: clamp(30px, 3.2vw, 44px);
  line-height: 1;
}
.stats dd {
  margin: 0;
  color: var(--fg-3);
  font-size: 13px;
  letter-spacing: 0.04em;
}
.scroll-cue {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--fg-3);
  font-size: 11px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
}
.scroll-cue i {
  position: relative;
  width: 1px;
  height: 46px;
  overflow: hidden;
  background: var(--line-2);
}
.scroll-cue i::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--fg);
  animation: cue 2.2s var(--ease-out) infinite;
}
@keyframes cue {
  0% {
    transform: translateY(-100%);
  }
  60%,
  100% {
    transform: translateY(100%);
  }
}

/* ---------- games ---------- */

.games-intro {
  padding-top: clamp(110px, 14vw, 200px);
}
.games-lede {
  max-width: 340px;
}

.chapter {
  position: relative;
  padding-block: clamp(70px, 9vw, 140px);
  overflow: hidden;
}
.chapter-word {
  position: absolute;
  z-index: 0;
  top: 50%;
  left: 0;
  color: transparent;
  font-size: clamp(120px, 22vw, 380px);
  line-height: 1;
  white-space: nowrap;
  translate: 0 -50%;
  -webkit-text-stroke: 1px color-mix(in srgb, var(--accent) 40%, transparent);
  opacity: 0.55;
  pointer-events: none;
}
.chapter-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  align-items: center;
  gap: clamp(48px, 7vw, 120px);
}
.is-flip .chapter-media {
  order: 2;
}
.chapter-media {
  position: relative;
  padding-bottom: 12%;
}
.cover {
  position: relative;
  margin: 0;
  overflow: hidden;
  aspect-ratio: 3 / 2;
  border-radius: 28px;
  box-shadow: 0 50px 100px -50px rgba(28, 38, 58, 0.45);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  will-change: transform;
}
.cover::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      380px circle at var(--mx, 50%) var(--my, 50%),
      rgba(255, 255, 255, 0.18),
      transparent 60%
    ),
    linear-gradient(180deg, transparent 55%, rgba(0, 0, 0, 0.35));
  opacity: 0;
  transition: opacity 0.6s var(--ease-out);
  pointer-events: none;
}
.cover:hover::after {
  opacity: 1;
}
.chapter-band {
  position: absolute;
  z-index: 2;
  right: -4%;
  bottom: -6%;
}
.chapter-band[data-frame="land"] :deep(.band) {
  --band-w: min(30vw, 400px);
}
.chapter-band[data-frame="port"] {
  right: auto;
  left: -6%;
  bottom: -16%;
}
.chapter-band[data-frame="port"] :deep(.band) {
  --band-w: min(12vw, 170px);
}
.chapter-copy {
  display: grid;
  justify-items: start;
  gap: 22px;
}
.chapter-copy .section-index {
  margin: 0;
}
.chapter-title {
  display: flex;
  align-items: center;
  gap: 18px;
}
.chapter-title img {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  box-shadow: 0 16px 40px -14px var(--accent);
}
.chapter-title h3 {
  margin: 0;
  font-size: clamp(34px, 4.4vw, 60px);
  font-weight: 800;
  letter-spacing: -0.04em;
}
.chapter-tagline {
  margin: 0;
  background: linear-gradient(100deg, var(--accent), var(--accent-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-size: clamp(19px, 1.8vw, 24px);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.chapter .lede {
  max-width: 30em;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.facts li {
  padding: 8px 15px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--fg);
  font-size: 13px;
  font-weight: 560;
}
.chapter-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.chapter-actions .btn.no-icon {
  gap: 10px;
  background: rgba(255, 255, 255, 0.55);
}
.chapter-actions .btn.no-icon::before {
  background: linear-gradient(100deg, var(--accent), var(--accent-2));
}
.chapter-actions .btn.no-icon:hover {
  color: #fff;
}
.btn-arrow {
  transition: transform 0.5s var(--ease-out);
}
.btn:hover .btn-arrow {
  transform: translate(2px, -2px);
}
.chapter-note {
  margin: -6px 0 0;
  color: var(--fg-3);
  font-size: 12.5px;
  letter-spacing: 0.02em;
}
@media (max-width: 520px) {
  .chapter-actions {
    gap: 8px;
  }
  .chapter-actions .btn {
    gap: 8px;
    height: 50px;
    padding-left: 18px;
    font-size: 13.5px;
    letter-spacing: 0.02em;
  }
  .chapter-actions .btn-primary {
    padding-right: 5px;
  }
  .chapter-actions .btn.no-icon {
    padding-right: 18px;
  }
  .chapter-actions .btn-icon {
    width: 38px;
    height: 38px;
  }
}
.chapter .btn-primary::before {
  background: linear-gradient(100deg, var(--accent), var(--accent-2));
}
.chapter .btn-primary:hover {
  color: #fff;
}

/* ---------- gallery ---------- */

.gallery {
  position: relative;
  overflow: hidden;
  border-block: 1px solid var(--line);
}
.gallery-track {
  display: flex;
  align-items: center;
  gap: clamp(40px, 6vw, 100px);
  width: max-content;
  min-height: 100svh;
  padding: 120px var(--gutter);
  will-change: transform;
}
.reel-intro {
  display: grid;
  gap: 22px;
  width: min(420px, 80vw);
}
.reel-intro .section-index {
  margin: 0;
}
.gallery-progress {
  display: block;
  width: 100%;
  height: 2px;
  margin-top: 12px;
  background: var(--line);
}
.gallery-progress i {
  display: block;
  height: 100%;
  background: var(--grad);
  transform: scaleX(0);
  transform-origin: left;
}
.reel-card {
  display: grid;
  justify-items: center;
  gap: 40px;
  margin: 0;
}
.reel-card[data-frame="land"] :deep(.band) {
  --band-w: min(40vw, 540px);
}
.reel-card[data-frame="port"] :deep(.band) {
  --band-w: min(16vw, 220px);
}
.reel-card figcaption {
  display: flex;
  align-items: baseline;
  gap: 14px;
  color: var(--fg-3);
  font-size: 13px;
}
.reel-card figcaption .latin {
  color: var(--accent);
  font-size: 18px;
}
.reel-card strong {
  color: var(--fg);
  font-size: 15px;
  font-weight: 650;
}
.reel-card em {
  font-style: normal;
}

/* ---------- flow ---------- */

.flow {
  padding-block: clamp(110px, 14vw, 200px);
}
.flow-more {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line-2);
  color: var(--fg-2);
  font-size: 14px;
  text-decoration: none;
  transition:
    color 0.3s,
    border-color 0.3s;
}
.flow-more:hover {
  border-color: var(--fg);
  color: var(--fg);
}
.flow-more svg {
  transition: transform 0.5s var(--ease-out);
}
.flow-more:hover svg {
  transform: translateX(4px);
}
.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(28px, 4vw, 56px);
  margin: 0;
  padding: 0;
  list-style: none;
}
.step {
  display: grid;
  align-content: start;
  gap: 16px;
}
.step-bar {
  display: block;
  height: 2px;
  margin-bottom: 18px;
  background: var(--line);
}
.step-bar i {
  display: block;
  height: 100%;
  background: var(--grad);
  transform-origin: left;
}
.step-num {
  color: var(--fg-3);
  font-size: clamp(64px, 7vw, 108px);
  line-height: 0.9;
}
.step h3 {
  margin: 8px 0 0;
  font-size: clamp(20px, 1.8vw, 26px);
  font-weight: 700;
  letter-spacing: -0.02em;
}
.step p {
  margin: 0;
  color: var(--fg-2);
  font-size: 15px;
  line-height: 1.85;
}

/* ---------- finale ---------- */

.finale {
  position: relative;
  display: grid;
  min-height: 90svh;
  place-items: center;
  overflow: hidden;
  padding-block: 120px;
  text-align: center;
}
.finale-orb {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(90vw, 900px);
  aspect-ratio: 1;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 50%, rgba(18, 169, 214, 0.22), transparent 62%),
    radial-gradient(circle at 30% 70%, rgba(22, 184, 136, 0.16), transparent 50%);
  filter: blur(30px);
  translate: -50% -50%;
}
.finale-inner {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 30px;
}
.finale-title {
  font-size: clamp(42px, 7.4vw, 112px);
}
.finale-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}

/* ---------- responsive ---------- */

@media (max-width: 899px) {
  .hero {
    justify-content: flex-start;
    padding-top: calc(6.5rem + min(76vw, 440px));
  }
  .hero-copy {
    gap: 22px;
    margin-bottom: 48px;
  }
  .hero-meta {
    flex-direction: column;
    align-items: flex-start;
  }
  .scroll-cue {
    display: none;
  }
  .chapter-grid {
    grid-template-columns: 1fr;
  }
  .is-flip .chapter-media {
    order: 0;
  }
  .chapter-media {
    padding-bottom: 18%;
  }
  .chapter-band[data-frame="land"] :deep(.band) {
    --band-w: 62vw;
  }
  .chapter-band[data-frame="port"] :deep(.band) {
    --band-w: 26vw;
  }
  .chapter-band[data-frame="port"],
  .is-flip .chapter-band[data-frame="port"] {
    right: 4%;
    left: auto;
    bottom: -14%;
  }
  .gallery-track {
    width: auto;
    min-height: 0;
    padding-block: 90px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }
  .gallery-track::-webkit-scrollbar {
    display: none;
  }
  .reel-intro,
  .reel-card {
    flex: none;
    scroll-snap-align: center;
  }
  .reel-card[data-frame="land"] :deep(.band) {
    --band-w: 78vw;
  }
  .reel-card[data-frame="port"] :deep(.band) {
    --band-w: 38vw;
  }
  .gallery-progress {
    display: none;
  }
  .steps {
    grid-template-columns: 1fr;
  }
}
</style>
