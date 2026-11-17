const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
// Compare a short filename against the same glyphs without overflow clipping.
// Horizontal ellipsis is tested elsewhere; this detects genuinely missing ink.
exports.checkFilenameInk = async (window, selector, output, name) => {
  const js = (code) => window.webContents.executeJavaScript(code);
  // A trailing no-break space keeps right-side glyph overhang out of this
  // vertical-clipping check without changing the line's baseline or height.
  const sample = "gjpqy\u00a0";
  const original = await js(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)}); const s=getComputedStyle(e);const r=e.getBoundingClientRect();const before={text:e.textContent,style:e.getAttribute('style')};e.textContent=${JSON.stringify(sample)};return {before,font:s.font,lineHeight:s.lineHeight,rect:{x:Math.floor(r.x)-4,y:Math.floor(r.y)-6,width:Math.ceil(r.width)+8,height:Math.ceil(r.height)+12}}})()`,
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
    const clipped = await capture("-clipped");
    await js(
      `document.querySelector(${JSON.stringify(selector)}).style.overflow='visible'`,
    );
    const reference = await capture("-reference");
    assert.ok(
      clipped.equals(reference),
      `${name}: filename clips glyph pixels (${original.font}; line-height ${original.lineHeight})`,
    );
  } finally {
    await js(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.textContent=${JSON.stringify(original.before.text)};const style=${JSON.stringify(original.before.style)};if(style===null)e.removeAttribute('style');else e.setAttribute('style',style);})()`,
    );
  }
};
