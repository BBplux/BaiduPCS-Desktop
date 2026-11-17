export interface User {
  uid: number;
  username: string;
  nickname?: string;
  total_space?: number;
  used_space?: number;
}
export interface FileEntry {
  fs_id: number;
  path: string;
  server_filename: string;
  size: number;
  isdir: number;
  category: number;
  server_mtime: number;
}
export interface Task {
  completed_at?: number | null;
  folder?: boolean;
  id: string;
  kind: "download" | "upload";
  remote_path: string;
  local_path: string;
  total_size: number;
  downloaded_size?: number;
  uploaded_size?: number;
  speed: number;
  status: string;
  error?: string;
  failure_reason?: string;
}
export interface Settings {
  downloadDir: string;
  closeToTray: boolean;
  floatEnabled: boolean;
  startAtLogin: boolean;
  autoResume: boolean;
  confirmExit: boolean;
  downloadConflict: string;
  uploadConflict: string;
}
export interface BackendStatus {
  connection?: string;
  state: string;
  error: string;
  version: string;
}
export interface DesktopEvent {
  type: string;
  [key: string]: any;
}
declare global {
  interface Window {
    desktop: {
      call: (
        command: string,
        payload?: unknown,
      ) => Promise<{ ok: boolean; data?: any; error?: string }>;
      filePath: (file: File) => string;
      on: (callback: (event: DesktopEvent) => void) => () => void;
    };
  }
}
