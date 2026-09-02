/**
 * POST /api/bug-report — Issue #28① 的四欄逐一保存證明。
 *
 * 測試會真的登入、呼叫 API、再由 service role 讀回資料庫。每一筆測試資料都在
 * finally 刪除，避免 shared TEST 留下殘渣。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
};

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function suffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

describe('POST /api/bug-report（Issue #28①）', () => {
  it('persists category / subject / content / contact_email in separate columns', async () => {
    const s = suffix();
    const payload = {
      category: 'DISPLAY',
      subject: `頁面無法儲存-${s}`,
      content: `操作步驟-${s}\n按下儲存後仍停留在原畫面`,
      contactEmail: `reply-${s}@example.test`,
      pageUrl: `https://example.test/tenant/services?probe=${s}`,
    };

    const res = await ownerA.post('/api/bug-report', payload);
    expect(res.status).toBe(200);
    const body = await readJson<{ id: string }>(res);
    expect(body.success).toBe(true);
    expect(body.data?.id).toBeTruthy();

    const reportId = body.data!.id;
    try {
      const { data: row, error } = await admin
        .from('bug_reports')
        .select('tenant_id, reporter, category, subject, content, contact_email, page_url')
        .eq('id', reportId)
        .single();
      expect(error).toBeNull();
      expect(row).toBeTruthy();
      expect(row!.tenant_id).toBe(SHOP_A.id);
      expect(row!.reporter).toBe(SHOP_A.owner.email);
      expect(row!.reporter).not.toBe(row!.contact_email);
      expect(row!.category).toBe(payload.category);
      expect(row!.subject).toBe(payload.subject);
      expect(row!.content).toBe(payload.content);
      expect(row!.contact_email).toBe(payload.contactEmail);
      expect(row!.page_url).toBe(payload.pageUrl);
    } finally {
      await admin.from('bug_reports').delete().eq('id', reportId);
    }
  });

  it('keeps optional contact email empty and defaults an omitted category to OTHER', async () => {
    const s = suffix();
    const payload = {
      subject: `無聯絡信箱-${s}`,
      content: `只保存必要內容-${s}`,
    };

    const res = await ownerA.post('/api/bug-report', payload);
    expect(res.status).toBe(200);
    const body = await readJson<{ id: string }>(res);
    const reportId = body.data!.id;

    try {
      const { data: row, error } = await admin
        .from('bug_reports')
        .select('reporter, category, subject, content, contact_email, page_url')
        .eq('id', reportId)
        .single();
      expect(error).toBeNull();
      expect(row!.reporter).toBe(SHOP_A.owner.email);
      expect(row!.category).toBe('OTHER');
      expect(row!.subject).toBe(payload.subject);
      expect(row!.content).toBe(payload.content);
      expect(row!.contact_email).toBe('');
      expect(row!.page_url).toBe('');
    } finally {
      await admin.from('bug_reports').delete().eq('id', reportId);
    }
  });

  it('rejects missing or whitespace-only title and description at the API boundary', async () => {
    const cases = [
      { content: '有內容' },
      { subject: '   ', content: '有內容' },
      { subject: '有標題', content: '   ' },
    ];

    for (const payload of cases) {
      const res = await ownerA.post('/api/bug-report', payload);
      expect(res.status).toBe(400);
    }
  });

  it('rejects an unauthenticated report before service-role insertion', async () => {
    const res = await fetch(`${BASE}/api/bug-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: '未登入', content: '不可寫入' }),
    });
    expect(res.status).toBe(401);
  });
});
