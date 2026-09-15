/**
 * shop-page 端點群整合測試（issue #22；04 分冊 §A-1.1／§B-2）：
 *   - `GET/PUT /api/settings/shop-page`：六分頁欄位 PUT 後 GET 回讀一致
 *   - 空 patch（`{}`）不得清空既有資料——14 分冊「儲存送空 patch＝假成功」根因
 *     的直接測試，斷言直查 DB
 *   - `POST /api/settings/shop-page/gallery/reorder`：改序後重讀順序符合，且
 *     不是完整排列時 400
 *   - `POST /api/staff/reorder`：改序後重讀順序符合
 *   - 兩支 reorder 端點的 RLS 跨租戶擋
 *
 * 端點行為規格見 docs/integration/04-API-CONTRACTS.md §A-1.1／§B-2。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { BrandingSettings, GalleryImage } from '@/config/tenant-settings';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

/** 直查 tenant_settings.branding（不採信 API 自己的回應）。 */
async function readBranding(tenantId: string): Promise<BrandingSettings> {
  const { data, error } = await admin
    .from('tenant_settings')
    .select('branding')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  expect(error).toBeNull();
  return (data as { branding: BrandingSettings }).branding;
}

/** 還原 A/B 兩店的 branding 與 staff.sort_order，避免污染其他整合測試檔。 */
async function resetTenantSettings(tenantId: string): Promise<void> {
  const { error } = await admin.from('tenant_settings').update({ branding: {} }).eq('tenant_id', tenantId);
  expect(error).toBeNull();
}

async function resetStaffOrder(): Promise<void> {
  await admin.from('staff').update({ sort_order: 0 }).eq('id', SHOP_A.staffA1);
  await admin.from('staff').update({ sort_order: 1 }).eq('id', SHOP_A.staffA2);
}

afterAll(async () => {
  await resetTenantSettings(SHOP_A.id);
  await resetTenantSettings(SHOP_B.id);
  await resetStaffOrder();
});

describe('GET/PUT /api/settings/shop-page（04 §A-1.1）', () => {
  afterAll(async () => {
    await resetTenantSettings(SHOP_A.id);
  });

  it('GET 初始為 brandingSettingsSchema 預設值', async () => {
    const res = await ownerA.get('/api/settings/shop-page');
    expect(res.status).toBe(200);
    const data = (await readJson<BrandingSettings>(res)).data!;
    expect(data.shopName).toBe('');
    expect(data.gallery).toEqual([]);
    expect(data.themeColor).toBe('#6366f1');
  });

  it('PUT 六分頁欄位後，GET 回讀逐一一致（同一次請求也回傳合併後全量值）', async () => {
    const galleryImages: GalleryImage[] = [
      { id: 'g_1', url: 'https://example.test/1.jpg', caption: '第一張' },
      { id: 'g_2', url: 'https://example.test/2.jpg', caption: '第二張' },
      { id: 'g_3', url: 'https://example.test/3.jpg', caption: '第三張' },
    ];
    const patch: Partial<BrandingSettings> = {
      // 店家資訊
      shopName: '整合測試沙龍',
      logoHidden: true,
      // 橫幅封面
      bannerUrl: 'https://example.test/banner.jpg',
      announcement: '整合測試公告',
      // 關於我們
      aboutTitle: '關於整合測試店',
      aboutContent: '這是一段整合測試用的介紹文字。',
      // 圖片展示
      gallery: galleryImages,
      // 主題外觀
      themeColor: '#112233',
      // 社群連結
      facebook: 'https://facebook.com/integration-test',
      instagram: 'https://instagram.com/integration-test',
      line: 'https://line.me/R/ti/p/@integration',
      threads: 'https://threads.net/@integration',
      googleMaps: 'https://maps.example.com/integration',
      contactEmail: 'integration@example.test',
    };

    const put = await ownerA.put('/api/settings/shop-page', patch);
    expect(put.status).toBe(200);
    const putData = (await readJson<BrandingSettings>(put)).data!;
    for (const [key, value] of Object.entries(patch)) {
      expect((putData as Record<string, unknown>)[key]).toEqual(value);
    }

    const get = await ownerA.get('/api/settings/shop-page');
    expect(get.status).toBe(200);
    const getData = (await readJson<BrandingSettings>(get)).data!;
    for (const [key, value] of Object.entries(patch)) {
      expect((getData as Record<string, unknown>)[key]).toEqual(value);
    }

    // 直查 DB，不只信 API 自己的回應
    const dbBranding = await readBranding(SHOP_A.id);
    expect(dbBranding.shopName).toBe('整合測試沙龍');
    expect(dbBranding.gallery).toEqual(galleryImages);
    expect(dbBranding.themeColor).toBe('#112233');
  });

  it('空 patch（{}）不得清空既有資料——14 分冊根因的直接測試', async () => {
    const before = await readBranding(SHOP_A.id);
    expect(before.shopName).toBe('整合測試沙龍'); // 承接上一個 it 寫入的值

    const put = await ownerA.put('/api/settings/shop-page', {});
    expect(put.status).toBe(200);
    const putData = (await readJson<BrandingSettings>(put)).data!;
    expect(putData).toEqual(before);

    const after = await readBranding(SHOP_A.id);
    expect(after).toEqual(before);
  });

  it('只送一個欄位時，其餘欄位維持原值（真實 diff 合併，不是整包覆蓋）', async () => {
    const before = await readBranding(SHOP_A.id);

    const put = await ownerA.put('/api/settings/shop-page', { announcement: '只改公告' });
    expect(put.status).toBe(200);
    const putData = (await readJson<BrandingSettings>(put)).data!;
    expect(putData.announcement).toBe('只改公告');
    expect(putData.shopName).toBe(before.shopName);
    expect(putData.gallery).toEqual(before.gallery);
    expect(putData.themeColor).toBe(before.themeColor);

    const after = await readBranding(SHOP_A.id);
    expect(after.announcement).toBe('只改公告');
    expect(after.shopName).toBe(before.shopName);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100'}/api/settings/shop-page`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('STAFF 角色 PUT → 403 AUTH_005（需 MANAGER）', async () => {
    const staffApi = await loginAs(STAFF_A2.email, STAFF_A2.password);
    const res = await staffApi.put('/api/settings/shop-page', { shopName: '不該成功' });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('AUTH_005');
  });

  it('RLS 跨租戶：B 店讀寫互不影響 A 店的 branding', async () => {
    await resetTenantSettings(SHOP_A.id);
    const putA = await ownerA.put('/api/settings/shop-page', { shopName: 'A 店品牌名稱' });
    expect(putA.status).toBe(200);

    const putB = await ownerB.put('/api/settings/shop-page', { shopName: 'B 店品牌名稱' });
    expect(putB.status).toBe(200);

    const getA = await ownerA.get('/api/settings/shop-page');
    const dataA = (await readJson<BrandingSettings>(getA)).data!;
    expect(dataA.shopName).toBe('A 店品牌名稱');

    const getB = await ownerB.get('/api/settings/shop-page');
    const dataB = (await readJson<BrandingSettings>(getB)).data!;
    expect(dataB.shopName).toBe('B 店品牌名稱');

    // 直查 DB 交叉確認：A 店的列沒有被 B 店的寫入影響，反之亦然
    const dbA = await readBranding(SHOP_A.id);
    const dbB = await readBranding(SHOP_B.id);
    expect(dbA.shopName).toBe('A 店品牌名稱');
    expect(dbB.shopName).toBe('B 店品牌名稱');
  });
});

describe('POST /api/settings/shop-page/gallery/reorder（04 §A-1.1）', () => {
  const gallery: GalleryImage[] = [
    { id: 'r_1', url: '', caption: '一' },
    { id: 'r_2', url: '', caption: '二' },
    { id: 'r_3', url: '', caption: '三' },
  ];

  beforeAll(async () => {
    await resetTenantSettings(SHOP_A.id);
    const put = await ownerA.put('/api/settings/shop-page', { gallery });
    expect(put.status).toBe(200);
  });

  afterAll(async () => {
    await resetTenantSettings(SHOP_A.id);
  });

  it('改序後重讀順序符合送出的清單', async () => {
    const reversed = [...gallery.map((g) => g.id)].reverse();
    const res = await ownerA.post('/api/settings/shop-page/gallery/reorder', { ids: reversed });
    expect(res.status).toBe(200);
    const data = (await readJson<GalleryImage[]>(res)).data!;
    expect(data.map((g) => g.id)).toEqual(reversed);

    const dbBranding = await readBranding(SHOP_A.id);
    expect(dbBranding.gallery.map((g) => g.id)).toEqual(reversed);
    // 只是換順序，caption/url 等其餘欄位不受影響
    expect(dbBranding.gallery.find((g) => g.id === 'r_1')?.caption).toBe('一');
  });

  it('ids 不是目前 gallery 的完整排列 → 400 REQ_001（少一筆）', async () => {
    const partial = gallery.slice(0, 2).map((g) => g.id);
    const res = await ownerA.post('/api/settings/shop-page/gallery/reorder', { ids: partial });
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe('REQ_001');
  });

  it('ids 含不存在的 id → 400 REQ_001', async () => {
    const res = await ownerA.post('/api/settings/shop-page/gallery/reorder', {
      ids: ['r_1', 'r_2', 'r_3', 'not-exists'],
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe('REQ_001');
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(
      `${process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100'}/api/settings/shop-page/gallery/reorder`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['r_1'] }) },
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/staff/reorder（04 §B-2）', () => {
  afterAll(async () => {
    await resetStaffOrder();
  });

  it('改序後重讀順序符合送出的清單', async () => {
    await resetStaffOrder();
    const reversed = [SHOP_A.staffA2, SHOP_A.staffA1];
    const res = await ownerA.post('/api/staff/reorder', { ids: reversed });
    expect(res.status).toBe(200);

    const { data, error } = await admin
      .from('staff')
      .select('id, sort_order')
      .eq('tenant_id', SHOP_A.id)
      .in('id', reversed)
      .order('sort_order', { ascending: true });
    expect(error).toBeNull();
    const orderedIds = (data as Array<{ id: string }>).map((r) => r.id);
    expect(orderedIds).toEqual(reversed);
  });

  it('STAFF 角色 → 403 AUTH_005', async () => {
    const staffApi = await loginAs(STAFF_A2.email, STAFF_A2.password);
    const res = await staffApi.post('/api/staff/reorder', { ids: [SHOP_A.staffA1, SHOP_A.staffA2] });
    expect(res.status).toBe(403);
    expect((await readJson(res)).code).toBe('AUTH_005');
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100'}/api/staff/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [SHOP_A.staffA1] }),
    });
    expect(res.status).toBe(401);
  });

  it('RLS 跨租戶：B 店送出 A 店員工 id 不會改動 A 店的排序', async () => {
    await resetStaffOrder();
    const before = await admin
      .from('staff').select('id, sort_order').eq('tenant_id', SHOP_A.id).order('sort_order');
    const beforeIds = (before.data as Array<{ id: string; sort_order: number }>)
      .map((r) => ({ id: r.id, sortOrder: r.sort_order }));

    // B 店身分送出 A 店的員工 id——伺服器一律以 t.tenantId 過濾，B 店對不到列，
    // update 影響筆數為 0，不應該回錯（呼叫端看不到別店的資源存不存在），
    // 但 A 店的實際排序必須完全不變。
    const res = await ownerB.post('/api/staff/reorder', { ids: [SHOP_A.staffA2, SHOP_A.staffA1] });
    expect(res.status).toBe(200);

    const after = await admin
      .from('staff').select('id, sort_order').eq('tenant_id', SHOP_A.id).order('sort_order');
    const afterIds = (after.data as Array<{ id: string; sort_order: number }>)
      .map((r) => ({ id: r.id, sortOrder: r.sort_order }));
    expect(afterIds).toEqual(beforeIds);
  });
});
