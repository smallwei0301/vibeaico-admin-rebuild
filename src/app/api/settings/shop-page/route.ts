import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { brandingSettingsSchema } from '@/config/tenant-settings';

/**
 * GET /api/settings/shop-page — 04 §A-1.1。
 * 回 `BrandingSettings`（`/tenant/shop-design` 六分頁整包資料）。與
 * `GET /api/settings` 的 `data.branding` 是同一顆 `tenant_settings.branding`
 * jsonb，只是本端點只回這一群組，供 shop-design 頁專用讀取。
 */
export const GET = handle(async () => {
  const t = await requireTenant();
  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('branding')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  return ok(brandingSettingsSchema.parse(row?.branding ?? {}));
});

/**
 * PUT /api/settings/shop-page — 04 §A-1.1。
 * body = `Partial<BrandingSettings>`（真實 diff：呼叫端只送這次真的異動的欄位）。
 *
 * ⚠️ 這是 14 分冊「shop-design 儲存送空 patch＝假成功」根因的正式修法：
 *   1. 先讀現有 `branding`（不是憑空拿 body 當全部真相）
 *   2. 用 `brandingSettingsSchema.partial()` 只驗證 body 裡出現的欄位
 *   3. 淺層合併（`{...current, ...patch}`）再用完整 schema 驗一次
 *   4. 寫回 → **回傳合併後的全量值**，前端必須拿這個回傳值重繪
 * 送 `{}`（沒有任何欄位）時，合併結果等於現有值，DB 寫回同樣的內容——
 * 不會清空任何既有資料，這正是本端點要鎖住的行為。
 *
 * `gallery` 若出現在 patch 是整批取代（新增/刪除圖片）；只是想改變既有圖片的
 * 相對順序要走 `POST /api/settings/shop-page/gallery/reorder`。
 *
 * 欄位歸屬邊界見 04 §A-1.1 表格：branding 群組自本端點起是 shop-design 頁
 * 寫入的唯一入口，`PUT /api/settings` 保留舊版整包覆蓋語意只是相容 issue #7
 * 既有回歸測試與 mock 分支，沒有頁面會再呼叫它送 branding。
 */
const patchSchema = brandingSettingsSchema.partial();

export const PUT = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const patch = patchSchema.parse(await req.json());

  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('branding')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  const current = brandingSettingsSchema.parse(row?.branding ?? {});
  const merged = brandingSettingsSchema.parse({ ...current, ...patch });

  const { error: upsertError } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, branding: merged }, { onConflict: 'tenant_id' });
  if (upsertError) throw upsertError;

  return ok(merged);
});
