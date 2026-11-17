const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async ({
  app,
  mainWindow,
  backend,
  dispatch,
  quitApp,
  transferFeed,
  getFloatWindow,
}) => {
  const output = path.resolve("artifacts");
  const report = { passed: false, checks: [] };
  const originalTasks = backend.tasks,
    originalAction = backend.taskAction;
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  let tasks = [];
  const publish = () =>
    mainWindow.webContents.send("desktop:event", { type: "tasks", tasks });
  const fixture = (i, status = "downloading", kind = "download") => ({
    id: String(i),
    kind,
    status,
    remote_path:
      "/验收/" +
      "长文件名用于检查右侧按钮以及大小状态列是否保持对齐".repeat(4) +
      i +
      ".zip",
    local_path: "C:/isolated-test/" + i + ".zip",
    total_size: 1073741824,
    downloaded_size: 536870912,
    uploaded_size: 536870912,
    speed: 1048576,
    completed_at: 1794770000,
  });
  async function wait(predicate, label) {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await delay(50);
    }
    throw Error(
      "UI state not reached: " +
        label +
        " " +
        (await js(
          "JSON.stringify({top:document.querySelector('.task-list')?.scrollTop,height:document.querySelector('.task-list')?.clientHeight,scroll:document.querySelector('.task-list')?.scrollHeight,first:document.querySelector('.task-row')?.dataset.task,last:document.querySelector('.task-row:last-child')?.dataset.task,lastRow:[...document.querySelectorAll('.task-row')].at(-1)?.dataset.task})",
        )),
    );
  }
  async function capture(name) {
    await js(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    await fs.writeFile(
      path.join(output, name + ".png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
  }
  try {
    transferFeed.stop();
    backend.tasks = async () => structuredClone(tasks);
    mainWindow.setSize(1100, 700);
    mainWindow.show();
    mainWindow.webContents.send("desktop:event", {
      type: "logged-in",
      user: { uid: -9, username: "隔离验收数据" },
    });
    await delay(100);
    mainWindow.webContents.send("desktop:event", {
      type: "navigate",
      route: "/transfers",
    });
    await wait(
      () => js("!!document.querySelector('.transfer-tabs')"),
      "transfer view",
    );
    await wait(
      () => js("!document.querySelector('.ant-message-notice')"),
      "login notification dismissed",
    );
    tasks = Array.from({ length: 1000 }, (_, i) => fixture(i));
    const started = performance.now();
    publish();
    await wait(
      () =>
        js(
          "document.querySelector('.task-loaded')?.textContent.includes('1000')",
        ),
      "1000 task count",
    );
    report.firstRenderMs = Math.round(performance.now() - started);
    report.renderedRows = await js(
      "document.querySelectorAll('.task-row').length",
    );
    report.domElements = await js("document.querySelectorAll('*').length");
    console.log(
      JSON.stringify({
        firstRenderMs: report.firstRenderMs,
        renderedRows: report.renderedRows,
        domElements: report.domElements,
      }),
    );
    assert.ok(
      report.renderedRows < 100,
      "Large queues must render only the viewport, not every task",
    );
    report.checks.push("bounded rendering for 1000 tasks");
    await js("document.querySelector('.task-list').scrollTop=1000000");
    await wait(
      () =>
        js(
          "[...document.querySelectorAll('.task-row')].at(-1)?.dataset.task==='download:999'",
        ),
      "last virtual row",
    );
    await js(
      "[...document.querySelectorAll('.task-row')].at(-1).querySelector('input').click()",
    );
    await wait(
      () =>
        js(
          "document.querySelector('.transfer-toolbar').textContent.includes('删除所选(1)')",
        ),
      "offscreen selection",
    );
    tasks = Array.from({ length: 5000 }, (_, i) => fixture(i));
    publish();
    await wait(
      () =>
        js(
          "document.querySelector('.task-loaded').textContent.includes('5000')",
        ),
      "5000 tasks",
    );
    await js("document.querySelector('.task-list').scrollTop=0");
    await wait(
      () =>
        js("document.querySelector('.task-row')?.dataset.task==='download:0'"),
      "top virtual row",
    );
    const updateTimes = [];
    for (let i = 0; i < 12; i++) {
      tasks[0] = { ...tasks[0], downloaded_size: (600 + i) * 1048576 };
      const at = performance.now();
      publish();
      await wait(
        () =>
          js(
            `document.querySelector('.task-row .task-size').textContent.includes('${600 + i}.00 MB')`,
          ),
        "progress render",
      );
      updateTimes.push(Math.round(performance.now() - at));
    }
    report.fiveThousandTaskUpdateMs = updateTimes;
    assert.ok(
      await js(
        "document.querySelector('.transfer-toolbar').textContent.includes('删除所选(1)')",
      ),
    );
    report.fiveThousandRenderedRows = await js(
      "document.querySelectorAll('.task-row').length",
    );
    assert.ok(Math.max(...updateTimes) < 1500);
    assert.ok(report.fiveThousandRenderedRows < 100);
    await capture("acceptance-large-queue");
    report.checks.push(
      "5000 tasks: bounded DOM, scrolling to last task, selection survives progress, responsive live updates",
    );
    let reads = 0,
      actions = 0;
    backend.tasks = async () => {
      reads++;
      return structuredClone(tasks);
    };
    backend.taskAction = async (t, action) => {
      actions++;
      if (t.id === "500") throw Error("isolated failure");
    };
    const batch = await dispatch("tasks:batch", {
      kind: "download",
      action: "pause",
      ids: tasks.slice(0, 1000).map((t) => t.id),
    });
    assert.deepEqual(batch, { succeeded: 999, failed: 1 });
    assert.equal(reads, 1);
    assert.equal(actions, 1000);
    report.checks.push(
      "1000-task batch queries once and reports partial failure",
    );
    backend.tasks = async () => structuredClone(tasks);
    backend.taskAction = originalAction;
    const longError =
      "磁盘空间不足，请释放保存位置所在磁盘的空间后重试。".repeat(8);
    for (const kind of ["download", "upload"]) {
      await js(`document.querySelector('[data-kind=${kind}]').click()`);
      tasks = [
        "pending",
        kind === "download" ? "downloading" : "uploading",
        "paused",
        "failed",
        kind === "download" ? "decrypting" : "checking_rapid",
      ].map((s, i) => ({
        ...fixture(i, s, kind),
        error: s === "failed" ? longError : undefined,
      }));
      publish();
      await wait(
        () => js("document.querySelectorAll('.task-row').length===5"),
        "task states",
      );
      await js(
        "document.querySelectorAll('.task-row')[1].querySelector('button').focus()",
      );
      const geometry = await js(
        `(()=>{const row=document.querySelectorAll('.task-row')[1], info=row.querySelector('.task-info').getBoundingClientRect(), buttons=row.querySelector('.task-actions').getBoundingClientRect(), size=row.querySelector('.task-size').getBoundingClientRect();return {aligned:Math.abs(info.right-buttons.right-12)<2, clear:buttons.right<=size.left, errorTitle:document.querySelector('.task-error').title, rowHeights:[...document.querySelectorAll('.task-row')].map(r=>r.getBoundingClientRect().height), overflow:document.querySelector('.task-list').scrollWidth>document.querySelector('.task-list').clientWidth}})()`,
      );
      assert.ok(geometry.aligned && geometry.clear);
      assert.equal(geometry.overflow, false);
      assert.ok(geometry.rowHeights.every((h) => h === 64));
      assert.equal(geometry.errorTitle, longError);
      await capture("acceptance-" + kind + "-states");
      tasks = [
        fixture("complete", "completed", kind),
        fixture("rapid", "rapid_upload_success", kind),
      ];
      publish();
      await js("document.querySelector('[data-status=completed]').click()");
      await wait(
        () => js("document.querySelectorAll('.task-row').length===2"),
        "completed",
      );
      await js("document.querySelector('.task-row button').focus()");
      assert.equal(
        await js(
          "document.querySelector('.task-row .task-actions').querySelectorAll('button').length",
        ),
        2,
      );
      assert.equal(
        await js(
          "getComputedStyle(document.querySelector('.task-row')).gridTemplateColumns.split(' ').length",
        ),
        kind === "download" ? 3 : 4,
      );
      await capture("acceptance-" + kind + "-completed-hover");
      tasks = [];
      publish();
      await wait(() => js("!!document.querySelector('.empty-state')"), "empty");
      await capture("acceptance-" + kind + "-empty-completed");
      await js("document.querySelector('[data-status=active]').click()");
      await capture("acceptance-" + kind + "-empty-active");
    }
    report.checks.push(
      "upload/download active states, long names, full error tooltip, aligned hover buttons, completed columns and empty states",
    );
    const float = getFloatWindow();
    assert.ok(float);
    float.showInactive();
    for (const [name, event] of [
      ["idle", { type: "tasks", tasks: [] }],
      [
        "speed",
        {
          type: "tasks",
          tasks: [fixture(1), fixture(2, "uploading", "upload")],
        },
      ],
      [
        "offline",
        {
          type: "backend",
          status: {
            state: "ready",
            connection: "polling",
            version: backend.version,
          },
        },
      ],
    ]) {
      float.webContents.send("desktop:event", event);
      await delay(100);
      assert.equal(
        await float.webContents.executeJavaScript(
          "document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight",
        ),
        false,
      );
      await fs.writeFile(
        path.join(output, "acceptance-float-" + name + ".png"),
        (await float.webContents.capturePage()).toPNG(),
      );
    }
    report.checks.push(
      "floating idle, simultaneous transfer speeds and reconnect hint fit the window",
    );
    // Exercise the actual command boundary with an isolated directory, without
    // consuming disk space or submitting a download to the kernel.
    const settings = await dispatch("settings:get");
    const previousDirectory = settings.downloadDir;
    const originalRequest = backend.request,
      originalStatfs = fs.statfs;
    const storageRoot = await fs.mkdtemp(
      path.join(app.getPath("userData"), "storage-"),
    );
    const before = path.join(storageRoot, "original"),
      after = path.join(storageRoot, "moved");
    let submitted = 0;
    try {
      await fs.mkdir(before);
      await fs.writeFile(path.join(before, "keep.txt"), "existing data");
      settings.downloadDir = before;
      backend.request = async () => {
        submitted++;
        return {};
      };
      const item = {
        fs_id: 1,
        path: "/isolated.bin",
        size: 8192,
        is_dir: false,
      };
      fs.statfs = async () => ({ bsize: 4096n, bavail: 1n });
      await assert.rejects(
        dispatch("download", { items: [item] }),
        /磁盘空间不足/,
      );
      assert.deepEqual(await fs.readdir(before), ["keep.txt"]);
      fs.statfs = originalStatfs;
      await fs.rename(before, after);
      await assert.rejects(
        dispatch("download", { items: [item] }),
        /下载目录不存在/,
      );
      assert.equal(submitted, 0);
      assert.equal(
        await fs.readFile(path.join(after, "keep.txt"), "utf8"),
        "existing data",
      );
      settings.downloadDir = after;
      await dispatch("download", { items: [item] });
      assert.equal(submitted, 1);
      report.checks.push(
        "download command rejects low disk capacity and moved directory before kernel submission; selecting existing directory succeeds",
      );
    } finally {
      settings.downloadDir = previousDirectory;
      backend.request = originalRequest;
      fs.statfs = originalStatfs;
      for (const directory of [before, after]) {
        await fs.unlink(path.join(directory, "keep.txt")).catch(() => {});
        await fs.rmdir(directory).catch(() => {});
      }
      await fs.rmdir(storageRoot);
    }
    // Drive the exact production power-event listeners without putting this PC to sleep.
    transferFeed.start();
    await wait(
      () => Promise.resolve(transferFeed.mode === "connected"),
      "live stream",
    );
    require("electron").powerMonitor.emit("suspend");
    assert.equal(transferFeed.mode, "suspended");
    require("electron").powerMonitor.emit("resume");
    await wait(
      () => Promise.resolve(transferFeed.mode === "connected"),
      "resume stream",
    );
    report.checks.push(
      "Electron suspend/resume callbacks reconnect the real kernel stream",
    );
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    console.error(error.message);
  } finally {
    backend.tasks = originalTasks;
    backend.taskAction = originalAction;
    await fs.writeFile(
      path.join(output, "ui-acceptance.json"),
      JSON.stringify(report, null, 2),
    );
    if (report.passed) await quitApp();
    else {
      await backend.stop().catch(() => backend.child?.kill());
      app.exit(1);
    }
  }
};
