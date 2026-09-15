/**
 * 客服對話串（issue #25 B 段）——規則本身正確，而且元件／端點真的接上去了
 * -----------------------------------------------------------------------------
 * 規格：`docs/decisions/2026-09-11-support-chat-human-escalation.md`。
 *
 * 這裡不打真 DB（那是 tests/integration 的工作），守的是不需要資料庫也能驗證
 * 的三件事：
 *   1. 每一支新路由都經過 `requireTenant()`、都用 `t.supabase`（不繞過 RLS）。
 *   2. 三張表／`src/server/support-chat-threads.ts` 的每一段查詢述句都收窄到
 *      tenantId——`tests/unit/impersonation-tenant-scope-lock.test.ts` 已經把
 *      這三支新檔案納入它的全庫掃描，這裡另外鎖一份針對本功能的正向對照，
 *      避免日後那支通用鎖被改鬆時沒有第二層測試會叫。
 *   3. 通知失敗／信箱未設定不得讓 thread 建立失敗，且 UI 文案要如實對應
 *      `SupportChatNotifyStatus` 四種值，不得新增「處理中／已回覆／已解決」。
 *   4. widget 走 service，不自己 fetch；「轉人工」按鈕真的存在。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { common } from '@/i18n/zh-TW/common';

const widget = readFileSync('src/components/layout/SupportChatWidget.tsx', 'utf8');
const service = readFileSync('src/services/support-chat-threads.ts', 'utf8');
const server = readFileSync('src/server/support-chat-threads.ts', 'utf8');
const routeList = readFileSync('src/app/api/support-chat/threads/route.ts', 'utf8');
const routeDetail = readFileSync('src/app/api/support-chat/threads/[threadId]/route.ts', 'utf8');
const routeMessages = readFileSync(
  'src/app/api/support-chat/threads/[threadId]/messages/route.ts', 'utf8',
);
const migration = readFileSync(
  'supabase/migrations/0116_issue_25b_support_chat_threads.sql', 'utf8',
);

describe('三支新端點都經過 requireTenant()，且不使用 service role', () => {
  for (const [name, src] of [
    ['GET/POST /api/support-chat/threads', routeList],
    ['GET /api/support-chat/threads/:threadId', routeDetail],
    ['POST /api/support-chat/threads/:threadId/messages', routeMessages],
  ] as const) {
    it(`${name} 走 requireTenant()`, () => {
      expect(src).toContain('requireTenant(');
    });
    it(`${name} 不使用 createAdminSupabase（RLS 是唯一防線）`, () => {
      expect(src).not.toContain('createAdminSupabase');
      expect(src).toContain('t.supabase');
    });
  }
});

describe('src/server/support-chat-threads.ts 每一段查詢述句都收窄到 tenantId', () => {
  it('每一個 .from( 呼叫所在的述句都能找到 tenant_id／tenantId', () => {
    const stripped = server
      .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
      .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
    const re = /\.from\(\s*['"]([A-Za-z_0-9]+)['"]\s*\)/g;
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = re.exec(stripped))) {
      count += 1;
      let depth = 0;
      let end = stripped.length;
      for (let i = match.index; i < stripped.length; i += 1) {
        const c = stripped[i];
        if (c === '(' || c === '[' || c === '{') depth += 1;
        else if (c === ')' || c === ']' || c === '}') depth -= 1;
        else if (c === ';' && depth <= 0) { end = i; break; }
      }
      const statement = stripped.slice(match.index, end);
      expect(statement).toMatch(/tenant_id|tenantId/);
    }
    expect(count).toBeGreaterThanOrEqual(8); // 對照組：確認掃描器真的掃到東西
  });

  it('訊息 insert 的 RLS 政策把 sender_role 鎖死為 TENANT（migration 檔）', () => {
    expect(migration).toContain("sender_role = 'TENANT'");
  });

  it('訊息 insert 的 RLS 政策要求 tenant_id 與其 thread 的 tenant_id 一致', () => {
    expect(migration).toContain('tenant_id = (select t.tenant_id from public.support_chat_threads');
  });

  it('兩張表都啟用 RLS 且政策集合有形狀斷言', () => {
    expect(migration).toContain('support_chat_threads enable row level security');
    expect(migration).toContain('support_chat_messages enable row level security');
    expect(migration).toContain("raise exception 'support_chat_threads 沒有啟用 RLS'");
    expect(migration).toContain("raise exception 'support_chat_messages 沒有啟用 RLS'");
  });
});

describe('通知失敗不得吞掉已成功寫入的 thread', () => {
  it('未設定平台信箱時 notifyPlatform 回 SKIPPED_NO_RECIPIENT，不丟例外', () => {
    expect(server).toContain("'SKIPPED_NO_RECIPIENT'");
    expect(server).toContain('serverEnv.PLATFORM_SUPPORT_NOTIFY_EMAIL');
  });

  it('createThread 的回傳值一定帶 notifyStatus，呼叫端據以顯示誠實文案', () => {
    expect(server).toMatch(/notifyStatus,?\s*\n/);
  });

  it('env.ts 對 PLATFORM_SUPPORT_NOTIFY_EMAIL 沒有任何硬編碼 fallback 信箱', () => {
    const envSrc = readFileSync('src/config/env.ts', 'utf8');
    expect(envSrc).toContain('PLATFORM_SUPPORT_NOTIFY_EMAIL: z.string().email().optional()');
    expect(envSrc).not.toMatch(/PLATFORM_SUPPORT_NOTIFY_EMAIL[\s\S]{0,80}@(gmail|example)\.com/);
  });
});

describe('文案只對應四種可驗證的通知狀態，不假造處理進度', () => {
  const statusKeys = Object.keys(common.supportChatEscalation.notifyStatus).sort();

  it('恰好是 SENT／FAILED／SKIPPED_NO_KEY／SKIPPED_NO_RECIPIENT 四種', () => {
    expect(statusKeys).toEqual(['FAILED', 'SENT', 'SKIPPED_NO_KEY', 'SKIPPED_NO_RECIPIENT']);
  });

  it('不得出現「處理中」「已回覆」「已解決」等系統無法驗證的狀態文案', () => {
    const text = JSON.stringify(common.supportChatEscalation);
    for (const banned of ['處理中', '已回覆', '已解決']) {
      expect(text).not.toContain(banned);
    }
  });

  it('SENT 文案不宣稱平台「已讀」或「已回覆」，只說會查看', () => {
    expect(common.supportChatEscalation.notifyStatus.SENT).not.toContain('已讀');
    expect(common.supportChatEscalation.notifyStatus.SENT).not.toContain('已回覆您');
  });
});

describe('元件真的接上服務層，不是本地 state 假成功', () => {
  it('widget 匯入客服對話串 service，不直接 fetch', () => {
    expect(widget).toContain("from '@/services/support-chat-threads'");
    expect(widget).not.toMatch(/\bfetch\(/);
  });

  it('「轉人工」按鈕存在且會呼叫 createSupportChatThread', () => {
    expect(widget).toContain('escalateButton');
    expect(widget).toContain('await createSupportChatThread');
  });

  it('追加留言走 addSupportChatMessage，不是本地 append', () => {
    expect(widget).toContain('await addSupportChatMessage');
  });

  it('讀取歷史走 listSupportChatThreads／getSupportChatThread', () => {
    expect(widget).toContain('await listSupportChatThreads');
    expect(widget).toContain('await getSupportChatThread');
  });

  it('元件內沒有中文字面量（CONVENTIONS 硬規則）', () => {
    const stripped = widget
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(stripped).not.toMatch(/[一-鿿]/);
  });

  it('service 的 real 分支打 /api/support-chat/threads*，mock 分支不直接回空殼', () => {
    expect(service).toContain("'/api/support-chat/threads'");
    expect(service).toContain('mockThreads.unshift(thread)');
  });
});

describe('文案誠實：不暗示即時真人客服在線', () => {
  const text = JSON.stringify(common.supportChatEscalation);
  it('不出現「線上」「即時客服」「馬上」等暗示即時真人在線的字眼', () => {
    for (const banned of ['線上客服', '即時客服', '客服在線', '馬上為您']) {
      expect(text).not.toContain(banned);
    }
  });
});
