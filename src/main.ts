import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import Antd from "ant-design-vue";
import "ant-design-vue/dist/reset.css";
import "./style.css";
import App from "./App.vue";
import Files from "./views/Files.vue";
import Transfers from "./views/Transfers.vue";
import Settings from "./views/Settings.vue";
import Floating from "./views/Floating.vue";
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/files" },
    { path: "/files", component: Files },
    { path: "/transfers", component: Transfers },
    { path: "/settings", component: Settings },
    { path: "/float", component: Floating },
  ],
});
createApp(App).use(createPinia()).use(router).use(Antd).mount("#app");
