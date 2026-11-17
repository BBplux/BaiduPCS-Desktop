const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Backend } = require("../electron/backend.cjs");
const { spawn } = require("node:child_process");

test("stopping an already signal-terminated kernel must not wait for a second exit", async () => {
  const backend = new Backend({});
  backend.state = "failed";
  backend.child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve) => backend.child.once("spawn", resolve));
  const exited = new Promise((resolve) => backend.child.once("exit", resolve));
  backend.child.kill();
  await exited;
  let timer;
  try {
    await Promise.race([
      backend.stop(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("stop waited for an exit that already happened")),
          500,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
});

async function service(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const backend = new Backend({});
  backend.state = "ready";
  backend.url = `http://127.0.0.1:${server.address().port}`;
  return backend;
}

test("deleting file/folder records asks the kernel to preserve completed local files", async (t) => {
  const requests = [];
  const backend = await service(t, (req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ code: 0, data: { deleted: true } }));
  });
  for (const task of [
    { id: "active", kind: "download", status: "downloading" },
    { id: "paused", kind: "download", status: "paused" },
    { id: "completed", kind: "download", status: "completed" },
    { id: "folder", kind: "download", folder: true, status: "downloading" },
    { id: "upload", kind: "upload", status: "uploading" },
  ])
    assert.deepEqual(await backend.taskAction(task, "delete"), {
      deleted: true,
    });
  assert.deepEqual(requests, [
    { method: "DELETE", url: "/downloads/active?delete_file=false" },
    { method: "DELETE", url: "/downloads/paused?delete_file=false" },
    { method: "DELETE", url: "/downloads/completed?delete_file=false" },
    { method: "DELETE", url: "/downloads/folder/folder?delete_files=false" },
    { method: "DELETE", url: "/uploads/upload" },
  ]);
});

test("delete waits for the kernel response and propagates failure without touching local data", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "disk-delete-contract-"),
  );
  const local = path.join(directory, "sample.bin");
  await fs.writeFile(local, "completed data");
  await fs.writeFile(local + ".downloading", "partial data");
  t.after(async () => {
    await fs.unlink(local);
    await fs.unlink(local + ".downloading");
    await fs.rmdir(directory);
  });
  let reply, received;
  const arrival = new Promise((resolve) => {
    received = resolve;
  });
  const backend = await service(t, (_req, res) => {
    reply = res;
    received();
  });
  let settled = false;
  const deleting = backend.taskAction(
    { id: "task", kind: "download", local_path: local, status: "paused" },
    "delete",
  );
  deleting.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await arrival;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  const rejection = assert.rejects(deleting, /kernel refused deletion/);
  reply.writeHead(500, { "Content-Type": "application/json" });
  reply.end(JSON.stringify({ code: 500, message: "kernel refused deletion" }));
  await rejection;
  assert.equal(await fs.readFile(local, "utf8"), "completed data");
  assert.equal(
    await fs.readFile(local + ".downloading", "utf8"),
    "partial data",
  );
});

test("task normalization keeps folder routing and per-task paths for desktop controls", async (t) => {
  const backend = await service(t, (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data:
          req.url === "/downloads/all"
            ? [
                {
                  id: "folder",
                  type: "folder",
                  remote_root: "/cloud/folder",
                  local_root: "C:/downloads/custom",
                  status: "paused",
                },
              ]
            : [
                {
                  id: "upload",
                  remote_path: "/cloud/upload",
                  local_path: "C:/source/upload",
                  status: "uploading",
                },
              ],
      }),
    );
  });
  const tasks = await backend.tasks();
  assert.equal(tasks[0].local_path, "C:/downloads/custom");
  assert.equal(tasks[0].remote_path, "/cloud/folder");
  assert.equal(backend.taskRoute(tasks[0]), "/downloads/folder/folder");
  assert.equal(backend.taskRoute(tasks[1]), "/uploads/upload");
});
