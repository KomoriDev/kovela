<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
const props = defineProps<{
  siteKey: string;
  resetKey: number;
  theme: "light" | "dark";
}>();
const emit = defineEmits<{
  token: [value: string];
  error: [message: string];
}>();
const element = ref<HTMLElement>();
const failed = ref(false);
let loading = false;
let widget: string | undefined;
let disposed = false;
let compact = false;
let observer: ResizeObserver | undefined;
interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
  reset(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
async function renderChallenge() {
  if (loading || disposed) return;
  loading = true;
  failed.value = false;
  emit("token", "");
  if (widget) {
    window.turnstile?.remove(widget);
    widget = undefined;
  }
  try {
    if (!window.turnstile)
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src =
          "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
          script.remove();
          reject(new Error("人机验证加载失败，请检查网络后重试。"));
        };
        document.head.appendChild(script);
      });
    if (disposed || !element.value || !window.turnstile) return;
    widget = window.turnstile.render(element.value, {
      sitekey: props.siteKey,
      theme: props.theme,
      size: compact ? "compact" : "flexible",
      action: "verify-order",
      callback: (token: string) => emit("token", token),
      "expired-callback": () => emit("token", ""),
      "error-callback": () => {
        emit("token", "");
        failed.value = true;
        emit("error", "人机验证失败，请重试。");
      },
    });
  } catch (error) {
    if (!disposed) {
      failed.value = true;
      emit(
        "error",
        error instanceof Error ? error.message : "人机验证加载失败。",
      );
    }
  } finally {
    loading = false;
  }
}
onMounted(() => {
  if (!element.value) return;
  compact = element.value.clientWidth < 300;
  observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const next = entry.contentRect.width < 300;
    if (next !== compact) {
      compact = next;
      void renderChallenge();
    }
  });
  observer.observe(element.value);
  void renderChallenge();
});
watch(() => props.theme, renderChallenge);
watch(
  () => props.resetKey,
  () => {
    emit("token", "");
    if (widget) window.turnstile?.reset(widget);
  },
);
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  if (widget) window.turnstile?.remove(widget);
});
</script>
<template>
  <div>
    <div ref="element" class="flex justify-center" />
    <button
      v-if="failed"
      type="button"
      class="mt-2 text-xs text-primary underline"
      @click="renderChallenge"
    >
      重试人机验证
    </button>
  </div>
</template>
