import { games, type Game } from "../data/games";
import {
  embedded,
  enableHeightReports,
  openResource,
  resourceHref,
  startBridge,
  themeSettled,
} from "./bridge";
// Inlined into the bundle rather than linked, so no render-blocking stylesheet
// request delays the boot skeleton painted from index.html.
import css from "./style.css?inline";

// Listen for the App's config before doing anything else; it may already be retrying.
startBridge();
document.head.append(Object.assign(document.createElement("style"), { textContent: css }));

const AUTOPLAY_MS = 5200;
const IDLE_RESUME_MS = 9000;
/** Longest wait for the App's theme before revealing anyway. */
const THEME_WAIT_MS = 600;
/** Longest the skeleton waits for the first covers before handing over. */
const COVER_WAIT_MS = 1200;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- tiny DOM helper (textContent only, no HTML injection) ---------- */

type Attrs = Record<string, string | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) el.setAttribute(key, value);
  }
  for (const child of children) if (child !== null) el.append(child);
  return el;
}
function svg(markup: string): Node {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstChild as Node;
}
const ARROW = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13m0 0-5-5m5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- markup ---------- */

function hero(): HTMLElement {
  const stats: [string, string][] = [
    [String(games.length).padStart(2, "0"), "款手环游戏"],
    ["01", "个订单号激活"],
    ["00", "激活后网络依赖"],
  ];
  return h(
    "header",
    { class: "hero" },
    h(
      "div",
      { class: "brand reveal", style: "--d: 0" },
      h("img", { src: "/astrobox/mark.webp", alt: "", width: "36", height: "36" }),
      h("span", { class: "brand-name" }, "Kovela"),
      h("span", { class: "brand-tag" }, h("i", { "aria-hidden": "true" }), "MI-VELA GAMES"),
    ),
    h(
      "h1",
      { class: "title" },
      h("span", { class: "line reveal", style: "--d: 1" }, "方寸之间，"),
      h("span", { class: "line grad reveal", style: "--d: 2" }, "自有天地。"),
    ),
    h(
      "p",
      { class: "lede reveal", style: "--d: 3" },
      "为小米 Vela 手环打磨的小游戏。轻点卡片，即可在 AstroBox 中安装。",
    ),
    h(
      "dl",
      { class: "stats reveal", style: "--d: 4" },
      ...stats.map(([value, label]) => h("div", {}, h("dt", {}, value), h("dd", {}, label))),
    ),
  );
}

function tabs(): HTMLElement {
  return h(
    "div",
    { class: "tabs reveal", style: "--d: 5", role: "tablist", "aria-label": "游戏" },
    h("span", { class: "tab-pill", "aria-hidden": "true" }, h("i")),
    ...games.map((game, index) =>
      h(
        "button",
        {
          type: "button",
          class: "tab",
          role: "tab",
          "data-index": String(index),
          "aria-controls": `card-${game.id}`,
          "aria-selected": index === 0 ? "true" : "false",
        },
        game.name,
      ),
    ),
  );
}

function card(game: Game, index: number): HTMLElement {
  return h(
    "a",
    {
      id: `card-${game.id}`,
      class: "card",
      href: resourceHref(game.productId),
      "data-index": String(index),
      "data-name": game.name,
      style: `--accent: ${game.accent}; --accent-2: ${game.accent2}`,
      "aria-label": `在 AstroBox 中打开${game.name}`,
    },
    h(
      "div",
      { class: "art" },
      // All four covers are small (16–61 KB) and a lazy image inside a sideways
      // scroller in an iframe may never be fetched, so load them all eagerly.
      h("img", {
        src: `/astrobox/covers/${game.id}.webp`,
        alt: "",
        width: "720",
        height: "480",
        decoding: "async",
        fetchpriority: index === 0 ? "high" : undefined,
      }),
      h("span", { class: "badge" }, game.pricing),
      h("span", { class: "shine", "aria-hidden": "true" }),
    ),
    h(
      "div",
      { class: "meta" },
      h(
        "span",
        { class: "logo-wrap" },
        h("img", {
          class: "logo",
          src: `/astrobox/logos/${game.id}.webp`,
          alt: "",
          width: "48",
          height: "48",
          decoding: "async",
        }),
      ),
      h(
        "div",
        { class: "meta-text" },
        h("h2", {}, game.name),
        h("p", {}, game.tagline),
      ),
    ),
    h("ul", { class: "facts" }, ...game.facts.slice(0, 3).map((fact) => h("li", {}, fact))),
    h("span", { class: "cta" }, "在 AstroBox 中打开", h("span", { class: "cta-icon" }, svg(ARROW))),
  );
}

function footer(): HTMLElement {
  return h(
    "footer",
    { class: "foot reveal", style: "--d: 7" },
    h("p", {}, "付费内容在爱发电支持后，经 AstroBox 的 Kovela 插件激活，之后离线可玩。"),
    h("p", { class: "foot-site" }, "kovela.komoridevs.icu"),
  );
}

/* ---------- carousel ---------- */

function mountCarousel(rail: HTMLElement, tabList: HTMLElement) {
  const cards = Array.from(rail.querySelectorAll<HTMLElement>(".card"));
  const tabButtons = Array.from(tabList.querySelectorAll<HTMLButtonElement>(".tab"));
  const pill = tabList.querySelector<HTMLElement>(".tab-pill")!;
  let active = 0;
  let timer = 0;
  let idleTimer = 0;
  let onScreen = true;
  let userPaused = false;

  function movePill() {
    const tab = tabButtons[active];
    pill.style.width = `${tab.offsetWidth}px`;
    pill.style.transform = `translateX(${tab.offsetLeft}px)`;
    // Keep the active chip visible when the tab strip itself scrolls.
    const left = tab.offsetLeft - (tabList.clientWidth - tab.offsetWidth) / 2;
    tabList.scrollTo({ left, behavior: reducedMotion ? "auto" : "smooth" });
  }

  function updateTabEdges() {
    const max = tabList.scrollWidth - tabList.clientWidth;
    tabList.classList.toggle("has-more-start", tabList.scrollLeft > 2);
    tabList.classList.toggle("has-more-end", tabList.scrollLeft < max - 2);
  }
  tabList.addEventListener("scroll", updateTabEdges, { passive: true });

  function setActive(index: number) {
    if (index === active && cards[index].classList.contains("is-active")) return;
    active = index;
    cards.forEach((el, i) => el.classList.toggle("is-active", i === index));
    tabButtons.forEach((el, i) => el.setAttribute("aria-selected", String(i === index)));
    document.documentElement.style.setProperty("--accent", games[index].accent);
    document.documentElement.style.setProperty("--accent-2", games[index].accent2);
    movePill();
    restartProgress();
  }

  function scrollToCard(index: number) {
    const target = cards[index];
    // Phones snap cards to the centre; wide boards snap them to the left gutter.
    const startAligned = getComputedStyle(target).scrollSnapAlign.includes("start");
    const left = startAligned
      ? target.offsetLeft - (parseFloat(getComputedStyle(rail).scrollPaddingLeft) || 0)
      : target.offsetLeft - (rail.clientWidth - target.offsetWidth) / 2;
    rail.scrollTo({ left, behavior: reducedMotion ? "auto" : "smooth" });
  }

  function restartProgress() {
    pill.classList.remove("is-running");
    void pill.offsetWidth; // restart the CSS progress animation
    if (autoplayAllowed()) pill.classList.add("is-running");
  }

  function autoplayAllowed() {
    return !reducedMotion && onScreen && !userPaused && !document.hidden && cards.length > 1;
  }

  function arm() {
    window.clearInterval(timer);
    restartProgress();
    if (!autoplayAllowed()) return;
    timer = window.setInterval(() => scrollToCard((active + 1) % cards.length), AUTOPLAY_MS);
  }

  function pauseForUser() {
    userPaused = true;
    window.clearInterval(timer);
    pill.classList.remove("is-running");
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      userPaused = false;
      arm();
    }, IDLE_RESUME_MS);
  }

  let frame = 0;
  rail.addEventListener(
    "scroll",
    () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const centre = rail.scrollLeft + rail.clientWidth / 2;
        let best = 0;
        let distance = Infinity;
        cards.forEach((el, i) => {
          const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - centre);
          if (d < distance) {
            distance = d;
            best = i;
          }
        });
        setActive(best);
      });
    },
    { passive: true },
  );

  for (const type of ["pointerdown", "wheel", "touchstart"] as const)
    rail.addEventListener(type, pauseForUser, { passive: true });

  tabButtons.forEach((tab, index) =>
    tab.addEventListener("click", () => {
      pauseForUser();
      scrollToCard(index);
    }),
  );

  new IntersectionObserver(([entry]) => {
    onScreen = !!entry?.isIntersecting;
    arm();
  }).observe(rail);
  document.addEventListener("visibilitychange", arm);
  window.addEventListener("resize", () => {
    movePill();
    updateTabEdges();
    scrollToCard(active);
  });

  cards[0].classList.add("is-active");
  document.fonts?.ready.then(() => {
    movePill();
    updateTabEdges();
  });
  movePill();
  updateTabEdges();
  arm();
}

/* ---------- images ---------- */

/** Marks each image's wrapper loaded (fading it in over its shimmer). */
function mountImages(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>(".art img, .logo").forEach((img) => {
    const wrap = img.parentElement!;
    const done = () => wrap.classList.add("is-loaded");
    if (img.complete && img.naturalWidth) done();
    else {
      img.addEventListener("load", done, { once: true });
      // A failed image should stop shimmering rather than look "still loading".
      img.addEventListener("error", done, { once: true });
    }
  });
}

/** Resolves when the given images have loaded (or failed), capped at `timeoutMs`. */
function imagesReady(images: HTMLImageElement[], timeoutMs: number): Promise<void> {
  const loads = images.map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
  );
  return Promise.race([
    Promise.all(loads).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

/* ---------- open & toast ---------- */

function mountOpening(rail: HTMLElement, toast: HTMLElement) {
  let toastTimer = 0;
  function say(text: string) {
    toast.textContent = text;
    toast.classList.add("is-shown");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-shown"), 3600);
  }

  rail.addEventListener("click", async (event) => {
    const el = (event.target as Element).closest<HTMLAnchorElement>("a.card");
    if (!el || event.defaultPrevented) return;
    event.preventDefault();
    if (el.classList.contains("is-opening")) return;
    el.classList.add("is-opening");
    try {
      const outcome = await openResource(el.href);
      // Quick apps use package-name ids, which protocol v1 does not accept.
      if (outcome === "rejected") say(`在 AstroBox 资源页搜索「${el.dataset.name}」即可安装`);
    } finally {
      window.setTimeout(() => el.classList.remove("is-opening"), 600);
    }
  });
}

/* ---------- boot ---------- */

/**
 * Loading sequence, all behind the skeleton painted straight from index.html:
 *   1. Build the real page invisibly, so its final height is known up front.
 *   2. Wait for the App's theme, then report the height; the App reveals the frame
 *      already themed, showing the skeleton.
 *   3. Once the first covers are in (or after a short cap), cross-fade the
 *      skeleton into the page and play the entrance.
 */
async function boot() {
  const root = document.getElementById("profile")!;
  const rail = h(
    "div",
    { class: "rail reveal", style: "--d: 6", "aria-label": "游戏卡片" },
    ...games.map(card),
  );
  const tabList = tabs();
  const toast = h("div", { class: "toast", role: "status", "aria-live": "polite" });
  root.append(hero(), tabList, rail, footer(), toast);

  document.documentElement.classList.toggle("is-embedded", embedded);
  mountImages(root);
  mountCarousel(rail, tabList);
  mountOpening(rail, toast);

  await themeSettled(THEME_WAIT_MS);
  enableHeightReports();

  const firstCovers = Array.from(rail.querySelectorAll<HTMLImageElement>(".art img")).slice(0, 2);
  await imagesReady(firstCovers, COVER_WAIT_MS);

  document.documentElement.classList.add("is-ready");
  root.removeAttribute("aria-busy");
  const skeleton = document.querySelector(".boot");
  window.setTimeout(() => skeleton?.remove(), reducedMotion ? 0 : 600);
}

void boot();
