const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { transferError } = require("./transfer-errors.cjs");

async function checkDownloadDirectory(directory, requiredBytes = 0) {
  if (typeof directory !== "string" || !path.isAbsolute(directory))
    throw Error("下载位置无效，请在设置中重新选择。");
  let probe;
  try {
    if (!(await fs.stat(directory)).isDirectory())
      throw Error("下载位置不是文件夹，请重新选择。");
    const available = await fs.statfs(directory, { bigint: true });
    // Known file sizes only. Folder contents and concurrent external writers can
    // change this estimate; the kernel remains responsible for write failures.
    if (
      requiredBytes > 0 &&
      available.bavail * available.bsize < BigInt(Math.ceil(requiredBytes))
    )
      throw Object.assign(Error("ENOSPC"), { code: "ENOSPC" });
    const candidate = path.join(directory, ".desktop-write-" + randomUUID());
    const handle = await fs.open(candidate, "wx");
    probe = candidate; // Only remove a file successfully created by this probe.
    await handle.close();
  } catch (error) {
    if (error.code === "ENOENT")
      throw Error(
        "下载目录不存在，可能已移动或删除。请在设置中重新选择下载位置。",
      );
    throw Error(transferError(error));
  } finally {
    if (probe) await fs.unlink(probe);
  }
}
async function checkUploadSource(local) {
  try {
    return await fs.stat(local);
  } catch (error) {
    throw Error(transferError(error));
  }
}
module.exports = { checkDownloadDirectory, checkUploadSource };
