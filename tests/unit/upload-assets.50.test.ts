import { describe, expect, it } from 'vitest';
import {
  buildTenantAssetPath,
  validateImageBytes,
  validateImageUpload,
  validateTenantStorageRef,
} from '@/server/upload-assets';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('Issue #50：上傳檔案與 tenant-owned storage reference', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
  ])('JPEG／PNG 會得到可信任的副檔名（%s）', (contentType, extension) => {
    expect(validateImageUpload({ contentType, size: 1024 }, { allowWebp: false }))
      .toEqual({ extension });
  });

  it('關鍵字圖片拒絕 WebP、非圖片與超過 5MB，不能製造假 URL', () => {
    expect(() => validateImageUpload(
      { contentType: 'image/webp', size: 1024 },
      { allowWebp: false },
    )).toThrow('僅支援 JPEG / PNG 圖片');
    expect(() => validateImageUpload(
      { contentType: 'image/svg+xml', size: 1024 },
      { allowWebp: false },
    )).toThrow('僅支援 JPEG / PNG 圖片');
    expect(() => validateImageUpload(
      { contentType: 'image/png', size: 5 * 1024 * 1024 + 1 },
      { allowWebp: false },
    )).toThrow('圖片超過 5MB 上限');
  });

  it('副檔名不能只信瀏覽器 MIME：檔頭不符會拒絕', () => {
    expect(() => validateImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png'))
      .not.toThrow();
    expect(() => validateImageBytes(new Uint8Array([0x3c, 0x73, 0x76, 0x67]), 'png'))
      .toThrow('圖片內容與宣告格式不一致');
  });

  it('物件路徑一定由伺服器組成 tenantId/uuid.ext', () => {
    expect(buildTenantAssetPath(TENANT_A, 'png', () => 'asset-id'))
      .toBe(`${TENANT_A}/asset-id.png`);
  });

  it('storage ref 同時鎖 bucket、tenant path 與 HTTPS public URL', () => {
    const ref = {
      bucket: 'richmenu-assets',
      path: `${TENANT_A}/asset-id.png`,
      url: `https://project.supabase.co/storage/v1/object/public/richmenu-assets/${TENANT_A}/asset-id.png`,
    };

    const origin = 'https://project.supabase.co';
    expect(validateTenantStorageRef(ref, TENANT_A, new Set(['richmenu-assets']), origin)).toEqual(ref);
    expect(() => validateTenantStorageRef(ref, TENANT_B, new Set(['richmenu-assets']), origin))
      .toThrow('圖片不屬於目前租戶');
    expect(() => validateTenantStorageRef(
      { ...ref, bucket: 'product-images' }, TENANT_A, new Set(['richmenu-assets']), origin,
    )).toThrow('不允許的 bucket');
    expect(() => validateTenantStorageRef(
      { ...ref, url: 'http://project.supabase.co/fake.png' }, TENANT_A,
      new Set(['richmenu-assets']), origin,
    )).toThrow('圖片 URL 與 Storage 位置不一致');
    expect(() => validateTenantStorageRef(
      { ...ref, url: `https://evil.example/storage/v1/object/public/richmenu-assets/${TENANT_A}/asset-id.png` },
      TENANT_A, new Set(['richmenu-assets']), origin,
    )).toThrow('圖片 URL 與 Storage 位置不一致');
  });
});
