#!/usr/bin/env node
/**
 * 產生 src/server/rich-menu-glyphs.generated.ts（#931）。
 *
 * 讀 src/config/modes.ts 內所有 richMenuCells 的 label，用 Noto Sans TC Bold
 * （SIL OFL 1.1）轉成 SVG path，執行期因此不需載入任何字型。
 *
 * 用法：
 *   node scripts/generate-rich-menu-glyphs.mjs [NotoSansTC-Bold.otf 路徑]
 * 未給路徑時從 jsDelivr 下載到系統暫存資料夾。需要 devDependency opentype.js。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_URL = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Bold.otf';
const FONT_SIZE = 100;

const modes = fs.readFileSync(path.join(root, 'src/config/modes.ts'), 'utf8');
const labels = new Set();
for (const block of modes.matchAll(/richMenuCells:\s*\[([\s\S]*?)\]/g)) {
  for (const m of block[1].matchAll(/label:\s*'([^']+)'/g)) labels.add(m[1]);
}
if (labels.size === 0) throw new Error('找不到任何 richMenuCells label');

let fontPath = process.argv[2];
if (!fontPath) {
  fontPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notosanstc-')), 'NotoSansTC-Bold.otf');
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`下載字型失敗：${res.status}`);
  fs.writeFileSync(fontPath, Buffer.from(await res.arrayBuffer()));
}
const buf = fs.readFileSync(fontPath);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const r1 = (n) => Math.round(n * 10) / 10;
const entries = [];
for (const label of [...labels].sort()) {
  const p = font.getPath(label, 0, 0, FONT_SIZE);
  const bb = p.getBoundingBox();
  for (const ch of label) {
    if (!font.charToGlyph(ch) || font.charToGlyph(ch).index === 0) throw new Error(`字型缺字：${ch}（${label}）`);
  }
  // 平移到左上角 (0,0)，座標以 FONT_SIZE=100 為單位
  for (const c of p.commands) {
    for (const k of ['x', 'x1', 'x2']) if (k in c) c[k] = r1(c[k] - bb.x1);
    for (const k of ['y', 'y1', 'y2']) if (k in c) c[k] = r1(c[k] - bb.y1);
  }
  entries.push({ label, d: p.toPathData(1), w: r1(bb.x2 - bb.x1), h: r1(bb.y2 - bb.y1) });
}

const body = entries
  .map((e) => `  ${JSON.stringify(e.label)}: { d: ${JSON.stringify(e.d)}, w: ${e.w}, h: ${e.h} },`)
  .join('\n');

const out = `/**
 * 自動產生，請勿手改——由 scripts/generate-rich-menu-glyphs.mjs 產生（#931）。
 *
 * 字型：Noto Sans TC Bold，Copyright Google LLC / Adobe，SIL Open Font License 1.1
 *   (https://openfontlicense.org)。授權允許將字形輪廓轉為向量並隨程式散布。
 * 來源：https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/TC
 *
 * 每個 label（MODE_PRESETS[*].richMenuCells）→ SVG path（字級 100 單位、已平移至左上角 0,0）
 * 與外框寬高 w／h。執行期不載入字型。新增 label 後重跑腳本。
 */
export interface RichMenuGlyph { d: string; w: number; h: number }

export const RICH_MENU_GLYPHS: Readonly<Record<string, RichMenuGlyph>> = {
${body}
};
`;
const target = path.join(root, 'src/server/rich-menu-glyphs.generated.ts');
fs.writeFileSync(target, out);
console.log(`已寫入 ${target}（${entries.length} 個 label，${out.length} bytes）`);
