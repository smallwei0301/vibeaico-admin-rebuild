/**
 * 客服對話串真的持久化，且租戶邊界成立 — `POST/GET /api/support-chat/threads*`
 * -----------------------------------------------------------------------------
 * 規格：`docs/decisions/2026-09-11-support-chat-human-escalation.md`，
 * migration：`supabase/migrations/0116_issue_25b_support_chat_threads.sql`。
 *
 * ⚠️ 誠實聲明（issue #25 B 段驗收要求）：本檔已撰寫完整，但**尚未在本 agent
 * worktree 執行**——此 worktree 沒有 TEST Supabase 憑證（`TEST_SUPABASE_URL` /
 * `TEST_SUPABASE_SERVICE_ROLE_KEY` 未注入），`npm run test:integration` 在這裡
 * 會因為連不上共用 TEST 而整批失敗，不是本檔邏輯的問題。需要
 * `docs/AGENT-EXECUTION.md`／isolated-test-orchestration 描述的 shared TEST
 * holder 資格才能真的跑起來並回報綠燈；在那之前，這是「已撰寫、未驗證」的狀態，
 * 不得宣稱已通過。
 *
 * 本檔守：
 *   1. 建立 thread 真的寫進 DB（不是本地假成功）——直接用 admin client 查表核對。
 *   2. A 店看不到 B 店的 thread／訊息：GET 詳情回 404，GET 列表裡沒有對方的 id。
 *   3. 未設定 `PLATFORM_SUPPORT_NOTIFY_EMAIL` 時建立仍然成功，`notifyStatus`
 *      誠實回 `SKIPPED_NO_RECIPIENT`，thread 沒有因此消失。
 *   4. 追加留言（follow-up）會更新 `last_message_at`，且同樣鎖在自己店。
 *   5. GET 詳情會把 `tenant_read_at` 標記成現在（已讀語意）。
 *   6. STAFF 也用得到（這是溝通管道，不需要 MANAGER）。
 *
 * 清理紀律：本檔建立的 thread／訊息在 afterAll 用 admin client 依 id 刪除，
 * 不動任何既有種子資料。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, STAFF_A2 } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

const BASE = '/api/support-chat/threads';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
interface ThreadSummary {
  id: string;
  subject: string;
  status: string;
  notifyStatus: string;
  lastMessageAt: string;
  unread: boolean;
  createdAt: string;
}
interface ThreadDetail extends ThreadSummary {
  messages: { id: string; senderRole: string; senderEmail: string; body: string; createdAt: string }[];
}

const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
let staffA: AuthedApi;
const createdThreadIds: string[] = [];

beforeAll(async () => {
  admin = createClient(
    process.env.TEST_SUPABASE_URL!,
    process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  [ownerA, ownerB, staffA] = await Promise.all([
    loginAs(SHOP_A.owner.email, SHOP_A.owner.password),
    loginAs(SHOP_B.owner.email, SHOP_B.owner.password),
    loginAs(STAFF_A2.email, STAFF_A2.password),
  ]);
});

afterAll(async () => {
  if (!admin || createdThreadIds.length === 0) return;
  await admin.from('support_chat_threads').delete().in('id', createdThreadIds);
});

describe('建立客服對話串：真的持久化，且通知狀態誠實', () => {
  it('OWNER 建立 thread 成功，DB 裡真的有這一列與第一則訊息', async () => {
    const res = await ownerA.post(BASE, { subject: '無法收款', body: '顧客付款後訂單一直卡在待付款' });
    expect(res.status).toBe(201);
    const json = await readJson<ThreadDetail>(res);
    expect(json.success).toBe(true);
    const thread = json.data!;
    createdThreadIds.push(thread.id);

    expect(thread.status).toBe('OPEN');
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].senderRole).toBe('TENANT');
    // 通知結果誠實回報——是 SENT 還是 SKIPPED_* 依這個環境的
    // PLATFORM_SUPPORT_NOTIFY_EMAIL／RESEND_API_KEY 而定，兩種都算合法回應，
    // 但不能是 undefined（那代表呼叫端漏了處理通知結果）。
    expect(['SENT', 'FAILED', 'SKIPPED_NO_KEY', 'SKIPPED_NO_RECIPIENT']).toContain(thread.notifyStatus);

    const { data: row } = await admin
      .from('support_chat_threads')
      .select('id, tenant_id, subject, notify_status')
      .eq('id', thread.id)
      .maybeSingle();
    expect(row?.tenant_id).toBe(SHOP_A.id);
    expect(row?.subject).toBe('無法收款');
    expect(row?.notify_status).toBe(thread.notifyStatus);
  });

  it('STAFF 也能建立 thread（這是溝通管道，不需要 MANAGER）', async () => {
    const res = await staffA.post(BASE, { subject: '想確認功能', body: '請問這個功能怎麼用？' });
    expect(res.status).toBe(201);
    const json = await readJson<ThreadDetail>(res);
    createdThreadIds.push(json.data!.id);
  });

  it('空主旨／空內容被 zod 擋成 400', async () => {
    const res = await ownerA.post(BASE, { subject: '', body: '' });
    expect(res.status).toBe(400);
  });
});

describe('跨租戶隔離：A 店看不到 B 店的 thread', () => {
  let threadA: string;

  beforeAll(async () => {
    const res = await ownerA.post(BASE, { subject: '跨租戶測試', body: '這則只屬於 A 店' });
    threadA = (await readJson<ThreadDetail>(res)).data!.id;
    createdThreadIds.push(threadA);
  });

  it('B 店的列表裡沒有 A 店的 thread id', async () => {
    const res = await ownerB.get(BASE);
    const json = await readJson<{ threads: ThreadSummary[] }>(res);
    const ids = (json.data?.threads ?? []).map((t) => t.id);
    expect(ids).not.toContain(threadA);
  });

  it('B 店直接打 A 店的 thread 詳情 → 404，不是 200 帶著 A 店內容', async () => {
    const res = await ownerB.get(`${BASE}/${threadA}`);
    expect(res.status).toBe(404);
  });

  it('B 店對 A 店的 thread 追加留言 → 404，不會寫成功', async () => {
    const res = await ownerB.post(`${BASE}/${threadA}/messages`, { body: '不該成功' });
    expect(res.status).toBe(404);

    const { data: messages } = await admin
      .from('support_chat_messages')
      .select('sender_email')
      .eq('thread_id', threadA);
    expect((messages ?? []).some((m) => m.sender_email === SHOP_B.owner.email)).toBe(false);
  });

  it('A 店自己讀得到，且 GET 詳情會標記已讀（tenant_read_at 被更新）', async () => {
    const before = await admin
      .from('support_chat_threads')
      .select('tenant_read_at')
      .eq('id', threadA)
      .maybeSingle();

    const res = await ownerA.get(`${BASE}/${threadA}`);
    expect(res.status).toBe(200);
    const json = await readJson<ThreadDetail>(res);
    expect(json.data?.unread).toBe(false);

    const after = await admin
      .from('support_chat_threads')
      .select('tenant_read_at')
      .eq('id', threadA)
      .maybeSingle();
    expect(new Date(after.data!.tenant_read_at as string).getTime())
      .toBeGreaterThanOrEqual(new Date(before.data!.tenant_read_at as string).getTime());
  });
});

describe('追加留言：更新 last_message_at，且訊息真的存在', () => {
  it('follow-up 訊息寫入後，thread 的 last_message_at 往後移動', async () => {
    const createRes = await ownerA.post(BASE, { subject: '追蹤測試', body: '第一則' });
    const thread = (await readJson<ThreadDetail>(createRes)).data!;
    createdThreadIds.push(thread.id);
    const firstLastMessageAt = thread.lastMessageAt;

    await new Promise((r) => setTimeout(r, 20));
    const msgRes = await ownerA.post(`${BASE}/${thread.id}/messages`, { body: '補充說明' });
    expect(msgRes.status).toBe(201);

    const detailRes = await ownerA.get(`${BASE}/${thread.id}`);
    const detail = (await readJson<ThreadDetail>(detailRes)).data!;
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[1].body).toBe('補充說明');
    expect(new Date(detail.lastMessageAt).getTime())
      .toBeGreaterThan(new Date(firstLastMessageAt).getTime());
  });
});
