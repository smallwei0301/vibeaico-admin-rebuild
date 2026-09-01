import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  KEYWORD_REPLY_IMAGES_BUCKET,
  KEYWORD_REPLY_IMAGE_MAX_BYTES,
  LINE_PREVIEW_MAX_BYTES,
  assertKeywordReplyImagePayload,
  isKeywordReplyImageReferenced,
  makeKeywordReplyPreview,
  previewPathFor,
  readKeywordReplyImageRef,
  requireKeywordReplyImage,
  uploadKeywordReplyImage,
  validateKeywordReplyImageBytes,
  validateKeywordReplyImageRef,
  withKeywordReplyImagePathsLock,
} from '@/server/keyword-reply-images';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const IMAGE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORIGIN = 'https://project.supabase.co';
const previousSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
});

afterAll(() => {
  if (previousSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousSupabaseUrl;
});

function refFor(tenantId = TENANT_A) {
  const path = `${tenantId}/${IMAGE_ID}.png`;
  const previewPath = previewPathFor(path);
  return {
    bucket: KEYWORD_REPLY_IMAGES_BUCKET,
    path,
    url: `${ORIGIN}/storage/v1/object/public/${KEYWORD_REPLY_IMAGES_BUCKET}/${path}`,
    previewPath,
    previewUrl: `${ORIGIN}/storage/v1/object/public/${KEYWORD_REPLY_IMAGES_BUCKET}/${previewPath}`,
  } as const;
}

describe('Issue #50 keyword-reply image storage seam', () => {
  afterEach(() => vi.restoreAllMocks());

  it('validates the dedicated bucket, tenant path, derived preview, and HTTPS origin', () => {
    const ref = refFor();
    expect(validateKeywordReplyImageRef(ref, TENANT_A, ORIGIN)).toEqual(ref);
    expect(() => validateKeywordReplyImageRef(ref, TENANT_B, ORIGIN)).toThrow('圖片不屬於目前租戶');
    expect(() => validateKeywordReplyImageRef({ ...ref, bucket: 'richmenu-assets' }, TENANT_A, ORIGIN))
      .toThrow('不允許的關鍵字圖片 bucket');
    expect(() => validateKeywordReplyImageRef({ ...ref, url: ref.url.replace('https:', 'http:') }, TENANT_A, ORIGIN))
      .toThrow('圖片 URL 與 Storage 位置不一致');
    expect(() => validateKeywordReplyImageRef({ ...ref, previewPath: `${TENANT_A}/other.preview.png` }, TENANT_A, ORIGIN))
      .toThrow('圖片縮圖與 Storage 位置不一致');
  });

  it('does not treat a bare legacy imageUrl as an owned ref', () => {
    const ref = refFor();
    expect(readKeywordReplyImageRef({ imageStorageRef: ref })).toEqual(ref);
    expect(readKeywordReplyImageRef({ imageUrl: ref.url })).toBeNull();
    expect(readKeywordReplyImageRef({ imageStorageRef: { path: ref.path } })).toBeNull();
    expect(isKeywordReplyImageReferenced([{ content: { imageStorageRef: ref } }], ref.path)).toBe(true);
    expect(isKeywordReplyImageReferenced([{ content: { imageStorageRef: ref } }], ref.previewPath)).toBe(true);
    expect(isKeywordReplyImageReferenced([{ content: { imageStorageRef: ref } }], `${TENANT_A}/other.png`)).toBe(false);
  });

  it('rejects unsupported/signature-spoofed bytes and keeps the 5 MB boundary explicit', () => {
    expect(KEYWORD_REPLY_IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(() => validateKeywordReplyImageBytes(Buffer.from('not jpeg'), 'image/jpeg'))
      .toThrow('圖片內容與宣告格式不一致');
    expect(() => validateKeywordReplyImageBytes(Buffer.from('not png'), 'image/png'))
      .toThrow('圖片內容與宣告格式不一致');
    expect(() => validateKeywordReplyImageBytes(Buffer.from([0xff, 0xd8, 0xff]), 'image/webp'))
      .toThrow('圖片內容與宣告格式不一致');
  });

  it('rejects image ownership data on non-image replies and oversized uploads before Storage', async () => {
    const ref = refFor();
    expect(() => assertKeywordReplyImagePayload('TEXT', { imageStorageRef: ref }))
      .toThrow('圖片內容只能搭配 IMAGE');
    expect(() => assertKeywordReplyImagePayload('FLEX', { imageUrl: ref.url }))
      .toThrow('圖片內容只能搭配 IMAGE');

    const storageFrom = vi.fn();
    const admin = { storage: { from: storageFrom } };
    await expect(uploadKeywordReplyImage({
      tenantId: TENANT_A,
      file: new File([new Uint8Array(KEYWORD_REPLY_IMAGE_MAX_BYTES + 1)], 'large.jpg', {
        type: 'image/jpeg',
      }),
      admin: admin as never,
    })).rejects.toThrow('超過 5MB');
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('produces a same-format preview no larger than LINE allows', async () => {
    const jpeg = await sharp({
      create: { width: 1200, height: 900, channels: 3, background: '#0ea5e9' },
    }).jpeg({ quality: 95 }).toBuffer();
    const preview = await makeKeywordReplyPreview(jpeg, 'image/jpeg');
    expect(preview.byteLength).toBeLessThanOrEqual(LINE_PREVIEW_MAX_BYTES);
    expect((await sharp(preview).metadata()).format).toBe('jpeg');
  });

  it('uploads original and preview, returning only server-derived storage evidence', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#22c55e' },
    }).png().toBuffer();
    const uploads: { path: string; bytes: Buffer; contentType: string }[] = [];
    const queue = vi.fn().mockResolvedValue({ error: null });
    const storage = {
      from: vi.fn(() => ({
        upload: vi.fn(async (path: string, bytes: Buffer, options: { contentType: string }) => {
          uploads.push({ path, bytes, contentType: options.contentType });
          return { error: null };
        }),
        remove: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `${ORIGIN}/storage/v1/object/public/${KEYWORD_REPLY_IMAGES_BUCKET}/${path}` },
        }),
      })),
    };
    const admin = { storage, from: vi.fn(() => ({ upsert: queue })) } as never;
    const result = await uploadKeywordReplyImage({
      tenantId: TENANT_A,
      file: new File([png], 'green.png', { type: 'image/png' }),
      admin,
    });

    expect(result.storageRef).toMatchObject({ bucket: KEYWORD_REPLY_IMAGES_BUCKET, url: result.url });
    expect(result.path).toMatch(new RegExp(`^${TENANT_A}/[0-9a-f-]{36}\\.png$`));
    expect(result.previewPath).toBe(previewPathFor(result.path));
    expect(uploads).toHaveLength(2);
    expect(uploads[0].path).toBe(result.path);
    expect(uploads[1].path).toBe(result.previewPath);
    expect(uploads[1].bytes.byteLength).toBeLessThanOrEqual(LINE_PREVIEW_MAX_BYTES);
    expect((await sharp(uploads[1].bytes).metadata()).format).toBe('png');
    expect(queue).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ tenant_id: TENANT_A, bucket: KEYWORD_REPLY_IMAGES_BUCKET }),
      ]),
      { onConflict: 'bucket,path' },
    );
  });

  it('attempts to remove both provisional objects when preview upload fails', async () => {
    const jpeg = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#f97316' },
    }).jpeg().toBuffer();
    let uploadCount = 0;
    const remove = vi.fn().mockResolvedValue({ error: null });
    const storage = {
      from: vi.fn(() => ({
        upload: vi.fn(async () => {
          uploadCount += 1;
          return uploadCount === 2 ? { error: new Error('preview unavailable') } : { error: null };
        }),
        remove,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `${ORIGIN}/storage/v1/object/public/${KEYWORD_REPLY_IMAGES_BUCKET}/${path}` },
        }),
      })),
    };

    await expect(uploadKeywordReplyImage({
      tenantId: TENANT_A,
      file: new File([jpeg], 'orange.jpg', { type: 'image/jpeg' }),
      admin: { storage } as never,
    })).rejects.toThrow('preview unavailable');
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(new RegExp(`^${TENANT_A}/[0-9a-f-]{36}\\.jpg$`)),
      expect.stringMatching(new RegExp(`^${TENANT_A}/[0-9a-f-]{36}\\.preview\\.jpg$`)),
    ]);
  });

  it('checks both objects before DB persistence', async () => {
    const ref = refFor();
    const content = { imageUrl: ref.url, previewImageUrl: ref.previewUrl, imageStorageRef: ref };
    const info = vi.fn().mockResolvedValue({ error: null });
    const admin = { storage: { from: vi.fn(() => ({ info })) } } as never;
    await expect(requireKeywordReplyImage(content, TENANT_A, admin)).resolves.toEqual(ref);
    expect(info).toHaveBeenCalledTimes(2);

    info.mockResolvedValue({ error: new Error('missing') });
    await expect(requireKeywordReplyImage(content, TENANT_A, admin))
      .rejects.toThrow('找不到已上傳的關鍵字圖片');
  });

  it('acquires and releases the DB path boundary around image work', async () => {
    const inserted: Record<string, unknown>[] = [];
    const insert = vi.fn((value: Record<string, unknown>) => {
      inserted.push(value);
      return { select: vi.fn().mockResolvedValue({ data: [{ path: value.path }], error: null }) };
    });
    const release = { error: null, eq: vi.fn() };
    release.eq.mockReturnValue(release);
    const admin = {
      from: vi.fn(() => ({ insert, delete: vi.fn(() => release) })),
    } as never;
    const work = vi.fn().mockResolvedValue('finished');

    await expect(withKeywordReplyImagePathsLock({
      admin,
      tenantId: TENANT_A,
      paths: ['a-path', 'b-path'],
      work,
    })).resolves.toBe('finished');

    expect(work).toHaveBeenCalledOnce();
    expect(inserted).toHaveLength(2);
    expect(inserted.every((row) => String(row.path).startsWith('__keyword-reply-image-lock__/'))).toBe(true);
    expect(release.eq).toHaveBeenCalledWith('last_error', expect.stringMatching(/^lock:/));
  });
});
