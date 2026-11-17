<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { storeToRefs } from "pinia";
import { message } from "ant-design-vue";
import { useDisk } from "../store";
import { call, bytes } from "../api";
import type { FileEntry } from "../types";
import Icon from "../components/Icon.vue";
import FileIcon from "../components/FileIcon.vue";
import EmptyIllustration from "../components/EmptyIllustration.vue";
import FileContextMenu from "../components/FileContextMenu.vue";
import FileBreadcrumb from "../components/FileBreadcrumb.vue";
import FileDeleteDialog from "../components/FileDeleteDialog.vue";
import sortCheck from "../assets/official/controls/sort-check.svg";
import headerSortDefault from "../assets/official/controls/header-sort-default.svg";
import headerSortActive from "../assets/official/controls/header-sort-active.svg";
import { useFileColumns } from "../composables/useFileColumns";
const {
  table: fileTable,
  widths: columnWidths,
  resizing: resizingColumn,
  minimums: columnMinimums,
  tableStyle,
  start: startColumnResize,
  stop: stopColumnResize,
  keyboard: resizeColumnWithKeyboard,
} = useFileColumns();
const columns = [
  { key: "name", label: "文件名", sortable: true },
  { key: "size", label: "大小", sortable: true },
  { key: "type", label: "类型", sortable: false },
  { key: "time", label: "修改时间", sortable: true },
];
const store = useDisk(),
  files = ref<FileEntry[]>([]),
  selected = ref<number[]>([]),
  loading = ref(false),
  error = ref(""),
  page = ref(1),
  hasMore = ref(false),
  grid = ref(false),
  category = ref(0),
  sort = ref("name"),
  desc = ref(false);
watch(grid, stopColumnResize);
const edit = ref<"mkdir" | "rename" | "move" | null>(null),
  input = ref(""),
  saving = ref(false),
  dragging = ref(false);
let request = 0;
let menuGeneration = 0;
const context = ref<{
  x: number;
  y: number;
  blank: boolean;
  key: number;
} | null>(null);
let contextOrigin: HTMLElement | null = null;
function closeContext() {
  context.value = null;
  if (document.activeElement?.closest(".file-context-menu"))
    contextOrigin?.focus({ preventScroll: true });
}
function showContext(event: MouseEvent, file?: FileEntry) {
  if (!store.user) return;
  if (file && !selected.value.includes(file.fs_id))
    selected.value = [file.fs_id];
  if (!file) selected.value = [];
  contextOrigin = event.currentTarget as HTMLElement;
  const rect = contextOrigin.getBoundingClientRect();
  context.value = {
    x: event.clientX || rect.left + 24,
    y: event.clientY || rect.top + 24,
    blank: !file,
    key: ++menuGeneration,
  };
}
function rowAction(file: FileEntry, action: () => unknown) {
  selected.value = [file.fs_id];
  action();
}
const menuItems = computed(() => {
  if (context.value?.blank)
    return [
      { label: "上传文件", action: () => upload(false) },
      { label: "上传文件夹", action: () => upload(true) },
      { label: "新建文件夹", action: () => beginEdit("mkdir"), divider: true },
      { label: "刷新", action: () => load() },
    ];
  return [
    ...(chosen.value.length === 1 && chosen.value[0]?.isdir
      ? [{ label: "打开", action: () => open(chosen.value[0]!) }]
      : []),
    { label: "下载", action: download },
    { label: "删除", action: deleteSelected, divider: true },
    ...(chosen.value.length === 1
      ? [{ label: "重命名", action: () => beginEdit("rename") }]
      : []),
    { label: "移动到", action: () => beginEdit("move") },
  ];
});
const { search, appliedSearch } = storeToRefs(store);
const categories = [
  { id: 0, name: "全部文件", icon: "folder" },
  { id: 1, name: "视频", icon: "video" },
  { id: 3, name: "图片", icon: "image" },
  { id: 4, name: "文档", icon: "files" },
  { id: 2, name: "音乐", icon: "music" },
  { id: 5, name: "压缩包", icon: "zip" },
  { id: 6, name: "其他", icon: "more" },
];
const shown = computed(() =>
  category.value === 0
    ? files.value
    : files.value.filter((f) => f.category === category.value && !f.isdir),
);
const chosen = computed(() =>
  files.value.filter((f) => selected.value.includes(f.fs_id)),
);
const allChecked = computed(
  () =>
    shown.value.length > 0 &&
    shown.value.every((f) => selected.value.includes(f.fs_id)),
);
const crumbs = computed(() => [
  { name: "全部文件", path: "/" },
  ...store.directory
    .split("/")
    .filter(Boolean)
    .map((name, i, parts) => ({
      name,
      path: "/" + parts.slice(0, i + 1).join("/"),
    })),
]);
function formatDate(seconds: number) {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "." +
    pad(d.getMonth() + 1) +
    "." +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}
function iconFor(f: FileEntry) {
  return f.isdir
    ? "folder"
    : (
        { 1: "video", 2: "music", 3: "image", 4: "files", 5: "zip" } as Record<
          number,
          string
        >
      )[f.category] || "files";
}
async function load(reset = true) {
  closeContext();
  const id = ++request;
  if (!store.user) {
    files.value = [];
    selected.value = [];
    return;
  }
  loading.value = true;
  error.value = "";
  if (reset) {
    page.value = 1;
    selected.value = [];
  }
  try {
    const data = await call(
      appliedSearch.value ? "files:search" : "files:list",
      appliedSearch.value
        ? { key: appliedSearch.value, page: page.value }
        : {
            dir: store.directory,
            page: page.value,
            order: sort.value,
            desc: desc.value,
          },
    );
    if (id !== request) return;
    files.value = reset ? data.list : [...files.value, ...data.list];
    hasMore.value = data.has_more;
  } catch (e) {
    if (id === request) error.value = (e as Error).message;
  } finally {
    if (id === request) loading.value = false;
  }
}
function toggle(f: FileEntry) {
  selected.value = selected.value.includes(f.fs_id)
    ? selected.value.filter((id) => id !== f.fs_id)
    : [...selected.value, f.fs_id];
}
function navigate(dir: string) {
  category.value = 0;
  store.navigateDirectory(dir);
}
function open(f: FileEntry) {
  if (f.isdir) navigate(f.path);
  else {
    selected.value = [f.fs_id];
    message.info("首版暂不提供在线预览，可下载后打开");
  }
}
function activateListName(event: MouseEvent, file: FileEntry) {
  if (file.isdir) {
    // The second click of a double-click must not enter the next folder too.
    if (event.detail <= 1) open(file);
  } else toggle(file);
}
function beginEdit(type: "mkdir" | "rename" | "move") {
  edit.value = type;
  input.value =
    type === "rename"
      ? chosen.value[0]?.server_filename || ""
      : type === "move"
        ? "/"
        : "";
}
async function saveEdit() {
  saving.value = true;
  try {
    let result;
    if (edit.value === "mkdir")
      result = await call("files:mkdir", {
        dir: store.directory,
        name: input.value,
      });
    if (edit.value === "rename")
      result = await call("files:rename", {
        path: chosen.value[0]?.path,
        id: chosen.value[0]?.fs_id,
        name: input.value,
      });
    if (edit.value === "move")
      result = await call("files:move", {
        items: chosen.value.map((f) => ({
          path: f.path,
          name: f.server_filename,
        })),
        dest: input.value,
      });
    if (result?.kind === "failed")
      throw new Error(result.message || "操作未完成");
    edit.value = null;
    message.success("操作成功");
    await load();
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}
async function download() {
  try {
    const result = await call("download", {
      items: chosen.value.map((f) => ({
        fs_id: f.fs_id,
        path: f.path,
        name: f.server_filename,
        is_dir: !!f.isdir,
        size: f.size,
      })),
    });
    if (result.failed?.length)
      message.warning(`${result.failed.length} 项未能加入下载，请重试`);
    else message.success("已加入下载列表");
    await store.refreshTasks();
  } catch (e) {
    message.error((e as Error).message);
  }
}
const deletePaths = ref<string[]>([]),
  deleting = ref(false);
function deleteSelected() {
  if (deletePaths.value.length || deleting.value) return;
  deletePaths.value = chosen.value.map((f) => f.path);
}
async function confirmDelete() {
  if (!deletePaths.value.length || deleting.value) return;
  deleting.value = true;
  try {
    const result = await call("files:delete", {
      paths: [...deletePaths.value],
    });
    deletePaths.value = [];
    if (result.failed_paths?.length)
      message.warning(`${result.failed_paths.length} 个项目未能删除`);
    else message.success("已移入回收站");
    await load();
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    deleting.value = false;
  }
}
async function upload(folder = false) {
  try {
    const result = await call("upload:choose", {
      dir: store.directory,
      folder,
    });
    if (result?.length) message.success("已加入上传列表");
  } catch (e) {
    message.error((e as Error).message);
  }
}
async function drop(e: DragEvent) {
  dragging.value = false;
  if (!store.user) {
    store.loginOpen = true;
    return;
  }
  try {
    const paths = Array.from(e.dataTransfer?.files || [])
      .map((f) => window.desktop.filePath(f))
      .filter(Boolean);
    await call("upload:drop", { paths, dir: store.directory });
    message.success("已加入上传列表");
  } catch (e) {
    message.error((e as Error).message);
  }
}
function sortBy(key: string) {
  if (appliedSearch.value) return;
  desc.value = sort.value === key ? !desc.value : false;
  sort.value = key;
  load();
}
function selectSort(key: string, descending = desc.value) {
  if (appliedSearch.value) return;
  sort.value = key;
  desc.value = descending;
  load();
}
watch(
  () => [store.directory, store.appliedSearch, store.refreshTick],
  () => {
    category.value = 0;
    load();
  },
);
watch(category, () => {
  closeContext();
  selected.value = [];
});
watch(grid, closeContext);
watch(
  () => store.user?.uid,
  () => load(),
  { immediate: true },
);
</script>
<template>
  <div class="files-page">
    <section
      class="file-area"
      @dragover.prevent="dragging = true"
      @dragleave.self="dragging = false"
      @drop.prevent="drop"
    >
      <nav class="file-top-nav" aria-label="文件导航">
        <button class="active" @click="navigate('/')">全部</button>
        <a-dropdown :trigger="['click']"
          ><button class="file-filter" title="筛选文件类型">
            <Icon name="settings" :size="15" />{{
              category ? categories.find((c) => c.id === category)?.name : ""
            }}</button
          ><template #overlay
            ><a-menu
              ><a-menu-item
                v-for="item in categories"
                :key="item.id"
                @click="category = item.id"
                >{{ item.name }}</a-menu-item
              ></a-menu
            ></template
          ></a-dropdown
        >
      </nav>
      <div class="file-toolbar">
        <a-dropdown :trigger="['click']" :disabled="!store.user"
          ><a-button type="primary" :disabled="!store.user"
            ><Icon name="upload" :size="16" /> 上传 </a-button
          ><template #overlay
            ><a-menu
              ><a-menu-item @click="upload(false)">上传文件</a-menu-item
              ><a-menu-item @click="upload(true)"
                >上传文件夹</a-menu-item
              ></a-menu
            ></template
          ></a-dropdown
        ><a-button :disabled="!store.user" @click="beginEdit('mkdir')"
          ><Icon name="folder-plus" :size="16" />新建文件夹</a-button
        >
        <div class="toolbar-space" />
        <div
          v-if="selected.length"
          class="selection-actions"
          aria-label="选中文件操作"
        >
          <button title="下载" @click="download">
            <Icon name="download" :size="17" />
          </button>
          <button
            v-if="selected.length === 1"
            title="重命名"
            @click="beginEdit('rename')"
          >
            <Icon name="edit" :size="17" />
          </button>
          <button title="移动到" @click="beginEdit('move')">
            <Icon name="move" :size="17" />
          </button>
          <button title="删除" @click="deleteSelected">
            <Icon name="trash" :size="17" />
          </button>
        </div>
        <a-dropdown
          :trigger="['hover', 'click']"
          :disabled="!store.user || !!appliedSearch"
          overlay-class-name="file-sort-dropdown"
        >
          <button
            class="view-control"
            title="排序"
            :disabled="!store.user || !!appliedSearch"
          >
            <Icon name="sort" :size="16" />
          </button>
          <template #overlay>
            <a-menu :selected-keys="[sort, desc ? 'desc' : 'asc']">
              <a-menu-item
                v-for="item in [
                  { key: 'name', label: '按文件名' },
                  { key: 'size', label: '按文件大小' },
                  { key: 'time', label: '按修改时间' },
                ]"
                :key="item.key"
                @click="selectSort(item.key)"
              >
                <span class="sort-option"
                  >{{ item.label
                  }}<img v-if="sort === item.key" :src="sortCheck" alt=""
                /></span>
              </a-menu-item>
              <a-menu-divider />
              <a-menu-item
                v-for="item in [
                  { key: 'asc', label: '正序' },
                  { key: 'desc', label: '倒序' },
                ]"
                :key="item.key"
                @click="selectSort(sort, item.key === 'desc')"
              >
                <span class="sort-option"
                  >{{ item.label
                  }}<img
                    v-if="desc === (item.key === 'desc')"
                    :src="sortCheck"
                    alt=""
                /></span>
              </a-menu-item> </a-menu
          ></template>
        </a-dropdown>
        <div class="view-switch" aria-label="文件视图">
          <button
            title="列表视图"
            :aria-pressed="!grid"
            :class="{ active: !grid }"
            @click="grid = false"
          >
            <Icon name="list" :size="16" />
          </button>
          <button
            title="网格视图"
            :aria-pressed="grid"
            :class="{ active: grid }"
            @click="grid = true"
          >
            <Icon name="grid" :size="16" />
          </button>
        </div>
        <button
          class="view-control"
          title="刷新文件列表"
          :disabled="!store.user || loading"
          @click="load()"
        >
          <Icon name="refresh" :size="18" />
        </button>
      </div>
      <FileBreadcrumb
        v-if="store.directory !== '/' || appliedSearch"
        :items="crumbs"
        :search="appliedSearch"
        @navigate="navigate"
      />
      <div v-if="error" class="inline-error">
        {{ error }}<a-button type="link" @click="load()">重试</a-button>
      </div>
      <div v-if="!store.user" class="empty-state">
        <EmptyIllustration />
        <h3>登录，查看你的网盘文件</h3>
        <p>在这里管理文件，随时上传与下载</p>
        <a-button
          type="primary"
          :disabled="store.backend.state !== 'ready'"
          @click="store.loginOpen = true"
          >登录百度账号</a-button
        >
        <p v-if="store.backend.error" class="error-text">
          {{ store.backend.error }}
        </p>
      </div>
      <div
        v-else
        class="file-list-viewport"
        @contextmenu.prevent="showContext($event)"
      >
        <a-spin :spinning="loading" class="file-spin"
          ><div v-if="!shown.length && !loading && !error" class="empty-state">
            <EmptyIllustration />
            <h3>{{ appliedSearch ? "没有找到相关文件" : "这里还没有文件" }}</h3>
            <p>
              {{
                category
                  ? "当前已加载文件中没有此类型，可继续加载更多文件"
                  : "点击上传，或将文件拖到这里"
              }}
            </p>
          </div>
          <template v-else-if="grid">
            <div class="file-grid-header">
              <div class="check-cell">
                <a-checkbox
                  aria-label="全选文件"
                  :checked="allChecked"
                  :indeterminate="selected.length > 0 && !allChecked"
                  @change="
                    selected = allChecked ? [] : shown.map((f) => f.fs_id)
                  "
                />
              </div>
              <span>文件名</span>
              <span class="selection-count">{{
                selected.length
                  ? `已选中${selected.length}个文件/文件夹`
                  : `${hasMore ? "已加载前" : "已全部加载，共"}${shown.length}个`
              }}</span>
            </div>
            <div
              class="file-grid"
              :class="{ 'has-selection': selected.length }"
              @click.self="selected = []"
            >
              <div
                v-for="f in shown"
                :key="f.fs_id"
                class="file-card"
                :class="{ selected: selected.includes(f.fs_id) }"
                tabindex="0"
                :aria-label="f.server_filename"
                @click="toggle(f)"
                @dblclick="open(f)"
                @keydown.enter.self.prevent="open(f)"
                @keydown.space.self.prevent="toggle(f)"
                @contextmenu.stop.prevent="showContext($event, f)"
              >
                <div class="file-card-artwork">
                  <FileIcon
                    :name="f.server_filename"
                    :folder="!!f.isdir"
                    :category="f.category"
                    :size="74"
                  />
                  <div
                    class="file-card-check"
                    @click.stop
                    @dblclick.stop
                    @keydown.stop
                  >
                    <a-checkbox
                      :aria-label="`选择 ${f.server_filename}`"
                      :checked="selected.includes(f.fs_id)"
                      @change="toggle(f)"
                    />
                  </div>
                </div>
                <span class="file-card-name" :title="f.server_filename">{{
                  f.server_filename
                }}</span>
              </div>
            </div>
          </template>
          <table v-else ref="fileTable" class="file-table" :style="tableStyle">
            <thead>
              <tr>
                <th class="check-cell">
                  <a-checkbox
                    :checked="allChecked"
                    :indeterminate="selected.length > 0 && !allChecked"
                    @change="
                      selected = allChecked ? [] : shown.map((f) => f.fs_id)
                    "
                  />
                </th>
                <th
                  v-for="(column, columnIndex) in columns"
                  :key="column.key"
                  :class="`${column.key === 'time' ? 'date' : column.key}-cell`"
                  :style="
                    columnWidths
                      ? { width: `${columnWidths[columnIndex]}px` }
                      : undefined
                  "
                  :aria-sort="
                    column.sortable
                      ? sort === column.key
                        ? desc
                          ? 'descending'
                          : 'ascending'
                        : 'none'
                      : undefined
                  "
                >
                  <div class="file-header-content">
                    <button
                      v-if="column.sortable"
                      class="file-header-sort"
                      :disabled="!!appliedSearch"
                      @click="sortBy(column.key)"
                    >
                      {{ column.label }}
                      <img
                        v-if="!appliedSearch"
                        class="file-header-arrow"
                        :class="{
                          active: sort === column.key,
                          ascending: sort === column.key && !desc,
                        }"
                        :src="
                          sort === column.key
                            ? headerSortActive
                            : headerSortDefault
                        "
                        alt=""
                        draggable="false"
                      />
                    </button>
                    <span v-else>{{ column.label }}</span>
                    <span
                      v-if="column.key === 'name' && selected.length"
                      class="selection-count"
                      >已选中{{ selected.length }}个文件/文件夹</span
                    >
                    <span
                      v-else-if="column.key === 'name' && store.user"
                      class="selection-count"
                      >{{ hasMore ? "已加载前" : "已全部加载，共"
                      }}{{ shown.length }}个</span
                    >
                  </div>
                  <span
                    class="file-column-resizer"
                    :class="{ active: resizingColumn === columnIndex }"
                    role="separator"
                    aria-orientation="vertical"
                    :aria-label="`调整${column.label}列宽`"
                    :aria-valuemin="columnMinimums[columnIndex]"
                    :aria-valuenow="
                      columnWidths
                        ? Math.round(columnWidths[columnIndex]!)
                        : undefined
                    "
                    tabindex="0"
                    @pointerdown.stop.prevent="
                      startColumnResize($event, columnIndex)
                    "
                    @click.stop.prevent
                    @dblclick.stop.prevent
                    @keydown.stop="
                      resizeColumnWithKeyboard($event, columnIndex)
                    "
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="f in shown"
                :key="f.fs_id"
                :class="{ selected: selected.includes(f.fs_id) }"
                @click="toggle(f)"
                @dblclick="open(f)"
                tabindex="0"
                @contextmenu.stop.prevent="showContext($event, f)"
              >
                <td class="check-cell" @click.stop>
                  <a-checkbox
                    :checked="selected.includes(f.fs_id)"
                    @change="toggle(f)"
                  />
                </td>
                <td class="file-name-cell">
                  <div class="file-name-content">
                    <button
                      class="file-name"
                      @click.stop="activateListName($event, f)"
                      @dblclick.stop="!f.isdir && open(f)"
                    >
                      <span
                        class="file-symbol"
                        :class="iconFor(f)"
                        @click.stop="toggle(f)"
                        ><FileIcon
                          :name="f.server_filename"
                          :folder="!!f.isdir"
                          :category="f.category"
                          :size="32" /></span
                      ><span :title="f.server_filename">{{
                        f.server_filename
                      }}</span>
                    </button>
                    <div class="file-hover-actions" @click.stop @dblclick.stop>
                      <button title="下载" @click="rowAction(f, download)">
                        <Icon name="download" :size="17" />
                      </button>
                      <button
                        title="删除"
                        @click="rowAction(f, deleteSelected)"
                      >
                        <Icon name="trash" :size="17" />
                      </button>
                      <button
                        title="更多"
                        aria-haspopup="menu"
                        @click="showContext($event, f)"
                      >
                        <Icon name="more" :size="18" />
                      </button>
                    </div>
                  </div>
                </td>
                <td class="muted">{{ f.isdir ? "—" : bytes(f.size) }}</td>
                <td class="muted">
                  {{
                    f.isdir
                      ? "文件夹"
                      : categories.find((c) => c.id === f.category)?.name ||
                        "文件"
                  }}
                </td>
                <td class="muted">
                  {{ formatDate(f.server_mtime) }}
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="hasMore" class="load-more">
            <a-button
              :loading="loading"
              @click="
                page++;
                load(false);
              "
              >加载更多</a-button
            >
          </div>
        </a-spin>
      </div>
      <div v-if="dragging" class="drop-overlay">
        <Icon name="upload" :size="52" />
        <h2>松开即可上传</h2>
        <p>上传至 {{ store.directory }}</p>
      </div>
    </section>
    <FileContextMenu
      v-if="context"
      :key="context.key"
      :x="context.x"
      :y="context.y"
      :items="menuItems"
      @close="closeContext"
    />
    <a-modal
      :open="!!edit"
      :title="
        edit === 'mkdir'
          ? '新建文件夹'
          : edit === 'rename'
            ? '重命名'
            : '移动到'
      "
      :confirm-loading="saving"
      ok-text="确定"
      cancel-text="取消"
      @ok="saveEdit"
      @cancel="edit = null"
      ><p v-if="edit === 'move'" class="hint">
        输入目标网盘目录的完整路径，同名文件默认保留两份。
      </p>
      <a-input
        v-model:value="input"
        :placeholder="edit === 'move' ? '/目标文件夹' : '输入名称'"
        @pressEnter="saveEdit"
    /></a-modal>
    <FileDeleteDialog
      :open="deletePaths.length > 0"
      :busy="deleting"
      @confirm="confirmDelete"
      @cancel="!deleting && (deletePaths = [])"
    />
  </div>
</template>
