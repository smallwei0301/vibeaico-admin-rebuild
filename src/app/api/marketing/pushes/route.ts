import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * /api/marketing/pushes — 推播草稿 CRUD（04 分冊 §B-5）。
 *
 * jsonb 語意（依 0005 marketing_pushes 註解 + marketing 頁 mock 決定）：
 * - content  jsonb = { text, imageUrl, note }（訊息本文／圖片／內部備註）
 * - audience jsonb = { type:'ALL'|'MEMBERSHIP_LEVEL'|'TAG'|'CUSTOM', value, label }
 *   value：MEMBERSHIP_LEVEL=等級 id；TAG=標籤名稱；CUSTOM=LINE User ID 換行清單。
 * - status：DRAFT/SCHEDULED/SENT/CANCELLED（0005 註解）＋ FAILED（LINE 發送失敗，
 *   對齊 marketing 頁 mock；text 欄位可容納）。
 */

function mapPush(r: any) {
  const c = r.content ?? {};
  const a = r.audience ?? {};
  return {
    id: r.id as string,
    title: r.title as string,
    content: typeof c.text === 'string' ? (c.text as string) : '',
    imageUrl: typeof c.imageUrl === 'string' ? (c.imageUrl as string) : '',
    note: typeof c.note === 'string' ? (c.note as string) : '',
    targetType: (a.type ?? 'ALL') as string,
    targetValue: typeof a.value === 'string' ? (a.value as string) : '',
    targetLabel: typeof a.label === 'string' ? (a.label as string) : '',
    status: r.status as string,
    sentCount: (r.sent_count ?? 0) as number,
    scheduledAt: (r.scheduled_at ?? null) as string | null,
    sentAt: (r.sent_at ?? null) as string | null,
    createdAt: r.created_at as string,
  };
}

export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('marketing_pushes')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ok((data ?? []).map(mapPush));
});

const createSchema = z.object({
  title: z.string().min(1, '請輸入推播標題'),
  content: z.string().optional(),
  imageUrl: z.string().optional(),
  note: z.string().optional(),
  targetType: z.enum(['ALL', 'MEMBERSHIP_LEVEL', 'TAG', 'CUSTOM']).optional(),
  targetValue: z.string().optional(),
  targetLabel: z.string().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = createSchema.parse(await req.json());

  const { data, error } = await t.supabase
    .from('marketing_pushes')
    .insert({
      tenant_id: t.tenantId,
      title: b.title,
      content: { text: b.content ?? '', imageUrl: b.imageUrl ?? '', note: b.note ?? '' },
      audience: {
        type: b.targetType ?? 'ALL',
        value: b.targetValue ?? '',
        label: b.targetLabel ?? '',
      },
      scheduled_at: b.scheduledAt ?? null,
      status: b.scheduledAt ? 'SCHEDULED' : 'DRAFT',
    })
    .select('id')
    .single();
  if (error) throw error;

  return ok({ id: data.id });
});
