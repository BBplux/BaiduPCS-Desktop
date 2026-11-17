// Isolated upstream HTTP reproduction: no desktop cleanup or cloud mutations.
const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { Backend } = require("../electron/backend.cjs");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const root = await fs.mkdtemp(path.resolve(".runtime/upstream-cancel-"));
  const account = path.join(root, "config/accounts.json");
  const backend = new Backend({
    executable: path.resolve("vendor/backend/baidu-netdisk-rust.exe"),
    directory: root,
    downloads: path.join(root, "downloads"),
    safeStorage,
  });
  const report = {
    mode: "upstream DELETE, no client cleanup",
    scenario: process.argv.includes("--early")
      ? "early"
      : process.argv.includes("--paused")
        ? "paused"
        : "active",
    events: [],
  };
  try {
    await fs.mkdir(path.dirname(account), { recursive: true });
    await fs.copyFile(
      path.join(
        app.getPath("appData"),
        "网盘桌面/backend/config/accounts.json",
      ),
      account,
    );
    process.env.RUST_LOG = "warn,baidu_netdisk_rust::downloader=info";
    await backend.start();
    if (backend.state !== "ready") throw Error("Isolated backend unavailable");
    report.version = backend.status().version;
    const record = JSON.parse(
      await fs.readFile("artifacts/live-verification.json", "utf8"),
    );
    const listing = await backend.request(
      "/files?dir=" +
        encodeURIComponent(record.remoteDirectory) +
        "&page=1&page_size=100",
    );
    let file = listing.list.find((f) => !f.isdir && f.size > 1000000);
    if (process.argv.includes("--same-file")) {
      const name =
        "[ANK-Raws] To Love-Ru Trouble BDBOX - 02 (BDrip 1920x1080 x264 FLAC Hi10P).mkv";
      const found = await backend.request(
        "/files/search?key=" +
          encodeURIComponent(name) +
          "&page=1&num=100&recursion=1",
      );
      const matches = found.list.filter(
        (f) => !f.isdir && f.server_filename === name,
      );
      if (matches.length !== 1)
        throw Error("Original file not uniquely identified");
      file = matches[0];
    }
    if (!file) throw Error("Verification file missing");
    const result = await backend.request("/downloads/batch", "POST", {
      items: [
        {
          fs_id: file.fs_id,
          path: file.path,
          name: file.server_filename,
          is_dir: false,
          size: file.size,
        },
      ],
      target_dir: backend.downloads,
      conflict_strategy: "auto_rename",
    });
    const id = result.task_ids[0];
    let task;
    for (let i = 0; i < 600; i++) {
      task = (await backend.tasks()).find((t) => t.id === id);
      if (
        task &&
        (report.scenario === "early" ||
          task.downloaded_size > Math.min(16 * 1024 * 1024, file.size / 2))
      )
        break;
      await delay(100);
    }
    if (
      !task ||
      (report.scenario !== "early" &&
        (task.status !== "downloading" || !task.downloaded_size))
    )
      throw Error("Did not reach in-progress state");
    if (report.scenario === "paused")
      await backend.request(
        "/downloads/" + encodeURIComponent(id) + "/pause",
        "POST",
      );
    const start = Date.now();
    report.downloaded = task.downloaded_size;
    await backend.request(
      "/downloads/" + encodeURIComponent(id) + "?delete_file=false",
      "DELETE",
    );
    report.deleteResponseMs = Date.now() - start;
    for (let i = 0; i <= 60; i++) {
      const stat = await fs
        .stat(task.local_path + ".downloading")
        .catch(() => null);
      const event = {
        ms: Date.now() - start,
        exists: !!stat,
        size: stat?.size ?? null,
      };
      const last = report.events.at(-1);
      if (!last || last.exists !== event.exists || last.size !== event.size) {
        report.events.push(event);
        console.log(JSON.stringify(event));
      }
      if (i < 60) await delay(1000);
    }
    report.taskAbsent = !(await backend.tasks()).some((t) => t.id === id);
    await assert.rejects(
      fs.access(path.join(root, "cancelled-downloads.json")),
      { code: "ENOENT" },
    );
    assert.ok(report.taskAbsent, "Deleted task must remain absent");
    assert.ok(
      report.events.every((event) => !event.exists),
      "Temporary file survived or reappeared after DELETE",
    );
    report.observationMs = Date.now() - start;
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    console.log(error.message);
  } finally {
    await backend.stop().catch(() => {});
    for (const name of [
      "accounts.json",
      "accounts.json.bak",
      "session.json",
      "session.json.bak",
      "session.json.migrated",
    ])
      await fs.rm(path.join(root, "config", name), { force: true });
    // Preserve only event-level diagnostics, never raw upstream credentials/URLs.
    const logs = await fs.readdir(path.join(root, "logs")).catch(() => []);
    report.signals = [];
    for (const name of logs) {
      const logPath = path.join(root, "logs", name);
      const text = await fs.readFile(logPath, "utf8");
      for (const line of text.split("\n")) {
        for (const signal of [
          "已从调度器移除并取消",
          "流式读取被取消",
          "已清理 .downloading",
          "下载被取消",
          "打开输出文件失败",
        ]) {
          if (line.includes(signal))
            report.signals.push({ time: line.slice(0, 23), signal });
        }
      }
      await fs.unlink(logPath);
    }
    await fs.writeFile(
      `artifacts/upstream-cancel-${report.version || "unknown"}-${report.scenario}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
