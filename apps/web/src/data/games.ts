export type Frame = "land" | "port";

export interface GameShot {
  src: string;
  caption: string;
  /** CSS object-position when the source crop differs from the band screen. */
  focus?: string;
}

/** Paid content sold on Afdian; absent for games that are entirely free. */
export interface Purchase {
  /** Label of the secondary call to action. */
  label: string;
  url: string;
}

export interface Game {
  id: string;
  /** AstroBox resource id; also the Kovela product id for paid games. */
  productId: string;
  name: string;
  /** Latin display word painted behind the chapter. */
  word: string;
  tagline: string;
  description: string;
  facts: string[];
  /** Short pricing label, e.g. 免费 or 第一章免费. */
  pricing: string;
  purchase?: Purchase;
  cover: string;
  logo: string;
  frame: Frame;
  shots: GameShot[];
  /** Page tint while the chapter is on screen, plus its signature accents. */
  tint: string;
  accent: string;
  accent2: string;
}

/** Afdian's buyer-side order list; order lookup links here while the Kovela service is off. */
export const AFDIAN_ORDERS_URL = "https://afdian.com/dashboard/order";

/** Deep link that opens the game's page in AstroBox's official resource source. */
export function astroboxUrl(productId: string): string {
  const query = new URLSearchParams({
    source: "resv2",
    id: productId,
    provider: "OfficialV2",
  });
  return `https://abox.run/open?${query}`;
}

export const games: Game[] = [
  {
    id: "angrybirds",
    productId: "com.komoridev.angrybirds",
    name: "愤怒的小鸟",
    word: "ANGRY BIRDS",
    tagline: "拉满弹弓，从猪猪岛打到幽夜矿井。",
    description:
      "经典弹弓物理，适配全部小米 Vela 穿戴设备，手环上横屏开打。按住后拖拉开弹弓、松手发射，飞行中再点一下放技能。5 章 40 关、10 种小鸟，木、冰、石、TNT 各有克制。第一章免费体验，激活后解锁全部 40 关。",
    facts: ["5 章 40 关", "10 种小鸟", "手环横屏", "第一章免费"],
    pricing: "第一章免费",
    purchase: {
      label: "解锁全部关卡",
      url: "https://afdian.com/item/d6c41a82d55411f184b3525400c8052f",
    },
    cover: "/games/angrybirds/cover.png",
    logo: "/games/angrybirds/logo.png",
    frame: "land",
    shots: [
      { src: "/games/angrybirds/screenshot2.png", caption: "1-1 · 拉弓发射" },
      { src: "/games/angrybirds/screenshot-cover.png", caption: "5-8 · 幽夜矿井" },
      { src: "/games/angrybirds/screenshot1.png", caption: "第一章 · 猪猪岛" },
    ],
    tint: "#e9f1fb",
    accent: "#ff4b3a",
    accent2: "#ffb03b",
  },
  {
    id: "billiard",
    productId: "com.komoridev.billiard",
    name: "口袋台球",
    word: "BILLIARD",
    tagline: "随时随地，一杆进洞。",
    description:
      "八球、追分、练习三种玩法，适配胶囊屏、矩形屏与圆屏。球桌上滑动瞄准，按住蓄力，松手出杆；沿屏幕边缘的弧形轨道还能精细微调。两人共用一台设备对战，也能和电脑对打。",
    facts: ["八球 · 追分 · 练习", "双人同屏", "人机对战", "战绩记录"],
    pricing: "付费",
    purchase: {
      label: "爱发电支持",
      url: "https://afdian.com/item/034b2c98b83c11f1a14452540025c377",
    },
    cover: "/games/billiard/cover.png",
    logo: "/games/billiard/logo.png",
    frame: "port",
    shots: [
      { src: "/games/billiard/screenshot1.png", caption: "开球 · 可瞄准" },
      { src: "/games/billiard/screenshot2.png", caption: "蓄力 · 力度 100%" },
      { src: "/games/billiard/screenshot3.png", caption: "八球 · 清台打黑八" },
    ],
    tint: "#e7f3ef",
    accent: "#1a9a72",
    accent2: "#2f7dff",
  },
  {
    id: "projectile",
    productId: "com.komoridev.projectile",
    name: "抛",
    word: "PĀO",
    tagline: "极简物理，一道弧线。",
    description:
      "小球绕环转动，点按沿切线抛出。落回同一个环可以继续，接住前方新环按前进距离计分，落出边界即结束。一指操作，越抛越远。",
    facts: ["极简物理", "单指操作", "横屏", "免费"],
    pricing: "免费",
    cover: "/games/projectile/cover.png",
    logo: "/games/projectile/logo.png",
    frame: "land",
    shots: [
      { src: "/games/projectile/screenshot1.png", caption: "绕环 · 等待时机" },
      { src: "/games/projectile/screenshot2.png", caption: "暂停 · 最高纪录" },
    ],
    tint: "#efecf8",
    accent: "#e46fb0",
    accent2: "#6b9cf2",
  },
  {
    id: "watermelon",
    productId: "com.komoridev.watermelon",
    name: "合成大西瓜",
    word: "WATERMELON",
    tagline: "一颗一颗，合出那颗大西瓜。",
    description:
      "11 种水果层层合成，竖屏单手即玩。游戏、内置皮肤与图片传输全部免费；支持后可在插件中导入自定义图片，把水果换成你喜欢的样子。",
    facts: ["11 种水果", "竖屏", "免费游玩", "自定义图片"],
    pricing: "免费 · 自定义付费",
    purchase: {
      label: "解锁自定义图片",
      url: "https://afdian.com/item/3187fe28c08a11f1805c52540025c377",
    },
    cover: "/games/watermelon/cover.png",
    logo: "/games/watermelon/logo.png",
    frame: "port",
    shots: [
      { src: "/games/watermelon/screenshot1.png", caption: "最高 376" },
      {
        src: "/games/watermelon/screenshot3.png",
        caption: "合成进行中",
        focus: "center bottom",
      },
    ],
    tint: "#ecf5e8",
    accent: "#ff5d74",
    accent2: "#5fd38a",
  },
];

export function gameById(id: string): Game {
  const game = games.find((item) => item.id === id);
  if (!game) throw new Error(`Unknown game: ${id}`);
  return game;
}

/** Products that unlock a plugin entitlement instead of a device-bound license. */
export const ENTITLEMENT_ONLY = new Set(["com.komoridev.watermelon"]);
