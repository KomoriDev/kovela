import { readonly, ref } from "vue";

const y = ref(0);
const direction = ref<1 | -1>(1);
const progress = ref(0);
let started = false;

function start() {
  started = true;
  let last = window.scrollY;
  let queued = false;
  const update = () => {
    queued = false;
    const top = window.scrollY;
    if (Math.abs(top - last) > 2) direction.value = top > last ? 1 : -1;
    last = top;
    y.value = top;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.value = max > 0 ? Math.min(1, Math.max(0, top / max)) : 0;
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  update();
}

/** Shared window scroll offset, direction (1 down, -1 up) and 0–1 progress. */
export function useScrollState() {
  if (!started) start();
  return {
    y: readonly(y),
    direction: readonly(direction),
    progress: readonly(progress),
  };
}
