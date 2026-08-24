import { z } from 'zod';
import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTrip } from '@/server/mappers';
import { planRowFromImport, tripRowFromImport } from '@/server/trip-payload';

/**
 * POST /api/trips/import — 匯入 tour-platform 匯出的行程 JSON ⚙M。
 *
 * 使用者需求原文：「tour platform 的管理者 json 文件也可以到這裡傳上去，
 * 直接是之前整理好的行程和方案，不會遺漏。」
 *
 * 行為與 tour-platform 匯入端一致的兩點：
 *   1. `_instructions` 是欄位說明區塊，忽略不寫入。
 *   2. 方案「只新增不覆蓋」——重跑同一份檔案不會把使用者後來在後台改過的
 *      方案內容蓋掉（以 slug 比對既有方案；tour-platform 匯入說明第 4 點同此）。
 *
 * 行程本身則以 slug 判斷新增或更新：同 slug 視為同一個行程的新版本內容。
 * 這讓「在 tour-platform 改完再匯一次」是可預期的更新，而不是每次都長出新行程。
 *
 * 接受單筆物件或陣列（tour-platform 一次匯出一個行程，但管理者可能自行合併多個）。
 */
const bodySchema = z.object({
  trips: z.array(z.record(z.string(), z.unknown())).min(1).optional(),
  // 也接受直接把單一行程 JSON 當 body 送上來
}).passthrough();

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const raw = await req.json();
  const parsed = bodySchema.parse(raw);

  const items: any[] = Array.isArray(raw)
    ? raw
    : parsed.trips ?? [raw];

  const results: Array<{ title: string; tripId: string; created: boolean; plansAdded: number }> = [];

  for (const item of items) {
    if (!item?.title) {
      return fail(400, '匯入的 JSON 缺少 title 欄位', ERR.VALIDATION);
    }
    const row = tripRowFromImport(item, t.tenantId);

    // 同 slug = 同一個行程，更新內容；否則新建
    const { data: existing, error: exErr } = await t.supabase.from('trips')
      .select('id').eq('tenant_id', t.tenantId).eq('slug', row.slug).maybeSingle();
    if (exErr) throw exErr;

    let tripId: string;
    if (existing) {
      const { tenant_id: _t, slug: _s, ...patch } = row;
      const { error } = await t.supabase.from('trips')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('tenant_id', t.tenantId).eq('id', existing.id);
      if (error) throw error;
      tripId = existing.id;
    } else {
      const { data, error } = await t.supabase.from('trips')
        .insert(row).select('id').single();
      if (error) throw error;
      tripId = data.id;
    }

    // 方案：只新增尚不存在的（以 slug 比對），不覆蓋既有內容
    const incoming: any[] = Array.isArray(item.activityPlans) ? item.activityPlans : [];
    const { data: currentPlans, error: cpErr } = await t.supabase.from('trip_plans')
      .select('slug').eq('tenant_id', t.tenantId).eq('trip_id', tripId);
    if (cpErr) throw cpErr;
    const known = new Set((currentPlans ?? []).map((p: any) => p.slug));

    const toInsert = incoming
      .map((p, i) => planRowFromImport(p, t.tenantId, tripId, (currentPlans?.length ?? 0) + i))
      .filter((p) => !known.has(p.slug));

    if (toInsert.length) {
      const { error } = await t.supabase.from('trip_plans').insert(toInsert);
      if (error) throw error;
    }

    results.push({
      title: row.title, tripId, created: !existing, plansAdded: toInsert.length,
    });
  }

  return ok({ imported: results.length, results });
});
