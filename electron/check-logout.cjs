const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const uid = 12345;
const fixture = {
  uid,
  username: "logout-fixture",
  bduss: "synthetic",
  login_time: 0,
};
exports.prepare = async (directory) => {
  const config = path.join(directory, "config");
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(
    path.join(config, "accounts.json"),
    JSON.stringify({
      active_uid: uid,
      users: [
        fixture,
        { ...fixture, uid: uid + 1, username: "second-fixture" },
      ],
    }),
  );
};
exports.run = async ({ mainWindow, backend, session }) => {
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  const wait = async (check, label) => {
    for (let i = 0; i < 120; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(label);
  };
  const config = path.join(backend.directory, "config");
  for (const name of [
    "accounts.json.bak",
    "session.json",
    "session.json.bak",
    "session.json.migrated",
  ])
    await fs.writeFile(path.join(config, name), "synthetic stale session");
  const login = session.fromPartition("official-login");
  await login.cookies.set({
    url: "https://example.invalid",
    name: "fixture",
    value: "synthetic",
  });
  await wait(
    () => js("!!document.querySelector('button.avatar[title=logout-fixture]')"),
    "Missing fixture avatar",
  );
  await js("document.querySelector('button.avatar').click()");
  await wait(
    () =>
      js(
        "[...document.querySelectorAll('.ant-dropdown-menu-item')].some(e=>e.textContent.includes('退出账号') && (e.click(),true))",
      ),
    "Missing logout action",
  );
  await wait(
    () =>
      js(
        "!!document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')",
      ),
    "Missing confirmation",
  );
  await js(
    "document.querySelector('.ant-modal-confirm-btns .ant-btn-primary').click()",
  );
  await wait(
    () =>
      js(
        "!!document.querySelector('button.avatar[title=登录账号]') && !document.querySelector('.ant-modal-confirm')",
      ),
    "Logout did not close dialog and return to signed-out state",
  );
  assert.equal((await backend.request("/accounts/list")).active_uid, null);
  assert.deepEqual(await login.cookies.get({ name: "fixture" }), []);
  const accounts = JSON.parse(
    await fs.readFile(path.join(config, "accounts.json"), "utf8"),
  );
  assert.deepEqual(
    accounts.users.map((u) => u.uid),
    [uid + 1],
  );
  assert.deepEqual(
    (await backend.request("/accounts/list")).accounts.map((u) => u.uid),
    [uid + 1],
  );
  for (const file of [
    "accounts.json.bak",
    "session.json",
    "session.json.bak",
    "session.json.migrated",
  ])
    await assert.rejects(fs.access(path.join(config, file)), {
      code: "ENOENT",
    });
  console.log("Logout UI, persisted account and web session verified");
};
