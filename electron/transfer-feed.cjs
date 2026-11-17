// One task stream for every desktop window. HTTP owns commands and reconciliation;
// WebSocket owns live progress. Neither credentials nor the socket reach renderers.
const key = (t) => `${t.kind}:${t.folder ? "folder:" : ""}${t.id}`;
const active = (status) => ["downloading", "uploading"].includes(status);
const { transferError } = require("./transfer-errors.cjs");

function applyEvent(tasks, { category, event: e }) {
  if (!e || !["download", "upload", "folder"].includes(category)) return false;
  const id = e.task_id || e.folder_id;
  const k = key({
    id,
    kind: category === "upload" ? "upload" : "download",
    folder: category === "folder",
  });
  const t = tasks.get(k);
  if (e.event_type === "deleted") {
    tasks.delete(k);
    return true;
  }
  if (!t) return false; // Folder children never become duplicate top-level rows.
  switch (e.event_type) {
    case "progress":
      // Priority delivery can place the final progress after paused/completed.
      if (!active(t.status) && t.status !== "scanning") break;
      for (const field of [
        "downloaded_size",
        "uploaded_size",
        "total_size",
        "speed",
        "completed_files",
        "total_files",
      ])
        if (Number.isFinite(e[field])) t[field] = e[field];
      break;
    case "status_changed":
      t.status = e.new_status;
      t.error = e.error ? transferError(e.error) : "";
      t.failure_reason = t.error;
      if (!active(t.status)) t.speed = 0;
      break;
    case "paused":
      t.status = "paused";
      t.speed = 0;
      break;
    case "resumed":
      t.status = "pending";
      t.speed = 0;
      t.error = "";
      t.failure_reason = "";
      break;
    case "failed":
      t.status = "failed";
      t.speed = 0;
      t.error = transferError(e.error);
      t.failure_reason = t.error;
      break;
    case "completed":
      t.status = e.is_rapid_upload ? "rapid_upload_success" : "completed";
      t.completed_at = e.completed_at;
      t.total_size = e.total_size ?? t.total_size;
      t[category === "upload" ? "uploaded_size" : "downloaded_size"] =
        t.total_size;
      t.speed = 0;
      break;
    case "scan_completed":
      t.total_size = e.total_size;
      t.total_files = e.total_files;
      break;
    case "decrypt_completed":
      t.local_path = e.decrypted_path;
      break;
  }
  return true;
}

class TransferFeed {
  constructor({
    backend,
    onTasks,
    onState = () => {},
    WebSocketImpl = globalThis.WebSocket,
    pollMs = 1500,
    reconcileMs = 30000,
    heartbeatMs = 15000,
    timeoutMs = 45000,
    retryMs = 1000,
  }) {
    Object.assign(this, {
      backend,
      onTasks,
      onState,
      WebSocketImpl,
      pollMs,
      reconcileMs,
      heartbeatMs,
      timeoutMs,
      retryMs,
    });
    this.tasks = new Map();
    this.mode = "stopped";
    this.generation = 0;
    this.running = false;
    this.revision = 0;
  }
  snapshot() {
    return [...this.tasks.values()].map((t) => ({ ...t }));
  }
  state(mode) {
    this.mode = mode;
    this.onState(mode);
  }
  start() {
    this.stop();
    this.running = true;
    this.attempt = 0;
    this.failures = 0;
    this.state("connecting");
    this.refresh().catch(() => {});
    this.connect();
    this.timer = setInterval(
      () => {
        if (!this.running) return;
        const interval =
          this.mode === "connected"
            ? this.reconcileMs
            : Math.min(this.pollMs * 2 ** this.failures, 15000);
        if (Date.now() - this.lastRefresh >= interval)
          this.refresh().catch(() => {});
        if (this.socket && Date.now() - this.lastMessage > this.timeoutMs)
          this.disconnect();
      },
      Math.min(this.pollMs, 1000),
    );
  }
  stop() {
    this.running = false;
    this.generation++;
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    clearTimeout(this.publishTimer);
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.socket?.close();
    this.socket = null;
    this.pending = null;
    this.journal = null;
    this.state("stopped");
    for (const t of this.tasks.values()) t.speed = 0;
    this.publish();
  }
  publish() {
    clearTimeout(this.publishTimer);
    this.publishTimer = null;
    this.onTasks(this.snapshot(), ++this.revision);
  }
  schedulePublish() {
    this.publishTimer ||= setTimeout(() => this.publish(), 80);
  }
  async refresh() {
    if (this.pending) return this.pending;
    const generation = this.generation;
    const journal = (this.journal = []);
    this.lastRefresh = Date.now();
    const operation = (async () => {
      try {
        const tasks = await this.backend.tasks();
        if (generation !== this.generation) return this.snapshot();
        const next = new Map(tasks.map((t) => [key(t), { ...t }]));
        // Replay events arriving while HTTP was in flight, including deletions.
        for (const event of journal) applyEvent(next, event);
        this.tasks = next;
        this.failures = 0;
        this.publish();
        return this.snapshot();
      } catch (error) {
        if (generation === this.generation)
          this.failures = Math.min((this.failures || 0) + 1, 4);
        throw error;
      } finally {
        if (generation === this.generation) {
          this.pending = null;
          this.journal = null;
        }
      }
    })();
    this.pending = operation;
    return operation;
  }
  reconcileSoon() {
    this.refreshTimer ||= setTimeout(async () => {
      this.refreshTimer = null;
      try {
        // A create may occur after the current HTTP snapshot was taken.
        if (this.pending) await this.pending;
        if (this.running) await this.refresh();
      } catch {}
    }, 150);
  }
  async connect() {
    const generation = this.generation;
    try {
      if (this.attempt) await this.backend.authenticate();
      if (!this.running || generation !== this.generation) return;
      const url =
        this.backend.url.replace(/^http/, "ws") +
        "/ws?access_token=" +
        encodeURIComponent(this.backend.token);
      const socket = (this.socket = new this.WebSocketImpl(url));
      this.lastMessage = Date.now();
      const current = () =>
        this.running &&
        generation === this.generation &&
        this.socket === socket;
      socket.onopen = () => {
        if (!current()) return;
        socket.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: ["download:*", "upload:*", "folder:*"],
          }),
        );
        this.heartbeat = setInterval(() => {
          if (current() && socket.readyState === 1)
            socket.send(
              JSON.stringify({ type: "ping", timestamp: Date.now() }),
            );
        }, this.heartbeatMs);
      };
      socket.onmessage = ({ data }) => {
        if (!current()) return;
        try {
          this.message(JSON.parse(data));
        } catch {
          this.disconnect();
        }
      };
      socket.onerror = () => {
        if (current()) this.disconnect();
      };
      socket.onclose = () => {
        if (current()) this.disconnect();
      };
    } catch {
      if (this.running && generation === this.generation) this.disconnect();
    }
  }
  disconnect() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    clearInterval(this.heartbeat);
    if (!this.running) return;
    this.state("polling");
    for (const task of this.tasks.values()) task.speed = 0;
    this.publish();
    this.refresh().catch(() => {});
    clearTimeout(this.retry);
    this.retry = setTimeout(
      () => this.connect(),
      Math.min(this.retryMs * 2 ** this.attempt++, 30000),
    );
  }
  message(message) {
    this.lastMessage = Date.now();
    if (message.type === "subscribe_success") {
      this.attempt = 0;
      this.state("connected");
      this.reconcileSoon();
    } else if (message.type === "snapshot") {
      // The HTTP aggregate has authoritative folder grouping and local paths.
      this.reconcileSoon();
    } else if (message.type === "error") {
      this.disconnect();
    } else {
      const events =
        message.type === "event_batch"
          ? message.events
          : message.type === "event"
            ? [message]
            : [];
      for (const event of events) {
        if (
          !["download", "upload", "folder"].includes(event.category) ||
          !event.event
        )
          continue;
        this.journal?.push(event);
        applyEvent(this.tasks, event);
        if (event.event.event_type !== "progress") this.reconcileSoon();
      }
      if (events.length) this.schedulePublish();
    }
  }
}
module.exports = { TransferFeed, applyEvent };
