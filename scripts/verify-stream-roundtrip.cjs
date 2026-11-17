// Isolated generated fixtures only; never uploads or deletes user-owned files.
const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { Backend } = require("../electron/backend.cjs");
const { TransferFeed } = require("../electron/transfer-feed.cjs");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.setPath("userData", path.resolve(".runtime/stream-check-electron"));
app.whenReady().then(async () => {
  const root = await fs.mkdtemp(path.resolve(".runtime/stream-roundtrip-"));
  const remote = `/客户端验证-实时通信-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const backend = new Backend({
    executable: path.resolve("vendor/backend/baidu-netdisk-rust.exe"),
    directory: root,
    downloads: path.join(root, "downloads"),
    safeStorage,
  });
  const report = {
    passed: false,
    checks: [],
    uploadProgressEvents: 0,
    downloadProgressEvents: 0,
  };
  const feed = new TransferFeed({ backend, onTasks: () => {} });
  const handler = feed.message.bind(feed);
  feed.message = (message) => {
    for (const e of message.type === "event_batch" ? message.events : [message])
      if (e.event?.event_type === "progress") {
        if (e.category === "upload") report.uploadProgressEvents++;
        if (e.category === "download") report.downloadProgressEvents++;
      }
    handler(message);
  };
  const complete = (t) =>
    ["completed", "rapid_upload_success"].includes(t.status);
  async function wait(predicate, label, ms = 180000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const tasks = feed.snapshot();
      if (tasks.some((t) => t.status === "failed"))
        throw Error(
          "Generated fixture transfer failed; upstream details omitted",
        );
      if (predicate(tasks)) return tasks;
      await delay(100);
    }
    throw Error("Timed out: " + label);
  }
  let created = false;
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
    feed.start();
    await wait(() => feed.mode === "connected", "authenticated stream", 10000);
    await backend.request("/files/folder", "POST", { path: remote });
    created = true;
    const sources = new Map();
    for (const relative of [
      "single.bin",
      "folder/a.bin",
      "folder/nested/b.bin",
    ]) {
      const bytes = crypto.randomBytes(
        relative === "single.bin" ? 16 * 1024 * 1024 : 1024 * 1024,
      );
      const local = path.join(root, "sources", relative);
      await fs.mkdir(path.dirname(local), { recursive: true });
      await fs.writeFile(local, bytes);
      sources.set(
        relative,
        crypto.createHash("sha256").update(bytes).digest("hex"),
      );
    }
    console.log("Checking generated single-file and nested-folder uploads");
    await backend.request("/uploads", "POST", {
      local_path: path.join(root, "sources/single.bin"),
      remote_path: remote + "/single.bin",
      conflict_strategy: "auto_rename",
    });
    await backend.request("/uploads/folder", "POST", {
      local_folder: path.join(root, "sources/folder"),
      remote_folder: remote + "/folder",
      conflict_strategy: "auto_rename",
    });
    await feed.refresh();
    const uploaded = await wait(
      (tasks) =>
        tasks.filter((t) => t.kind === "upload").length === 3 &&
        tasks.filter((t) => t.kind === "upload").every(complete),
      "all generated uploads complete",
    );
    assert.ok(report.uploadProgressEvents > 0);
    for (const t of uploaded) await backend.taskAction(t, "delete");
    await feed.refresh();
    assert.equal(feed.snapshot().length, 0);
    for (const [relative, hash] of sources)
      assert.equal(
        crypto
          .createHash("sha256")
          .update(await fs.readFile(path.join(root, "sources", relative)))
          .digest("hex"),
        hash,
      );
    report.checks.push(
      "single and nested folder uploads; WebSocket completion; clearing records preserves local sources",
    );
    console.log("Checking batch file/folder download and SHA-256 equality");
    const list = await backend.request(
      "/files?dir=" + encodeURIComponent(remote) + "&page=1&page_size=100",
    );
    assert.equal(list.list.length, 2);
    await fs.mkdir(path.join(root, "downloads"), { recursive: true });
    const result = await backend.request("/downloads/batch", "POST", {
      items: list.list.map((f) => ({
        fs_id: f.fs_id,
        path: f.path,
        name: f.server_filename,
        is_dir: !!f.isdir,
        size: f.size,
      })),
      target_dir: path.join(root, "downloads"),
      conflict_strategy: "auto_rename",
    });
    assert.equal(result.task_ids.length, 1);
    assert.equal(result.folder_task_ids.length, 1);
    await feed.refresh();
    await wait(
      (tasks) => tasks.length === 2 && tasks.every(complete),
      "file and folder download complete",
    );
    for (const [relative, hash] of sources)
      assert.equal(
        crypto
          .createHash("sha256")
          .update(await fs.readFile(path.join(root, "downloads", relative)))
          .digest("hex"),
        hash,
      );
    assert.ok(report.downloadProgressEvents > 0);
    report.checks.push(
      "batch single-file and nested-folder download; WebSocket folder aggregation; all three SHA-256 hashes match",
    );
    report.passed = true;
  } catch (error) {
    report.error = error.message;
  } finally {
    feed.stop();
    if (backend.state === "ready") {
      for (const t of await backend.tasks().catch(() => []))
        await backend.taskAction(t, "delete").catch(() => {});
      if (created) {
        try {
          await backend.request("/files/delete", "POST", { paths: [remote] });
          report.cloudFixturesRemoved = true;
        } catch {
          report.cloudFixturesRemoved = false;
          report.passed = false;
        }
      }
    }
    await backend.stop().catch(() => backend.child?.kill());
    for (const name of [
      "accounts.json",
      "accounts.json.bak",
      "session.json",
      "session.json.bak",
      "session.json.migrated",
    ])
      await fs.rm(path.join(root, "config", name), { force: true });
    for (const name of await fs
      .readdir(path.join(root, "logs"))
      .catch(() => []))
      await fs.rm(path.join(root, "logs", name), { force: true });
    await fs.writeFile(
      "artifacts/stream-roundtrip.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
