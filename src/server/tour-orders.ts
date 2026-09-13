/**
 * src/server/tour-orders.ts — 旅遊訂單的共用讀取組裝（#8-B）
 * -----------------------------------------------------------------------------
 * `tour_orders` 只存 id 外鍵；畫面要的是行程名稱、方案名稱、出發日期、收款方式
 * 顯示名稱。這裡把那四個關聯值一次補齊。
 *
 * ⚠️ 刻意**不用 PostgREST embed**（`trips(title)` 這種寫法）：0067 為 tenant-aware
 * 完整性加了複合 FK，於是同一組關聯在 canonical 建表與整合測試的 historical
 * overlay 建表下產生的 constraint 名稱不同，`!fk_name` hint 會在其中一邊解不開，
 * 而 PostgREST 解不開時回的是 error、`data` 為 null —— 疊上 `const { data } = await`
 * 就變成靜默的「查無資料」（PB-023 ＋ PB-024，兩者本輪都因此紅過 CI）。
 * 多兩趟 `.in()` 查詢換兩種安裝路徑都正確，值得。
 */
import { mapTourOrder } from './mappers';
import type { TourOrder } from '@/lib/types';

type AnyClient = {
  from: (table: string) => any;
};

/** 一批 tour_orders 列 → TourOrder[]，關聯值以 3 趟 `.in()` 查詢補齊 */
export async function hydrateTourOrders(
  supabase: AnyClient, tenantId: string, rows: any[],
): Promise<TourOrder[]> {
  if (!rows.length) return [];

  const ids = <T,>(list: (T | null | undefined)[]): T[] =>
    [...new Set(list.filter((v): v is T => v != null))];

  const tripIds = ids(rows.map((r) => r.trip_id));
  const planIds = ids(rows.map((r) => r.plan_id));
  const departureIds = ids(rows.map((r) => r.departure_id));

  const [trips, plans, departures] = await Promise.all([
    tripIds.length
      ? supabase.from('trips').select('id, title').eq('tenant_id', tenantId).in('id', tripIds)
      : { data: [], error: null },
    planIds.length
      ? supabase.from('trip_plans').select('id, name').eq('tenant_id', tenantId).in('id', planIds)
      : { data: [], error: null },
    departureIds.length
      ? supabase.from('trip_departures').select('id, departs_on, start_time')
        .eq('tenant_id', tenantId).in('id', departureIds)
      : { data: [], error: null },
  ]);

  // 這三趟查詢失敗時**不吞掉**：查不到名稱與「查詢壞了」不是同一件事（PB-023）。
  for (const result of [trips, plans, departures]) {
    if (result.error) throw result.error;
  }

  const titleById = new Map<string, string>(
    (trips.data ?? []).map((r: any) => [r.id, String(r.title ?? '')]),
  );
  const planById = new Map<string, string>(
    (plans.data ?? []).map((r: any) => [r.id, String(r.name ?? '')]),
  );
  const departureById = new Map<string, { departsOn: string; startTime: string }>(
    (departures.data ?? []).map((r: any) => [r.id, {
      departsOn: r.departs_on ?? '',
      startTime: r.start_time == null ? '' : String(r.start_time).slice(0, 5),
    }]),
  );
  return rows.map((r) => {
    const departure = departureById.get(r.departure_id);
    return mapTourOrder(r, {
      tripTitle: titleById.get(r.trip_id) ?? '',
      planName: planById.get(r.plan_id) ?? '',
      departsOn: departure?.departsOn ?? '',
      startTime: departure?.startTime ?? '',
      /**
       * ⚠️ 永遠回空字串，而且這是刻意的。
       *
       * 10 分冊 §4 說「設定 UI 已存在：/tenant/payment-methods 頁支援六種收款
       * 類型」——那一頁確實存在，但它讀的是**頁內的 MOCK_METHODS 常數**，
       * `tenant_payment_methods` 表在整個 supabase/migrations 裡零命中，
       * 也沒有任何 /api/payment-methods 路由。收款方式整條鏈路還沒有後端。
       *
       * 所以這裡沒有名稱可查。硬編一個「現金」或回 payment_method_id 的原字串，
       * 都是把「查不到」偽裝成「查到了」。回空字串，畫面就會誠實地空著。
       * 那條鏈路落地後，這裡補一趟查詢即可，欄位與型別都不用動。
       */
      paymentMethodLabel: '',
    });
  });
}
