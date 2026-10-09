import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Offline exports only; no image conversion is performed by the website.
const root = new URL('../public/', import.meta.url);
const source = readFileSync(new URL('favicon.svg', root));
const png = size => sharp(source, { density: 384 }).resize(size, size).png().toBuffer();
for (const [name, size] of [['favicon-96.png', 96], ['apple-touch-icon.png', 180]]) {
  const bytes = await png(size);
  writeFileSync(new URL(name, root), name === 'apple-touch-icon.png'
    ? await sharp(bytes).flatten({ background: '#ac6246' }).png().toBuffer()
    : bytes);
}

// ICO directory with PNG frames, preserving clarity at each native tab size.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  header[entry] = sizes[i];
  header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frames[i].length;
}
writeFileSync(new URL('favicon.ico', root), Buffer.concat([header, ...frames]));
console.log('Site icons exported from ' + fileURLToPath(new URL('favicon.svg', root)));
