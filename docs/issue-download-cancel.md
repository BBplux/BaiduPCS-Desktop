# [Bug] v2.4.0：删除进行中的下载后，.downloading 被重新创建为零字节文件

已提交：https://github.com/komorebiCarry/BaiduPCS-Rust/issues/192

## 环境

- Windows 10 x64（10.0.19045）
- 官方发布的 BaiduPCS-Rust v2.4.0 Windows x86_64 预编译后端
- 二进制 SHA-256：`410764ad7e483ae488e3b4bfb2ad51e42f22c52f59e6ac9c86154a04156405cc`
- 对照源码标签：`v2.4.0`（`19900ad7bad33b0056f524cb2ecd723549af3ef0`）

## 问题

删除已有进度的单文件下载时，接口成功返回，任务从列表消失，`.downloading` 文件也曾被成功删除；但随后该文件又被创建为 **0 字节**，持续观察 60 秒仍存在。

最初在自建桌面客户端中发现。为排除客户端影响，另行启动了使用同一官方二进制的独立后端实例，使用独立配置/下载目录，**直接调用后端 HTTP API，不经过桌面客户端的删除封装或延迟清理**，仍然复现。此次没有通过上游 Web UI 操作。

## 复现步骤

1. 登录账号，在独立目录下载一个较大的单文件（本次为多分片视频文件，不提供私人文件名或分享链接）。
2. 使用 `POST /api/v1/downloads/batch` 创建任务，`target_dir` 指向独立测试目录，`conflict_strategy` 为 `auto_rename`。
3. 通过 `GET /api/v1/downloads/all` 等待任务处于 `downloading` 且下载量超过 16 MiB。
4. 调用 `DELETE /api/v1/downloads/<task_id>?delete_file=false`。
5. 持续检查 `<local_path>.downloading` 和任务列表，而不只在 DELETE 返回后检查一次。

本次复现时已下载 `18,659,312` 字节。并非每次都出现：另一次较小测试文件下载约 543 KiB 后取消，分片及时退出，观察 60 秒无残留。

## 预期与实际

预期：取消未完成下载并清理临时文件后，已取消任务不会再创建或写入文件；`delete_file=false` 仍保留已完成的最终文件。

实际：任务删除成功，临时文件短暂消失后被重建为 0 字节。没有收到删除失败响应。

## 脱敏时间线

以下以取消日志出现时间为 T0；文件状态每秒采样，因此出现时间是首次观测时间，不是精确系统调用时间。

| 相对时间 | 事件 |
| --- | --- |
| T0 | 调度器记录“已从调度器移除并取消”；多个分片记录“流式读取被取消” |
| T0 + 1 ms | 仍有部分分片记录取消 |
| T0 + 106 ms | 后端记录“已清理 .downloading 临时文件” |
| 约 T0 + 108 ms | DELETE 返回后的首次检查：临时文件不存在 |
| T0 + 805 ms | 另一个分片才记录“流式读取被取消” |
| 约 T0 + 1109 ms | 文件检查：临时文件再次存在，大小 0 字节 |
| 60 秒检查结束 | 任务不存在，零字节临时文件仍存在 |

## 可疑源码路径（与上述证据分开）

- [`manager.rs::delete_task`](https://github.com/komorebiCarry/BaiduPCS-Rust/blob/v2.4.0/backend/src/downloader/manager.rs)：取消调度器/令牌后固定等待 100ms，再移除任务并清理文件。
- [`scheduler.rs::cancel_task`](https://github.com/komorebiCarry/BaiduPCS-Rust/blob/v2.4.0/backend/src/downloader/scheduler.rs)：移除活动任务并触发取消令牌，没有在此等待全部分片退出。
- [`chunk.rs::download`](https://github.com/komorebiCarry/BaiduPCS-Rust/blob/v2.4.0/backend/src/downloader/chunk.rs)：先等待 HTTP `.send().await`，校验响应，随后 `create_dir_all` 和 `File::options().create(true).write(true).open(output_path)`；之后在流式读取循环才通过 `tokio::select!` 处理取消。

这条顺序可能让尚在等待响应的分片，在清理发生后重新创建文件，然后因取消立即退出，留下零字节文件。日志与此路径吻合，但未做系统调用/调用栈跟踪，不能仅凭“等待 100ms”认定所有删除都会失败。

建议排查取消是否覆盖请求等待，并在清理前确认任务及所有分片已经退出、释放文件。单纯增加固定等待时间可能仍留下竞态；只在创建前增加一次取消检查也需要考虑检查与创建之间的并发窗口。

日志已脱敏，未包含 Cookie、认证信息、签名下载 URL、私人文件路径或账号标识。
