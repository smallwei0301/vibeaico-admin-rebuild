/**
 * keyword-reply-images 直寫 Storage 側門修復 — 單元測試（GitHub issue #402）
 * -----------------------------------------------------------------------------
 * 與 `tests/unit/welcome-card-upload-wiring.28.test.ts` 對 0072 的斷言同型：
 * `keyword-reply-images` 是 0086 建立、public=true 的 bucket，但先前沒有大小／
 * MIME 限制，且仍留在 `p_storage_write` 的 authenticated 直寫允許清單裡
 * （0073 修復 welcome-card-images 側門時特意保留了它，見 0072 檔頭註解）。
 *
 * Owner 已在 Issue #402 裁示：public 維持不變（LINE 需要直接 HTTPS 讀圖），
 * 單檔上限固定 5 MiB，允許 MIME 為 jpeg/png/webp，authenticated 不再直接
 * INSERT，正常上傳統一經 POST /api/upload（service role 寫入）。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');

const migration = read('supabase/migrations/0112_keyword_reply_images_upload_acl.sql');
// 2026-09-16（PR #455 TERRA_BUILD 回合）：0112 原本同時混了 bucket 大小/MIME 限制
// （BACKFILL：對既有列的 UPDATE）與 ACL 變更（AUTHZ：CREATE POLICY），
// `production-db-release-plan.mjs` 的 `inferMigrationRiskTier` 對單檔混兩種
// specialized risk tier 一律 fail closed，因此把 bucket 限制值那段拆到獨立的
// 0119，內容逐字未變。0112 現在只剩 ACL 那半。
const bucketLimitsMigration = read(
  'supabase/migrations/0119_issue_402_keyword_reply_images_bucket_limits.sql',
);
const uploadRoute = read('src/app/api/upload/route.ts');
const uploadService = read('src/services/upload.ts');

// 這三支既有 migration 是 #402 之前就已套用過的歷史檔案；#402 必須是 forward-only
// 修復（只新增 0112），不得回頭改寫已套用內容。sha256 是修復當下量測的基準值——
// 這三個常數本身就是「不得被改寫」的斷言對象，之後若有人真的需要動這幾支檔案
// （理論上不該發生，因為已套用的 migration 不可回頭改），必須連同這幾個常數一起
// 更新，而不是讓測試悄悄變綠。
const HISTORICAL_MIGRATION_SHA256: Record<string, string> = {
  '0072_welcome_card_upload_acl.sql':
    '21ca1245b6d36ea53a453310800be5149b16200c0d049362dff81d5bdc8c2e84',
  '0073_restore_keyword_reply_storage_write.sql':
    '57be46114c59c8c80ac3794b4abd44f73ea56d5d65fba5f50d6f44369d01f4f9',
  '0086_keyword_reply_images_bucket.sql':
    '835b94ceec7e30c73bca98054c73dd12f61d1417b0486bae9b344182f4b2e179',
};

describe('keyword-reply-images 直寫 Storage 側門修復 #402', () => {
  it('固定 file_size_limit 為 5MiB、allowed_mime_types 限 jpeg/png/webp（現拆分於 0119）', () => {
    expect(bucketLimitsMigration).toContain("where id = 'keyword-reply-images'");
    expect(bucketLimitsMigration).toContain('file_size_limit = 5242880');
    expect(bucketLimitsMigration).toContain(
      "allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]",
    );
    // 0112 本身不再含這段 BACKFILL 語句——拆分後只剩 ACL（AUTHZ）。
    expect(migration).not.toContain('update storage.buckets');
  });

  it('把 keyword-reply-images 從 p_storage_write 的 authenticated 允許清單移除', () => {
    expect(migration).toContain('drop policy if exists p_storage_write on storage.objects;');
    const writePolicy = migration.slice(migration.indexOf('create policy p_storage_write'));
    expect(writePolicy).toContain(
      "'service-images', 'product-images', 'portfolio-images', 'staff-avatars'",
    );
    expect(writePolicy).toContain("'richmenu-assets', 'chat-images'");
    expect(writePolicy).not.toContain('keyword-reply-images');
    expect(writePolicy).toContain('and is_tenant_member((storage.foldername(name))[1]::uuid)');
  });

  it('0112 的檔頭以 #402 標頭起始', () => {
    expect(migration.startsWith('-- #402')).toBe(true);
  });

  it('本檔是 forward-only：0072/0073/0086 三支歷史 migration 內容逐位元組未被改寫', () => {
    for (const [file, expectedSha256] of Object.entries(HISTORICAL_MIGRATION_SHA256)) {
      const content = read(`supabase/migrations/${file}`);
      expect(sha256(content), `supabase/migrations/${file} 的內容不應被 #402 修改`).toBe(
        expectedSha256,
      );
    }
  });

  it('正常上傳仍統一經 POST /api/upload（service role 寫入），沒有第二條瀏覽器直寫路徑', () => {
    const block = uploadRoute.slice(
      uploadRoute.indexOf('const ALLOWED_BUCKETS'),
      uploadRoute.indexOf('const MAX_BYTES'),
    );
    expect(block).toContain("'keyword-reply-images'");
    // /api/upload 本身的角色／MIME／大小驗證與 Owner 裁示的參數一致。
    expect(uploadRoute).toContain('const MAX_BYTES = 5 * 1024 * 1024; // 5MB');
    expect(uploadRoute).toContain("'image/jpeg': 'jpg'");
    expect(uploadRoute).toContain("'image/png': 'png'");
    expect(uploadRoute).toContain("'image/webp': 'webp'");
    expect(uploadService).toContain("| 'keyword-reply-images'");
  });
});
