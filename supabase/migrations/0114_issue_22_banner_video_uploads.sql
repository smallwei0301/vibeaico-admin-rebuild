-- 0114 — Issue #22 Part A：banner video 兩階段上傳（presign／confirm／delete）
-- ============================================================================
-- `docs/integration/04-API-CONTRACTS.md` §A-1.1 原本明講「本輪刻意不實作」的
-- 三支端點；本檔是那個「另一輪」的落地。
--
-- 設計決策（寫在這裡，供 04 分冊與稽核追溯）：
--   - `banner-videos` bucket：public=true（公開頁 `<video>` 要能直接播放，與其他
--     公開圖片 bucket 同一套道理），file_size_limit=52428800（50 MiB），
--     allowed_mime_types 只收 video/mp4、video/webm——三者皆與 `presign` 端點的
--     伺服器端二次檢查一致（bucket 層是最後一道防線，不是唯一一道）。
--   - **刻意不**在 `storage.objects` 的 `p_storage_write`／新政策裡開放
--     authenticated 對這個 bucket 的直接 INSERT：兩階段上傳整條路徑
--     （presign → 直傳 → confirm）都是靠 `createSignedUploadUrl()` 核發的
--     一次性簽名 token 授權，那把 token 由 service role 簽發，上傳本身不經過
--     `storage.objects` RLS 判斷——所以這裡不需要、也不應該額外開一條
--     authenticated 直寫側門（那正是 #402 才剛關掉的同一種洞）。
--   - `banner_video_pending_uploads`：presign 當下就記一列（tenant_id、
--     storage_path、created_at），confirm 成功後補 confirmed_at。**孤兒清理**
--     （cron，見 `src/server/banner-video.ts` 的 `cleanupOrphanedBannerVideoUploads`）
--     依這張表找出「已 presign 但超過 24 小時仍未 confirm」的列，一併砍 Storage
--     物件與這張表的列——24 小時的理由：50 MiB 影片在正常網路下不需要那麼久，
--     但要放寬給店家在表單填到一半、之後才回來完成上傳的情境，不宜訂得比一次
--     使用者操作階段更短；同時遠短於「無限累積」，符合 CLAUDE.md 對 cron 一貫
--     要求的 bounded 語意（比照 0113 的 180 天 retention，只是這裡是分鐘級操作
--     而非長期保存資料，尺度不同）。
--   - 這張表**沒有**對 authenticated/anon 開放任何 policy——寫入／查詢／清理一律
--     走 service role（`createAdminSupabase()`），與 `page_view_events`／
--     `welcome_card_image_retirements` 同一套「租戶不需要、也不該直接碰內部記帳
--     表」的立場；`confirm`／`delete` 的租戶邊界改由 route 內
--     `tenant_id = t.tenantId` 的查詢條件與 storage path 前綴雙重把關。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('banner-videos', 'banner-videos', true, 52428800, array['video/mp4', 'video/webm']::text[])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.banner_video_pending_uploads (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  storage_path  text not null unique,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz
);

-- PB-026：`create table if not exists` 對既有同名異形表會靜默跳過，把形狀檢查
-- 變成大聲失敗（同 0113 的做法）。
do $$
declare
  r record;
  v_actual text;
begin
  for r in select * from (values
      ('tenant_id', 'uuid'),
      ('storage_path', 'text'),
      ('created_at', 'timestamp with time zone'),
      ('confirmed_at', 'timestamp with time zone')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'banner_video_pending_uploads'
       and column_name = r.col;
    if v_actual is null then
      raise exception 'banner_video_pending_uploads.% missing — existing table has an incompatible shape', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'banner_video_pending_uploads.% is % — expected % (existing table has an incompatible shape)',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;
end $$;

-- 孤兒清理的主要查詢形狀：未 confirm 且超過保留視窗的列。
create index if not exists idx_banner_video_pending_uploads_orphan
  on public.banner_video_pending_uploads (created_at)
  where confirmed_at is null;

alter table public.banner_video_pending_uploads enable row level security;
-- 刻意沒有任何 policy：租戶（authenticated）與匿名一律讀不到、寫不到這張表，
-- 只有 service role（繞過 RLS）存取得到，見檔頭。
