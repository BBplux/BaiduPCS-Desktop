# BaiduPCS-Go 与 Rust 下载取消比较

2026-11-08 静态源码检查。Go 参考提交：1b9131817aaf8ca7dee24bc00e33ebc4c7a5cc73（qjfoidnh/BaiduPCS-Go）。未编译、未执行 Go 版真实下载测试。

## 文件含义与所有权

Go 的 internal/pcsfunctions/pcsdownload/download_task_unit.go:124 将 SavePath + `.BaiduPCS-Go-downloading` 设置为 InstanceStatePath；instance_state.go 使用 JSON/protobuf 保存分片范围、下载进度等恢复信息。这不是下载数据文件，不能与 Rust 的 `.downloading` 数据文件直接等同。

Go 任务在 download_task_unit.go:142 打开 SavePath，defer file.Close()，将返回的 Writer 交给 Downloader。writer.go 的 Writer 仅包含 io.WriterAt；worker.go:408 通过已有 writerAt.WriteAt 写入，不负责按文件名创建输出文件。晚到网络响应不触发分片重新创建路径，这正是与 Rust chunk.rs 的 create(true) 路径的关键区别。

## 取消机制及限制

Downloader.Cancel → monitorCancelFunc → Monitor.Execute 收到取消后遍历 Worker.Cancel。Worker.Cancel 发出 context 取消，并在已取得响应时关闭 resp.Body，以中断读取。

但不能把它说成“等待所有 worker 退出后再删除”：monitor.go:366–374 在调用各 Worker.Cancel 后直接 return，没有等待全部 goroutine 结束。worker.go 建立请求时使用 client.Req，所示调用没有传入 workerCancelCtx；尚未取得响应时，关闭 Body 的回调也未设置。因此 Go 同样不能仅凭源码被证明取消生命周期完全严谨。

Go 现有 CLI 流程也不等价于本项目的“删除任务并清理所有未完成数据”：数据直接位于最终路径，恢复元数据单独保存；错误处理会尝试清理零长度目标文件，不是通用的取消删除保证。

## 对本项目的启示

应借鉴文件所有权：任务层创建并持有输出文件，分片只写已有句柄，避免取消后分片 create(true) 重建。可靠删除还需要等待任务和所有分片退出、关闭文件，再清理临时数据及恢复记录；不能仅照搬 Go 的 Cancel 函数或延长固定等待时间。此次不更换后端、不修改现有用户数据。

## 固定版本源码

- [任务层打开文件](https://github.com/qjfoidnh/BaiduPCS-Go/blob/1b9131817aaf8ca7dee24bc00e33ebc4c7a5cc73/internal/pcsfunctions/pcsdownload/download_task_unit.go#L124)
- [Writer 接口](https://github.com/qjfoidnh/BaiduPCS-Go/blob/1b9131817aaf8ca7dee24bc00e33ebc4c7a5cc73/requester/downloader/writer.go#L15)
- [取消监控](https://github.com/qjfoidnh/BaiduPCS-Go/blob/1b9131817aaf8ca7dee24bc00e33ebc4c7a5cc73/requester/downloader/monitor.go#L366)
- [Worker 取消](https://github.com/qjfoidnh/BaiduPCS-Go/blob/1b9131817aaf8ca7dee24bc00e33ebc4c7a5cc73/requester/downloader/worker.go#L167)
- [Worker 写入](https://github.com/qjfoidnh/BaiduPCS-Go/blob/1b9131817aaf8ca7dee24bc00e33ebc4c7a5cc73/requester/downloader/worker.go#L408)
