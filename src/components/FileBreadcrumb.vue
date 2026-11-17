<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import arrow from "../assets/official/controls/breadcrumb-arrow.svg";
const props = defineProps<{
  items: { name: string; path: string }[];
  search?: string;
}>();
const emit = defineEmits<{ navigate: [path: string] }>();
const track = ref<HTMLElement>(),
  probe = ref<HTMLElement>();
const collapsed = ref(false);
let observer: ResizeObserver | undefined;
function measure() {
  collapsed.value =
    props.items.length > 3 &&
    !!track.value &&
    !!probe.value &&
    probe.value.scrollWidth > track.value.clientWidth;
}
const visible = computed(() =>
  collapsed.value
    ? [props.items[0]!, null, ...props.items.slice(-2)]
    : props.items,
);
const hidden = computed(() => props.items.slice(1, -2));
watch(
  () => props.items,
  async () => {
    await nextTick();
    measure();
  },
);
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (track.value) observer.observe(track.value);
  if (probe.value) observer.observe(probe.value);
  measure();
});
onUnmounted(() => observer?.disconnect());
function navigate(path: string) {
  if (path !== props.items.at(-1)?.path || props.search) emit("navigate", path);
}
</script>
<template>
  <nav class="breadcrumb" aria-label="目录路径">
    <div ref="track" class="breadcrumb-track">
      <template
        v-for="(item, index) in visible"
        :key="item?.path || 'overflow'"
      >
        <img v-if="index" class="crumb-divider" :src="arrow" alt="" />
        <a-dropdown
          v-if="!item"
          :trigger="['hover', 'click']"
          overlay-class-name="breadcrumb-overflow"
        >
          <button class="crumb-overflow" aria-label="展开中间目录">...</button>
          <template #overlay>
            <a-menu>
              <a-menu-item
                v-for="ancestor in hidden"
                :key="ancestor.path"
                @click="navigate(ancestor.path)"
              >
                <span :title="ancestor.name">{{ ancestor.name }}</span>
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
        <button
          v-else-if="item.path !== items.at(-1)?.path || search"
          class="crumb-ancestor"
          :class="{ 'crumb-root': index === 0 }"
          :title="item.name"
          @click="navigate(item.path)"
        >
          {{ item.name }}
        </button>
        <span
          v-else
          class="crumb-current"
          :title="item.name"
          aria-current="page"
          >{{ item.name }}</span
        >
      </template>
    </div>
    <span v-if="search" class="crumb-search" :title="search"
      >搜索“{{ search }}”</span
    >
    <div ref="probe" class="breadcrumb-probe" aria-hidden="true">
      <template v-for="(item, index) in items" :key="item.path">
        <img v-if="index" class="crumb-divider" :src="arrow" alt="" />
        <span>{{ item.name }}</span>
      </template>
    </div>
  </nav>
</template>
