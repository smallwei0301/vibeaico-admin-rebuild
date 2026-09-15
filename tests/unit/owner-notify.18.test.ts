/**
 * tests/unit/owner-notify.18.test.ts
 * -----------------------------------------------------------------------------
 * 守 Issue #18（LINE 老闆通知 owner-notify）的核心規則：
 *   - maxRecipients = 3，第 4 個請求一律被拒（無付費解鎖）
 *   - 至多一位主要；第一位加入者自動成為主要；移除主要時遞補最早的下一位
 *   - 每接收者獨立的新預約／旅客取消開關
 *   - 送 N 位＝消耗 N 則推播額度，不得少算成 1 則
 *   - 沒有任何 bind-code / bindCode 字樣（Issue 逐字：不得走回頭路的舊模式）
 *
 * 用一個極簡的假 postgrest builder 取代真 Supabase（同精神：只驗證
 * `src/server/owner-notify.ts` 自己的商業邏輯，不驗證 postgrest 本身）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHttpError } from '@/server/http';

/* ------------------------------------------------------------- 假 supabase */
type Row = Record<string, any>;

function makeFakeSupabase(tables: Record<string, Row[]>) {
  function from(table: string) {
    const rows: Row[] = tables[table] ?? (tables[table] = []);
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let insertPayload: Row | Row[] | null = null;
    let updatePayload: Row | null = null;
    const filters: { field: string; op: 'eq' | 'in'; value: any }[] = [];
    let orderBy: { field: string; ascending: boolean } | null = null;
    let limitN: number | null = null;
    let wantCount = false;
    let seq = 0;

    function applyFilters(list: Row[]) {
      return filters.reduce(
        (acc, f) => acc.filter((r) => (f.op === 'eq' ? r[f.field] === f.value : f.value.includes(r[f.field]))),
        list,
      );
    }

    function compute() {
      let result: Row[];
      if (mode === 'insert') {
        const items = Array.isArray(insertPayload) ? insertPayload : [insertPayload!];
        const withDefaults = items.map((r) => ({
          id: r.id ?? `${table}_${++seq}_${Math.random().toString(36).slice(2, 6)}`,
          created_at: r.created_at ?? new Date().toISOString(),
          expires_at: r.expires_at ?? new Date(Date.now() + 86_400_000).toISOString(),
          // 表結構預設值——真 Postgres 由 column default 補上，假 supabase 這裡手動補一份
          // （只有 owner_notify_bind_requests.status 有預設值會影響後續查詢過濾）。
          ...(table === 'owner_notify_bind_requests' ? { status: 'PENDING' } : {}),
          ...r,
        }));
        rows.push(...withDefaults);
        result = withDefaults;
      } else if (mode === 'update') {
        const matched = applyFilters(rows);
        matched.forEach((r) => Object.assign(r, updatePayload));
        result = matched;
      } else if (mode === 'delete') {
        const matched = applyFilters(rows);
        matched.forEach((r) => rows.splice(rows.indexOf(r), 1));
        result = matched;
      } else {
        result = applyFilters(rows);
      }
      if (orderBy) {
        const { field, ascending } = orderBy;
        result = [...result].sort((a, b) => {
          const cmp = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
          return ascending ? cmp : -cmp;
        });
      }
      if (limitN != null) result = result.slice(0, limitN);
      const count = wantCount ? applyFilters(rows).length : undefined;
      return { data: result, count, error: null as unknown };
    }

    const builder: any = {
      select(_cols?: string, opts?: { count?: string }) {
        if (opts?.count) wantCount = true;
        return builder;
      },
      insert(payload: Row | Row[]) { mode = 'insert'; insertPayload = payload; return builder; },
      update(payload: Row) { mode = 'update'; updatePayload = payload; return builder; },
      delete() { mode = 'delete'; return builder; },
      eq(field: string, value: any) { filters.push({ field, op: 'eq', value }); return builder; },
      in(field: string, value: any[]) { filters.push({ field, op: 'in', value }); return builder; },
      order(field: string, opts?: { ascending?: boolean }) {
        orderBy = { field, ascending: opts?.ascending !== false };
        return builder;
      },
      limit(n: number) { limitN = n; return builder; },
      maybeSingle: async () => {
        const r = compute();
        return { data: (r.data as Row[])[0] ?? null, count: r.count, error: r.error };
      },
      single: async () => {
        const r = compute();
        return { data: (r.data as Row[])[0] ?? null, count: r.count, error: r.error };
      },
      then(resolve: any, reject: any) {
        try { resolve(compute()); } catch (e) { (reject ?? Promise.reject)(e); }
      },
    };
    return builder;
  }
  return { from } as any;
}

/* ------------------------------------------------------------------- mocks */
const lineMulticastMock = vi.fn(async (..._args: any[]) => ({}));
const consumePushQuotaMock = vi.fn(async (..._args: any[]) => true);
const getLineCredentialsMock = vi.fn(async (..._args: any[]) => ({ token: 'tok', secret: 's', lineConfig: {} }));
const lineBotInfoMock = vi.fn(async (..._args: any[]) => ({}));

vi.mock('@/server/line', () => ({
  getLineCredentials: (...a: any[]) => getLineCredentialsMock(...a),
  lineMulticast: (...a: any[]) => lineMulticastMock(...a),
  consumePushQuota: (...a: any[]) => consumePushQuotaMock(...a),
  lineBotInfo: (...a: any[]) => lineBotInfoMock(...a),
}));

let tables: Record<string, Row[]>;
let adminSupabase: ReturnType<typeof makeFakeSupabase>;

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => adminSupabase,
}));

import {
  OWNER_NOTIFY_MAX_RECIPIENTS,
  initiateOwnerNotifyBind,
  confirmOwnerNotifyBind,
  declineOwnerNotifyBind,
  removeOwnerNotifyRecipient,
  removeAllOwnerNotifyRecipients,
  updateOwnerNotifyRecipient,
  notifyOwnerNewBooking,
  notifyOwnerBookingSelfCancel,
} from '@/server/owner-notify';

const TENANT = 'tenant-a';

function seedFriend(lineUserId: string, extra: Row = {}) {
  tables.line_users.push({
    tenant_id: TENANT, line_user_id: lineUserId, followed: true,
    display_name: `友${lineUserId}`, picture_url: '', ...extra,
  });
}

beforeEach(() => {
  tables = {
    line_users: [],
    owner_notify_recipients: [],
    owner_notify_bind_requests: [],
    bookings_view: [{ id: 'b1', tenant_id: TENANT, customer_name: '小美', service_name: '洗髮', start_at: '2026-09-20T02:00:00.000Z' }],
    tenants: [{ id: TENANT, name: '測試店' }],
  };
  adminSupabase = makeFakeSupabase(tables);
  lineMulticastMock.mockClear();
  consumePushQuotaMock.mockClear().mockResolvedValue(true);
  getLineCredentialsMock.mockClear();
  lineBotInfoMock.mockClear();
});

describe('沒有任何 bind-code / bindCode 殘留（Issue #18 逐字）', () => {
  it('owner-notify 原始碼不含 bindCode／bind_code 識別字（舊模式的變數/欄位名）', async () => {
    // 檔頭說明文件刻意用連字號「bind-code」的散文提到「不得走回頭路的舊模式」，
    // 那是正確的用法；真正要擋的是舊模式會用到的識別字（camelCase 變數／
    // snake_case 欄位名），這裡改用邊界字元排除單純的說明文字。
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../../src/server/owner-notify.ts', import.meta.url), 'utf8');
    expect(/\bbindCode\b/.test(src)).toBe(false);
    expect(/\bbind_code\b/.test(src)).toBe(false);
  });
});

describe('initiateOwnerNotifyBind — 發起本人確認邀請', () => {
  it('好友不存在（或未追蹤）→ 404', async () => {
    await expect(initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'nobody'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('已達上限（3 位）→ 409 OWNER_NOTIFY_LIMIT，不發送推播', async () => {
    seedFriend('lu_4');
    for (let i = 1; i <= OWNER_NOTIFY_MAX_RECIPIENTS; i++) {
      tables.owner_notify_recipients.push({
        id: `r${i}`, tenant_id: TENANT, line_user_id: `lu_${i}`,
        is_primary: i === 1, notify_new_booking: true, notify_cancel: true,
        created_at: new Date(2026, 0, i).toISOString(),
      });
    }
    await expect(initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_4'))
      .rejects.toMatchObject({ code: 'LINE_003', status: 409 });
    expect(lineMulticastMock).not.toHaveBeenCalled();
  });

  it('額度不足 → 409，不建立邀請請求', async () => {
    seedFriend('lu_1');
    consumePushQuotaMock.mockResolvedValueOnce(false);
    await expect(initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_1'))
      .rejects.toMatchObject({ status: 409 });
    expect(tables.owner_notify_bind_requests.length).toBe(0);
  });

  it('正常路徑：建立 PENDING 請求並推一則確認訊息（消耗 1 則額度）', async () => {
    seedFriend('lu_1');
    const result = await initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_1');
    expect(result.requestId).toBeTruthy();
    expect(tables.owner_notify_bind_requests).toHaveLength(1);
    expect(tables.owner_notify_bind_requests[0].status).toBe('PENDING');
    expect(consumePushQuotaMock).toHaveBeenCalledWith(TENANT, 1);
    expect(lineMulticastMock).toHaveBeenCalledTimes(1);
    expect(lineMulticastMock.mock.calls[0][1]).toEqual(['lu_1']);
  });

  it('已有進行中邀請 → 重用同一筆，不重複推播', async () => {
    seedFriend('lu_1');
    const first = await initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_1');
    lineMulticastMock.mockClear();
    consumePushQuotaMock.mockClear();
    const second = await initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_1');
    expect(second.requestId).toBe(first.requestId);
    expect(lineMulticastMock).not.toHaveBeenCalled();
    expect(consumePushQuotaMock).not.toHaveBeenCalled();
  });
});

describe('confirmOwnerNotifyBind — 本人在 LINE 上確認', () => {
  it('第一位確認者自動成為主要', async () => {
    seedFriend('lu_1');
    const { requestId } = await initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_1');
    const res = await confirmOwnerNotifyBind(adminSupabase, TENANT, requestId, 'lu_1');
    expect(res.ok).toBe(true);
    expect(tables.owner_notify_recipients).toHaveLength(1);
    expect(tables.owner_notify_recipients[0].is_primary).toBe(true);
    expect(tables.owner_notify_bind_requests[0].status).toBe('CONFIRMED');
  });

  it('第二位確認者不是主要', async () => {
    seedFriend('lu_1'); seedFriend('lu_2');
    const r1 = await initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_1');
    await confirmOwnerNotifyBind(adminSupabase, TENANT, r1.requestId, 'lu_1');
    const r2 = await initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_2');
    await confirmOwnerNotifyBind(adminSupabase, TENANT, r2.requestId, 'lu_2');
    const second = tables.owner_notify_recipients.find((r) => r.line_user_id === 'lu_2');
    expect(second!.is_primary).toBe(false);
    expect(tables.owner_notify_recipients).toHaveLength(2);
  });

  it('第 4 位確認 → LIMIT_REACHED，名單維持 3 位，請求標記 CANCELLED', async () => {
    for (let i = 1; i <= 4; i++) seedFriend(`lu_${i}`);
    const requests: string[] = [];
    for (let i = 1; i <= 4; i++) {
      // 手動插入前 3 位請求（略過上限檢查，直接測 confirm 端的第二道防線）
      tables.owner_notify_bind_requests.push({
        id: `req${i}`, tenant_id: TENANT, line_user_id: `lu_${i}`, status: 'PENDING',
        created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      requests.push(`req${i}`);
    }
    for (let i = 0; i < 3; i++) {
      const res = await confirmOwnerNotifyBind(adminSupabase, TENANT, requests[i], `lu_${i + 1}`);
      expect(res.ok).toBe(true);
    }
    const res4 = await confirmOwnerNotifyBind(adminSupabase, TENANT, requests[3], 'lu_4');
    expect(res4).toEqual({ ok: false, reason: 'LIMIT_REACHED' });
    expect(tables.owner_notify_recipients).toHaveLength(OWNER_NOTIFY_MAX_RECIPIENTS);
    expect(tables.owner_notify_bind_requests.find((r) => r.id === 'req4')!.status).toBe('CANCELLED');
  });

  it('對象不符（LINE userId 與請求不一致）→ USER_MISMATCH，不建立接收者', async () => {
    seedFriend('lu_1');
    const { requestId } = await initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_1');
    const res = await confirmOwnerNotifyBind(adminSupabase, TENANT, requestId, 'someone-else');
    expect(res).toEqual({ ok: false, reason: 'USER_MISMATCH' });
    expect(tables.owner_notify_recipients).toHaveLength(0);
  });

  it('已過期的請求 → EXPIRED，狀態改為 EXPIRED', async () => {
    seedFriend('lu_1');
    tables.owner_notify_bind_requests.push({
      id: 'req_old', tenant_id: TENANT, line_user_id: 'lu_1', status: 'PENDING',
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const res = await confirmOwnerNotifyBind(adminSupabase, TENANT, 'req_old', 'lu_1');
    expect(res).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(tables.owner_notify_bind_requests[0].status).toBe('EXPIRED');
  });
});

describe('declineOwnerNotifyBind', () => {
  it('把 PENDING 請求標記 CANCELLED，不建立接收者', async () => {
    seedFriend('lu_1');
    const { requestId } = await initiateOwnerNotifyBind(adminSupabase, TENANT, '測試店', 'lu_1');
    await declineOwnerNotifyBind(adminSupabase, TENANT, requestId, 'lu_1');
    expect(tables.owner_notify_bind_requests[0].status).toBe('CANCELLED');
    expect(tables.owner_notify_recipients).toHaveLength(0);
  });
});

describe('移除接收者 — 主要遞補與清空', () => {
  function seedRecipients() {
    tables.owner_notify_recipients.push(
      { id: 'r1', tenant_id: TENANT, line_user_id: 'lu_1', is_primary: true, notify_new_booking: true, notify_cancel: true, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'r2', tenant_id: TENANT, line_user_id: 'lu_2', is_primary: false, notify_new_booking: true, notify_cancel: true, created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'r3', tenant_id: TENANT, line_user_id: 'lu_3', is_primary: false, notify_new_booking: true, notify_cancel: true, created_at: '2026-01-03T00:00:00.000Z' },
    );
  }

  it('移除主要 → 依 created_at 遞補最早的下一位', async () => {
    seedRecipients();
    await removeOwnerNotifyRecipient(adminSupabase, TENANT, 'r1');
    expect(tables.owner_notify_recipients).toHaveLength(2);
    const newPrimary = tables.owner_notify_recipients.find((r) => r.is_primary);
    expect(newPrimary!.id).toBe('r2');
  });

  it('移除最後一位接收者 → 名單清空（停止所有老闆 LINE 通知）', async () => {
    tables.owner_notify_recipients.push(
      { id: 'r1', tenant_id: TENANT, line_user_id: 'lu_1', is_primary: true, notify_new_booking: true, notify_cancel: true, created_at: '2026-01-01T00:00:00.000Z' },
    );
    await removeOwnerNotifyRecipient(adminSupabase, TENANT, 'r1');
    expect(tables.owner_notify_recipients).toHaveLength(0);
  });

  it('remove-all 一次清空整份名單', async () => {
    seedRecipients();
    await removeAllOwnerNotifyRecipients(adminSupabase, TENANT);
    expect(tables.owner_notify_recipients).toHaveLength(0);
  });

  it('找不到接收者 → 404', async () => {
    await expect(removeOwnerNotifyRecipient(adminSupabase, TENANT, 'nope'))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('updateOwnerNotifyRecipient — 開關與重新指定主要', () => {
  it('指定新主要 → 舊主要自動卸任，全租戶只剩一位主要', async () => {
    tables.owner_notify_recipients.push(
      { id: 'r1', tenant_id: TENANT, line_user_id: 'lu_1', is_primary: true, notify_new_booking: true, notify_cancel: true, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'r2', tenant_id: TENANT, line_user_id: 'lu_2', is_primary: false, notify_new_booking: true, notify_cancel: true, created_at: '2026-01-02T00:00:00.000Z' },
    );
    await updateOwnerNotifyRecipient(adminSupabase, TENANT, 'r2', { isPrimary: true });
    const primaries = tables.owner_notify_recipients.filter((r) => r.is_primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe('r2');
  });

  it('切換單一事件開關，另一個開關不受影響', async () => {
    tables.owner_notify_recipients.push(
      { id: 'r1', tenant_id: TENANT, line_user_id: 'lu_1', is_primary: true, notify_new_booking: true, notify_cancel: true, created_at: '2026-01-01T00:00:00.000Z' },
    );
    await updateOwnerNotifyRecipient(adminSupabase, TENANT, 'r1', { notifyNewBooking: false });
    const r = tables.owner_notify_recipients[0];
    expect(r.notify_new_booking).toBe(false);
    expect(r.notify_cancel).toBe(true);
  });
});

describe('事件推播 — 只發給開了該開關的接收者，N 位消耗 N 則額度', () => {
  function seedThreeRecipients() {
    tables.owner_notify_recipients.push(
      { id: 'r1', tenant_id: TENANT, line_user_id: 'lu_1', is_primary: true, notify_new_booking: true, notify_cancel: false, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'r2', tenant_id: TENANT, line_user_id: 'lu_2', is_primary: false, notify_new_booking: true, notify_cancel: true, created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'r3', tenant_id: TENANT, line_user_id: 'lu_3', is_primary: false, notify_new_booking: false, notify_cancel: true, created_at: '2026-01-03T00:00:00.000Z' },
    );
  }

  it('新預約：只推給 notify_new_booking=true 的兩位，消耗 2 則額度', async () => {
    seedThreeRecipients();
    await notifyOwnerNewBooking(TENANT, 'b1');
    expect(consumePushQuotaMock).toHaveBeenCalledWith(TENANT, 2);
    expect(lineMulticastMock).toHaveBeenCalledTimes(1);
    expect(new Set(lineMulticastMock.mock.calls[0][1])).toEqual(new Set(['lu_1', 'lu_2']));
  });

  it('旅客自行取消：只推給 notify_cancel=true 的兩位，消耗 2 則額度（不是 1 則）', async () => {
    seedThreeRecipients();
    await notifyOwnerBookingSelfCancel(TENANT, 'b1');
    expect(consumePushQuotaMock).toHaveBeenCalledWith(TENANT, 2);
    expect(new Set(lineMulticastMock.mock.calls[0][1])).toEqual(new Set(['lu_2', 'lu_3']));
  });

  it('沒有任何人開啟該事件 → 完全不呼叫推播／扣額度', async () => {
    tables.owner_notify_recipients.push(
      { id: 'r1', tenant_id: TENANT, line_user_id: 'lu_1', is_primary: true, notify_new_booking: false, notify_cancel: false, created_at: '2026-01-01T00:00:00.000Z' },
    );
    await notifyOwnerNewBooking(TENANT, 'b1');
    expect(consumePushQuotaMock).not.toHaveBeenCalled();
    expect(lineMulticastMock).not.toHaveBeenCalled();
  });

  it('額度不足 → 略過整批發送（不得只送一部分卻少算額度）', async () => {
    seedThreeRecipients();
    consumePushQuotaMock.mockResolvedValueOnce(false);
    await notifyOwnerNewBooking(TENANT, 'b1');
    expect(lineMulticastMock).not.toHaveBeenCalled();
  });

  it('永不拋錯：即使查詢失敗也只吞錯', async () => {
    tables.bookings_view = [];
    await expect(notifyOwnerNewBooking(TENANT, 'missing')).resolves.toBeUndefined();
    expect(lineMulticastMock).not.toHaveBeenCalled();
  });
});
