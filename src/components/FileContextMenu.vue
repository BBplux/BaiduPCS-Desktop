<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";
const props = defineProps<{
  x: number;
  y: number;
  items: { label: string; action: () => unknown; divider?: boolean }[];
}>();
const emit = defineEmits<{ close: [] }>();
const menu = ref<HTMLElement>();
const position = ref({
  left: "0px",
  top: "0px",
  visibility: "hidden" as "hidden" | "visible",
});
function dismiss(event: Event) {
  if (!menu.value?.contains(event.target as Node)) emit("close");
}
function close() {
  emit("close");
}
function keyboard(event: KeyboardEvent) {
  const buttons = [
    ...menu.value!.querySelectorAll<HTMLButtonElement>("button"),
  ];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    close();
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[index]?.focus();
  }
}
onMounted(async () => {
  await nextTick();
  const element = menu.value;
  if (!element) return;
  const { x, y } = props;
  position.value = {
    left: `${Math.max(8, Math.min(x, innerWidth - element.offsetWidth - 8))}px`,
    top: `${Math.max(8, Math.min(y, innerHeight - element.offsetHeight - 8))}px`,
    visibility: "visible",
  };
  await nextTick();
  if (!menu.value) return;
  element
    .querySelector<HTMLButtonElement>("button")
    ?.focus({ preventScroll: true });
  window.addEventListener("pointerdown", dismiss, true);
  window.addEventListener("scroll", dismiss, true);
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);
});
onUnmounted(() => {
  window.removeEventListener("pointerdown", dismiss, true);
  window.removeEventListener("scroll", dismiss, true);
  window.removeEventListener("blur", close);
  window.removeEventListener("resize", close);
});
</script>
<template>
  <Teleport to="body">
    <div
      ref="menu"
      class="file-context-menu"
      role="menu"
      aria-label="文件操作"
      :data-x="x"
      :data-y="y"
      :style="position"
      @contextmenu.prevent
      @keydown="keyboard"
    >
      <template v-for="item in items" :key="item.label">
        <div v-if="item.divider" role="separator" class="context-separator" />
        <button
          role="menuitem"
          @click="
            emit('close');
            item.action();
          "
        >
          {{ item.label }}
        </button>
      </template>
    </div>
  </Teleport>
</template>
