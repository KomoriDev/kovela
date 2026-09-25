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
import type { ActivationStatus, PublicConfig, VerifiedOrder } from "@kovela/protocol";
import { useContext } from "./context";
import Button from "./components/ui/Button.vue";
import Input from "./components/ui/Input.vue";
import Label from "./components/ui/Label.vue";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import Faq from "./components/Faq.vue";
import Turnstile from "./components/Turnstile.vue";

const client = useContext().kovela;
const config = ref<PublicConfig>();
const productId = ref("");
const selectedProduct = computed(() =>
  config.value?.products.find(
    (product) => product.productId === productId.value,
  ),
);
const canVerify = computed(
  () =>
    !!config.value?.verificationEnabled && !!selectedProduct.value?.available,
);
const orderNo = ref("");
const verified = ref<VerifiedOrder>();
const status = ref<ActivationStatus>();
const loading = ref(false);
const error = ref("");
const statusError = ref("");
const configError = ref("");
const turnstileToken = ref("");
const resetKey = ref(0);
const dark = ref(false);
let request = new AbortController();
let poll: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const finished = computed(() => status.value?.state === "activated");
const statusTitle = computed(
  () =>
    ({
      ready: "等待 AstroBox 连接",
      issued: "许可证已签发，等待设备确认",
      activated: "设备已确认激活",
      failed: "设备未能完成激活",
    })[status.value?.state ?? "ready"],
);

async function loadConfig() {
  configError.value = "";
  try {
    config.value = await client.getConfig(request.signal);
    if (
      !config.value.products.some(
        (product) => product.productId === productId.value,
      )
    )
      productId.value =
        (
          config.value.products.find((product) => product.available) ??
          config.value.products[0]
        )?.productId ?? "";
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
  clearTimeout(poll);
  verified.value = undefined;
  status.value = undefined;
  statusError.value = "";
  error.value = "";
}
async function verify() {
  if (loading.value || !config.value || !canVerify.value) return;
  resetSession();
  const order = orderNo.value.trim();
  if (!/^\d{16,32}$/.test(order)) {
    error.value = "请输入 16～32 位数字的爱发电订单号。";
    return;
  }
  if (config.value.turnstileSiteKey && !turnstileToken.value) {
    error.value = "请先完成人机验证。";
    return;
  }
  loading.value = true;
  try {
    verified.value = await client.verifyOrder(
      {
        orderNo: order,
        productId: productId.value,
        turnstileToken: turnstileToken.value || undefined,
      },
      request.signal,
    );
    status.value = {
      state: "ready",
      deviceId: verified.value.boundDeviceId,
      notification: "none",
    };
    void refreshStatus();
  } catch (cause) {
    if (!request.signal.aborted)
      error.value =
        cause instanceof Error ? cause.message : "订单验证失败，请重试。";
  } finally {
    loading.value = false;
    resetKey.value += 1;
  }
}
async function refreshStatus() {
  clearTimeout(poll);
  const session = verified.value;
  if (!session || disposed) return;
  statusError.value = "";
  const signal = request.signal;
  try {
    const current = await client.status(session.statusToken, signal);
    if (disposed || signal.aborted || verified.value !== session) return;
    status.value = current;
  } catch (cause) {
    if (signal.aborted || disposed || verified.value !== session) return;
    statusError.value =
      cause instanceof Error ? cause.message : "暂时无法获取状态。";
  }
  if (disposed || verified.value !== session) return;
  if (Date.now() >= (session.expiresAt + 3600) * 1000) {
    statusError.value = "本次状态查询已过期，请重新验证订单。";
    return;
  }
  if (
    status.value?.state !== "activated" ||
    status.value.notification !== "sent"
  )
    poll = setTimeout(refreshStatus, 4000);
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
  disposed = true;
  request.abort();
  clearTimeout(poll);
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
            感谢你在爱发电的支持。验证订单，<br class="hidden sm:block" />通过
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
              <p class="text-sm font-medium">
                {{ selectedProduct?.productName ?? "MI-VELA 应用" }}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">
                选择你购买或兑换的应用，领取专属设备授权。
              </p>
            </div>
          </div>
        </div>

        <section
          class="card-shadow relative min-w-0 rounded-[24px] border border-border bg-card p-5 sm:p-8"
          aria-label="订单验证"
        >
          <div class="mb-7 flex items-start justify-between">
            <div>
              <div
                class="mb-4 flex size-11 items-center justify-center rounded-2xl bg-violet-50 text-primary dark:bg-violet-400/10"
              >
                <CheckCheck v-if="finished" /><KeyRound v-else />
              </div>
              <h2 class="text-xl font-semibold">
                {{
                  finished
                    ? "完整体验，已为你开启"
                    : verified
                      ? "订单已验证"
                      : "验证你的订单"
                }}
              </h2>
              <p class="mt-2 text-sm text-muted-foreground">
                {{
                  finished
                    ? "本设备授权已保存，可离线使用。"
                    : verified
                      ? "接下来，把授权安全地传给设备。"
                      : "选择订单对应的应用，再输入爱发电订单号。"
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
          <form
            v-else-if="!verified"
            class="space-y-5"
            @submit.prevent="verify"
          >
            <div v-if="config?.products.length" class="space-y-2.5">
              <Label for="product">订单对应的应用</Label>
              <Select
                v-model="productId"
                name="productId"
                :disabled="loading"
                @update:model-value="resetSession"
              >
                <SelectTrigger
                  id="product"
                  class="w-full min-w-0 rounded-xl text-base data-[size=default]:h-12 sm:text-sm"
                >
                  <SelectValue placeholder="选择订单对应的应用" />
                </SelectTrigger>
                <SelectContent
                  class="w-[var(--reka-select-trigger-width)] max-w-[calc(100vw-2rem)]"
                  :collision-padding="16"
                >
                  <SelectItem
                    v-for="product in config.products"
                    :key="product.productId"
                    :value="product.productId"
                  >
                    {{ product.productName
                    }}{{ product.available ? "" : "（尚未开放）" }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div
              v-if="config && !canVerify"
              role="status"
              class="rounded-xl border border-violet-200/60 bg-violet-50/60 p-4 text-sm leading-7 text-violet-800 dark:border-violet-400/20 dark:bg-violet-400/5 dark:text-violet-200"
            >
              网站已上线，{{
                config.verificationEnabled
                  ? "所选应用尚未开放订单验证。"
                  : "订单验证暂未开放，正在完成服务配置。"
              }}请稍后再来。
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
            <Turnstile
              v-if="canVerify && config?.turnstileSiteKey"
              :site-key="config.turnstileSiteKey"
              :reset-key="resetKey"
              :theme="dark ? 'dark' : 'light'"
              @token="turnstileToken = $event"
              @error="error = $event"
            />
            <p
              v-if="error"
              id="order-error"
              role="alert"
              class="rounded-lg bg-red-50 px-3 py-2 text-sm leading-6 text-red-700 dark:bg-red-500/10 dark:text-red-300"
            >
              {{ error }}
            </p>
            <Button
              type="submit"
              class="w-full"
              :disabled="loading || !canVerify"
              ><LoaderCircle v-if="loading || !config" class="animate-spin" />{{
                loading
                  ? "正在验证订单…"
                  : !config
                    ? "正在连接服务…"
                    : !canVerify
                      ? "订单验证尚未开放"
                      : "验证订单"
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
                <ShieldCheck class="size-4" />{{ verified.productName }} ·
                订单已确认
              </p>
              <p class="mt-2 truncate font-mono text-xs text-muted-foreground">
                {{ verified.orderNo }}
              </p>
            </div>
            <p
              v-if="verified.boundDeviceId"
              class="text-xs leading-6 text-muted-foreground"
            >
              此订单的应用授权已绑定设备
              {{
                verified.boundDeviceId.slice(0, 12)
              }}…，只能为同一设备重新传输许可证。
            </p>
            <template v-if="!finished">
              <p class="text-xs leading-6 text-muted-foreground">
                打开 AstroBox 的 Kovela，输入同一订单号。插件会查出对应应用，确认后即可选择手环激活。
              </p>
            </template>
            <div aria-live="polite" class="rounded-xl border border-border p-4">
              <p class="flex items-center gap-2 text-sm font-medium">
                <CheckCheck
                  v-if="finished"
                  class="size-4 text-emerald-600"
                /><LoaderCircle
                  v-else-if="status?.state !== 'failed'"
                  class="size-4 animate-spin text-primary"
                /><CircleHelp v-else class="size-4 text-amber-600" />{{
                  statusTitle
                }}
              </p>
              <p class="mt-2 text-xs leading-6 text-muted-foreground">
                {{
                  finished
                    ? status?.notification === "sent"
                      ? "激活结果已通过爱发电私信发送。现在可以离线使用应用。"
                      : "设备已解锁。爱发电私信正在发送，不影响正常使用。"
                    : "请在 AstroBox 的 Kovela 中输入同一订单号并确认。只有设备验签并保存许可证后，这里才会显示激活完成。"
                }}
              </p>
            </div>
            <div
              v-if="statusError"
              role="alert"
              class="text-xs leading-6 text-amber-700 dark:text-amber-300"
            >
              {{ statusError
              }}<button
                type="button"
                class="ml-2 underline"
                @click="refreshStatus"
              >
                刷新状态
              </button>
            </div>
            <Button
              type="button"
              variant="ghost"
              class="w-full"
              @click="resetSession"
              >{{ finished ? "验证其他订单" : "重新验证 / 更新链接" }}</Button
            >
          </div>
          <div
            class="mt-7 border-t border-border pt-5 text-center text-xs text-muted-foreground"
          >
            还没有购买？
            <a
              v-if="selectedProduct?.purchaseUrl"
              :href="selectedProduct.purchaseUrl"
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
                title: '验证爱发电订单',
                text: '打开 AstroBox 的 Kovela，选择应用并输入订单号。本页也可以验证，再把凭证传给插件。',
                icon: ShieldCheck,
              },
              {
                title: '连接你的手环',
                text: '打开 AstroBox v2 中的 Kovela 插件，选择已连接设备。',
                icon: Smartphone,
              },
              {
                title: '自动完成激活',
                text: '许可证安全传入手环，保存成功后即可离线畅玩。',
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
