const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isOfficialLoginUrl,
  cookieHeader,
  validateName,
  joinRemote,
} = require("../electron/policy.cjs");
test("official login navigation excludes lookalike hosts and non-HTTPS schemes", () => {
  for (const url of [
    "https://pan.baidu.com/",
    "https://passport.baidu.com/v2/",
  ])
    assert.equal(isOfficialLoginUrl(url), true);
  for (const url of [
    "https://baidu.com.evil.test/",
    "http://pan.baidu.com/",
    "file:///C:/x",
    "javascript:alert(1)",
    "https://baidu.com@evil.test/",
  ])
    assert.equal(isOfficialLoginUrl(url), false);
});
test("only pan and shared Baidu cookies are collected, without header injection", () => {
  assert.equal(
    cookieHeader([
      { domain: ".baidu.com", name: "BDUSS", value: "test" },
      { domain: "pan.baidu.com", name: "STOKEN", value: "ok" },
      { domain: ".evil.test", name: "evil", value: "x" },
      { domain: "pan.baidu.com", name: "bad", value: "x\r\ny" },
    ]),
    "BDUSS=test; STOKEN=ok",
  );
});
test("remote file operations reject traversal and invalid Windows file names", () => {
  for (const name of ["..", "a/b", "x\\y", "CON.txt", "a.", " a", "x\n"])
    assert.throws(() => validateName(name));
  assert.equal(joinRemote("/照片", "假期.jpg"), "/照片/假期.jpg");
  assert.throws(() => joinRemote("/a/../b", "file"));
});
