import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Edit these grid / palette rules, never the generated SVGs or CSS tokens.
// Generate: node scripts/build-pixel-ui.mjs
// Verify committed output without writing: node scripts/build-pixel-ui.mjs --check
const OUTPUT = fileURLToPath(new URL('../public/pixel-ui/', import.meta.url));
const PALETTES = {
  cream: { outline: '#753843', highlight: '#FFF1D9', surface: '#FFF6E9', shadow: '#D2AE97' },
  berry: { outline: '#753843', highlight: '#E8B1B1', surface: '#C8838D', shadow: '#A86373' },
  gold: { outline: '#753843', highlight: '#FFECB8', surface: '#D8AF70', shadow: '#B9854F' },
  linen: { outline: '#DDB8A5', highlight: '#FFFCF4', surface: '#FFF6E9', shadow: '#E6C4B2' },
};
const STATES = ['normal', 'pressed', 'selected', 'disabled'];
const KINDS = {
  button: { width: 20, height: 20, slice: 4 },
  plus: { width: 12, height: 12, slice: 3 },
  panel: { width: 24, height: 24, slice: 6 },
  segment: { width: 12, height: 12, slice: 3 },
  rail: { width: 20, height: 20, slice: 4 },
};
const SCHEMA = 'jigsaw-nook/pixel-ui/v1';
const SCALE = [1, 2];
const BUTTON_CORNER_OFFSETS = [4, 4, 2, 2];

function blend(color, target, amount) {
  const parts = [1, 3, 5].map(offset => Math.round(
    parseInt(color.slice(offset, offset + 2), 16) * (1 - amount)
    + parseInt(target.slice(offset, offset + 2), 16) * amount,
  ).toString(16).padStart(2, '0'));
  return ('#' + parts.join('')).toUpperCase();
}

function colorsFor(palette, state) {
  const c = PALETTES[palette];
  if (state === 'pressed') return {
    outline: c.outline,
    highlight: c.shadow,
    surface: blend(c.surface, c.outline, 0.12),
    shadow: c.highlight,
  };
  if (state === 'selected') return {
    outline: '#602C3B',
    highlight: blend(c.highlight, '#FFF8E9', 0.3),
    surface: blend(c.surface, '#FFF8E9', 0.08),
    shadow: blend(c.shadow, '#783745', 0.12),
  };
  if (state === 'disabled') return {
    outline: '#AA8384',
    highlight: '#F5E7D6',
    surface: blend(c.surface, '#F6E9DC', 0.58),
    shadow: blend(c.shadow, '#E3CDBE', 0.6),
  };
  return { ...c };
}

// Buttons retain their 4px source cap and center colors; only the rim is shaded.
function buttonColorsFor(palette, state) {
  const colors = colorsFor(palette, state);
  const disabled = state === 'disabled';
  return {
    ...colors,
    highlight: state === 'pressed'
      ? blend(colors.highlight, colors.surface, 0.35)
      : blend(colors.highlight, '#FFFFFF', disabled ? 0.18 : 0.5),
    shadow: state === 'pressed'
      ? blend(colors.shadow, '#FFFFFF', 0.5)
      : blend(colors.shadow, colors.surface, disabled ? 0.65 : 0.35),
    edgeDepth: blend(colors.outline, state === 'pressed' ? PALETTES[palette].shadow : colors.shadow, disabled ? 0.6 : 0.35),
  };
}

function buttonPixels({ width, height, slice }, colors) {
  const pixels = Array.from({ length: height }, () => Array(width).fill(null));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = Math.min(x, width - 1 - x), dy = Math.min(y, height - 1 - y);
    const left = x < width / 2, top = y < height / 2;
    let color;
    if (dx < slice && dy < slice) {
      if (dx < BUTTON_CORNER_OFFSETS[dy]) continue;
      // The inner bevel pixel turns with the 2px corner step. The bottom-right
      // turn continues the extra dark depth row, without changing the alpha mask.
      color = dx === slice - 1 && dy === slice - 1
        ? (top || left ? colors.highlight : colors.edgeDepth)
        : colors.outline;
    } else if (dy < slice) {
      color = dy < 2 ? colors.outline
        : top ? (dy === 2 ? colors.highlight : colors.surface)
        : dy === 2 ? colors.edgeDepth : colors.shadow;
    } else if (dx < slice) {
      color = dx < 2 ? colors.outline
        : left ? (dx === 2 ? colors.highlight : colors.surface)
        : dx === 2 ? colors.edgeDepth : colors.shadow;
    } else color = colors.surface;
    pixels[y][x] = color;
  }
  return pixels;
}

// A source pixel is one square cell. Edge strips are constant along their
// repeat axis. Corner shading is completely contained inside the cap square.
function framePixels({ width, height, slice }, colors) {
  const pixels = Array.from({ length: height }, () => Array(width).fill(null));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = Math.min(x, width - 1 - x);
    const dy = Math.min(y, height - 1 - y);
    const left = x < width / 2, top = y < height / 2;
    const inXCap = dx < slice, inYCap = dy < slice;
    let color;
    if (inXCap && inYCap) {
      const distance = dx + dy - (slice - 1);
      if (distance < 0) continue;
      if (distance < 2) color = colors.outline;
      else if (distance === 2) {
        const lit = left && top || top && !left && dy <= dx || left && !top && dx <= dy;
        color = lit ? colors.highlight : colors.shadow;
      } else color = colors.surface;
    } else if (inYCap) {
      color = dy < 2 ? colors.outline : dy === 2 ? (top ? colors.highlight : colors.shadow) : colors.surface;
    } else if (inXCap) {
      color = dx < 2 ? colors.outline : dx === 2 ? (left ? colors.highlight : colors.shadow) : colors.surface;
    } else color = colors.surface;
    pixels[y][x] = color;
  }
  return pixels;
}

// Merge equal horizontal runs on adjacent rows. No path transform, stroke,
// fractional coordinate, opacity, filter or interpolation is used.
function rectanglesFor(pixels) {
  const output = [];
  let active = new Map();
  for (let y = 0; y < pixels.length; y++) {
    const next = new Map();
    for (let x = 0; x < pixels[y].length;) {
      const color = pixels[y][x], start = x;
      while (x < pixels[y].length && pixels[y][x] === color) x++;
      if (!color) continue;
      const width = x - start, key = [start, width, color].join(':');
      const previous = active.get(key);
      const rect = previous || { x: start, y, width, height: 0, color };
      rect.height++;
      next.set(key, rect);
      if (!previous) output.push(rect);
    }
    active = next;
  }
  return output.sort((a, b) => a.y - b.y || a.x - b.x || a.height - b.height);
}

function rectMarkup(rect) {
  return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${rect.color}"/>`;
}

function svgFor(asset) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}" viewBox="0 0 ${asset.width} ${asset.height}" shape-rendering="crispEdges">\n<title>${asset.id}</title>\n${asset.rectangles.map(rectMarkup).join('\n')}\n</svg>\n`;
}

function nineSlices({ width, height, slice: s }) {
  return {
    topLeft: { x: 0, y: 0, width: s, height: s },
    top: { x: s, y: 0, width: width - 2 * s, height: s },
    topRight: { x: width - s, y: 0, width: s, height: s },
    left: { x: 0, y: s, width: s, height: height - 2 * s },
    center: { x: s, y: s, width: width - 2 * s, height: height - 2 * s },
    right: { x: width - s, y: s, width: s, height: height - 2 * s },
    bottomLeft: { x: 0, y: height - s, width: s, height: s },
    bottom: { x: s, y: height - s, width: width - 2 * s, height: s },
    bottomRight: { x: width - s, y: height - s, width: s, height: s },
  };
}

function repeatTiles({ width, height, slice: s }) {
  return {
    top: { x: s, y: 0, width: 1, height: s, repeat: 'x' },
    bottom: { x: s, y: height - s, width: 1, height: s, repeat: 'x' },
    left: { x: 0, y: s, width: s, height: 1, repeat: 'y' },
    right: { x: width - s, y: s, width: s, height: 1, repeat: 'y' },
    center: { x: s, y: s, width: 1, height: 1, repeat: 'both' },
  };
}

function segmentColorsFor(palette, state) {
  const colors = colorsFor(palette, state);
  return {
    outline: colors.surface,
    surface: colors.surface,
    highlight: colors.surface,
    shadow: colors.surface,
  };
}

function railColorsFor(palette, state) {
  const colors = colorsFor(palette, state);
  return { ...colors, highlight: colors.surface, shadow: colors.surface, edgeDepth: colors.surface };
}

function makeAsset(kind, palette, state = 'normal') {
  const geometry = KINDS[kind], colors = kind === 'button' ? buttonColorsFor(palette, state)
    : kind === 'segment' ? segmentColorsFor(palette, state)
    : kind === 'rail' ? railColorsFor(palette, state) : colorsFor(palette, state);
  const id = kind === 'panel' ? `panel-${palette}` : `${kind}-${palette}-${state}`;
  const pixels = kind === 'button' || kind === 'rail' ? buttonPixels(geometry, colors) : framePixels(geometry, colors);
  return { id, file: id + '.svg', kind, ...geometry, palette, state, colors, pixels, rectangles: rectanglesFor(pixels) };
}

function validateAsset(asset) {
  const { width, height, slice, colors, pixels, rectangles } = asset;
  assert(Number.isInteger(slice) && slice >= 3 && slice * 2 < width && slice * 2 < height);
  const validColors = new Set(Object.values(colors));
  const reconstructed = Array.from({ length: height }, () => Array(width).fill(null));
  for (const r of rectangles) {
    for (const value of [r.x, r.y, r.width, r.height]) assert(Number.isInteger(value));
    assert(r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= width && r.y + r.height <= height);
    assert(validColors.has(r.color));
    for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) {
      assert.equal(reconstructed[y][x], null, 'Overlapping source pixels: ' + asset.id);
      reconstructed[y][x] = r.color;
    }
  }
  assert.deepEqual(reconstructed, pixels, 'Rectangles must exactly reproduce the integer pixel grid');

  const coverage = Array.from({ length: height }, () => Array(width).fill(0));
  for (const r of Object.values(nineSlices(asset))) {
    for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) coverage[y][x]++;
  }
  assert(coverage.every(row => row.every(count => count === 1)), 'Nine slices must partition the entire source');

  // Every edge can tile at a one-source-pixel period without a seam or stretch.
  for (let x = slice; x < width - slice; x++) for (let y = 0; y < height; y++) assert.equal(pixels[y][x], pixels[y][slice]);
  for (let y = slice; y < height - slice; y++) for (let x = 0; x < width; x++) assert.equal(pixels[y][x], pixels[slice][x]);
  for (let x = slice; x < width - slice; x++) {
    assert.equal(pixels[0][x], colors.outline); assert.equal(pixels[1][x], colors.outline);
    assert.equal(pixels[2][x], colors.highlight);
    assert.equal(pixels[height - 1][x], colors.outline); assert.equal(pixels[height - 2][x], colors.outline);
    assert.equal(pixels[height - 3][x], asset.kind === 'button' ? colors.edgeDepth : colors.shadow);
    if (asset.kind === 'button') assert.equal(pixels[height - 4][x], colors.shadow);
  }
  for (let y = slice; y < height - slice; y++) {
    assert.equal(pixels[y][0], colors.outline); assert.equal(pixels[y][1], colors.outline);
    assert.equal(pixels[y][2], colors.highlight);
    assert.equal(pixels[y][width - 1], colors.outline); assert.equal(pixels[y][width - 2], colors.outline);
    assert.equal(pixels[y][width - 3], asset.kind === 'button' ? colors.edgeDepth : colors.shadow);
    if (asset.kind === 'button') assert.equal(pixels[y][width - 4], colors.shadow);
  }
  if (asset.kind === 'button') {
    assert.deepEqual([width, height, slice], [20, 20, 4], 'Button geometry must not change layout');
    assert.equal(colors.surface, colorsFor(asset.palette, asset.state).surface, 'Button center colors remain unchanged');
    for (let dy = 0; dy < slice; dy++) for (let dx = 0; dx < slice; dx++) {
      const opaque = dx >= BUTTON_CORNER_OFFSETS[dy];
      for (const [x, y] of [[dx, dy], [width - 1 - dx, dy], [dx, height - 1 - dy], [width - 1 - dx, height - 1 - dy]]) {
        assert.equal(pixels[y][x] !== null, opaque, 'All button corners use the same 2px step mask');
      }
    }
    assert.equal(pixels[3][3], colors.highlight, 'Top-left bevel must turn with its corner');
    assert.equal(pixels[3][width - 4], colors.highlight, 'Top-right bevel must meet the top edge');
    assert.equal(pixels[height - 4][3], colors.highlight, 'Bottom-left bevel must meet the left edge');
    assert.equal(pixels[height - 4][width - 4], colors.edgeDepth, 'Bottom-right corner must meet the dark rim');
    for (let y = slice; y < height - slice; y++) for (let x = slice; x < width - slice; x++) {
      assert.equal(pixels[y][x], colors.surface, 'Center fill must not leak rim shading');
    }
  }
  assert.equal(pixels[0][0], null); assert.equal(pixels[0][width - 1], null);
  assert.equal(pixels[height - 1][0], null); assert.equal(pixels[height - 1][width - 1], null);
}

const assets = [];
for (const kind of ['button', 'plus']) for (const palette of Object.keys(PALETTES)) {
  if (kind === 'plus' && palette === 'linen') continue;
  for (const state of STATES) assets.push(makeAsset(kind, palette, state));
}
for (const palette of ['cream', 'gold']) assets.push(makeAsset('panel', palette));
for (const state of STATES) assets.push(makeAsset('segment', 'berry', state));
assets.push(makeAsset('rail', 'cream'));
for (const asset of assets) validateAsset(asset);
for (const kind of ['button', 'plus', 'segment']) {
  const matching = assets.filter(asset => asset.kind === kind);
  const mask = asset => asset.pixels.map(row => row.map(color => color ? '1' : '0').join('')).join('\n');
  for (const asset of matching) assert.equal(mask(asset), mask(matching[0]), 'States and tones must retain identical geometry');
}
assert.equal(assets.length, 35);

// Surfaces come from the same resolved colors used by the frame pixels.
const surfaceTokens = Object.fromEntries(assets.filter(asset => asset.kind === 'button')
  .map(asset => ['--pixel-surface-' + asset.palette + '-' + asset.state, asset.colors.surface]));
const tokensCss = '/* Generated by scripts/build-pixel-ui.mjs; edit the source palettes, not this file. */\n:root{\n'
  + Object.entries(surfaceTokens).map(([name, value]) => '  ' + name + ':' + value + ';').join('\n') + '\n}\n';

const columns = 4, cell = 32, gutter = 4;
const rows = Math.ceil(assets.length / columns), atlasWidth = columns * cell, atlasHeight = rows * cell;
const manifestAssets = assets.map((asset, index) => ({
  id: asset.id, file: asset.file, kind: asset.kind, width: asset.width, height: asset.height,
  slice: asset.slice, palette: asset.palette, state: asset.state, colors: asset.colors,
  scales: SCALE, pixelUnit: 1,
  outlinePixels: asset.kind === 'button' ? { top: 2, right: 3, bottom: 3, left: 2 } : 2,
  bevelPixels: 1,
  ...(asset.kind === 'button' ? {
    cornerStepPixels: 2, cornerOffsets: BUTTON_CORNER_OFFSETS,
    outlineLayers: { outer: { pixels: 2, color: asset.colors.outline }, bottomRightDepth: { pixels: 1, color: asset.colors.edgeDepth } },
  } : {}),
  nineSlice: nineSlices(asset), repeatTiles: repeatTiles(asset),
  atlas: { x: index % columns * cell + gutter, y: Math.floor(index / columns) * cell + gutter, width: asset.width, height: asset.height },
}));
const manifest = {
  schema: SCHEMA, version: 1, generatedBy: 'scripts/build-pixel-ui.mjs',
  coordinateUnit: 'source-pixel', alpha: 'binary', scalePolicy: 'integer-only',
  allowedScales: SCALE, palettes: PALETTES, states: STATES,
  tokens: { file: 'tokens.css', selector: ':root', surfaces: surfaceTokens },
  atlas: { file: 'atlas.svg', width: atlasWidth, height: atlasHeight, columns, cell, gutter },
  rendering: {
    corners: 'fixed at slice * scale', edges: 'repeat at one source pixel * scale; crop final tile',
    center: 'solid colors.surface or integer repeat', edgeSampling: 'nearest-neighbor',
    forbidden: ['fractional-scale', 'border-image-round', 'edge-stretch', 'whole-frame-transform-scale'],
  },
  assets: manifestAssets,
};
const symbols = assets.map(asset => `<symbol id="${asset.id}" viewBox="0 0 ${asset.width} ${asset.height}">\n${asset.rectangles.map(rectMarkup).join('\n')}\n</symbol>`).join('\n');
const usages = manifestAssets.map(asset => `<use href="#${asset.id}" x="${asset.atlas.x}" y="${asset.atlas.y}" width="${asset.width}" height="${asset.height}"/>`).join('\n');
const atlasSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${atlasWidth}" height="${atlasHeight}" viewBox="0 0 ${atlasWidth} ${atlasHeight}" shape-rendering="crispEdges">\n<title>B2 native pixel UI — four states per row, scale 1</title>\n<defs>\n${symbols}\n</defs>\n${usages}\n</svg>\n`;
const outputs = new Map(assets.map(asset => [asset.file, svgFor(asset)]));
outputs.set('atlas.svg', atlasSvg);
outputs.set('tokens.css', tokensCss);
outputs.set('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
const args = process.argv.slice(2);
assert(args.every(arg => arg === '--check'), 'Only the optional --check argument is supported');
const check = args.includes('--check');
if (!check) await mkdir(OUTPUT, { recursive: true });
for (const [name, expected] of outputs) {
  const path = new URL(name, new URL('../public/pixel-ui/', import.meta.url));
  if (check) assert.equal(await readFile(path, 'utf8'), expected, 'Generated file is stale: ' + name);
  else await writeFile(path, expected, 'utf8');
}
console.log(`${check ? 'Verified' : 'Generated'} ${assets.length} native pixel frames, atlas.svg, tokens.css (${Object.keys(surfaceTokens).length} surfaces) and manifest.json.`);
console.log('Passed: integer geometry, exact dimensions, binary alpha, directional button rim (2px top/left, 3px bottom/right), 2px stepped button corners, 1px bevel, nine-slice coverage, seam-free 1px edge tiles, invariant state geometry.');
