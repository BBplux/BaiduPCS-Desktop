# 第三方声明

BaiduPCS-Desktop 的原创代码和文档采用 [Apache-2.0](LICENSE)。第三方组件、图片、图标、标识和字体保留各自的版权及许可条件，不因被本项目使用而重新授权。

## BaiduPCS-Rust 内核

- 上游：[komorebiCarry/BaiduPCS-Rust](https://github.com/komorebiCarry/BaiduPCS-Rust)。
- 当前内核版本和校验信息见 [vendor/backend/version.json](vendor/backend/version.json)。
- 原始许可完整保留在 [vendor/backend/LICENSE](vendor/backend/LICENSE)，打包后随内核放在 `resources/backend/LICENSE`。
- 该许可包含 Apache-2.0 正文及多账号功能相关附加条款。上游 README 另有“仅供学习和研究使用，请勿用于商业用途”的声明。本项目不删除这些声明，也不将内核描述为仅受标准 Apache-2.0 约束；涉及分发或商业用途时，应先向上游确认其许可范围。

桌面端通过独立进程调用内核，没有将上游项目的所有功能直接开放为本客户端功能。

## JavaScript 依赖与 Electron

构建前运行 `npm run licenses:generate`，依据锁定文件和本机安装的非开发依赖生成 [licenses/npm-THIRD-PARTY-NOTICES.txt](licenses/npm-THIRD-PARTY-NOTICES.txt)，保留包名、版本、来源、许可声明及可取得的原始许可文本。清单是保守的依赖范围，部分包可能在构建时被裁剪。

主要组件包括 Vue、Vue Router、Pinia、Ant Design Vue 和 Ant Design Icons。部分 npm 包没有随包附带许可文件，补充来源如下：

- Ant Design Icons：保留 [原许可](licenses/ant-design-icons-LICENSE)。
- array-tree-filter：保留 [上游许可](licenses/array-tree-filter-LICENSE)，来源为 [上游 LICENSE](https://github.com/afc163/array-tree-filter/blob/master/LICENSE)。
- dom-scroll-into-view：上游包和 README 声明为 MIT，但没有独立许可文件；[声明记录](licenses/dom-scroll-into-view-NOTICE) 保留原有信息，没有自行补写版权人。
- Rolldown 平台绑定：使用同项目随包提供的 LICENSE，收入依赖清单。

Electron 自身许可收入依赖清单；打包产物中的 `LICENSE.electron.txt` 和 `LICENSES.chromium.html` 随桌面运行时保留，后者包含 Chromium 及其他组件声明。重新分发时应保留这些文件。

## 百度网盘静态资源

界面参考最新版百度网盘。项目使用的部分文件类型图标、操作图标、空态图片、标识、程序及托盘图标、图标字体属于百度或相应权利人，主要位于 `src/assets/official/` 和 `electron/assets/`。

资源清单、权属归属及 SHA-256 校验值见 [official-assets-manifest.json](docs/official-assets-manifest.json)，对应使用位置见 [assets.md](docs/assets.md)。本项目的 Apache-2.0 许可不覆盖这些资源，也不授予第三方商标或专有资源的使用、修改及再分发权；再分发应另行取得适用授权或替换为可合法分发的资源。

本项目是独立第三方客户端，并非百度官方产品。

## 随包许可文件

应用构建包含项目 `LICENSE`、`NOTICE`、本文及 `licenses/`，内核许可随内核发布，Electron 组件声明随桌面运行时发布。更新依赖时应重新生成许可清单，保留原始版权和声明，不将第三方许可改写为本项目许可。
