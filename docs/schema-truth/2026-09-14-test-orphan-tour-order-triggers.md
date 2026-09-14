# TEST 孤兒物件：`tour_orders` 上兩個沒有出處的 trigger（2026-09-14）

## 一句話

TEST（`nmwhwngojosmagjuvxol`）的 `public.tour_orders` 上掛著兩個 trigger，
**canonical migration 沒有、overlay 沒有、Production 也沒有**，其中一個會在每次
INSERT 覆寫 `#41` 的付款欄位，直接讓 `0108` 的 canonical 驗收測試紅。本文件記下它們
被移除前的完整定義，移除是可逆的。

## 三邊查證（移除前實測，不是推測）

| 來源 | 有沒有這兩個物件 | 查證方式 |
|---|---|---|
| canonical migrations（`origin/main:supabase/migrations/**`） | 沒有 | `git grep` 兩個 function 名與兩個 trigger 名，整個 `origin/main` 零命中 |
| overlay（`supabase/local-migrations/**`）／docs／scripts | 沒有 | 同上，working tree 全域 `grep -rln` 零命中 |
| Production（`egehnijjpgijmccagxac`） | 沒有 | `pg_trigger` join `pg_class`，`tour_orders` 的非內部 trigger 回傳空陣列 |
| TEST（`nmwhwngojosmagjuvxol`） | **有兩個** | 同一條查詢回傳 `t_tour_order_payment_method_tenant`、`t_tour_orders_payment_policy_snapshot` |

也就是說：移除它們不是「刪掉一個來歷不明的東西」，而是**讓 TEST 回到 canonical 與
Production 都已經在的那個狀態**。四個來源裡有三個沒有它，只有 TEST 有。

## 為什麼非處理不可

`tests/integration/db/payment-state-model.41.test.ts` 在套完 `0107` CHECK、完整 `0108`
與所有 canonical 預設值之後，仍有 7 個案例紅。決定性的線索是
`AssertionError: expected 2000 to be +0`——測試明明插入 `upfront_required_amount = 0`，
讀回來卻是 `total_amount`。

`snapshot_tour_order_payment_policy` 是 `BEFORE INSERT`，它**無條件覆寫**
`new.deposit_mode_snapshot` 與 `new.upfront_required_amount`。四種紅法都由它解釋：

- 測試自己給的值被覆寫 → `expected 2000 to be +0`
- 測試預期某個值會被拒絕，結果被靜默換掉 → `expected null to be truthy`
- 被覆寫後的值撞上 `0108` 新加的 CHECK → 拿到 `23514` 而不是預期的 `22P02`
- 合法的 `PARTIAL` 也被覆寫成不合法的組合 → `expected { code: '23514' } to be null`

## 移除前的完整定義（要復原就用這一段）

```sql
CREATE OR REPLACE FUNCTION public.assert_tour_order_payment_method_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.payment_method_id is null then
    return new;
  end if;

  if not exists (
    select 1 from tenant_payment_methods pm
      where pm.id = new.payment_method_id
        and pm.tenant_id = new.tenant_id
        and pm.active = true
  ) then
    raise exception 'PAYMENT_METHOD_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

CREATE TRIGGER t_tour_order_payment_method_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, payment_method_id ON public.tour_orders
  FOR EACH ROW EXECUTE FUNCTION assert_tour_order_payment_method_tenant();

CREATE OR REPLACE FUNCTION public.snapshot_tour_order_payment_policy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_plan public.trip_plans%rowtype;
begin
  select * into v_plan from public.trip_plans
  where id = new.plan_id and tenant_id = new.tenant_id;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  new.deposit_mode_snapshot := v_plan.deposit_mode;
  new.upfront_required_amount := case v_plan.deposit_mode
    when 'NONE' then 0
    when 'DEPOSIT_FIXED' then v_plan.deposit_value
    when 'DEPOSIT_PERCENT' then pg_catalog.round(new.total_amount * v_plan.deposit_value / 100, 2)
    when 'FULL' then new.total_amount
  end;
  if new.upfront_required_amount < 0 or new.upfront_required_amount > new.total_amount then
    raise exception 'UPFRONT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

CREATE TRIGGER t_tour_orders_payment_policy_snapshot
  BEFORE INSERT ON public.tour_orders
  FOR EACH ROW EXECUTE FUNCTION snapshot_tour_order_payment_policy();
```

## 它們想做的事並沒有消失，只是還沒 canonical 化

兩個 trigger 的意圖都不是壞的：

- `assert_tour_order_payment_method_tenant` 想擋「引用別的租戶的收款方式」。
- `snapshot_tour_order_payment_policy` 想在建單當下把 `trip_plans.deposit_mode`
  的應收金額快照下來。

這兩件事如果要成為平台行為，**必須走 canonical migration → PR → CI → merge 到
`main`**，而不是以一個沒有出處的物件活在 TEST 裡。以現在的狀態，它們造成的實際效果
是相反的：`0108` 的誠實驗收測試永遠紅，而 Production 根本沒有這個行為——也就是說
TEST 正在驗一個 Production 不存在的規則。

## 移除範圍

只在 TEST 執行。**沒有**對 Production 做任何 DDL（Production 本來就沒有這兩個物件）。

---

# 第二項漂移：`tour_orders.payment_status` 在 TEST 是 `text`，不是 enum

## 怎麼被找到的——不是靠盤點，是靠一個沒有變綠的探針

移除上面兩個 trigger 之後，7 個紅的案例裡有 5 個轉綠，但這一個還是紅：

```
FAIL > 拒絕不在值域內的付款狀態
AssertionError: expected '23514' to be '22P02'
```

`22P02` 是「這個字串不是該 enum 的合法 label」，`23514` 是「CHECK 擋下來的」。
拿到 `23514` 只有一種解釋：**這個欄位根本不是 enum**，值域是靠一條 CHECK 在維持。

如果當時只看「trigger 拿掉了、大部分案例綠了」就收工，這一項會繼續留著——而它正是
`0108` 花了整支 migration 在擴充的那個 enum。

## 四邊查證

| 來源 | `tour_orders.payment_status` 的型別 |
|---|---|
| canonical `origin/main:supabase/migrations/0087_issue_8b_tour_orders.sql:71` | `public.tour_payment_status` |
| overlay `supabase/local-migrations/historical-integration-baseline/0026_*.sql:99` | `tour_payment_status` |
| Production（`egehnijjpgijmccagxac`） | `tour_payment_status` |
| TEST（`nmwhwngojosmagjuvxol`） | **`text`** + 一條非 canonical 的 `tour_orders_payment_status_check` |

四個來源裡三個是 enum，只有 TEST 是 text，而且多了一條整個 repo 反查零命中的 CHECK
（`tour_orders_payment_status_check`）。同一張表上 `status` 與 `source` 都好好地是
enum——只有 `payment_status` 一欄被換掉，這是人工改動的形狀，不是任何安裝路徑的產物。

## 為什麼 `0108` 沒有抓到

`0108` 的後置斷言（PB-026 的教訓：套用成功 ≠ 欄位真的長成這樣）檢查了**本檔新增的
三個欄位**的型別與 nullability，但**沒有檢查 `payment_status` 自己**。於是出現這個
局面：一支專門在替 `tour_payment_status` 補 `PARTIAL` / `REFUND_PENDING` 兩個 label
的 migration，成功套用在一個根本沒有在用那個 enum 的欄位上，而且全程零告警。

這是 PB-026 的變形，值得單獨記一筆：**後置斷言只檢查自己新增的東西，不檢查自己所
依賴的東西**。`0108` 依賴「`payment_status` 是 `tour_payment_status`」這個前提，卻
沒有斷言它。

`0107` / `0108` 也都沒有斷言欄位的 **default**（先前 `min_to_depart_snapshot` 少了
default 是同一個缺口），這兩個缺口應一併補。

## TEST 的修復（只動 TEST，Production 未執行任何 DDL）

目標形狀完全取自 canonical，沒有自創任何東西：

1. 刪掉 6 條引用 `payment_status` 的 CHECK（含非 canonical 的
   `tour_orders_payment_status_check`，以及 overlay 別名
   `tour_orders_payment_amounts_nonnegative`）。
2. `alter column payment_status type public.tour_payment_status using
   payment_status::public.tour_payment_status`，並把 default 設回
   `'UNPAID'::public.tour_payment_status`。
3. 依 canonical 逐字加回：`tour_orders_paid_amount_consistent`（0087）、
   `tour_orders_partial_paid_amount_ck` / `tour_orders_refund_pending_paid_amount_ck` /
   `tour_orders_refunded_paid_amount_ck` / `tour_orders_unpaid_amount_ck`（0108，
   全部保留 canonical 的 `payment_status::text <> '…'` 寫法）。
4. **不**加回 `tour_orders_payment_status_check`——enum 型別本身就是值域，那條
   CHECK 是 text 時代的替代品，canonical 沒有它。

前置條件都實測過：`tour_orders` 0 列、沒有依賴此欄位的 view、沒有依賴此欄位的
index，因此 `add constraint` 的既有列驗證沒有風險。

## 修復後的驗證（同一個 DO block 探針，結束時 raise 讓整段回滾，不留資料）

| 探針 | 修復前 | 修復後 | 對應的紅測試 |
|---|---|---|---|
| P1 合法插入 `PARTIAL` | `FAIL(23514)` | `OK` | 接受合法的付款狀態 PARTIAL |
| P2 明確給 `upfront_required_amount = 0` | 讀回 `2000` | 讀回 `0`、`mode=<null>` | 新欄位的預設值誠實地代表「還沒有任何金流資訊」 |
| P3 值域外的 `payment_status` | `23514` | **`22P02`** | 拒絕不在值域內的付款狀態 |
| P4 負數 `upfront_required_amount` | `23514` | `23514` | upfront_required_amount 不得為負數 |
| P5 `REFUNDED` + 金額佐證 | — | `OK` | M1 誠實 CHECK |
| P6 `REFUND_PENDING` + `paid_amount > 0` | — | `OK` | §9.3 前提 |

回滾後 `tour_orders` 仍為 0 列。

## 尚未處理、已知仍在的 TEST 漂移

- `tour_orders_balance_due_nonnegative_check` / `tour_orders_balance_due_hours_snapshot_check` /
  `tour_orders_balance_collection_mode_snapshot_check`：對應 §9 的
  `balance_due` / `balance_due_hours_snapshot` / `balance_collection_mode_snapshot`
  欄位。**這與 `.github/workflows/agent-schema-bootstrap.yml` 的
  `future_issue_41_fields_absent` 斷言直接衝突**——該斷言主張這些欄位在環境裡不存在，
  但 TEST 上有以它們為條件的 CHECK，代表欄位是存在的。需要單獨判定：是收緊 bootstrap
  斷言，還是把這些欄位一起清掉。
- `tour_orders_deposit_mode_snapshot_check`：與 canonical 的
  `tour_orders_deposit_mode_snapshot_ck` 同語意但不允許 null 的重複品，canonical 零命中。
- 殘留欄位 `formation_risk_accepted_participants` / `formation_decision` /
  `formation_decision_note` / `formation_transition_revision`。
