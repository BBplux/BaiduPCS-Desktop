import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import electron from "electron";
const root = await fs.mkdtemp(path.resolve(".runtime/desktop-restart-"));
const fixture = JSON.parse(
  await fs.readFile("artifacts/live-verification.json", "utf8"),
);
if (!fixture.passed || !fixture.remoteDirectory.startsWith("/客户端验证-"))
  throw Error("Isolated cloud fixture required");
await fs.mkdir(path.join(root, "backend/config"), { recursive: true });
await fs.mkdir(path.join(root, "downloads"), { recursive: true });
await fs.copyFile(
  path.join(process.env.APPDATA, "网盘桌面/backend/config/accounts.json"),
  path.join(root, "backend/config/accounts.json"),
);
await fs.writeFile(
  path.join(root, "settings.json"),
  JSON.stringify({
    downloadDir: path.join(root, "downloads"),
    floatEnabled: false,
  }),
);
await fs.writeFile(
  path.join(root, "verification.json"),
  JSON.stringify({
    phase: 1,
    remoteDirectory: fixture.remoteDirectory,
    checks: [],
    passed: false,
  }),
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
try {
  for (let phase = 1; phase <= 4; phase++) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        electron,
        [".", "--verify-restart", "--verification-root=" + root],
        { env, stdio: "inherit", windowsHide: true },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(Error("App verification process failed")),
      );
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  const state = JSON.parse(
    await fs.readFile(path.join(root, "verification.json"), "utf8"),
  );
  const report = {
    passed: state.passed,
    checks: state.checks,
    uploadBytes: state.uploadBytes,
    downloadBytes: state.downloadBytes,
    error: state.error,
  };
  await fs.writeFile(
    "artifacts/desktop-restart-verification.json",
    JSON.stringify(report, null, 2),
  );
  for (const name of [
    "accounts.json",
    "accounts.json.bak",
    "session.json",
    "session.json.bak",
    "session.json.migrated",
  ])
    await fs.rm(path.join(root, "backend/config", name), { force: true });
  for (const name of await fs
    .readdir(path.join(root, "backend/logs"))
    .catch(() => []))
    await fs.rm(path.join(root, "backend/logs", name), { force: true });
  console.log(JSON.stringify(report));
}
