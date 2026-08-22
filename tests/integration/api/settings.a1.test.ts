/**
 * 設定 API 整合測試 — 12 分冊 §4「Phase 3（核心 API）」矩陣：
 *   「settings：secret 存後回讀是遮罩；送空字串不覆蓋、送新值有覆蓋（用 service
 *    role 直查 `*_enc` 驗證）；shopCode 改重複 409」
 * 端點行為規格見 docs/integration/04-API-CONTRACTS.md §A-1。
 *
 * ⚠️ TDD 紅燈說明：撰寫本檔當下 `src/app/api/settings/setup-status/route.ts`、
 * `src/app/api/feature-store/route.ts` 尚未實作（目錄是空的），呼叫會拿到 404 —
 * 這是誠實的「先寫測試」狀態，不得為轉綠放寬斷言（12 §2.4）。`GET/PUT
 * /api/settings`、`PUT/POST /api/settings/line*` 當下已有實作，另兩支端點的
 * 紅燈會在主導者跑完三個平行工作後轉綠。
 *
 * 清理紀律：本檔唯一會產生跨測試持久副作用的地方是「secret 三規則」測試——
 * PUT /api/settings/line 會把明文加密寫進 tenant_settings 的 `*_enc` 欄位。
 * 測畢用 service role 把兩個 `*_enc` 欄位重設回種子的初始空字串，否則
 * reports.a5.test.ts 的 `linePlatformStatus` 斷言（前提是 token 未設定 →
 * NOT_CONFIGURED）會被本檔污染而變紅。shopCode 撞號測試、STAFF 403 測試在
 * 實作正確的前提下請求會提前被擋（409/403），不產生任何寫入，不需清理。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import { loginAs } from '../../helpers/auth';
import { maskSecret, type TenantSettings } from '@/config/tenant-settings';
import type { SetupStatus } from '@/lib/types';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;

beforeAll(() => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

/** 直查 tenant_settings 的兩個加密欄位（04 §A-1：line jsonb 內永不存明文/密文）。 */
async function readLineEnc(): Promise<{ secretEnc: string; tokenEnc: string }> {
  const { data, error } = await admin
    .from('tenant_settings')
    .select('line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .maybeSingle();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  return {
    secretEnc: (data as any).line_channel_secret_enc as string,
    tokenEnc: (data as any).line_channel_access_token_enc as string,
  };
}

describe('GET /api/settings（04 §A-1）', () => {
  it('200，回完整 TenantSettings 形狀；basic 為 A 店資料；line.webhookUrl 含 shopCode', async () => {
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.get('/api/settings');
    expect(res.status).toBe(200);
    const body = await readJson<TenantSettings>(res);
    expect(body.success).toBe(true);
    const data = body.data!;

    // 六大群組都要存在（形狀斷言）
    expect(data.basic).toBeDefined();
    expect(data.business).toBeDefined();
    expect(data.notify).toBeDefined();
    expect(data.privacy).toBeDefined();
    expect(data.points).toBeDefined();
    expect(data.line).toBeDefined();

    // seed：tenants.name = 'A 店（測試）'、shop_code = 'tenant-a'
    expect(data.basic.shopCode).toBe(SHOP_A.shopCode);
    expect(data.basic.tenantName).toBe('A 店（測試）');

    // webhookUrl 由伺服器依 shopCode 組出（buildWebhookUrl），唯讀
    expect(data.line.webhookUrl).toContain(SHOP_A.shopCode);
    expect(data.line.webhookUrl).toContain('/api/line/webhook/');

    // 尚未設定過 LINE token 時，secret 欄位應為空字串（seed 的 tenant_settings
    // 只 upsert 了 tenant_id，*_enc 欄位吃 schema 預設空字串）
    expect(data.line.channelSecret).toBe('');
    expect(data.line.channelAccessToken).toBe('');
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/settings`);
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_001');
  });
});

describe('PUT /api/settings/line — secret 三規則（04 §A-1、鐵則 6、12 §4）', () => {
  afterAll(async () => {
    // 還原：把兩個 *_enc 欄位重設回種子的初始空字串，避免污染其他檔（尤其
    // reports.a5 的 linePlatformStatus=NOT_CONFIGURED 斷言）。
    const { error } = await admin
      .from('tenant_settings')
      .update({ line_channel_secret_enc: '', line_channel_access_token_enc: '' })
      .eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
  });

  it('寫入新值 → 回讀遮罩；直查 *_enc 非空且≠明文；送空字串不覆蓋；送新值才覆蓋', async () => {
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

    // ---- 步驟 1：寫入第一組新值 ----
    const tokenV1 = 'INTEGTESTTOKEN0001EXTRAPADDING';
    const secretV1 = 'INTEGTESTSECRET0001PADDING';
    const put1 = await api.put('/api/settings/line', { channelAccessToken: tokenV1, channelSecret: secretV1 });
    expect(put1.status).toBe(200);
    expect((await readJson(put1)).success).toBe(true);

    // ---- 步驟 2：回讀是遮罩（不等於明文、含遮罩字元、與 maskSecret() 算出的值完全一致）----
    const get1 = await api.get('/api/settings');
    expect(get1.status).toBe(200);
    const data1 = (await readJson<TenantSettings>(get1)).data!;
    expect(data1.line.channelAccessToken).toBe(maskSecret(tokenV1));
    expect(data1.line.channelSecret).toBe(maskSecret(secretV1));
    expect(data1.line.channelAccessToken).not.toBe(tokenV1);
    expect(data1.line.channelSecret).not.toBe(secretV1);
    expect(data1.line.channelAccessToken).toContain('•');
    expect(data1.line.channelSecret).toContain('•');

    // ---- 步驟 3：service role 直查 *_enc 非空且 ≠ 明文 ----
    const encAfterV1 = await readLineEnc();
    expect(encAfterV1.tokenEnc.length).toBeGreaterThan(0);
    expect(encAfterV1.secretEnc.length).toBeGreaterThan(0);
    expect(encAfterV1.tokenEnc).not.toBe(tokenV1);
    expect(encAfterV1.secretEnc).not.toBe(secretV1);

    // ---- 步驟 4：再 PUT 空字串 → *_enc 不變（空字串＝「保持不變」，不是「清空」）----
    const put2 = await api.put('/api/settings/line', { channelAccessToken: '', channelSecret: '' });
    expect(put2.status).toBe(200);
    const encAfterEmpty = await readLineEnc();
    expect(encAfterEmpty.tokenEnc).toBe(encAfterV1.tokenEnc);
    expect(encAfterEmpty.secretEnc).toBe(encAfterV1.secretEnc);

    // ---- 步驟 5：再 PUT 另一組新值 → *_enc 改變 ----
    const tokenV2 = 'INTEGTESTTOKEN0002DIFFERENTVALUE';
    const secretV2 = 'INTEGTESTSECRET0002DIFFERENT';
    const put3 = await api.put('/api/settings/line', { channelAccessToken: tokenV2, channelSecret: secretV2 });
    expect(put3.status).toBe(200);
    const encAfterV2 = await readLineEnc();
    expect(encAfterV2.tokenEnc).not.toBe(encAfterV1.tokenEnc);
    expect(encAfterV2.secretEnc).not.toBe(encAfterV1.secretEnc);

    // 回讀也反映新值的遮罩
    const get2 = await api.get('/api/settings');
    const data2 = (await readJson<TenantSettings>(get2)).data!;
    expect(data2.line.channelAccessToken).toBe(maskSecret(tokenV2));
    expect(data2.line.channelSecret).toBe(maskSecret(secretV2));
  });
});

describe('PUT /api/settings — shopCode 改撞既有店 → 409 AUTH_006（04 §A-1）', () => {
  it('basic.shopCode 改成 SHOP_B 的 shopCode → 409，且不寫入（幂等：A 店 shopCode 應仍是 tenant-a）', async () => {
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.put('/api/settings', {
      basic: { tenantName: 'A 店（測試）', shopCode: SHOP_B.shopCode },
    });
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_006');

    const { data: tenantRow, error } = await admin.from('tenants').select('shop_code').eq('id', SHOP_A.id).single();
    expect(error).toBeNull();
    expect((tenantRow as any).shop_code).toBe(SHOP_A.shopCode);
  });
});

describe('PUT /api/settings — 角色權限（04 §A-1：需 MANAGER）', () => {
  it('STAFF 角色（STAFF_A2）PUT → 403 AUTH_005', async () => {
    const api = await loginAs(STAFF_A2.email, STAFF_A2.password);
    const res = await api.put('/api/settings', { basic: { tenantName: 'A 店（測試）', shopCode: SHOP_A.shopCode } });
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_005');
  });
});

describe('GET /api/settings/setup-status（04 §A-1）', () => {
  it('steps 陣列 5 項；SERVICE/STAFF done=true（seed 有 2 服務 2 員工）', async () => {
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.get('/api/settings/setup-status');
    expect(res.status).toBe(200);
    const body = await readJson<SetupStatus>(res);
    expect(body.success).toBe(true);
    const data = body.data!;

    expect(data.steps).toHaveLength(5);
    const keys = data.steps.map((s) => s.key).sort();
    expect(keys).toEqual(['BUSINESS_HOURS', 'LINE_BOT', 'SERVICE', 'SHOP_INFO', 'STAFF'].sort());

    const serviceStep = data.steps.find((s) => s.key === 'SERVICE');
    const staffStep = data.steps.find((s) => s.key === 'STAFF');
    expect(serviceStep?.done).toBe(true);
    expect(staffStep?.done).toBe(true);

    expect(typeof data.percent).toBe('number');
    expect(data.percent).toBeGreaterThanOrEqual(0);
    expect(data.percent).toBeLessThanOrEqual(100);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/settings/setup-status`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});
