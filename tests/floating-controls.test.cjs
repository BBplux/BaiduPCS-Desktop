const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createFloatingDrag,
  floatingMenuTemplate,
} = require("../electron/floating-controls.cjs");
test("floating drag uses screen deltas, ignores click jitter, and stops on release or focus loss", () => {
  const window = new EventEmitter();
  let position = [-500, 100],
    cursor = { x: -450, y: 120 };
  window.isDestroyed = () => false;
  window.getPosition = () => position;
  window.getContentSize = () => [168, 48];
  window.setBounds = ({ x, y, width, height }) => {
    assert.deepEqual([width, height], [168, 48]);
    position = [x, y];
  };
  const drag = createFloatingDrag(window, {
    getCursorScreenPoint: () => cursor,
  });
  drag("start");
  cursor = { x: -448, y: 121 };
  drag("move");
  assert.deepEqual(position, [-500, 100]);
  cursor = { x: -420, y: 140 };
  drag("move");
  assert.deepEqual(position, [-470, 120]);
  assert.equal(drag("end"), true);
  cursor = { x: 1000, y: 1000 };
  drag("move");
  assert.deepEqual(position, [-470, 120]);
  drag("start");
  window.emit("blur");
  cursor = { x: 1500, y: 1500 };
  drag("move");
  assert.deepEqual(position, [-470, 120]);
});
test("floating menu enables batch actions only for eligible tasks and an available backend", () => {
  const menu = (options) =>
    floatingMenuTemplate({ tasks: [], ready: true, busy: false, ...options });
  const enabled = (items, label) =>
    items.find((i) => i.label === label).enabled;
  assert.equal(enabled(menu({}), "开始全部任务"), false);
  assert.equal(
    enabled(menu({ tasks: [{ status: "completed" }] }), "暂停全部任务"),
    false,
  );
  assert.equal(
    enabled(menu({ tasks: [{ status: "failed" }] }), "开始全部任务"),
    true,
  );
  assert.equal(
    enabled(menu({ tasks: [{ status: "uploading" }] }), "暂停全部任务"),
    true,
  );
  assert.equal(
    enabled(
      menu({ ready: false, tasks: [{ status: "paused" }] }),
      "开始全部任务",
    ),
    false,
  );
  assert.equal(
    enabled(
      menu({ busy: true, tasks: [{ status: "uploading" }] }),
      "暂停全部任务",
    ),
    false,
  );
});
