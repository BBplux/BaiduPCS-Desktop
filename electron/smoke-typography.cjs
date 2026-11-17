const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
// Compare a short filename against the same glyphs without overflow clipping.
// Horizontal ellipsis is tested elsewhere; this detects genuinely missing ink.
exports.checkFilenameInk = async (window, selector, output, name) => {
  const js = (code) => window.webContents.executeJavaScript(code);
  // No-break spaces keep horizontal glyph overhang out of this
  // vertical-clipping check without changing the line's baseline or height.
  const sample = "\u00a0gjpqy\u00a0";
  const original = await js(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)}); const s=getComputedStyle(e);const before={text:e.textContent,style:e.getAttribute('style')};e.textContent=${JSON.stringify(sample)};const r=e.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(e);return {before,font:s.font,lineHeight:s.lineHeight,wholeSampleFits:range.getBoundingClientRect().width<=e.clientWidth+0.5,rect:{x:Math.floor(r.x)-4,y:Math.floor(r.y)-6,width:Math.ceil(r.width)+8,height:Math.ceil(r.height)+12}}})()`,
  );
  async function capture(suffix) {
    await js(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    // On Windows, capturePage can return the previous compositor frame even
    // after the renderer's animation frames have run.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const image = await window.webContents.capturePage(original.rect);
    await fs.writeFile(
      path.join(output, name + suffix + ".png"),
      image.toPNG(),
    );
    return image.toBitmap();
  }
  try {
    // Narrow CI viewports can legitimately ellipsize the combined sample.
    // Test individual descenders there so horizontal truncation cannot masquerade
    // as missing vertical ink. Keep the original font, line-height and overflow.
    const samples = original.wholeSampleFits
      ? [sample]
      : [..."gjpqy"].map((glyph) => "\u00a0" + glyph + "\u00a0");
    for (const [index, text] of samples.entries()) {
      await js(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const style=${JSON.stringify(original.before.style)};if(style===null)e.removeAttribute('style');else e.setAttribute('style',style);e.textContent=${JSON.stringify(text)};})()`,
      );
      const suffix = samples.length === 1 ? "" : `-${index}`;
      const clipped = await capture(suffix + "-clipped");
      await js(
        `document.querySelector(${JSON.stringify(selector)}).style.overflow='visible'`,
      );
      const reference = await capture(suffix + "-reference");
      assert.ok(
        clipped.equals(reference),
        `${name}: filename clips glyph pixels (${original.font}; line-height ${original.lineHeight})`,
      );
    }
  } finally {
    await js(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.textContent=${JSON.stringify(original.before.text)};const style=${JSON.stringify(original.before.style)};if(style===null)e.removeAttribute('style');else e.setAttribute('style',style);})()`,
    );
  }
};
