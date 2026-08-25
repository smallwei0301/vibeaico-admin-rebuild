/**
 * 關鍵字回覆頁 E2E（GitHub issue #5「修復-3」第 ① 項的最後一段證據）
 * -----------------------------------------------------------------------------
 * 為什麼在整合測試之外還要這一支：
 *   單元測試讀原始碼，證的是「handler 裡寫了呼叫 service」；整合測試從端點打到
 *   webhook，證的是「端點寫進 DB、webhook 回得出來」。**中間還有一段沒有任何一層
 *   覆蓋到：React 真的把那個 handler 掛到那顆按鈕上、按下去真的會跑**。
 *   14 分冊 §6.4 點名的結構性盲點就是這一段（「頁面接線不屬於任何一層」），
 *   14 分冊 §1 根因 A 那顆假的儲存鈕正是死在這裡。
 *   所以這支測試只用瀏覽器點，斷言一律回 TEST 資料庫用 service role 直查——
 *   toast 出現不算數，資料庫裡真的多一列才算數。
 *
 * 涵蓋：新增 / 啟停 / 刪除 / 系統關鍵字組停用 四個動作。
 * 不涵蓋 LINE：webhook 那一半由 tests/integration/api/keyword-replies.05.test.ts
 * 負責（playwright.config.ts 的 webServer 沒有 LINE_API_BASE，在這裡打 LINE 會
 * 打到真的 api.line.me）。本檔刻意不設定任何 LINE 憑證，
 * `PUT /api/settings/line` 因此不會觸發 lineSetWebhookEndpoint。
 *
 * 前置：seed 的 SHOP_A（owner-a@test.local）已被贈與 KEYWORD_REPLY。
 * 清理：afterAll 刪掉本檔造出的 keyword_replies，並還原 tenant_settings.line。
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../fixtures';

const KEYWORD = 'E2E測試停車';
const REPLY = 'E2E：門口有 3 個機車位，汽車請停巷口收費停車場。';
/** 拿來停用的系統關鍵字組（label 在頁面上唯一，key 是 COUPON） */
const GROUP_LABEL = '票券';
const GROUP_KEY = 'COUPON';

let admin: SupabaseClient;
let lineSnapshot: unknown = null;

test.describe.configure({ mode: 'serial' });
// next dev 是即時編譯：login / dashboard / keyword-replies 三個路由第一次進去
// 各要編譯數十秒，預設 30s 會在 page.goto 就逾時（實跑抓到）。
test.setTimeout(180_000);

test.beforeAll(async () => {
  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data } = await admin
    .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).single();
  lineSnapshot = data?.line ?? {};
  await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id).contains('keywords', [KEYWORD]);
});

test.afterAll(async () => {
  await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id).contains('keywords', [KEYWORD]);
  await admin.from('tenant_settings').update({ line: lineSnapshot ?? {} }).eq('tenant_id', SHOP_A.id);
});

/** 直查 TEST 資料庫：這一列真的存在嗎（toast 說了不算） */
async function keywordRow(): Promise<{ id: string; active: boolean; content: any } | null> {
  const { data } = await admin
    .from('keyword_replies')
    .select('id, active, content')
    .eq('tenant_id', SHOP_A.id)
    .contains('keywords', [KEYWORD])
    .maybeSingle();
  return (data as any) ?? null;
}

async function disabledGroups(): Promise<string[]> {
  const { data } = await admin
    .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).single();
  return ((data?.line as any)?.systemKeywordGroupsDisabled ?? []) as string[];
}

async function login(page: Page): Promise<void> {
  await page.goto('/tenant/login');
  await page.locator('#username').fill(SHOP_A.owner.email);
  await page.locator('#password').fill(SHOP_A.owner.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/\/tenant\/dashboard/, { timeout: 20_000 });
}

async function openPage(page: Page): Promise<void> {
  await page.goto('/tenant/keyword-replies');
  // 系統關鍵字的開關要等 getTenantSettings() 回來才會渲染出來
  await expect(page.getByRole('switch')).not.toHaveCount(0, { timeout: 20_000 });
}

/** 某一組系統關鍵字的開關（用 SwitchField 的標題 div 精準定位，避免撞到關鍵字徽章） */
function systemSwitch(page: Page, label: string) {
  return page
    .locator('div.flex.items-start.justify-between')
    .filter({ has: page.locator('div.text-base.font-semibold', { hasText: new RegExp(`^${label}$`) }) })
    .getByRole('switch');
}

test.describe('關鍵字回覆頁的四個動作真的存進資料庫（issue #5 ①）', () => {
  test('新增：填完 modal 按儲存 → keyword_replies 真的多一列，內容相符', async ({ page }) => {
    await login(page);
    await openPage(page);
    expect(await keywordRow(), '測試前置：這一列不該已經存在').toBeNull();

    await page.getByRole('button', { name: '新增關鍵字' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#kwKeyword').fill(KEYWORD);
    await dialog.locator('#kwReplyText').fill(REPLY);
    await dialog.getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    await expect.poll(async () => (await keywordRow())?.content?.text, { timeout: 15_000 })
      .toBe(REPLY);
    const row = await keywordRow();
    expect(row!.active).toBe(true);
    // 頁面預設「訊息裡有這個字就回」——webhook 讀的就是 content.matchType
    expect(row!.content.matchType).toBe('CONTAINS');
  });

  test('啟停：關掉那一列的開關 → active 變 false', async ({ page }) => {
    await login(page);
    await openPage(page);

    const tableRow = page.locator('tr', { hasText: KEYWORD });
    await tableRow.getByRole('switch').click();
    await expect.poll(async () => (await keywordRow())?.active, { timeout: 15_000 }).toBe(false);

    await tableRow.getByRole('switch').click();
    await expect.poll(async () => (await keywordRow())?.active, { timeout: 15_000 }).toBe(true);
  });

  test('系統關鍵字組停用 → tenant_settings.line.systemKeywordGroupsDisabled 真的存進去', async ({ page }) => {
    await login(page);
    await openPage(page);
    expect(await disabledGroups()).not.toContain(GROUP_KEY);

    await systemSwitch(page, GROUP_LABEL).click();
    // 停用要先過確認視窗（頁面文案：「關鍵字『優惠券』將完全沒有回應！」）
    await page.getByRole('dialog').getByRole('button', { name: '確定', exact: true }).click();
    await expect.poll(disabledGroups, { timeout: 15_000 }).toContain(GROUP_KEY);

    // 恢復（打開）不需確認，直接寫回
    await systemSwitch(page, GROUP_LABEL).click();
    await expect.poll(disabledGroups, { timeout: 15_000 }).not.toContain(GROUP_KEY);
  });

  test('刪除：按垃圾桶並確認 → 那一列真的從資料庫消失', async ({ page }) => {
    await login(page);
    await openPage(page);

    await page.locator('tr', { hasText: KEYWORD }).getByRole('button', { name: '刪除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '刪除', exact: true }).click();
    await expect.poll(keywordRow, { timeout: 15_000 }).toBeNull();
  });
});
