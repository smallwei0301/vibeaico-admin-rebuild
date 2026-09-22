-- 0131 — Issue #37 真缺口 A：assignment persistence 不是原子交易。
--
-- `src/server/departure-staff.ts` 的 `writeAssignment()` 目前是兩次獨立的
-- PostgREST 呼叫：
--
--   DELETE trip_departure_staff WHERE tenant_id = :t AND departure_id = :d
--   INSERT 新的 PRIMARY／ASSISTANT 列
--
-- 兩者不在同一個 DB 交易裡。DELETE 成功、INSERT 失敗（併發撞號、FK 違反、
-- 網路中斷、DB 錯誤）時，這團會被留在「舊指派已刪、新指派沒進去」的狀態——
-- 一個已上線的功能（導遊／人員排班）真的會憑空把一團的指派清空。這與本檔
-- 0090（`redeem_booking_points`）、0119（`confirm_owner_notify_bind`）修的
-- 是同一種病：「先查/先刪，再寫」在應用層跨兩次請求時不是原子操作。
--
-- 本檔只新增一支 SECURITY DEFINER RPC 把整段收進單一交易，**不修改**
-- `src/server/departure-staff.ts` 或任何呼叫端——接線是後續切片的範圍
-- （見 issue #37 本切片的 PR 說明）。plpgsql 函式本體本身就是一個交易，
-- 函式內任何一步 raise，前面已執行的 delete／insert 全部回滾，不會再出現
-- 「刪了沒插」的中間狀態。
--
-- 驗證規則照搬 `src/server/departure-staff.ts` 現行的業務規則（同檔頭註解
-- 與 `assertStaffBelongsToTenant()`），搬進 DB 端只是把它們變成同一交易內
-- 的守門，不改變語意：
--
--   1. departure 必須屬於 p_tenant（租戶隔離；這支函式是 security definer，
--      繞過 RLS，租戶隔離必須在函式本體自己做）。
--   2. `for update` 鎖住 departure 列，關閉「兩個管理者同時改派」的 TOCTOU
--      窗口——鎖的意義不是保護 departure 本身的欄位，而是讓同一團的兩次
--      並發改派彼此排隊，不會同時各自算出「目前沒有主導遊」而都通過驗證。
--   3. 每一位 staff id 都必須屬於同租戶、active、bookable（
--      `assertStaffBelongsToTenant()` 的既有規則），跨租戶或不可接案的 id
--      一律拒絕。
--   4. 最多一位 PRIMARY；PRIMARY 與 ASSISTANT 之間、ASSISTANT 彼此之間都
--      不得重複同一位 staff（`resolveAssignment()` 的既有規則：同一位導遊
--      不能同時是主導遊與協同導遊；`assistantStaffIds` 本身也不得重複）。
--
-- ⚠️ 0/1/2+ 自動適應、OPEN 團次必須有 PRIMARY 等**商業規則**（issue #37 §3）
-- 刻意不搬進這支函式——那些規則需要讀「目前有幾位 bookable 員工」與
-- 「這團的目前狀態」，屬於 `resolveAssignment()` 已經在做、且已有專屬單元
-- 測試涵蓋的純函式邏輯。這支 RPC 只負責「把已經算好的指派結果原子地寫進
-- DB」，不重新實作一次上層的業務判斷——兩邊分別維護同一條規則，只會製造
-- 「服務層判定可以存、DB 判定不行」或反過來的分歧。
--
-- ⚠️ 撞班檢查（`checkAssignmentConflicts()`／`findStaffConflicts()`）同樣
-- 刻意留在應用層：那段查詢橫跨 bookings／block_times／shifts／其他團次
-- 四張表且有整日／台北時區換算等大量邏輯，屬於 `staff-availability.ts` 已
-- 測試涵蓋的共用引擎，不在本切片的原子性缺口範圍內重寫成 SQL。

create or replace function public.replace_trip_departure_staff(
  p_tenant     uuid,
  p_departure  uuid,
  p_primary    uuid,
  p_assistants uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assistants uuid[] := coalesce(p_assistants, '{}'::uuid[]);
  v_staff_id   uuid;
  v_seen       uuid[] := '{}'::uuid[];
begin
  if p_tenant is null or p_departure is null then
    raise exception 'INVALID_ARGUMENTS' using errcode = 'P0003';
  end if;

  -- 鎖住這團，讓同一團的並發改派彼此排隊（見檔頭 #2）。
  perform 1 from public.trip_departures
   where id = p_departure and tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 同一位 staff 不得同時是 PRIMARY 又出現在 assistants 裡（見檔頭 #4）。
  if p_primary is not null and p_primary = any(v_assistants) then
    raise exception 'DUPLICATE_STAFF_ASSIGNMENT' using errcode = 'P0003';
  end if;

  -- assistants 陣列內部不得重複同一位 staff。
  foreach v_staff_id in array v_assistants loop
    if v_staff_id = any(v_seen) then
      raise exception 'DUPLICATE_STAFF_ASSIGNMENT' using errcode = 'P0003';
    end if;
    v_seen := array_append(v_seen, v_staff_id);
  end loop;

  -- 每一位涉及的 staff 都必須同租戶、active、bookable（見檔頭 #3；語意搬自
  -- `src/server/departure-staff.ts` 的 `assertStaffBelongsToTenant()`）。
  if p_primary is not null and not exists (
    select 1 from public.staff
     where id = p_primary and tenant_id = p_tenant and active and bookable
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1
      from unnest(v_assistants) as a(staff_id)
     where not exists (
       select 1 from public.staff s
        where s.id = a.staff_id and s.tenant_id = p_tenant and s.active and s.bookable
     )
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 先刪後插，同一交易內完成（0092 的既有唯一約束——
  -- (tenant_id, departure_id, staff_id) 與 one_primary_staff_per_departure
  -- partial unique index——仍是最終防線；這裡的驗證只是為了提前回一個
  -- 可讀錯誤，不是取代它們）。
  delete from public.trip_departure_staff
   where tenant_id = p_tenant and departure_id = p_departure;

  if p_primary is not null then
    insert into public.trip_departure_staff (tenant_id, departure_id, staff_id, role)
    values (p_tenant, p_departure, p_primary, 'PRIMARY');
  end if;

  if array_length(v_assistants, 1) is not null then
    insert into public.trip_departure_staff (tenant_id, departure_id, staff_id, role)
    select p_tenant, p_departure, a.staff_id, 'ASSISTANT'
      from unnest(v_assistants) as a(staff_id);
  end if;
end;
$$;

-- 同 0087／0119 的三段式撤權：PostgreSQL 對新函式預設把 EXECUTE 授權給
-- PUBLIC，anon/authenticated 都是 PUBLIC 成員，漏撤 PUBLIC 等於側門沒關。
-- 這支函式是 security definer、會繞過 RLS 直接改派，前端持有的 anon／
-- authenticated token 不得直接呼叫，只能由 server route 的 service_role
-- 呼叫（見檔頭：本檔刻意不接線任何呼叫端，接線 PR 會走既有 MANAGER 權限
-- 檢查的 server route）。
revoke all on function public.replace_trip_departure_staff(uuid, uuid, uuid, uuid[]) from public;
revoke all on function public.replace_trip_departure_staff(uuid, uuid, uuid, uuid[]) from anon, authenticated;
grant execute on function public.replace_trip_departure_staff(uuid, uuid, uuid, uuid[]) to service_role;
