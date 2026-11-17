const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ app, backend, dispatch, quitApp, getFloatWindow }) => {
  const root = app.getPath("userData"),
    stateFile = path.join(root, "verification.json");
  const state = JSON.parse(await fs.readFile(stateFile, "utf8"));
  async function task(id, kind) {
    return (await backend.tasks()).find((t) => t.id === id && t.kind === kind);
  }
  async function wait(id, kind, predicate) {
    const start = Date.now();
    while (Date.now() - start < 180000) {
      const t = await task(id, kind);
      if (t?.status === "failed") throw Error(kind + " transfer failed");
      if (t && predicate(t)) return t;
      await delay(100);
    }
    throw Error(kind + " transfer state timed out");
  }
  try {
    assert.equal(backend.state, "ready");
    const phase = state.phase;
    console.log("Desktop restart phase " + phase);
    if (phase === 1) {
      const bytes = crypto.randomBytes(16 * 1024 * 1024);
      state.hash = crypto.createHash("sha256").update(bytes).digest("hex");
      state.input = path.join(root, "restart-fixture.bin");
      await fs.writeFile(state.input, bytes);
      state.remote =
        state.remoteDirectory + "/desktop-restart-" + Date.now() + ".bin";
      state.uploadId = await backend.request("/uploads", "POST", {
        local_path: state.input,
        remote_path: state.remote,
        conflict_strategy: "auto_rename",
      });
      const active = await wait(
        state.uploadId,
        "upload",
        (t) => t.uploaded_size >= 4 * 1024 * 1024 && t.status === "uploading",
      );
      state.uploadBytes = active.uploaded_size;
      await dispatch("settings:save", {
        autoResume: false,
        confirmExit: false,
        floatEnabled: false,
      });
      state.checks.push("exit app with active upload and auto-resume disabled");
    } else if (phase === 2) {
      const settings = await dispatch("settings:get");
      assert.equal(settings.autoResume, false);
      assert.equal(settings.floatEnabled, false);
      assert.equal(getFloatWindow(), undefined);
      const paused = await task(state.uploadId, "upload");
      assert.equal(paused.status, "paused");
      assert.ok(paused.uploaded_size > 0);
      await dispatch("tasks:action", {
        id: state.uploadId,
        kind: "upload",
        action: "resume",
      });
      await wait(state.uploadId, "upload", (t) =>
        ["completed", "rapid_upload_success"].includes(t.status),
      );
      const listing = await backend.request(
        "/files?dir=" +
          encodeURIComponent(state.remoteDirectory) +
          "&page=1&page_size=100",
      );
      const file = listing.list.find((f) => f.path === state.remote);
      assert.ok(file);
      const result = await dispatch("download", {
        items: [
          {
            fs_id: file.fs_id,
            path: file.path,
            name: file.server_filename,
            is_dir: false,
            size: file.size,
          },
        ],
      });
      state.downloadId = result.task_ids[0];
      const active = await wait(
        state.downloadId,
        "download",
        (t) => t.downloaded_size >= 256 * 1024 && t.status === "downloading",
      );
      state.downloadBytes = active.downloaded_size;
      state.output = active.local_path;
      await dispatch("settings:save", { autoResume: true, floatEnabled: true });
      state.checks.push(
        "new app process restores paused upload and settings; upload completes; exit with active download",
      );
    } else if (phase === 3) {
      assert.equal((await dispatch("settings:get")).autoResume, true);
      assert.ok(getFloatWindow());
      const complete = await wait(
        state.downloadId,
        "download",
        (t) => t.status === "completed",
      );
      const result = crypto
        .createHash("sha256")
        .update(await fs.readFile(complete.local_path))
        .digest("hex");
      assert.equal(result, state.hash);
      assert.ok(
        ["completed", "rapid_upload_success"].includes(
          (await task(state.uploadId, "upload")).status,
        ),
      );
      await dispatch("tasks:action", {
        id: state.uploadId,
        kind: "upload",
        action: "delete",
      });
      await dispatch("tasks:action", {
        id: state.downloadId,
        kind: "download",
        action: "delete",
      });
      assert.equal(
        crypto
          .createHash("sha256")
          .update(await fs.readFile(state.input))
          .digest("hex"),
        state.hash,
      );
      assert.equal(
        crypto
          .createHash("sha256")
          .update(await fs.readFile(state.output))
          .digest("hex"),
        state.hash,
      );
      state.checks.push(
        "new app process automatically resumes download; SHA256 matches; clear records preserves source and output",
      );
    } else if (phase === 4) {
      assert.equal(await task(state.uploadId, "upload"), undefined);
      assert.equal(await task(state.downloadId, "download"), undefined);
      assert.equal((await dispatch("settings:get")).floatEnabled, true);
      assert.equal(
        await getFloatWindow().webContents.executeJavaScript("location.hash"),
        "#/float",
      );
      state.checks.push(
        "fourth app process retains settings and cleared history; floating window uses its own route",
      );
      state.passed = true;
    }
    state.phase++;
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    await quitApp();
  } catch (error) {
    state.error = error.message;
    await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
    console.error("Desktop restart verification failed: " + error.message);
    await backend.stop().catch(() => backend.child?.kill());
    app.exit(1);
  }
};
