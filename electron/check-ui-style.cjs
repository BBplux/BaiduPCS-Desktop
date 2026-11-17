// Narrow visual checks against the audited Windows personal-client styles.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function capture(window, file) {
  await window.webContents.executeJavaScript(
    "document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))",
  );
  await delay(250);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, (await window.webContents.capturePage()).toPNG());
}
exports.files = async ({ mainWindow: window, output, sortRequests }) => {
  const js = (code) => window.webContents.executeJavaScript(code);
  const original = window.getBounds();
  window.focus();
  window.webContents.focus();
  window.webContents.debugger.attach("1.3");
  const cdp = (name, args) =>
    window.webContents.debugger.sendCommand(name, args);
  await cdp("DOM.enable");
  await cdp("CSS.enable");
  async function force(selector, pseudoClasses) {
    const { root } = await cdp("DOM.getDocument");
    const { nodeId } = await cdp("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    await cdp("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: pseudoClasses,
    });
  }
  try {
    await delay(3200);
    const metrics = await js(`(() => {
      const rect=s=>document.querySelector(s).getBoundingClientRect();
      const style=s=>getComputedStyle(document.querySelector(s));
      return { toolbarHeight:rect('.file-toolbar .ant-btn').height,
        switchWidth:rect('.view-switch').width, switchHeight:rect('.view-switch').height,
        railWidth:rect('.rail').width, railGap:style('.rail-item').gap,
        secondaryColor:style('.file-toolbar .ant-btn-default').color };
    })()`);
    assert.equal(metrics.toolbarHeight, 36);
    assert.equal(metrics.switchWidth, 60);
    assert.equal(metrics.switchHeight, 26);
    assert.equal(metrics.railWidth, 64);
    assert.equal(metrics.railGap, "3px");
    assert.equal(metrics.secondaryColor, "rgb(3, 11, 26)");
    await capture(window, path.join(output, "ui-audit-files.png"));
    for (const [state, expected] of [
      ["hover", "rgb(245, 247, 250)"],
      ["active", "rgb(241, 243, 248)"],
    ]) {
      await force(".file-toolbar .ant-btn-default", [state]);
      await delay(350);
      const actual = await js(
        "(()=>{const s=getComputedStyle(document.querySelector('.file-toolbar .ant-btn-default'));return [s.color,s.borderTopColor,s.backgroundColor]})()",
      );
      assert.deepEqual(actual, [
        "rgb(3, 11, 26)",
        "rgb(232, 235, 242)",
        expected,
      ]);
      await capture(window, path.join(output, `ui-audit-button-${state}.png`));
    }
    await force(".file-toolbar .ant-btn-default", []);
    await js("document.querySelector('[title=排序]').click()");
    await delay(350);
    assert.equal(
      await js(
        "Math.round(document.querySelector('.file-sort-dropdown .ant-dropdown-menu').getBoundingClientRect().width)",
      ),
      140,
    );
    await capture(window, path.join(output, "ui-audit-sort.png"));
    assert.equal(
      await js(
        "getComputedStyle(document.querySelector('.file-sort-dropdown .ant-dropdown-menu-item-selected')).color",
      ),
      "rgb(3, 11, 26)",
    );
    assert.equal(
      await js(
        "document.querySelectorAll('.file-sort-dropdown .sort-option img').length",
      ),
      2,
    );
    await js(
      "[...document.querySelectorAll('.file-sort-dropdown .ant-dropdown-menu-item')].find(e=>e.textContent.includes('倒序')).click()",
    );
    await delay(250);
    assert.deepEqual(sortRequests.at(-1), ["name", "true"]);
    await js("document.querySelector('[title=排序]').click()");
    await delay(250);
    await js(
      "[...document.querySelectorAll('.file-sort-dropdown .ant-dropdown-menu-item')].find(e=>e.textContent.includes('按文件大小')).click()",
    );
    await delay(250);
    assert.deepEqual(
      sortRequests.at(-1),
      ["size", "true"],
      "Changing the sort field preserves its direction",
    );
    await js("document.querySelector('[title=网格视图]').click()");
    await delay(350);
    assert.equal(await js("document.querySelectorAll('.file-card').length"), 3);
    await capture(window, path.join(output, "ui-audit-grid.png"));
    window.setSize(960, 680);
    await delay(350);
    assert.ok(
      await js(
        "document.querySelector('.file-toolbar').scrollWidth <= document.querySelector('.file-toolbar').clientWidth",
      ),
    );
    await capture(window, path.join(output, "ui-audit-compact.png"));
    await js("document.querySelector('[title=列表视图]').click()");
    await fs.writeFile(
      path.join(output, "ui-audit-files.json"),
      JSON.stringify({ passed: true, metrics }, null, 2),
    );
  } finally {
    window.webContents.debugger.detach();
    window.setBounds(original);
  }
};
exports.settings = async (window) => {
  const js = (code) => window.webContents.executeJavaScript(code);
  const metrics = await js(`(() => {
    const rect=s=>document.querySelector(s).getBoundingClientRect();
    const style=s=>getComputedStyle(document.querySelector(s));
    return { navWidth:rect('.preferences-nav').width, itemWidth:rect('.preferences-nav button').width,
      titleTop:rect('.preferences-content h2').top, titleLeft:rect('.preferences-content h2').left,
      captionSize:style('.preferences-caption h1').fontSize,
      drag:style('.preferences-caption').getPropertyValue('-webkit-app-region'),
      closeDrag:style('.preferences-caption button').getPropertyValue('-webkit-app-region'),
      officialIcons:document.querySelectorAll('.preferences-nav [data-official-src]').length };
  })()`);
  assert.equal(metrics.navWidth, 160);
  assert.equal(metrics.itemWidth, 136);
  assert.equal(metrics.titleTop, 40);
  assert.equal(metrics.titleLeft, 224);
  assert.equal(metrics.captionSize, "18px");
  assert.equal(metrics.drag, "drag");
  assert.equal(metrics.closeDrag, "no-drag");
  assert.equal(metrics.officialIcons, 3);
  await capture(window, "artifacts/ui-audit-settings-startup.png");
  await js("document.querySelectorAll('.preferences-nav button')[1].click()");
  await delay(200);
  assert.ok(
    await js(
      "(()=>{const e=document.querySelector('.path-field');return e.scrollWidth<=e.clientWidth})()",
    ),
    "Download path controls fit",
  );
  await capture(window, "artifacts/ui-audit-settings-transfer.png");
  await js("document.querySelectorAll('.preferences-nav button')[2].click()");
  await capture(window, "artifacts/ui-audit-settings-about.png");
  await fs.writeFile(
    "artifacts/ui-audit-settings.json",
    JSON.stringify(
      { passed: true, metrics, nativeDragVerified: false },
      null,
      2,
    ),
  );
};

exports.floating = async (window) => {
  while (window.webContents.isLoading()) await delay(30);
  window.showInactive();
  window.webContents.send("desktop:event", {
    type: "backend",
    status: { state: "ready", connection: "websocket" },
  });
  window.webContents.send("desktop:event", { type: "tasks", tasks: [] });
  await delay(400);
  const js = (code) => window.webContents.executeJavaScript(code);
  const metrics = await js(`(() => {
    const panel=document.querySelector('.floating-panel'), idle=document.querySelector('.floating-idle');
    return { width:panel.getBoundingClientRect().width, height:panel.getBoundingClientRect().height,
      idleFont:getComputedStyle(idle).fontSize, idleWeight:getComputedStyle(idle).fontWeight,
      overflow:panel.scrollWidth>panel.clientWidth };
  })()`);
  assert.equal(metrics.width, 160);
  assert.equal(metrics.height, 40);
  assert.equal(metrics.idleFont, "13px");
  assert.equal(metrics.idleWeight, "600");
  assert.equal(metrics.overflow, false);
  await capture(window, "artifacts/ui-audit-floating-idle.png");
  window.webContents.send("desktop:event", {
    type: "tasks",
    tasks: [
      {
        id: "style-download",
        kind: "download",
        status: "downloading",
        speed: 1048576,
      },
      {
        id: "style-upload",
        kind: "upload",
        status: "uploading",
        speed: 524288,
      },
    ],
  });
  await delay(200);
  assert.ok(
    await js(
      "document.querySelector('.floating-speeds').textContent.includes('/s')",
    ),
  );
  assert.ok(
    await js(
      "(()=>{const p=document.querySelector('.floating-panel');return p.scrollWidth<=p.clientWidth})()",
    ),
  );
  await capture(window, "artifacts/ui-audit-floating-speeds.png");
  await fs.writeFile(
    "artifacts/ui-audit-floating.json",
    JSON.stringify({ passed: true, metrics }, null, 2),
  );
};
