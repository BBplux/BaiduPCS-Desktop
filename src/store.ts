import { defineStore } from "pinia";
import { ref, shallowRef, computed } from "vue";
import { call, done } from "./api";
import type { User, Task, Settings, BackendStatus } from "./types";
export const useDisk = defineStore("disk", () => {
  const user = ref<User | null>(null),
    tasks = shallowRef<Task[]>([]),
    settings = ref<Settings | null>(null);
  const backend = ref<BackendStatus>({
    state: "starting",
    error: "",
    version: "",
  });
  const loginOpen = ref(false),
    directory = ref("/"),
    ready = ref(false);
  const search = ref(""),
    appliedSearch = ref(""),
    refreshTick = ref(0);
  const directoryHistory = ref(["/"]),
    historyIndex = ref(0);
  function navigateDirectory(dir: string, record = true) {
    if (record && dir !== directoryHistory.value[historyIndex.value]) {
      directoryHistory.value = [
        ...directoryHistory.value.slice(0, historyIndex.value + 1),
        dir,
      ];
      historyIndex.value++;
    }
    directory.value = dir;
    search.value = appliedSearch.value = "";
    refreshTick.value++;
  }
  function travelDirectory(offset: number) {
    const next = historyIndex.value + offset;
    if (next < 0 || next >= directoryHistory.value.length) return;
    historyIndex.value = next;
    navigateDirectory(directoryHistory.value[next]!, false);
  }
  const active = computed(() => tasks.value.filter((t) => !done(t)));
  const speeds = computed(() =>
    tasks.value.reduce(
      (sum, t) => {
        if (
          ["downloading", "uploading"].includes(t.status) &&
          Number.isFinite(t.speed) &&
          t.speed > 0
        )
          sum[t.kind] += t.speed;
        return sum;
      },
      { download: 0, upload: 0 },
    ),
  );
  async function refreshUser() {
    try {
      user.value = await call<User>("auth:user");
    } catch {
      user.value = null;
    }
  }
  async function refreshTasks() {
    if (!user.value) return;
    const revision = taskRevision;
    const result = await call<Task[]>("tasks:list");
    if (revision === taskRevision) tasks.value = result;
  }
  let taskRevision = 0;
  function acceptTasks(value: Task[]) {
    taskRevision++;
    tasks.value = value;
  }
  async function initialize() {
    settings.value = await call<Settings>("settings:get");
    backend.value = await call("status");
    if (backend.value.state === "ready") {
      await refreshUser();
      await refreshTasks();
    }
    ready.value = true;
  }
  return {
    user,
    tasks,
    settings,
    backend,
    loginOpen,
    directory,
    ready,
    active,
    speeds,
    refreshUser,
    refreshTasks,
    acceptTasks,
    initialize,
    search,
    appliedSearch,
    refreshTick,
    directoryHistory,
    historyIndex,
    navigateDirectory,
    travelDirectory,
  };
});
