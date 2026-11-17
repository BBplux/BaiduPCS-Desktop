const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.setPath("userData", path.join(app.getPath("appData"), "网盘桌面"));
app.whenReady().then(async () => {
  const prior = JSON.parse(
    await fs.readFile("artifacts/live-verification.json", "utf8"),
  );
  const report = { checks: [], remoteDirectory: prior.remoteDirectory };
  try {
    if (!prior.passed || !prior.remoteDirectory?.startsWith("/客户端验证-"))
      throw new Error("Requires owned verification folder");
    const dir = path.join(app.getPath("userData"), "backend");
    const config = await fs.readFile(path.join(dir, "config/app.toml"), "utf8");
    const port = config.match(/^port\s*=\s*(\d+)/m)[1];
    const password = (
      await safeStorage.decryptStringAsync(
        await fs.readFile(path.join(dir, "service-key.bin")),
      )
    ).result;
    let token = "";
    async function api(route, method = "GET", body) {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1` + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json();
      if (!res.ok || (typeof data.code === "number" && data.code !== 0))
        throw new Error(data.message || `HTTP ${res.status}`);
      return Object.hasOwn(data, "data") ? data.data : data;
    }
    token = (await api("/web-auth/login", "POST", { password })).access_token;
    const list = await api(
      `/files?dir=${encodeURIComponent(prior.remoteDirectory)}&page=1&page_size=100`,
    );
    const original = list.list.find(
      (f) => f.server_filename === "roundtrip-verified.txt",
    );
    if (!original) throw new Error("Owned test file not found");
    const dest = prior.remoteDirectory + "/moved";
    await api("/files/folder", "POST", { path: dest });
    const moved = await api("/files/move", "POST", {
      items: [{ path: original.path, dest, newname: original.server_filename }],
      ondup: "newcopy",
    });
    if (moved.kind !== "success")
      throw new Error(moved.message || "Move failed");
    report.checks.push("move test file into owned child folder");
    const local = path.resolve(
      ".runtime/live-verification",
      path.basename(prior.remoteDirectory),
      "roundtrip.txt",
    );
    const upload = await api("/uploads", "POST", {
      local_path: local,
      remote_path: dest + "/" + original.server_filename,
      conflict_strategy: "auto_rename",
    });
    let uploaded = false;
    for (let i = 0; i < 120; i++) {
      const task = (await api("/uploads")).find((t) => t.id === upload);
      if (task && ["completed", "rapid_upload_success"].includes(task.status)) {
        uploaded = true;
        break;
      }
      if (task?.status === "failed")
        throw new Error(task.error || "Duplicate upload failed");
      await delay(1000);
    }
    if (!uploaded) throw new Error("Duplicate upload timed out");
    const children = (
      await api(`/files?dir=${encodeURIComponent(dest)}&page=1&page_size=100`)
    ).list;
    const copy = children.find(
      (f) => f.fs_id !== original.fs_id && f.size === original.size,
    );
    if (!copy || !children.some((f) => f.fs_id === original.fs_id))
      throw new Error("Upload conflict did not retain both files");
    report.checks.push("upload auto-rename retains both files");
    if (!copy.path.startsWith(prior.remoteDirectory + "/"))
      throw new Error("Refusing to delete outside owned test directory");
    const deleted = await api("/files/delete", "POST", { paths: [copy.path] });
    if (deleted.failed_paths?.length || deleted.deleted_count !== 1)
      throw new Error("Test-file deletion failed");
    report.checks.push("delete only generated duplicate test file");
    const accounts = JSON.parse(
      await fs.readFile(path.join(dir, "config/accounts.json"), "utf8"),
    );
    const user = accounts.users.find((u) => u.uid === accounts.active_uid);
    if (!user?.cookies)
      throw new Error("No official session for recycle confirmation");
    const url = new URL("https://pan.baidu.com/api/recycle/list");
    for (const [k, v] of Object.entries({
      web: "1",
      app_id: "250528",
      channel: "chunlei",
      clienttype: "0",
      page: "1",
      num: "100",
      bdstoken: user.bdstoken || "",
    }))
      url.searchParams.set(k, v);
    let found = false;
    for (let i = 0; i < 5; i++) {
      const result = await fetch(url, {
        headers: {
          Cookie: user.cookies,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
          Referer: "https://pan.baidu.com/",
        },
        signal: AbortSignal.timeout(20000),
      }).then((r) => r.json());
      if (result.errno !== 0)
        throw new Error(`Recycle list returned errno ${result.errno}`);
      if (result.list?.some((f) => String(f.fs_id) === String(copy.fs_id))) {
        found = true;
        break;
      }
      await delay(1500);
    }
    if (!found)
      throw new Error("Deleted test file not confirmed in recycle bin");
    report.checks.push("deleted test fs_id confirmed in official recycle bin");
    report.recycleVerified = true;
    report.passed = true;
    console.log("File operations and recycle-bin verification passed");
  } catch (error) {
    report.passed = false;
    report.error = error.message;
    console.error("File operations:", error.message);
  }
  await fs.writeFile(
    "artifacts/file-operations-verification.json",
    JSON.stringify(report, null, 2),
  );
  app.exit(report.passed ? 0 : 1);
});
