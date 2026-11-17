const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Backend } = require("../electron/backend.cjs");
app.setPath("userData", path.join(app.getPath("appData"), "网盘桌面"));
app.whenReady().then(async () => {
  try {
    const directory = path.join(app.getPath("userData"), "backend");
    const config = await fs.readFile(
      path.join(directory, "config/app.toml"),
      "utf8",
    );
    const port = config.match(/^port\s*=\s*(\d+)/m)[1];
    const backend = new Backend({ directory, safeStorage });
    backend.url = `http://127.0.0.1:${port}/api/v1`;
    backend.password = (
      await safeStorage.decryptStringAsync(
        await fs.readFile(path.join(directory, "service-key.bin")),
      )
    ).result;
    await backend.authenticate();
    backend.state = "ready";
    const report = JSON.parse(
      await fs.readFile("artifacts/live-verification.json", "utf8"),
    );
    const listing = await backend.request(
      "/files?dir=" +
        encodeURIComponent(report.remoteDirectory) +
        "&page=1&page_size=100",
    );
    let file = listing.list.find((f) => !f.isdir && f.size > 1000000);
    if (process.argv.includes("--observed")) {
      const settings = JSON.parse(
        await fs.readFile(
          path.join(app.getPath("userData"), "settings.json"),
          "utf8",
        ),
      );
      const residuals = (await fs.readdir(settings.downloadDir)).filter((n) =>
        n.endsWith(".downloading"),
      );
      if (residuals.length !== 1) throw Error("Expected one observed residual");
      const name = residuals[0].slice(0, -".downloading".length);
      const found = await backend.request(
        "/files/search?key=" +
          encodeURIComponent(name) +
          "&page=1&num=100&recursion=1",
      );
      const exact = found.list.filter(
        (f) => !f.isdir && f.server_filename === name,
      );
      if (exact.length !== 1)
        throw Error("Observed file is not uniquely identifiable in account");
      file = exact[0];
    }
    if (!file) throw Error("No suitable existing verification file");
    const target = await fs.mkdtemp(path.resolve(".runtime/cancel-check-"));
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
      target_dir: target,
      conflict_strategy: "auto_rename",
    });
    const id = created.task_ids[0];
    let task;
    for (let i = 0; i < 600; i++) {
      task = (await backend.tasks()).find((t) => t.id === id);
      if (
        task &&
        (process.argv.includes("--early") ||
          task.downloaded_size >= Math.min(16 * 1024 * 1024, file.size / 2))
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    console.log(
      JSON.stringify({
        phase: "before",
        status: task?.status,
        downloaded: task?.downloaded_size,
        keys: Object.keys(task || {}),
        absolute: path.isAbsolute(task?.local_path || ""),
        files: await fs.readdir(target),
      }),
    );
    if (!task) throw Error("Task not found");
    if (
      !process.argv.includes("--early") &&
      (task.status !== "downloading" || !task.downloaded_size)
    ) {
      await backend.taskAction(task, "delete");
      throw Error("Did not reach an in-progress download; check inconclusive");
    }
    await backend.taskAction(task, "delete");
    console.log(
      JSON.stringify({ phase: "immediate", files: await fs.readdir(target) }),
    );
    await new Promise((r) => setTimeout(r, 20000));
    const files = await fs.readdir(target);
    console.log(JSON.stringify({ phase: "after20s", files }));
    if (files.some((f) => f.endsWith(".downloading")))
      throw Error("Temporary file remains after cancellation");
    console.log("Real cancellation check passed.");
    app.exit(0);
  } catch (error) {
    console.error(error.message);
    app.exit(1);
  }
});
