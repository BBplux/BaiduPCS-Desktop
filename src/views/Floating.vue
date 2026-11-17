<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { useDisk } from "../store";
import { bytes, call } from "../api";
import Icon from "../components/Icon.vue";
const store = useDisk(),
  note = ref(""),
  drag = ref(false);
let pointer:
  | { id: number; x: number; y: number; target: HTMLElement; moved: boolean }
  | undefined;
let suppressDoubleClickUntil = 0;
const report = (error: unknown) => {
  note.value = (error as Error).message;
};
function pointerDown(event: PointerEvent) {
  if (
    event.button !== 0 ||
    (event.target as HTMLElement).closest(".floating-close")
  )
    return;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  pointer = {
    id: event.pointerId,
    x: event.screenX,
    y: event.screenY,
    target,
    moved: false,
  };
  call("float:pointer", { phase: "start" }).catch(report);
}
function pointerMove(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return;
  if (Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) >= 4)
    pointer.moved = true;
  call("float:pointer", { phase: "move" }).catch(report);
}
function pointerEnd() {
  if (!pointer) return;
  const current = pointer;
  pointer = undefined;
  if (current.moved) suppressDoubleClickUntil = Date.now() + 400;
  if (current.target.hasPointerCapture(current.id))
    current.target.releasePointerCapture(current.id);
  call("float:pointer", { phase: "end" }).catch(report);
}
function openMain() {
  if (Date.now() >= suppressDoubleClickUntil)
    call("window:show", {}).catch(report);
}
function contextMenu() {
  pointerEnd();
  call("float:menu").catch(report);
}
onUnmounted(pointerEnd);
async function drop(event: DragEvent) {
  drag.value = false;
  try {
    if (!store.user) {
      await call("window:show", { route: "/files" });
      note.value = "请先在主窗口登录";
      return;
    }
    const paths = Array.from(event.dataTransfer?.files || [])
      .map((f) => window.desktop.filePath(f))
      .filter(Boolean);
    await call("upload:drop", { paths, dir: "/" });
    note.value = "已加入上传队列";
  } catch (e) {
    note.value = (e as Error).message;
  }
  setTimeout(() => (note.value = ""), 4000);
}
</script>
<template>
  <div
    class="floating-panel"
    :class="{ drag }"
    role="button"
    tabindex="0"
    title="拖动悬浮窗，双击打开主面板，右键打开菜单"
    @pointerdown="pointerDown"
    @pointermove="pointerMove"
    @pointerup="pointerEnd"
    @pointercancel="pointerEnd"
    @lostpointercapture="pointerEnd"
    @dblclick="openMain"
    @keydown.enter.prevent="openMain"
    @keydown.space.prevent="openMain"
    @contextmenu.prevent="contextMenu"
    @dragover.prevent="drag = true"
    @dragleave="drag = false"
    @drop.prevent="drop"
  >
    <div class="floating-grip" title="拖动悬浮窗">
      <Icon name="floating-brand" />
    </div>
    <div class="floating-speeds">
      <template v-if="note || drag"
        ><small>{{ drag ? "松开上传到根目录" : note }}</small></template
      ><small v-else-if="store.backend.state === 'failed'"
        >连接中断，双击查看</small
      ><small v-else-if="store.backend.connection === 'polling'"
        >正在重新连接</small
      ><template v-else-if="store.speeds.download || store.speeds.upload"
        ><span><i>↓</i>{{ bytes(store.speeds.download) }}/s</span
        ><span><i>↑</i>{{ bytes(store.speeds.upload) }}/s</span></template
      ><span v-else class="floating-idle">拖拽至此上传</span>
    </div>
  </div>
</template>
