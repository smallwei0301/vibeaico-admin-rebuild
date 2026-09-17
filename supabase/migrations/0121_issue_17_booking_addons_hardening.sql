-- 0121 — issue #17（補齊-2）：booking_addons 原子化 create/delete + C+ 業績語意 + idempotency。
--
-- 現況（2026-09-16 issue 重新盤點）：`booking_addons` 的表本身只存在於
-- `supabase/local-migrations/historical-integration-baseline/0020_booking_addons.sql`
-- （COMPATIBILITY_ONLY overlay，見 `docs/schema-truth/2026-09-12-fresh-install-baseline.md`），
-- canonical `supabase/migrations/` 只有 `0082_reconcile_booking_addon_notify_fields.sql`
-- 這支「表已存在」前提下的欄位收斂。本檔是 current main 第一支**假設表存在**、
-- 在其上補 C+/idempotency/notification 欄位與 create/delete 原子 RPC 的正式 forward
-- migration；不改寫 0020／0082 任何一行既有內容。
--
-- 三組新增欄位，直接對齊 issue #17 §5 Slice A 的裁示：
--
-- ① C+ 業績語意（三態，不得用 staff_id=null 同時代表 INHERIT 與 NONE）：
--    performance_mode        INHERIT | SPECIFIC_STAFF | NONE
--    performance_staff_id    nullable，SPECIFIC_STAFF 時必填且須為同租戶合法 staff；
--                             INHERIT 時由 create rpc 在寫入當下 snapshot 該筆預約的
--                             staff_id（可能仍是 null＝該預約本來就未指定人員）；
--                             NONE 時固定為 null。
--    （既有 `staff_id` 欄位維持 0020 的原意：「執行人員」的紀錄，不參與業績歸戶。）
--
-- ② 冪等收據：
--    idempotency_key         同租戶內唯一（見下方部分唯一索引）；
--    deleted_at               軟刪除時間戳。**刪除一律軟刪，不 hard delete**——
--                             若刪除後把列砍掉，`idempotency_key` 的唯一索引會跟著消失，
--                             同一把 key 重送就會被誤判成「新請求」而重新加一次金額，
--                             正是 issue §6 明講「create → delete → same key replay 不得
--                             復活」要擋的洞。軟刪讓那把 key 永遠留在唯一索引裡。
--
-- ③ 通知意圖（與 #40 owns 的送達真相分開）：
--    notification_requested  這一筆加購當初「有沒有要求通知」的意圖（勾選框狀態）。
--    既有 `notified`（0082 已收斂）維持「實際發生的結果」語意不變，兩欄語意不重疊：
--    `notification_requested=false` 時 `notified` 必為 'NONE'。

alter table public.booking_addons
  add column if not exists performance_mode text not null default 'INHERIT',
  add column if not exists performance_staff_id uuid references public.staff(id) on delete set null,
  add column if not exists idempotency_key text,
  add column if not exists notification_requested boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_addons_performance_mode_check'
      and conrelid = 'public.booking_addons'::regclass
  ) then
    alter table public.booking_addons
      add constraint booking_addons_performance_mode_check
      check (performance_mode = any (array['INHERIT'::text, 'SPECIFIC_STAFF'::text, 'NONE'::text]));
  end if;
end
$$;

-- SPECIFIC_STAFF 必須帶 performance_staff_id；NONE 必須是 null（INHERIT 允許 null，
-- 因為它可能 snapshot 到一筆本來就沒指定人員的預約）。避免日後有其他寫入路徑
-- 繞過 rpc 寫出「模式與欄位互相矛盾」的列。
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_addons_performance_consistency_check'
      and conrelid = 'public.booking_addons'::regclass
  ) then
    alter table public.booking_addons
      add constraint booking_addons_performance_consistency_check
      check (
        (performance_mode = 'SPECIFIC_STAFF' and performance_staff_id is not null)
        or (performance_mode = 'NONE' and performance_staff_id is null)
        or (performance_mode = 'INHERIT')
      );
  end if;
end
$$;

-- 同租戶內唯一；跨租戶允許同一把字面 key（route 一律以伺服器端 tenant_id 過濾，
-- 但索引本身也是一道不可繞過的邊界——即使呼叫端傳錯 tenant_id，也不會撞到別家店
-- 的收據）。部分索引只管「未刪除或已刪除都算數」——即已存在的 key 永遠佔用，
-- 是③段落解釋的軟刪理由。
create unique index if not exists ux_booking_addons_tenant_idempotency
  on public.booking_addons (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- 明細列表一律只看「未刪除」，這個部分索引取代 0020 的全列索引在這個查詢形狀上的角色
-- （0020 的 i_booking_addons_booking 仍保留，供含已刪除列的稽核/收據查詢使用）。
create index if not exists i_booking_addons_booking_active
  on public.booking_addons (tenant_id, booking_id, created_at)
  where deleted_at is null;

/* ============================================================================
 * create_booking_addon — 原子完成：驗證 → 認領 idempotency key → insert → 套用
 * 到 bookings.final_price / duration_minutes / end_at → commit。任一步失敗全部
 * 回滾（plpgsql 函式本身就是一個交易）。
 *
 * 金額/數量規則（Owner 已裁示，見 issue #17）：
 *   price = 0 允許；price < 0 拒絕；quantity <= 0 拒絕。
 *
 * 冪等規則：
 *   同一把 (tenant_id, idempotency_key) 已有收據（不論該筆後來是否已軟刪）→
 *   直接回放原本的結果，不重新套用金額/時長，也不因此重新驗證 booking/staff。
 *   併發送出同一把 key：兩者都可能通過「查無既有收據」而同時嘗試 insert，
 *   由 unique index 讓其中一個 23505 → catch 後回放勝出者的收據（見下方 exception）。
 * ========================================================================== */
create or replace function public.create_booking_addon(
  p_tenant                 uuid,
  p_booking                uuid,
  p_idempotency_key        text,
  p_service_id             uuid,
  p_name                   text,
  p_price                  numeric,
  p_quantity               int,
  p_duration_minutes       int,
  p_staff_id               uuid,
  p_performance_mode       text,
  p_performance_staff_id   uuid,
  p_notification_requested boolean
) returns table (
  addon_id           uuid,
  applied_amount     numeric,
  applied_minutes    int,
  final_price        numeric,
  duration_minutes   int,
  end_at             timestamptz,
  performance_mode   text,
  performance_staff_id uuid,
  replayed           boolean
) as $$
declare
  v_booking   record;
  v_existing  public.booking_addons;
  v_addon_id  uuid;
  v_resolved_staff uuid;
  v_applied_amount numeric;
  v_applied_minutes int;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0003';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0003';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'PRICE_INVALID' using errcode = 'P0003';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'QUANTITY_INVALID' using errcode = 'P0003';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 0 then
    raise exception 'DURATION_INVALID' using errcode = 'P0003';
  end if;
  if p_performance_mode is null or p_performance_mode not in ('INHERIT', 'SPECIFIC_STAFF', 'NONE') then
    raise exception 'PERFORMANCE_MODE_INVALID' using errcode = 'P0003';
  end if;
  if p_performance_mode = 'SPECIFIC_STAFF' and p_performance_staff_id is null then
    raise exception 'PERFORMANCE_STAFF_REQUIRED' using errcode = 'P0003';
  end if;

  -- 冪等回放：查無既有收據才往下做任何驗證/鎖定，一般重複點擊在這裡就結束，
  -- 不會多鎖一次 booking 列。
  select * into v_existing from public.booking_addons
   where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
  if found then
    return query
      select v_existing.id, v_existing.applied_amount, v_existing.applied_minutes,
             b.final_price, b.duration_minutes, b.end_at,
             v_existing.performance_mode, v_existing.performance_staff_id, true
        from public.bookings b
       where b.id = v_existing.booking_id and b.tenant_id = p_tenant;
    return;
  end if;

  -- 鎖住 booking 列：序列化同一筆預約上的併發加購，且讓 INHERIT 的 staff_id
  -- snapshot 讀到的是「當下」而不是交易開始前的舊值。
  --
  -- ⚠️ 這裡的欄位一律要用 `b.` 明確限定：`final_price`／`duration_minutes`／
  -- `end_at` 同時也是本函式 `returns table (...)` 宣告的 OUT 參數名稱，
  -- plpgsql 會把它們同時當成區域變數。不限定 table alias 時 Postgres 判斷
  -- 不出該用哪一個，直接丟 42702（ambiguous column reference），這正是本次
  -- CI 12 個測項全部收斂成 500 的唯一成因（見 commit 說明的實測 psql 錯誤）。
  select b.id, b.staff_id, b.final_price, b.duration_minutes, b.end_at into v_booking
    from public.bookings b
   where b.id = p_booking and b.tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_staff_id is not null and not exists (
    select 1 from public.staff where id = p_staff_id and tenant_id = p_tenant
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_performance_mode = 'SPECIFIC_STAFF' then
    if not exists (
      select 1 from public.staff where id = p_performance_staff_id and tenant_id = p_tenant
    ) then
      raise exception 'PERFORMANCE_STAFF_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_resolved_staff := p_performance_staff_id;
  elsif p_performance_mode = 'INHERIT' then
    v_resolved_staff := v_booking.staff_id;
  else
    v_resolved_staff := null;
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.services where id = p_service_id and tenant_id = p_tenant
  ) then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 加購價 × 數量＝這一次要套用到 final_price 的金額（0020 檔頭已定案的規則）；
  -- 時長本身是「這次加購總共佔用多久」的單一選擇（addonDuration 下拉），不隨
  -- 數量倍增——耗材買 3 條「不佔時間」還是不佔時間，不會變成佔 3 份時間。
  v_applied_amount := p_price * p_quantity;
  v_applied_minutes := p_duration_minutes;

  begin
    insert into public.booking_addons (
      tenant_id, booking_id, service_id, name, price, quantity, duration_minutes,
      staff_id, applied_amount, applied_minutes, performance_mode, performance_staff_id,
      idempotency_key, notification_requested, notified
    ) values (
      p_tenant, p_booking, p_service_id, p_name, p_price, p_quantity, p_duration_minutes,
      p_staff_id, v_applied_amount, v_applied_minutes, p_performance_mode, v_resolved_staff,
      p_idempotency_key, coalesce(p_notification_requested, false), 'NONE'
    )
    returning id into v_addon_id;
  exception when unique_violation then
    -- 兩個併發請求都通過了上面「查無既有收據」，其中一個先 insert 成功，
    -- 另一個在這裡撞到 unique index：回放贏家的收據，不重複套用金額/時長。
    select * into v_existing from public.booking_addons
     where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
    return query
      select v_existing.id, v_existing.applied_amount, v_existing.applied_minutes,
             b.final_price, b.duration_minutes, b.end_at,
             v_existing.performance_mode, v_existing.performance_staff_id, true
        from public.bookings b
       where b.id = v_existing.booking_id and b.tenant_id = p_tenant;
    return;
  end;

  -- 由資料庫自己讀自己算（自加），不接受呼叫端算好的絕對值——理由同 0090。
  -- end_at 隨 applied_minutes 位移；exclude 約束（0004 x_bookings_overlap）若因此
  -- 與其他預約重疊會在這裡直接 raise 23P01，交易整筆回滾（route 對映成 409）。
  update public.bookings
     set final_price      = bookings.final_price + v_applied_amount,
         duration_minutes = bookings.duration_minutes + v_applied_minutes,
         end_at           = bookings.end_at + make_interval(mins => v_applied_minutes),
         updated_at       = now()
   where id = p_booking and tenant_id = p_tenant;

  return query
    select v_addon_id, v_applied_amount, v_applied_minutes,
           b.final_price, b.duration_minutes, b.end_at,
           p_performance_mode, v_resolved_staff, false
      from public.bookings b
     where b.id = p_booking and b.tenant_id = p_tenant;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.create_booking_addon(
  uuid, uuid, text, uuid, text, numeric, int, int, uuid, text, uuid, boolean
) from public;
revoke all on function public.create_booking_addon(
  uuid, uuid, text, uuid, text, numeric, int, int, uuid, text, uuid, boolean
) from anon, authenticated;
grant execute on function public.create_booking_addon(
  uuid, uuid, text, uuid, text, numeric, int, int, uuid, text, uuid, boolean
) to service_role;

/* ============================================================================
 * delete_booking_addon — 只回沖該筆加購自己的 applied_amount/applied_minutes，
 * 不重算整張 booking，也不影響其他加購或後續的手動調價。
 *
 * 併發/重送保護：先鎖住該筆 booking_addons 列（`for update`）。第二個併發刪除
 * 或同一次重送的重試會在鎖上排隊，等第一個 commit 後看到 deleted_at 已非 null，
 * 直接回放「已刪除」而不二次回沖——這正是 issue §6「delete concurrent/replay
 * 不造成二次回沖」要擋的洞。
 * ========================================================================== */
create or replace function public.delete_booking_addon(
  p_tenant uuid,
  p_addon  uuid
) returns table (
  final_price      numeric,
  duration_minutes int,
  end_at           timestamptz,
  already_deleted  boolean
) as $$
declare
  v_addon   public.booking_addons;
begin
  select * into v_addon from public.booking_addons
   where id = p_addon and tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'ADDON_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_addon.deleted_at is not null then
    return query
      select b.final_price, b.duration_minutes, b.end_at, true
        from public.bookings b
       where b.id = v_addon.booking_id and b.tenant_id = p_tenant;
    return;
  end if;

  perform 1 from public.bookings
   where id = v_addon.booking_id and tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.booking_addons
     set deleted_at = now(), updated_at = now()
   where id = p_addon and tenant_id = p_tenant;

  -- greatest(...,0) 只是併發下界的最後一道防線（見檔頭「不得因競爭降成負數」）；
  -- 正常情況下每筆加購都嚴格回沖自己當初套用的那個精確數字，理當不會觸底。
  update public.bookings
     set final_price      = greatest(bookings.final_price - v_addon.applied_amount, 0),
         duration_minutes = greatest(bookings.duration_minutes - v_addon.applied_minutes, 0),
         end_at           = bookings.end_at - make_interval(mins => v_addon.applied_minutes),
         updated_at       = now()
   where id = v_addon.booking_id and tenant_id = p_tenant;

  return query
    select b.final_price, b.duration_minutes, b.end_at, false
      from public.bookings b
     where b.id = v_addon.booking_id and b.tenant_id = p_tenant;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.delete_booking_addon(uuid, uuid) from public;
revoke all on function public.delete_booking_addon(uuid, uuid) from anon, authenticated;
grant execute on function public.delete_booking_addon(uuid, uuid) to service_role;
