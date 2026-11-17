const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async ({ mainWindow: window, requests, output }) => {
  const js = (code) => window.webContents.executeJavaScript(code);
  const original = window.getBounds();
  async function waitFor(predicate) {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await delay(30);
    }
    throw Error("Breadcrumb navigation timed out");
  }
  async function click(selector) {
    const before = requests.length;
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await waitFor(
      async () =>
        requests.length > before &&
        (await js("!document.querySelector('.ant-spin-spinning')")),
    );
    await delay(60);
  }
  async function capture(name) {
    await delay(250);
    await fs.writeFile(
      path.join(output, name + ".png"),
      (await window.webContents.capturePage()).toPNG(),
    );
  }
  try {
    await click(".file-table tbody tr:first-child .file-name");
    const metrics = await js(`(() => {
      const bar=document.querySelector('.breadcrumb');
      return { height:bar.getBoundingClientRect().height,
        font:getComputedStyle(bar).fontSize,
        border:getComputedStyle(bar).borderTopWidth,
        bottomBorder:getComputedStyle(bar).borderBottomWidth,
        back:!!bar.querySelector('.back-button'), count:!!bar.querySelector('small'),
        arrow:bar.querySelector('.crumb-divider').getBoundingClientRect().width,
        current:bar.querySelector('[aria-current=page]').textContent };
    })()`);
    assert.equal(metrics.height, 38);
    assert.equal(metrics.font, "14px");
    assert.equal(metrics.border, "0px");
    assert.equal(metrics.bottomBorder, "0px");
    assert.equal(metrics.arrow, 12);
    assert.equal(metrics.back, false);
    assert.equal(metrics.count, false);
    assert.equal(metrics.current, "示例文件夹");
    const count = requests.length;
    await js("document.querySelector('.crumb-current').click()");
    await delay(100);
    assert.equal(requests.length, count, "Current folder must not reload");
    await capture("breadcrumb-single");
    if (process.argv.includes("--breadcrumb-style-only")) {
      await fs.writeFile(path.join(output, "breadcrumb-style-result.json"), JSON.stringify({passed:true, metrics}, null, 2));
      console.log("Breadcrumb style check passed");
      return;
    }
    window.setSize(960, 680);
    for (let i = 0; i < 7; i++)
      await click(".file-table tbody tr:first-child .file-name");
    await waitFor(() => js("!!document.querySelector('.crumb-overflow')"));
    assert.equal(
      await js(
        "document.querySelectorAll('.breadcrumb-track > .crumb-ancestor').length",
      ),
      2,
    );
    assert.ok(await js("document.documentElement.scrollWidth<=innerWidth"));
    await capture("breadcrumb-collapsed");
    await js("document.querySelector('.crumb-overflow').click()");
    await waitFor(() =>
      js(
        "!!document.querySelector('.breadcrumb-overflow .ant-dropdown-menu-item')",
      ),
    );
    await capture("breadcrumb-expanded");
    await click(".breadcrumb-overflow .ant-dropdown-menu-item");
    assert.equal(
      requests.at(-1),
      "/示例文件夹",
      "Hidden ancestor navigates to its full path",
    );
    await click(".crumb-root");
    assert.equal(requests.at(-1), "/");
    assert.equal(await js("!!document.querySelector('.breadcrumb')"), false);
    await fs.writeFile(
      path.join(output, "breadcrumb-result.json"),
      JSON.stringify(
        {
          passed: true,
          metrics,
          checks: [
            "current folder no reload",
            "ancestor/root navigation",
            "narrow window collapse",
            "hidden ancestor navigation",
          ],
        },
        null,
        2,
      ),
    );
    console.log("Breadcrumb display and navigation checks passed");
  } finally {
    window.setBounds(original);
  }
};
