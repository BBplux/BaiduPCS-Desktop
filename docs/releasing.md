# 自动构建与发布

GitHub Actions 工作流位于 `.github/workflows/release.yml`，构建 Windows x64 安装版和便携版。发布使用仓库自带的 `GITHUB_TOKEN`，不需要额外配置个人令牌。

## 手动验证构建

在 GitHub 仓库的 Actions 页面选择 **Build and release Windows**，点击 **Run workflow** 并选择分支。手动运行会执行完整发布检查、打包和打包后的冒烟检查，通过后上传 `windows-x64-release` 构建产物，保留14天；手动运行不会创建或发布 Release。

## 标签发布

1. 更新 `package.json` 与 `package-lock.json` 的项目版本，保持一致。可使用 `npm version 0.1.1 --no-git-tag-version`，随后提交修改。
2. 将已核对的提交推送到远端，再为该提交创建版本标签。

   ```powershell
   git push origin main
   git tag -a v0.1.1 -m "Release v0.1.1"
   git push origin v0.1.1
   ```

3. 查看 Actions。仅当所有检查和上传完成后，工作流才将 Release 从草稿转为公开。`v0.1.1-beta.1` 这样的标签发布为预发行版；普通版本标记为最新正式版。

标签必须严格等于 `v` 加项目版本。版本不匹配、测试失败或打包失败都会阻止发布。发布任务只有 `contents: write` 权限，构建任务只有读取权限。已公开的版本不会被重复运行覆盖，应提交修复并使用新版本标签；上传中断留下的草稿可以通过重新运行恢复。

## 发布产物

| 文件                                           | 用途                          |
| ---------------------------------------------- | ----------------------------- |
| `BaiduPCS-Desktop-<版本>-win-x64-setup.exe`    | 安装版，可选择安装目录        |
| `BaiduPCS-Desktop-<版本>-win-x64-portable.exe` | 便携单文件版                  |
| `SHA256SUMS.txt`                               | 上述两个文件的 SHA-256 校验值 |

当前未配置代码签名证书，Windows 可能显示未知发布者提示。下载入口应使用本仓库 Release。可通过 `Get-FileHash -Algorithm SHA256 <文件>` 与校验文件比较。

## 构建与检查

```powershell
npm ci
npm run backend:prepare
npm run build
npm run test:release
npm run package:win
npm run release:verify
```

内核版本及压缩包 SHA-256 固定在 `vendor/backend/version.json`，许可文件保存在同目录。准备脚本验证下载内容，不使用运行时查询的“最新版本”，也不覆盖已审核的版本及许可记录。升级内核时需一起更新并审核这些文件。

发布检查串行执行单元测试、文件导航、列表/网格、列宽、删除确认、设置、窗口、悬浮窗、传输验收和多种缩放下的桌面检查。桌面检查共用隔离测试目录，不访问真实账号；不要并行运行。构建产物还会核对内核、许可证、版本及文件校验值，并运行打包版本的冒烟检查。

失败时 Actions 仅保存隔离测试生成的截图和结果文件，不上传账号目录、Cookie 或原始内核日志。日常修改仍只需运行受影响部分的检查，正式发布才使用完整流程。

原生设置窗口拖动、真实账号登录和传输、整机睡眠及物理显示器热插拔仍属于人工验收范围，不通过自动化结果宣称已验证。

第三方资源和内核许可范围见 [第三方声明](../THIRD_PARTY_NOTICES.md)；自动构建流程不会改变这些许可条件。
