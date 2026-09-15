import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { brandingSettingsSchema, tenantSettingsSchema } from '@/config/tenant-settings';
import { getTenantSettings, saveShopPageSettings, saveTenantSettings } from '@/services/settings';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/shop-design/page.tsx');
const service = read('src/services/settings.ts');
const route = read('src/app/api/settings/route.ts');
const shopPageRoute = read('src/app/api/settings/shop-page/route.ts');
const migration = read('supabase/migrations/0077_shop_design_branding.sql');

/** 空字串常數，避免下面的斷言本身在原始碼裡留下 `saveTenantSettings({})` 這個
 * 已鎖死的壞字面值（連在字串常值或註解裡出現都會讓 issue #22 的 grep 驗收誤判）。 */
const EMPTY_PATCH_CALL = ['saveTenantSettings', '(', '{', '}', ')'].join('');

describe('shop-design 儲存不再送空物件（#7：假成功鎖死回歸；#22 演進為真實 diff 端點）', () => {
  it('save() 不再呼叫 saveTenantSettings({})（#7 原始回歸鎖，仍然成立）', () => {
    expect(page).not.toContain(EMPTY_PATCH_CALL);
  });

  it('#22：save() 已改走 saveShopPageSettings（真實 diff，不再整包覆蓋 branding）', () => {
    // #7 時期的整包覆蓋寫法已被淘汰——不應該再出現在 page.tsx 裡。
    expect(page).not.toContain('await saveTenantSettings({ branding: config });');
    expect(page).not.toContain('saveTenantSettings');

    // 新寫法：算出真的異動的欄位 → saveShopPageSettings → 用伺服器回傳值重繪。
    expect(page).toContain('saveShopPageSettings(diffFromLastSynced())');
    expect(page).toContain('lastSyncedRef.current = updated;');
    expect(page).toContain('setConfig(updated);');
  });

  it('#22：saveShopPageSettings 真的存在且指向 PUT /api/settings/shop-page', () => {
    expect(typeof saveShopPageSettings).toBe('function');
    expect(service).toContain("request<BrandingSettings>('/api/settings/shop-page', {");
    expect(shopPageRoute).toContain('brandingSettingsSchema.partial()');
  });

  it('載入時從 getTenantSettings() 回填畫面（不是頁內寫死的 SHOP_PAGE_BY_MODE）', () => {
    expect(page).toContain('const s = await getTenantSettings();');
    expect(page).toContain('const loaded = { ...s.branding,');
    expect(page).toContain('setConfig(loaded);');
    expect(page).not.toContain('SHOP_PAGE_BY_MODE');
    expect(page).not.toContain('BLANK_SHOP_PAGE');
  });

  it('失敗時顯示後端真實錯誤訊息，不是自己編的固定文案', () => {
    expect(page).toMatch(/e instanceof Error \? e\.message : t\.messages\.saveFailed/);
  });

  it('上傳按鈕仍保留（誠實復原：沒有被默默移除），但本 slice 沒有接上傳流程', () => {
    // 三個上傳按鈕文案仍在，且沒有新增任何 storage bucket 或 upload 呼叫
    expect(page).toContain('t.profile.logoUpload');
    expect(page).toContain('t.banner.uploadPrompt');
    expect(page).toContain('t.about.imageUploadPrompt');
    expect(page).not.toContain('shop-branding-images');
    expect(service).not.toContain('shop-branding-images');
  });
});

describe('src/config/tenant-settings.ts — brandingSettingsSchema', () => {
  it('可以 parse 空物件 {}（既有租戶 tenant_settings.branding 預設值 "{}" 相容性）', () => {
    const parsed = brandingSettingsSchema.parse({});
    expect(parsed.shopName).toBe('');
    expect(parsed.logoHidden).toBe(false);
    expect(parsed.bannerVideoSound).toBe(true);
    expect(parsed.gallery).toEqual([]);
    expect(parsed.themeColor).toBe('#6366f1');
  });

  it('欄位與 ShopPageConfig 逐字對照（不多不少）', () => {
    const parsed = brandingSettingsSchema.parse({});
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'shopName', 'logoUrl', 'logoHidden', 'bannerUrl', 'bannerVideoUrl', 'bannerVideoSound',
        'announcement', 'aboutTitle', 'aboutContent', 'aboutImageUrl', 'gallery', 'themeColor',
        'facebook', 'instagram', 'line', 'threads', 'googleMaps', 'contactEmail',
      ].sort(),
    );
  });

  it('已掛進 tenantSettingsSchema 的 branding 群組', () => {
    const parsed = tenantSettingsSchema.parse({
      basic: { tenantName: '測試店', shopCode: 'test-shop' },
      business: {}, notify: {}, privacy: {}, points: {}, line: {}, branding: {},
    });
    expect(parsed.branding).toBeDefined();
    expect(parsed.branding.shopName).toBe('');
  });
});

describe('src/app/api/settings/route.ts — GET/PUT 都支援 branding', () => {
  it('GET 回應組裝 branding', () => {
    expect(route).toContain('branding: brandingSettingsSchema.parse(row.branding ?? {})');
  });

  it('PUT bodySchema 接受 branding，且出現時真的寫進 update', () => {
    expect(route).toContain('branding: brandingSettingsSchema.optional()');
    expect(route).toContain('if (b.branding) update.branding = b.branding;');
  });
});

describe('supabase/migrations/0077 — branding 欄位、必須冪等', () => {
  it('用 add column if not exists，不是 add column（避免二次套用炸掉）', () => {
    expect(migration).toMatch(/add column if not exists branding jsonb not null default '\{\}'/);
    expect(migration).not.toMatch(/add column branding(?! if not exists)/);
  });
});

describe('src/services/settings.ts — mock 分支延遲初始化，不在 module scope 讀 MOCK_MODE', () => {
  it('getMockBrandingStore 是函式（延遲初始化），不是 module 頂層常數', () => {
    expect(service).toContain('function getMockBrandingStore()');
    expect(service).toMatch(/let mockBrandingStore: Record<BusinessType, BrandingSettings> \| null = null;/);
  });

  it('不在 module 頂層直接呼叫 byMode(SHOP_PAGE_BY_MODE) 或在頂層讀 MOCK_MODE 建常數', () => {
    // MOCK_MODE 只能出現在函式主體內（getMockBrandingStore 呼叫處之後），
    // 這裡只驗證檔案沒有 `const xxx = MOCK_MODE` 這種頂層凍結寫法。
    expect(service).not.toMatch(/^const \w+ = MOCK_MODE/m);
  });
});

describe('mock 模式往返（NEXT_PUBLIC_USE_MOCK 預設 true）', () => {
  it('saveTenantSettings({ branding }) 整包覆蓋語意仍相容（#7 舊路徑，尚未拔除）', async () => {
    const before = await getTenantSettings();
    expect(before.branding).toBeDefined();

    await saveTenantSettings({
      branding: {
        ...before.branding,
        shopName: '往返測試店名',
        announcement: '往返測試公告文字',
        themeColor: '#123456',
      },
    });

    const after = await getTenantSettings();
    expect(after.branding.shopName).toBe('往返測試店名');
    expect(after.branding.announcement).toBe('往返測試公告文字');
    expect(after.branding.themeColor).toBe('#123456');
  });

  it('#22：saveShopPageSettings 只送出的欄位會合併進既有 branding，其餘欄位不受影響', async () => {
    const before = await getTenantSettings();
    const merged = await saveShopPageSettings({ shopName: '#22 diff 測試店名' });

    expect(merged.shopName).toBe('#22 diff 測試店名');
    // 沒有送出的欄位（例如 announcement）維持原值——真實 diff 合併，不是整包覆蓋。
    expect(merged.announcement).toBe(before.branding.announcement);

    const after = await getTenantSettings();
    expect(after.branding.shopName).toBe('#22 diff 測試店名');
  });

  it('#22：saveShopPageSettings({}) 空 patch 不清空既有資料', async () => {
    const before = await getTenantSettings();
    const merged = await saveShopPageSettings({});
    expect(merged).toEqual(before.branding);
  });
});
