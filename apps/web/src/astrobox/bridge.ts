/**
 * AstroBox personal-homepage iframe protocol, version 1.
 * https://abox.run/docs/usage/custom/personal-homepage-iframe-api
 */

const NAMESPACE = "astrobox.profile-iframe";
const VERSION = 1;
/** Old Apps never answer open-resource; after this wait the page navigates itself. */
const OPEN_FALLBACK_MS = 500;

export type Theme = "light" | "dark";

export type OpenOutcome = "accepted" | "rejected" | "fallback" | "direct";

interface Envelope {
  namespace: typeof NAMESPACE;
  version: typeof VERSION;
  type: string;
  [field: string]: unknown;
}

/** Navigation inside the App's iframe wrapper is limited to these origins. */
const ALLOWED_ORIGINS = new Set([
  location.origin,
  "https://astrobox.online",
  "https://abox.run",
]);

export const embedded = window.parent !== window;

function post(type: string, fields: Record<string, unknown> = {}) {
  if (!embedded) return;
  const message: Envelope = { namespace: NAMESPACE, version: VERSION, type, ...fields };
  window.parent.postMessage(message, "*");
}

function isEnvelope(data: unknown): data is Envelope {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Envelope).namespace === NAMESPACE &&
    (data as Envelope).version === VERSION &&
    typeof (data as Envelope).type === "string"
  );
}

/* ---------- theme & transparency ---------- */

let markConfigured: () => void = () => {};
const configured = new Promise<void>((resolve) => (markConfigured = resolve));

function applyConfig(message: Envelope) {
  const root = document.documentElement;
  if (message.theme === "light" || message.theme === "dark") {
    root.dataset.astroboxTheme = message.theme;
    root.style.colorScheme = message.theme;
  }
  root.classList.toggle("astrobox-transparent", message.transparent === true);
  markConfigured();
  if (message.requestResize === true) reportHeight(true);
}

/**
 * Resolves once the App has sent its theme, or after `timeoutMs` (the App may be
 * old, or the page may be open in a plain browser). Chromium paints an opaque
 * canvas behind an iframe whose color scheme differs from its host's, so the page
 * should not be revealed until the theme is applied.
 */
export function themeSettled(timeoutMs: number): Promise<void> {
  if (!embedded) return Promise.resolve();
  return Promise.race([
    configured,
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

/* ---------- auto height ---------- */

let heightFrame = 0;
let lastHeight = 0;
let forceReport = false;
/** The App reveals the frame on the first resize, so hold it until we are ready. */
let heightEnabled = false;

export function enableHeightReports(): void {
  heightEnabled = true;
  reportHeight(true);
}

export function reportHeight(force = false): void {
  forceReport ||= force;
  if (heightFrame || !embedded || !heightEnabled) return;
  heightFrame = requestAnimationFrame(() => {
    heightFrame = 0;
    const shouldForce = forceReport;
    forceReport = false;
    const body = document.body;
    const height = Math.ceil(
      Math.max(body.getBoundingClientRect().height, body.offsetHeight, body.scrollHeight),
    );
    if (!height || (!shouldForce && height === lastHeight)) return;
    lastHeight = height;
    post("resize", { height });
  });
}

/* ---------- resource opening ---------- */

const pending = new Map<string, (accepted: boolean) => void>();
let requestSeq = 0;

/** Official AstroBox resource link, in the exact shape open-resource accepts. */
export function resourceHref(id: string): string {
  const query = new URLSearchParams({ source: "resv2", id, provider: "OfficialV2" });
  return `https://astrobox.online/open?${query}`;
}

/**
 * Asks the App to open a resource in its own detail page. Apps that predate the
 * protocol never reply, so the iframe falls back to the whitelisted official link.
 * The App only accepts numeric ids, so quick apps (package-name ids) come back
 * rejected; the caller decides how to guide the user in that case.
 */
export function openResource(href: string): Promise<OpenOutcome> {
  if (!embedded) {
    location.href = href;
    return Promise.resolve("direct");
  }
  const requestId = `resource-${++requestSeq}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      location.href = href;
      resolve("fallback");
    }, OPEN_FALLBACK_MS);
    pending.set(requestId, (accepted) => {
      window.clearTimeout(timer);
      pending.delete(requestId);
      resolve(accepted ? "accepted" : "rejected");
    });
    post("open-resource", { requestId, href });
  });
}

/* ---------- link guard ---------- */

function guardLinks(event: MouseEvent) {
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  let url: URL;
  try {
    url = new URL(anchor.href, location.href);
  } catch {
    event.preventDefault();
    return;
  }
  // Origins carry the scheme, so mailto:, javascript: and http: links all fail here.
  if (!ALLOWED_ORIGINS.has(url.origin)) event.preventDefault();
}

/* ---------- boot ---------- */

export function startBridge(): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !isEnvelope(event.data)) return;
    const message = event.data;
    if (message.type === "config") applyConfig(message);
    else if (message.type === "open-resource-result" && typeof message.requestId === "string")
      pending.get(message.requestId)?.(message.accepted === true);
  });
  // Capture phase: runs before any card handler can navigate.
  document.addEventListener("click", guardLinks, true);
  new ResizeObserver(() => reportHeight()).observe(document.body);
  window.addEventListener("load", () => reportHeight());
  document.fonts?.ready.then(() => reportHeight());
  post("ready");
}
