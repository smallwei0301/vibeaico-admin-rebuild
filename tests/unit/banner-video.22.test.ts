/**
 * tests/unit/banner-video.22.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/server/banner-video.ts`（Issue #22 Part A）純函式與孤兒清理邏輯：
 *   1. `validatePresignRequest`：MIME 白名單、50MiB 上限（presign 的第一道
 *      fail-closed 檢查——用戶端宣稱值，不是最終安全邊界）。
 *   2. `buildBannerVideoStoragePath`：路徑永遠以呼叫端 tenantId 開頭，用戶端
 *      無法影響（函式簽章本身就不接受任何用戶端路徑輸入）。
 *   3. `verifyUploadedObject`：confirm 的真正安全邊界——重新驗證 Storage 回報
 *      的真實 metadata（不存在／格式不符／大小超標）。
 *   4. `cleanupOrphanedBannerVideoUploads`：只動超過保留視窗且未 confirm 的列
 *      （bounded），Storage 刪除失敗只計數、不中止整批。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMock = vi.fn(async (_col: string, _val: string) => ({
  data: [] as { id: string; storage_path: string }[] | null,
  error: null as { message: string } | null,
}));
const removeMock = vi.fn(async (_paths: string[]) => ({ error: null as { message: string } | null }));
const deleteInMock = vi.fn(async (_ids: string[]) => ({ error: null as { message: string } | null }));

const fakeAdminSupabase = {
  from: vi.fn((table: string) => {
    if (table !== 'banner_video_pending_uploads') throw new Error(`unexpected table: ${table}`);
    return {
      select: () => ({
        is: (_col: string, _v: null) => ({
          lt: async (_col2: string, cutoff: string) => listMock('created_at', cutoff),
        }),
      }),
      delete: () => ({
        in: (_col: string, ids: string[]) => deleteInMock(ids),
      }),
    };
  }),
  storage: {
    from: () => ({ remove: removeMock }),
  },
};

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => fakeAdminSupabase,
}));

import {
  BANNER_VIDEO_MAX_BYTES,
  BANNER_VIDEO_ORPHAN_RETENTION_HOURS,
  buildBannerVideoStoragePath,
  cleanupOrphanedBannerVideoUploads,
  isPathOwnedByTenant,
  orphanCutoffIso,
  validatePresignRequest,
  verifyUploadedObject,
} from '@/server/banner-video';

describe('validatePresignRequest（presign 第一道 fail-closed 檢查）', () => {
  it('接受合法的 MP4／WebM，大小在 50MiB 以內', () => {
    expect(validatePresignRequest({ contentType: 'video/mp4', sizeBytes: 1024 })).toBeNull();
    expect(validatePresignRequest({ contentType: 'video/webm', sizeBytes: BANNER_VIDEO_MAX_BYTES })).toBeNull();
  });

  it('拒絕不在白名單的 MIME', () => {
    expect(validatePresignRequest({ contentType: 'video/quicktime', sizeBytes: 1024 })).toBe('INVALID_MIME');
    expect(validatePresignRequest({ contentType: 'image/png', sizeBytes: 1024 })).toBe('INVALID_MIME');
  });

  it('拒絕超過 50MiB 的宣稱大小', () => {
    expect(
      validatePresignRequest({ contentType: 'video/mp4', sizeBytes: BANNER_VIDEO_MAX_BYTES + 1 }),
    ).toBe('TOO_LARGE');
  });

  it('拒絕不合理的大小（0、負數、NaN）', () => {
    expect(validatePresignRequest({ contentType: 'video/mp4', sizeBytes: 0 })).toBe('TOO_LARGE');
    expect(validatePresignRequest({ contentType: 'video/mp4', sizeBytes: -1 })).toBe('TOO_LARGE');
    expect(validatePresignRequest({ contentType: 'video/mp4', sizeBytes: NaN })).toBe('TOO_LARGE');
  });
});

describe('buildBannerVideoStoragePath（租戶隔離路徑，用戶端無法影響）', () => {
  it('路徑永遠以 tenantId 開頭，副檔名對應 contentType', () => {
    const path = buildBannerVideoStoragePath('tenant-a', 'video/mp4');
    expect(path.startsWith('tenant-a/banner-video/')).toBe(true);
    expect(path.endsWith('.mp4')).toBe(true);
  });

  it('每次呼叫都是不同的隨機檔名（不可預測、不會互撞）', () => {
    const a = buildBannerVideoStoragePath('tenant-a', 'video/webm');
    const b = buildBannerVideoStoragePath('tenant-a', 'video/webm');
    expect(a).not.toBe(b);
  });

  it('不支援的 contentType 直接丟例外（呼叫前應已經過 validatePresignRequest）', () => {
    expect(() => buildBannerVideoStoragePath('tenant-a', 'video/quicktime')).toThrow();
  });
});

describe('isPathOwnedByTenant（confirm 的防禦性重複檢查）', () => {
  it('同租戶路徑通過', () => {
    expect(isPathOwnedByTenant('tenant-a/banner-video/x.mp4', 'tenant-a')).toBe(true);
  });

  it('跨租戶路徑（A 店嘗試 confirm B 店路徑）被拒', () => {
    expect(isPathOwnedByTenant('tenant-b/banner-video/x.mp4', 'tenant-a')).toBe(false);
  });

  it('路徑前綴看起來像但不是完整資料夾邊界時也拒（避免 tenant-ab 混過 tenant-a）', () => {
    expect(isPathOwnedByTenant('tenant-ab/banner-video/x.mp4', 'tenant-a')).toBe(false);
  });
});

describe('verifyUploadedObject（confirm 的真正安全邊界：重新驗證 Storage 真實 metadata）', () => {
  it('物件不存在（Storage 查無此路徑）→ NOT_FOUND', () => {
    expect(verifyUploadedObject(null)).toBe('NOT_FOUND');
  });

  it('真實 mimetype 不在白名單 → MIME_MISMATCH（即使用戶端 presign 時宣稱是合法格式）', () => {
    expect(verifyUploadedObject({ size: 1024, mimetype: 'application/octet-stream' })).toBe('MIME_MISMATCH');
  });

  it('真實 size 超過上限 → SIZE_MISMATCH（用戶端可能謊報宣稱大小）', () => {
    expect(
      verifyUploadedObject({ size: BANNER_VIDEO_MAX_BYTES + 1, mimetype: 'video/mp4' }),
    ).toBe('SIZE_MISMATCH');
  });

  it('真實 size 為 0（空檔案）→ SIZE_MISMATCH', () => {
    expect(verifyUploadedObject({ size: 0, mimetype: 'video/mp4' })).toBe('SIZE_MISMATCH');
  });

  it('合法物件 → 通過（null）', () => {
    expect(verifyUploadedObject({ size: 1024 * 1024, mimetype: 'video/webm' })).toBeNull();
  });
});

describe('cleanupOrphanedBannerVideoUploads（bounded 孤兒清理）', () => {
  beforeEach(() => {
    listMock.mockClear();
    removeMock.mockClear();
    deleteInMock.mockClear();
    listMock.mockResolvedValue({ data: [], error: null });
    removeMock.mockResolvedValue({ error: null });
    deleteInMock.mockResolvedValue({ error: null });
  });

  it('用 BANNER_VIDEO_ORPHAN_RETENTION_HOURS 算出正確的 cutoff', async () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const result = await cleanupOrphanedBannerVideoUploads(now);
    const expectedCutoff = orphanCutoffIso(now);
    expect(result.cutoffIso).toBe(expectedCutoff);
    expect(expectedCutoff).toBe(
      new Date(now.getTime() - BANNER_VIDEO_ORPHAN_RETENTION_HOURS * 60 * 60 * 1000).toISOString(),
    );
  });

  it('沒有孤兒列時不呼叫 delete，回傳 0', async () => {
    const result = await cleanupOrphanedBannerVideoUploads(new Date());
    expect(result.deletedRows).toBe(0);
    expect(result.storageErrors).toBe(0);
    expect(deleteInMock).not.toHaveBeenCalled();
  });

  it('每一列都嘗試刪 Storage 物件，成功後刪掉追蹤列', async () => {
    listMock.mockResolvedValueOnce({
      data: [
        { id: 'row-1', storage_path: 'tenant-a/banner-video/a.mp4' },
        { id: 'row-2', storage_path: 'tenant-b/banner-video/b.webm' },
      ],
      error: null,
    });
    const result = await cleanupOrphanedBannerVideoUploads(new Date());
    expect(removeMock).toHaveBeenCalledTimes(2);
    expect(removeMock).toHaveBeenCalledWith(['tenant-a/banner-video/a.mp4']);
    expect(deleteInMock).toHaveBeenCalledWith(['row-1', 'row-2']);
    expect(result.deletedRows).toBe(2);
    expect(result.storageErrors).toBe(0);
  });

  it('Storage 刪除失敗只計數，不中止整批、追蹤列仍會被清掉', async () => {
    listMock.mockResolvedValueOnce({
      data: [{ id: 'row-1', storage_path: 'tenant-a/banner-video/a.mp4' }],
      error: null,
    });
    removeMock.mockResolvedValueOnce({ error: { message: 'network error' } });
    const result = await cleanupOrphanedBannerVideoUploads(new Date());
    expect(result.storageErrors).toBe(1);
    expect(result.deletedRows).toBe(1);
    expect(deleteInMock).toHaveBeenCalledWith(['row-1']);
  });

  it('查詢本身失敗時把錯誤丟出（由呼叫端 cron route 決定怎麼回應）', async () => {
    listMock.mockResolvedValueOnce({ data: null, error: { message: 'query failed' } });
    await expect(cleanupOrphanedBannerVideoUploads(new Date())).rejects.toBeTruthy();
  });
});
