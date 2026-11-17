import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const version = "v2.4.1";
const name = `BaiduPCS-Rust-${version}-windows-x86_64`;
await fs.mkdir(".cache", { recursive: true });
const zip = `.cache/backend-${version}.zip`;
try {
  await fs.access(zip);
} catch {
  const res = await fetch(
    `https://github.com/komorebiCarry/BaiduPCS-Rust/releases/download/${version}/${name}.zip`,
  );
  if (!res.ok) throw new Error(`Backend download: ${res.status}`);
  await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()));
}
const digest = createHash("sha256")
  .update(await fs.readFile(zip))
  .digest("hex");
const release = await fetch(
  `https://api.github.com/repos/komorebiCarry/BaiduPCS-Rust/releases/tags/${version}`,
).then((r) => r.json());
const expected = release.assets?.find((a) => a.name === `${name}.zip`)?.digest;
if (expected && expected !== `sha256:${digest}`)
  throw new Error("Backend archive checksum mismatch");
try {
  await fs.access(
    path.join(".cache", `backend-${version}`, name, "baidu-netdisk-rust.exe"),
  );
} catch {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory('${zip}', '.cache/backend-${version}')`,
    ],
    { windowsHide: true },
  );
}
await fs.mkdir("vendor/backend", { recursive: true });
await fs.copyFile(
  path.join(".cache", `backend-${version}`, name, "baidu-netdisk-rust.exe"),
  "vendor/backend/baidu-netdisk-rust.exe",
);
{
  const license = await fetch(
    `https://api.github.com/repos/komorebiCarry/BaiduPCS-Rust/contents/LICENSE?ref=${version}`,
  ).then((r) => r.json());
  if (!license.content) throw new Error("Could not fetch backend LICENSE");
  await fs.writeFile(
    "vendor/backend/LICENSE",
    Buffer.from(license.content, "base64"),
  );
}
await fs.writeFile(
  "vendor/backend/version.json",
  JSON.stringify(
    {
      version,
      source: release.html_url,
      archiveSha256: digest,
      verifiedAgainstReleaseDigest: !!expected,
    },
    null,
    2,
  ),
);
console.log(`Prepared ${version}; SHA256 ${digest}`);
