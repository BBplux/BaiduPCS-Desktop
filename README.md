# BaiduPCS-Desktop

<div align="center">

**网盘桌面 · 简洁、无广告的百度网盘第三方桌面客户端**

基于 Electron + Vue 3，使用 BaiduPCS-Rust 提供网盘与传输能力，界面参考最新版百度网盘。

[功能特性](#功能特性) · [快速开始](#快速开始) · [开发与构建](#开发与构建) · [常见问题](#常见问题) · [开源许可](#开源许可)

</div>

## 简介

BaiduPCS-Desktop 专注于文件管理和上传下载，提供 Windows 桌面窗口、系统托盘和悬浮窗，去除广告与商业推广入口。

项目为独立第三方客户端，与百度不存在官方隶属或授权关系。当前处于开发阶段，支持 **Windows 10/11 x64**；界面与功能仍在持续完善，尚未提供多账号切换、分享管理、在线播放及同步备份。

## 功能特性

### 账号与文件管理

- **多种登录入口**：百度官方网页登录、扫码登录和手动 Cookie 登录。账号密码在百度官方网页内输入。
- **文件浏览**：列表与网格视图、文件搜索、目录导航、前进后退、排序与列宽调整。
- **文件操作**：新建目录、重命名、移动和确认后移入回收站。

### 上传与下载

- **批量传输**：支持文件、文件夹上传下载，以及拖放上传。
- **任务管理**：暂停、继续、重试、删除任务，分别查看上传和下载的进行中及已完成记录。
- **进度与恢复**：显示传输速度和进度，保存任务状态，支持重启后恢复任务列表。
- **路径与冲突处理**：设置下载目录和同名文件处理方式，从下载任务打开对应保存位置。

### 桌面体验

- **无广告**：保留文件、传输、容量和设置等常用功能。
- **系统托盘**：关闭窗口后可继续驻留，主动退出时保存任务并停止后台。
- **悬浮窗**：显示上传下载速度，整窗拖动、双击打开主窗口、右键菜单及拖入文件上传，可随时关闭。
- **独立设置窗口**：即时保存设置，记忆窗口大小、位置及悬浮窗位置。

功能列表描述当前已接入能力。扫码成功回调、更多账号风控场景以及实际整机睡眠、多显示器热插拔仍需补充验证，详见 [验证记录](docs/validation.md)。

## 快速开始

### 从源码运行

准备 Windows 10/11 x64 和 Node.js 22.12 或更新版本，在项目根目录执行：

```powershell
npm ci
npm run backend:prepare
npm run build
npm start
```

`backend:prepare` 下载固定版本的 BaiduPCS-Rust 内核及其许可文件；首次安装需要访问 npm 和 GitHub。依赖的准确版本以 `package-lock.json` 为准，内核信息见 [version.json](vendor/backend/version.json)。

### 使用目录式构建

已获得构建目录时，运行其中的 `BaiduPCS-Desktop.exe`，并保留同目录下的全部文件。不要单独移动可执行文件。

启动后点击登录入口，选择官方网页登录、扫码或 Cookie 登录；登录后即可浏览文件并创建传输任务。

## 开发与构建

```powershell
# 开发模式
npm run dev

# 目录式构建
npm run package:dir

# 安装版与便携版构建
npm run package
```

目录式构建入口为 `release/win-unpacked/BaiduPCS-Desktop.exe`。`npm run package` 生成 Windows x64 安装版（`*-setup.exe`）和便携版（`*-portable.exe`），均位于 `release/`。执行构建时会同步生成第三方依赖许可清单。

GitHub Actions 支持手动构建和版本标签自动发布。推送与项目版本一致的标签（如 `v0.1.0`）后，流程完成测试、打包和校验，再发布 GitHub Release；手动运行仅生成 Actions 构建产物。发布步骤和产物说明见 [自动构建与发布](docs/releasing.md)。

日常修改只运行相关检查，例如：

```powershell
npm run test:navigation
npm run test:file-delete
```

准备正式发布时，再执行单元测试、桌面检查及相关验收：

```powershell
npm test
npm run build
npm run test:desktop
node scripts/run-electron-check.mjs . --acceptance-test --force-device-scale-factor=1.25
```

自动化桌面检查使用隔离测试数据。真实账号验证需要另行授权；提交问题时请勿附带 Cookie、密码或账号配置。

## 技术栈

| 层级           | 技术                                                            |
| -------------- | --------------------------------------------------------------- |
| 桌面运行时     | Electron                                                        |
| 用户界面       | Vue 3、TypeScript、Ant Design Vue                               |
| 路由与状态     | Vue Router、Pinia                                               |
| 网盘与传输内核 | [BaiduPCS-Rust](https://github.com/komorebiCarry/BaiduPCS-Rust) |
| 本地通信       | 回环 HTTP 接口、WebSocket 状态推送                              |
| 构建工具       | Vite、electron-builder                                          |

## 项目结构

```text
src/                    Vue 界面、状态管理与静态资源
electron/               主进程、预加载、内核通信与桌面检查
tests/                  单元测试
scripts/                开发、构建和验证工具
docs/                   需求、设计与验证记录
licenses/               第三方许可文本与依赖清单
vendor/backend/         内核版本、许可及本地下载的可执行文件
LICENSE                 本项目原创代码的 Apache-2.0 许可证
NOTICE                  项目版权和许可范围说明
THIRD_PARTY_NOTICES.md   第三方组件与资源说明
```

## 常见问题

**是否能够绕过网盘限速？**

传输能力由上游内核和网盘服务提供，实际速度受账号权益、网络及服务策略影响。本项目不承诺突破服务端限制。

**关闭主窗口后，任务还会继续吗？**

默认关闭窗口后驻留托盘并继续任务，可在设置中调整。主动退出会保存任务并停止内核；下次是否自动继续由设置决定。

**是否支持 macOS 或 Linux？**

当前只针对 Windows x64 开发与验证；上游内核支持的平台不等于本桌面客户端已支持的平台。

## 贡献

欢迎提交问题、功能建议和 Pull Request。反馈时请说明系统环境、复现步骤、预期结果和实际表现；截图与日志请先移除个人信息。

提交代码前，请阅读 [项目约定](AGENTS.md)，运行受影响部分的检查，并保持第三方许可与资源清单完整。新增依赖或更新锁定文件后，可执行 `npm run licenses:generate` 更新依赖许可清单。

## 开源许可

本项目**原创代码**采用 [Apache License 2.0](LICENSE)，版权与适用范围见 [NOTICE](NOTICE)。

## 免责声明

本项目仅供学习和研究使用，请勿用于商业用途。使用本工具产生的任何问题与本项目无关。

## 致谢

- [BaiduPCS-Rust](https://github.com/komorebiCarry/BaiduPCS-Rust)：本项目的重要参考
- [BaiduPCS-Go](https://github.com/qjfoidnh/BaiduPCS-Go)：本项目的重要参考
- Electron、Vue、Pinia、Ant Design Vue 等开源项目及其贡献者。
