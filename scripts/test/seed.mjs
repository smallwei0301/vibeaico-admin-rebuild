#!/usr/bin/env node
// scripts/test/seed.mjs
//
// 見 docs/integration/12-TESTING-TDD.md §1.3「標準測試種子」。建立
// SHOP_A / SHOP_B / STAFF_A2 / TRAVELER_1 / TRIP_A 的固定資料。
//
// ⚠️ 這裡的每一個 id 常數都必須跟 tests/fixtures.ts **完全一致**（見該檔開頭
// 說明：兩邊分屬 .mjs 執行期腳本與 .ts 測試常數，沒有共用模組可以互相
// import，只能手動保持同步）。改其中一邊記得改另一邊。
//
// 用法：
//   node scripts/test/seed.mjs          # 獨立執行（自己做安全鎖檢查）
//   import { runSeed } from './seed.mjs' // 被 reset-db.mjs 呼叫（複用已建立、
//                                        // 已通過安全鎖的 admin client）
//
// ⚠️ 現況（2026-08 撰寫時）：業務表（tenants/services/bookings/trips…）尚未
// 建立（Phase 1 還沒執行），所以下面對這些表的 upsert 現在必然會失敗。
// Auth 使用者（owner-a@test.local 等）不在此限 —— auth.users 是 Supabase Auth
// 內建的表，即使我們自己的 migrations 都還沒跑，這一段通常可以先成功。
// 每一步都個別 try/catch，讓「表還沒建好」不會讓後面的步驟一起死掉，並印出
// 清楚的提示訊息。

import { assertSafeTestUrl, createTestAdminClient, loadTestEnv } from './_supabase-admin.mjs';

// ---- id 常數：必須與 tests/fixtures.ts 逐一對應（見檔頭說明）----
const SHOP_A = {
  id: 'a1000000-0000-4000-8000-000000000001',
  shopCode: 'tenant-a',
  owner: { email: 'owner-a@test.local', password: 'Passw0rd!a' },
  serviceA1: 'a1000000-0000-4000-8000-000000000011',
  serviceA2: 'a1000000-0000-4000-8000-000000000012',
  staffA1: 'a1000000-0000-4000-8000-000000000021',
  staffA2: 'a1000000-0000-4000-8000-000000000022',
  customerA1: 'a1000000-0000-4000-8000-000000000031',
  customerA2: 'a1000000-0000-4000-8000-000000000032',
  customerA3: 'a1000000-0000-4000-8000-000000000033',
  bookingPending: 'a1000000-0000-4000-8000-000000000041',
  bookingConfirmed: 'a1000000-0000-4000-8000-000000000042',
  bookingCompleted: 'a1000000-0000-4000-8000-000000000043',
  bookingCancelled: 'a1000000-0000-4000-8000-000000000044',
  pmBankTransfer: 'a1000000-0000-4000-8000-000000000051',
};

const SHOP_B = {
  id: 'b2000000-0000-4000-8000-000000000001',
  shopCode: 'tenant-b',
  owner: { email: 'owner-b@test.local', password: 'Passw0rd!b' },
  customerB1: 'b2000000-0000-4000-8000-000000000031',
};

const STAFF_A2 = {
  tenantId: SHOP_A.id,
  email: 'staff-a@test.local',
  password: 'Passw0rd!a2',
  role: 'STAFF',
  staffRowId: SHOP_A.staffA2,
};

const TRAVELER_1 = {
  email: 'traveler-1@test.local',
  password: 'Passw0rd!t1',
};

const TRIP_A = {
  id: '7a000000-0000-4000-8000-000000000001',
  tenantId: SHOP_A.id,
  slug: 'trip-a-standard',
  planA1: '7a000000-0000-4000-8000-000000000011',
  planA2: '7a000000-0000-4000-8000-000000000012',
  departure1: '7a000000-0000-4000-8000-000000000021',
  departure2: '7a000000-0000-4000-8000-000000000022',
  departureCap2: '7a000000-0000-4000-8000-000000000023',
};

/**
 * 判斷錯誤是不是「資料表尚未建立」這種可容忍、預期中的情況（同 reset-db.mjs）。
 * ⚠️ 只認「relation 不存在」，不可用籠統的 'does not exist' —— 實跑時發現
 *    「column "id" does not exist」（onConflict 欄位寫錯的真 bug）被舊版寬鬆
 *    比對吞掉、誤報成「表未建立」，差點掩蓋錯誤。
 */
export function isMissingSchemaError(error) {
  const code = error?.code ?? '';
  const message = (error?.message ?? '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' || // PostgREST：找不到資料表 relation
    /relation "[^"]+" does not exist/.test(message) ||
    message.includes('could not find the table')
  );
}

/**
 * upsert 一批 row 進某張表，容忍「表還沒建立」；其他錯誤原樣往外丟。
 * conflictKey：該表的主鍵欄位（預設 'id'；tenant_settings 等以 tenant_id 為
 * 主鍵的表要指定，否則 Postgres 會報 column "id" does not exist）。
 */
async function safeUpsert(admin, table, rows, label, conflictKey = 'id') {
  const { error } = await admin.from(table).upsert(rows, { onConflict: conflictKey });
  if (!error) {
    console.log(`[seed] ${label ?? table}：已寫入 ${rows.length} 筆。`);
    return true;
  }
  if (isMissingSchemaError(error)) {
    console.warn(`[seed] 跳過 ${label ?? table}：資料表尚未建立（Phase 1 尚未執行）。原始錯誤：${error.message}`);
    return false;
  }
  console.error(`[seed] 寫入 ${label ?? table} 失敗（非「表尚未建立」原因）：`, error);
  throw error;
}

/**
 * 確保一個測試用 auth user 存在（email/password），回傳其 user id。
 * 冪等：已存在就直接查回既有 id，不重複建立、不因「已註冊」而報錯。
 */
async function ensureAuthUser(admin, email, password) {
  // 逐頁找既有帳號（Admin API 沒有「用 email 直接查一筆」的端點）。
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.warn(`[seed] 列出 auth users 失敗（${email}）：${error.message}`);
      break;
    }
    const found = (data?.users ?? []).find((u) => u.email === email);
    if (found) {
      console.log(`[seed] auth user 已存在，沿用：${email} (${found.id})`);
      return found.id;
    }
    if ((data?.users ?? []).length < perPage) break;
    page += 1;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    console.warn(`[seed] 建立 auth user 失敗（${email}）：${createError.message}`);
    return null;
  }
  console.log(`[seed] 已建立 auth user：${email} (${created.user.id})`);
  return created.user.id;
}

/**
 * 執行完整種子。可獨立呼叫（傳入已建立、已通過安全鎖的 admin client）。
 */
export async function runSeed(admin) {
  console.log('[seed] 開始建立標準測試種子（12 分冊 §1.3）…');

  // 所有相對時間都以同一個起點推導，避免種子跨過午夜時讓團次與成團期限
  // 落在互相矛盾的日期。formation_deadline_at 也必須在觸發器計算的期限內。
  const seedNow = new Date();
  const seedNowMs = seedNow.getTime();
  const hourMs = 60 * 60 * 1000;
  const oneDayMs = 24 * hourMs;

  // ---- 1. Auth users（通常不受 Phase 1 影響，auth.users 是 Supabase 內建表）----
  const ownerAId = await ensureAuthUser(admin, SHOP_A.owner.email, SHOP_A.owner.password);
  const ownerBId = await ensureAuthUser(admin, SHOP_B.owner.email, SHOP_B.owner.password);
  const staffA2Id = await ensureAuthUser(admin, STAFF_A2.email, STAFF_A2.password);
  const travelerId = await ensureAuthUser(admin, TRAVELER_1.email, TRAVELER_1.password);

  // ---- 2. 租戶 ----
  await safeUpsert(
    admin,
    'tenants',
    [
      { id: SHOP_A.id, shop_code: SHOP_A.shopCode, name: 'A 店（測試）' },
      { id: SHOP_B.id, shop_code: SHOP_B.shopCode, name: 'B 店（測試，最小資料）' },
    ],
    'tenants',
  );

  await safeUpsert(admin, 'tenant_settings', [{ tenant_id: SHOP_A.id }, { tenant_id: SHOP_B.id }], 'tenant_settings', 'tenant_id');

  // ---- 2.5 功能訂閱（Phase 5.5 閘門上線後必要）----
  // 09 分冊 §5 的閘門會擋未訂閱租戶（shifts 403、第 4 位員工被擋、報表 403…），
  // 測試種子租戶預設「平台永久贈送」全部 18 項付費功能（source='GRANTED'、
  // expires_at null = 永久，見 §2 有效性判定），讓既有 Phase 3/5 整合測試
  // 不因閘門而 403。gating.09.test.ts 測「未訂閱被擋」時自行 delete 特定列
  // 再還原（各測試自理，不改共用種子的這個基線）。
  const PAID_FEATURES = [
    'UNLIMITED_STAFF', 'SHIFT_MANAGEMENT', 'BOOKING_REMINDER', 'BIRTHDAY_GREETING',
    'CUSTOMER_RECALL', 'POINT_SYSTEM', 'ADVANCED_CUSTOMER', 'EMAIL_NOTIFICATION',
    'BASIC_REPORT', 'MEMBERSHIP_SYSTEM', 'COUPON_SYSTEM', 'PRODUCT_SALES', 'INVENTORY',
    'KEYWORD_REPLY', 'AI_ASSISTANT', 'PORTFOLIO_SHOWCASE', 'CUSTOM_RICH_MENU', 'EXTRA_PUSH',
  ];
  await safeUpsert(
    admin,
    'feature_subscriptions',
    [SHOP_A.id, SHOP_B.id].flatMap((tid) => PAID_FEATURES.map((code) => ({
      tenant_id: tid, code, active: true, expires_at: null, source: 'GRANTED',
    }))),
    'feature_subscriptions',
    'tenant_id,code',
  );

  // ---- 3. tenant_users（登入帳號 ↔ 租戶 ↔ 角色）----
  const tenantUserRows = [];
  if (ownerAId) tenantUserRows.push({ tenant_id: SHOP_A.id, user_id: ownerAId, role: 'OWNER' });
  if (ownerBId) tenantUserRows.push({ tenant_id: SHOP_B.id, user_id: ownerBId, role: 'OWNER' });
  if (staffA2Id) tenantUserRows.push({ tenant_id: STAFF_A2.tenantId, user_id: staffA2Id, role: STAFF_A2.role });
  if (tenantUserRows.length > 0) {
    const { error } = await admin.from('tenant_users').upsert(tenantUserRows, { onConflict: 'tenant_id,user_id' });
    if (error && !isMissingSchemaError(error)) {
      console.error('[seed] 寫入 tenant_users 失敗：', error);
      throw error;
    }
    if (error) {
      console.warn(`[seed] 跳過 tenant_users：資料表尚未建立。原始錯誤：${error.message}`);
    } else {
      console.log(`[seed] tenant_users：已寫入 ${tenantUserRows.length} 筆。`);
    }
  }

  // traveler_profiles（旅客帳號，11 分冊）
  if (travelerId) {
    await safeUpsert(
      admin,
      'traveler_profiles',
      [{ user_id: travelerId, name: '測試旅客一號', email: TRAVELER_1.email }],
      'traveler_profiles',
      'user_id',
    );
  }

  // ---- 4. SHOP_A 業務資料：2 服務 / 2 員工 / 3 顧客 / 4 預約 ----
  await safeUpsert(
    admin,
    'services',
    [
      {
        id: SHOP_A.serviceA1,
        tenant_id: SHOP_A.id,
        name: '基礎剪髮（測試）',
        duration_minutes: 60,
        price: 800,
        sort_order: 0,
      },
      {
        id: SHOP_A.serviceA2,
        tenant_id: SHOP_A.id,
        name: '燙染組合（測試）',
        duration_minutes: 120,
        price: 2500,
        sort_order: 1,
      },
    ],
    'services',
  );

  await safeUpsert(
    admin,
    'staff',
    [
      { id: SHOP_A.staffA1, tenant_id: SHOP_A.id, name: '設計師 A1（測試）' },
      { id: SHOP_A.staffA2, tenant_id: SHOP_A.id, name: '設計師 A2（測試，對應 STAFF_A2 登入帳號）' },
    ],
    'staff',
  );

  await safeUpsert(
    admin,
    'customers',
    [
      { id: SHOP_A.customerA1, tenant_id: SHOP_A.id, name: '顧客 A1（測試）', phone: '0911000001' },
      { id: SHOP_A.customerA2, tenant_id: SHOP_A.id, name: '顧客 A2（測試）', phone: '0911000002' },
      { id: SHOP_A.customerA3, tenant_id: SHOP_A.id, name: '顧客 A3（測試）', phone: '0911000003' },
    ],
    'customers',
  );

  const bookingBase = {
    tenant_id: SHOP_A.id,
    customer_id: SHOP_A.customerA1,
    service_id: SHOP_A.serviceA1,
    staff_id: SHOP_A.staffA1,
    duration_minutes: 60,
    price: 800,
    final_price: 800,
    source: 'MANUAL',
  };
  await safeUpsert(
    admin,
    'bookings',
    [
      {
        ...bookingBase,
        id: SHOP_A.bookingPending,
        booking_no: 'BSEED0001',
        status: 'PENDING',
        payment_status: 'UNPAID',
        start_at: new Date(seedNowMs + hourMs).toISOString(),
        end_at: new Date(seedNowMs + 2 * hourMs).toISOString(),
      },
      {
        ...bookingBase,
        id: SHOP_A.bookingConfirmed,
        booking_no: 'BSEED0002',
        status: 'CONFIRMED',
        payment_status: 'UNPAID',
        start_at: new Date(seedNowMs + 3 * hourMs).toISOString(),
        end_at: new Date(seedNowMs + 4 * hourMs).toISOString(),
      },
      {
        ...bookingBase,
        id: SHOP_A.bookingCompleted,
        booking_no: 'BSEED0003',
        status: 'COMPLETED',
        payment_status: 'PAID_OFFLINE',
        start_at: new Date(seedNowMs - 2 * hourMs).toISOString(),
        end_at: new Date(seedNowMs - hourMs).toISOString(),
      },
      {
        ...bookingBase,
        id: SHOP_A.bookingCancelled,
        booking_no: 'BSEED0004',
        status: 'CANCELLED',
        payment_status: 'UNPAID',
        start_at: new Date(seedNowMs + 5 * hourMs).toISOString(),
        end_at: new Date(seedNowMs + 6 * hourMs).toISOString(),
        cancel_reason: '測試種子：預先取消',
      },
    ],
    'bookings',
  );

  await safeUpsert(
    admin,
    'tenant_payment_methods',
    [
      {
        id: SHOP_A.pmBankTransfer,
        tenant_id: SHOP_A.id,
        method_type: 'BANK_TRANSFER',
        display_name: '銀行轉帳（測試）',
        config: { bankName: '測試銀行', bankCode: '000', accountNumber: '0000000000000', accountHolder: 'A 店測試' },
      },
    ],
    'tenant_payment_methods',
  );

  // ---- 5. SHOP_B：最小資料（跨租戶隔離測試用）----
  await safeUpsert(
    admin,
    'customers',
    [{ id: SHOP_B.customerB1, tenant_id: SHOP_B.id, name: '顧客 B1（測試）', phone: '0922000001' }],
    'customers (SHOP_B)',
  );

  // ---- 6. TRIP_A：1 行程 + 2 方案 + 3 團次（其中一團 capacity=2）----
  await safeUpsert(
    admin,
    'trips',
    [
      {
        id: TRIP_A.id,
        tenant_id: TRIP_A.tenantId,
        slug: TRIP_A.slug,
        title: 'A 店測試行程',
        status: 'PUBLISHED',
      },
    ],
    'trips',
  );

  const tripPlansSeeded = await safeUpsert(
    admin,
    'trip_plans',
    [
      {
        id: TRIP_A.planA1,
        tenant_id: TRIP_A.tenantId,
        trip_id: TRIP_A.id,
        slug: 'standard-test-plan',
        name: '標準團（測試）',
        // 0016 的單一價格欄位是 base_price；不要回寫舊版 price_per_person，
        // 否則 PostgREST 會在 reset/seed 前就中止整個 integration suite。
        base_price: 3000,
        price_type: 'PER_PERSON',
        max_participants: 10,
        min_to_depart: 1,
      },
      {
        id: TRIP_A.planA2,
        tenant_id: TRIP_A.tenantId,
        trip_id: TRIP_A.id,
        slug: 'private-test-plan',
        name: '包團（測試）',
        base_price: 5000,
        price_type: 'PER_PERSON',
        max_participants: 10,
        min_to_depart: 1,
      },
    ],
    'trip_plans',
  );

  const formationDeadlineAt = new Date(seedNowMs + oneDayMs).toISOString();
  if (!tripPlansSeeded) {
    throw new Error('[seed] trip_plans seed is required before trip_departures；避免留下不完整的父子種子。');
  }

  const tripDeparturesSeeded = await safeUpsert(
    admin,
    'trip_departures',
    [
      {
        id: TRIP_A.departure1,
        tenant_id: TRIP_A.tenantId,
        trip_id: TRIP_A.id,
        plan_id: TRIP_A.planA1,
        departs_on: new Date(seedNowMs + 7 * oneDayMs).toISOString().slice(0, 10),
        capacity: 10,
        seats_booked: 0,
        min_to_depart_snapshot: 1,
        formation_deadline_at: formationDeadlineAt,
      },
      {
        id: TRIP_A.departure2,
        tenant_id: TRIP_A.tenantId,
        trip_id: TRIP_A.id,
        plan_id: TRIP_A.planA1,
        departs_on: new Date(seedNowMs + 14 * oneDayMs).toISOString().slice(0, 10),
        capacity: 10,
        seats_booked: 0,
        min_to_depart_snapshot: 1,
        formation_deadline_at: formationDeadlineAt,
      },
      {
        // capacity=2：專供 12 分冊 §5 並發不超賣測試
        id: TRIP_A.departureCap2,
        tenant_id: TRIP_A.tenantId,
        trip_id: TRIP_A.id,
        plan_id: TRIP_A.planA2,
        departs_on: new Date(seedNowMs + 21 * oneDayMs).toISOString().slice(0, 10),
        capacity: 2,
        seats_booked: 0,
        min_to_depart_snapshot: 1,
        formation_deadline_at: formationDeadlineAt,
      },
    ],
    'trip_departures',
  );
  if (!tripDeparturesSeeded) {
    throw new Error('[seed] trip_departures is required for the standard TEST seed.');
  }

  console.log('[seed] 種子執行完畢（各步驟成功/跳過狀況見上方日誌）。');
}

// 允許 `node scripts/test/seed.mjs` 獨立執行。
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  loadTestEnv();
  assertSafeTestUrl();
  const admin = createTestAdminClient();
  runSeed(admin).catch((err) => {
    console.error('[seed] 未預期的錯誤：', err);
    process.exit(1);
  });
}