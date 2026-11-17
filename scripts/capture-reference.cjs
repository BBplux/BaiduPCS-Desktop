const { app, desktopCapturer } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
app.setPath("userData", path.resolve(".runtime/capture-reference"));
const timer = setTimeout(() => {
  console.error("窗口捕获超过 20 秒");
  app.exit(2);
}, 20000);
app.whenReady().then(async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 1800, height: 1200 },
      fetchWindowIcons: false,
    });
    const handle = process.argv
      .find((arg) => arg.startsWith("--window="))
      ?.slice(9);
    if (handle && !/^\d+$/.test(handle)) throw Error("Invalid window handle");
    const matches = sources.filter((source) =>
      handle ? source.id.split(":")[1] === handle : source.name === "百度网盘",
    );
    if (matches.length !== 1)
      throw Error(
        "没有唯一可捕获的百度网盘窗口；请先打开或恢复官方主窗口，不能最小化到托盘。",
      );
    const source = matches[0];
    if (source.thumbnail.isEmpty()) throw Error("窗口返回空图像");
    const output = path.resolve("artifacts/official-reference.png");
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, source.thumbnail.toPNG());
    console.log(
      JSON.stringify({
        output,
        size: source.thumbnail.getSize(),
        source: source.name,
      }),
    );
    clearTimeout(timer);
    app.exit(0);
  } catch (error) {
    console.error(error.message);
    clearTimeout(timer);
    app.exit(1);
  }
});
