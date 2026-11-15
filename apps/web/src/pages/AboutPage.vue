<script setup lang="ts">
import { ref } from "vue";
import FaqList from "../components/FaqList.vue";
import { vMagnetic, vSpotlight } from "../motion/directives";
import { gsap, MEDIA, prefersReducedMotion, ScrollTrigger } from "../motion/gsap";
import { revealLines, revealOnScroll, tintOnScroll } from "../motion/reveal";
import { useGsap } from "../motion/useGsap";
import { AFDIAN_ORDERS_URL } from "../data/games";
import { revealGate } from "../stores/ui";

const root = ref<HTMLElement>();
const statement =
  "Kovela 是为小米 Vela 应用打造的授权服务。" +
  "它核验你在爱发电的订单，为你的手环签发一份专属许可证——只属于这一块手环，" +
  "保存之后，便不再依赖手机与网络。";

const principles = [
  {
    key: "One order",
    title: "一个订单号",
    text: "不需要冗长的授权码。在 AstroBox 中输入订单号，或直接使用已绑定爱发电的 AstroBox 账号，剩下的交给插件。",
    icon: "M4 8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5v1a2.5 2.5 0 0 0 0 5v1a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 15.5v-1a2.5 2.5 0 0 0 0-5v-1Z",
  },
  {
    key: "Bound",
    title: "设备绑定",
    text: "每个应用的授权只绑定一台手环。同一台设备可以随时重复激活、重新传输许可证。",
    icon: "M8 3h8l1 4H7l1-4Zm-1 18h10l-1-4H8l-1 4ZM6 7h12v10H6z",
  },
  {
    key: "Offline",
    title: "离线可用",
    text: "许可证保存在手环本地。激活完成后，不需要手机，也不需要网络。",
    icon: "M2 9a16 16 0 0 1 20 0M5.5 12.5a11 11 0 0 1 13 0M9 16a5.5 5.5 0 0 1 6 0M12 19.5h.01M3 3l18 18",
  },
  {
    key: "Private",
    title: "不碰密码",
    text: "全程不需要爱发电密码或支付密码。查询订单只需订单号——也请不要公开它。",
    icon: "M5 10.5h14v10H5zM8 10.5V8a4 4 0 0 1 8 0v2.5",
  },
];

const chain = [
  {
    title: "核验订单",
    text: "插件把订单号交给 Kovela 服务端，服务端向爱发电核实订单已完成，且商品与应用一一对应。",
  },
  {
    title: "绑定设备",
    text: "插件读取所选手环的设备标识。服务端把订单中的应用与这台手环原子绑定：同一设备可重复激活，不同设备会被拒绝。",
  },
  {
    title: "签发许可证",
    text: "服务端用 Ed25519 私钥为这台手环签发许可证令牌，私钥从不离开服务端。",
  },
  {
    title: "写入手环",
    text: "AstroBox 通过蓝牙把令牌写入手环；手环确认令牌属于本机后保存，并回执激活结果。",
  },
];

const links = [
  {
    eyebrow: "Docs",
    title: "AstroBox 文档",
    text: "安装 AstroBox、连接手环、管理插件。",
    href: "https://abox.run/docs",
  },
  {
    eyebrow: "Community",
    title: "官方 QQ 群",
    text: "交流游戏、反馈问题、获取激活帮助。",
    href: "https://qm.qq.com/q/WRPKz0HsQQ",
  },
];

useGsap(root, (context) => {
  const el = root.value;
  if (!el) return;
  tintOnScroll(el, prefersReducedMotion());

  const mm = gsap.matchMedia();
  mm.add(MEDIA.motion, () => {
    gsap.set(".about-hero .line > span", { yPercent: 115 });
    gsap.set(".about-fade", { opacity: 0, y: 34 });
    gsap.set(".about-mark", { opacity: 0, scale: 0.6, rotate: -30 });
    void revealGate().then(() =>
      context.add(() => {
        gsap
          .timeline()
          .to(".about-hero .line > span", { yPercent: 0, duration: 1.6, stagger: 0.12 })
          .to(".about-fade", { opacity: 1, y: 0, duration: 1.4, stagger: 0.08 }, 0.35)
          .to(".about-mark", { opacity: 1, scale: 1, rotate: 0, duration: 2 }, 0.1);
      }),
    );
    gsap.to(".about-mark-wrap", {
      yPercent: 30,
      ease: "none",
      scrollTrigger: { trigger: ".about-hero", start: "top top", end: "bottom top", scrub: true },
    });

    revealLines(el);
    revealOnScroll(el);

    // Characters are plain inline spans so CJK line-breaking rules still apply.
    gsap.fromTo(
      ".statement-text .ch",
      { opacity: 0.14 },
      {
        opacity: 1,
        ease: "none",
        stagger: 0.02,
        scrollTrigger: {
          trigger: ".statement-text",
          start: "top 78%",
          end: "bottom 42%",
          scrub: true,
        },
      },
    );

    gsap.fromTo(
      ".chain-progress i",
      { scaleY: 0 },
      {
        scaleY: 1,
        ease: "none",
        scrollTrigger: { trigger: ".chain-list", start: "top 60%", end: "bottom 60%", scrub: true },
      },
    );
  });

  gsap.utils.toArray<HTMLElement>(".chain-item", el).forEach((item) => {
    ScrollTrigger.create({
      trigger: item,
      start: "top 62%",
      end: "bottom 62%",
      toggleClass: "is-active",
    });
  });
});
</script>

<template>
  <div ref="root" class="about">
    <!-- Hero -->
    <section class="about-hero" data-tint="#f6f4ef">
      <div class="about-glow" aria-hidden="true" />
      <div class="about-mark-wrap" aria-hidden="true">
        <svg class="about-orbit" viewBox="-200 -200 400 400" fill="none">
          <ellipse rx="190" ry="64" transform="rotate(-18)" stroke="rgba(47,125,255,0.35)" />
          <ellipse rx="160" ry="160" stroke="rgba(18,20,25,0.12)" stroke-dasharray="2 7" />
        </svg>
        <img class="about-mark" src="/brand/kovela-mark.png" alt="" width="260" height="260" />
      </div>
      <div class="shell about-hero-inner">
        <p class="eyebrow about-fade"><span class="eyebrow-dot" />About · 关于 Kovela</p>
        <h1 class="display">
          <span class="line"><span>认真回应</span></span>
          <span class="line"><span class="grad-text">每一份支持。</span></span>
        </h1>
        <p class="lede about-lede about-fade">
          Kovela 连接爱发电与 AstroBox：你的每一次支持，都会变成手腕上一份完整、离线、只属于你的游戏体验。
        </p>
      </div>
    </section>

    <!-- Statement -->
    <section class="statement shell" data-tint="#f6f4ef" aria-label="Kovela 是什么">
      <p class="section-index" data-reveal><b>01</b><i />WHAT IT IS</p>
      <p class="statement-text" :aria-label="statement">
        <span v-for="(char, index) in statement" :key="index" class="ch" aria-hidden="true">{{ char }}</span>
      </p>
    </section>

    <!-- Principles -->
    <section class="principles shell" data-tint="#f6f4ef" aria-labelledby="principles-title">
      <div class="section-head">
        <div>
          <p class="section-index" data-reveal><b>02</b><i />PRINCIPLES</p>
          <h2 id="principles-title" class="title" data-lines>
            <span class="line"><span>轻一点，</span></span>
            <span class="line"><span>也稳一点。</span></span>
          </h2>
        </div>
        <p class="lede principles-lede" data-reveal>
          授权应该安静地待在幕后。我们只做必要的事，其余时间，把手腕还给游戏。
        </p>
      </div>
      <ul class="cards">
        <li
          v-for="(item, index) in principles"
          :key="item.title"
          v-spotlight
          class="card"
          data-reveal
        >
          <div class="card-top">
            <span class="card-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path :d="item.icon" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span class="card-key">{{ String(index + 1).padStart(2, "0") }} · {{ item.key }}</span>
          </div>
          <h3>{{ item.title }}</h3>
          <p>{{ item.text }}</p>
        </li>
      </ul>
    </section>

    <!-- Chain -->
    <section class="chain" data-tint="#eaf0f7" aria-labelledby="chain-title">
      <div class="shell chain-grid">
        <div class="chain-aside">
          <div class="chain-sticky">
            <p class="section-index" data-reveal><b>03</b><i />UNDER THE HOOD</p>
            <h2 id="chain-title" class="title" data-lines>
              <span class="line"><span>一次激活，</span></span>
              <span class="line"><span>四个环节。</span></span>
            </h2>
            <p class="lede" data-reveal>
              从你按下「激活」到手环保存许可证，通常只需要几秒。这是它背后发生的事。
            </p>
          </div>
        </div>
        <div class="chain-list">
          <span class="chain-progress" aria-hidden="true"><i /></span>
          <ol>
            <li v-for="(item, index) in chain" :key="item.title" class="chain-item">
              <span class="chain-num latin">{{ String(index + 1).padStart(2, "0") }}</span>
              <div>
                <h3>{{ item.title }}</h3>
                <p>{{ item.text }}</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>

    <!-- FAQ -->
    <section class="faq-section shell" data-tint="#f6f4ef" aria-labelledby="faq-title">
      <div class="faq-grid">
        <div>
          <p class="section-index" data-reveal><b>04</b><i />GOOD TO KNOW</p>
          <h2 id="faq-title" class="title" data-lines>
            <span class="line"><span>常见问题</span></span>
          </h2>
        </div>
        <div data-reveal>
          <FaqList />
        </div>
      </div>
    </section>

    <!-- Links -->
    <section class="links shell" data-tint="#f6f4ef" aria-label="更多资源">
      <a
        v-for="link in links"
        :key="link.href"
        v-spotlight
        class="link-card"
        :href="link.href"
        target="_blank"
        rel="noopener noreferrer"
        data-reveal
      >
        <span class="link-eyebrow">{{ link.eyebrow }}</span>
        <strong>{{ link.title }}</strong>
        <span class="link-text">{{ link.text }}</span>
        <span class="link-arrow" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </a>
      <a
        v-spotlight
        class="link-card is-accent"
        :href="AFDIAN_ORDERS_URL"
        target="_blank"
        rel="noopener noreferrer"
        data-reveal
      >
        <span class="link-eyebrow">Order</span>
        <strong>订单查询</strong>
        <span class="link-text">在爱发电查看你的订单与订单号。</span>
        <span v-magnetic="0.3" class="link-arrow" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M7 17 17 7M9 7h8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </a>
    </section>
  </div>
</template>

<style scoped>
/* ---------- hero ---------- */

.about-hero {
  position: relative;
  display: flex;
  align-items: flex-end;
  min-height: 92svh;
  padding: 150px 0 clamp(60px, 10vh, 120px);
  overflow: hidden;
}
.about-glow {
  position: absolute;
  top: -20%;
  right: -10%;
  width: 70vw;
  height: 70vw;
  border-radius: 50%;
  background:
    radial-gradient(circle at 40% 40%, rgba(47, 125, 255, 0.2), transparent 60%),
    radial-gradient(circle at 70% 60%, rgba(22, 184, 136, 0.14), transparent 55%);
  filter: blur(60px);
  pointer-events: none;
}
.about-mark-wrap {
  position: absolute;
  top: 50%;
  right: max(var(--gutter), calc(50% - 600px));
  display: grid;
  place-items: center;
  width: min(36vw, 460px);
  aspect-ratio: 1;
  translate: 0 -55%;
}
.about-orbit {
  position: absolute;
  inset: -10%;
  overflow: visible;
  animation: orbit 40s linear infinite;
}
@keyframes orbit {
  to {
    transform: rotate(360deg);
  }
}
.about-mark {
  position: relative;
  width: 58%;
  height: auto;
  filter: drop-shadow(0 40px 80px rgba(47, 125, 255, 0.45));
  animation: bob 6s ease-in-out infinite;
}
@keyframes bob {
  50% {
    translate: 0 -14px;
  }
}
.about-hero-inner {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: start;
  gap: 28px;
}
.about-lede {
  max-width: 30em;
}

/* ---------- statement ---------- */

.statement {
  padding-block: clamp(100px, 14vw, 200px);
}
.statement-text {
  max-width: 22em;
  margin: 0;
  font-size: clamp(28px, 4.2vw, 62px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.38;
}

/* ---------- principles ---------- */

.principles {
  padding-bottom: clamp(100px, 14vw, 180px);
}
.principles-lede {
  max-width: 340px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.card {
  position: relative;
  display: grid;
  align-content: start;
  gap: 14px;
  min-height: 280px;
  padding: clamp(26px, 3vw, 40px);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 30px 60px -48px var(--shadow);
  isolation: isolate;
  transition:
    border-color 0.5s var(--ease-out),
    transform 0.6s var(--ease-out);
}
.card::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0;
  background: radial-gradient(
    420px circle at var(--mx, 50%) var(--my, 0%),
    rgba(55, 214, 240, 0.14),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.5s var(--ease-out);
}
.card:hover {
  border-color: var(--line-2);
}
.card:hover::before {
  opacity: 1;
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: auto;
  padding-bottom: 48px;
}
.card-icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border: 1px solid var(--line-2);
  border-radius: 16px;
  color: var(--brand-b);
}
.card-key {
  color: var(--fg-3);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.card h3 {
  margin: 0;
  font-size: clamp(22px, 2.2vw, 30px);
  font-weight: 750;
  letter-spacing: -0.025em;
}
.card p {
  max-width: 28em;
  margin: 0;
  color: var(--fg-2);
  font-size: 15px;
  line-height: 1.85;
}

/* ---------- chain ---------- */

.chain {
  padding-block: clamp(100px, 14vw, 180px);
  border-block: 1px solid var(--line);
}
.chain-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: clamp(48px, 8vw, 140px);
}
.chain-sticky {
  position: sticky;
  top: 140px;
  display: grid;
  gap: 24px;
}
.chain-sticky .section-index {
  margin: 0;
}
.chain-list {
  position: relative;
  padding-left: 40px;
}
.chain-list ol {
  margin: 0;
  padding: 0;
  list-style: none;
}
.chain-progress {
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 0;
  width: 1px;
  background: var(--line-2);
}
.chain-progress i {
  position: absolute;
  inset: 0;
  background: var(--grad);
  transform-origin: top;
}
.chain-item {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 20px;
  min-height: 34svh;
  padding-block: 10px 60px;
  opacity: 0.32;
  transition: opacity 0.7s var(--ease-out);
}
.chain-item.is-active {
  opacity: 1;
}
.chain-num {
  color: var(--fg-3);
  font-size: 56px;
  line-height: 0.9;
  transition: color 0.7s var(--ease-out);
}
.chain-item.is-active .chain-num {
  color: var(--brand-b);
}
.chain-item h3 {
  margin: 4px 0 14px;
  font-size: clamp(24px, 2.4vw, 34px);
  font-weight: 750;
  letter-spacing: -0.025em;
}
.chain-item p {
  margin: 0;
  color: var(--fg-2);
  font-size: 15.5px;
  line-height: 1.9;
}

/* ---------- faq ---------- */

.faq-section {
  padding-block: clamp(100px, 14vw, 180px);
}
.faq-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.5fr);
  gap: clamp(40px, 6vw, 100px);
}

/* ---------- links ---------- */

.links {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  padding-bottom: clamp(100px, 14vw, 180px);
}
.link-card {
  position: relative;
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 10px;
  min-height: 220px;
  padding: 30px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 30px 60px -48px var(--shadow);
  color: var(--fg);
  font: inherit;
  text-align: left;
  text-decoration: none;
  isolation: isolate;
  transition:
    border-color 0.5s var(--ease-out),
    background 0.5s var(--ease-out);
}
.link-card::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0;
  background: radial-gradient(
    320px circle at var(--mx, 50%) var(--my, 0%),
    rgba(47, 125, 255, 0.08),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.5s;
}
.link-card:hover {
  border-color: var(--line-2);
}
.link-card:hover::before {
  opacity: 1;
}
.link-card.is-accent {
  border-color: transparent;
  background:
    linear-gradient(140deg, rgba(47, 125, 255, 0.16), rgba(22, 184, 136, 0.1)),
    rgba(255, 255, 255, 0.7);
}
.link-eyebrow {
  color: var(--fg-3);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
}
.link-card strong {
  margin-top: auto;
  padding-top: 40px;
  font-size: 24px;
  font-weight: 750;
  letter-spacing: -0.02em;
}
.link-text {
  color: var(--fg-2);
  font-size: 14px;
}
.link-arrow {
  position: absolute;
  top: 24px;
  right: 24px;
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border: 1px solid var(--line-2);
  border-radius: 50%;
  transition:
    background 0.4s,
    color 0.4s,
    border-color 0.4s;
}
.link-card:hover .link-arrow {
  border-color: transparent;
  background: var(--fg);
  color: var(--paper);
}

/* ---------- responsive ---------- */

@media (max-width: 899px) {
  .about-hero {
    align-items: flex-start;
    padding-top: calc(7rem + min(64vw, 360px));
  }
  .about-mark-wrap {
    top: 6rem;
    right: 50%;
    width: min(64vw, 360px);
    translate: 50% 0;
  }
  .cards,
  .links {
    grid-template-columns: 1fr;
  }
  .card {
    min-height: 0;
  }
  .chain-grid,
  .faq-grid {
    grid-template-columns: 1fr;
  }
  .chain-sticky {
    position: static;
  }
  .chain-item {
    grid-template-columns: 1fr;
    gap: 8px;
    min-height: 0;
    padding-bottom: 44px;
  }
  .chain-num {
    font-size: 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .about-orbit,
  .about-mark {
    animation: none;
  }
}
</style>
