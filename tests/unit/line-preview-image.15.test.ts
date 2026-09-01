import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import {
  LINE_PREVIEW_MAX_BYTES,
  chatImagePathFromUrl,
  isChatImagePathForTenant,
  makeLinePreview,
  previewPathFor,
} from '@/server/image';

const SUPABASE_URL = 'https://issue15.supabase.co';
const TENANT = '11111111-2222-3333-4444-555555555555';
const IMAGE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
});

afterAll(() => {
  if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
});

describe('LINE chat image preview', () => {
  it('由原圖 path 推導同 bucket 的 preview path，並限制在租戶資料夾', () => {
    const original = TENANT + '/' + IMAGE + '.jpg';
    expect(previewPathFor(original)).toBe(TENANT + '/' + IMAGE + '.preview.jpg');
    expect(isChatImagePathForTenant(original, TENANT)).toBe(true);
    expect(isChatImagePathForTenant(original, '22222222-3333-4444-5555-666666666666')).toBe(false);
    expect(isChatImagePathForTenant(TENANT + '/' + IMAGE + '.preview.jpg', TENANT)).toBe(false);
  });

  it('只把本站 chat-images public URL 視為可驗證的物件', () => {
    expect(chatImagePathFromUrl(
      SUPABASE_URL + '/storage/v1/object/public/chat-images/' + TENANT + '/' + IMAGE + '.jpg',
    )).toBe(TENANT + '/' + IMAGE + '.jpg');
    expect(chatImagePathFromUrl(
      'https://evil.example/storage/v1/object/public/chat-images/' + TENANT + '/' + IMAGE + '.jpg',
    )).toBeNull();
  });

  it('實際解碼 JPEG 後產出 <=1MB 的 JPEG preview', async () => {
    const raw = Buffer.alloc(1200 * 900 * 3);
    for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 17 + (i >> 4)) % 256;
    const original = await sharp(raw, { raw: { width: 1200, height: 900, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
    const preview = await makeLinePreview(original, 'image/jpeg');
    expect(preview.bytes.byteLength).toBeLessThanOrEqual(LINE_PREVIEW_MAX_BYTES);
    expect((await sharp(preview.bytes).metadata()).format).toBe('jpeg');
  });

  it('檔案內容與宣稱 MIME 不符時 fail closed', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'white' },
    }).png().toBuffer();
    await expect(makeLinePreview(png, 'image/jpeg')).rejects.toMatchObject({ status: 400 });
    await expect(makeLinePreview(Buffer.from('not an image'), 'image/png'))
      .rejects.toMatchObject({ status: 400 });
  });
});
