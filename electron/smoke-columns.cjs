const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

exports.run = async ({ mainWindow, backend, output }) => {
  const original = backend.request;
  const bounds = mainWindow.getBounds();
  let requests = 0;
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function waitFor(code) {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error("Column check timed out: " + code);
  }
  const widths = () =>
    js(
      "[...document.querySelectorAll('.file-table thead th')].slice(1).map(e=>e.getBoundingClientRect().width)",
    );
  async function capture(name) {
    await new Promise((r) => setTimeout(r, 180));
    await fs.writeFile(
      path.join(output, name + ".png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
  }
  async function begin(index) {
    mainWindow.focus();
    mainWindow.webContents.focus();
    const point = await js(`(() => {
      const e=document.querySelectorAll('.file-column-resizer')[${index}];
      e.scrollIntoView({block:'nearest',inline:'center'});
      const r=e.getBoundingClientRect();return {x:Math.round(r.x+6),y:Math.round(r.y+r.height/2)};
    })()`);
    await mainWindow.webContents.debugger.sendCommand(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", ...point },
    );
    await mainWindow.webContents.debugger.sendCommand(
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        button: "left",
        buttons: 1,
        clickCount: 1,
        ...point,
      },
    );
    await waitFor("document.body.classList.contains('file-columns-resizing')");
    return point;
  }
  async function drag(index, delta) {
    const point = await begin(index);
    const next = { x: point.x + delta, y: point.y };
    await mainWindow.webContents.debugger.sendCommand(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", button: "left", buttons: 1, ...next },
    );
    await new Promise((r) => setTimeout(r, 60));
    await mainWindow.webContents.debugger.sendCommand(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        button: "left",
        buttons: 0,
        clickCount: 1,
        ...next,
      },
    );
    await waitFor("!document.body.classList.contains('file-columns-resizing')");
    await js("new Promise(r=>requestAnimationFrame(r))");
  }
  backend.request = async function (endpoint, ...args) {
    if (endpoint.startsWith("/files?")) {
      requests++;
      return {
        has_more: false,
        list: Array.from({ length: 30 }, (_, i) => ({
          fs_id: i + 1,
          server_filename:
            i === 0
              ? "示例文件夹"
              : `文件${i}：较长的文件名检查列宽拖动与内容截断.pdf`,
          path: `/fixture-${i}`,
          isdir: i === 0 ? 1 : 0,
          category: i === 0 ? 0 : 4,
          size: 12582912,
          server_mtime: 1730000000,
        })),
      };
    }
    return original.call(this, endpoint, ...args);
  };
  try {
    mainWindow.webContents.debugger.attach("1.3");
    await fs.mkdir(output, { recursive: true });
    mainWindow.setContentSize(1108, 720);
    await waitFor(
      "!!document.querySelector('.empty-state .ant-btn:not([disabled])')",
    );
    mainWindow.webContents.send("desktop:event", {
      type: "logged-in",
      user: {
        uid: -1,
        username: "列宽验证（模拟数据）",
        total_space: 2199023255552,
        used_space: 0,
      },
    });
    await waitFor(
      "document.querySelectorAll('.file-table tbody tr, .file-card').length === 30",
    );
    await click('[title="列表视图"]');
    await waitFor(
      "document.querySelectorAll('.file-table tbody tr').length === 30",
    );
    await waitFor("!document.querySelector('.ant-message-notice')");
    await click(".file-table tbody tr:first-child");
    const before = await widths();
    const requestCount = requests;
    await drag(0, 100);
    let after = await widths();
    assert.ok(
      Math.abs(after[0] - before[0] - 100) < 2,
      JSON.stringify({ before, after }),
    );
    for (let i = 1; i < 4; i++)
      assert.ok(
        Math.abs(after[i] - before[i]) < 2,
        "Other columns retain their width",
      );
    assert.equal(
      requests,
      requestCount,
      "Dragging must not trigger sorting or reload",
    );
    assert.equal(
      await js(
        "document.querySelectorAll('.file-table tbody tr.selected').length",
      ),
      1,
    );
    await capture("desktop-columns-expanded");
    await drag(1, 65);
    after = await widths();
    assert.ok(Math.abs(after[1] - before[1] - 65) < 2);
    await drag(2, -180);
    assert.ok(
      Math.abs((await widths())[2] - 100) < 2,
      "Type column minimum width",
    );
    await drag(3, 80);
    assert.ok(Math.abs((await widths())[3] - before[3] - 80) < 2);
    await js("document.querySelector('.file-list-viewport').scrollLeft=9999");
    assert.ok(
      await js("document.querySelector('.file-list-viewport').scrollLeft > 0"),
    );
    assert.ok(
      await js(`(() => {
      const heads=[...document.querySelectorAll('.file-table th')];
      const cells=[...document.querySelectorAll('.file-table tbody tr:first-child td')];
      return heads.every((h,i)=>Math.abs(h.getBoundingClientRect().left-cells[i].getBoundingClientRect().left)<1);
    })()`),
      "Header and rows stay aligned while scrolled",
    );
    await capture("desktop-columns-scrolled");
    await js("document.querySelector('.file-list-viewport').scrollTop=200");
    await js("new Promise(r=>requestAnimationFrame(r))");
    assert.ok(
      await js(
        "(() => {const viewport=document.querySelector('.file-list-viewport').getBoundingClientRect();const header=document.querySelector('.file-table thead').getBoundingClientRect();return Math.abs(header.top-viewport.top)<2;})()",
      ),
      "Header remains pinned during vertical scroll",
    );
    await js("document.querySelector('.file-list-viewport').scrollTop=0");
    await js("document.querySelector('.file-list-viewport').scrollLeft=0");
    await drag(0, -500);
    assert.ok(
      Math.abs((await widths())[0] - 256) < 2,
      "Filename including checkbox retains 300px minimum",
    );
    await capture("desktop-columns-minimum");
    const saved = await widths();
    const point = await begin(0);
    await click('[title="网格视图"]');
    await waitFor(
      "!!document.querySelector('.file-grid') && !document.body.classList.contains('file-columns-resizing')",
    );
    await mainWindow.webContents.debugger.sendCommand(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        button: "left",
        buttons: 0,
        clickCount: 1,
        ...point,
      },
    );
    await click('[title="列表视图"]');
    await waitFor("!!document.querySelector('.file-table')");
    assert.deepEqual(
      await widths(),
      saved,
      "View switching retains adjusted widths",
    );
    await click(".file-table th.size-cell .file-header-sort");
    await waitFor(
      "document.querySelector('.file-table th.size-cell').getAttribute('aria-sort') === 'ascending' && !document.querySelector('.ant-spin-spinning')",
    );
    assert.equal(
      requests,
      requestCount + 1,
      "Sorting still works after dragging",
    );
    mainWindow.setSize(1000, 640);
    await new Promise((r) => setTimeout(r, 180));
    assert.ok(
      await js("document.documentElement.scrollWidth <= innerWidth"),
      "Overflow stays within file viewport",
    );
    await capture("desktop-columns-compact");
    await fs.writeFile(
      path.join(output, "columns-result.json"),
      JSON.stringify(
        {
          passed: true,
          checks: [
            "real pointer drag on all four columns",
            "minimum widths",
            "no accidental sort or selection loss",
            "horizontal scroll alignment",
            "drag cleanup on view switch",
            "width retention across views",
            "sorting after drag",
            "compact window",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    mainWindow.webContents.debugger.detach();
    backend.request = original;
    mainWindow.setBounds(bounds);
    mainWindow.webContents.send("desktop:event", { type: "logged-out" });
  }
};
