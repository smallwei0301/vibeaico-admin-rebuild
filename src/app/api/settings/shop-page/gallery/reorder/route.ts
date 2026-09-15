import { z } from 'zod';
import { fail, handle, ok, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { brandingSettingsSchema, type GalleryImage } from '@/config/tenant-settings';

/**
 * POST /api/settings/shop-page/gallery/reorder — 04 §A-1.1。
 * body = `{ids: string[]}`：`ids` 必須是目前 `branding.gallery[].id` 的
 * **完整排列**（可換順序，不可增減、不可含不存在的 id）；否則 400 `REQ_001`。
 *
 * ⚠️ 與 `services/reorder`／`staff/reorder` 不同：`gallery` 沒有獨立的
 * `sort_order` 欄位，它是 `tenant_settings.branding` jsonb 裡的一個陣列，
 * 順序就是陣列索引本身。不需要 migration，也不需要「只提交部分 id、其餘接在
 * 後面」的部分排序語意（原站圖片展示最多 9 張，一次操作就看得到全部）。
 */
const bodySchema = z.object({ ids: z.array(z.string()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  const { data: row, error } = await t.supabase
    .from('tenant_settings')
    .select('branding')
    .eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (error) throw error;

  const branding = brandingSettingsSchema.parse(row?.branding ?? {});
  const existingIds = branding.gallery.map((g) => g.id);
  const requestedSet = new Set(b.ids);
  const existingSet = new Set(existingIds);
  const isExactPermutation =
    requestedSet.size === b.ids.length &&
    requestedSet.size === existingSet.size &&
    existingIds.every((id) => requestedSet.has(id));
  if (!isExactPermutation) {
    return fail(400, '排序清單必須是目前圖片展示清單的完整排列', ERR.VALIDATION);
  }

  const byId = new Map(branding.gallery.map((g) => [g.id, g]));
  const reordered: GalleryImage[] = b.ids.map((id) => byId.get(id)!);
  const merged = { ...branding, gallery: reordered };

  const { error: upsertError } = await t.supabase
    .from('tenant_settings')
    .upsert({ tenant_id: t.tenantId, branding: merged }, { onConflict: 'tenant_id' });
  if (upsertError) throw upsertError;

  return ok(reordered);
});
