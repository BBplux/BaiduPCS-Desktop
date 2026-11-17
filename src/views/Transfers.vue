<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import { useDisk } from "../store";
import { call, bytes, done, taskName, progress } from "../api";
import type { Task } from "../types";
import headerSortActive from "../assets/official/controls/header-sort-active.svg";
import Icon from "../components/Icon.vue";
import FileIcon from "../components/FileIcon.vue";
import EmptyIllustration from "../components/EmptyIllustration.vue";
const store = useDisk(),
  kind = ref<"download" | "upload">("download"),
  completed = ref(false),
  batchBusy = ref(false),
  busy = ref(new Set<string>());
const router = useRouter();
const kindTasks = computed(() =>
  store.tasks.filter((t) => t.kind === kind.value),
);
const activeCount = computed(
  () => kindTasks.value.filter((t) => !done(t)).length,
);
const completedCount = computed(() => kindTasks.value.filter(done).length);
const descending = ref(true);
const selected = ref(new Set<string>());
const tasks = computed(() => {
  const list = kindTasks.value.filter((t) => done(t) === completed.value);
  return completed.value
    ? list.sort(
        (a, b) =>
          (descending.value ? -1 : 1) *
          ((a.completed_at || 0) - (b.completed_at || 0)),
      )
    : list;
});
watch([kind, completed], () => selected.value.clear());
const listElement = ref<HTMLElement | null>(null),
  scrollTop = ref(0),
  viewportHeight = ref(640);
let resizeObserver: ResizeObserver | undefined;
watch(listElement, (element) => {
  resizeObserver?.disconnect();
  if (!element) return;
  resizeObserver = new ResizeObserver(() => {
    viewportHeight.value = element.clientHeight;
  });
  resizeObserver.observe(element);
});
onUnmounted(() => resizeObserver?.disconnect());
const virtual = computed(() => tasks.value.length > 120);
const visibleCount = computed(() => Math.ceil(viewportHeight.value / 64) + 10);
const startRow = computed(() =>
  virtual.value
    ? Math.min(
        Math.max(0, tasks.value.length - visibleCount.value),
        Math.max(0, Math.floor((scrollTop.value - 48) / 64) - 5),
      )
    : 0,
);
const visibleTasks = computed(() =>
  virtual.value
    ? tasks.value.slice(startRow.value, startRow.value + visibleCount.value)
    : tasks.value,
);
watch([kind, completed, descending], () => {
  scrollTop.value = 0;
  if (listElement.value) listElement.value.scrollTop = 0;
});
watch(tasks, (list) => {
  const keys = new Set(list.map(key));
  selected.value = new Set([...selected.value].filter((k) => keys.has(k)));
});
const allSelected = computed(
  () =>
    tasks.value.length > 0 &&
    tasks.value.every((t) => selected.value.has(key(t))),
);
function selectTask(t: Task) {
  const k = key(t);
  selected.value.has(k) ? selected.value.delete(k) : selected.value.add(k);
}
function selectAll() {
  selected.value = allSelected.value
    ? new Set()
    : new Set(tasks.value.map(key));
}
function completionTime(t: Task) {
  if (!t.completed_at) return "—";
  const date = new Date(t.completed_at * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString("zh-CN", { hour12: false });
  return `${date.getFullYear() === today.getFullYear() ? "" : date.getFullYear() + "年"}${date.getMonth() + 1}月${date.getDate()}日`;
}
const showProgressColumn = computed(
  () => !completed.value || kind.value === "upload",
);
const canResume = (t: Task) => ["paused", "failed"].includes(t.status);
const canPause = (t: Task) => !done(t) && !canResume(t);
const resumeAvailable = computed(() => tasks.value.some(canResume));
const pauseAvailable = computed(() => tasks.value.some(canPause));
const key = (t: Task) => t.kind + ":" + t.id;
const transferring = (t: Task) =>
  ["downloading", "uploading"].includes(t.status);
const transferred = (t: Task) =>
  (t.kind === "download" ? t.downloaded_size : t.uploaded_size) || 0;
function remaining(t: Task) {
  if (
    !transferring(t) ||
    !Number.isFinite(t.speed) ||
    t.speed <= 0 ||
    !t.total_size
  )
    return "—";
  const seconds = Math.ceil(
    Math.max(0, t.total_size - transferred(t)) / t.speed,
  );
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
async function upload() {
  try {
    const added = await call("upload:choose", { dir: "/", folder: false });
    if (added?.length) {
      completed.value = false;
      await store.refreshTasks();
      message.success("已加入上传列表");
    }
  } catch (error) {
    message.error((error as Error).message);
  }
}
async function openDirectory(t: Task) {
  try {
    if (t.kind === "upload") {
      store.navigateDirectory(
        t.remote_path.slice(0, t.remote_path.lastIndexOf("/")) || "/",
      );
      await router.push("/files");
      return;
    }
    await call("tasks:open-directory", { id: t.id });
  } catch (error) {
    message.error((error as Error).message);
  }
}
const statusNames: Record<string, string> = {
  pending: "等待中",
  downloading: "下载中",
  uploading: "上传中",
  paused: "已暂停",
  failed: "失败",
  completed: "已完成",
  rapid_upload_success: "秒传完成",
  checking_rapid: "正在校验",
  encrypting: "处理中",
  decrypting: "处理中",
  skipped: "已跳过",
  scanning: "正在扫描",
  cancelled: "已取消",
};
async function action(t: Task, action: string) {
  if (busy.value.has(key(t))) return;
  busy.value.add(key(t));
  try {
    await call("tasks:action", { id: t.id, kind: t.kind, action });
    await store.refreshTasks();
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value.delete(key(t));
  }
}
async function batch(actionName: "pause" | "resume") {
  if (batchBusy.value) return;
  const targets = tasks.value.filter(
    actionName === "pause" ? canPause : canResume,
  );
  batchBusy.value = true;
  try {
    const result = await call("tasks:batch", {
      kind: kind.value,
      ids: targets.map((t) => t.id),
      action: actionName,
    });
    await store.refreshTasks();
    if (result.failed) message.error(`${result.failed} 个任务处理失败，请重试`);
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    batchBusy.value = false;
  }
}
function removeAll(task?: Task, selection = false) {
  if (batchBusy.value || busy.value.size || !tasks.value.length) return;
  const targets = task
    ? [task]
    : selection
      ? tasks.value.filter((t) => selected.value.has(key(t)))
      : [...tasks.value];
  if (!targets.length) return;
  const isCompleted = task ? done(task) : completed.value;
  const label = kind.value === "upload" ? "上传" : "下载";
  batchBusy.value = true;
  Modal.confirm({
    title: task
      ? `删除这条${label}${isCompleted ? "记录" : "任务"}？`
      : selection
        ? `删除选中的 ${targets.length} 条${label}记录？`
        : isCompleted
          ? `清空全部${label}记录？`
          : `删除全部${label}任务？`,
    content: isCompleted
      ? `清空这 ${targets.length} 条记录，保留本地和网盘文件。`
      : `停止并移除这 ${targets.length} 个任务，清理未完成下载的临时文件，保留已完成文件和网盘文件。`,
    okText: task ? "删除" : isCompleted ? "清空全部" : "全部删除",
    cancelText: "取消",
    onCancel: () => {
      batchBusy.value = false;
    },
    async onOk() {
      let failures = 0;
      try {
        const result = await call("tasks:batch", {
          kind: targets[0]!.kind,
          ids: targets.map((t) => t.id),
          action: "delete",
        });
        failures = result.failed;
        await store.refreshTasks();
        if (failures) message.error(`${failures} 个任务处理失败，请重试`);
        else message.success(isCompleted ? "已清空记录" : "已删除任务");
      } catch (error) {
        message.error((error as Error).message);
      } finally {
        batchBusy.value = false;
      }
    },
  });
}
</script>
<template>
  <div class="transfer-layout">
    <nav class="transfer-sidebar" aria-label="传输类型">
      <button
        :class="{ active: kind === 'upload' }"
        data-kind="upload"
        @click="kind = 'upload'"
      >
        上传
      </button>
      <button
        :class="{ active: kind === 'download' }"
        data-kind="download"
        @click="kind = 'download'"
      >
        下载
      </button>
    </nav>
    <section class="transfer-page">
      <h1 class="visually-hidden">传输列表</h1>
      <div class="transfer-tabs" role="tablist" aria-label="传输状态">
        <button
          role="tab"
          :aria-selected="!completed"
          :class="{ active: !completed }"
          data-status="active"
          @click="completed = false"
        >
          {{ kind === "upload" ? "上传中" : "下载中" }}({{ activeCount }})
        </button>
        <button
          role="tab"
          :aria-selected="completed"
          :class="{ active: completed }"
          data-status="completed"
          @click="completed = true"
        >
          已完成({{ completedCount }})
        </button>
      </div>
      <div class="transfer-toolbar">
        <a-button
          v-if="kind === 'upload'"
          type="primary"
          :disabled="!store.user"
          @click="upload"
          ><Icon name="upload" :size="16" />上传</a-button
        >
        <template v-if="!completed">
          <a-button
            :disabled="!pauseAvailable || batchBusy || busy.size > 0"
            @click="batch('pause')"
            ><Icon name="pause" :size="16" />全部暂停</a-button
          >
          <a-button
            :disabled="!resumeAvailable || batchBusy || busy.size > 0"
            @click="batch('resume')"
            ><Icon name="play" :size="16" />全部开始</a-button
          >
        </template>
        <a-button
          data-action="remove-all"
          :disabled="!tasks.length || batchBusy || busy.size > 0"
          @click="removeAll()"
          ><Icon name="trash" :size="16" />{{
            completed ? "清空全部" : "全部删除"
          }}</a-button
        >
        <div class="toolbar-space" />
        <a-button
          v-if="selected.size"
          :disabled="batchBusy"
          @click="removeAll(undefined, true)"
          >删除所选({{ selected.size }})</a-button
        >
      </div>
      <div v-if="!tasks.length" class="empty-state">
        <EmptyIllustration :kind="kind" />
        <h3>
          暂无{{
            completed
              ? "已完成的传输"
              : kind === "upload"
                ? "上传任务"
                : "下载任务"
          }}
        </h3>
        <p v-if="kind === 'upload' && !completed">
          点击上传，将文件上传至网盘根目录
        </p>
      </div>
      <div
        v-else
        ref="listElement"
        class="task-list"
        @scroll="scrollTop = ($event.target as HTMLElement).scrollTop"
        :class="{
          'active-task-list': !completed,
          'completed-download-list': completed && kind === 'download',
        }"
      >
        <div class="task-table-header">
          <div class="task-name-heading">
            <a-checkbox
              :checked="allSelected"
              :indeterminate="selected.size > 0 && !allSelected"
              aria-label="全选传输任务"
              @change="selectAll"
            /><span>文件名</span
            ><span class="task-loaded">已全部加载，共{{ tasks.length }}个</span>
          </div>
          <span>大小</span
          ><span v-if="showProgressColumn">{{
            completed ? "进度" : "状态"
          }}</span>
          <button
            v-if="completed"
            class="task-time-heading"
            @click="descending = !descending"
          >
            完成时间
            <img
              class="task-sort-arrow"
              :class="{ ascending: !descending }"
              :src="headerSortActive"
              alt=""
            />
          </button>
        </div>
        <div
          v-if="virtual"
          aria-hidden="true"
          :style="{ height: startRow * 64 + 'px' }"
        />
        <div
          v-for="t in visibleTasks"
          :key="key(t)"
          class="task-row"
          :class="{ selected: selected.has(key(t)) }"
          :data-task="key(t)"
          @click="selectTask(t)"
        >
          <div class="task-info">
            <a-checkbox
              class="task-checkbox"
              :checked="selected.has(key(t))"
              :aria-label="'选择 ' + taskName(t)"
              @click.stop
              @change="selectTask(t)"
            />
            <span class="task-file-icon"
              ><FileIcon :name="taskName(t)" :folder="t.folder" :size="32"
            /></span>
            <strong :title="t.remote_path">{{ taskName(t) }}</strong>
            <div class="task-actions" @click.stop>
              <a-button
                v-if="!done(t)"
                type="text"
                :loading="busy.has(key(t))"
                :disabled="batchBusy"
                :title="
                  t.status === 'failed'
                    ? '重试'
                    : t.status === 'paused'
                      ? '继续'
                      : '暂停'
                "
                @click="
                  action(
                    t,
                    ['paused', 'failed'].includes(t.status)
                      ? 'resume'
                      : 'pause',
                  )
                "
                ><Icon
                  :name="
                    ['paused', 'failed'].includes(t.status)
                      ? 'row-play'
                      : 'row-pause'
                  "
                  :size="32"
              /></a-button>
              <a-button
                v-if="t.kind === 'download' || done(t)"
                type="text"
                title="查看所在位置"
                aria-label="查看所在位置"
                data-action="open-directory"
                :disabled="t.kind === 'upload' ? !t.remote_path : !t.local_path"
                @click="openDirectory(t)"
                ><Icon name="row-location" :size="32"
              /></a-button>
              <a-button
                type="text"
                :title="done(t) ? '清除记录' : '删除任务'"
                :aria-label="done(t) ? '清除记录' : '删除任务'"
                :disabled="batchBusy || busy.size > 0"
                @click="removeAll(t)"
              >
                <Icon name="trash" :size="16" />
              </a-button>
            </div>
          </div>
          <span class="task-size"
            ><template v-if="!completed"
              >{{ bytes(transferred(t), 2) }}/</template
            >{{ bytes(t.total_size, 2) }}</span
          >
          <div v-if="showProgressColumn" class="task-progress-cell">
            <span
              :class="{
                'error-text': t.status === 'failed',
                'task-speed': transferring(t),
              }"
              >{{
                transferring(t)
                  ? bytes(t.speed, 2) + "/s"
                  : statusNames[t.status] || t.status
              }}</span
            >
            <a-progress
              v-if="!done(t)"
              :percent="progress(t)"
              :show-info="false"
              :stroke-width="3"
              :stroke-color="
                transferring(t)
                  ? { '0%': '#ffe8b0', '100%': '#ffb4bf' }
                  : undefined
              "
              :status="t.status === 'failed' ? 'exception' : 'normal'"
            />
            <div v-if="transferring(t)" class="task-remaining">
              剩余时间: {{ remaining(t) }}
            </div>
            <p
              v-if="t.failure_reason || t.error"
              class="error-text task-error"
              :title="t.failure_reason || t.error"
            >
              {{ t.failure_reason || t.error }}
            </p>
          </div>
          <span
            v-if="completed"
            class="task-time"
            :title="
              t.completed_at
                ? new Date(t.completed_at * 1000).toLocaleString('zh-CN')
                : ''
            "
            >{{
              completed
                ? completionTime(t)
                : ["downloading", "uploading"].includes(t.status)
                  ? bytes(t.speed) + "/s"
                  : "—"
            }}</span
          >
        </div>
        <div
          v-if="virtual"
          aria-hidden="true"
          :style="{
            height:
              Math.max(0, tasks.length - startRow - visibleTasks.length) * 64 +
              'px',
          }"
        />
      </div>
    </section>
  </div>
</template>
