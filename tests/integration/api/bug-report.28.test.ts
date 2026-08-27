/**
 * POST /api/bug-report — 使用者填的內容真的被收集（GitHub issue #28 第 ① 筆）
 * -----------------------------------------------------------------------------
 * 04 分冊 §B-6。全站常駐的「回報問題」modal 先前四個欄位全是 uncontrolled，
 * submit() 只 setTimeout 500ms 就道謝——**使用者回報的每一個問題都直接消失**。
 * 所以這一檔的驗收重點刻意不是「bug_reports 多了一列」（那樣的斷言在缺陷還在時
 * 也可能被誤判成通過），而是**四個欄位的內容逐一比對相符**：類別、標題、
 * 詳細說明、聯絡信箱，一個一個對。
 *
 * subject / contact_email 是 migration 0018 補的欄位（0012 建表時只有
 * category/content/page_url，另兩個沒有落點）。
 *
 * 讀回用 service role 直查：bug_reports 是平台級表，RLS enable 且刻意無 policy，
 * 店家的 session client 讀不到（這一點本身也順手驗了）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let admin: SupabaseClient;
let ownerA: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

describe('POST /api/bug-report（04 §B-6）', () => {
  it('modal 的四個欄位逐一落到 bug_reports：category / subject / content / contact_email 內容相符', async () => {
    // 每個欄位給**不同**的可辨識值：任何一欄被丟掉、被別欄覆蓋、或被塞成同一串，
    // 下面的逐欄比對都會紅。
    const s = suffix();
    const payload = {
      category: 'DISPLAY',
      subject: `標題-${s}`,
      content: `詳細說明-${s}\n第二行：重現步驟`,
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

      // ---- 四個欄位逐一比對（本 issue 的驗收核心）----
      expect(row!.category).toBe(payload.category);
      expect(row!.subject).toBe(payload.subject);
      expect(row!.content).toBe(payload.content);
      expect(row!.contact_email).toBe(payload.contactEmail);

      // ---- 伺服器端補的欄位 ----
      expect(row!.page_url).toBe(payload.pageUrl);
      expect(row!.tenant_id).toBe(SHOP_A.id);
      // reporter 是登入帳號，與使用者自填的 contact_email 是兩回事，不得互相覆蓋
      expect(row!.reporter).toBe(SHOP_A.owner.email);
      expect(row!.reporter).not.toBe(row!.contact_email);
    } finally {
      await admin.from('bug_reports').delete().eq('id', reportId);
    }
  });

  it('聯絡信箱留空 → contact_email 存空字串，不拿 reporter 頂替', async () => {
    const s = suffix();
    const res = await ownerA.post('/api/bug-report', {
      category: 'BUG',
      subject: `無信箱-${s}`,
      content: `無信箱內容-${s}`,
    });
    expect(res.status).toBe(200);
    const reportId = (await readJson<{ id: string }>(res)).data!.id;
    try {
      const { data: row } = await admin
        .from('bug_reports')
        .select('subject, content, contact_email, page_url')
        .eq('id', reportId)
        .single();
      expect(row!.subject).toBe(`無信箱-${s}`);
      expect(row!.content).toBe(`無信箱內容-${s}`);
      expect(row!.contact_email).toBe('');
      expect(row!.page_url).toBe('');
    } finally {
      await admin.from('bug_reports').delete().eq('id', reportId);
    }
  });

  it('標題或說明是空的 → 400（modal 送出前就擋，但端點不能只靠前端）', async () => {
    const noSubject = await ownerA.post('/api/bug-report', { subject: '', content: '有內容' });
    expect(noSubject.status).toBe(400);
    const noContent = await ownerA.post('/api/bug-report', { subject: '有標題', content: '' });
    expect(noContent.status).toBe(400);
  });

  it('未登入 → 401（bug_reports 是平台級表，寫入須先有租戶脈絡）', async () => {
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/bug-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: 'x', content: 'y' }),
    });
    expect(res.status).toBe(401);
  });
});
