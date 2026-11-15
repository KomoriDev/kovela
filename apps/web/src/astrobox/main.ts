import { games, type Game } from "../data/games";
import { embedded, openResource, reportHeight, resourceHref, startBridge } from "./bridge";
import "./style.css";

const AUTOPLAY_MS = 5200;
const IDLE_RESUME_MS = 9000;
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
      h("img", { src: "/brand/kovela-mark.png", alt: "", width: "36", height: "36" }),
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
      h("img", {
        src: `/astrobox/covers/${game.id}.webp`,
        alt: "",
        width: "720",
        height: "480",
        decoding: "async",
        loading: index < 2 ? "eager" : "lazy",
      }),
      h("span", { class: "badge" }, game.pricing),
      h("span", { class: "shine", "aria-hidden": "true" }),
    ),
    h(
      "div",
      { class: "meta" },
      h("img", { class: "logo", src: game.logo, alt: "", width: "48", height: "48" }),
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
    const left = target.offsetLeft - (rail.clientWidth - target.offsetWidth) / 2;
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
    scrollToCard(active);
  });

  cards[0].classList.add("is-active");
  document.fonts?.ready.then(movePill);
  movePill();
  arm();
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

function mount() {
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
  startBridge();
  mountCarousel(rail, tabList);
  mountOpening(rail, toast);
  requestAnimationFrame(() => {
    document.documentElement.classList.add("is-ready");
    reportHeight(true);
  });
}

mount();
