const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
exports.run = async ({ app, mainWindow }) => {
  mainWindow.showInactive();
  await new Promise((r) => setTimeout(r, 500));
  const actualContent = mainWindow.getContentSize();
  // Windows rounds physical client rectangles at fractional DPI.
  assert.ok(Math.abs(actualContent[0] - 1100) <= 1);
  assert.ok(Math.abs(actualContent[1] - 700) <= 1);
  assert.equal(mainWindow.isMaximized(), false);
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/window-default.png",
    (await mainWindow.webContents.capturePage()).toPNG(),
  );
  let requested = false;
  app.once("second-instance", (_event, argv) => {
    assert.ok(argv.includes("--quit-for-update"));
    requested = true;
  });
  const timer = setTimeout(() => {
    console.error("Graceful update exit timed out");
    app.exit(1);
  }, 20000);
  app.once("will-quit", () => {
    clearTimeout(timer);
    assert.equal(requested, true);
    const saved = JSON.parse(
      fs.readFileSync(path.join(app.getPath("userData"), "settings.json")),
    );
    assert.ok(Math.abs(saved.mainBounds.width - 1100) <= 2);
    assert.ok(Math.abs(saved.mainBounds.height - 700) <= 2);
    fs.writeFileSync(
      "artifacts/window-default-result.json",
      JSON.stringify(
        {
          passed: true,
          size: [1100, 700],
          actualContent,
          gracefulUpdateExit: true,
        },
        null,
        2,
      ),
    );
    console.log(
      "Default window size, saved size and graceful update exit passed",
    );
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  spawn(
    process.execPath,
    [...args, "--window-size-test", "--quit-for-update"],
    { env, windowsHide: true, stdio: "ignore" },
  ).on("error", (error) => {
    console.error(error.message);
    app.exit(1);
  });
};
