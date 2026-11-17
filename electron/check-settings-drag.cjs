// Settings-only checks, with optional native title-bar drag verification.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
exports.run = async ({
  mainWindow,
  dispatch,
  getSettingsWindow,
  verifyStyle = false,
}) => {
  await dispatch("settings:open");
  const settings = getSettingsWindow();
  settings.setTitle("设置拖动验证（隔离窗口）");
  await new Promise((r) => setTimeout(r, 1500));
  const initial = settings.getBounds();
  if (verifyStyle) await require("./check-ui-style.cjs").settings(settings);
  const mainBefore = mainWindow.getBounds();
  await fs.mkdir("artifacts", { recursive: true });
  await fs.writeFile(
    "artifacts/settings-drag-before.json",
    JSON.stringify({ initial, mainBefore }),
  );
  const nativeDrag = process.argv.includes("--settings-drag-test");
  if (nativeDrag) {
    console.log(
      "Settings drag check ready: use native input on the title bar.",
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settings.off("moved", moved);
        reject(Error("No native settings-window drag observed"));
      }, 180000);
      function moved() {
        const b = settings.getBounds();
        if (Math.abs(b.x - initial.x) + Math.abs(b.y - initial.y) < 20) return;
        clearTimeout(timer);
        settings.off("moved", moved);
        resolve();
      }
      settings.on("moved", moved);
    });
    await new Promise((r) => setTimeout(r, 1000));
    assert.deepEqual(
      mainWindow.getBounds(),
      mainBefore,
      "Dragging settings must not move main window",
    );
  }
  const movedTo = settings.getBounds();
  await settings.webContents.executeJavaScript(
    "document.querySelectorAll('.preferences-nav button')[1].click()",
  );
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(
    await settings.webContents.executeJavaScript(
      "document.body.innerText.includes('下载位置')",
    ),
  );
  await dispatch("settings:open");
  assert.equal(
    getSettingsWindow(),
    settings,
    "Repeated opening reuses the settings window",
  );
  await settings.webContents.executeJavaScript(
    "document.querySelector('[title=\"关闭设置\"]').click()",
  );
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(getSettingsWindow(), null);
  assert.equal(mainWindow.isDestroyed(), false);
  await fs.writeFile(
    "artifacts/settings-drag-result.json",
    JSON.stringify(
      {
        passed: true,
        nativeDragVerified: nativeDrag,
        initial,
        movedTo,
        checks: [
          ...(nativeDrag
            ? ["native title-bar drag", "main window unchanged"]
            : []),
          "settings navigation",
          "reuse and close",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    nativeDrag
      ? "Settings drag checks passed"
      : "Settings window checks passed; native drag not verified",
  );
};
