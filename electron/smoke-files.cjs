const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
exports.run = async ({
  mainWindow,
  backend,
  output,
  navigationOnly = false,
  styleOnly = false,
}) => {
  const original = backend.request;
  const requests = [];
  const sortRequests = [];
  const searches = [];
  backend.request = async function (endpoint, ...args) {
    if (endpoint.startsWith("/files/search?")) {
      searches.push(
        new URL(endpoint, "http://localhost").searchParams.get("key"),
      );
      return { list: [], has_more: false };
    }
    if (endpoint.startsWith("/files?")) {
      const params = new URL(endpoint, "http://localhost").searchParams;
      const dir = params.get("dir");
      sortRequests.push([params.get("order"), params.get("desc")]);
      requests.push(dir);
      return {
        has_more: false,
        list: [
          {
            fs_id: 1,
            server_filename: "示例文件夹",
            path: dir === "/" ? "/示例文件夹" : dir + "/示例文件夹",
            isdir: 1,
            category: 0,
            size: 0,
            server_mtime: 1730000000,
          },
          {
            fs_id: 2,
            server_filename: "界面验证文档.pdf",
            path: "/界面验证文档.pdf",
            isdir: 0,
            category: 4,
            size: 12582912,
            server_mtime: 1730000000,
          },
          {
            fs_id: 3,
            server_filename:
              "较长的文件名用于检查列表文字截断和修改时间列是否相互遮挡.zip",
            path: "/示例.zip",
            isdir: 0,
            category: 5,
            size: 536870912,
            server_mtime: 1730000000,
          },
        ],
      };
    }
    return original.call(this, endpoint, ...args);
  };
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw Error("File view did not reach expected state");
  }
  async function click(selector) {
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
  try {
    mainWindow.webContents.send("desktop:event", {
      type: "logged-in",
      user: {
        uid: -1,
        username: "界面验证（模拟数据）",
        total_space: 2199023255552,
        used_space: 536870912,
      },
    });
    await waitFor(() =>
      js("document.querySelectorAll('.file-table tbody tr').length === 3"),
    );
    if (process.argv.includes("--file-delete-test")) {
      await require("./check-file-delete.cjs").run({
        mainWindow,
        backend,
        output,
      });
      return;
    }
    if (styleOnly) {
      await require("./check-ui-style.cjs").files({
        mainWindow,
        output,
        sortRequests,
      });
      return;
    }
    if (!process.argv.includes("--breadcrumb-style-only"))
      await require("./smoke-file-navigation.cjs").run({
        mainWindow,
        requests,
      });
    if (process.argv.includes("--breadcrumb-test"))
      await require("./check-breadcrumb.cjs").run({
        mainWindow,
        requests,
        output,
      });
    if (navigationOnly) return;
    await js("document.getAnimations().forEach(a=>a.finish())");
    await new Promise((r) => setTimeout(r, 3200));
    assert.deepEqual(
      await js(`Promise.all([...document.querySelectorAll('.file-table .file-artwork img')].map(async img => {
        await img.decode();
        if (!img.naturalWidth) throw Error('File artwork failed to load');
        return img.dataset.fileType;
      }))`),
      ["folder-y", "pdf", "zip"],
      "Official file artwork must load from the built application",
    );
    // Exercise the visible sort controls through IPC, including both directions.
    for (const [key, cell] of [
      ["size", "size"],
      ["time", "date"],
      ["name", "name"],
    ]) {
      for (const descending of [false, true]) {
        await click(`.file-table th.${cell}-cell button`);
        await waitFor(() =>
          js(
            `document.querySelector('.file-table th.${cell}-cell').getAttribute('aria-sort') === '${descending ? "descending" : "ascending"}' && !document.querySelector('.ant-spin-spinning')`,
          ),
        );
        assert.deepEqual(sortRequests.at(-1), [key, String(descending)]);
      }
    }
    await click(".file-table th.name-cell button");
    await waitFor(() =>
      js(
        "document.querySelector('.file-table th.name-cell').getAttribute('aria-sort') === 'ascending' && !document.querySelector('.ant-spin-spinning')",
      ),
    );
    await js(
      "Promise.all([...document.querySelectorAll('.file-header-arrow')].map(img => img.decode()))",
    );
    mainWindow.focus();
    mainWindow.webContents.focus();
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: 80, y: 140 });
    await new Promise((r) => setTimeout(r, 100));
    await fs.writeFile(
      path.join(output, "desktop-files-header.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    const headerPoint = await js(
      "(() => {const r=document.querySelector('.file-table th.name-cell').getBoundingClientRect();return {x:Math.round(r.x+20),y:Math.round(r.y+r.height/2)}})()",
    );
    mainWindow.webContents.sendInputEvent({
      type: "mouseMove",
      ...headerPoint,
    });
    await waitFor(() =>
      js("document.querySelector('.file-table thead').matches(':hover')"),
    );
    await fs.writeFile(
      path.join(output, "desktop-files-header-hover.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", x: 80, y: 140 });
    await require("./smoke-typography.cjs").checkFilenameInk(
      mainWindow,
      ".file-table tbody tr:nth-child(2) .file-name > span:last-child",
      output,
      "filename-list",
    );
    await fs.writeFile(
      path.join(output, "desktop-files-fixture.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    await click(".file-table tbody tr:first-child");
    await waitFor(() => js("!!document.querySelector('.selection-actions')"));
    assert.ok(
      await js(
        "document.querySelector('.selection-count').textContent.includes('已选中1个')",
      ),
    );
    const beforeCountClick = sortRequests.length;
    await click(".selection-count");
    assert.equal(
      sortRequests.length,
      beforeCountClick,
      "Clicking the count must not change sorting or clear selection",
    );
    assert.equal(
      requests.at(-1),
      "/",
      "Single click must select, not open a folder",
    );
    assert.equal(
      await js("document.querySelector('.file-table tbody input').checked"),
      true,
    );
    await js("document.getAnimations().forEach(a=>a.finish())");
    await new Promise((r) => setTimeout(r, 150));
    await fs.writeFile(
      path.join(output, "desktop-files-selected.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    // Right-click preserves a selected batch, but changes target on an unselected row.
    await click(".file-table tbody tr:nth-child(2)");
    await js(
      `document.querySelector('.file-table tbody tr:first-child').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:450,clientY:330}))`,
    );
    await waitFor(() => js("!!document.querySelector('.file-context-menu')"));
    assert.equal(
      await js(
        "document.querySelectorAll('.file-table tbody tr.selected').length",
      ),
      2,
    );
    assert.equal(
      await js(
        "document.querySelector('.file-context-menu').textContent.includes('重命名')",
      ),
      false,
    );
    await js(
      "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    await waitFor(() => js("!document.querySelector('.file-context-menu')"));
    await js(
      `document.querySelector('.file-table tbody tr:nth-child(3)').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:innerWidth-2,clientY:innerHeight-2}))`,
    );
    await waitFor(() => js("!!document.querySelector('.file-context-menu')"));
    assert.equal(
      await js(
        "document.querySelectorAll('.file-table tbody tr.selected').length",
      ),
      1,
    );
    assert.ok(
      await js(
        "document.querySelector('.file-table tbody tr:nth-child(3)').classList.contains('selected')",
      ),
    );
    assert.ok(
      await js(
        "(() => {const r=document.querySelector('.file-context-menu').getBoundingClientRect();return r.right<=innerWidth && r.bottom<=innerHeight && r.left>=0 && r.top>=0;})()",
      ),
    );
    await new Promise((r) => setTimeout(r, 250));
    await fs.writeFile(
      path.join(output, "desktop-file-context.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    await js(
      "[...document.querySelectorAll('.file-context-menu button')].find(b=>b.textContent.trim()==='重命名').click()",
    );
    await waitFor(() => js("!!document.querySelector('.ant-modal input')"));
    assert.ok(
      await js(
        "document.querySelector('.ant-modal input').value.startsWith('较长的文件名')",
      ),
    );
    await click(".ant-modal-close");
    await new Promise((r) => setTimeout(r, 350));
    await js(
      "document.querySelector('.file-list-viewport').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:600,clientY:400}))",
    );
    await waitFor(() => js("!!document.querySelector('.file-context-menu')"));
    assert.equal(
      await js(
        "document.querySelectorAll('.file-table tbody tr.selected').length",
      ),
      0,
    );
    assert.equal(
      await js(
        "document.querySelector('.file-context-menu').textContent.includes('删除')",
      ),
      false,
    );
    await js(
      "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
    );
    await click(".file-table tbody tr:first-child");
    const hover = await js(
      "(() => {const r=document.querySelector('.file-table tbody tr:first-child').getBoundingClientRect();return {x:Math.round(r.x+100),y:Math.round(r.y+r.height/2)}})()",
    );
    mainWindow.focus();
    mainWindow.webContents.focus();
    mainWindow.webContents.sendInputEvent({ type: "mouseMove", ...hover });
    await waitFor(() =>
      js(
        "getComputedStyle(document.querySelector('.file-hover-actions')).display === 'flex'",
      ),
    );
    assert.equal(
      await js(
        "getComputedStyle(document.querySelector('.file-hover-actions')).display",
      ),
      "flex",
      await js(
        `JSON.stringify({ expected: ${JSON.stringify(hover)}, hit: document.elementFromPoint(${hover.x},${hover.y})?.outerHTML.slice(0,200), hovered: [...document.querySelectorAll(':hover')].map(e=>e.className), viewport: [innerWidth,innerHeight] })`,
      ),
    );
    assert.ok(
      await js(
        "(() => { const a=document.querySelector('.file-hover-actions').getBoundingClientRect(),c=document.querySelector('.file-name-cell').getBoundingClientRect();return a.right<=c.right && c.right-a.right<=28 })()",
      ),
    );
    await fs.writeFile(
      path.join(output, "desktop-files-hover.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    await click('[title="网格视图"]');
    await waitFor(() =>
      js("document.querySelectorAll('.file-card').length === 3"),
    );
    await require("./smoke-typography.cjs").checkFilenameInk(
      mainWindow,
      ".file-card:nth-child(2) > span",
      output,
      "filename-grid",
    );
    assert.equal(
      await js("document.querySelectorAll('.file-card.selected').length"),
      1,
    );
    await click('[title="列表视图"]');
    await waitFor(() => js("!!document.querySelector('.file-table')"));
    await click(".file-table tbody tr:first-child .ant-checkbox-input");
    await waitFor(() => js("!document.querySelector('.selection-actions')"));
    await click(".file-name");
    await waitFor(() => Promise.resolve(requests.at(-1) === "/示例文件夹"));
    const mouseHistory = async (button) => {
      const cancelled = await js(`(() => {
        const target=document.querySelector('.file-table') || document.body;
        target.dispatchEvent(new MouseEvent('mousedown',{button:${button},bubbles:true,cancelable:true}));
        const event=new MouseEvent('mouseup',{button:${button},bubbles:true,cancelable:true});
        target.dispatchEvent(event); return event.defaultPrevented;
      })()`);
      assert.equal(
        cancelled,
        true,
        "Side mouse navigation must replace browser history",
      );
    };
    const chromiumMouseHistory = async (button) => {
      // Drive Chromium's real side-button default action as well as DOM events.
      const debuggerClient = mainWindow.webContents.debugger;
      debuggerClient.attach("1.3");
      try {
        for (const type of ["mousePressed", "mouseReleased"])
          await debuggerClient.sendCommand("Input.dispatchMouseEvent", {
            type,
            x: 350,
            y: 300,
            button,
            buttons: type === "mousePressed" ? (button === "back" ? 8 : 16) : 0,
            clickCount: 1,
          });
      } finally {
        debuggerClient.detach();
      }
    };
    await mouseHistory(3);
    await waitFor(() => Promise.resolve(requests.at(-1) === "/"));
    await mouseHistory(4);
    await waitFor(() => Promise.resolve(requests.at(-1) === "/示例文件夹"));
    let prevented = false;
    mainWindow.emit(
      "app-command",
      {
        preventDefault() {
          prevented = true;
        },
      },
      "browser-backward",
    );
    assert.equal(prevented, true);
    await waitFor(() => Promise.resolve(requests.at(-1) === "/"));
    mainWindow.emit("app-command", { preventDefault() {} }, "browser-forward");
    await waitFor(() => Promise.resolve(requests.at(-1) === "/示例文件夹"));
    await click('[title="后退"]');
    await waitFor(() => Promise.resolve(requests.at(-1) === "/"));
    await click('[title="前进"]');
    await waitFor(() => Promise.resolve(requests.at(-1) === "/示例文件夹"));
    assert.equal(
      await js("document.querySelector('[title=\"前进\"]').disabled"),
      true,
    );
    await click('[title="后退"]');
    await waitFor(() => Promise.resolve(requests.at(-1) === "/"));
    assert.equal(await js("!!document.querySelector('.file-sidebar')"), false);
    assert.equal(
      await js("!!document.querySelector('.floating-panel')"),
      false,
    );
    const metrics = await js(
      "({row:document.querySelector('.file-table tbody tr').getBoundingClientRect().height,header:document.querySelector('.file-table th').getBoundingClientRect().height})",
    );
    assert.equal(metrics.row, 56);
    assert.equal(metrics.header, 48);
    assert.ok(
      await js(
        "(() => {const table=document.querySelector('.file-table').getBoundingClientRect();const date=document.querySelector('.file-table th.date-cell').getBoundingClientRect();return Math.abs(date.width-Math.max(table.width*0.12,140))<2;})()",
      ),
      "Date column must reserve its minimum width without displacing the filename column",
    );
    const bounds = mainWindow.getBounds();
    mainWindow.setSize(1000, 640);
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(
      (await js("innerWidth")) <= 1010,
      "Check the minimum supported window, allowing DPI rounding",
    );
    assert.equal(
      await js("document.documentElement.scrollWidth > innerWidth"),
      false,
    );
    await fs.writeFile(
      path.join(output, "desktop-files-compact.png"),
      (await mainWindow.webContents.capturePage()).toPNG(),
    );
    mainWindow.setBounds(bounds);
    mainWindow.webContents.send("desktop:event", {
      type: "navigate",
      route: "/transfers",
    });
    await waitFor(() => js("location.hash === '#/transfers'"));
    // With the back toolbar button disabled, side-back must stay on this page.
    await chromiumMouseHistory("back");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await js("location.hash"), "#/transfers");
    assert.equal(
      await js("document.querySelector('[title=\"前进\"]').disabled"),
      false,
      "Directory history survives switching pages",
    );
    await chromiumMouseHistory("forward");
    await waitFor(() =>
      js(
        "location.hash === '#/files' && document.querySelector('.breadcrumb').textContent.includes('示例文件夹')",
      ),
    );
    mainWindow.webContents.send("desktop:event", {
      type: "navigate",
      route: "/transfers",
    });
    await waitFor(() => js("location.hash === '#/transfers'"));
    await js(`(() => {
      const input=document.querySelector('#header-search input');
      input.value='跨页搜索验证'; input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));
    })()`);
    await waitFor(() => Promise.resolve(searches.includes("跨页搜索验证")));
    assert.equal(await js("location.hash"), "#/files");
    assert.equal(
      await js("document.querySelector('#header-search input').value"),
      "跨页搜索验证",
    );
    mainWindow.webContents.send("desktop:event", {
      type: "navigate",
      route: "/transfers",
    });
    await waitFor(() => js("location.hash === '#/transfers'"));
    assert.equal(
      await js("document.querySelector('#header-search input').value"),
      "跨页搜索验证",
    );
    await chromiumMouseHistory("back");
    await waitFor(() =>
      js(
        "location.hash === '#/files' && document.querySelector('#header-search input').value === ''",
      ),
    );
  } finally {
    backend.request = original;
    mainWindow.webContents.send("desktop:event", { type: "logged-out" });
  }
};
