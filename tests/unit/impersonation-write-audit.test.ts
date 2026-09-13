/**
 * tests/unit/impersonation-write-audit.test.ts
 * -----------------------------------------------------------------------------
 * 規格：`docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md` §2.4、§7 驗收 4
 *
 * 守的那句話：**代登入期間的每一次寫入都有 action 紀錄，而且紀錄在執行之前**。
 * §7 變異 3（拿掉 handle() 裡的記錄）必須讓本檔轉紅。
 *
 * ⚠️ 這一層原本是一個要 route 自己換上的包裝（`handleTenantWrite`），
 * 而**沒有任何一支 route 用它**——函式在、註解在、測試也在，稽核卻一次都沒發生。
 * 現在唯一入口是 `handle()`，本檔連帶守住「讀取型不記、寫入型一定記」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadActiveImpersonationMock = vi.fn();
const recordImpersonatedActionMock = vi.fn();
const finishImpersonatedActionMock = vi.fn();
const requireUserMock = vi.fn();
const impersonationCookieMock = vi.fn<() => string | undefined>();

vi.mock('@/server/platform-admin', () => ({
  IMPERSONATION_COOKIE: 'vibeai_impersonation',
  loadActiveImpersonation: (...a: unknown[]) => loadActiveImpersonationMock(...a),
  recordImpersonatedAction: (...a: unknown[]) => recordImpersonatedActionMock(...a),
  finishImpersonatedAction: (...a: unknown[]) => finishImpersonatedActionMock(...a),
}));

vi.mock('@/server/tenant', () => ({
  requireUser: () => requireUserMock(),
}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        if (name !== 'vibeai_impersonation') return undefined;
        const v = impersonationCookieMock();
        return v === undefined ? undefined : { value: v };
      },
    }),
}));

import { handle, ApiHttpError } from '@/server/http';

const IMPERSONATION = {
  sessionId: 'sess-abc',
  adminUserId: 'admin-1',
  tenantId: 'tenant-9',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};

function req(method = 'POST', url = 'https://app.test/api/services?x=1') {
  return new Request(url, { method });
}

/** 代登入中的完整前置狀態：cookie 有、登入者是那位管理者、session 有效。 */
function impersonating() {
  impersonationCookieMock.mockReturnValue('sess-abc');
  requireUserMock.mockResolvedValue({ user: { id: 'admin-1' } });
  loadActiveImpersonationMock.mockResolvedValue(IMPERSONATION);
}

beforeEach(() => {
  vi.clearAllMocks();
  impersonationCookieMock.mockReturnValue(undefined);
  requireUserMock.mockResolvedValue({ user: { id: 'admin-1' } });
  recordImpersonatedActionMock.mockResolvedValue('act-1');
  finishImpersonatedActionMock.mockResolvedValue(undefined);
  loadActiveImpersonationMock.mockResolvedValue(null);
});

describe('handle() — 代登入期間的寫入稽核', () => {
  it('代登入中：每次寫入都有 action 紀錄，帶正確的 method 與 path（去掉 query）', async () => {
    impersonating();
    const handler = handle(async () => new Response('{}', { status: 200 }));

    const res = await handler(req('PATCH', 'https://app.test/api/services/s_1?draft=1'), {});

    expect(res.status).toBe(200);
    expect(recordImpersonatedActionMock).toHaveBeenCalledTimes(1);
    expect(recordImpersonatedActionMock).toHaveBeenCalledWith({
      sessionId: 'sess-abc',
      tenantId: 'tenant-9',
      method: 'PATCH',
      path: '/api/services/s_1',
    });
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s 一律留紀錄', async (method) => {
    impersonating();
    const handler = handle(async () => new Response('{}', { status: 200 }));
    await handler(req(method), {});
    expect(recordImpersonatedActionMock).toHaveBeenCalledTimes(1);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s 不留紀錄（沒改到資料，也不多打一次 auth）', async (method) => {
    impersonating();
    const handler = handle(async () => new Response('{}', { status: 200 }));
    await handler(req(method), {});
    expect(recordImpersonatedActionMock).not.toHaveBeenCalled();
    expect(requireUserMock).not.toHaveBeenCalled();
  });

  it('紀錄發生在**執行之前**（順序反過來就收不回來）', async () => {
    impersonating();
    const order: string[] = [];
    recordImpersonatedActionMock.mockImplementation(async () => {
      order.push('record');
      return 'act-1';
    });
    const handler = handle(async () => {
      order.push('execute');
      return new Response('{}', { status: 200 });
    });

    await handler(req(), {});

    expect(order).toEqual(['record', 'execute']);
  });

  it('稽核寫不進去 → 503 且**業務 handler 完全沒被呼叫**', async () => {
    impersonating();
    recordImpersonatedActionMock.mockRejectedValue(new Error('audit table down'));
    const inner = vi.fn(async () => new Response('{}', { status: 200 }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await handle(inner)(req(), {});

    expect(res.status).toBe(503);
    expect(inner).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('執行完補上真實狀態碼', async () => {
    impersonating();
    await handle(async () => new Response('{}', { status: 201 }))(req(), {});
    expect(finishImpersonatedActionMock).toHaveBeenCalledWith('act-1', 201);
  });

  it('非 2xx 也要補狀態碼（失敗的嘗試同樣進稽核）', async () => {
    impersonating();
    await handle(async () => new Response('{}', { status: 403 }))(req(), {});
    expect(finishImpersonatedActionMock).toHaveBeenCalledWith('act-1', 403);
  });

  it('沒有 cookie（一般店家自己操作）→ 不記錄，也不多打一次 requireUser', async () => {
    const handler = handle(async () => new Response('{}', { status: 200 }));
    const res = await handler(req(), {});
    expect(res.status).toBe(200);
    expect(requireUserMock).not.toHaveBeenCalled();
    expect(recordImpersonatedActionMock).not.toHaveBeenCalled();
  });

  it('cookie 在但 session 已失效 → 不記錄，照常執行（不提權也不擋）', async () => {
    impersonationCookieMock.mockReturnValue('sess-abc');
    loadActiveImpersonationMock.mockResolvedValue(null);
    const res = await handle(async () => new Response('{}', { status: 200 }))(req(), {});
    expect(res.status).toBe(200);
    expect(recordImpersonatedActionMock).not.toHaveBeenCalled();
  });

  it('未登入（AUTH_001）→ 這一層不搶著回 401，交給 handler 自己判', async () => {
    impersonationCookieMock.mockReturnValue('sess-abc');
    requireUserMock.mockRejectedValue(new ApiHttpError(401, '請先登入', 'AUTH_001'));
    const inner = vi.fn(async () => new Response('{}', { status: 401 }));
    const res = await handle(inner)(req(), {});
    expect(res.status).toBe(401);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(recordImpersonatedActionMock).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ 這一條是最終風險審查抓到的 fail-open。
   *
   * 原本這裡是 `catch { impersonation = null }`，**任何**錯誤都當成「沒有代登入」。
   * 但 handler 內的 `requireTenant()` 會再解析一次代登入——所以只要這一層的查詢
   * 瞬時失敗、handler 那次成功，這筆寫入就會以代登入身分執行完畢而毫無稽核紀錄。
   * 更糟的是，當時的測試用 generic Error 斷言「照常執行」，等於把 fail-open 鎖成規格。
   */
  it('解析代登入時 DB 出錯 → 503 fail closed，**handler 完全沒被呼叫**', async () => {
    impersonationCookieMock.mockReturnValue('sess-abc');
    loadActiveImpersonationMock.mockRejectedValue(new Error('connection reset'));
    const inner = vi.fn(async () => new Response('{}', { status: 200 }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await handle(inner)(req(), {});

    expect(res.status).toBe(503);
    expect(inner).not.toHaveBeenCalled();
    expect(recordImpersonatedActionMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('requireUser 丟出非 401 的錯 → 同樣 fail closed（不是只有 loadActive 那條路）', async () => {
    impersonationCookieMock.mockReturnValue('sess-abc');
    requireUserMock.mockRejectedValue(new Error('supabase unreachable'));
    const inner = vi.fn(async () => new Response('{}', { status: 200 }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await handle(inner)(req(), {});

    expect(res.status).toBe(503);
    expect(inner).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  /**
   * Auth 服務瞬時故障的真實形狀：`requireUser()` 修好之後會丟 503（而不是把它降級成
   * 401「請先登入」）。稽核層必須跟著 fail closed，否則 handler 內第二次解析成功時，
   * 那筆寫入就會以代登入身分完成而毫無紀錄。
   */
  it('requireUser 丟 503（Auth 故障）→ fail closed，handler 沒被呼叫', async () => {
    impersonationCookieMock.mockReturnValue('sess-abc');
    requireUserMock.mockRejectedValue(new ApiHttpError(503, '暫時無法確認登入狀態', 'SYS_001'));
    const inner = vi.fn(async () => new Response('{}', { status: 200 }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await handle(inner)(req(), {});

    expect(res.status).toBe(503);
    expect(inner).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('handler 丟 ApiHttpError → 稽核記真實狀態碼，不是一律 500', async () => {
    impersonating();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handle(async () => {
      throw new ApiHttpError(404, '找不到此方案', 'REQ_002');
    })(req(), {});
    expect(res.status).toBe(404);
    // 全記 500 會讓租戶看到的紀錄把「被拒絕的嘗試」和「系統壞了」混成一團。
    expect(finishImpersonatedActionMock).toHaveBeenCalledWith('act-1', 404);
    spy.mockRestore();
  });

  it('handler 丟 ZodError → 稽核記 400', async () => {
    impersonating();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const zodish = Object.assign(new Error('bad input'), {
      name: 'ZodError',
      issues: [{ message: '請輸入服務名稱' }],
    });
    const res = await handle(async () => {
      throw zodish;
    })(req(), {});
    expect(res.status).toBe(400);
    expect(finishImpersonatedActionMock).toHaveBeenCalledWith('act-1', 400);
    spy.mockRestore();
  });

  it('handler 丟錯時**仍然**補上 500 —— 失敗的嘗試不得從稽核裡消失', async () => {
    impersonating();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await handle(async () => {
      throw new Error('boom');
    })(req(), {});
    // 不補的話那一列會永遠停在 status 0（「已受理、尚未執行」），
    // 等於「想藏一次操作只要讓它丟錯就行」。
    expect(finishImpersonatedActionMock).toHaveBeenCalledWith('act-1', 500);
    spy.mockRestore();
  });

  it('handler 丟錯時仍走既有錯誤轉換（500 信封），不因稽核層而改變', async () => {
    impersonating();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await handle(async () => {
      throw new Error('boom');
    })(req(), {});
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});
