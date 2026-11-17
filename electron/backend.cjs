const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { finished } = require("./policy.cjs");
const {
  checkDownloadDirectory,
  checkUploadSource,
} = require("./transfer-storage.cjs");
const { transferError } = require("./transfer-errors.cjs");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Backend extends EventEmitter {
  constructor({ executable, directory, downloads, safeStorage }) {
    super();
    Object.assign(this, { executable, directory, downloads, safeStorage });
    this.state = "starting";
    this.error = "";
    this.token = "";
    this.protectedStorage = false;
    this.version = "unknown";
  }
  setState(state) {
    this.state = state;
    this.emit("status", this.status());
  }
  async start() {
    this.error = "";
    this.setState("starting");
    this.token = "";
    try {
      await fs.access(this.executable);
      const metadata = JSON.parse(
        await fs.readFile(
          path.join(path.dirname(this.executable), "version.json"),
          "utf8",
        ),
      );
      this.version = metadata.version.replace(/^v/, "");
      await fs.mkdir(path.join(this.directory, "config"), { recursive: true });
      // User explicitly accepts upstream's normal on-disk Cookie storage.
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      this.port = server.address().port;
      await new Promise((resolve) => server.close(resolve));
      this.url = `http://127.0.0.1:${this.port}/api/v1`;
      const secretFile = path.join(this.directory, "service-key.bin");
      let password;
      try {
        password = (
          await this.safeStorage.decryptStringAsync(
            await fs.readFile(secretFile),
          )
        ).result;
      } catch {
        if (!(await this.safeStorage.isAsyncEncryptionAvailable()))
          throw new Error("Windows 凭据加密不可用");
        password = randomBytes(32).toString("hex");
        await fs.writeFile(
          secretFile,
          await this.safeStorage.encryptStringAsync(password),
        );
      }
      const hasAuth = await fs
        .access(path.join(this.directory, "config", "auth.json"))
        .then(
          () => true,
          () => false,
        );
      const config = `[server]\nhost = "127.0.0.1"\nport = ${this.port}\ncors_origins = []\n\n[download]\ndownload_dir = ${JSON.stringify(this.downloads)}\nask_each_time = false\nmax_global_threads = 1\nchunk_size_mb = 5\nmax_concurrent_tasks = 1\nmax_retries = 3\n\n[web_auth]\nenabled = ${hasAuth}\nmode = "${hasAuth ? "password" : "none"}"\n\n[persistence]\nauto_recover_tasks = true\nwal_flush_interval_ms = 200\n\n[log]\nlevel = "warn"\n`;
      await fs.writeFile(
        path.join(this.directory, "config", "app.toml"),
        config,
      );
      this.child = spawn(this.executable, [], {
        cwd: this.directory,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.child.on("error", (error) => {
        this.error = error.message;
        this.setState("failed");
      });
      this.child.on("exit", () => {
        if (this.state !== "stopping") {
          this.error ||= "后台进程已退出";
          this.setState("failed");
        }
      });
      // Drain streams without writing possibly sensitive upstream output to our logs.
      this.child.stdout.on("data", () => {});
      this.child.stderr.on("data", () => {});
      let online = false;
      for (let i = 0; i < 100; i++) {
        if (this.state === "failed") throw new Error(this.error);
        try {
          await this.raw("/web-auth/status");
          online = true;
          break;
        } catch {
          await delay(200);
        }
      }
      if (!online) throw new Error("后端启动超时");
      if (!hasAuth) {
        await this.raw("/web-auth/password/set", "POST", { password });
        await this.raw("/web-auth/config", "PUT", {
          enabled: true,
          mode: "password",
        });
      }
      this.password = password;
      await this.authenticate();
      this.setState("ready");
    } catch (error) {
      this.error = error.message;
      this.setState("failed");
      this.child?.kill();
    }
  }
  async authenticate() {
    if (this.authenticating) return this.authenticating;
    this.authenticating = (async () => {
      const value = await this.raw("/web-auth/login", "POST", {
        password: this.password,
      });
      this.token = (value.data || value).access_token;
      if (!this.token) throw new Error("后台访问认证失败");
    })();
    try {
      await this.authenticating;
    } finally {
      this.authenticating = null;
    }
  }
  async raw(route, method = "GET", body, retry = true) {
    const res = await fetch(this.url + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(
        method === "GET" || route.startsWith("/web-auth/") ? 15000 : 360000,
      ),
    });
    if (
      (res.status === 419 || res.status === 401) &&
      retry &&
      this.password &&
      !route.startsWith("/web-auth/")
    ) {
      await this.authenticate();
      return this.raw(route, method, body, false);
    }
    const text = await res.text();
    if (!text) throw new Error(`请求失败 (${res.status})`);
    const data = JSON.parse(text);
    if (!res.ok || (typeof data.code === "number" && data.code !== 0))
      throw new Error(
        transferError(
          data.message || data.error?.message || `请求失败 (${res.status})`,
        ),
      );
    return data;
  }
  async request(route, method = "GET", body) {
    if (this.state !== "ready")
      throw new Error(this.error || "后台正在启动，请稍候");
    const value = await this.raw(route, method, body);
    return Object.hasOwn(value, "data") ? value.data : value;
  }
  async tasks() {
    const [downloads, uploads] = await Promise.all([
      this.request("/downloads/all"),
      this.request("/uploads"),
    ]);
    return [
      ...(downloads || []).map((t) => ({
        ...t,
        kind: "download",
        folder: t.type === "folder",
        remote_path: t.remote_path || t.remote_root || t.name || "",
        local_path: t.local_path || t.local_root || "",
        speed: t.speed || 0,
        error: t.error ? transferError(t.error) : undefined,
        failure_reason: t.failure_reason
          ? transferError(t.failure_reason)
          : undefined,
      })),
      ...(uploads || []).map((t) => ({
        ...t,
        kind: "upload",
        error: t.error ? transferError(t.error) : undefined,
        failure_reason: t.failure_reason
          ? transferError(t.failure_reason)
          : undefined,
      })),
    ];
  }
  taskRoute(task) {
    return `/${task.kind === "download" ? `downloads${task.folder ? "/folder" : ""}` : "uploads"}/${encodeURIComponent(task.id)}`;
  }
  async taskAction(task, action) {
    if (action === "resume") {
      if (task.kind === "download") {
        await checkDownloadDirectory(path.dirname(task.local_path));
        if (task.folder && task.downloaded_size > 0)
          await checkDownloadDirectory(task.local_path);
      } else await checkUploadSource(task.local_path);
    }
    if (action === "delete") {
      // The bundled kernel owns cancellation and partial-file cleanup (#192).
      // Keep completed local files when removing records from the desktop UI.
      const query =
        task.kind === "download"
          ? task.folder
            ? "?delete_files=false"
            : "?delete_file=false"
          : "";
      return this.request(this.taskRoute(task) + query, "DELETE");
    }
    return this.request(`${this.taskRoute(task)}/${action}`, "POST");
  }
  async pauseActive() {
    const tasks = await this.tasks();
    for (const t of tasks.filter(
      (t) => !finished(t) && !["paused", "failed"].includes(t.status),
    ))
      await this.taskAction(t, "pause");
    // Upstream pause calls persist state. Allow the WAL flush cycle to finish before termination on Windows.
    await delay(700);
  }
  async recoverTransfers(autoResume) {
    if (!autoResume) return this.pauseActive();
    const tasks = await this.tasks();
    for (const task of tasks.filter((t) => t.status === "paused"))
      await this.taskAction(task, "resume");
  }
  async stop() {
    if (this.state === "ready") await this.pauseActive();
    this.setState("stopping");
    // A signal-terminated process keeps exitCode=null but has already exited.
    if (
      this.child &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    ) {
      const child = this.child;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
  }
  status() {
    return {
      state: this.state,
      error: this.error,
      protectedStorage: this.protectedStorage,
      version: this.version,
    };
  }
}
module.exports = { Backend };
