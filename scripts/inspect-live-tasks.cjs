const { app, safeStorage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Backend } = require("../electron/backend.cjs");
app.setPath("userData", path.join(app.getPath("appData"), "网盘桌面"));
app.whenReady().then(async () => {
  try {
    const directory = path.join(app.getPath("userData"), "backend");
    const config = await fs.readFile(
      path.join(directory, "config/app.toml"),
      "utf8",
    );
    const port = config.match(/^port\s*=\s*(\d+)/m)[1];
    const backend = new Backend({ directory, safeStorage });
    backend.url = `http://127.0.0.1:${port}/api/v1`;
    backend.password = (
      await safeStorage.decryptStringAsync(
        await fs.readFile(path.join(directory, "service-key.bin")),
      )
    ).result;
    await backend.authenticate();
    backend.state = "ready";
    const raw = await backend.request("/downloads/all");
    console.log(
      JSON.stringify(raw, (k, v) =>
        /path|name|url|cookie|token/i.test(k)
          ? typeof v === "string"
            ? { length: v.length, absolute: path.isAbsolute(v) }
            : v
          : v,
      ),
    );
    console.log("Read-only task inspection complete.");
    app.exit(0);
  } catch (error) {
    console.error(error.message);
    app.exit(1);
  }
});
