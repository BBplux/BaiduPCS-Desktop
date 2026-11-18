const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// The kernel must be stopped: it can persist refreshed credentials at any time.
async function forgetCurrentAccount(config, uid) {
  const file = path.join(config, "accounts.json");
  let accounts;
  const raw = await fs.readFile(file, "utf8");
  try {
    accounts = JSON.parse(raw, (_key, value, context) =>
      typeof value === "number" && !Number.isSafeInteger(value)
        ? JSON.rawJSON(context.source)
        : value,
    );
  } catch {
    throw Error("本机账号配置无法读取，已保留原文件");
  }
  if (
    !Number.isSafeInteger(uid) ||
    accounts?.active_uid !== uid ||
    !Array.isArray(accounts.users) ||
    !accounts.users.some((u) => u.uid === uid)
  )
    throw Error("当前账号已变更，请刷新后重试");
  accounts.active_uid = null;
  accounts.users = accounts.users.filter((u) => u.uid !== uid);
  // Remove recovery copies first. On failure the primary file is still intact.
  for (const name of [
    "accounts.json.bak",
    "session.json",
    "session.json.bak",
    "session.json.migrated",
  ])
    await fs.rm(path.join(config, name), { force: true });
  const tmp = file + ".logout-" + randomUUID();
  try {
    await fs.writeFile(tmp, JSON.stringify(accounts), {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
module.exports = { forgetCurrentAccount };
