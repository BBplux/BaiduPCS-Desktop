const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Backend } = require("../electron/backend.cjs");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.setPath("userData", path.join(app.getPath("appData"), "网盘桌面"));
app.whenReady().then(async () => {
  const record = JSON.parse(
    await fs.readFile("artifacts/live-verification.json", "utf8"),
  );
  const report = { checks: [], remoteDirectory: record.remoteDirectory };
  if (!record.passed || !record.remoteDirectory?.startsWith("/客户端验证-"))
    throw new Error("Requires successful isolated roundtrip first");
  const folder = path.resolve(".runtime/recovery-verification");
  await fs.mkdir(path.join(folder, "config"), { recursive: true });
  // An isolated backend instance loads the existing session. Never emit its credentials.
  await fs.copyFile(
    path.join(app.getPath("userData"), "backend/config/accounts.json"),
    path.join(folder, "config/accounts.json"),
  );
  const backend = new Backend({
    executable: path.resolve("vendor/backend/baidu-netdisk-rust.exe"),
    directory: folder,
    downloads: path.join(folder, "downloads"),
    safeStorage,
  });
  try {
    await backend.start();
    if (backend.state !== "ready") throw new Error(backend.error);
    const input = path.join(folder, "recovery-test.bin");
    const bytes = crypto.randomBytes(16 * 1024 * 1024);
    await fs.writeFile(input, bytes);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const remote = `${record.remoteDirectory}/recovery-${Date.now()}.bin`;
    let id = await backend.request("/uploads", "POST", {
      local_path: input,
      remote_path: remote,
      conflict_strategy: "auto_rename",
    });
    async function task(kind, id) {
      return (await backend.request(`/${kind}`)).find((t) => t.id === id);
    }
    async function waitCompleted(kind, id) {
      for (let i = 0; i < 240; i++) {
        const t = await task(kind, id);
        if (t && ["completed", "rapid_upload_success"].includes(t.status))
          return t;
        if (t?.status === "failed")
          throw new Error(t.failure_reason || t.error || "Transfer failed");
        await delay(1000);
      }
      throw new Error("Transfer timed out");
    }
    async function pauseAndRestart(kind, id) {
      let paused = false;
      for (let i = 0; i < 600; i++) {
        const t = await task(kind, id);
        if (!t) {
          await delay(100);
          continue;
        }
        if (["completed", "rapid_upload_success"].includes(t.status)) break;
        if (t.status === "failed") throw new Error(t.failure_reason || t.error);
        const completed =
          kind === "uploads" ? t.uploaded_size : t.downloaded_size;
        if (completed >= 256 * 1024) {
          if (!process.argv.includes("--active-exit"))
            await backend.request(`/${kind}/${id}/pause`, "POST");
          paused = true;
          report[`${kind}BytesBeforeRestart`] = completed || 0;
          break;
        }
        await delay(100);
      }
      if (!paused)
        throw new Error(
          `${kind}: completed before recovery could be exercised; inconclusive`,
        );
      const before = await task(kind, id);
      if (
        !process.argv.includes("--active-exit") &&
        before?.status !== "paused"
      )
        throw new Error(`${kind} did not pause`);
      await backend.stop();
      await backend.start();
      if (backend.state !== "ready") throw new Error(backend.error);
      let restored;
      for (let i = 0; i < 60; i++) {
        restored = await task(kind, id);
        if (restored) break;
        await delay(300);
      }
      if (!restored) throw new Error(`${kind}: task missing after restart`);
      if (restored.status !== "paused")
        throw new Error(`${kind}: restored task unexpectedly active`);
      report.checks.push(
        `${kind}: ${process.argv.includes("--active-exit") ? "exit during transfer" : "pause"}, process restart, restored paused task`,
      );
      await backend.recoverTransfers(true);
      report.checks.push(
        `${kind}: auto-resume policy applied to recovered task`,
      );
    }
    console.log("Upload restart verification started");
    await pauseAndRestart("uploads", id);
    await waitCompleted("uploads", id);
    report.checks.push("upload finished after recovery");
    await backend.stop();
    await backend.start();
    if (backend.state !== "ready") throw Error("History restart failed");
    const uploadHistory = await task("uploads", id);
    if (
      !uploadHistory ||
      !["completed", "rapid_upload_success"].includes(uploadHistory.status)
    )
      throw Error("Upload history missing after restart");
    await backend.taskAction({ ...uploadHistory, kind: "upload" }, "delete");
    if ((await fs.stat(input)).size !== bytes.length)
      throw Error("Upload source unexpectedly changed");
    report.checks.push(
      "completed upload history survives restart; clearing preserves local source",
    );
    const files = await backend.request(
      `/files?dir=${encodeURIComponent(record.remoteDirectory)}&page=1&page_size=100`,
    );
    const file = files.list.find((f) => f.path === remote);
    if (!file) throw new Error("Uploaded recovery file missing");
    report.checks.push("clearing upload history preserves the cloud file");
    await fs.mkdir(path.join(folder, "downloads"), { recursive: true });
    const created = await backend.request("/downloads/batch", "POST", {
      items: [
        {
          fs_id: file.fs_id,
          path: file.path,
          name: file.server_filename,
          is_dir: false,
          size: file.size,
        },
      ],
      target_dir: path.join(folder, "downloads"),
      conflict_strategy: "auto_rename",
    });
    id = created.task_ids[0];
    if (!id) throw new Error("Download could not be created");
    console.log("Download restart verification started");
    await pauseAndRestart("downloads", id);
    await waitCompleted("downloads", id);
    const downloaded = await fs.readFile(
      path.join(folder, "downloads", file.server_filename),
    );
    if (crypto.createHash("sha256").update(downloaded).digest("hex") !== hash)
      throw new Error("Recovery download hash mismatch");
    report.checks.push("recovered download SHA256 equality");
    report.passed = true;
    report.remoteFile = remote;
    console.log("Recovery verification passed");
  } catch (error) {
    report.passed = false;
    report.error = error.message;
    console.error("Recovery verification:", error.message);
  } finally {
    try {
      await backend.stop();
    } catch {
      backend.child?.kill();
    }
    // Remove credential-bearing copies from the isolated test backend after it exits.
    for (const name of [
      "accounts.json",
      "accounts.json.bak",
      "session.json",
      "session.json.bak",
      "session.json.migrated",
    ])
      await fs.rm(path.join(folder, "config", name), { force: true });
    for (const name of await fs
      .readdir(path.join(folder, "logs"))
      .catch(() => []))
      await fs.rm(path.join(folder, "logs", name), { force: true });
    await fs.writeFile(
      process.argv.includes("--active-exit")
        ? "artifacts/recovery-active-exit.json"
        : "artifacts/recovery-verification.json",
      JSON.stringify(report, null, 2),
    );
    app.exit(report.passed ? 0 : 1);
  }
});
