const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async ({
  mainWindow,
  floatWindow,
  backend,
  dispatch,
  quitApp,
  app,
  getFloatWindow,
  getTrayMenu,
  getSettingsWindow,
  tray,
  transferFeed,
  fitWindows,
}) => {
  const output = path.resolve("artifacts");
  await fs.mkdir(output, { recursive: true });
  try {
    mainWindow.showInactive();
    assert.equal(backend.state, "ready", backend.error);
    async function waitUntil(predicate, label) {
      for (let i = 0; i < 200; i++) {
        if (await predicate()) return;
        await delay(50);
      }
      throw new Error("Timed out: " + label);
    }
    await waitUntil(
      () => transferFeed.mode === "connected",
      "real kernel WebSocket subscription",
    );
    transferFeed.socket.close();
    await waitUntil(
      () => transferFeed.mode === "polling",
      "WebSocket fallback",
    );
    await waitUntil(
      () => transferFeed.mode === "connected",
      "WebSocket reconnect",
    );
    // UI fixtures run without a real empty-list reconciliation overwriting them.
    transferFeed.stop();
    const status = await backend.raw("/web-auth/status");
    const unauthorized = await fetch(backend.url + "/files");
    assert.ok(
      [401, 419].includes(unauthorized.status),
      "Local API must require authentication",
    );
    await delay(800);
    const text = await mainWindow.webContents.executeJavaScript(
      "document.body.innerText",
    );
    assert.ok(text.includes("登录，查看你的网盘文件"));
    assert.ok(!text.includes("开通会员"));
    await mainWindow.webContents.executeJavaScript(`Promise.all(
      [...document.querySelectorAll('[data-official-src], img.empty-illustration')].map(element => {
        const img = new Image(); img.src = element.dataset.officialSrc || element.src;
        return img.decode();
      })
    )`);
    const loginButton = await mainWindow.webContents.executeJavaScript(
      `(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('登录百度账号'));return {disabled:b.disabled,html:b.outerHTML,color:getComputedStyle(b).backgroundColor}; })()`,
    );
    assert.equal(
      loginButton.disabled,
      false,
      "Login must be enabled when backend is ready",
    );
    await mainWindow.webContents.executeJavaScript(
      `document.getAnimations().forEach(animation => animation.finish())`,
    );
    await delay(150);
    const image = await mainWindow.webContents.capturePage();
    await fs.writeFile(path.join(output, "desktop-files.png"), image.toPNG());
    await mainWindow.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('登录百度账号')).click()`,
    );
    await delay(300);
    await mainWindow.webContents.executeJavaScript(
      `document.getAnimations().forEach(animation => animation.finish())`,
    );
    await delay(100);
    assert.ok(
      (
        await mainWindow.webContents.executeJavaScript(
          "document.body.innerText",
        )
      ).includes("打开百度官方登录"),
    );
    await fs.writeFile(
      path.join(output, "desktop-login.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    await mainWindow.webContents.executeJavaScript(
      `document.querySelector('.ant-modal-close').click()`,
    );
    await require("./smoke-files.cjs").run({ mainWindow, backend, output });
    await require("./smoke-grid.cjs").run({ mainWindow, backend, output });
    await require("./smoke-columns.cjs").run({ mainWindow, backend, output });
    mainWindow.webContents.send("desktop:event", {
      type: "navigate",
      route: "/transfers",
    });
    await delay(350);
    assert.ok(
      (
        await mainWindow.webContents.executeJavaScript(
          "document.body.innerText",
        )
      ).includes("传输列表"),
    );
    await fs.writeFile(
      path.join(output, "desktop-transfers.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    await require("./smoke-transfers.cjs").run({ mainWindow, backend, output });
    mainWindow.webContents.send("desktop:event", {
      type: "navigate",
      route: "/settings",
    });
    for (let i = 0; i < 100; i++) {
      if (
        getSettingsWindow() &&
        !getSettingsWindow().webContents.isLoading() &&
        (await getSettingsWindow().webContents.executeJavaScript(
          "!!document.querySelector('.preferences-checks')",
        ))
      )
        break;
      await delay(50);
    }
    const settingsWindow = getSettingsWindow();
    assert.ok(settingsWindow, "Settings opens in a separate window");
    const settingsJS = (code) =>
      settingsWindow.webContents.executeJavaScript(code);
    assert.ok(
      await settingsJS("!!document.querySelector('.preferences-checks')"),
    );
    assert.ok(
      await settingsJS(
        "document.querySelector('.preferences-caption').getBoundingClientRect().top < 10 && document.querySelector('.preferences-nav').getBoundingClientRect().top < 70",
      ),
      "Settings title and navigation stay at the top",
    );
    assert.equal(
      await mainWindow.webContents.executeJavaScript("location.hash"),
      "#/transfers",
    );
    await delay(250);
    await fs.writeFile(
      path.join(output, "desktop-settings-startup.png"),
      (await settingsWindow.webContents.capturePage()).toPNG(),
    );
    // A real IPC save against the isolated smoke profile must survive reopening.
    const before = (await dispatch("settings:get")).closeToTray;
    await settingsJS(
      "document.querySelectorAll('.preferences-checks input')[2].click()",
    );
    await delay(200);
    assert.equal((await dispatch("settings:get")).closeToTray, !before);
    await settingsJS(
      "document.querySelectorAll('.preferences-nav button')[1].click()",
    );
    await delay(200);
    assert.ok(
      (await settingsJS("document.body.innerText")).includes("下载位置"),
    );
    assert.equal(
      await settingsJS("document.documentElement.scrollWidth > innerWidth"),
      false,
    );
    await fs.writeFile(
      path.join(output, "desktop-settings.png"),
      (await settingsWindow.webContents.capturePage()).toPNG(),
    );
    await dispatch("settings:open", { section: "about" });
    assert.equal(
      getSettingsWindow(),
      settingsWindow,
      "Repeated opens reuse settings window",
    );
    await delay(100);
    assert.ok(
      (await settingsJS("document.body.innerText")).includes("第三方客户端"),
    );
    await settingsJS("document.querySelector('[title=\"关闭设置\"]').click()");
    await delay(100);
    assert.equal(getSettingsWindow(), null);
    assert.equal(mainWindow.isDestroyed(), false);
    await dispatch("settings:open");
    await delay(350);
    assert.equal(
      await getSettingsWindow().webContents.executeJavaScript(
        "document.querySelectorAll('.preferences-checks input')[2].checked",
      ),
      !before,
    );
    await dispatch("settings:save", { closeToTray: before });
    await dispatch("settings:close");
    await fs.writeFile(
      path.join(output, "desktop-float.png"),
      (await floatWindow.webContents.capturePage()).toPNG(),
    );
    mainWindow.hide();
    await floatWindow.webContents.executeJavaScript(
      `document.querySelector('.floating-speeds').click()`,
    );
    await delay(200);
    assert.equal(
      mainWindow.isVisible(),
      false,
      "Single click on floating window must not open main window",
    );
    await floatWindow.webContents.executeJavaScript(
      `document.querySelector('.floating-speeds').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    );
    await delay(100);
    assert.equal(
      await floatWindow.webContents.executeJavaScript("location.hash"),
      "#/float",
      "Clicking the floating window must not navigate its own renderer",
    );
    assert.equal(
      await mainWindow.webContents.executeJavaScript("location.hash"),
      "#/transfers",
      "Double-click restores the main window without changing its current page",
    );
    floatWindow.webContents.send("desktop:event", {
      type: "logged-in",
      user: null,
    });
    await delay(100);
    assert.equal(
      await floatWindow.webContents.executeJavaScript("location.hash"),
      "#/float",
      "Login broadcasts must preserve the floating view",
    );
    await fs.writeFile(
      path.join(output, "desktop-float-after-click.png"),
      (await floatWindow.webContents.capturePage()).toPNG(),
    );
    const floatMetrics = await floatWindow.webContents.executeJavaScript(
      `({height:innerHeight,scroll:document.documentElement.scrollHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`,
    );
    assert.equal(
      floatMetrics.scroll,
      floatMetrics.height,
      "Floating window should not scroll vertically",
    );
    assert.equal(
      floatMetrics.scrollWidth,
      floatMetrics.width,
      "Floating window should not scroll horizontally",
    );
    assert.equal(
      mainWindow.webContents.getLastWebPreferences().nodeIntegration,
      false,
    );
    assert.equal(
      mainWindow.webContents.getLastWebPreferences().contextIsolation,
      true,
    );
    mainWindow.close();
    assert.equal(mainWindow.isDestroyed(), false);
    assert.equal(mainWindow.isVisible(), false, "Close hides main window");
    tray.emit("double-click");
    assert.equal(
      mainWindow.isVisible(),
      true,
      "Tray double-click restores main window",
    );
    mainWindow.minimize();
    getTrayMenu()
      .items.find((i) => i.label === "传输列表")
      .click();
    assert.equal(
      mainWindow.isMinimized(),
      false,
      "Tray navigation restores minimized window",
    );
    assert.equal(
      await mainWindow.webContents.executeJavaScript("location.hash"),
      "#/transfers",
    );
    const originalTasks = backend.tasks;
    backend.tasks = async () => [
      {
        id: "float-download",
        kind: "download",
        status: "downloading",
        speed: 1048576,
      },
      {
        id: "float-upload",
        kind: "upload",
        status: "uploading",
        speed: 524288,
      },
      {
        id: "stale-failure",
        kind: "download",
        status: "failed",
        speed: 104857600,
      },
      {
        id: "stale-paused",
        kind: "upload",
        status: "paused",
        speed: 104857600,
      },
    ];
    try {
      floatWindow.webContents.send("desktop:event", {
        type: "tasks",
        tasks: await backend.tasks(),
      });
      await delay(100);
      const speedText = await floatWindow.webContents.executeJavaScript(
        "document.querySelector('.floating-speeds').innerText",
      );
      assert.ok(
        speedText.includes("1.0 MB/s") && speedText.includes("512.0 KB/s"),
        "Floating speeds exclude failed/paused stale counters",
      );
      mainWindow.close();
      assert.equal(
        backend.state,
        "ready",
        "Close-to-tray keeps backend running",
      );
      await floatWindow.webContents.executeJavaScript(
        "document.querySelector('.floating-speeds').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
      );
      await delay(100);
      assert.equal(mainWindow.isVisible(), true);
      assert.equal(
        await floatWindow.webContents.executeJavaScript("location.hash"),
        "#/float",
      );
      await fs.writeFile(
        path.join(output, "desktop-float-transferring.png"),
        (await floatWindow.webContents.capturePage()).toPNG(),
      );
    } finally {
      backend.tasks = originalTasks;
    }
    const position = floatWindow.getPosition();
    floatWindow.setPosition(position[0] - 20, position[1] + 10);
    floatWindow.emit("moved");
    await delay(500);
    assert.deepEqual((await dispatch("settings:get")).floatPosition, {
      x: position[0] - 20,
      y: position[1] + 10,
    });
    getTrayMenu()
      .items.find((i) => i.label === "桌面悬浮窗")
      .click();
    await delay(150);
    assert.equal(getFloatWindow(), null);
    assert.equal(
      getTrayMenu().items.find((i) => i.label === "桌面悬浮窗").checked,
      false,
    );
    getTrayMenu()
      .items.find((i) => i.label === "桌面悬浮窗")
      .click();
    await delay(300);
    assert.deepEqual(getFloatWindow().getPosition(), [
      position[0] - 20,
      position[1] + 10,
    ]);
    assert.equal(
      getTrayMenu().items.find((i) => i.label === "桌面悬浮窗").checked,
      true,
    );
    getFloatWindow().setPosition(...position);
    getFloatWindow().emit("moved");
    await delay(500);
    const savedPosition = getFloatWindow().getPosition();
    getFloatWindow().setPosition(-30000, -30000);
    fitWindows();
    const work = require("electron").screen.getDisplayMatching(
      getFloatWindow().getBounds(),
    ).workArea;
    const repaired = getFloatWindow().getBounds();
    assert.ok(
      repaired.x >= work.x &&
        repaired.y >= work.y &&
        repaired.x + repaired.width <= work.x + work.width,
    );
    getFloatWindow().setPosition(...savedPosition);
    backend.child.kill();
    await waitUntil(
      () => backend.state === "failed",
      "kernel exit notification",
    );
    await waitUntil(
      () =>
        mainWindow.webContents.executeJavaScript(
          "!!document.querySelector('.backend-retry')",
        ),
      "recovery button",
    );
    await mainWindow.webContents.executeJavaScript(
      "document.querySelector('.backend-retry').click()",
    );
    await waitUntil(
      () => backend.state === "ready" && transferFeed.mode === "connected",
      "kernel recovery through UI",
    );
    const { spawn } = require("node:child_process");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    mainWindow.hide();
    const duplicate = spawn(
      app.getPath("exe"),
      [...(app.isPackaged ? [] : [path.resolve(".")]), "--smoke-test"],
      { env, windowsHide: true, stdio: "ignore" },
    );
    const duplicateExit = new Promise((resolve, reject) => {
      duplicate.once("exit", resolve);
      duplicate.once("error", reject);
    });
    await waitUntil(
      () => mainWindow.isVisible(),
      "second instance restores original window",
    );
    assert.equal(await duplicateExit, 0);
    await fs.writeFile(
      path.join(output, "smoke-result.json"),
      JSON.stringify(
        {
          passed: true,
          scaleFactor: require("electron").screen.getDisplayMatching(
            mainWindow.getBounds(),
          ).scaleFactor,
          checks: [
            "backend start",
            "API access authentication",
            "file empty state",
            "transfers view",
            "settings view",
            "independent settings window, top navigation, reuse, close and persisted settings",
            "file context menu selection isolation, edge positioning, Escape and rename target",
            "file hover actions aligned to the right of the filename column",
            "floating window",
            "isolated renderer",
            "close to tray",
            "floating toggle",
            "backend restart",
            "real kernel WebSocket subscription, disconnect fallback and reconnect",
            "kernel crash notification and recovery through renderer IPC",
            "off-screen window recovery and single-instance activation",
            "upload/download active and completed toolbar and hover states",
            "completed download three-column layout and date formatting",
            "tray restore and navigation while transfer backend remains running",
            "floating live speed excludes paused/failed tasks",
            "floating position persistence and tray menu checkbox synchronization",
          ],
          status,
        },
        null,
        2,
      ),
    );
    console.log("Desktop smoke checks passed");
    await fs.copyFile(
      path.join(output, "smoke-result.json"),
      path.join(
        output,
        `smoke-result-${process.argv.find((arg) => arg.startsWith("--force-device-scale-factor="))?.split("=")[1] || "system"}.json`,
      ),
    );
    await quitApp();
  } catch (error) {
    await fs.writeFile(
      path.join(output, "smoke-result.json"),
      JSON.stringify({ passed: false, error: error.stack }, null, 2),
    );
    console.error(error);
    backend.child?.kill();
    app.exit(1);
  }
};
