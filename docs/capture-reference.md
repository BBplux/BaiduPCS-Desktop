# 官方窗口截图捕获

## 2026-11-04 诊断结果

- @oai/sky.get_window_state 对自建 Electron 客户端连续两次失败，包括 activate_window 置前后，报 window capture timed out。此前官方客户端同样报 FrameArrived/window capture timed out。证据不足以确定底层原因，但可排除“仅百度网盘窗口无法捕获”的判断。
- Electron 45.2.1 desktopCapturer.getSources({types:['window']}) 可工作。首次未枚举到官方窗口；经 sky.activate_window 恢复/显示官方窗口后，准确枚举并成功取得非空图像。
- 已查看图像并确认是官方首页实际画面，包含首页标签、顶部全部/最近/分享/转存/回收站导航以及文件列表。保存脚本后再运行一次也成功。
- 原 sky 捕获通道没有修复；当前解决办法是使用另一条已验证的捕获通道。没有更改官方客户端设置、硬件加速、系统安全设置，也没有复制账号凭据。

## 复用

先确保已安装官方客户端的主窗口已恢复并显示，然后在项目根目录运行：

```powershell
node scripts/capture-reference.mjs
```

输出 artifacts/official-reference.png。仅捕获标题精确为“百度网盘”的唯一窗口；缺失或多匹配时明确失败，不回退为整个桌面。脚本不激活窗口，不做点击，不读取凭据。失败时先通过已有窗口控制工具恢复窗口。

图像是 Electron 返回的窗口缩略图，按比例适配 1800×1200，可能经过缩放，不应直接把图中像素数当作 CSS 逻辑像素；布局测量需结合 DPI、窗口尺寸和已确认的样式。截图可能包含私人文件名，仅保存在被忽略的 artifacts 目录内。

## 2026-11-05 原生页面导航已验证

用户明确授权使用原生 UI Automation / SendInput，仅测试页面导航。

发现：官方主窗口和悬浮窗可能同时命名为“百度网盘”，同一进程的 MainWindowHandle 本次返回悬浮窗（250×102），不能据此定位主界面。应从窗口枚举选择实际主窗口，再核对边界。本次主界面 1503×1003。原 Sky 点击仍报 coordinate input geometry is unavailable；不能断言同名窗口就是该工具错误的底层原因。

Windows UI Automation 直接读取主窗口时未暴露“传输”子节点，故未使用 InvokePattern。经原生 ShowWindow/SetForegroundWindow 恢复确切主窗口，用 Electron 获取新截图，再按图片与窗口边界比例转换坐标，通过 SendInput 成功点击“传输”和“上传”。两次点击均经后续截图确认页面切换。首次截图可能处于过渡态，必须观察最终画面。

已保存 scripts/ReferenceInput.cs：点击前校验窗口边界与观察值一致、目标为前台、点击点未被其他顶层窗口覆盖；不符合则拒绝点击。此文件是开发参考工具，不打入客户端，不自动执行。使用前必须重新枚举窗口、取得当前截图和边界；禁止复用文档中的历史句柄或坐标。

截图脚本现支持 `node scripts/capture-reference.mjs --window=<当前窗口句柄十进制>`，同时校验标题，避免同名悬浮窗导致歧义。

验证画面：artifacts/official-transfer-completed.png（下载/已完成）；artifacts/official-upload-completed.png（上传/已完成）。仅切换页面，没有创建、删除、上传或下载文件。原 Sky 通道尚未修复，但原生输入 + Electron 指定窗口捕获已打通观察、操作、再观察的流程。
