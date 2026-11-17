<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import { useDisk } from "./store";
import { bytes, call } from "./api";
import Icon from "./components/Icon.vue";
import Login from "./components/Login.vue";
import GlobalSearch from "./components/GlobalSearch.vue";
const store = useDisk(),
  route = useRoute(),
  router = useRouter();
const floating = computed(() => route.path === "/float");
const auxiliary = computed(() => floating.value || route.path === "/settings");
let unsubscribe: (() => void) | undefined;
const restarting = ref(false);
async function restartBackend() {
  restarting.value = true;
  try {
    await call("backend:restart");
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    restarting.value = false;
  }
}
async function logout() {
  Modal.confirm({
    title: "退出当前账号？",
    content: "传输将暂停，客户端和官方登录网页的会话将被清除。",
    okText: "退出账号",
    cancelText: "取消",
    onOk: async () => {
      await call("auth:logout");
      store.user = null;
      store.tasks = [];
    },
  });
}
onMounted(async () => {
  unsubscribe = window.desktop?.on(async (event) => {
    if (event.type === "navigate" && !auxiliary.value) {
      if (event.route === "/settings") await call("settings:open");
      else router.push(event.route);
    }
    if (event.type === "settings") store.settings = event.settings;
    if (event.type === "floating-upload" && !auxiliary.value) {
      if (!store.user) {
        store.loginOpen = true;
        return;
      }
      try {
        const added = await call("upload:choose", { dir: "/", folder: false });
        if (added?.length) {
          await store.refreshTasks();
          router.push("/transfers");
        }
      } catch (error) {
        message.error((error as Error).message);
      }
    }
    if (event.type === "tasks") store.acceptTasks(event.tasks);
    if (event.type === "tasks-changed") store.refreshTasks().catch(() => {});
    if (event.type === "backend") {
      const previous = store.backend.state;
      store.backend = event.status;
      if (event.status.state === "ready" && previous !== "ready")
        await store.refreshUser();
    }
    if (event.type === "logged-in") {
      store.user = event.user;
      store.loginOpen = false;
      if (!auxiliary.value) {
        router.push("/files");
        message.success("登录成功");
      }
    }
    if (event.type === "logged-out") {
      store.user = null;
      store.acceptTasks([]);
    }
    if (event.type === "login-error") message.error(event.message);
    if (event.type === "recovery-error" && !floating.value)
      message.error(event.message);
  });
  try {
    await store.initialize();
  } catch (e) {
    message.error((e as Error).message);
  }
});
onUnmounted(() => unsubscribe?.());
</script>
<template>
  <a-config-provider
    :theme="{
      token: {
        colorPrimary: '#258aff',
        borderRadius: 6,
        fontFamily: 'Microsoft YaHei UI, Microsoft YaHei, sans-serif',
        fontSize: 13,
      },
    }"
  >
    <router-view v-if="auxiliary" />
    <div v-else class="desktop-shell">
      <header class="titlebar">
        <span class="product-name"
          ><Icon name="cloud" :size="16" /> 网盘桌面</span
        >
        <div class="title-spacer" />
        <a-dropdown
          v-if="store.user"
          placement="bottomRight"
          :trigger="['click']"
          ><button
            class="avatar"
            :title="store.user.nickname || store.user.username"
          >
            <Icon name="user" /></button
          ><template #overlay
            ><a-menu
              ><a-menu-item disabled>{{
                store.user.nickname || store.user.username
              }}</a-menu-item
              ><a-menu-item @click="logout">退出账号</a-menu-item></a-menu
            ></template
          ></a-dropdown
        >
        <button
          v-else
          class="avatar"
          title="登录账号"
          @click="store.loginOpen = true"
        >
          <Icon name="user" />
        </button>
        <span class="account-name">{{
          store.user?.nickname || store.user?.username || "未登录"
        }}</span
        ><button title="最小化" @click="call('window:minimize')">
          <Icon name="minus" :size="16" /></button
        ><button title="最大化 / 还原" @click="call('window:maximize')">
          <Icon name="max" :size="14" /></button
        ><button
          class="window-close"
          title="关闭"
          @click="call('window:close')"
        >
          <Icon name="window-close" :size="18" />
        </button>
      </header>
      <div class="global-header">
        <GlobalSearch />
        <div class="title-spacer" />
        <span v-if="store.user?.total_space" class="header-capacity"
          >{{ bytes(store.user.used_space) }} /
          {{ bytes(store.user.total_space) }}</span
        >
        <span
          class="connection-state"
          :title="
            store.backend.error ||
            (store.backend.connection === 'polling'
              ? '实时连接中断，正在重连；任务状态通过定时刷新更新'
              : '后台服务已连接')
          "
        >
          <i class="status-dot" :class="store.backend.state" />
          {{
            store.backend.state === "ready"
              ? store.backend.connection === "polling"
                ? "正在重连"
                : store.backend.connection === "suspended"
                  ? "等待唤醒"
                  : ""
              : store.backend.state === "failed"
                ? "连接失败"
                : "正在连接"
          }}
        </span>
        <button
          v-if="store.backend.state === 'failed'"
          class="backend-retry"
          :disabled="restarting"
          @click="restartBackend"
        >
          {{ restarting ? "正在恢复…" : "重新连接" }}
        </button>
        <a-dropdown
          :trigger="['click']"
          placement="bottomRight"
          overlay-class-name="main-menu"
        >
          <button class="icon-button" title="主菜单" aria-label="主菜单">
            <Icon name="menu" :size="20" />
          </button>
          <template #overlay
            ><a-menu>
              <a-menu-item @click="call('settings:open')"
                ><Icon name="settings" :size="17" />设置</a-menu-item
              >
              <a-menu-item @click="call('settings:open', { section: 'about' })"
                ><Icon name="info" :size="17" />关于</a-menu-item
              >
              <a-menu-divider />
              <a-menu-item @click="call('app:quit')"
                ><Icon name="logout" :size="17" />退出</a-menu-item
              >
            </a-menu></template
          >
        </a-dropdown>
      </div>
      <aside class="rail">
        <router-link to="/files" class="rail-item" title="网盘"
          ><Icon name="home" /><span>首页</span></router-link
        >
        <router-link to="/transfers" class="rail-item" title="传输"
          ><span class="rail-icon"
            ><Icon name="transfer" :size="24" /><i
              v-if="store.active.length"
              class="count"
              >{{ store.active.length }}</i
            ></span
          ><span>传输</span></router-link
        >
        <div class="rail-spacer" />
      </aside>
      <div class="workspace">
        <main class="page-content"><router-view /></main>
      </div>
      <Login />
    </div>
  </a-config-provider>
</template>
