// Explicit live-account verification. Only writes to its own unique verification directory.
const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.setPath("userData", path.join(app.getPath("appData"), "网盘桌面"));
app.whenReady().then(async () => {
  const output = path.resolve(
    process.argv.includes("--read-only")
      ? "artifacts/live-restart-verification.json"
      : "artifacts/live-verification.json",
  );
  const report = process.argv.includes("--resume")
    ? JSON.parse(await fs.readFile(output, "utf8"))
    : {
        startedAt: new Date().toISOString(),
        checks: [],
        remoteDirectory: null,
      };
  try {
    const dataRoot = path.join(app.getPath("appData"), "网盘桌面", "backend");
    const config = await fs.readFile(
      path.join(dataRoot, "config/app.toml"),
      "utf8",
    );
    const port = Number(config.match(/^port\s*=\s*(\d+)/m)?.[1]);
    if (!port) throw new Error("Cannot locate running backend port");
    const password = (
      await safeStorage.decryptStringAsync(
        await fs.readFile(path.join(dataRoot, "service-key.bin")),
      )
    ).result;
    const base = `http://127.0.0.1:${port}/api/v1`;
    let token = "";
    async function api(route, method = "GET", body) {
      const res = await fetch(base + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      const text = await res.text();
      if (!text)
        throw Object.assign(new Error(`HTTP ${res.status} (${route})`), {
          status: res.status,
        });
      const data = JSON.parse(text);
      if (!res.ok || (typeof data.code === "number" && data.code !== 0))
        throw Object.assign(new Error(data.message || `HTTP ${res.status}`), {
          status: res.status,
        });
      return Object.hasOwn(data, "data") ? data.data : data;
    }
    token = (await api("/web-auth/login", "POST", { password })).access_token;
    const user = await api("/auth/user");
    if (!user?.uid) throw new Error("No logged-in account");
    report.checks.push("official login session accepted by backend");
    const root = await api("/files?dir=%2F&page=1&page_size=10");
    if (!Array.isArray(root.list))
      throw new Error("File list contract mismatch");
    report.checks.push("root directory list");
    if (process.argv.includes("--read-only")) {
      report.passed = true;
      await fs.writeFile(output, JSON.stringify(report, null, 2));
      console.log("Read-only live checks passed");
      app.exit(0);
      return;
    }
    const resuming = !!report.remoteDirectory;
    const remote =
      report.remoteDirectory ||
      `/客户端验证-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${crypto.randomBytes(3).toString("hex")}`;
    report.remoteDirectory = remote;
    const local = path.resolve(
      ".runtime/live-verification",
      path.basename(remote),
    );
    await fs.mkdir(local, { recursive: true });
    const input = path.join(local, "roundtrip.txt");
    const payload = resuming
      ? await fs.readFile(input)
      : Buffer.from(
          "网盘桌面客户端验证文件，可安全删除。\n" +
            crypto.randomBytes(128 * 1024).toString("hex"),
        );
    await fs.writeFile(input, payload);
    report.sha256 = crypto.createHash("sha256").update(payload).digest("hex");
    if (!resuming) {
      await api("/files/folder", "POST", { path: remote });
      report.checks.push("create isolated folder");
    }
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log("Created isolated verification folder");
    const uploadId =
      report.uploadId ||
      (await api("/uploads", "POST", {
        local_path: input,
        remote_path: `${remote}/roundtrip.txt`,
        conflict_strategy: "auto_rename",
      }));
    report.uploadId = uploadId;
    async function waitTask(kind, id) {
      let prior = "";
      for (let i = 0; i < 150; i++) {
        let task;
        try {
          task = await api(`/${kind}/${encodeURIComponent(id)}`);
        } catch (error) {
          if (error.status !== 404) throw error;
          task = (await api(`/${kind}`)).find((t) => t.id === id);
          if (!task) throw error;
        }
        if (task.status !== prior) {
          console.log(`${kind}: ${task.status}`);
          prior = task.status;
        }
        if (["completed", "rapid_upload_success"].includes(task.status))
          return task;
        if (["failed", "cancelled"].includes(task.status))
          throw new Error(
            `${kind}: ${task.failure_reason || task.error || task.status}`,
          );
        await delay(2000);
      }
      throw new Error(
        `${kind} timed out; test task left visible in transfer list`,
      );
    }
    await waitTask("uploads", uploadId);
    report.checks.push("upload test file");
    const list = await api(
      `/files?dir=${encodeURIComponent(remote)}&page=1&page_size=100`,
    );
    const file = list.list.find((f) => f.server_filename === "roundtrip.txt");
    if (!file || file.size !== payload.length)
      throw new Error("Uploaded file size mismatch");
    const downloadDir = path.join(local, "download");
    await fs.mkdir(downloadDir, { recursive: true });
    const created = await api("/downloads/batch", "POST", {
      items: [
        {
          fs_id: file.fs_id,
          path: file.path,
          name: file.server_filename,
          is_dir: false,
          size: file.size,
        },
      ],
      target_dir: downloadDir,
      conflict_strategy: "auto_rename",
    });
    if (created.failed?.length || !created.task_ids?.length)
      throw new Error("Download creation failed");
    report.downloadId = created.task_ids[0];
    await waitTask("downloads", report.downloadId);
    const outputBytes = await fs.readFile(
      path.join(downloadDir, "roundtrip.txt"),
    );
    if (
      crypto.createHash("sha256").update(outputBytes).digest("hex") !==
      report.sha256
    )
      throw new Error("Roundtrip hash mismatch");
    report.checks.push("download test file and SHA256 equality");
    const renamed = await api("/files/rename", "POST", {
      item: {
        path: file.path,
        newname: "roundtrip-verified.txt",
        id: file.fs_id,
      },
    });
    if (renamed.kind !== "success")
      throw new Error(renamed.message || "Rename failed");
    report.checks.push("rename isolated test file");
    report.passed = true;
    delete report.error;
    report.checks = [...new Set(report.checks)];
    report.notes = [
      "Test data intentionally retained. Delete/recycle semantics and transfer restart still need separate verification.",
    ];
    console.log("Live roundtrip checks passed");
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    app.exit(0);
  } catch (error) {
    report.passed = false;
    report.error = error.message;
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.error("Live verification:", error.message);
    app.exit(1);
  }
});
