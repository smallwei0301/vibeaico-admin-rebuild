/**
 * scripts/verify/line-preview-sizes.cjs —— issue #28 ⑬ 的沙箱實測腳本。
 *
 * 跑法：`node scripts/verify/line-preview-sizes.cjs`
 *
 * 證明兩件寫在 src/server/image.ts 註解裡的事，讓它們是**量出來的**而不是說法：
 *   ① 縮圖階梯真的把圖壓到 ≤1,000,000 bytes，而且原圖一個 byte 都沒被動到；
 *   ② PNG 量化的 effort 固定用 1（而非 sharp 預設的 7）—— 時間差一個數量級，
 *      檔案大小只差兩成，而上傳是使用者在等的同步請求。
 *
 * 素材刻意用**隨機雜訊**：那是壓縮率最差的一種圖，真實照片只會比它更小。
 * 拿好壓的素材去證明「壓得下 1 MB」等於自己給自己放水。
 */
const sharp = require('sharp');

const LINE_PREVIEW_MAX_BYTES = 1_000_000;
/** 與 src/server/image.ts 的 STEPS 一致 */
const STEPS = [
  { width: 1024, jpegQuality: 82, png: { palette: false } },
  { width: 1024, jpegQuality: 65, png: { palette: true, colours: 256 } },
  { width: 640, jpegQuality: 65, png: { palette: true, colours: 128 } },
  { width: 320, jpegQuality: 60, png: { palette: true, colours: 128 } },
];
const PNG_QUANTISE_EFFORT = 1;

function noise(w, h) {
  const b = Buffer.alloc(w * h * 3);
  for (let i = 0; i < b.length; i++) b[i] = (Math.random() * 256) | 0;
  return b;
}

async function ladder(original, contentType) {
  const wantPng = contentType === 'image/png';
  const src = sharp(original, { failOn: 'error' }).rotate();
  for (const step of STEPS) {
    const pipe = src
      .clone()
      .resize({ width: step.width, height: step.width, fit: 'inside', withoutEnlargement: true });
    const t = Date.now();
    const out = wantPng
      ? await pipe.png({ compressionLevel: 9, effort: PNG_QUANTISE_EFFORT, ...step.png }).toBuffer()
      : await pipe.jpeg({ quality: step.jpegQuality }).toBuffer();
    const fits = out.byteLength <= LINE_PREVIEW_MAX_BYTES;
    console.log(
      `  w=${step.width} ${wantPng ? JSON.stringify(step.png) : `q=${step.jpegQuality}`}` +
        ` -> ${out.byteLength} bytes, ${Date.now() - t}ms  ${fits ? '<=1MB OK' : '>1MB 繼續下一階'}`,
    );
    if (fits) return out;
  }
  return null;
}

async function main() {
  console.log(`sharp ${sharp.versions.sharp}（package.json dependencies 顯式釘住的版本）`);

  for (const [fmt, w, h] of [['image/jpeg', 2400, 1800], ['image/png', 1400, 1000]]) {
    const raw = noise(w, h);
    const original =
      fmt === 'image/jpeg'
        ? await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
        : await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
    const before = Buffer.from(original);

    console.log(
      `\n[${fmt}] 原圖 ${w}x${h} = ${original.length} bytes` +
        ` (${(original.length / 1048576).toFixed(2)} MB, ${original.length > LINE_PREVIEW_MAX_BYTES ? '超過 preview 的 1 MB 上限' : '未超過'})`,
    );
    const preview = await ladder(original, fmt);
    if (!preview) {
      console.error('  ✗ 四階都壓不下 1 MB —— 實作會擋下上傳（不會退回原圖）');
      process.exitCode = 1;
      continue;
    }
    const pm = await sharp(preview).metadata();
    const om = await sharp(original).metadata();
    console.log(`  縮圖：${preview.length} bytes, ${pm.format} ${pm.width}x${pm.height}`);
    console.log(`  原圖：${original.length} bytes, ${om.format} ${om.width}x${om.height}`);
    console.log(`  原圖 buffer 未被改動：${Buffer.compare(original, before) === 0}`);
  }

  // ② effort 的取捨（用一張真的需要量化的 PNG 量）
  console.log('\n[PNG 量化 effort 取捨] 同一張 1024px 縮圖，只改 effort：');
  const pngSrc = await sharp(noise(1400, 1000), { raw: { width: 1400, height: 1000, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
  for (const effort of [7, 3, 1]) {
    const t = Date.now();
    const out = await sharp(pngSrc)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, effort, palette: true, colours: 256 })
      .toBuffer();
    console.log(`  effort=${effort} -> ${out.length} bytes, ${Date.now() - t}ms`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
