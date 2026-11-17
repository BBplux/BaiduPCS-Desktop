const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const {
  checkDownloadDirectory,
  checkUploadSource,
} = require("../electron/transfer-storage.cjs");
const { Backend } = require("../electron/backend.cjs");
const { TransferFeed } = require("../electron/transfer-feed.cjs");
const { bindPowerEvents } = require("../electron/desktop-power.cjs");

test("moved download directory and missing upload source fail before submitting or resuming tasks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "disk-path-"));
  const before = path.join(root, "original"),
    after = path.join(root, "moved");
  await fs.mkdir(before);
  await fs.writeFile(path.join(before, "keep.txt"), "keep");
  try {
    await checkDownloadDirectory(before, 1);
    assert.deepEqual(await fs.readdir(before), ["keep.txt"]);
    await fs.rename(before, after);
    await assert.rejects(checkDownloadDirectory(before), /下载目录不存在/);
    const backend = new Backend({});
    let submitted = 0;
    backend.request = async () => {
      submitted++;
    };
    await assert.rejects(
      backend.taskAction(
        {
          kind: "download",
          local_path: path.join(before, "data.bin"),
          id: "a",
        },
        "resume",
      ),
      /下载目录不存在/,
    );
    await assert.rejects(
      checkUploadSource(path.join(before, "data.bin")),
      /文件或目录不存在/,
    );
    assert.equal(submitted, 0);
    assert.equal(
      await fs.readFile(path.join(after, "keep.txt"), "utf8"),
      "keep",
    );
    await checkDownloadDirectory(after);
  } finally {
    await fs.unlink(path.join(after, "keep.txt")).catch(() => {});
    await fs.rmdir(after).catch(() => {});
    await fs.rmdir(before).catch(() => {});
    await fs.rmdir(root);
  }
});

test("low disk space preflight does not write a probe or alter existing data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "disk-capacity-"));
  const original = fs.statfs;
  await fs.writeFile(path.join(root, "keep.bin"), "completed data");
  try {
    fs.statfs = async () => ({ bsize: 4096n, bavail: 1n });
    await assert.rejects(checkDownloadDirectory(root, 8192), /磁盘空间不足/);
    assert.deepEqual(await fs.readdir(root), ["keep.bin"]);
    assert.equal(
      await fs.readFile(path.join(root, "keep.bin"), "utf8"),
      "completed data",
    );
    await checkDownloadDirectory(root, 4096);
  } finally {
    fs.statfs = original;
    await fs.unlink(path.join(root, "keep.bin"));
    await fs.rmdir(root);
  }
});

test("kernel disk-full event reaches the task with actionable error and zero speed", async () => {
  const feed = new TransferFeed({
    backend: {
      tasks: async () => [
        { id: "a", kind: "download", status: "downloading", speed: 99 },
      ],
    },
    onTasks: () => {},
  });
  try {
    await feed.refresh();
    feed.message({
      type: "event",
      category: "download",
      event: {
        task_id: "a",
        event_type: "failed",
        error: "write failed: os error 112",
      },
    });
    const task = feed.snapshot()[0];
    assert.equal(task.status, "failed");
    assert.equal(task.speed, 0);
    assert.match(task.error, /释放.*空间后重试/);
  } finally {
    feed.stop();
  }
});

test("suspend invalidates stale progress and resume reopens stream without resuming paused tasks", async () => {
  const power = new EventEmitter();
  let resumes = 0;
  class Socket {
    constructor() {
      this.readyState = 0;
    }
    close() {}
  }
  const backend = {
    state: "ready",
    url: "http://127.0.0.1:1/api/v1",
    token: "test",
    tasks: async () => [
      { id: "a", kind: "download", status: "paused", speed: 0 },
    ],
    taskAction: () => {
      resumes++;
    },
  };
  const feed = new TransferFeed({
    backend,
    onTasks: () => {},
    WebSocketImpl: Socket,
  });
  const unbind = bindPowerEvents(power, backend, feed);
  try {
    feed.start();
    await feed.refresh();
    const old = feed.socket;
    power.emit("suspend");
    assert.equal(feed.running, false);
    assert.equal(feed.mode, "suspended");
    power.emit("resume");
    await feed.refresh();
    assert.notEqual(feed.socket, old);
    assert.equal(feed.running, true);
    old.onmessage({
      data: JSON.stringify({
        type: "event",
        category: "download",
        event: { event_type: "resumed", task_id: "a" },
      }),
    });
    assert.equal(feed.snapshot()[0].status, "paused");
    assert.equal(resumes, 0);
    backend.state = "failed";
    power.emit("suspend");
    power.emit("resume");
    assert.equal(feed.running, false);
  } finally {
    unbind();
    feed.stop();
  }
  assert.equal(power.listenerCount("resume"), 0);
});
