// tests/fixtures.ts
//
// 標準測試種子的常數匯出 —— 見 docs/integration/12-TESTING-TDD.md §1.3。
// 「所有整合/E2E 測試共用的已知世界」：id 全部寫死，測試直接 import 使用，
// 不要在測試裡自己現查 id。
//
// 這份常數描述的是 scripts/test/seed.mjs **打算**建立的資料。在 Phase 1
// （docs/integration/02-SUPABASE-SCHEMA.md 建表）完成、seed.mjs 真的能成功
// 寫入資料庫之前，這些 id 只是「保留好的字串」，資料庫裡還沒有對應的資料列。
//
// ⚠️ 這份檔案（TypeScript，給測試 import）與 scripts/test/seed.mjs（純
// JavaScript，用 Node 直接執行、不經 TS 編譯）在架構上是分開跑的兩支程式，
// 沒有一個共用的執行期模組可以互相 import（.mjs 種子腳本不方便依賴 tsx/
// ts-node 之類的額外工具，本任務也不允許 npm install）。
// 因此下面每一個 id 常數都在 scripts/test/seed.mjs 裡以「完全相同的字面值」
// 重複一份。**兩邊改動時必須同步更新**（seed.mjs 開頭有對應的提醒註解）。

export interface TestCredentials {
  email: string;
  password: string;
}

export const SHOP_A = {
  id: 'a1000000-0000-4000-8000-000000000001',
  shopCode: 'tenant-a',
  owner: {
    email: 'owner-a@test.local',
    password: 'Passw0rd!a',
  } satisfies TestCredentials,

  // 2 服務
  serviceA1: 'a1000000-0000-4000-8000-000000000011',
  serviceA2: 'a1000000-0000-4000-8000-000000000012',

  // 2 員工（services 可預約的服務人員列，非登入帳號 —— 登入帳號見 STAFF_A2）
  staffA1: 'a1000000-0000-4000-8000-000000000021',
  staffA2: 'a1000000-0000-4000-8000-000000000022',

  // 3 顧客
  customerA1: 'a1000000-0000-4000-8000-000000000031',
  customerA2: 'a1000000-0000-4000-8000-000000000032',
  customerA3: 'a1000000-0000-4000-8000-000000000033',

  // 4 預約：PENDING / CONFIRMED / COMPLETED / CANCELLED 各一
  bookingPending: 'a1000000-0000-4000-8000-000000000041',
  bookingConfirmed: 'a1000000-0000-4000-8000-000000000042',
  bookingCompleted: 'a1000000-0000-4000-8000-000000000043',
  bookingCancelled: 'a1000000-0000-4000-8000-000000000044',

  // 收款方式（tenant_payment_methods，10 分冊）—— §5 並發測試範例用到
  pmBankTransfer: 'a1000000-0000-4000-8000-000000000051',
} as const;

export const SHOP_B = {
  id: 'b2000000-0000-4000-8000-000000000001',
  shopCode: 'tenant-b',
  owner: {
    email: 'owner-b@test.local',
    password: 'Passw0rd!b',
  } satisfies TestCredentials,

  // 最小資料：專門用來驗證跨租戶隔離（見 §3 骨架「B 店帳號帶 A 店 id → 404」）
  customerB1: 'b2000000-0000-4000-8000-000000000031',
} as const;

/**
 * A 店員工帳號（role=STAFF）—— 驗證角色權限用。
 *
 * 判斷／待確認事項（12 分冊沒交代清楚，見本次任務回報）：
 *   - 12 分冊只給了 email，沒給密碼，這裡沿用 SHOP_A 的密碼慣例自訂一組。
 *   - 這個登入帳號（tenant_users 列，role=STAFF）與 SHOP_A.staffA2（services
 *     可預約的員工列）是兩個不同概念的表（見 02 分冊 §0004 staff vs
 *     tenant_users）。這裡讓兩者對應同一位「員工」，用 staffRowId 連過去，
 *     方便測試場景描述，但不是規格強制的對應關係。
 */
export const STAFF_A2 = {
  tenantId: SHOP_A.id,
  email: 'staff-a@test.local',
  password: 'Passw0rd!a2',
  role: 'STAFF',
  staffRowId: SHOP_A.staffA2,
} satisfies TestCredentials & { tenantId: string; role: string; staffRowId: string };

/**
 * 旅客帳號（Phase 9 起）。
 *
 * 判斷／待確認事項：12 分冊沒給密碼，這裡自訂一組（同上）。
 */
export const TRAVELER_1 = {
  email: 'traveler-1@test.local',
  password: 'Passw0rd!t1',
} satisfies TestCredentials;

/**
 * A 店行程：TRIP_A + 2 方案 + 3 團次（其中一團 capacity=2，供 §5 並發不超賣測試）。
 */
export const TRIP_A = {
  id: '7a000000-0000-4000-8000-000000000001',
  tenantId: SHOP_A.id,
  slug: 'trip-a-standard',

  planA1: '7a000000-0000-4000-8000-000000000011',
  planA2: '7a000000-0000-4000-8000-000000000012',

  departure1: '7a000000-0000-4000-8000-000000000021',
  departure2: '7a000000-0000-4000-8000-000000000022',
  /** capacity=2 的團次 —— 專供並發 checkout 測試（12 分冊 §5）。 */
  departureCap2: '7a000000-0000-4000-8000-000000000023',
} as const;
