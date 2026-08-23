import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * /api/campaigns — 行銷活動 CRUD（04 分冊 §B-5）。
 * 欄位以 0005 campaigns 表為準：name、keyword（LINE 輸入關鍵字觸發）、
 * content jsonb、start_at/end_at、status DRAFT/PUBLISHED/PAUSED/ENDED。
 * campaigns 頁 mock 的 description/type 等展示欄位收進 content jsonb
 * （content = { description, type, ...其餘設定 }），DB 不拆欄。
 */

function mapCampaign(r: any) {
  const c = r.content ?? {};
  return {
    id: r.id as string,
    name: r.name as string,
    keyword: (r.keyword ?? '') as string,
    description: typeof c.description === 'string' ? (c.description as string) : '',
    type: typeof c.type === 'string' ? (c.type as string) : '',
    content: c as Record<string, unknown>,
    status: r.status as string,
    startAt: (r.start_at ?? null) as string | null,
    endAt: (r.end_at ?? null) as string | null,
    createdAt: r.created_at as string,
  };
}

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('campaigns')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ok((data ?? []).map(mapCampaign));
});

const createSchema = z.object({
  name: z.string().min(1, '請輸入活動名稱'),
  keyword: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  content: z.record(z.unknown()).optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  const content: Record<string, unknown> = { ...(b.content ?? {}) };
  if (b.description !== undefined) content.description = b.description;
  if (b.type !== undefined) content.type = b.type;

  const { data, error } = await t.supabase
    .from('campaigns')
    .insert({
      tenant_id: t.tenantId,
      name: b.name,
      keyword: b.keyword ?? '',
      content,
      start_at: b.startAt ?? null,
      end_at: b.endAt ?? null,
      status: 'DRAFT',
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
