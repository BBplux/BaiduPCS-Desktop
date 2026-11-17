const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TransferFeed } = require("../electron/transfer-feed.cjs");
const { visibleBounds } = require("../electron/window-bounds.cjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const task = (id, kind = "download", extra = {}) => ({
  id,
  kind,
  status: kind === "upload" ? "uploading" : "downloading",
  total_size: 100,
  downloaded_size: 10,
  speed: 10,
  ...extra,
});
const event = (id, event_type, fields = {}, category = "download") => ({
  type: "event",
  category,
  event: { task_id: id, event_type, ...fields },
});
function setup(t, tasks) {
  const backend = { tasks: async () => tasks.map((t) => ({ ...t })) };
  const feed = new TransferFeed({ backend, onTasks: () => {} });
  t.after(() => feed.stop());
  return { backend, feed };
}
test("in-flight HTTP cannot resurrect deleted tasks or roll back pushed progress", async (t) => {
  const { backend, feed } = setup(t, [task("a"), task("b")]);
  await feed.refresh();
  let resolve;
  backend.tasks = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = feed.refresh();
  feed.message(event("a", "deleted"));
  feed.message(event("b", "progress", { downloaded_size: 75, speed: 25 }));
  resolve([task("a"), task("b")]);
  await pending;
  assert.deepEqual(
    feed.snapshot().map((t) => t.id),
    ["b"],
  );
  assert.equal(feed.snapshot()[0].downloaded_size, 75);
});
test("batch events preserve terminal states, folder grouping, final bytes and upload status", async (t) => {
  const { feed } = setup(t, [
    task("a"),
    task("b", "upload"),
    task("dir", "download", { folder: true }),
  ]);
  await feed.refresh();
  feed.message({
    type: "event_batch",
    events: [
      event("a", "paused"),
      event("a", "progress", { speed: 50, downloaded_size: 60 }),
      event(
        "b",
        "completed",
        { completed_at: 123, is_rapid_upload: true },
        "upload",
      ),
      event("b", "progress", { speed: 20 }, "upload"),
      {
        category: "folder",
        event: {
          folder_id: "dir",
          event_type: "progress",
          downloaded_size: 90,
          speed: 30,
        },
      },
      event("child", "created", { group_id: "dir" }),
    ],
  });
  const [a, b, dir] = feed.snapshot();
  assert.equal(a.status, "paused");
  assert.equal(a.speed, 0);
  assert.equal(b.status, "rapid_upload_success");
  assert.equal(b.uploaded_size, 100);
  assert.equal(b.speed, 0);
  assert.equal(dir.downloaded_size, 90);
  assert.equal(feed.snapshot().length, 3);
});
test("stopping invalidates unfinished HTTP responses and clears stale speed", async (t) => {
  const { backend, feed } = setup(t, [task("a")]);
  await feed.refresh();
  let resolve;
  backend.tasks = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = feed.refresh();
  feed.stop();
  resolve([task("old")]);
  await pending;
  assert.equal(feed.snapshot()[0].id, "a");
  assert.equal(feed.snapshot()[0].speed, 0);
});

test("restarting after a pending reconciliation can schedule new task reconciliation", async (t) => {
  const { backend, feed } = setup(t, []);
  feed.running = true;
  feed.reconcileSoon();
  feed.stop();
  feed.running = true;
  backend.tasks = async () => [task("new")];
  feed.message(event("new", "created"));
  await delay(200);
  assert.equal(feed.snapshot()[0]?.id, "new");
});
test("socket subscription, fallback, authenticated reconnect and recovery snapshot", async (t) => {
  const sockets = [],
    states = [];
  let reads = 0,
    authentications = 0;
  class Socket {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      sockets.push(this);
      queueMicrotask(() => this.onopen?.());
    }
    send(data) {
      const message = JSON.parse(data);
      if (message.type === "subscribe") {
        this.subscriptions = message.subscriptions;
        this.onmessage?.({
          data: JSON.stringify({ type: "subscribe_success" }),
        });
      }
    }
    close() {
      this.readyState = 3;
    }
  }
  const backend = {
    url: "http://127.0.0.1:123/api/v1",
    token: "test-token",
    authenticate: async () => {
      authentications++;
      backend.token = "renewed";
    },
    tasks: async () => {
      reads++;
      return [task("a")];
    },
  };
  const feed = new TransferFeed({
    backend,
    onTasks: () => {},
    onState: (s) => states.push(s),
    WebSocketImpl: Socket,
    pollMs: 10,
    retryMs: 50,
    reconcileMs: 10000,
  });
  t.after(() => feed.stop());
  feed.start();
  await delay(30);
  assert.equal(feed.mode, "connected");
  assert.deepEqual(sockets[0].subscriptions, [
    "download:*",
    "upload:*",
    "folder:*",
  ]);
  sockets[0].onclose();
  const previousReads = reads;
  await delay(35);
  assert.equal(feed.mode, "polling");
  assert.ok(reads > previousReads);
  await delay(200);
  assert.equal(feed.mode, "connected");
  assert.equal(authentications, 1);
  assert.ok(sockets[1].url.endsWith("access_token=renewed"));
  const stale = sockets[0];
  stale.onmessage({ data: JSON.stringify(event("a", "deleted")) });
  assert.equal(feed.snapshot().length, 1);
  assert.ok(states.includes("polling"));
  feed.stop();
  await delay(70);
  assert.equal(sockets.length, 2);
});
test("display removal and scaling keep windows within a work area, including negative coordinates", () => {
  const displays = [
    { workArea: { x: -1280, y: 0, width: 1280, height: 984 } },
    { workArea: { x: 0, y: 0, width: 1536, height: 824 } },
  ];
  assert.deepEqual(
    visibleBounds({ x: -1200, y: 200, width: 168, height: 48 }, displays),
    { x: -1200, y: 200, width: 168, height: 48 },
  );
  assert.deepEqual(
    visibleBounds(
      { x: -1200, y: 900, width: 168, height: 48 },
      displays.slice(1),
    ),
    { x: 0, y: 776, width: 168, height: 48 },
  );
  assert.deepEqual(
    visibleBounds(
      { x: 1400, y: 800, width: 1180, height: 900 },
      displays.slice(1),
    ),
    { x: 356, y: 0, width: 1180, height: 824 },
  );
});
