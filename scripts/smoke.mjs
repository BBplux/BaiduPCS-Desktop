import { spawn } from "node:child_process";
import electron from "electron";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const child = spawn(electron, [".", "--smoke-test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  windowsHide: true,
});
const timer = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
}, 90000);
child.on("exit", (code) => {
  clearTimeout(timer);
  process.exit(code ?? 1);
});
