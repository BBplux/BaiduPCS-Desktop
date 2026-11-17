const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

// Isolated file-page fixtures; no real account or file operations.
exports.run = async ({ mainWindow, backend, output }) => {
  const original = backend.request;
  const bounds = mainWindow.getBounds();
  const directories = [];
  const names = [
    "桌面",
    "音乐",
    "客户端验证-20261103T1长文件夹名称",
    "项目",
    "我的资源",
    "图片",
    "工作",
    "其它",
    "示例资料",
    "归档",
    "学习",
    "文档",
    "存档",
    "补丁",
    "示例目录",
    "备份",
    "Game",
    "设计",
    "Comic",
    "CG",
    "应用数据",
    "gjpqy.pdf",
  ];
  const js = async (code) => {
    try {
      return await mainWindow.webContents.executeJavaScript(code);
    } catch (error) {
      throw new Error(`Grid check failed: ${code}\n${error.message}`);
    }
  };
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function waitFor(code) {
    for (let i = 0; i < 150; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error("Grid view did not reach expected state: " + code);
  }
  async function capture(name) {
    await js(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    await new Promise((r) => setTimeout(r, 150));
    await fs.writeFile(
      path.join(output, name + ".png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
  }
  async function hover(selector) {
    mainWindow.focus();
    mainWindow.webContents.focus();
    const point = await js(
      `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+20)}})()`,
    );
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", ...point });
    await waitFor(
      `document.querySelector(${JSON.stringify(selector)}).matches(':hover')`,
    );
  }
  backend.request = async function (endpoint, ...args) {
    if (endpoint.startsWith("/files?")) {
      const dir = new URL(endpoint, "http://localhost").searchParams.get("dir");
      directories.push(dir);
      return {
        has_more: false,
        list: names.map((name, index) => ({
          fs_id: index + 1,
          server_filename: name,
          path: (dir === "/" ? "" : dir) + "/" + name,
          isdir: index < 21 ? 1 : 0,
          category: index < 21 ? 0 : 4,
          size: index < 21 ? 0 : 12582912,
          server_mtime: 1730000000,
        })),
      };
    }
    return original.call(this, endpoint, ...args);
  };
  try {
    await fs.mkdir(output, { recursive: true });
    mainWindow.setContentSize(1108, 740);
    await waitFor("!!document.querySelector('#header-search input')");
    // Initialization must finish before the mock login event.
    await waitFor(
      "!!document.querySelector('.empty-state .ant-btn:not([disabled])')",
    );
    mainWindow.webContents.send("desktop:event", {
      type: "logged-in",
      user: {
        uid: -1,
        username: "网格验证（模拟数据）",
        total_space: 2199023255552,
        used_space: 0,
      },
    });
    await waitFor(
      "document.querySelectorAll('.file-table tbody tr').length === 22",
    );
    await click('[title="网格视图"]');
    await waitFor("document.querySelectorAll('.file-card').length === 22");
    await waitFor("!document.querySelector('.ant-message-notice')");
    await js(
      "Promise.all([...document.querySelectorAll('.file-card img')].map(img=>img.decode()))",
    );
    await js("document.getAnimations().forEach(a=>a.finish())");
    await hover(".file-top-nav");
    assert.ok(
      await js(
        "document.querySelector('.file-grid-header').textContent.includes('已全部加载，共22个')",
      ),
    );
    assert.equal(
      await js("document.querySelectorAll('.file-card small').length"),
      0,
    );
    assert.equal(
      await js(
        "getComputedStyle(document.querySelector('.file-card-check')).opacity",
      ),
      "0",
    );
    await capture("desktop-grid-default");
    await hover(".file-card:nth-child(2)");
    assert.equal(
      await js(
        "getComputedStyle(document.querySelector('.file-card:nth-child(2) .file-card-check')).opacity",
      ),
      "1",
    );
    await capture("desktop-grid-hover");
    await click(".file-card:first-child .ant-checkbox-input");
    await waitFor(
      "document.querySelectorAll('.file-card.selected').length === 1",
    );
    assert.equal(
      directories.length,
      1,
      "Checkbox selection must not navigate or reload",
    );
    assert.equal(
      await js(
        "getComputedStyle(document.querySelector('.file-card:nth-child(3) .file-card-check')).opacity",
      ),
      "1",
    );
    assert.ok(
      await js(
        "document.querySelector('.file-grid-header .ant-checkbox-indeterminate') !== null",
      ),
    );
    assert.ok(
      await js(
        "document.querySelector('.file-grid-header').textContent.includes('已选中1个文件/文件夹')",
      ),
    );
    await capture("desktop-grid-selected");
    const geometry = await js(`(() => {
      const cards=[...document.querySelectorAll('.file-card')].map(e=>e.getBoundingClientRect());
      const first=cards[0], nextRow=cards.find(r=>r.top>first.top+1);
      return {width:first.width,rowStep:nextRow.top-first.top,firstRow:cards.filter(r=>Math.abs(r.top-first.top)<1).length};
    })()`);
    assert.equal(geometry.width, 80);
    assert.equal(geometry.rowStep, 134);
    assert.equal(geometry.firstRow, 8);
    await require("./smoke-typography.cjs").checkFilenameInk(
      mainWindow,
      ".file-card:last-child > span",
      output,
      "grid-filename",
    );
    await click(".file-grid-header .ant-checkbox-input");
    await waitFor(
      "document.querySelectorAll('.file-card.selected').length === 22",
    );
    await click(".file-grid-header .ant-checkbox-input");
    await waitFor(
      "document.querySelectorAll('.file-card.selected').length === 0",
    );
    await click(".file-card:nth-child(3)");
    await click('[title="列表视图"]');
    await waitFor(
      "document.querySelectorAll('.file-table tbody tr.selected').length === 1",
    );
    assert.ok(
      await js(
        "document.querySelector('.file-table tbody tr:nth-child(3)').classList.contains('selected')",
      ),
    );
    await click('[title="网格视图"]');
    await waitFor(
      "document.querySelectorAll('.file-card.selected').length === 1",
    );
    mainWindow.setSize(1000, 640);
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(await js("document.documentElement.scrollWidth <= innerWidth"));
    await capture("desktop-grid-compact");
    await js(
      "document.querySelector('.file-card:first-child').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))",
    );
    await waitFor(
      "document.querySelector('.breadcrumb').textContent.includes('桌面') && !document.querySelector('.ant-spin-spinning')",
    );
    assert.equal(directories.at(-1), "/桌面");
    await click('[title="后退"]');
    await waitFor(
      "!document.querySelector('.breadcrumb')?.textContent.includes('桌面') && !document.querySelector('.ant-spin-spinning')",
    );
    assert.equal(directories.at(-1), "/");
    await fs.writeFile(
      path.join(output, "grid-result.json"),
      JSON.stringify(
        {
          passed: true,
          geometry,
          checks: [
            "grid layout and two-line names",
            "hover and selected checkboxes",
            "select all and clear",
            "selection across view switching",
            "folder navigation",
            "compact window",
            "filename descenders",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    backend.request = original;
    mainWindow.setBounds(bounds);
    mainWindow.webContents.send("desktop:event", { type: "logged-out" });
  }
};
