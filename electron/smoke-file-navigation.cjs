const assert = require("node:assert/strict");

exports.run = async ({ mainWindow, requests }) => {
  const js = (code) => mainWindow.webContents.executeJavaScript(code);
  const click = (selector) =>
    js(`document.querySelector(${JSON.stringify(selector)}).click()`);
  async function waitFor(code) {
    for (let i = 0; i < 100; i++) {
      if (await js(code)) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw Error("File navigation check timed out: " + code);
  }
  const count = requests.length;
  await click(".file-table tbody tr:first-child .ant-checkbox-input");
  await waitFor(
    "document.querySelectorAll('.file-table tr.selected').length === 1",
  );
  await click(".file-table tbody tr:first-child .file-name-content");
  await waitFor(
    "document.querySelectorAll('.file-table tr.selected').length === 0",
  );
  await click(".file-table tbody tr:nth-child(2) .file-name");
  await waitFor(
    "document.querySelector('.file-table tbody tr:nth-child(2)').classList.contains('selected')",
  );
  assert.equal(
    requests.length,
    count,
    "Checkbox, row blank space and regular file names only select",
  );
  const geometry = await js(
    "(() => {const button=document.querySelector('.file-name').getBoundingClientRect();const cell=document.querySelector('.file-name-content').getBoundingClientRect();return {button:button.width,cell:cell.width};})()",
  );
  assert.ok(
    geometry.button < geometry.cell - 30,
    "Short directory name must not consume the row's blank selection area",
  );
  await js(
    "document.querySelector('.file-name > span:last-child').dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}))",
  );
  await waitFor(
    "document.querySelector('.breadcrumb')?.textContent.includes('示例文件夹') && !document.querySelector('.ant-spin-spinning')",
  );
  assert.equal(requests.at(-1), "/示例文件夹");
  assert.equal(
    requests.length,
    count + 1,
    "Single name click loads the folder exactly once",
  );
  assert.equal(
    await js("document.querySelectorAll('.file-table tr.selected').length"),
    0,
  );
  // A rapid second click can hit a new folder rendered at the same position.
  await js(
    "(() => {const e=document.querySelector('.file-name > span:last-child');e.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));e.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));})()",
  );
  assert.equal(
    requests.length,
    count + 1,
    "Double-click must not enter a second directory",
  );
  await click('[title="后退"]');
  await waitFor(
    "!document.querySelector('.breadcrumb')?.textContent.includes('示例文件夹') && !document.querySelector('.ant-spin-spinning')",
  );
  assert.equal(requests.at(-1), "/");
  await click('[title="前进"]');
  await waitFor(
    "document.querySelector('.breadcrumb')?.textContent.includes('示例文件夹') && !document.querySelector('.ant-spin-spinning')",
  );
  assert.equal(requests.at(-1), "/示例文件夹");
  // Side mouse back follows the same directory history.
  await js(
    "document.querySelector('.file-table').dispatchEvent(new MouseEvent('mouseup',{button:3,bubbles:true,cancelable:true}))",
  );
  await waitFor(
    "!document.querySelector('.breadcrumb')?.textContent.includes('示例文件夹') && !document.querySelector('.ant-spin-spinning')",
  );
  assert.equal(requests.at(-1), "/");
};
