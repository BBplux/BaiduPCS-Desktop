// Electron screen work areas and window bounds are both device-independent pixels.
function visibleBounds(bounds, displays) {
  const valid =
    bounds &&
    ["x", "y", "width", "height"].every((k) => Number.isFinite(bounds[k])) &&
    bounds.width > 0 &&
    bounds.height > 0;
  const areas = displays.map((d) => d.workArea);
  const area =
    (valid &&
      areas.find(
        (a) =>
          bounds.x < a.x + a.width &&
          bounds.x + bounds.width > a.x &&
          bounds.y < a.y + a.height &&
          bounds.y + bounds.height > a.y,
      )) ||
    areas[0];
  // Default main-window size aligned with the latest client reference.
  const width = Math.min(valid ? bounds.width : 1100, area.width);
  const height = Math.min(valid ? bounds.height : 700, area.height);
  return {
    width,
    height,
    x: Math.round(
      Math.max(
        area.x,
        Math.min(
          valid ? bounds.x : area.x + (area.width - width) / 2,
          area.x + area.width - width,
        ),
      ),
    ),
    y: Math.round(
      Math.max(
        area.y,
        Math.min(
          valid ? bounds.y : area.y + (area.height - height) / 2,
          area.y + area.height - height,
        ),
      ),
    ),
  };
}
module.exports = { visibleBounds };
