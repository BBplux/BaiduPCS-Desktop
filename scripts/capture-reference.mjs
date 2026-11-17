import { spawn } from "node:child_process";
import electron from "electron";
import { fileURLToPath } from "node:url";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(
  electron,
  [
    fileURLToPath(new URL("./capture-reference.cjs", import.meta.url)),
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
