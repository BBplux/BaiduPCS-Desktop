import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as asar from "@electron/asar";

const output = path.resolve(process.argv[2] || "release");
const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
const unpacked = path.join(output, "win-unpacked");
const archive = path.join(unpacked, "resources/app.asar");
function same(actual, expected, name) {
  if (!actual.equals(expected))
    throw new Error(`Packaged content mismatch: ${name}`);
}
for (const file of [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/npm-THIRD-PARTY-NOTICES.txt",
  "docs/official-assets-manifest.json",
])
  same(asar.extractFile(archive, file), fs.readFileSync(file), file);
for (const [file, original] of [
  ["resources/backend/LICENSE", "vendor/backend/LICENSE"],
  ["resources/backend/version.json", "vendor/backend/version.json"],
  [
    "resources/backend/baidu-netdisk-rust.exe",
    "vendor/backend/baidu-netdisk-rust.exe",
  ],
  ["LICENSE.electron.txt", "node_modules/electron/dist/LICENSE"],
  [
    "LICENSES.chromium.html",
    "node_modules/electron/dist/LICENSES.chromium.html",
  ],
])
  same(
    fs.readFileSync(path.join(unpacked, file)),
    fs.readFileSync(original),
    file,
  );
const pkg = JSON.parse(asar.extractFile(archive, "package.json").toString());
if (pkg.version !== version)
  throw new Error("Packaged application version differs");
const sums = [];
for (const type of ["setup", "portable"]) {
  const name = `BaiduPCS-Desktop-${version}-win-x64-${type}.exe`;
  const bytes = fs.readFileSync(path.join(output, name));
  if (bytes.length < 1024 * 1024 || bytes.toString("ascii", 0, 2) !== "MZ")
    throw new Error(`Invalid Windows executable: ${name}`);
  sums.push(
    `${crypto.createHash("sha256").update(bytes).digest("hex")}  ${name}`,
  );
}
fs.writeFileSync(path.join(output, "SHA256SUMS.txt"), sums.join("\n") + "\n");
console.log(
  "Verified both Windows packages, backend and license files; wrote SHA256SUMS.txt",
);
