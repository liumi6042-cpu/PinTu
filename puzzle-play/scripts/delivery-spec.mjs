// Shared image delivery sizing rules.
// The cap is based on total pixels so portrait, landscape, and square images
// with comparable detail budgets are treated consistently.
export const MAX_DELIVERY_PIXELS = 6_553_600; // 2560 x 2560

/** Return native dimensions when under the cap, otherwise scale proportionally. */
export function deliveryDimensions(width, height, maxPixels = MAX_DELIVERY_PIXELS) {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError('图片尺寸必须是正整数。');
  }
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) throw new RangeError('图片像素上限必须是正整数。');
  if (width * height <= maxPixels) return {width, height};
  const scale = Math.sqrt(maxPixels / (width * height));
  let targetWidth = Math.max(1, Math.floor(width * scale));
  let targetHeight = Math.max(1, Math.floor(height * scale));
  while (targetWidth * targetHeight > maxPixels) {
    if (targetWidth >= targetHeight) targetWidth -= 1;
    else targetHeight -= 1;
  }
  return {width: targetWidth, height: targetHeight};
}
