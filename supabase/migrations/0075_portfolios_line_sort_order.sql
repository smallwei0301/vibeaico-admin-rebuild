-- #7 — restore the portfolio page's "LINE 顯示順序" independent ordering
-- instead of leaving it disabled. Owner-authorized, additive-only migration:
-- one new not-null-with-default column on the existing portfolios table
-- (0005:61-70). Nothing existing is renamed, dropped, or narrowed, so every
-- already-migrated environment stays valid without a backfill step.
--
-- Schema drift note (Sol audit, 2026-09-04, via read-only Supabase
-- Management API query): both TEST (nmwhwngojosmagjuvxol) and PRODUCTION
-- (egehnijjpgijmccagxac) already carry this exact column
-- (line_sort_order integer not null default 0), applied outside the
-- migration ledger by an unknown prior process — same pattern as the
-- block_times drift fixed by 0074. This file's job on those two projects is
-- to be a true no-op that lets the repo's migration history match live
-- schema — NOT to change Production. The statement is idempotent
-- (add column if not exists) so a fresh database, TEST, and Production all
-- converge on the identical result whether or not the column was already
-- there.
--
-- Semantics (see docs/integration/13-BUSINESS-MODES.md /
-- src/app/api/portfolios/route.ts for the read/write contract):
--   line_sort_order — the portfolio wall's LINE 作品瀏覽 display order,
--   independent from `sort_order` (公開頁順序). Written only via
--   POST /api/portfolios/reorder-line ({ids}, index-assigned), the same
--   shape as /api/portfolios/reorder for sort_order. No RPC/function/trigger
--   is introduced here — both reorder endpoints are plain application-layer
--   UPDATE statements scoped by tenant_id, matching the existing
--   /api/portfolios/reorder implementation.

alter table public.portfolios
  add column if not exists line_sort_order integer not null default 0;
