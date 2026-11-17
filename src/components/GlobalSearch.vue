<script setup lang="ts">
import { useRouter } from "vue-router";
import { onMounted, onUnmounted } from "vue";
import { useDisk } from "../store";
import Icon from "./Icon.vue";
const store = useDisk(),
  router = useRouter();
async function travel(offset: number) {
  const next = store.historyIndex + offset;
  if (next < 0 || next >= store.directoryHistory.length) return;
  store.travelDirectory(offset);
  await router.push("/files");
}
function mouseHistory(event: MouseEvent) {
  if (event.button !== 3 && event.button !== 4) return;
  // Chromium's mouse history is route history, while the toolbar keeps a
  // directory history. Cancel the browser action on the entire click sequence.
  event.preventDefault();
  event.stopPropagation();
  if (event.type === "mouseup") void travel(event.button === 3 ? -1 : 1);
}
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  for (const type of ["mousedown", "mouseup", "auxclick"] as const)
    window.addEventListener(type, mouseHistory, true);
  unsubscribe = window.desktop?.on((event) => {
    if (
      event.type === "directory-history" &&
      (event.offset === -1 || event.offset === 1)
    )
      void travel(event.offset);
  });
});
onUnmounted(() => {
  for (const type of ["mousedown", "mouseup", "auxclick"] as const)
    window.removeEventListener(type, mouseHistory, true);
  unsubscribe?.();
});
async function search() {
  store.appliedSearch = store.search.trim();
  store.refreshTick++;
  await router.push("/files");
}
</script>
<template>
  <div id="header-search">
    <button
      class="icon-button"
      title="后退"
      :disabled="store.historyIndex === 0"
      @click="travel(-1)"
    >
      <Icon name="back" :size="18" />
    </button>
    <button
      class="icon-button forward-button"
      title="前进"
      :disabled="store.historyIndex >= store.directoryHistory.length - 1"
      @click="travel(1)"
    >
      <Icon name="forward" :size="18" />
    </button>
    <button
      class="icon-button"
      title="刷新"
      :disabled="!store.user"
      @click="
        store.refreshTick++;
        router.push('/files');
      "
    >
      <Icon name="refresh" :size="18" />
    </button>
    <a-input
      v-model:value="store.search"
      class="search-input"
      placeholder="搜索网盘文件"
      allow-clear
      @pressEnter="search"
      ><template #prefix><Icon name="search" :size="17" /></template
    ></a-input>
  </div>
</template>
