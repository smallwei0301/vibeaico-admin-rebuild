// GET /api/block-times?from&to、POST /api/block-times — 封鎖時段 CRUD（04 §B-1，
// #169 補齊 title/recurrence/day_of_week/full_day/auto，欄位同 0074 migration）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import {
  BLOCK_TIME_SELECT, blockTimeWriteSchema, mapBlockTime, queryEffectiveBlockTimes,
  validateBlockTimeTimes, type BlockTimeRow,
} from '@/server/block-times';

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const GET = handle(async (req) => {
  const t = await requireTenant();
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  // 有給區間 → 用共用展開查詢（WEEKLY 在此展開成實際發生的每一次）；
  // 沒給區間（頁面列表用途，要看到規則本身而非展開後的多筆）→ 原樣列出全部。
  if (q.from || q.to) {
    const from = q.from ?? new Date(0).toISOString();
    const to = q.to ?? new Date('9999-12-31').toISOString();
    const rows = await queryEffectiveBlockTimes(t.supabase, t.tenantId, from, to);
    return ok(rows.map(mapBlockTime));
  }

  const { data, error } = await t.supabase.from('block_times')
    .select(BLOCK_TIME_SELECT)
    .eq('tenant_id', t.tenantId)
    .order('start_at', { ascending: true });
  if (error) throw error;
  return ok(((data ?? []) as unknown as BlockTimeRow[]).map(mapBlockTime));
});

export const POST = handle(async (req) => {
  const t = await requireTenant();
  const b = blockTimeWriteSchema.parse(await req.json());
  const { recurrence, dayOfWeek } = validateBlockTimeTimes(b);

  if (b.staffId) {
    const { data: staff, error } = await t.supabase.from('staff').select('id')
      .eq('id', b.staffId).eq('tenant_id', t.tenantId).maybeSingle();
    if (error) throw error;
    if (!staff) throw new ApiHttpError(404, '找不到此服務人員', ERR.NOT_FOUND);
  }

  const { data, error } = await t.supabase.from('block_times')
    .insert({
      tenant_id: t.tenantId,
      staff_id: b.staffId ?? null,
      title: b.title ?? '',
      reason: b.reason ?? '',
      recurrence,
      day_of_week: dayOfWeek,
      full_day: b.fullDay ?? false,
      // auto 只由系統（每天不同營業時間自動產生）寫入，這個端點一律 false
      auto: false,
      start_at: new Date(Date.parse(b.startAt)).toISOString(),
      end_at: new Date(Date.parse(b.endAt)).toISOString(),
    })
    .select('id').single();
  if (error) throw error;
  return ok({ id: data.id });
});
