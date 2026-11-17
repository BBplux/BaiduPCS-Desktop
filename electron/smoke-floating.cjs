const assert = require("node:assert/strict");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { Menu } = require("electron");
async function wait(check, label) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(30);
  }
  throw Error(label);
}
exports.run = async ({
  mainWindow,
  getFloatWindow,
  dispatch,
  screen,
  backend,
  transferFeed,
  fitWindows,
}) => {
  mainWindow.showInactive();
  await delay(100);
  const floating = getFloatWindow();
  assert.ok(floating);
  while (floating.webContents.isLoading()) await delay(30);
  const js = (code) => floating.webContents.executeJavaScript(code);
  floating.show();
  floating.focus();
  await delay(200);
  mainWindow.hide();
  floating.focus();
  floating.webContents.focus();
  await js("document.querySelector('.floating-speeds').click()");
  await js("window.desktop.call('settings:get')");
  await delay(300);
  assert.equal(
    mainWindow.isVisible(),
    false,
    "Single click must not open the main window",
  );
  floating.webContents.sendInputEvent({
    type: "mouseDown",
    x: 80,
    y: 24,
    button: "left",
    clickCount: 2,
  });
  floating.webContents.sendInputEvent({
    type: "mouseUp",
    x: 80,
    y: 24,
    button: "left",
    clickCount: 2,
  });
  await js("window.desktop.call('settings:get')");
  await wait(
    () => mainWindow.isVisible(),
    "Double click opens the main window",
  );
  assert.equal(await js("location.hash"), "#/float");
  const route = await mainWindow.webContents.executeJavaScript("location.hash");
  mainWindow.hide();
  const originalCursor = screen.getCursorScreenPoint;
  let cursor = { x: 400, y: 300 };
  screen.getCursorScreenPoint = () => cursor;
  try {
    const originalSize = floating.getContentSize();
    const initialPosition = floating.getPosition();
    for (let gesture = 0; gesture < 3; gesture++) {
      cursor = { x: 400, y: 300 };
      await dispatch("float:pointer", { phase: "start" });
      for (let step = 1; step <= 40; step++) {
        cursor = { x: 400 + step, y: 300 + step };
        await dispatch("float:pointer", { phase: "move" });
        assert.deepEqual(
          floating.getContentSize(),
          originalSize,
          `Drag must keep content size (gesture ${gesture}, step ${step})`,
        );
      }
      await dispatch("float:pointer", { phase: "end" });
    }
    floating.setBounds({
      x: initialPosition[0],
      y: initialPosition[1],
      width: originalSize[0],
      height: originalSize[1],
    });
    const work = screen.getPrimaryDisplay().workArea;
    floating.setBounds({
      x: work.x + work.width - 10,
      y: work.y + work.height - 10,
      width: originalSize[0],
      height: originalSize[1],
    });
    fitWindows();
    await delay(500);
    assert.deepEqual(
      floating.getContentSize(),
      originalSize,
      "Screen-edge correction keeps floating size",
    );
    floating.setBounds({
      x: initialPosition[0],
      y: initialPosition[1],
      width: originalSize[0],
      height: originalSize[1],
    });
    for (const selector of [
      ".floating-grip",
      ".floating-speeds",
      ".floating-panel",
    ]) {
      floating.show();
      floating.focus();
      floating.webContents.focus();
      const point = await js(
        `(()=>{const r=document.querySelector('${selector}').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
      const before = floating.getPosition();
      cursor = { x: 400, y: 300 };
      floating.webContents.sendInputEvent({ type: "mouseMove", ...point });
      floating.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...point,
      });
      await delay(80);
      cursor = { x: 435, y: 314 };
      floating.webContents.sendInputEvent({
        type: "mouseMove",
        x: point.x + 8,
        y: point.y + 3,
      });
      await wait(
        () => floating.getPosition()[0] === before[0] + 35,
        "Dragging " + selector + " moves the window",
      );
      floating.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        x: point.x + 8,
        y: point.y + 3,
      });
      await js("window.desktop.call('settings:get')");
      assert.deepEqual(floating.getPosition(), [
        before[0] + 35,
        before[1] + 14,
      ]);
      assert.equal(
        mainWindow.isVisible(),
        false,
        "Dragging does not open main window",
      );
    }
  } finally {
    screen.getCursorScreenPoint = originalCursor;
  }
  await delay(500);
  const popup = Menu.prototype.popup;
  let menu;
  Menu.prototype.popup = function () {
    menu = this;
  };
  try {
    await js(
      "document.querySelector('.floating-speeds').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))",
    );
    await wait(() => !!menu, "Right click opens menu");
    assert.deepEqual(
      menu.items.filter((i) => i.type !== "separator").map((i) => i.label),
      [
        "打开主面板",
        "上传文件至百度网盘",
        "开始全部任务",
        "暂停全部任务",
        "隐藏悬浮球",
        "设置",
        "退出",
      ],
    );
    assert.equal(
      menu.items.find((i) => i.label === "开始全部任务").enabled,
      false,
    );
    assert.equal(
      menu.items.find((i) => i.label === "暂停全部任务").enabled,
      false,
    );
    const originalTasks = backend.tasks,
      originalAction = backend.taskAction;
    transferFeed.stop();
    const fixtures = [
      { id: "a", kind: "download", status: "paused" },
      { id: "b", kind: "upload", status: "failed" },
      { id: "c", kind: "download", status: "downloading" },
      { id: "d", kind: "upload", status: "uploading" },
      { id: "e", kind: "download", status: "completed" },
    ];
    const actions = [];
    try {
      backend.tasks = async () => structuredClone(fixtures);
      backend.taskAction = async (t, action) => {
        actions.push(t.id + ":" + action);
      };
      await transferFeed.refresh();
      await dispatch("float:menu");
      assert.equal(
        menu.items.find((i) => i.label === "开始全部任务").enabled,
        true,
      );
      assert.equal(
        menu.items.find((i) => i.label === "暂停全部任务").enabled,
        true,
      );
      menu.items.find((i) => i.label === "开始全部任务").click();
      await wait(() => actions.length === 2, "Resume all");
      assert.deepEqual(actions, ["a:resume", "b:resume"]);
      await delay(50);
      menu.items.find((i) => i.label === "暂停全部任务").click();
      await wait(() => actions.length === 4, "Pause all");
      assert.deepEqual(actions.slice(2), ["c:pause", "d:pause"]);
    } finally {
      backend.tasks = originalTasks;
      backend.taskAction = originalAction;
    }
    menu.items.find((i) => i.label === "上传文件至百度网盘").click();
    await wait(
      () =>
        mainWindow.webContents.executeJavaScript(
          "!!document.querySelector('.ant-modal-content')",
        ),
      "Upload without login opens login dialog",
    );
    await mainWindow.webContents.executeJavaScript(
      "document.querySelector('.ant-modal-close').click()",
    );
    menu.items.find((i) => i.label === "打开主面板").click();
    assert.equal(mainWindow.isVisible(), true);
    assert.equal(
      await mainWindow.webContents.executeJavaScript("location.hash"),
      route,
    );
    menu.items.find((i) => i.label === "设置").click();
    await wait(
      () =>
        require("electron")
          .BrowserWindow.getAllWindows()
          .some((w) => w.webContents.getURL().includes("#/settings")),
      "Menu opens settings",
    );
    await dispatch("settings:close");
    menu.items.find((i) => i.label === "隐藏悬浮球").click();
    await wait(() => !getFloatWindow(), "Hide floating window");
    assert.equal((await dispatch("settings:get")).floatEnabled, false);
    await dispatch("settings:save", { floatEnabled: true });
    await wait(() => !!getFloatWindow(), "Restore floating window");
  } finally {
    Menu.prototype.popup = popup;
  }
  console.log(
    "Floating single/double click, whole-surface drag, context menu and hide/restore checks passed",
  );
};
