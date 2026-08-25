/**
 * LINE `previewImageUrl` 縮圖 —— 單元測試（GitHub issue #28 ⑬ / 14 分冊 §8.15）
 * -----------------------------------------------------------------------------
 * 來由：LINE 的 image message 對兩個圖片欄位訂了**不同**的上限
 * （`originalContentUrl` 10 MB、`previewImageUrl` **1 MB**；官方原文見
 * 06 分冊 §8.4，2026-08-25 重新抓取 index.html.md 確認），但 chat 與 marketing
 * 兩處都把同一個 URL 同時塞進兩個欄位，而 /api/upload 放行到 5 MB
 * —— **1–5 MB 的圖（手機原圖幾乎都在這個區間）當 preview 就已超規**。
 *
 * 本檔鎖三件事：
 *   ① 縮圖真的產得出來且真的 ≤1 MB（拿最難壓的隨機雜訊當素材，不是拿好壓的圖放水）；
 *   ② 縮圖的位置是**從原圖路徑推導**出來的，不是另外記一筆；
 *   ③ 產不出縮圖時**丟例外**，不是靜默退回原圖——後者等於把這個 bug 原封不動放回來。
 *
 * 另有一組靜態接線鎖，防止日後有人「順手」把 preview 改回指向原圖，或把
 * richmenu-assets 也加進要產縮圖的 bucket（那是 LINE 去向沒錯，但 rich menu 是
 * 整張底圖直接上傳給 LINE，訊息裡根本沒有 previewImageUrl 可指）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  LINE_PREVIEW_MAX_BYTES,
  makeLinePreview,
  previewPathFor,
  originalPathFor,
  chatImagePathFromUrl,
  chatImagePublicUrl,
} from '@/server/image';

const SUPABASE_URL = 'https://itest-project.supabase.co';
const TENANT = '11111111-2222-3333-4444-555555555555';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** 隨機雜訊 = 壓縮率最差的素材；真實照片只會比它更小。 */
function noiseRaw(w: number, h: number): Buffer {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) % 256 ^ ((i >> 3) * 40503) % 256;
  return buf;
}

let bigJpeg: Buffer;
let bigPng: Buffer;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  const raw = noiseRaw(2400, 1800);
  bigJpeg = await sharp(raw, { raw: { width: 2400, height: 1800, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  bigPng = await sharp(noiseRaw(1400, 1000), { raw: { width: 1400, height: 1000, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer();
});

describe('縮圖路徑：從原圖推導，不另外記一筆', () => {
  it('{tenantId}/{uuid}.jpg → {tenantId}/{uuid}.preview.jpg（同資料夾、同副檔名）', () => {
    expect(previewPathFor(`${TENANT}/${UUID}.jpg`)).toBe(`${TENANT}/${UUID}.preview.jpg`);
    expect(previewPathFor(`${TENANT}/${UUID}.png`)).toBe(`${TENANT}/${UUID}.preview.png`);
  });

  it('第一段資料夾仍是 tenantId —— 0008/0017 的 storage RLS 就是照這一段檢查的', () => {
    expect(previewPathFor(`${TENANT}/${UUID}.jpg`).split('/')[0]).toBe(TENANT);
  });

  it('推導可逆：originalPathFor(previewPathFor(p)) === p；原圖路徑本身回 null', () => {
    const p = `${TENANT}/${UUID}.jpg`;
    expect(originalPathFor(previewPathFor(p))).toBe(p);
    expect(originalPathFor(p)).toBeNull();
  });
});

describe('chatImagePathFromUrl：哪些網址算「我們託管的」', () => {
  it('我們的 public URL → 取得 bucket 內 path', () => {
    const url = `${SUPABASE_URL}/storage/v1/object/public/chat-images/${TENANT}/${UUID}.jpg`;
    expect(chatImagePathFromUrl(url)).toBe(`${TENANT}/${UUID}.jpg`);
    expect(chatImagePublicUrl(`${TENANT}/${UUID}.jpg`)).toBe(url);
  });

  it('店家自己貼的外部網址（marketing 那頁）→ null，我們不對它宣稱任何事', () => {
    expect(chatImagePathFromUrl('https://example.test/itest/photo.png')).toBeNull();
  });

  it('別人網站上長得一模一樣的路徑 → null（判定含 origin，不是只比對路徑片段）', () => {
    expect(
      chatImagePathFromUrl(
        `https://evil.example/storage/v1/object/public/chat-images/${TENANT}/${UUID}.jpg`,
      ),
    ).toBeNull();
  });

  it('別的 bucket（例：product-images）→ null，只有 chat-images 有縮圖', () => {
    expect(
      chatImagePathFromUrl(
        `${SUPABASE_URL}/storage/v1/object/public/product-images/${TENANT}/${UUID}.jpg`,
      ),
    ).toBeNull();
  });
});

describe('makeLinePreview：真的壓得到 1 MB 以下，且不動到原圖', () => {
  it('4 MB 的 JPEG（隨機雜訊）→ 縮圖 ≤1,000,000 bytes 且仍是 JPEG', async () => {
    expect(bigJpeg.byteLength).toBeGreaterThan(LINE_PREVIEW_MAX_BYTES);
    const out = await makeLinePreview(bigJpeg, 'image/jpeg');
    expect(out.bytes.byteLength).toBeLessThanOrEqual(LINE_PREVIEW_MAX_BYTES);
    expect(out.contentType).toBe('image/jpeg');
    expect((await sharp(out.bytes).metadata()).format).toBe('jpeg');
  });

  it('PNG 產出的縮圖仍是 PNG —— 副檔名不變，路徑推導才成立', async () => {
    const out = await makeLinePreview(bigPng, 'image/png');
    expect(out.bytes.byteLength).toBeLessThanOrEqual(LINE_PREVIEW_MAX_BYTES);
    expect(out.contentType).toBe('image/png');
    expect((await sharp(out.bytes).metadata()).format).toBe('png');
  });

  it('原圖 buffer 一個 byte 都沒被改動（originalContentUrl 送的仍是原畫質）', async () => {
    const copy = Buffer.from(bigJpeg);
    await makeLinePreview(bigJpeg, 'image/jpeg');
    expect(Buffer.compare(bigJpeg, copy)).toBe(0);
    const meta = await sharp(bigJpeg).metadata();
    expect([meta.width, meta.height]).toEqual([2400, 1800]);
  });

  it('縮圖比原圖小很多，但仍是可解碼的完整圖片（不是截斷的位元組）', async () => {
    const out = await makeLinePreview(bigJpeg, 'image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(768);
  });

  it('EXIF 轉向會被套用 —— 否則聊天列表的縮圖是躺的、點開的原圖是站的', async () => {
    // orientation=6：檢視器應把 800×400 轉成 400×800
    const rotated = await sharp(noiseRaw(800, 400), { raw: { width: 800, height: 400, channels: 3 } })
      .jpeg({ quality: 80 })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await makeLinePreview(rotated, 'image/jpeg');
    const meta = await sharp(out.bytes).metadata();
    expect(meta.width! < meta.height!).toBe(true);
  });
});

describe('makeLinePreview：產不出縮圖就丟例外，絕不退回原圖', () => {
  it('根本不是圖片的位元組 → 丟 400（而不是回一個「就用原圖吧」）', async () => {
    const junk = Buffer.from('this is definitely not a jpeg'.repeat(50));
    await expect(makeLinePreview(junk, 'image/jpeg')).rejects.toMatchObject({ status: 400 });
  });

  it('宣稱 image/png、實際是 JPEG 位元組 → 丟 400（file.type 是用戶端說了算，要實際解碼）', async () => {
    await expect(makeLinePreview(bigJpeg, 'image/png')).rejects.toMatchObject({ status: 400 });
  });

  it('例外訊息說得出「為什麼」，不是只說失敗', async () => {
    const junk = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
    await expect(makeLinePreview(junk, 'image/jpeg')).rejects.toThrow(/JPEG|圖片/);
  });
});

describe('靜態接線鎖：preview 不准再指回原圖', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('/api/chat/messages 不再把 imageUrl 同時當 original 與 preview', () => {
    const code = stripComments(read('src/app/api/chat/messages/route.ts'));
    expect(code).not.toMatch(/originalContentUrl:\s*b\.imageUrl,\s*previewImageUrl:\s*b\.imageUrl/);
    expect(code).toContain('resolveLinePreviewImageUrl');
  });

  it('/api/marketing/pushes/:id/send 一併修了，不是只修 chat', () => {
    const code = stripComments(read('src/app/api/marketing/pushes/[id]/send/route.ts'));
    expect(code).not.toMatch(/originalContentUrl:\s*c\.imageUrl,\s*previewImageUrl:\s*c\.imageUrl/);
    expect(code).not.toMatch(
      /originalContentUrl:\s*imageUrl,\s*previewImageUrl:\s*imageUrl\b/,
    );
    expect(code).toContain('resolveLinePreviewImageUrl');
  });

  it('/api/upload 只對 chat-images 產縮圖', () => {
    const code = stripComments(read('src/app/api/upload/route.ts'));
    expect(code).toMatch(/LINE_PREVIEW_BUCKETS\s*=\s*new Set\(\[[^\]]*'chat-images'[^\]]*\]\)/);
  });

  it('richmenu-assets 不在產縮圖名單內（是 LINE 去向，但 rich menu 沒有 preview 這回事）', () => {
    const code = stripComments(read('src/app/api/upload/route.ts'));
    const decl = code.slice(
      code.indexOf('const LINE_PREVIEW_BUCKETS'),
      code.indexOf('const WEB_TYPES'),
    );
    expect(decl).not.toContain('richmenu-assets');
    // 但它仍必須留在「只收 JPEG/PNG」的名單裡（11a174d 修的東西不准被這次改動洗掉）
    expect(code).toMatch(/LINE_BOUND_BUCKETS\s*=\s*new Set\(\[[^\]]*'richmenu-assets'[^\]]*\]\)/);
  });

  it('縮圖先產、後上傳 —— 產不出來時 Storage 不留半成品', () => {
    const code = stripComments(read('src/app/api/upload/route.ts'));
    const previewAt = code.indexOf('makeLinePreview');
    const uploadAt = code.indexOf('.upload(path, file');
    expect(previewAt).toBeGreaterThan(-1);
    expect(uploadAt).toBeGreaterThan(-1);
    expect(previewAt).toBeLessThan(uploadAt);
  });
});
