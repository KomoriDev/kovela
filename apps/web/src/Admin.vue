<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ArrowLeft, Check, Copy, Download, Eye, EyeOff, FileUp, KeyRound, LoaderCircle, LogOut, ShieldCheck } from "@lucide/vue";
import type { OfflineLicense, OfflineRequest, PublicConfig } from "@kovela/protocol";
import { KovelaError } from "@kovela/client";
import { useContext } from "./context";
import Button from "./components/ui/Button.vue";
import Input from "./components/ui/Input.vue";
import Label from "./components/ui/Label.vue";

const client = useContext().kovela;
const config = ref<PublicConfig>();
const keyInput = ref("");
const authenticatedKey = ref("");
const keyVisible = ref(false);
const authenticating = ref(false);
const issuing = ref(false);
const error = ref("");
const notice = ref("");
const requestText = ref("");
const orderNo = ref("");
const productId = ref("");
const deviceId = ref("");
const deviceModel = ref("");
const buyerConfirmed = ref(false);
const result = ref<OfflineLicense>();
const fileInput = ref<HTMLInputElement>();
const products = computed(() => (config.value?.products ?? []).filter((item) => item.available));
const resultJson = computed(() => result.value ? JSON.stringify(result.value, null, 2) : "");
let request = new AbortController();

function failure(cause: unknown) {
  if (request.signal.aborted) return;
  error.value = cause instanceof Error ? cause.message : "请求失败。";
  if (cause instanceof KovelaError && cause.status === 401) authenticatedKey.value = "";
}
async function login() {
  if (authenticating.value) return;
  error.value = "";
  authenticating.value = true;
  try {
    const key = keyInput.value.trim();
    await client.authorizeAdmin(key, request.signal);
    const loaded = await client.getConfig(request.signal);
    authenticatedKey.value = key;
    keyInput.value = "";
    keyVisible.value = false;
    config.value = loaded;
    if (!productId.value && products.value[0]) productId.value = products.value[0].productId;
  } catch (cause) { failure(cause); }
  finally { authenticating.value = false; }
}
function logout() {
  request.abort();
  request = new AbortController();
  authenticatedKey.value = "";
  keyInput.value = "";
  requestText.value = "";
  orderNo.value = "";
  deviceId.value = "";
  deviceModel.value = "";
  buyerConfirmed.value = false;
  result.value = undefined;
  error.value = "";
  notice.value = "";
}
function applyRequest(text: string) {
  if (text.length > 8192) throw new Error("申请内容过长。");
  let value: Partial<OfflineRequest>;
  try { value = JSON.parse(text); } catch { throw new Error("申请 JSON 格式不正确。"); }
  if (!value || value.v !== 1 || value.type !== "kovela-offline-request" ||
      typeof value.orderNo !== "string" || !/^\d{16,32}$/.test(value.orderNo) ||
      typeof value.productId !== "string" || !products.value.some((item) => item.productId === value.productId) ||
      typeof value.deviceId !== "string" || !/^[a-f0-9]{64}$/.test(value.deviceId) ||
      (value.deviceModel !== undefined && (typeof value.deviceModel !== "string" || [...value.deviceModel].length > 80 || /[\u0000-\u001f\u007f]/.test(value.deviceModel))))
    throw new Error("申请的订单、应用或设备码不正确。");
  orderNo.value = value.orderNo;
  productId.value = value.productId;
  deviceId.value = value.deviceId;
  deviceModel.value = value.deviceModel ?? "";
  buyerConfirmed.value = false;
  result.value = undefined;
}
function parseInput() {
  error.value = "";
  notice.value = "";
  try { applyRequest(requestText.value); } catch (cause) { failure(cause); }
}
async function selectFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  error.value = "";
  try {
    if (file.size > 8192) throw new Error("申请文件过长。");
    requestText.value = await file.text();
    applyRequest(requestText.value);
  } catch (cause) { failure(cause); }
  finally { target.value = ""; }
}
function changed() {
  result.value = undefined;
  notice.value = "";
  buyerConfirmed.value = false;
}
async function issue() {
  if (issuing.value || !buyerConfirmed.value) return;
  error.value = "";
  notice.value = "";
  result.value = undefined;
  const input: OfflineRequest = { v: 1, type: "kovela-offline-request", orderNo: orderNo.value.trim(), productId: productId.value, deviceId: deviceId.value.trim() };
  if (deviceModel.value) input.deviceModel = deviceModel.value;
  if (!/^\d{16,32}$/.test(input.orderNo) || !/^[a-f0-9]{64}$/.test(input.deviceId)) {
    error.value = "订单号须为 16~32 位数字，设备码须为 64 位小写十六进制字符。";
    return;
  }
  issuing.value = true;
  try { result.value = await client.issueOfflineLicense(input, authenticatedKey.value, request.signal); }
  catch (cause) { failure(cause); }
  finally { issuing.value = false; }
}
async function copy(text: string) {
  error.value = "";
  try { await navigator.clipboard.writeText(text); notice.value = "已复制"; }
  catch { error.value = "无法写入剪贴板，请选择内容复制或下载文件。"; }
}
function download() {
  if (!result.value) return;
  const url = URL.createObjectURL(new Blob([resultJson.value + "\n"], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${orderNo.value}-${result.value.productId}-license.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onMounted(() => {
  document.title = "Kovela | 管理员签发";
  try { document.documentElement.classList.toggle("dark", localStorage.getItem("kovela.theme") === "dark"); } catch {}
});
onBeforeUnmount(() => request.abort());
</script>

<template>
  <div class="admin-shell min-h-screen">
    <header class="border-b border-border">
      <div class="mx-auto flex h-20 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <a href="/" class="flex shrink-0 items-center gap-2.5"><img src="/brand/kovela-mark.png" width="32" height="32" alt="" /><span class="text-lg font-semibold">Kovela</span><span class="hidden border-l border-border pl-3 text-sm text-muted-foreground sm:inline">管理员</span></a>
        <Button v-if="authenticatedKey" variant="ghost" size="sm" class="rounded-lg" @click="logout"><LogOut />退出</Button>
        <a v-else href="/" class="flex items-center gap-1.5 text-sm text-muted-foreground"><ArrowLeft class="size-4" />订单查询</a>
      </div>
    </header>
    <main class="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <div class="mb-8 flex items-center gap-3"><ShieldCheck class="size-6 text-emerald-600 dark:text-emerald-400" /><h1 class="text-2xl font-semibold">许可证签发</h1></div>
      <p v-if="error" role="alert" class="mb-6 rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <form v-if="!authenticatedKey" class="max-w-md space-y-5" @submit.prevent="login">
        <div class="space-y-2"><Label for="admin-key">管理员访问密钥</Label><div class="relative"><Input id="admin-key" v-model="keyInput" :type="keyVisible ? 'text' : 'password'" autocomplete="off" :disabled="authenticating" required class="rounded-lg pr-12 font-mono" /><button type="button" class="absolute right-1 top-1 grid size-10 place-items-center text-muted-foreground" :aria-label="keyVisible ? '隐藏密钥' : '显示密钥'" :title="keyVisible ? '隐藏密钥' : '显示密钥'" @click="keyVisible = !keyVisible"><EyeOff v-if="keyVisible" class="size-4" /><Eye v-else class="size-4" /></button></div></div>
        <Button type="submit" :disabled="authenticating || !keyInput.trim()" class="rounded-lg"><LoaderCircle v-if="authenticating" class="animate-spin" /><KeyRound v-else />{{ authenticating ? '验证中' : '验证密钥' }}</Button>
      </form>
      <div v-else class="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12">
        <section class="min-w-0 space-y-6" aria-label="签发申请">
          <div class="flex items-center justify-between gap-3"><h2 class="text-base font-semibold">激活申请</h2><Button type="button" variant="outline" size="sm" :disabled="issuing" class="rounded-lg" @click="fileInput?.click()"><FileUp />选择文件</Button><input ref="fileInput" type="file" accept=".json,.txt,application/json,text/plain" class="hidden" @change="selectFile" /></div>
          <div class="space-y-2"><Label for="request-json">申请 JSON</Label><textarea id="request-json" v-model="requestText" :disabled="issuing" spellcheck="false" class="admin-textarea h-32" @change="parseInput" /><Button type="button" variant="outline" size="sm" :disabled="issuing || !requestText.trim()" class="rounded-lg" @click="parseInput"><Check />读取申请</Button></div>
          <form class="space-y-5 border-t border-border pt-6" @submit.prevent="issue">
            <div class="space-y-2"><Label for="order-number">爱发电订单号</Label><Input id="order-number" v-model="orderNo" inputmode="numeric" autocomplete="off" :disabled="issuing" required maxlength="32" class="rounded-lg font-mono" @input="changed" /></div>
            <div class="space-y-2"><Label for="product">应用</Label><select id="product" v-model="productId" :disabled="issuing" required class="h-12 w-full rounded-lg border border-input bg-background px-3 text-sm" @change="changed"><option v-for="item in products" :key="item.productId" :value="item.productId">{{ item.productName }}</option></select></div>
            <div class="space-y-2"><Label for="device-code">设备码</Label><textarea id="device-code" v-model="deviceId" :disabled="issuing" required maxlength="64" spellcheck="false" class="admin-textarea h-24" @input="changed" /></div>
            <p v-if="deviceModel" class="text-sm text-muted-foreground">{{ deviceModel }}</p>
            <label class="flex items-start gap-2.5 text-sm leading-6"><input v-model="buyerConfirmed" type="checkbox" :disabled="issuing" class="mt-1 size-4 shrink-0 accent-emerald-600" />已确认申请者是该订单买家，且设备码无误</label>
            <Button type="submit" :disabled="issuing || !buyerConfirmed || !config?.verificationEnabled" class="w-full rounded-lg"><LoaderCircle v-if="issuing" class="animate-spin" /><KeyRound v-else />{{ issuing ? '核单并签发中' : '核单并签发' }}</Button>
          </form>
        </section>
        <section class="min-w-0 border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" aria-label="签发结果">
          <h2 class="mb-5 text-base font-semibold">签发结果</h2>
          <template v-if="result">
            <p class="mb-4 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300"><Check class="size-4" />已签发 · {{ result.productName }}</p>
            <dl class="mb-5 space-y-3 text-sm"><div><dt class="text-muted-foreground">许可证编号</dt><dd class="mt-1 break-all font-mono">{{ result.licenseId }}</dd></div><div><dt class="text-muted-foreground">绑定设备</dt><dd class="mt-1 break-all font-mono">{{ result.deviceId }}</dd></div></dl>
            <textarea :value="resultJson" readonly aria-label="许可证 JSON" class="admin-textarea h-64" />
            <div class="mt-4 flex flex-wrap gap-2"><Button type="button" class="rounded-lg" @click="download"><Download />下载 JSON</Button><Button type="button" variant="outline" class="rounded-lg" @click="copy(resultJson)"><Copy />复制 JSON</Button><Button type="button" variant="ghost" class="rounded-lg" @click="copy(result.licenseToken)"><Copy />复制授权串</Button></div>
            <p class="mt-5 text-sm leading-6 text-muted-foreground">订单设备绑定已登记。手环安装尚未确认。</p>
          </template>
          <p v-else class="border-l-2 border-emerald-500/40 pl-4 text-sm leading-6 text-muted-foreground">{{ issuing ? '正在核实订单与设备绑定…' : '尚未签发' }}</p>
          <p v-if="notice" role="status" class="mt-4 text-sm text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.admin-shell { letter-spacing: 0; background: var(--background); color: var(--foreground); --background: #f7faf9; --foreground: #182622; --card: #ffffff; --primary: #047857; --primary-foreground: #ffffff; --muted: #edf3f0; --muted-foreground: #63736c; --border: #dce6e1; }
:global(.dark) .admin-shell { --background: #131a18; --foreground: #e4efea; --card: #19241f; --primary: #34d399; --primary-foreground: #102d22; --muted: #25342d; --muted-foreground: #a0b4aa; --border: #35463d; }
.admin-shell :deep(button[class*="bg-primary"]:hover) { background: #065f46; color: #ffffff; }
.admin-textarea { box-sizing: border-box; display: block; width: 100%; min-width: 0; resize: vertical; border: 1px solid var(--border); border-radius: 8px; background: var(--background); color: var(--foreground); padding: 12px; font: 13px/1.65 ui-monospace, Consolas, monospace; overflow-wrap: anywhere; outline: none; }
.admin-textarea:focus { border-color: #10b981; }
.admin-textarea:disabled { opacity: 0.5; }
</style>
