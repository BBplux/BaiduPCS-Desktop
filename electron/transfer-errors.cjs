function transferError(error) {
  const text = String(error?.message || error || "传输失败");
  if (
    /ENOSPC|os error 112|disk (?:is )?full|not enough space|空间不足/i.test(
      text,
    )
  )
    return "磁盘空间不足，请释放保存位置所在磁盘的空间后重试。";
  if (/ENOENT|os error [23]\b|not found|cannot find|不存在/i.test(text))
    return "文件或目录不存在，可能已移动或删除。请恢复原位置，或重新选择文件和下载位置。";
  if (
    /EACCES|EPERM|os error 5\b|permission denied|access.*denied|拒绝访问/i.test(
      text,
    )
  )
    return "无法访问文件或目录，请检查保存位置和访问权限后重试。";
  if (/timed? ?out|timeout|ECONN|ENET|EHOST|network|连接|网络|超时/i.test(text))
    return "网络连接异常，请检查网络；恢复后可点击继续或重试。";
  return text;
}
module.exports = { transferError };
