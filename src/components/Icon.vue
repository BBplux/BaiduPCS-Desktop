<script setup lang="ts">
import { computed, type Component } from "vue";
import {
  QrcodeOutlined,
  FolderOutlined,
  SortAscendingOutlined,
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  CustomerServiceOutlined,
  UserOutlined,
  CheckOutlined,
  CloseOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  FileZipOutlined,
} from "@ant-design/icons-vue";
import catalog from "../assets/official/ui-assets.json";
const props = defineProps<{ name: string; size?: number }>();
const resources = import.meta.glob<string>(
  ["../assets/official/controls/*", "../assets/official/brand/*"],
  { eager: true, query: "?url", import: "default" },
);
const paths: Record<string, string> = catalog;
function url(key: string) {
  return resources[`../assets/official/${paths[key]}`];
}
const masked = new Set([
  "settings-close",
  "sort",
  "upload",
  "download",
  "folder-plus",
  "pause",
  "play",
  "trash",
  "more",
  "edit",
  "move",
  "list",
  "grid",
  "row-location",
  "row-pause",
  "row-play",
]);
const images: Record<string, string> = {
  "settings-caption": "controls/settings-caption",
  "settings-startup": "controls/settings-startup",
  "settings-transfer": "controls/settings-transfer",
  "settings-about": "controls/settings-about",
  cloud: "brand/tab",
  home: "brand/home",
  "floating-brand": "brand/floating",
  menu: "controls/menu",
  back: "controls/back",
  forward: "controls/forward",
  refresh: "controls/refresh",
  settings: "controls/settings",
  logout: "controls/logout",
  power: "controls/logout",
  minus: "controls/window-min",
  max: "controls/window-max",
  "window-close": "controls/window-close",
  transfer: "controls/transfer",
};
const source = computed(() =>
  url(masked.has(props.name) ? `controls/${props.name}` : images[props.name]),
);
const dimension = computed(() => {
  if (props.name === "settings-close") return 20;
  if (props.name.startsWith("row-")) return 32;
  if (["menu", "back", "forward", "refresh"].includes(props.name)) return 30;
  if (props.name === "floating-brand") return 36;
  if (props.name === "home") return 28;
  if (props.name === "transfer") return 20;
  if (masked.has(props.name))
    return props.size && props.size > 32 ? props.size : 16;
  return props.size || 20;
});
const artworkStyle = computed(() => {
  const key = images[props.name];
  return {
    width: `${dimension.value}px`,
    height: `${dimension.value}px`,
    "--official-normal": `url("${source.value}")`,
    "--official-hover": `url("${url(`${key}-hover`) || source.value}")`,
    "--official-pressed": `url("${url(`${key}-pressed`) || url(`${key}-hover`) || source.value}")`,
    "--official-disabled": `url("${url(`${key}-disabled`) || source.value}")`,
    "--official-selected": `url("${url(`${key}-selected`) || source.value}")`,
  };
});
// Unconfirmed locations keep their existing library fallback. Do not select
// another official asset solely because its name looks relevant.
const fallback: Record<string, Component> = {
  scan: QrcodeOutlined,
  "folder-outline": FolderOutlined,
  sort: SortAscendingOutlined,
  files: FileTextOutlined,
  image: PictureOutlined,
  video: VideoCameraOutlined,
  music: CustomerServiceOutlined,
  user: UserOutlined,
  check: CheckOutlined,
  close: CloseOutlined,
  clock: ClockCircleOutlined,
  info: InfoCircleOutlined,
  zip: FileZipOutlined,
};
</script>
<template>
  <span
    v-if="source"
    class="ui-icon official-icon"
    :class="masked.has(name) ? 'official-mask' : 'official-image'"
    :data-official-src="source"
    :style="artworkStyle"
    aria-hidden="true"
  />
  <span
    v-else-if="name === 'search'"
    class="ui-icon official-font"
    aria-hidden="true"
    :style="{ fontSize: `${size || 20}px` }"
    >&#xe689;</span
  >
  <component
    v-else
    :is="fallback[name] || FileTextOutlined"
    class="ui-icon"
    :style="{
      fontSize: `${size || 20}px`,
      width: `${size || 20}px`,
      height: `${size || 20}px`,
    }"
    aria-hidden="true"
  />
</template>
