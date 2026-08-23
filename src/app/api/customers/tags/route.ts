// GET /api/customers/tags — 該店所有顧客標籤去重排序（04 分冊 §B-6）。
// 回 { tags: string[] }。customers.tags 是 text[]（0004），含停用顧客的標籤也
// 一併列出（「該店所有 tags」；標籤下拉要能篩到殘留在停用顧客上的舊標籤）。
// 排序用 zh-Hant collator（中文筆劃序，比 codepoint 序合理）。
// 店家量級小：全量一次查回、Node 端去重即可。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

export const GET = handle(async () => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'ADVANCED_CUSTOMER');

  const { data: rows, error } = await t.supabase.from('customers')
    .select('tags')
    .eq('tenant_id', t.tenantId);
  if (error) throw error;

  const set = new Set<string>();
  for (const r of rows ?? []) for (const tag of r.tags ?? []) if (tag) set.add(tag);

  const tags = [...set].sort(new Intl.Collator('zh-Hant').compare);
  return ok({ tags });
});
