const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  dialog,
  shell,
  session,
  safeStorage,
  screen,
  powerMonitor,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
app.setName("网盘桌面");
// Keep the established profile when renaming the application so accounts,
// settings, and saved transfers remain available. Test mode overrides it below.
app.setPath("userData", path.join(app.getPath("appData"), "网盘桌面"));
const { pathToFileURL } = require("node:url");
const { Backend } = require("./backend.cjs");
const { TransferFeed } = require("./transfer-feed.cjs");
const { visibleBounds } = require("./window-bounds.cjs");
const {
  checkDownloadDirectory,
  checkUploadSource,
} = require("./transfer-storage.cjs");
const { bindPowerEvents } = require("./desktop-power.cjs");
const {
  createFloatingDrag,
  floatingMenuTemplate,
  resumable,
  pausable,
} = require("./floating-controls.cjs");
const {
  isOfficialLoginUrl,
  cookieHeader,
  validateName,
  remotePath,
  joinRemote,
  finished,
} = require("./policy.cjs");
const restartVerification =
  process.argv.includes("--verify-restart") && !app.isPackaged;
const acceptanceTest = process.argv.includes("--acceptance-test");
const floatingTest = process.argv.includes("--floating-test");
const gridTest = process.argv.includes("--grid-test");
const columnsTest = process.argv.includes("--columns-test");
const navigationTest =
  process.argv.includes("--navigation-test") ||
  process.argv.includes("--breadcrumb-test") ||
  process.argv.includes("--file-delete-test");
const uiStyleTest = process.argv.includes("--ui-style-test");
const windowSizeTest = process.argv.includes("--window-size-test");
const settingsDragTest =
  process.argv.includes("--settings-drag-test") ||
  process.argv.includes("--settings-test");
const testMode =
  process.argv.includes("--smoke-test") ||
  restartVerification ||
  acceptanceTest ||
  floatingTest ||
  gridTest ||
  columnsTest ||
  navigationTest ||
  uiStyleTest ||
  windowSizeTest ||
  settingsDragTest;
if (testMode)
  app.setPath(
    "userData",
    restartVerification
      ? path.resolve(
          process.argv
            .find((arg) => arg.startsWith("--verification-root="))
            .slice("--verification-root=".length),
        )
      : path.resolve(acceptanceTest ? ".runtime/acceptance" : ".runtime/smoke"),
  );
let mainWindow,
  floatWindow,
  loginWindow,
  settingsWindow,
  tray,
  trayMenu,
  backend,
  quitting = false,
  quittingPromise,
  settings,
  settingsFile,
  transferFeed,
  restarting;
let settingsWrite = Promise.resolve();
let floatDrag,
  floatBatchBusy = false;
const defaultSettings = () => ({
  downloadDir: app.getPath("downloads"),
  closeToTray: true,
  floatEnabled: true,
  startAtLogin: false,
  autoResume: false,
  confirmExit: true,
  downloadConflict: "auto_rename",
  uploadConflict: "auto_rename",
  floatPosition: null,
  mainBounds: null,
  mainMaximized: false,
});
const send = (data) => {
  for (const w of [mainWindow, floatWindow, settingsWindow])
    if (w && !w.isDestroyed() && !w.webContents.isDestroyed())
      w.webContents.send("desktop:event", data);
};
const rootURL =
  process.env.VITE_DEV_SERVER_URL ||
  pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
const page = (name) => `${rootURL}#/${name}`;
function secureWindow(options) {
  const w = new BrowserWindow({
    ...options,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !testMode,
    },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] !== rootURL.split("#")[0]) event.preventDefault();
  });
  return w;
}
function icon() {
  return nativeImage.createFromPath(path.join(__dirname, "assets", "logo.ico"));
}
function showMain(route) {
  if (route === "/settings") return openSettings();
  if (mainWindow.isMinimized()) mainWindow.restore();
  fitWindow(mainWindow);
  mainWindow.show();
  mainWindow.focus();
  if (route)
    mainWindow.webContents.send("desktop:event", { type: "navigate", route });
}
function fitWindow(w) {
  if (!w || w.isDestroyed() || w.isMaximized()) return;
  const before = w.getBounds();
  // Frameless floating windows can report an enclosing outer rectangle one DIP
  // wider than their actual content at fractional DPI. Do not persist that size.
  const [width, height] = w === floatWindow ? w.getContentSize() : w.getSize();
  const after = visibleBounds(
    { ...before, width, height },
    screen.getAllDisplays(),
  );
  if (w === mainWindow || w === settingsWindow) {
    const work = screen.getDisplayMatching(after).workArea;
    w.setMinimumSize(
      Math.min(w === mainWindow ? 1000 : 760, work.width),
      Math.min(w === mainWindow ? 640 : 540, work.height),
    );
  }
  if (Object.keys(after).some((k) => before[k] !== after[k]))
    w.setBounds(after);
}
function fitWindows() {
  for (const w of [mainWindow, floatWindow, settingsWindow, loginWindow])
    fitWindow(w);
}
async function openSettings(section = "startup") {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    settingsWindow.webContents.send("desktop:event", {
      type: "settings-section",
      section,
    });
    return;
  }
  const w = (settingsWindow = secureWindow({
    width: 880,
    height: 622,
    minWidth: 760,
    minHeight: 540,
    frame: false,
    backgroundColor: "#ffffff",
    title: "网盘设置",
    parent: mainWindow,
    show: false,
    icon: icon(),
  }));
  w.on("closed", () => {
    if (settingsWindow === w) settingsWindow = null;
  });
  await w.loadURL(
    page("settings") +
      "?section=" +
      (section === "about" ? "about" : "startup"),
  );
  if (!w.isDestroyed()) {
    fitWindow(w);
    w.show();
    w.focus();
  }
}
function updateTray() {
  trayMenu = Menu.buildFromTemplate([
    { label: "打开网盘", click: () => showMain("/files") },
    { label: "传输列表", click: () => showMain("/transfers") },
    { type: "separator" },
    {
      label: "桌面悬浮窗",
      type: "checkbox",
      checked: settings.floatEnabled,
      click: () => saveSettings({ floatEnabled: !settings.floatEnabled }),
    },
    { label: "设置", click: () => showMain("/settings") },
    { type: "separator" },
    { label: "退出", click: () => quitApp() },
  ]);
  tray.setContextMenu(trayMenu);
}
function createFloat() {
  if (floatWindow && !floatWindow.isDestroyed()) return;
  const work = screen.getPrimaryDisplay().workArea;
  const pos = settings.floatPosition;
  const visible =
    pos &&
    screen
      .getAllDisplays()
      .some(
        (d) =>
          pos.x >= d.workArea.x &&
          pos.y >= d.workArea.y &&
          pos.x + 168 <= d.workArea.x + d.workArea.width &&
          pos.y + 48 <= d.workArea.y + d.workArea.height,
      );
  floatWindow = secureWindow({
    width: 168,
    height: 48,
    x: visible ? pos.x : work.x + work.width - 240,
    y: visible ? pos.y : work.y + 140,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: !testMode,
  });
  floatWindow.loadURL(page("float"));
  floatDrag = createFloatingDrag(floatWindow, screen);
  let timer;
  floatWindow.on("moved", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (floatWindow && !floatWindow.isDestroyed()) {
        fitWindow(floatWindow);
        const [x, y] = floatWindow.getPosition();
        settings.floatPosition = { x, y };
        await persistSettings();
      }
    }, 400);
  });
  floatWindow.on("closed", () => {
    clearTimeout(timer);
    floatWindow = null;
    floatDrag = null;
  });
}
async function floatingBatch(action) {
  if (floatBatchBusy) return;
  floatBatchBusy = true;
  try {
    const tasks = (await backend.tasks()).filter(
      action === "resume" ? resumable : pausable,
    );
    let failed = 0;
    for (const task of tasks) {
      try {
        await backend.taskAction(task, action);
      } catch {
        failed++;
      }
    }
    transferFeed.reconcileSoon();
    if (failed) throw Error(`${failed} 个任务处理失败，请在传输列表中重试。`);
  } finally {
    floatBatchBusy = false;
  }
}
function floatingMenu() {
  if (!floatWindow || floatWindow.isDestroyed()) return;
  floatDrag?.("end");
  const guarded = (fn) => () =>
    Promise.resolve()
      .then(fn)
      .catch((error) => {
        if (quitting) return;
        showMain();
        send({ type: "recovery-error", message: error.message });
      });
  const menu = Menu.buildFromTemplate(
    floatingMenuTemplate({
      tasks: transferFeed.snapshot(),
      ready: backend.state === "ready",
      busy: floatBatchBusy,
      open: () => showMain(),
      upload: () => {
        showMain();
        mainWindow.webContents.send("desktop:event", {
          type: "floating-upload",
        });
      },
      batch: (action) => guarded(() => floatingBatch(action))(),
      hide: guarded(() => saveSettings({ floatEnabled: false })),
      settings: guarded(() => openSettings()),
      quit: guarded(() => quitApp()),
    }),
  );
  menu.popup({ window: floatWindow });
}
async function persistSettings() {
  const snapshot = JSON.stringify(settings, null, 2);
  settingsWrite = settingsWrite
    .catch(() => {})
    .then(async () => {
      await fs.writeFile(settingsFile + ".tmp", snapshot);
      await fs.rename(settingsFile + ".tmp", settingsFile);
    });
  return settingsWrite;
}
async function saveSettings(patch) {
  for (const key of [
    "closeToTray",
    "floatEnabled",
    "startAtLogin",
    "autoResume",
    "confirmExit",
  ])
    if (typeof patch[key] === "boolean") settings[key] = patch[key];
  if (["auto_rename", "skip", "overwrite"].includes(patch.downloadConflict))
    settings.downloadConflict = patch.downloadConflict;
  if (
    ["auto_rename", "smart_dedup", "overwrite"].includes(patch.uploadConflict)
  )
    settings.uploadConflict = patch.uploadConflict;
  await persistSettings();
  if (!testMode)
    app.setLoginItemSettings({ openAtLogin: settings.startAtLogin });
  if (settings.floatEnabled) createFloat();
  else floatWindow?.close();
  updateTray();
  send({ type: "settings", settings });
  return settings;
}
async function quitApp({ forUpdate = false } = {}) {
  if (quittingPromise) return quittingPromise;
  quittingPromise = (async () => {
    try {
      const tasks = backend.state === "ready" ? await backend.tasks() : [];
      if (
        !testMode &&
        !forUpdate &&
        settings.confirmExit &&
        tasks.some((t) => !finished(t))
      ) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: "question",
          buttons: ["保留后台传输", "退出"],
          defaultId: 0,
          cancelId: 0,
          message: "仍有未完成的传输任务",
          detail: "退出将暂停任务并保存进度，下次启动可继续。",
          checkboxLabel: "下次不再提示",
          checkboxChecked: false,
        });
        if (result.response !== 1) return;
        if (result.checkboxChecked) {
          settings.confirmExit = false;
          await persistSettings();
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        settings.mainBounds = mainWindow.getNormalBounds();
        settings.mainMaximized = mainWindow.isMaximized();
      }
      if (floatWindow && !floatWindow.isDestroyed()) {
        const [x, y] = floatWindow.getPosition();
        settings.floatPosition = { x, y };
      }
      await persistSettings();
      await backend.stop();
      quitting = true;
      transferFeed?.stop();
      loginWindow?.destroy();
      settingsWindow?.destroy();
      floatWindow?.destroy();
      tray?.destroy();
      app.quit();
    } catch (error) {
      if (!testMode)
        await dialog.showMessageBox(mainWindow, {
          type: "error",
          message: "尚未退出",
          detail: `无法确认任务已经保存：${error.message}`,
        });
    } finally {
      quittingPromise = null;
    }
  })();
  return quittingPromise;
}
async function loginWithCookie(cookies) {
  if (
    typeof cookies !== "string" ||
    cookies.length > 64000 ||
    !/(^|;\s*)BDUSS=/.test(cookies)
  )
    throw new Error("Cookie 中缺少 BDUSS");
  const user = await backend.request("/auth/cookie/login", "POST", { cookies });
  send({ type: "logged-in", user });
  return user;
}
async function openOfficialLogin() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  // In-memory browser session; upstream's account store remembers the login.
  const authSession = session.fromPartition("official-login");
  authSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  loginWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    title: "百度官方账号登录",
    parent: mainWindow,
    autoHideMenuBar: true,
    webPreferences: {
      session: authSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const w = loginWindow;
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (isOfficialLoginUrl(url)) w.loadURL(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if (!isOfficialLoginUrl(url)) e.preventDefault();
  });
  w.webContents.on("will-redirect", (e, url) => {
    if (!isOfficialLoginUrl(url)) e.preventDefault();
  });
  let pending = false,
    lastCookie = "",
    interval;
  const capture = async () => {
    if (pending || w.isDestroyed()) return;
    const current = w.webContents.getURL();
    if (!current.startsWith("https://pan.baidu.com/")) return;
    const cookies = cookieHeader(
      await authSession.cookies.get({ url: "https://pan.baidu.com/" }),
    );
    if (!/(^|;\s*)BDUSS=/.test(cookies) || cookies === lastCookie) return;
    pending = true;
    lastCookie = cookies;
    try {
      await loginWithCookie(cookies);
      w.close();
    } catch {
      send({
        type: "login-error",
        message: "官方会话已获取，但后端验证未通过。请完成网页验证后重试。",
      });
    } finally {
      pending = false;
    }
  };
  w.webContents.on("did-finish-load", capture);
  interval = setInterval(capture, 2000);
  w.on("closed", () => {
    clearInterval(interval);
    loginWindow = null;
  });
  await w.loadURL("https://pan.baidu.com/");
}
async function uploadPaths(paths, dir) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 1000)
    throw new Error("请选择要上传的文件");
  remotePath(dir);
  const results = [];
  for (const local of paths) {
    if (typeof local !== "string" || !path.isAbsolute(local))
      throw new Error("本地文件路径无效");
    const stat = await checkUploadSource(local);
    const remote = joinRemote(dir, path.basename(local));
    const body = stat.isDirectory()
      ? { local_folder: local, remote_folder: remote }
      : { local_path: local, remote_path: remote };
    results.push(
      await backend.request(
        stat.isDirectory() ? "/uploads/folder" : "/uploads",
        "POST",
        { ...body, conflict_strategy: settings.uploadConflict },
      ),
    );
  }
  send({ type: "tasks-changed" });
  return results;
}
async function dispatch(command, p = {}) {
  switch (command) {
    case "status":
      return { ...backend.status(), connection: transferFeed?.mode };
    case "backend:restart":
      if (restarting) return restarting;
      if (backend.state === "ready") return backend.status();
      restarting = (async () => {
        transferFeed.stop();
        await backend.stop();
        await backend.start();
        if (backend.state !== "ready") throw new Error(backend.error);
        try {
          await backend.recoverTransfers(settings.autoResume);
        } catch {
          send({
            type: "recovery-error",
            message: "后台已恢复，部分传输未能恢复，请在传输列表中重试。",
          });
        } finally {
          transferFeed.start();
        }
        return backend.status();
      })();
      try {
        return await restarting;
      } finally {
        restarting = null;
      }
    case "settings:get":
      return settings;
    case "settings:save":
      return saveSettings(p);
    case "settings:open":
      await openSettings(p.section);
      return;
    case "settings:close":
      settingsWindow?.close();
      return;
    case "window:minimize":
      return mainWindow.minimize();
    case "window:maximize":
      return mainWindow.isMaximized()
        ? mainWindow.unmaximize()
        : mainWindow.maximize();
    case "window:close":
      return mainWindow.close();
    case "window:show":
      return showMain(p.route);
    case "float:pointer":
      if (!["start", "move", "end"].includes(p.phase))
        throw Error("无效的悬浮窗操作");
      return floatDrag?.(p.phase);
    case "float:menu":
      return floatingMenu();
    case "app:quit":
      return quitApp();
    case "auth:official":
      return openOfficialLogin();
    case "auth:cookie":
      return loginWithCookie(p.cookies);
    case "auth:user":
      return backend.request("/auth/user");
    case "auth:qr":
      return backend.request("/auth/qrcode/generate", "POST");
    case "auth:qr-status":
      return backend.request(
        `/auth/qrcode/status?sign=${encodeURIComponent(p.sign)}`,
      );
    case "auth:logout": {
      await backend.pauseActive();
      await backend.request("/auth/logout", "POST");
      loginWindow?.close();
      await session.fromPartition("official-login").clearStorageData();
      await session.fromPartition("official-login").clearCache();
      // Upstream rolls account backups; remove credential-bearing remnants only after logout succeeds.
      for (const file of [
        "accounts.json.bak",
        "session.json",
        "session.json.bak",
        "session.json.migrated",
      ])
        await fs.rm(path.join(backend.directory, "config", file), {
          force: true,
        });
      send({ type: "logged-out" });
      return;
    }
    case "files:list":
      return backend.request(
        `/files?dir=${encodeURIComponent(remotePath(p.dir || "/"))}&page=${Math.max(1, Number(p.page) || 1)}&page_size=100&order=${["name", "size", "time"].includes(p.order) ? p.order : "name"}&desc=${!!p.desc}`,
      );
    case "files:search":
      if (!String(p.key || "").trim()) throw new Error("请输入搜索内容");
      return backend.request(
        `/files/search?key=${encodeURIComponent(p.key)}&page=${Math.max(1, Number(p.page) || 1)}&num=100&recursion=1`,
      );
    case "files:mkdir":
      return backend.request("/files/folder", "POST", {
        path: joinRemote(p.dir, p.name),
      });
    case "files:rename":
      return backend.request("/files/rename", "POST", {
        item: {
          path: remotePath(p.path),
          newname: validateName(p.name),
          id: p.id,
        },
      });
    case "files:move":
      return backend.request("/files/move", "POST", {
        items: p.items.map((i) => ({
          path: remotePath(i.path),
          dest: remotePath(p.dest),
          newname: validateName(i.name),
        })),
        ondup: "newcopy",
      });
    case "files:delete": {
      if (!Array.isArray(p.paths) || !p.paths.length || p.paths.length > 1000)
        throw new Error("请选择要删除的文件");
      const paths = p.paths.map(remotePath);
      if (paths.includes("/")) throw new Error("不能删除网盘根目录");
      // The renderer's file-delete dialog confirms the captured selection before IPC.
      return backend.request("/files/delete", "POST", { paths });
    }
    case "download": {
      if (!Array.isArray(p.items) || !p.items.length || p.items.length > 1000)
        throw Error("请选择要下载的文件");
      const required = p.items.reduce(
        (sum, item) =>
          sum +
          (Number.isSafeInteger(item.size) && item.size > 0 ? item.size : 0),
        0,
      );
      await checkDownloadDirectory(settings.downloadDir, required);
      const result = await backend.request("/downloads/batch", "POST", {
        items: p.items,
        target_dir: settings.downloadDir,
        conflict_strategy: settings.downloadConflict,
      });
      send({ type: "tasks-changed" });
      return result;
    }
    case "upload:choose": {
      const chosen = await dialog.showOpenDialog(mainWindow, {
        properties: p.folder
          ? ["openDirectory"]
          : ["openFile", "multiSelections"],
      });
      if (!chosen.canceled) return uploadPaths(chosen.filePaths, p.dir || "/");
      return [];
    }
    case "upload:drop":
      return uploadPaths(p.paths, p.dir || "/");
    case "tasks:list":
      return transferFeed.refresh();
    case "tasks:batch": {
      if (
        !["pause", "resume", "delete"].includes(p.action) ||
        !["download", "upload"].includes(p.kind) ||
        !Array.isArray(p.ids) ||
        !p.ids.length ||
        p.ids.length > 10000 ||
        p.ids.some((id) => typeof id !== "string")
      )
        throw new Error("批量传输参数无效");
      const ids = new Set(p.ids);
      const tasks = (await backend.tasks()).filter(
        (t) => t.kind === p.kind && ids.has(t.id),
      );
      let failed = ids.size - tasks.length;
      for (const task of tasks) {
        try {
          await backend.taskAction(task, p.action);
        } catch {
          failed++;
        }
      }
      transferFeed.reconcileSoon();
      return { succeeded: ids.size - failed, failed };
    }
    case "tasks:action": {
      if (
        !["pause", "resume", "delete"].includes(p.action) ||
        !["download", "upload"].includes(p.kind)
      )
        throw new Error("不支持的传输操作");
      const task = (await backend.tasks()).find(
        (t) => t.id === p.id && t.kind === p.kind,
      );
      if (!task) throw new Error("传输任务不存在");
      return backend.taskAction(task, p.action);
    }
    case "tasks:open-directory": {
      const task = (await backend.tasks()).find(
        (t) => t.id === p.id && t.kind === "download",
      );
      if (!task) throw new Error("下载任务不存在");
      if (!task.local_path || !path.isAbsolute(task.local_path))
        throw new Error("该任务没有有效的保存位置");
      const directory = task.folder
        ? task.local_path
        : path.dirname(task.local_path);
      const error = await shell.openPath(directory);
      if (error) throw new Error(`无法打开所在文件夹：${error}`);
      return;
    }
    case "directory:choose": {
      const chosen = await dialog.showOpenDialog(settingsWindow || mainWindow, {
        defaultPath: settings.downloadDir,
        properties: ["openDirectory", "createDirectory"],
      });
      if (!chosen.canceled) {
        settings.downloadDir = chosen.filePaths[0];
        await persistSettings();
        send({ type: "settings", settings });
      }
      return settings;
    }
    case "directory:open":
      return shell.openPath(settings.downloadDir);
    default:
      throw new Error("未知操作");
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else if (process.argv.includes("--quit-for-update")) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--quit-for-update")) void quitApp({ forUpdate: true });
    else if (mainWindow) showMain();
  });
  app.on("before-quit", (e) => {
    if (!quitting) {
      e.preventDefault();
      quitApp();
    }
  });
  app.on("window-all-closed", () => {});
  app
    .whenReady()
    .then(async () => {
      settingsFile = path.join(app.getPath("userData"), "settings.json");
      await fs.mkdir(app.getPath("userData"), { recursive: true });
      settings = defaultSettings();
      try {
        Object.assign(
          settings,
          JSON.parse(await fs.readFile(settingsFile, "utf8")),
        );
      } catch {}
      // Explicit launch option: use the new default once, then remember user resizing.
      if (process.argv.includes("--reset-window-bounds") || windowSizeTest) {
        settings.mainBounds = null;
        settings.mainMaximized = false;
      }
      backend = new Backend({
        executable: app.isPackaged
          ? path.join(process.resourcesPath, "backend/baidu-netdisk-rust.exe")
          : path.join(__dirname, "../vendor/backend/baidu-netdisk-rust.exe"),
        directory: path.join(app.getPath("userData"), "backend"),
        downloads: settings.downloadDir,
        safeStorage,
      });
      transferFeed = new TransferFeed({
        backend,
        onTasks: (tasks) => send({ type: "tasks", tasks }),
        onState: (connection) =>
          send({
            type: "backend",
            status: { ...backend.status(), connection },
          }),
      });
      backend.on("status", (status) => {
        if (status.state !== "ready") transferFeed.stop();
        send({
          type: "backend",
          status: { ...status, connection: transferFeed.mode },
        });
      });
      const unbindPowerEvents = bindPowerEvents(
        powerMonitor,
        backend,
        transferFeed,
      );
      app.once("will-quit", unbindPowerEvents);
      ipcMain.handle("desktop:call", async (event, command, payload) => {
        if (
          ![mainWindow, floatWindow, settingsWindow].some(
            (w) => w && !w.isDestroyed() && w.webContents === event.sender,
          ) ||
          event.senderFrame !== event.sender.mainFrame
        )
          throw new Error("不受信任的调用来源");
        try {
          return { ok: true, data: await dispatch(command, payload) };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
      const initialMainBounds = visibleBounds(
        settings.mainBounds,
        screen.getAllDisplays(),
      );
      mainWindow = secureWindow({
        ...initialMainBounds,
        minWidth: 1000,
        minHeight: 640,
        frame: false,
        backgroundColor: "#ffffff",
        title: "网盘桌面",
        icon: icon(),
        show: false,
      });
      let boundsTimer;
      // Some mouse drivers deliver a Windows app command instead of a DOM
      // side-button event. Route it to the same directory-history action.
      mainWindow.on("app-command", (event, command) => {
        if (command !== "browser-backward" && command !== "browser-forward")
          return;
        event.preventDefault();
        mainWindow.webContents.send("desktop:event", {
          type: "directory-history",
          offset: command === "browser-backward" ? -1 : 1,
        });
      });
      const rememberBounds = () => {
        clearTimeout(boundsTimer);
        boundsTimer = setTimeout(() => {
          if (mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
          settings.mainBounds = mainWindow.getNormalBounds();
          settings.mainMaximized = mainWindow.isMaximized();
          persistSettings().catch(() => {});
        }, 300);
      };
      for (const event of ["move", "resize", "maximize", "unmaximize"])
        mainWindow.on(event, rememberBounds);
      for (const event of [
        "display-added",
        "display-removed",
        "display-metrics-changed",
      ])
        screen.on(event, fitWindows);
      if (settings.mainMaximized) mainWindow.maximize();
      mainWindow.on("close", (e) => {
        if (!quitting) {
          e.preventDefault();
          if (settings.closeToTray) mainWindow.hide();
          else quitApp();
        }
      });
      mainWindow.once("ready-to-show", () => {
        if (!mainWindow.isMaximized()) mainWindow.setBounds(initialMainBounds);
        fitWindow(mainWindow);
        if (!testMode) mainWindow.show();
      });
      tray = new Tray(
        nativeImage.createFromPath(path.join(__dirname, "assets", "tray.png")),
      );
      tray.setToolTip("网盘桌面");
      tray.on("double-click", () => showMain());
      updateTray();
      await mainWindow.loadURL(page("files"));
      if (settings.floatEnabled) createFloat();
      await backend.start();
      send({ type: "backend", status: backend.status() });
      if (backend.state === "ready") {
        try {
          await backend.recoverTransfers(settings.autoResume);
        } catch {
          send({
            type: "recovery-error",
            message: "部分传输未能恢复，请在传输列表中重试。",
          });
        }
      }
      if (backend.state === "ready") transferFeed.start();
      if (windowSizeTest) {
        transferFeed.stop();
        await require("./check-window-size.cjs").run({ app, mainWindow });
      } else if (uiStyleTest) {
        transferFeed.stop();
        mainWindow.showInactive();
        const pages = (
          process.argv
            .find((a) => a.startsWith("--ui-style-pages="))
            ?.split("=")[1] || "files,transfers,settings,floating"
        ).split(",");
        const context = {
          mainWindow,
          backend,
          output: path.resolve("artifacts"),
        };
        if (pages.includes("files"))
          await require("./smoke-files.cjs").run({
            ...context,
            styleOnly: true,
          });
        if (pages.includes("transfers"))
          await require("./smoke-transfers.cjs").run(context);
        if (pages.includes("settings"))
          await require("./check-settings-drag.cjs").run({
            mainWindow,
            dispatch,
            getSettingsWindow: () => settingsWindow,
            verifyStyle: true,
          });
        if (pages.includes("floating")) {
          createFloat();
          await require("./check-ui-style.cjs").floating(floatWindow);
        }
        console.log(`UI style checks passed (${pages.join(", ")})`);
        await quitApp();
      } else if (settingsDragTest) {
        transferFeed.stop();
        mainWindow.showInactive();
        await require("./check-settings-drag.cjs").run({
          mainWindow,
          dispatch,
          getSettingsWindow: () => settingsWindow,
        });
        await quitApp();
      } else if (gridTest || columnsTest || navigationTest) {
        transferFeed.stop();
        mainWindow.showInactive();
        await require(
          navigationTest
            ? "./smoke-files.cjs"
            : columnsTest
              ? "./smoke-columns.cjs"
              : "./smoke-grid.cjs",
        ).run({
          mainWindow,
          backend,
          output: path.resolve("artifacts"),
          navigationOnly: navigationTest,
        });
        console.log(
          navigationTest
            ? "File navigation checks passed"
            : columnsTest
              ? "Column resize checks passed"
              : "Grid view checks passed",
        );
        await quitApp();
      } else if (floatingTest) {
        await require("./smoke-floating.cjs").run({
          mainWindow,
          getFloatWindow: () => floatWindow,
          dispatch,
          screen,
          backend,
          transferFeed,
          fitWindows,
        });
        await quitApp();
      } else if (acceptanceTest)
        await require("./smoke-acceptance.cjs").run({
          app,
          mainWindow,
          backend,
          dispatch,
          quitApp,
          transferFeed,
          getFloatWindow: () => floatWindow,
        });
      else if (restartVerification)
        await require("../scripts/desktop-restart-phase.cjs").run({
          app,
          backend,
          dispatch,
          quitApp,
          getFloatWindow: () => floatWindow,
        });
      else if (testMode)
        await require("./smoke.cjs").run({
          app,
          mainWindow,
          floatWindow,
          backend,
          dispatch,
          quitApp,
          getFloatWindow: () => floatWindow,
          getTrayMenu: () => trayMenu,
          getSettingsWindow: () => settingsWindow,
          tray,
          transferFeed,
          fitWindows,
        });
    })
    .catch((error) => {
      console.error(error.message);
      quitting = true;
      backend?.child?.kill();
      app.exit(1);
    });
}
