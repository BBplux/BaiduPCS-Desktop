<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { message } from "ant-design-vue";
import { useDisk } from "../store";
import { call } from "../api";
import Icon from "./Icon.vue";
const store = useDisk(),
  tab = ref("official"),
  cookies = ref(""),
  busy = ref(false),
  qr = ref(""),
  qrStatus = ref(""),
  qrSign = ref("");
let timer: ReturnType<typeof setInterval> | undefined,
  polling = false,
  generation = 0;
function stop() {
  clearInterval(timer);
  timer = undefined;
  generation++;
}
async function official() {
  busy.value = true;
  try {
    await call("auth:official");
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function cookieLogin() {
  busy.value = true;
  try {
    store.user = await call("auth:cookie", { cookies: cookies.value });
    cookies.value = "";
    store.loginOpen = false;
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function generate() {
  stop();
  const epoch = generation;
  qr.value = "";
  qrStatus.value = "正在生成二维码";
  busy.value = true;
  try {
    const result = await call("auth:qr");
    if (epoch !== generation) return;
    qr.value = result.image_base64.startsWith("data:")
      ? result.image_base64
      : `data:image/png;base64,${result.image_base64}`;
    qrSign.value = result.sign;
    qrStatus.value = "请使用百度网盘 App 扫码";
    timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await call("auth:qr-status", { sign: qrSign.value });
        if (epoch !== generation) return;
        if (result.status === "success") {
          stop();
          store.user = result.user;
          store.loginOpen = false;
          message.success("登录成功");
        } else if (result.status === "expired" || result.status === "failed") {
          stop();
          qrStatus.value = "二维码已失效，请点击刷新";
        } else if (result.status === "scanned")
          qrStatus.value = "已扫码，请在手机上确认";
      } catch (e) {
        stop();
        qrStatus.value = (e as Error).message;
      } finally {
        polling = false;
      }
    }, 2000);
  } catch (e) {
    qrStatus.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
watch(
  () => [store.loginOpen, tab.value],
  () => {
    stop();
    if (store.loginOpen && tab.value === "qr") generate();
    if (!store.loginOpen) cookies.value = "";
  },
);
onUnmounted(stop);
</script>
<template>
  <a-modal
    v-model:open="store.loginOpen"
    :footer="null"
    :width="543"
    :destroy-on-close="true"
    centered
    class="login-modal"
  >
    <div class="login-panel">
      <h2>
        {{
          tab === "official"
            ? "账号密码登录"
            : tab === "qr"
              ? "扫码登录"
              : "Cookie 登录"
        }}
      </h2>
      <div class="login-method-content">
        <template v-if="tab === 'official'">
          <div class="official-login-intro">
            <Icon name="user" :size="34" />
            <p>使用百度账号登录</p>
            <span>在百度官方页面输入账号密码并完成验证</span>
          </div>
          <a-button
            type="primary"
            block
            :loading="busy"
            :disabled="store.backend.state !== 'ready'"
            @click="official"
            >打开百度官方登录</a-button
          >
          <p class="hint">
            完成网页验证后请停留在网盘页面，验证文件访问权限后会自动返回。若未返回，可改用扫码登录。
          </p>
        </template>
        <template v-else-if="tab === 'qr'">
          <p class="scan-instruction">
            请使用 <span>百度网盘 App</span> 扫码登录
          </p>
          <button
            class="qr-box"
            title="刷新二维码"
            :disabled="busy"
            @click="generate"
          >
            <img v-if="qr" :src="qr" alt="百度网盘登录二维码" /><a-spin
              v-else
              :spinning="busy"
            />
          </button>
          <p class="hint" role="status">{{ qrStatus }}</p>
        </template>
        <template v-else>
          <p class="login-description">粘贴百度网盘网页登录 Cookie</p>
          <a-textarea
            v-model:value="cookies"
            :rows="5"
            placeholder="BDUSS=…; STOKEN=…"
            autocomplete="off"
            aria-label="百度网盘 Cookie"
          />
          <a-button
            class="cookie-submit"
            type="primary"
            block
            :loading="busy"
            :disabled="!cookies.trim() || store.backend.state !== 'ready'"
            @click="cookieLogin"
            >登录</a-button
          >
        </template>
        <p v-if="store.backend.state !== 'ready'" class="error-text">
          {{ store.backend.error || "后台正在启动，请稍候" }}
        </p>
      </div>
      <nav class="login-methods" aria-label="登录方式">
        <button
          :class="{ active: tab === 'official' }"
          :aria-pressed="tab === 'official'"
          @click="tab = 'official'"
        >
          <Icon name="user" :size="16" />账号登录
        </button>
        <button
          :class="{ active: tab === 'qr' }"
          :aria-pressed="tab === 'qr'"
          @click="tab = 'qr'"
        >
          <Icon name="scan" :size="16" />扫码登录
        </button>
        <button
          :class="{ active: tab === 'cookie' }"
          :aria-pressed="tab === 'cookie'"
          @click="tab = 'cookie'"
        >
          Cookie 登录
        </button>
      </nav>
      <p class="login-footnote">网盘桌面 · 第三方客户端</p>
    </div>
  </a-modal>
</template>
