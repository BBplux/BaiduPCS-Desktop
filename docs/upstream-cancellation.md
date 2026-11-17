# BaiduPCS-Rust v2.4.0 取消流程核对

## 2026-11-08 独立原版后端对照

使用与交付程序 SHA-256 一致的官方预编译二进制（410764ad7e483ae488e3b4bfb2ad51e42f22c52f59e6ac9c86154a04156405cc），独立配置和下载目录，直接调用原版 DELETE /downloads/:id?delete_file=false，完全绕过客户端 taskAction 及延迟补删。只复制会话用于测试，结束后删除凭据副本和原始日志，仅保留脱敏事件。

小文件对照：分片在约 1ms 内响应取消，约 104ms 清理临时文件，观察 60 秒无重建。证明不能仅凭固定 100ms 等待判定每次删除都会失败。

之前出现问题的同一大文件对照：下载超过 16MiB 后删除。相对取消发出时间，多个分片在 0–1ms 内退出，106ms 日志确认清理 .downloading，805ms 另一个分片才记录“流式读取被取消”。文件观察为删除返回后约 108ms 不存在，1109ms 出现零字节文件。上游 chunk.rs 的顺序为等待 HTTP 响应 → create(true) 打开文件 → 流式循环检查取消，与晚到分片时间线吻合。此对照确认无需客户端封装也会复现；未用系统调用跟踪定位具体 open 的调用栈，不能把源码路径分析称为调用栈证据。

脚本：scripts/trace-cancel.cjs（--same-file 为问题文件对照）。脱敏报告：artifacts/upstream-cancel-trace.json、artifacts/upstream-cancel-original-trace.json。此次为后端 HTTP 对照，没有操作上游原版 GUI。

核对日期：2026-11-06。以实际使用的发布标签 v2.4.0 为准（19900ad7bad33b0056f524cb2ecd723549af3ef0），不是仅按参考仓库默认分支推断。

- 前端 DownloadsView.vue 调用 deleteDownload / cancelFolderDownload，删除成功后显示消息，没有额外等待下载协程退出。
- manager.rs 的 delete_task 从队列移除任务，调用调度器取消，再取消任务令牌，固定等待 100ms 后移除任务及清理文件。固定时间不保证全部分片退出。
- scheduler.rs 的 cancel_task 只移除活动记录并触发取消令牌，没有等待所有分片完成退出。
- chunk.rs 在 HTTP 响应校验后创建父目录，使用 create(true) 打开输出文件；随后进入流式读取循环才以 tokio::select! 检查取消。晚到的响应因此有机会在删除清理后重新创建文件，再因取消立即退出。这与真实测试中延迟出现零字节 .downloading 的现象吻合。

根本修复应位于 Rust 后端：取消覆盖网络等待和重试等待，创建/打开文件前检查取消，且删除操作必须等待任务及分片退出后再清理。仅增加一次取消检查仍有检查与创建间的竞态，不能替代生命周期同步。完成记录的清除应保留最终文件。

当前交付仍使用官方预编译 v2.4.0，尚未替换为自行编译后端。客户端延迟补删只是临时兼容处理；不得将其描述成上游线程生命周期问题已经根治。后端修复验收需覆盖延迟响应、取消后文件不存在、同路径新任务以及退出/重启，不以固定等待后单次观察代替确定性测试。

源码入口：
- https://github.com/komorebiCarry/BaiduPCS-Rust/blob/v2.4.0/backend/src/downloader/manager.rs
- https://github.com/komorebiCarry/BaiduPCS-Rust/blob/v2.4.0/backend/src/downloader/scheduler.rs
- https://github.com/komorebiCarry/BaiduPCS-Rust/blob/v2.4.0/backend/src/downloader/chunk.rs
- https://github.com/komorebiCarry/BaiduPCS-Rust/blob/v2.4.0/frontend/src/views/DownloadsView.vue
