const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async ({ mainWindow: window, backend, output }) => {
  const js = (code) => window.webContents.executeJavaScript(code);
  const request = backend.request;
  const deletes = [];
  let resolveDelete, rejectDelete;
  backend.request = async function (endpoint, method, payload) {
    if (endpoint === "/files/delete") {
      deletes.push({ method, paths: [...payload.paths] });
      return new Promise((resolve, reject) => {
        resolveDelete = resolve;
        rejectDelete = reject;
      });
    }
    return request.call(this, endpoint, method, payload);
  };
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function waitFor(code) {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await delay(30);
    }
    throw Error("File delete dialog timed out: " + code);
  }
  const isVisible =
    "!!document.querySelector('.file-delete-modal')?.getBoundingClientRect().width";
  async function open() {
    await click('.selection-actions [title="删除"]');
    await waitFor(isVisible);
    await delay(450);
  }
  try {
    await delay(3200);
    await click(".file-table tbody tr:first-child input[type=checkbox]");
    await click(".file-table tbody tr:nth-child(2) input[type=checkbox]");
    await open();
    assert.equal(deletes.length, 0, "Opening the dialog must not delete");
    const geometry = await js(`(() => {
      const el=document.querySelector('.file-delete-modal .ant-modal-content');
      const r=el.getBoundingClientRect();
      const btns=[...el.querySelectorAll('.file-delete-actions button')];
      return {rect:{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)},
        title:el.querySelector('.file-delete-title').textContent.trim(),
        message:el.querySelector('.file-delete-message').textContent.trim(),
        labels:btns.map(b=>b.textContent.trim()),
        buttons:btns.map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})),
        radius:getComputedStyle(el).borderRadius,
        iconWidth:el.querySelector('.file-delete-title img').getBoundingClientRect().width};
    })()`);
    console.log("File delete dialog geometry", JSON.stringify(geometry));
    assert.equal(geometry.rect.width, 360);
    assert.equal(geometry.rect.height, 156);
    assert.equal(geometry.title, "确定删除文件？");
    assert.equal(geometry.message, "删除后，可在回收站中找回删除的文件。");
    assert.deepEqual(geometry.labels, ["取消", "删除"]);
    assert.deepEqual(geometry.buttons, [
      { width: 88, height: 32 },
      { width: 88, height: 32 },
    ]);
    assert.equal(geometry.iconWidth, 20);
    assert.equal(geometry.radius, "12px");
    await fs.writeFile(
      path.join(output, "file-delete-dialog.png"),
      (await window.webContents.capturePage(geometry.rect)).toPNG(),
    );
    await click(".file-delete-cancel");
    await waitFor("!(" + isVisible + ")");
    assert.equal(deletes.length, 0);
    await open();
    await click(".file-delete-modal .ant-modal-close");
    await waitFor("!(" + isVisible + ")");
    assert.equal(deletes.length, 0);
    await open();
    window.focus();
    window.webContents.focus();
    await js("document.querySelector('.file-delete-cancel').focus()");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await waitFor("!(" + isVisible + ")");
    assert.equal(deletes.length, 0, "Escape cancels without IPC");
    await open();
    await js(
      "document.querySelector('.file-delete-modal').closest('.ant-modal-wrap').click()",
    );
    assert.ok(
      await js(isVisible),
      "Clicking the backdrop does not close confirmation",
    );
    await js(
      "(()=>{const b=document.querySelector('.file-delete-confirm');b.click();b.click();})()",
    );
    await waitFor(
      "!!document.querySelector('.file-delete-confirm.ant-btn-loading')",
    );
    assert.deepEqual(deletes, [
      { method: "POST", paths: ["/示例文件夹", "/界面验证文档.pdf"] },
    ]);
    assert.ok(
      await js("document.querySelector('.file-delete-cancel').disabled"),
    );
    assert.equal(
      await js(
        "!!document.querySelector('.file-delete-modal .ant-modal-close')",
      ),
      false,
    );
    rejectDelete(Error("模拟删除失败，可重试"));
    await waitFor(
      "!document.querySelector('.file-delete-confirm.ant-btn-loading')",
    );
    assert.ok(await js(isVisible), "Failure preserves the dialog for retry");
    await click(".file-delete-confirm");
    await waitFor(
      "!!document.querySelector('.file-delete-confirm.ant-btn-loading')",
    );
    assert.equal(deletes.length, 2);
    resolveDelete({ failed_paths: [] });
    await waitFor("!(" + isVisible + ")");
    assert.equal(
      await js("document.querySelectorAll('.file-table tr.selected').length"),
      0,
    );
    await fs.writeFile(
      path.join(output, "file-delete-dialog-result.json"),
      JSON.stringify(
        {
          passed: true,
          geometry,
          checks: [
            "cancel/close/Escape do not delete",
            "backdrop preserves dialog",
            "confirm sends captured selection once",
            "busy state prevents duplicates",
            "failure retry",
            "successful close",
          ],
        },
        null,
        2,
      ),
    );
    console.log(
      "File delete dialog display and mocked confirmation checks passed",
    );
  } finally {
    backend.request = request;
  }
};
