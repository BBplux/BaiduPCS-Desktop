import { spawnSync } from "node:child_process";
import fs from "node:fs";

const env = { ...process.env };
const hosted = process.argv.includes("--hosted");
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
// Each desktop check owns the same isolated profile. Always run sequentially.
const checks = [
  [
    "unit",
    [
      "--test",
      ...fs
        .readdirSync("tests")
        .filter((f) => f.endsWith(".test.cjs"))
        .map((f) => `tests/${f}`),
    ],
  ],
  ...[
    "--smoke-test",
    "--grid-test",
    "--columns-test",
    "--navigation-test",
    "--breadcrumb-test",
    "--file-delete-test",
    "--ui-style-test",
    "--settings-test",
    "--window-size-test",
    "--floating-test",
    "--acceptance-test",
  ]
    .filter(
      (flag) =>
        !hosted || !["--window-size-test", "--floating-test"].includes(flag),
    )
    .map((flag) => [
      flag,
      [
        "scripts/run-electron-check.mjs",
        ".",
        flag,
        ...(hosted && flag === "--ui-style-test"
          ? ["--ui-style-pages=files,transfers,settings"]
          : []),
        "--force-device-scale-factor=1.25",
      ],
    ]),
  ...(hosted ? [] : [1, 1.5, 2]).map((scale) => [
    `smoke-${scale}`,
    [
      "scripts/run-electron-check.mjs",
      ".",
      "--smoke-test",
      `--force-device-scale-factor=${scale}`,
    ],
  ]),
];
for (const [name, args] of checks) {
  console.log(`\nRelease check: ${name}`);
  const result = spawnSync(process.execPath, args, {
    env,
    stdio: "inherit",
    windowsHide: true,
    timeout: 180000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Release check failed: ${name} (${result.status})`);
}
console.log(`All ${checks.length} release checks passed`);
