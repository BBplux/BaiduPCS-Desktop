import type { Task } from "./types";
export async function call<T = any>(
  command: string,
  payload?: unknown,
): Promise<T> {
  if (!window.desktop) throw new Error("请使用桌面客户端打开此页面");
  const result = await window.desktop.call(command, payload);
  if (!result.ok) throw new Error(result.error || "操作失败");
  return result.data as T;
}
export function bytes(value = 0, decimals = 1): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"],
    i = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** i).toFixed(i > 0 ? decimals : 0)} ${units[i]}`;
}
export const done = (t: Task) =>
  ["completed", "rapid_upload_success", "skipped", "cancelled"].includes(
    t.status,
  );
export const taskName = (t: Task) =>
  t.remote_path.split("/").filter(Boolean).at(-1) ||
  t.local_path.split(/[\\/]/).at(-1) ||
  "传输任务";
export const progress = (t: Task) =>
  t.total_size > 0
    ? Math.min(
        100,
        Math.round(
          (((t.kind === "download" ? t.downloaded_size : t.uploaded_size) ||
            0) /
            t.total_size) *
            100,
        ),
      )
    : done(t)
      ? 100
      : 0;
