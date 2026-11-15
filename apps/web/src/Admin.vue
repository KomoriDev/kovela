<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { OfflineLicense, OfflineRequest, PublicConfig } from "@kovela/protocol";
import { KovelaError } from "@kovela/client";
import { useContext } from "./context";

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
const products = computed(() =>
  (config.value?.products ?? []).filter(
    (item) => item.available && item.productId !== "com.komoridev.watermelon",
  ),
);
const resultJson = computed(() =>
  result.value ? JSON.stringify(result.value, null, 2) : "",
);
let request = new AbortController();

function failure(cause: unknown) {
  if (request.signal.aborted) return;
  error.value = cause instanceof Error ? cause.message : "请求失败。";
  if (cause instanceof KovelaError && cause.status === 401)
    authenticatedKey.value = "";
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
    if (!productId.value && products.value[0])
      productId.value = products.value[0].productId;
  } catch (cause) {
    failure(cause);
  } finally {
    authenticating.value = false;
  }
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
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("申请 JSON 格式不正确。");
  }
  if (
    !value ||
    value.v !== 1 ||
    value.type !== "kovela-offline-request" ||
    typeof value.orderNo !== "string" ||
    !/^\d{16,32}$/.test(value.orderNo) ||
    typeof value.productId !== "string" ||
    !products.value.some((item) => item.productId === value.productId) ||
    typeof value.deviceId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.deviceId) ||
    (value.deviceModel !== undefined &&
      (typeof value.deviceModel !== "string" ||
        [...value.deviceModel].length > 80 ||
        /[\u0000-\u001f\u007f]/.test(value.deviceModel)))
  )
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
  try {
    applyRequest(requestText.value);
  } catch (cause) {
    failure(cause);
  }
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
  } catch (cause) {
    failure(cause);
  } finally {
    target.value = "";
  }
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
  const input: OfflineRequest = {
    v: 1,
    type: "kovela-offline-request",
    orderNo: orderNo.value.trim(),
    productId: productId.value,
    deviceId: deviceId.value.trim(),
  };
  if (deviceModel.value) input.deviceModel = deviceModel.value;
  if (
    !/^\d{16,32}$/.test(input.orderNo) ||
    !/^[a-f0-9]{64}$/.test(input.deviceId)
  ) {
    error.value = "订单号须为 16~32 位数字，设备码须为 64 位小写十六进制字符。";
    return;
  }
  issuing.value = true;
  try {
    result.value = await client.issueOfflineLicense(
      input,
      authenticatedKey.value,
      request.signal,
    );
  } catch (cause) {
    failure(cause);
  } finally {
    issuing.value = false;
  }
}
async function copy(text: string) {
  error.value = "";
  try {
    await navigator.clipboard.writeText(text);
    notice.value = "已复制";
  } catch {
    error.value = "无法写入剪贴板，请选择内容复制或下载文件。";
  }
}
function download() {
  if (!result.value) return;
  const url = URL.createObjectURL(
    new Blob([resultJson.value + "\n"], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${orderNo.value}-${result.value.productId}-license.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onMounted(() => {
  document.title = "Kovela | 管理员签发";
});
onBeforeUnmount(() => request.abort());
</script>

<template>
  <div class="admin">
    <header>
      <a href="/"
        ><img src="/brand/kovela-mark.png" width="32" height="32" alt="" />Kovela</a
      >
      <button v-if="authenticatedKey" type="button" @click="logout">退出</button>
      <a v-else href="/">返回</a>
    </header>
    <main>
      <h1>许可证签发</h1>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <form v-if="!authenticatedKey" class="gate" @submit.prevent="login">
        <div class="key">
          <label for="admin-key">管理员访问密钥</label>
          <input
            id="admin-key"
            v-model="keyInput"
            :type="keyVisible ? 'text' : 'password'"
            autocomplete="off"
            :disabled="authenticating"
            required
          />
          <button
            type="button"
            :aria-label="keyVisible ? '隐藏密钥' : '显示密钥'"
            @click="keyVisible = !keyVisible"
          >
            {{ keyVisible ? "隐藏" : "显示" }}
          </button>
        </div>
        <button
          type="submit"
          class="primary"
          :disabled="authenticating || !keyInput.trim()"
        >
          {{ authenticating ? "验证中" : "验证密钥" }}
        </button>
      </form>
      <div v-else class="admin-grid">
        <section class="split" aria-label="签发申请">
          <div class="row">
            <h2>激活申请</h2>
            <button type="button" :disabled="issuing" @click="fileInput?.click()">
              选择文件
            </button>
            <input
              ref="fileInput"
              class="sr"
              type="file"
              accept=".json,.txt,application/json,text/plain"
              @change="selectFile"
            />
          </div>
          <label for="request-json"
            >申请 JSON
            <textarea
              id="request-json"
              v-model="requestText"
              :disabled="issuing"
              spellcheck="false"
              @change="parseInput"
            />
          </label>
          <button
            type="button"
            :disabled="issuing || !requestText.trim()"
            @click="parseInput"
          >
            读取申请
          </button>
          <form @submit.prevent="issue">
            <label for="order-number"
              >爱发电订单号
              <input
                id="order-number"
                v-model="orderNo"
                class="mono"
                inputmode="numeric"
                autocomplete="off"
                :disabled="issuing"
                required
                maxlength="32"
                @input="changed"
              />
            </label>
            <label for="product"
              >应用
              <select
                id="product"
                v-model="productId"
                :disabled="issuing"
                required
                @change="changed"
              >
                <option
                  v-for="item in products"
                  :key="item.productId"
                  :value="item.productId"
                >
                  {{ item.productName }}
                </option>
              </select>
            </label>
            <label for="device-code"
              >设备码
              <textarea
                id="device-code"
                v-model="deviceId"
                :disabled="issuing"
                required
                maxlength="64"
                spellcheck="false"
                @input="changed"
              />
            </label>
            <p v-if="deviceModel" class="muted">{{ deviceModel }}</p>
            <label class="check"
              ><input
                v-model="buyerConfirmed"
                type="checkbox"
                :disabled="issuing"
              />已确认申请者是该订单买家，且设备码无误</label
            >
            <button
              type="submit"
              class="primary"
              :disabled="issuing || !buyerConfirmed || !config?.verificationEnabled"
            >
              {{ issuing ? "核单并签发中" : "核单并签发" }}
            </button>
          </form>
        </section>
        <section class="split" aria-label="签发结果">
          <h2>签发结果</h2>
          <template v-if="result">
            <p class="ok">已签发 · {{ result.productName }}</p>
            <p class="muted">许可证编号</p>
            <p class="mono">{{ result.licenseId }}</p>
            <p class="muted">绑定设备</p>
            <p class="mono">{{ result.deviceId }}</p>
            <textarea :value="resultJson" readonly aria-label="许可证 JSON" />
            <div class="row">
              <button type="button" class="primary" @click="download">下载 JSON</button>
              <button type="button" @click="copy(resultJson)">复制 JSON</button>
              <button type="button" @click="copy(result.licenseToken)">
                复制授权串
              </button>
            </div>
            <p class="muted">订单设备绑定已登记。手环安装尚未确认。</p>
          </template>
          <p v-else class="muted">
            {{ issuing ? "正在核实订单与设备绑定…" : "尚未签发" }}
          </p>
          <p v-if="notice" class="ok" role="status">{{ notice }}</p>
        </section>
      </div>
    </main>
  </div>
</template>
