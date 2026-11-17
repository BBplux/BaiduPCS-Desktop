import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const metadata = JSON.parse(
  await fs.readFile("vendor/backend/version.json", "utf8"),
);
const { version, archiveSha256 } = metadata;
if (!/^v\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{64}$/.test(archiveSha256))
  throw new Error("Invalid pinned backend version or SHA-256");
const name = `BaiduPCS-Rust-${version}-windows-x86_64`;
const cache = path.resolve(".cache");
await fs.mkdir(cache, { recursive: true });
const zip = path.join(cache, `backend-${version}.zip`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let bytes;
try {
  bytes = await fs.readFile(zip);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!bytes || hash(bytes) !== archiveSha256) {
  const url = `https://github.com/komorebiCarry/BaiduPCS-Rust/releases/download/${version}/${name}.zip`;
  console.log(`Downloading backend ${version}`);
  // Windows includes curl; its native network support also works with local proxies.
  execFileSync(
    "curl.exe",
    [
      "--fail",
      "--location",
      "--retry",
      "2",
      "--connect-timeout",
      "20",
      "--max-time",
      "180",
      "--silent",
      "--show-error",
      "--output",
      `${zip}.tmp`,
      url,
    ],
    { windowsHide: true, stdio: "inherit" },
  );
  bytes = await fs.readFile(`${zip}.tmp`);
  if (hash(bytes) !== archiveSha256)
    throw new Error("Backend archive SHA-256 mismatch");
  await fs.rename(`${zip}.tmp`, zip);
}
// License and version metadata are reviewed, pinned files in the repository.
const license = await fs.readFile("vendor/backend/LICENSE", "utf8");
if (!license.includes("Apache License"))
  throw new Error("Pinned backend license is missing");
const extracted = await fs.mkdtemp(path.join(cache, "backend-extract-"));
try {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:PCS_BUILD_ARCHIVE, $env:PCS_BUILD_EXTRACT)",
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        PCS_BUILD_ARCHIVE: zip,
        PCS_BUILD_EXTRACT: extracted,
      },
    },
  );
  const executable = await fs.readFile(
    path.join(extracted, name, "baidu-netdisk-rust.exe"),
  );
  if (executable.toString("ascii", 0, 2) !== "MZ")
    throw new Error("Invalid backend executable");
  await fs.writeFile("vendor/backend/baidu-netdisk-rust.exe", executable);
} finally {
  const resolved = await fs.realpath(extracted);
  if (!resolved.startsWith(cache + path.sep))
    throw new Error("Unexpected extraction directory");
  await fs.rm(resolved, { recursive: true, force: true });
}
console.log(`Prepared ${version}; verified pinned SHA-256 ${archiveSha256}`);
