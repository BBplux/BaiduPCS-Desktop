// Login may identify the user before Baidu has issued a usable drive session.
function completeCookie(header) {
  return (
    typeof header === "string" &&
    header.length <= 64000 &&
    !/[\r\n]/.test(header) &&
    ["BDUSS", "STOKEN"].every((name) =>
      header.split(";").some((part) => {
        const i = part.indexOf("=");
        return (
          i > 0 &&
          part.slice(0, i).trim() === name &&
          !!part.slice(i + 1).trim()
        );
      }),
    )
  );
}
async function verifyDrive(backend) {
  const page = await backend.request(
    "/files?dir=%2F&page=1&page_size=1&order=name&desc=false",
  );
  if (!Array.isArray(page?.list))
    throw Error("未能验证网盘文件列表，请重试登录");
}
async function importDriveCookie(backend, cookies) {
  if (!completeCookie(cookies))
    throw Error("请提供包含 BDUSS 和 STOKEN 的完整网盘 Cookie");
  const user = await backend.request("/auth/cookie/login", "POST", { cookies });
  await verifyDrive(backend);
  return user;
}
module.exports = { completeCookie, verifyDrive, importDriveCookie };
