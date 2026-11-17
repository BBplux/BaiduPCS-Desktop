// Fault gates affect only this isolated kernel and its control connection.
const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { Backend } = require("../electron/backend.cjs");
const { TransferFeed } = require("../electron/transfer-feed.cjs");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.setPath("userData", path.resolve(".runtime/outage-electron"));
app.whenReady().then(async () => {
  const root = await fs.mkdtemp(path.resolve(".runtime/outage-"));
  const backend = new Backend({
    executable: path.resolve("vendor/backend/baidu-netdisk-rust.exe"),
    directory: root,
    downloads: path.join(root, "downloads"),
    safeStorage,
  });
  const sockets = new Set();
  let offline = false,
    outboundHits = 0,
    feed,
    control,
    id;
  const report = { passed: false, checks: [], outageSeconds: 120 };
  const track = (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {});
    return s;
  };
  const outbound = http.createServer((req, res) => {
    outboundHits++;
    if (offline) {
      res.writeHead(503);
      res.end();
      return;
    }
    const url = new URL(req.url);
    const forward = http.request(
      url,
      { method: req.method, headers: req.headers },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    forward.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    forward.on("socket", track);
    req.pipe(forward);
  });
  outbound.on("connection", track);
  outbound.on("connect", (req, client, head) => {
    outboundHits++;
    if (offline) {
      client.destroy();
      return;
    }
    const target = new URL("http://" + req.url);
    const upstream = track(
      net.connect(Number(target.port) || 443, target.hostname, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      }),
    );
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
  });
  const listen = (server) =>
    new Promise((r) => server.listen(0, "127.0.0.1", r));
  async function wait(work, label, ms = 180000) {
    const at = Date.now();
    while (Date.now() - at < ms) {
      const result = await work();
      if (result) return result;
      await delay(75);
    }
    throw Error("Timed out: " + label);
  }
  const current = async () => (await backend.tasks()).find((t) => t.id === id);
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
    await listen(outbound);
    const config = await backend.request("/config");
    config.network.proxy = {
      proxy_type: "http",
      host: "127.0.0.1",
      port: outbound.address().port,
      allow_fallback: false,
    };
    await backend.request("/config", "PUT", config);
    control = net.createServer((client) => {
      track(client);
      if (offline) {
        client.destroy();
        return;
      }
      const upstream = track(
        net.connect(backend.port, "127.0.0.1", () => {
          client.pipe(upstream);
          upstream.pipe(client);
        }),
      );
      client.on("close", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
    });
    await listen(control);
    const client = new Backend({});
    client.state = "ready";
    client.url = `http://127.0.0.1:${control.address().port}/api/v1`;
    client.password = backend.password;
    client.token = backend.token;
    feed = new TransferFeed({ backend: client, onTasks: () => {} });
    feed.start();
    await wait(() => feed.mode === "connected", "initial stream", 15000);
    const previous = JSON.parse(
      await fs.readFile("artifacts/recovery-verification.json", "utf8"),
    );
    assert.ok(
      previous.passed && previous.remoteDirectory.startsWith("/客户端验证-"),
    );
    const source = await fs.readFile(
      ".runtime/recovery-verification/recovery-test.bin",
    );
    const expected = crypto.createHash("sha256").update(source).digest("hex");
    const list = await backend.request(
      "/files?dir=" +
        encodeURIComponent(previous.remoteDirectory) +
        "&page=1&page_size=100",
    );
    const file = list.list.find((f) => f.path === previous.remoteFile);
    assert.ok(file && file.size === source.length);
    await fs.mkdir(path.join(root, "downloads"), { recursive: true });
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
      target_dir: path.join(root, "downloads"),
      conflict_strategy: "auto_rename",
    });
    id = created.task_ids[0];
    const active = await wait(async () => {
      const t = await current();
      return t?.status === "downloading" &&
        t.downloaded_size > 100000 &&
        t.downloaded_size < t.total_size
        ? t
        : null;
    }, "active transfer");
    assert.ok(outboundHits > 0);
    report.bytesBeforeOutage = active.downloaded_size;
    offline = true;
    for (const s of sockets) s.destroy();
    const interrupted = Date.now();
    console.log(
      "Isolated cloud and control connections offline for 120 seconds",
    );
    await wait(() => feed.mode === "polling", "fallback", 10000);
    assert.ok(feed.snapshot().every((t) => !t.speed));
    await delay(3000);
    const stable = (await current()).downloaded_size;
    while (Date.now() - interrupted < 120000) {
      await delay(1000);
    }
    const stopped = await current();
    assert.equal(stopped.downloaded_size, stable);
    assert.notEqual(stopped.status, "completed");
    report.statusDuringOutage = stopped.status;
    report.measuredOutageMs = Date.now() - interrupted;
    offline = false;
    console.log("Restoring isolated connections and checking resume/hash");
    const restoredAt = Date.now();
    await wait(() => feed.mode === "connected", "stream reconnect", 45000);
    report.streamReconnectMs = Date.now() - restoredAt;
    const state = await current();
    if (["failed", "paused"].includes(state.status))
      await backend.taskAction(state, "resume");
    const done = await wait(async () => {
      const t = await current();
      return t?.status === "completed" ? t : null;
    }, "download recovery");
    assert.equal(
      crypto
        .createHash("sha256")
        .update(await fs.readFile(done.local_path))
        .digest("hex"),
      expected,
    );
    await wait(
      () =>
        feed.snapshot().some((t) => t.id === id && t.status === "completed"),
      "stream final state",
      15000,
    );
    report.checks.push(
      "120-second isolated outbound and control outage; progress stops; stale speed cleared; authenticated reconnect; resumed download SHA-256 matches",
    );
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    console.error("Outage verification failed: " + error.message);
  } finally {
    offline = false;
    feed?.stop();
    if (id && backend.state === "ready") {
      const t = await current().catch(() => null);
      if (t) await backend.taskAction(t, "delete").catch(() => {});
    }
    await backend.stop().catch(() => backend.child?.kill());
    for (const s of sockets) s.destroy();
    outbound.close();
    control?.close();
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
      "artifacts/network-outage.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    app.exit(report.passed ? 0 : 1);
  }
});
