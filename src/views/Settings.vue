<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { message } from "ant-design-vue";
import { useDisk } from "../store";
import { call } from "../api";
import Icon from "../components/Icon.vue";
const store = useDisk();
const section = ref(useRoute().query.section === "about" ? "about" : "startup");
const sections = [
  { key: "startup", label: "启动设置", icon: "settings-startup" },
  { key: "transfer", label: "传输设置", icon: "settings-transfer" },
  { key: "about", label: "关于", icon: "settings-about" },
];
const saving = ref(false);
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  unsubscribe = window.desktop.on((event) => {
    if (
      event.type === "settings-section" &&
      sections.some((s) => s.key === event.section)
    )
      section.value = event.section;
  });
});
onUnmounted(() => unsubscribe?.());
async function save(key: string, value: unknown) {
  saving.value = true;
  try {
    store.settings = await call("settings:save", { [key]: value });
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
async function choose() {
  saving.value = true;
  try {
    store.settings = await call("directory:choose");
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <div class="preferences-window">
    <header class="preferences-caption">
      <h1><Icon name="settings-caption" :size="22" />网盘设置</h1>
      <button title="关闭设置" @click="call('settings:close')">
        <Icon name="settings-close" :size="20" />
      </button>
    </header>
    <nav class="preferences-nav" aria-label="设置分类">
      <button
        v-for="item in sections"
        :key="item.key"
        :class="{ active: section === item.key }"
        :aria-current="section === item.key ? 'page' : undefined"
        @click="section = item.key"
      >
        <Icon :name="item.icon" :size="16" />{{ item.label }}
      </button>
    </nav>
    <main v-if="store.settings" class="preferences-content">
      <h2>{{ sections.find((s) => s.key === section)?.label }}</h2>
      <div v-if="section === 'startup'" class="preferences-checks">
        <a-checkbox
          :disabled="saving"
          :checked="store.settings.startAtLogin"
          @change="save('startAtLogin', $event.target.checked)"
          >开机自动启动</a-checkbox
        >
        <a-checkbox
          :disabled="saving"
          :checked="store.settings.floatEnabled"
          @change="save('floatEnabled', $event.target.checked)"
          >显示悬浮窗</a-checkbox
        >
        <a-checkbox
          :disabled="saving"
          :checked="store.settings.closeToTray"
          @change="save('closeToTray', $event.target.checked)"
          >关闭主窗口后驻留系统托盘</a-checkbox
        >
        <a-checkbox
          :disabled="saving"
          :checked="store.settings.confirmExit"
          @change="save('confirmExit', $event.target.checked)"
          >退出时提示未完成的传输任务</a-checkbox
        >
      </div>
      <template v-else-if="section === 'transfer'">
        <section class="preferences-group">
          <h3>存储</h3>
          <div class="preferences-field path-field">
            <label for="download-directory">下载位置</label
            ><a-input
              id="download-directory"
              :value="store.settings.downloadDir"
              :title="store.settings.downloadDir"
              readonly
            /><a-button :disabled="saving" @click="choose">浏览</a-button>
          </div>
        </section>
        <section class="preferences-group">
          <h3>传输任务</h3>
          <a-checkbox
            :disabled="saving"
            :checked="store.settings.autoResume"
            @change="save('autoResume', $event.target.checked)"
            >启动后自动继续传输</a-checkbox
          >
          <p class="preferences-help">
            关闭此选项时，启动后仅恢复任务列表，可手动开始。
          </p>
        </section>
        <section class="preferences-group">
          <h3>同名文件</h3>
          <div class="preferences-field">
            <label for="download-conflict">下载时</label
            ><a-select
              id="download-conflict"
              :disabled="saving"
              :value="store.settings.downloadConflict"
              :options="[
                { value: 'auto_rename', label: '自动重命名，保留两份' },
                { value: 'skip', label: '跳过' },
                { value: 'overwrite', label: '覆盖' },
              ]"
              @change="(v: unknown) => save('downloadConflict', v)"
            />
          </div>
          <div class="preferences-field">
            <label for="upload-conflict">上传时</label
            ><a-select
              id="upload-conflict"
              :disabled="saving"
              :value="store.settings.uploadConflict"
              :options="[
                { value: 'auto_rename', label: '自动重命名，保留两份' },
                { value: 'smart_dedup', label: '智能去重' },
                { value: 'overwrite', label: '覆盖' },
              ]"
              @change="(v: unknown) => save('uploadConflict', v)"
            />
          </div>
        </section>
      </template>
      <section v-else class="preferences-about">
        <Icon name="cloud" :size="48" />
        <h3>网盘桌面</h3>
        <p>0.1.0 · 第三方客户端</p>
        <p>界面参考最新版百度网盘</p>
        <p>BaiduPCS-Rust {{ store.backend.version }}</p>
        <p>无广告，不采集使用行为。账号 Cookie 保存在本机。</p>
        <p :class="{ 'error-text': store.backend.state === 'failed' }">
          后台：{{
            store.backend.state === "ready"
              ? "已连接"
              : store.backend.error || "正在启动"
          }}
        </p>
      </section>
    </main>
  </div>
</template>
