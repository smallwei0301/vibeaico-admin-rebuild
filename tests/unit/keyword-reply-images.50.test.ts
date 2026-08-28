import { describe, expect, it } from 'vitest';
import {
  KEYWORD_REPLY_IMAGES_BUCKET,
  isKeywordReplyImageReferenced,
  readKeywordReplyImageRef,
  requireKeywordReplyImage,
  validateKeywordReplyImageRef,
} from '@/server/keyword-reply-images';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://project.supabase.co';

const ref = {
  bucket: KEYWORD_REPLY_IMAGES_BUCKET,
  path: `${TENANT_A}/asset-id.png`,
  url: `${ORIGIN}/storage/v1/object/public/${KEYWORD_REPLY_IMAGES_BUCKET}/${TENANT_A}/asset-id.png`,
  previewPath: `${TENANT_A}/asset-id.preview.png`,
  previewUrl: `${ORIGIN}/storage/v1/object/public/${KEYWORD_REPLY_IMAGES_BUCKET}/${TENANT_A}/asset-id.preview.png`,
};

describe('Issue #50：keyword reply 圖片 storage ref', () => {
  it('只接受此租戶、專用 bucket 和可信 HTTPS public URL 的 ref', () => {
    expect(validateKeywordReplyImageRef(ref, TENANT_A, ORIGIN)).toEqual(ref);
    expect(() => validateKeywordReplyImageRef(ref, TENANT_B, ORIGIN))
      .toThrow('圖片不屬於目前租戶');
    expect(() => validateKeywordReplyImageRef({ ...ref, bucket: 'richmenu-assets' }, TENANT_A, ORIGIN))
      .toThrow('不允許的關鍵字圖片 bucket');
    expect(() => validateKeywordReplyImageRef({ ...ref, url: ref.url.replace('https:', 'http:') }, TENANT_A, ORIGIN))
      .toThrow('圖片 URL 與 Storage 位置不一致');
    expect(() => validateKeywordReplyImageRef({ ...ref, url: ref.url.replace('project.supabase.co', 'evil.example') }, TENANT_A, ORIGIN))
      .toThrow('圖片 URL 與 Storage 位置不一致');
    expect(() => validateKeywordReplyImageRef({ ...ref, previewPath: `${TENANT_A}/other.preview.png` }, TENANT_A, ORIGIN))
      .toThrow('圖片縮圖與 Storage 位置不一致');
    expect(() => validateKeywordReplyImageRef({ ...ref, previewUrl: ref.previewUrl.replace('project.supabase.co', 'evil.example') }, TENANT_A, ORIGIN))
      .toThrow('圖片縮圖與 Storage 位置不一致');
  });

  it('只讀已命名的 imageStorageRef，不能把任意 imageUrl 當成已上傳圖片', () => {
    expect(readKeywordReplyImageRef({ imageStorageRef: ref })).toEqual(ref);
    expect(readKeywordReplyImageRef({ imageUrl: ref.url })).toBeNull();
    expect(readKeywordReplyImageRef({ imageStorageRef: { path: ref.path } })).toBeNull();
  });

  it('cleanup 重試前會重查引用，舊圖重新被選用時不得刪除', () => {
    expect(isKeywordReplyImageReferenced([{ content: { imageStorageRef: ref } }], ref.path)).toBe(true);
    expect(isKeywordReplyImageReferenced([{ content: { imageStorageRef: ref } }], ref.previewPath)).toBe(true);
    expect(isKeywordReplyImageReferenced([{ content: { imageStorageRef: ref } }], `${TENANT_A}/other.png`))
      .toBe(false);
  });

  it('寫入前會查 Storage object；不存在就拒絕而非保存假圖片', async () => {
    const prior = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
    const content = { imageUrl: ref.url, previewImageUrl: ref.previewUrl, imageStorageRef: ref };
    const admin = { storage: { from: () => ({ info: async () => ({ error: null }) }) } };
    await expect(requireKeywordReplyImage(content, TENANT_A, admin)).resolves.toEqual(ref);
    await expect(requireKeywordReplyImage({ ...content, previewImageUrl: 'https://evil.example/p.png' }, TENANT_A, admin))
      .rejects.toThrow('圖片 URL 與 Storage 位置不一致');
    const absent = { storage: { from: () => ({ info: async () => ({ error: new Error('not found') }) }) } };
    await expect(requireKeywordReplyImage(content, TENANT_A, absent))
      .rejects.toThrow('找不到已上傳的關鍵字圖片');
    if (prior === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = prior;
  });
});
