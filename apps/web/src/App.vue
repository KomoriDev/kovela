<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  CircleHelp,
  ExternalLink,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Moon,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Watch,
} from "@lucide/vue";
import type { LookupOrderResult, PublicConfig } from "@kovela/protocol";
import { useContext } from "./context";
import Button from "./components/ui/Button.vue";
import Input from "./components/ui/Input.vue";
import Label from "./components/ui/Label.vue";
import Faq from "./components/Faq.vue";

const client = useContext().kovela;
const config = ref<PublicConfig>();
const availableProducts = computed(() =>
  (config.value?.products ?? []).filter((product) => product.available),
);
const supportedNames = computed(
  () =>
    availableProducts.value.map((product) => product.productName).join(" · ") ||
    "MI-VELA 应用",
);
const canVerify = computed(() => !!config.value?.verificationEnabled);
const orderNo = ref("");
const order = ref<LookupOrderResult>();
const allBound = computed(
  () =>
    !!order.value &&
    order.value.items.length > 0 &&
    order.value.items.every((item) => item.boundDeviceId),
);
const loading = ref(false);
const error = ref("");
const configError = ref("");
const dark = ref(false);
let request = new AbortController();

async function loadConfig() {
  configError.value = "";
  try {
    config.value = await client.getConfig(request.signal);
  } catch (cause) {
    if (!request.signal.aborted)
      configError.value =
        cause instanceof Error ? cause.message : "无法加载验证服务配置。";
  }
}
function changeTheme() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle("dark", dark.value);
  try {
    localStorage.setItem("kovela.theme", dark.value ? "dark" : "light");
  } catch {
    /* Theme remains usable when storage is blocked. */
  }
}
function resetSession() {
  request.abort();
  request = new AbortController();
  order.value = undefined;
  error.value = "";
}
async function lookup() {
  if (loading.value || !config.value || !canVerify.value) return;
  const value = orderNo.value.trim();
  if (!/^\d{16,32}$/.test(value)) {
    error.value = "请输入 16～32 位数字的爱发电订单号。";
    return;
  }
  request.abort();
  request = new AbortController();
  error.value = "";
  loading.value = true;
  try {
    order.value = await client.lookupOrder(
      { orderNo: value },
      request.signal,
    );
  } catch (cause) {
    if (!request.signal.aborted)
      error.value =
        cause instanceof Error ? cause.message : "订单查询失败，请重试。";
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  try {
    dark.value = localStorage.getItem("kovela.theme") === "dark";
  } catch {
    dark.value = false;
  }
  document.documentElement.classList.toggle("dark", dark.value);
  void loadConfig();
});
onBeforeUnmount(() => {
  request.abort();
});
</script>

<template>
  <div class="relative min-h-screen overflow-x-hidden">
    <div
      class="hero-glow pointer-events-none absolute inset-x-0 top-16 h-[760px]"
      aria-hidden="true"
    />
    <header
      class="relative mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:h-24 sm:px-6 lg:px-10"
    >
      <a href="/" aria-label="Kovela 首页" class="flex items-center gap-2.5"
        ><img
          src="/brand/kovela-mark.png"
          width="36"
          height="36"
          alt=""
          class="size-9 shrink-0"
        />
        <span class="text-xl font-semibold tracking-tight"
          >Kovela<span class="text-primary">.</span></span
        ></a
      >
      <nav class="flex items-center gap-3 text-sm sm:gap-7" aria-label="主导航">
        <a
          href="#guide"
          class="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >激活指南</a
        >
        <a
          href="#faq"
          class="text-muted-foreground transition-colors hover:text-foreground"
          >常见问题</a
        >
        <Button
          variant="ghost"
          size="icon"
          :aria-label="dark ? '切换浅色模式' : '切换深色模式'"
          @click="changeTheme"
          ><Sun v-if="dark" /><Moon v-else
        /></Button>
      </nav>
    </header>

    <main class="relative mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-10">
      <section
        class="grid items-center gap-8 pb-14 pt-6 sm:gap-12 sm:pb-20 sm:pt-10 lg:grid-cols-[1.05fr_1fr] lg:gap-20 lg:pb-28 lg:pt-20"
      >
        <div>
          <div
            class="mb-7 inline-flex items-center gap-2 rounded-full border border-violet-200/60 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-300"
          >
            <span class="size-1.5 rounded-full bg-violet-500" /> MI-VELA
            应用授权
          </div>
          <h1
            class="text-[clamp(1.875rem,8.4vw,3rem)] font-semibold leading-[1.28] tracking-tight sm:text-5xl"
          >
            每一份支持，<br />都值得<span class="text-primary">完整体验。</span>
          </h1>
          <p class="mt-6 max-w-sm text-[15px] leading-8 text-muted-foreground">
            感谢你在爱发电的支持。查询订单信息，<br class="hidden sm:block" />通过
            AstroBox，为你的手环解锁完整应用。
          </p>
          <div
            class="mt-8 flex flex-wrap items-center gap-3 text-xs text-muted-foreground sm:gap-5"
          >
            <span class="flex items-center gap-1.5"
              ><ShieldCheck class="size-4 text-primary" /> 设备绑定授权</span
            ><span class="h-3 w-px bg-border" /><span
              class="flex items-center gap-1.5"
              ><Watch class="size-4 text-primary" /> 激活后离线可用</span
            >
          </div>
          <div
            class="mt-8 flex items-center gap-4 rounded-2xl border border-border/80 bg-card/70 p-4 sm:mt-12 sm:max-w-sm"
          >
            <div
              class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300"
            >
              <Sparkles class="size-6" />
            </div>
            <div>
              <p class="text-sm font-medium">{{ supportedNames }}</p>
              <p class="mt-1 text-xs text-muted-foreground">
                购买后凭爱发电订单号即可激活。
              </p>
            </div>
          </div>
        </div>

        <section
          class="card-shadow relative min-w-0 rounded-[24px] border border-border bg-card p-5 sm:p-8"
          aria-label="订单查询"
        >
          <div class="mb-7 flex items-start justify-between">
            <div>
              <div
                class="mb-4 flex size-11 items-center justify-center rounded-2xl bg-violet-50 text-primary dark:bg-violet-400/10"
              >
                <CheckCheck v-if="allBound" /><KeyRound v-else />
              </div>
              <h2 class="text-xl font-semibold">
                {{ order ? "订单信息" : "查询你的订单" }}
              </h2>
              <p class="mt-2 text-sm text-muted-foreground">
                {{
                  order
                    ? allBound
                      ? "订单内的应用均已绑定设备。"
                      : "本订单包含以下应用的授权。"
                    : "输入爱发电订单号，查看包含的应用与绑定状态。"
                }}
              </p>
            </div>
            <span
              class="hidden shrink-0 rounded-md border border-border px-2 py-1 text-[10px] tracking-wider text-muted-foreground sm:inline"
              >KOVELA / 01</span
            >
          </div>

          <div
            v-if="configError"
            role="alert"
            class="space-y-3 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
          >
            <p>{{ configError }}</p>
            <Button variant="outline" size="sm" @click="loadConfig"
              >重新连接</Button
            >
          </div>
          <template v-else>
            <form
              v-if="!order"
              class="space-y-5"
              @submit.prevent="lookup"
            >
              <div
                v-if="config && !canVerify"
                role="status"
                class="rounded-xl border border-violet-200/60 bg-violet-50/60 p-4 text-sm leading-7 text-violet-800 dark:border-violet-400/20 dark:bg-violet-400/5 dark:text-violet-200"
              >
                网站已上线，订单查询暂未开放，正在完成服务配置。请稍后再来。
              </div>
              <div class="space-y-2.5">
                <Label for="order-number">爱发电订单号</Label
                ><Input
                  id="order-number"
                  v-model="orderNo"
                  class="text-base sm:text-sm"
                  name="orderNo"
                  inputmode="numeric"
                  autocomplete="off"
                  spellcheck="false"
                  maxlength="32"
                  placeholder="粘贴你的爱发电订单号"
                  :disabled="loading || !canVerify"
                  :aria-invalid="!!error"
                  aria-describedby="order-help order-error"
                />
                <p
                  id="order-help"
                  class="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <CircleHelp class="size-3.5" /> 在「爱发电 → 我的订单 →
                  订单详情」中查看
                </p>
              </div>
              <Button
                type="submit"
                class="w-full"
                :disabled="loading || !canVerify"
                ><LoaderCircle v-if="loading || !config" class="animate-spin" />{{
                  loading
                    ? "正在查询订单…"
                    : !config
                      ? "正在连接服务…"
                      : !canVerify
                        ? "订单查询尚未开放"
                        : "查询订单"
                }}<ArrowRight v-if="!loading && canVerify" class="ml-auto"
              /></Button>
              <p
                class="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <LockKeyhole class="size-3" />
                无需提供爱发电密码或支付密码
              </p>
            </form>

            <div v-else class="space-y-5">
              <div
                class="rounded-xl border border-violet-200/60 bg-violet-50/60 p-4 dark:border-violet-400/20 dark:bg-violet-400/5"
              >
                <p
                  class="flex items-center gap-2 text-sm font-medium text-primary"
                >
                  <ShieldCheck class="size-4" />订单已确认
                </p>
                <p
                  class="mt-2 truncate font-mono text-xs text-muted-foreground"
                >
                  {{ order.orderNo }}
                </p>
              </div>
              <div
                v-for="item in order.items"
                :key="item.productId"
                class="flex items-center justify-between gap-3 rounded-xl border border-border p-4"
              >
                <p class="min-w-0 truncate text-sm font-medium">
                  {{ item.productName }}
                </p>
                <span
                  class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                  :class="
                    item.boundDeviceId
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground'
                  "
                  >{{
                    item.boundDeviceId
                      ? `已绑定 ${item.boundDeviceId.slice(0, 12)}…`
                      : "尚未绑定"
                  }}</span
                >
              </div>
              <p class="text-xs leading-6 text-muted-foreground">
                {{
                  allBound
                    ? "如需重装应用或重新传输许可证，在插件中输入同一订单号即可。"
                    : "打开 AstroBox 的 Kovela 插件，输入同一订单号，选择手环即可完成激活。"
                }}
              </p>
              <Button
                type="button"
                variant="ghost"
                class="w-full"
                :disabled="loading"
                @click="lookup"
                ><LoaderCircle v-if="loading" class="animate-spin" />重新查询</Button
              >
              <button
                type="button"
                class="w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
                @click="resetSession"
              >
                查询其他订单
              </button>
            </div>
            <p
              v-if="error"
              id="order-error"
              role="alert"
              class="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm leading-6 text-red-700 dark:bg-red-500/10 dark:text-red-300"
            >
              {{ error }}
            </p>
          </template>
          <div
            class="mt-7 border-t border-border pt-5 text-center text-xs text-muted-foreground"
          >
            还没有购买？
            <a
              v-if="availableProducts[0]?.purchaseUrl"
              :href="availableProducts[0].purchaseUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 font-medium text-primary"
              >前往爱发电支持<ExternalLink class="size-3" /></a
            ><a
              v-else
              href="https://afdian.com"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-primary"
              >打开爱发电</a
            >
          </div>
        </section>
      </section>

      <section id="guide" class="scroll-mt-8 border-t border-border pt-12">
        <div class="mb-8 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p
              class="mb-2 text-[10px] font-semibold tracking-[.2em] text-primary"
            >
              A LITTLE GUIDE
            </p>
            <h2 class="text-xl font-semibold">三步，开启完整体验</h2>
          </div>
          <a
            href="https://abox.run/docs"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >了解 AstroBox<ArrowUpRight class="size-3.5"
          /></a>
        </div>
        <div class="grid gap-4 md:grid-cols-3">
          <div
            v-for="(step, index) in [
              {
                title: '输入订单号',
                text: '打开 AstroBox 的 Kovela 插件，输入爱发电订单号，应用由订单自动带出。',
                icon: KeyRound,
              },
              {
                title: '选择手环',
                text: '插件会读取已连接的设备列表，选择你的手环并确认。',
                icon: Smartphone,
              },
              {
                title: '自动完成激活',
                text: '许可证自动签发并写入手环，保存成功后即可离线使用。',
                icon: Fingerprint,
              },
            ]"
            :key="step.title"
            class="rounded-2xl border border-border bg-card/50 p-6"
          >
            <div class="mb-5 flex items-center justify-between">
              <component :is="step.icon" class="size-5 text-primary" /><span
                class="font-mono text-xs text-muted-foreground/60"
                >0{{ index + 1 }}</span
              >
            </div>
            <h3 class="text-sm font-semibold">{{ step.title }}</h3>
            <p class="mt-2 text-xs leading-6 text-muted-foreground">
              {{ step.text }}
            </p>
          </div>
        </div>
      </section>
      <section id="faq" class="mx-auto mt-20 max-w-2xl scroll-mt-8">
        <div class="mb-4 text-center">
          <p
            class="mb-2 text-[10px] font-semibold tracking-[.2em] text-primary"
          >
            GOOD TO KNOW
          </p>
          <h2 class="text-xl font-semibold">你可能还想了解</h2>
        </div>
        <Faq />
      </section>
    </main>
    <footer class="border-t border-border">
      <div
        class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-7 text-[11px] text-muted-foreground sm:px-6 lg:px-10"
      >
        <span>Kovela · 为每一份热爱，认真回应。</span
        ><span>独立开发者授权服务 · 非爱发电官方产品</span>
      </div>
    </footer>
  </div>
</template>
