const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  completeCookie,
  importDriveCookie,
} = require("../electron/drive-login.cjs");
const { cookieHeader } = require("../electron/policy.cjs");
test("partial login credentials never reach the backend", async () => {
  for (const header of [
    "BDUSS=fixture",
    "BDUSS=fixture; STOKEN=  ",
    "XBDUSS=x; STOKEN=y",
    "BDUSS=; STOKEN=y",
    "BDUSS=x\r\n; STOKEN=y",
  ]) {
    assert.equal(completeCookie(header), false);
    await assert.rejects(
      importDriveCookie(
        { request: () => assert.fail("partial credentials submitted") },
        header,
      ),
      /完整/,
    );
  }
});
test("the cookie used by the drive API wins regardless of enumeration order", () => {
  const jar = [
    { domain: ".baidu.com", path: "/", name: "STOKEN", value: "shared" },
    { domain: ".pan.baidu.com", path: "/", name: "STOKEN", value: "drive" },
    { domain: "pan.baidu.com", path: "/api", name: "STOKEN", value: "api" },
  ];
  assert.equal(cookieHeader(jar), "STOKEN=api");
  assert.equal(cookieHeader(jar.reverse()), "STOKEN=api");
});
test("an identified account cannot complete login until a directory read succeeds", async () => {
  let pass = false,
    checks = 0;
  const user = { uid: 123 };
  const backend = {
    request: async (route, method) => {
      if (method === "POST") return user;
      assert.ok(route.startsWith("/files?"));
      checks++;
      if (!pass) throw Error("errno=-6");
      return { list: [] };
    },
  };
  const header = "BDUSS=synthetic; STOKEN=synthetic";
  await assert.rejects(importDriveCookie(backend, header), /errno=-6/);
  pass = true;
  assert.equal(await importDriveCookie(backend, header), user);
  assert.equal(checks, 2);
});
