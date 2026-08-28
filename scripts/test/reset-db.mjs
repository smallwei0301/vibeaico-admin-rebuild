#!/usr/bin/env node
// scripts/test/reset-db.mjs
//
// 見 docs/integration/12-TESTING-TDD.md §1.2：
//   「truncate 全部業務表（auth_verification_codes 到 tour_orders，restart
//    identity cascade）→ 刪除測試 auth users（email 以 @test.local 結尾者）→
//    執行種子（§1.3）。」
//
// 用法：
//   node scripts/test/reset-db.mjs
//   （或被 tests/integration/global-setup.ts 以子行程方式呼叫）
//
// ⚠️ 現況（2026-08 撰寫時）：docs/integration/02-SUPABASE-SCHEMA.md 等分冊描述
// 的資料表尚未建立 —— Phase 1（建表 migrations）還沒執行。所以下面的刪除
// 現在必然會失敗（relation does not exist）。這是預期中的事：本腳本的結構要
// 先寫好、能被 Phase 1 之後的人直接使用，失敗時要清楚說明原因、不能讓整支
// 腳本噴一堆 stack trace 就死掉。等 Phase 1 建表完成後，這裡的刪除呼叫應該
// 就會自然成功，不需要再改這支腳本。
//
// ⚠️ 不用「任意 SQL 字串」RPC（已否決的設計）：
// 12 分冊寫的是「truncate」，但先前的實作假設 Phase 1 migration 會另外新增
// 一個 `security definer`、接受任意 SQL 字串當參數執行的 Postgres RPC 函式來
// 跑它。這個假設已被否決 —— 12 分冊本身沒定義這種函式（屬於自行發明架構），
// 而且「接受任意 SQL 字串的 security definer 函式」本身就是一個嚴重的安全
// 反模式：一旦 grant 設錯，等於在 schema 裡埋了一個能執行任意 SQL 的後門，
// 跟本專案「多租戶隔離是安全邊界」的鐵則直接衝突。
//
// 改用 supabase-js 的 `.delete()` 直接刪資料列，不需要任何 RPC、不需要新
// 依賴、不需要在 schema 裡加任何函式。細節見下方 clearAllBusinessTables()
// 開頭的大段註解（刪除順序與理由）。

import { assertSafeTestUrl, createTestAdminClient, loadTestEnv } from './_supabase-admin.mjs';
import { runSeed } from './seed.mjs';

loadTestEnv();
const testUrl = assertSafeTestUrl();

console.log(`[reset-db] 安全鎖通過，接到 TEST 專案：${testUrl}`);

const admin = createTestAdminClient();

/**
 * 「不透過 tenant_id 掛在 tenants 底下」的獨立表——刪 tenants 不會 cascade
 * 動到它們，必須各自明確刪除。三張表各自的理由（讀 02 / 11 分冊確認過）：
 *
 *   - auth_verification_codes：02 分冊，沒有 tenant_id 欄位，用 email 全域
 *     儲存 Email 驗證碼（見該分冊 0003 段：`create table auth_verification_codes
 *     (id, email, code, purpose, expires_at, consumed_at, created_at)`）。
 *   - partner_clients：11 分冊，也沒有 tenant_id，是平台層級的 Midao 夥伴 API
 *     金鑰表（`id, name, api_key, secret_enc, active, created_at`），跟任何
 *     單一租戶無關。
 *   - traveler_profiles：11 分冊，主鍵直接是 `user_id uuid primary key
 *     references auth.users(id) on delete cascade`——它掛在 auth.users 底下，
 *     不是 tenants。
 *   - #40 notification health / platform Telegram tables：platform digest 與
 *     PLATFORM_OWNER bindings intentionally have nullable tenant_id, so tenant
 *     cascade cannot clear their audit rows between isolated TEST runs.
 *
 * 用哪一欄當「必然成立」的刪除條件：auth_verification_codes / partner_clients
 * 用主鍵 id；traveler_profiles 沒有 id 欄位，主鍵是 user_id，所以用 user_id。
 */
const INDEPENDENT_TABLES = [
  { table: 'auth_verification_codes', keyColumn: 'id' },
  { table: 'partner_clients', keyColumn: 'id' },
  { table: 'traveler_profiles', keyColumn: 'user_id' },
  // 0012：tenant_id 是 on delete SET NULL（平台級表），tenants 的 cascade
  // 刪不到它，必須獨立清。
  { table: 'bug_reports', keyColumn: 'id' },
  { table: 'notification_health_reports', keyColumn: 'id' },
  { table: 'notification_outbox', keyColumn: 'id' },
  { table: 'telegram_bindings', keyColumn: 'id' },
  { table: 'telegram_bind_codes', keyColumn: 'id' },
  { table: 'telegram_webhook_updates', keyColumn: 'bot_id' },
];

/**
 * 除了上面三張獨立表之外，02 / 10 / 11 三個分冊定案的 CREATE TABLE 全部都有
 * `tenant_id uuid not null references tenants(id) on delete cascade`：
 *
 *   02 分冊：tenant_users, tenant_settings, membership_levels, customers,
 *     service_categories, services, staff, staff_services, bookings,
 *     block_times, product_categories, products, inventory_logs,
 *     product_orders, product_order_items, coupons, coupon_instances,
 *     tenant_point_transactions, customer_point_logs, feature_subscriptions,
 *     line_users, marketing_pushes, push_quota_usage, keyword_replies,
 *     campaigns, portfolios, chat_messages, shift_templates, shifts,
 *     staff_leaves, recurring_bookings
 *   10 分冊：trips, trip_plans, trip_departures, tour_orders,
 *     tenant_payment_methods
 *   11 分冊：trip_reviews
 *
 * 也就是說：清掉 `tenants` 這張表的資料列，Postgres 會透過 cascade 自動把
 * 上面全部 33 張表清光，不需要手動一張一張刪、也不需要手動排序。
 *
 * 這個子圖內部另外還有幾條「非 cascade」外鍵（RESTRICT 或 SET NULL），是讀
 * 02 / 10 分冊時特別要注意、最容易出錯的地方——因為表面上看起來「順序刪錯
 * 就會撞到約束」：
 *
 *   ON DELETE RESTRICT：
 *     bookings.customer_id       -> customers(id)
 *     bookings.service_id        -> services(id)
 *     product_orders.customer_id -> customers(id)
 *     product_order_items.product_id -> products(id)
 *     recurring_bookings.service_id  -> services(id)
 *     tour_orders.trip_id        -> trips(id)
 *     tour_orders.plan_id        -> trip_plans(id)
 *     tour_orders.departure_id   -> trip_departures(id)
 *
 *   ON DELETE SET NULL：
 *     customers.membership_level_id -> membership_levels(id)
 *     services.category_id          -> service_categories(id)
 *     products.category_id          -> product_categories(id)
 *     line_users.customer_id        -> customers(id)
 *     shifts.template_id            -> shift_templates(id)
 *     bookings.staff_id / recurring_bookings.staff_id -> staff(id)
 *
 * 但注意：這些邊的兩端（例如 bookings 和它 RESTRICT 指向的 customers）全部
 * 都各自直接掛在 tenants 底下（cascade），所以只要用「單一一條刪 tenants 的
 * SQL 語句」去觸發整條 cascade，PostgreSQL 對 NOT DEFERRABLE 約束（RESTRICT
 * 預設如此）的檢查時機是「整條語句（含所有巢狀 cascade 觸發的子刪除）執行
 * 完之後」，不是「cascade 清到一半、還沒清另一張兄弟表時就先檢查」。所以這些
 * RESTRICT/SET NULL 邊不會擋下單一語句的 tenants cascade delete，不需要手動
 * 排出 33 張表的先後順序。
 *
 * 會需要手動排序的情況，只在「分成多條獨立語句、分別刪不同表」時才會出現
 * （例如先單獨 delete customers、再單獨 delete bookings，中間各自是一條
 * 語句，RESTRICT 就會在第一條語句結束時立刻擋下來）。這裡刻意只發一條
 * `delete from tenants` 語句，把整個子圖的排序問題交給 Postgres 的 cascade
 * 機制處理，避免自己手動排 33 張表順序時漏掉或排錯。
 */
async function clearAllBusinessTables() {
  for (const { table, keyColumn } of INDEPENDENT_TABLES) {
    await deleteAllRows(table, keyColumn);
  }

  await deleteAllRows(
    'tenants',
    'id',
    '（cascade 會一併清空以 tenant_id 掛在 tenants 底下的所有子表，見上方註解）',
  );
}

/**
 * 用 `.delete()` 清空一張表的全部資料列。supabase-js 的 delete 一定要帶篩選
 * 條件才會真的送出刪除（不能裸 delete 全表），所以用「該欄位不為 null」這個
 * 必然成立的條件（每張表的主鍵欄位天生就是 not null）。
 *
 * 容忍「表尚未建立」（Phase 1 還沒執行）；其他錯誤（權限、欄位打錯…）視為
 * 真正的失敗，讓呼叫端決定要不要中止。
 */
async function deleteAllRows(table, keyColumn, extraLogSuffix = '') {
  const { error, count } = await admin
    .from(table)
    .delete({ count: 'exact' })
    .not(keyColumn, 'is', null);

  if (!error) {
    console.log(`[reset-db] 已清空 ${table}：刪除 ${count ?? '?'} 筆${extraLogSuffix}`);
    return;
  }

  if (isMissingSchemaError(error)) {
    console.warn(
      `[reset-db] 跳過 ${table}：資料表尚未建立` +
        `（Phase 1 — docs/integration/02-SUPABASE-SCHEMA.md 等分冊 — 尚未執行）。` +
        ` 原始錯誤：${error.message}`,
    );
    return;
  }

  // 非「還沒建表」類的錯誤（例如權限問題）要讓腳本失敗，不能吞掉。
  console.error(`[reset-db] 清空 ${table} 失敗（非「表尚未建立」原因）：`, error);
  process.exit(1);
}

/** 判斷錯誤是不是「資料表尚未建立」這種可容忍、預期中的情況。 */
function isMissingSchemaError(error) {
  const code = error?.code ?? '';
  const message = (error?.message ?? '').toLowerCase();
  return (
    code === '42P01' || // undefined_table
    code === 'PGRST205' || // PostgREST：schema cache 裡找不到這張表
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('schema cache')
  );
}

/** 刪除測試用 auth users（email 以 @test.local 結尾者）。 */
async function deleteTestAuthUsers() {
  let deleted = 0;
  let page = 1;
  const perPage = 200;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });

    if (error) {
      console.warn(`[reset-db] 列出 auth users 失敗，跳過刪除測試帳號：${error.message}`);
      return;
    }

    const users = data?.users ?? [];
    const testUsers = users.filter((u) => (u.email ?? '').endsWith('@test.local'));

    for (const user of testUsers) {
      const { error: delError } = await admin.auth.admin.deleteUser(user.id);
      if (delError) {
        console.warn(`[reset-db] 刪除測試帳號 ${user.email} 失敗：${delError.message}`);
      } else {
        deleted += 1;
      }
    }

    if (users.length < perPage) break; // 最後一頁
    page += 1;
  }

  console.log(`[reset-db] 已刪除 ${deleted} 個測試 auth users（@test.local）。`);
}

async function main() {
  await clearAllBusinessTables();
  await deleteTestAuthUsers();
  await runSeed(admin);
  console.log('[reset-db] 完成。');
}

main().catch((err) => {
  console.error('[reset-db] 未預期的錯誤：', err);
  process.exit(1);
});
