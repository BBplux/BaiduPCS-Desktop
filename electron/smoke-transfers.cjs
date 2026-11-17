const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { shell } = require("electron");
exports.run = async ({ mainWindow, backend, output }) => {
  const oldTasks = backend.tasks,
    oldAction = backend.taskAction;
  const oldOpen = shell.openPath;
  const opened = [];
  shell.openPath = async (directory) => {
    opened.push(directory);
    return "";
  };
  const tasks = [
    { id: "running", kind: "download", status: "downloading" },
    { id: "paused", kind: "download", status: "paused" },
    {
      id: "failed",
      kind: "download",
      status: "failed",
      failure_reason: "模拟网络中断，可重试",
    },
    { id: "complete", kind: "download", status: "completed" },
    { id: "running", kind: "upload", status: "uploading" },
    { id: "complete", kind: "upload", status: "rapid_upload_success" },
  ].map((t) => ({
    ...t,
    remote_path: "/" + t.kind + "-" + t.id + ".zip",
    local_path: `C:/fixtures/${t.id}/fixture.zip`,
    total_size: 104857600,
    downloaded_size: t.status === "completed" ? 104857600 : 52428800,
    uploaded_size: t.status === "rapid_upload_success" ? 104857600 : 26214400,
    speed: 1048576,
    completed_at: ["completed", "rapid_upload_success"].includes(t.status)
      ? Math.floor(Date.now() / 1000)
      : null,
  }));
  const actions = [];
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  const publish = () =>
    mainWindow.webContents.send("desktop:event", { type: "tasks", tasks });
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function capture(name) {
    // DOM updates can precede the compositor frame; wait for the rendered state too.
    await js(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    await new Promise((r) => setTimeout(r, 250));
    await fs.writeFile(
      path.join(output, name),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
  }
  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw Error("Transfer UI did not reach expected state");
  }
  backend.tasks = async () => structuredClone(tasks);
  backend.taskAction = async (t, action) => {
    actions.push({ kind: t.kind, id: t.id, action });
    const task = tasks.find((x) => x.kind === t.kind && x.id === t.id);
    if (action === "delete") {
      tasks.splice(tasks.indexOf(task), 1);
      publish();
      return;
    }
    task.status =
      action === "pause"
        ? "paused"
        : task.kind === "upload"
          ? "uploading"
          : "downloading";
    if (action === "resume") delete task.failure_reason;
    publish();
  };
  try {
    // Simulated account unlocks refreshTasks without accessing real credentials.
    mainWindow.webContents.send("desktop:event", {
      type: "logged-in",
      user: { uid: -2, username: "传输界面验证（模拟数据）" },
    });
    await new Promise((r) => setTimeout(r, 100));
    mainWindow.webContents.send("desktop:event", {
      type: "navigate",
      route: "/transfers",
    });
    await waitFor(() => js("!!document.querySelector('[data-kind=download]')"));
    publish();
    await waitFor(() =>
      js("document.querySelectorAll('.task-row').length===3"),
    );
    await require("./smoke-typography.cjs").checkFilenameInk(
      mainWindow,
      ".task-row .task-info strong",
      output,
      "filename-transfer",
    );
    assert.equal(
      await js("document.querySelectorAll('[data-task^=upload]').length"),
      0,
    );
    assert.deepEqual(
      await js(
        "[...document.querySelectorAll('.transfer-toolbar button')].map(b=>b.textContent.trim())",
      ),
      ["全部暂停", "全部开始", "全部删除"],
    );
    await click(".task-table-header input[type=checkbox]");
    await waitFor(() =>
      js("document.querySelectorAll('.task-row.selected').length === 3"),
    );
    await click(".task-table-header input[type=checkbox]");
    await waitFor(() =>
      js("document.querySelectorAll('.task-row.selected').length === 0"),
    );
    // Electron input injection requires the target BrowserWindow to be focused.
    mainWindow.focus();
    mainWindow.webContents.focus();
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: 5, y: 5 });
    await waitFor(() =>
      js(
        "getComputedStyle(document.querySelector('.task-actions')).opacity === '0'",
      ),
    );
    const point = await js(
      "(()=>{const r=document.querySelector('.task-row').getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+20)}})()",
    );
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", ...point });
    // Read visibility and geometry atomically. Native cursor updates can clear
    // injected hover while capturePage waits for a compositor frame.
    let geometry;
    await waitFor(async () => {
      geometry = await js(`(() => {
        const element = document.querySelector('.task-actions');
        const info = document.querySelector('.task-info').getBoundingClientRect();
        const actions = element.getBoundingClientRect();
        return { visible: getComputedStyle(element).opacity === '1',
          rightGap: info.right-actions.right, actionWidth: actions.width };
      })()`);
      return geometry.visible;
    });
    assert.ok(
      geometry.rightGap >= 10 && geometry.rightGap <= 14,
      "Hover actions align to the right edge of filename column: " +
        JSON.stringify(geometry),
    );
    assert.ok(geometry.actionWidth >= 96);
    // Keep the equivalent keyboard focus state while taking the reference image.
    await js("document.querySelector('.task-actions button').focus()");
    await capture("desktop-transfer-hover.png");
    assert.ok(
      await js(
        "document.querySelector('.task-progress-cell').textContent.includes('剩余时间: 00:00:50')",
      ),
    );
    assert.equal(
      await js("document.querySelector('.task-size').textContent.trim()"),
      "50.00 MB/100.00 MB",
    );
    assert.equal(await js("document.body.innerText.includes('SVIP')"), false);
    for (const id of ["running", "paused"]) {
      await click(`[data-task="download:${id}"] [data-action=open-directory]`);
      await waitFor(() =>
        Promise.resolve(
          opened.includes(path.dirname(`C:/fixtures/${id}/fixture.zip`)),
        ),
      );
    }
    assert.equal(opened.length, 2);
    tasks.find((t) => t.id === "paused" && t.kind === "download").folder = true;
    await click('[data-task="download:paused"] [data-action=open-directory]');
    await waitFor(() => Promise.resolve(opened.length === 3));
    assert.equal(opened[2], "C:/fixtures/paused/fixture.zip");
    delete tasks.find((t) => t.id === "paused" && t.kind === "download").folder;
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: 5, y: 5 });
    await js("document.querySelector('.task-actions button').focus()");
    await waitFor(() =>
      js(
        "getComputedStyle(document.querySelector('.task-actions')).opacity === '1'",
      ),
    );
    await js("document.activeElement.blur()");
    await click('[data-task="download:running"] button');
    await waitFor(() => Promise.resolve(actions.length === 1));
    assert.deepEqual(actions[0], {
      kind: "download",
      id: "running",
      action: "pause",
    });
    await click('[data-task="download:paused"] button');
    await waitFor(() => Promise.resolve(actions.length === 2));
    await click('[data-task="download:failed"] button');
    await waitFor(() => Promise.resolve(actions.length === 3));
    assert.deepEqual(
      actions.slice(1).map((x) => x.action),
      ["resume", "resume"],
    );
    await waitFor(() =>
      js("!document.querySelector('[data-action=remove-all]').disabled"),
    );
    await js(
      "[...document.querySelectorAll('.transfer-toolbar button')].find(b=>b.textContent.includes('全部暂停')).click()",
    );
    await waitFor(() =>
      Promise.resolve(
        tasks
          .filter(
            (t) => t.kind === "download" && !["completed"].includes(t.status),
          )
          .every((t) => t.status === "paused"),
      ),
    );
    assert.equal(
      tasks.find((t) => t.kind === "upload" && t.id === "running").status,
      "uploading",
    );
    await click("[data-status=completed]");
    await waitFor(() =>
      js("document.querySelectorAll('.task-row').length===1"),
    );
    assert.ok(
      await js("!!document.querySelector('[data-task=\"download:complete\"]')"),
    );
    assert.equal(
      await js("document.querySelectorAll('.task-percent').length"),
      0,
    );
    assert.equal(
      await js("document.querySelectorAll('.task-table-header > *').length"),
      3,
      "Official completed downloads have filename, size and completion date columns",
    );
    const oldTime = tasks.find(
      (t) => t.id === "complete" && t.kind === "download",
    ).completed_at;
    tasks.find(
      (t) => t.id === "complete" && t.kind === "download",
    ).completed_at = 1730000000;
    publish();
    await waitFor(() =>
      js("document.querySelector('.task-time').textContent.includes('年')"),
    );
    tasks.find(
      (t) => t.id === "complete" && t.kind === "download",
    ).completed_at = oldTime;
    publish();
    await waitFor(() =>
      js("document.querySelector('.task-time').textContent.includes(':')"),
    );
    await capture("desktop-transfer-download-completed.png");
    await click("[data-kind=upload]");
    await waitFor(() =>
      js("!!document.querySelector('[data-task=\"upload:complete\"]')"),
    );
    assert.equal(
      await js("document.querySelectorAll('[data-task^=download]').length"),
      0,
    );
    assert.equal(
      await js("document.querySelector('.task-time').textContent.trim()"),
      new Date(
        tasks.find((t) => t.id === "complete" && t.kind === "upload")
          .completed_at * 1000,
      ).toLocaleTimeString("zh-CN", {
        hour12: false,
      }),
    );
    assert.ok(
      await js(
        "document.querySelector('.task-table-header').textContent.includes('完成时间')",
      ),
    );
    assert.equal(
      await js("document.querySelectorAll('.task-row .ant-progress').length"),
      0,
    );
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: 5, y: 5 });
    await new Promise((r) => setTimeout(r, 150));
    await capture("desktop-transfer-upload-completed.png");
    assert.deepEqual(
      await js(
        "[...document.querySelectorAll('.task-row .task-actions button')].map(b=>b.title)",
      ),
      ["查看所在位置", "清除记录"],
    );
    const completedPoint = await js(
      "(()=>{const r=document.querySelector('.task-row').getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+20)}})()",
    );
    mainWindow.webContents.sendInputEvent({
      type: "mouseMove",
      ...completedPoint,
    });
    await waitFor(() =>
      js(
        "getComputedStyle(document.querySelector('.task-actions')).opacity === '1'",
      ),
    );
    assert.ok(
      await js(
        "document.querySelector('.task-info').contains(document.querySelector('.task-actions'))",
      ),
    );
    assert.equal(
      await js(
        "getComputedStyle(document.querySelector('.task-time')).opacity",
      ),
      "1",
    );
    await capture("desktop-transfer-upload-completed-hover.png");
    await click("[data-status=active]");
    await waitFor(() =>
      js("!!document.querySelector('[data-task=\"upload:running\"]')"),
    );
    assert.deepEqual(
      await js(
        "[...document.querySelectorAll('.transfer-toolbar button')].map(b=>b.textContent.trim())",
      ),
      ["上传", "全部暂停", "全部开始", "全部删除"],
    );
    await capture("desktop-transfer-upload-active.png");
    await click("[data-kind=download]");
    await waitFor(() =>
      js("document.querySelectorAll('.task-row').length===3"),
    );
    await new Promise((r) => setTimeout(r, 150));
    await capture("desktop-transfer-download-paused.png");
    await click('[data-action="remove-all"]');
    await waitFor(() => js("!!document.querySelector('.ant-modal-confirm')"));
    await js(
      "document.querySelector('.ant-modal-confirm .ant-btn-default').click()",
    );
    await waitFor(() => js("!document.querySelector('.ant-modal-confirm')"));
    assert.equal(tasks.length, 6, "cancel preserves tasks");
    for (const type of ["download", "upload"]) {
      await click(`[data-kind=${type}]`);
      for (const status of ["active", "completed"]) {
        await click(`[data-status=${status}]`);
        await waitFor(() =>
          js("!document.querySelector('[data-action=remove-all]').disabled"),
        );
        assert.equal(
          await js(
            "document.querySelector('[data-action=remove-all]').textContent.trim()",
          ),
          status === "active" ? "全部删除" : "清空全部",
        );
        const other = structuredClone(tasks.filter((t) => t.kind !== type));
        const count = tasks.filter(
          (t) =>
            t.kind === type &&
            ["completed", "rapid_upload_success"].includes(t.status) ===
              (status === "completed"),
        ).length;
        const before = tasks.length;
        await click('[data-action="remove-all"]');
        await waitFor(() =>
          js("!!document.querySelector('.ant-modal-confirm')"),
        );
        await js(
          "document.querySelector('.ant-modal-confirm .ant-btn-primary').click()",
        );
        await waitFor(() =>
          js(
            "!document.querySelector('.ant-modal-confirm') && document.querySelector('[data-action=remove-all]').disabled",
          ),
        );
        assert.equal(tasks.length, before - count);
        assert.deepEqual(
          tasks.filter((t) => t.kind !== type),
          other,
        );
        assert.equal(
          await js("document.querySelectorAll('.task-row').length"),
          0,
        );
      }
    }
    assert.equal(
      await js(
        "document.querySelectorAll('#header-search .search-input').length",
      ),
      1,
      "Search remains available on transfer pages",
    );
  } finally {
    shell.openPath = oldOpen;
    backend.tasks = oldTasks;
    backend.taskAction = oldAction;
    mainWindow.webContents.send("desktop:event", { type: "logged-out" });
  }
};
