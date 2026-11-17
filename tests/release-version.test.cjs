const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "../scripts/validate-release.mjs");
function check({
  version = "1.2.3",
  tag = "v1.2.3",
  type = "tag",
  lockVersion = version,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcs-release-version-"));
  try {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ version }),
    );
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        version: lockVersion,
        packages: { "": { version: lockVersion } },
      }),
    );
    return spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF_TYPE: type,
        GITHUB_REF_NAME: tag,
        GITHUB_OUTPUT: "",
      },
    });
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw Error("Unexpected fixture path");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test("release accepts matching stable and prerelease tags", () => {
  assert.equal(check().status, 0);
  assert.equal(
    check({ version: "1.2.3-beta.1", tag: "v1.2.3-beta.1" }).status,
    0,
  );
});
test("release rejects a tag pointing to another package version", () => {
  const result = check({ tag: "v1.2.4" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release tag must equal/);
});
test("release rejects inconsistent lockfile and invalid artifact versions", () => {
  assert.notEqual(check({ lockVersion: "1.2.2" }).status, 0);
  assert.notEqual(check({ version: "../1.2.3" }).status, 0);
});
test("manual branch builds do not require a release tag", () => {
  assert.equal(check({ type: "branch", tag: "main" }).status, 0);
});
