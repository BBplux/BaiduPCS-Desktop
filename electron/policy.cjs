const { URL } = require("node:url");
function isOfficialLoginUrl(value) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      (u.hostname === "baidu.com" || u.hostname.endsWith(".baidu.com")) &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
function cookieHeader(cookies) {
  const map = new Map();
  for (const c of cookies) {
    const domain = c.domain.replace(/^\./, "");
    if (
      (domain === "baidu.com" || domain === "pan.baidu.com") &&
      !/[;\r\n]/.test(c.name + c.value)
    )
      map.set(c.name, c.value);
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join("; ");
}
function validateName(name) {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 255 ||
    name !== name.trim() ||
    /[\\/:*?"<>|\x00-\x1f\x7f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
  )
    throw new Error("文件名无效");
  return name;
}
function remotePath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.includes("\0") ||
    value.split("/").includes("..")
  )
    throw new Error("网盘路径无效");
  return value === "/" ? "/" : value.replace(/\/+$/, "");
}
function joinRemote(parent, name) {
  return `${remotePath(parent).replace(/\/$/, "")}/${validateName(name)}`;
}
const finished = (task) =>
  ["completed", "rapid_upload_success", "skipped", "cancelled"].includes(
    task.status,
  );
module.exports = {
  isOfficialLoginUrl,
  cookieHeader,
  validateName,
  remotePath,
  joinRemote,
  finished,
};
