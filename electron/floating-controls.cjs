// Screen coordinates come from Electron (DIP), so dragging does not depend on
// which child element is under the pointer or the renderer's device scale.
function createFloatingDrag(window, screen) {
  let origin;
  function end() {
    const moved = !!origin?.moved;
    origin = null;
    return moved;
  }
  window.on("blur", end);
  window.on("closed", end);
  return (phase) => {
    if (phase === "end") return end();
    if (window.isDestroyed()) return;
    if (phase === "start") {
      origin = {
        cursor: screen.getCursorScreenPoint(),
        position: window.getPosition(),
        size: window.getContentSize(),
        moved: false,
      };
    } else if (phase === "move" && origin) {
      const cursor = screen.getCursorScreenPoint();
      const dx = cursor.x - origin.cursor.x,
        dy = cursor.y - origin.cursor.y;
      if (!origin.moved && Math.hypot(dx, dy) < 4) return;
      origin.moved = true;
      // setPosition reuses enclosing, rounded bounds on Windows. At fractional
      // DPI that feeds an extra pixel into the next move. This frameless window
      // must reuse its content size, not the rounded outer bounds.
      window.setBounds({
        x: Math.round(origin.position[0] + dx),
        y: Math.round(origin.position[1] + dy),
        width: origin.size[0],
        height: origin.size[1],
      });
    }
  };
}
const completed = (t) =>
  ["completed", "rapid_upload_success", "skipped", "cancelled"].includes(
    t.status,
  );
const resumable = (t) => ["paused", "failed"].includes(t.status);
const pausable = (t) => !completed(t) && !resumable(t);
function floatingMenuTemplate({
  tasks,
  ready,
  busy,
  open,
  upload,
  batch,
  hide,
  settings,
  quit,
}) {
  return [
    { label: "打开主面板", click: open },
    { label: "上传文件至百度网盘", enabled: ready, click: upload },
    {
      label: "开始全部任务",
      enabled: ready && !busy && tasks.some(resumable),
      click: () => batch("resume"),
    },
    {
      label: "暂停全部任务",
      enabled: ready && !busy && tasks.some(pausable),
      click: () => batch("pause"),
    },
    { label: "隐藏悬浮球", click: hide },
    { type: "separator" },
    { label: "设置", click: settings },
    { label: "退出", click: quit },
  ];
}
module.exports = {
  createFloatingDrag,
  floatingMenuTemplate,
  resumable,
  pausable,
};
