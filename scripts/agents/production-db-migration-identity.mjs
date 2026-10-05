/**
 * 唯一的 migration 身分格式（producer normalizedRepoFile、G3 consumer assertPlan、impact manifest 共用）：
 * 與 supabase/migrations 實際檔名（去掉 .sql）一致，四位編號＋小寫底線 slug。
 * 獨立成零依賴模組，避免 impact manifest 為了驗證器而引入 release-plan 的依賴鏈。
 */
export const CANONICAL_MIGRATION_IDENTITY = /^\d{4}_[a-z0-9_]+$/;
export const isCanonicalMigrationIdentity = (value) =>
  typeof value === 'string' && CANONICAL_MIGRATION_IDENTITY.test(value);
