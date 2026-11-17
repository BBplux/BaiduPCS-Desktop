// Real API validation in a fresh backend. Only reads existing cloud test fixtures.
const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Backend } = require("../electron/backend.cjs");
const { TransferFeed } = require("../electron/transfer-feed.cjs");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const root = await fs.mkdtemp(path.resolve(".runtime/lifecycle-"));
  const backend = new Backend({
    executable: path.resolve("vendor/backend/baidu-netdisk-rust.exe"),
    directory: root,
    downloads: path.join(root, "downloads"),
    safeStorage,
  });
  const report = {
    started: new Date().toISOString(),
    checks: [],
    bytes: {},
    passed: false,
  };
  const cancelled = [];
  let progressEvents = 0;
  const feed = new TransferFeed({ backend, onTasks: () => {} });
  const handleMessage = feed.message.bind(feed);
  feed.message = (message) => {
    const events = message.type === "event_batch" ? message.events : [message];
    progressEvents += events.filter(
      (e) => e.event?.event_type === "progress",
    ).length;
    handleMessage(message);
  };
  backend.on("status", ({ state }) => {
    if (state === "ready") feed.start();
    else feed.stop();
  });
  async function waitFeed(predicate) {
    for (let i = 0; i < 100; i++) {
      if (predicate(feed.snapshot())) return;
      await delay(100);
    }
    throw Error("Live task stream did not converge");
  }
  async function check(name, work) {
    console.log("Checking: " + name);
    await work();
    report.checks.push(name);
  }
  async function task(id) {
    return (await backend.tasks()).find((t) => t.id === id);
  }
  async function waitTask(id, predicate, limit = 120000) {
    const start = Date.now();
    while (Date.now() - start < limit) {
      const t = await task(id);
      if (t?.status === "failed")
        throw Error("Test transfer failed (upstream error omitted)");
      if (t && predicate(t)) return t;
      await delay(100);
    }
    throw Error("Expected transfer state not reached");
  }
  async function create(file, label, isDir = false) {
    const target = path.join(root, label);
    await fs.mkdir(target, { recursive: true });
    const result = await backend.request("/downloads/batch", "POST", {
      items: [
        {
          fs_id: file.fs_id,
          path: file.path,
          name: file.server_filename,
          is_dir: isDir,
          size: file.size,
        },
      ],
      target_dir: target,
      conflict_strategy: "auto_rename",
    });
    const id = isDir ? result.folder_task_ids?.[0] : result.task_ids?.[0];
    assert.ok(id, "Download id required");
    return id;
  }
  const inProgress = (t) =>
    t.status === "downloading" &&
    t.downloaded_size > 256 * 1024 &&
    t.downloaded_size < t.total_size;
  async function cancel(t, label) {
    const children = t.folder
      ? (await backend.request("/downloads")).filter((x) => x.group_id === t.id)
      : [t];
    await backend.taskAction(t, "delete");
    assert.equal(await task(t.id), undefined);
    await waitFeed((tasks) => !tasks.some((x) => x.id === t.id));
    cancelled.push({
      id: t.id,
      paths: children
        .filter((x) => x.status !== "completed")
        .map((x) => x.local_path),
      at: Date.now(),
      label,
    });
  }
  try {
    await fs.mkdir(path.join(root, "config"), { recursive: true });
    await fs.copyFile(
      path.join(
        app.getPath("appData"),
        "网盘桌面/backend/config/accounts.json",
      ),
      path.join(root, "config/accounts.json"),
    );
    await backend.start();
    assert.equal(backend.state, "ready");
    await waitFeed(() => feed.mode === "connected");
    const record = JSON.parse(
      await fs.readFile("artifacts/live-verification.json", "utf8"),
    );
    assert.ok(
      record.passed && record.remoteDirectory.startsWith("/客户端验证-"),
    );
    const list = await backend.request(
      "/files?dir=" +
        encodeURIComponent(record.remoteDirectory) +
        "&page=1&page_size=100",
    );
    const file = list.list
      .filter((f) => !f.isdir && f.size >= 16 * 1024 * 1024)
      .sort((a, b) => a.size - b.size)[0];
    assert.ok(file, "Existing large verification fixture required");
    await check("delete an active download after progress", async () => {
      const t = await waitTask(await create(file, "active"), inProgress);
      report.bytes.active = t.downloaded_size;
      await waitFeed((tasks) =>
        tasks.some((x) => x.id === t.id && x.downloaded_size > 0),
      );
      assert.ok(progressEvents > 0, "Real kernel progress events required");
      await cancel(t, "active");
    });
    await check("pause then delete a download", async () => {
      let t = await waitTask(await create(file, "paused"), inProgress);
      await backend.taskAction(t, "pause");
      t = await waitTask(t.id, (x) => x.status === "paused");
      report.bytes.paused = t.downloaded_size;
      await cancel(t, "paused");
    });
    await check("batch delete active and queued downloads", async () => {
      const ids = [
        await create(file, "batch-a"),
        await create(file, "batch-b"),
      ];
      await waitTask(ids[0], inProgress);
      for (const id of ids) await cancel(await task(id), "batch");
    });
    await check(
      "delete then immediately queue the same path; preserve new partial",
      async () => {
        const old = await waitTask(await create(file, "same-path"), inProgress);
        await backend.taskAction(old, "delete");
        const fresh = await waitTask(
          await create(file, "same-path"),
          inProgress,
        );
        assert.equal(
          fresh.local_path,
          old.local_path,
          "Must actually exercise the same path",
        );
        await backend.taskAction(fresh, "pause");
        await delay(2500);
        const initial = await fs.readFile(fresh.local_path + ".downloading");
        assert.ok(initial.length > 0);
        const hash = crypto.createHash("sha256").update(initial).digest("hex");
        await delay(8500);
        const current = await fs.readFile(fresh.local_path + ".downloading");
        assert.equal(
          crypto.createHash("sha256").update(current).digest("hex"),
          hash,
        );
        await cancel(await task(fresh.id), "same-path");
      },
    );
    await check(
      "folder cancellation preserves completed files and unrelated partials",
      async () => {
        const directory = {
          fs_id: 0,
          path: record.remoteDirectory,
          server_filename: record.remoteDirectory.slice(1),
          size: 0,
        };
        const id = await create(directory, "folder", true);
        const t = await waitTask(
          id,
          (x) =>
            x.downloaded_size > 256 * 1024 &&
            !["completed", "failed"].includes(x.status),
        );
        assert.ok(t.folder);
        const sentinel = path.join(t.local_path, "unrelated.downloading");
        const final = path.join(t.local_path, "keep-completed.txt");
        await fs.mkdir(t.local_path, { recursive: true });
        await fs.writeFile(sentinel, "unrelated task");
        await fs.writeFile(final, "completed file");
        await cancel(t, "folder");
        assert.equal(await fs.readFile(sentinel, "utf8"), "unrelated task");
        assert.equal(await fs.readFile(final, "utf8"), "completed file");
      },
    );
    await check(
      "exit while downloading, restart paused, resume and clear completed history",
      async () => {
        const t = await waitTask(await create(file, "restart"), inProgress);
        report.bytes.beforeExit = t.downloaded_size;
        await backend.stop();
        await backend.start();
        assert.equal(backend.state, "ready");
        const restored = await waitTask(t.id, (x) => x.status === "paused");
        assert.ok(restored.downloaded_size > 0);
        await backend.taskAction(restored, "resume");
        const complete = await waitTask(
          t.id,
          (x) => x.status === "completed",
          240000,
        );
        const bytes = await fs.readFile(complete.local_path);
        assert.equal(bytes.length, file.size);
        const digest = crypto.createHash("sha256").update(bytes).digest("hex");
        await backend.stop();
        await backend.start();
        assert.equal(backend.state, "ready");
        const history = await waitTask(t.id, (x) => x.status === "completed");
        await backend.taskAction(history, "delete");
        assert.equal(
          crypto
            .createHash("sha256")
            .update(await fs.readFile(complete.local_path))
            .digest("hex"),
          digest,
        );
        await backend.stop();
        await backend.start();
        assert.equal(backend.state, "ready");
        assert.equal(
          await task(t.id),
          undefined,
          "Deleted history must not return on restart",
        );
      },
    );
    await check(
      "cancelled records and exact temporary paths stay absent through restart",
      async () => {
        for (const c of cancelled) {
          assert.equal(await task(c.id), undefined);
          for (const local of c.paths)
            await assert.rejects(fs.access(local + ".downloading"), {
              code: "ENOENT",
            });
        }
      },
    );
    report.passed = true;
    report.progressEvents = progressEvents;
    report.checks.push(
      "real WebSocket download progress and removal converge through backend restarts",
    );
  } catch (error) {
    report.error = error.message;
    report.errorLocation = error.stack
      ?.split("\n")
      .find((line) => line.includes("verify-transfer-lifecycle.cjs"))
      ?.trim();
    console.error("Lifecycle verification failed: " + report.error);
  } finally {
    feed.stop();
    await backend.stop().catch(() => backend.child?.kill());
    for (const name of [
      "accounts.json",
      "accounts.json.bak",
      "session.json",
      "session.json.bak",
      "session.json.migrated",
    ])
      await fs.rm(path.join(root, "config", name), { force: true });
    // Raw upstream logs may include signed URLs; retain only this sanitized report.
    for (const name of await fs
      .readdir(path.join(root, "logs"))
      .catch(() => []))
      await fs.rm(path.join(root, "logs", name), { force: true });
    report.finished = new Date().toISOString();
    await fs.writeFile(
      "artifacts/transfer-lifecycle.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
