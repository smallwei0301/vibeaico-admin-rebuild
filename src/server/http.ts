import { NextResponse } from 'next/server';

/** 統一錯誤碼。前端只認 message 顯示、code 做分支，新增碼時同步更新 04 分冊表格 */
export const ERR = {
  UNAUTHORIZED: 'AUTH_001',        // 未登入或 session 過期
  BAD_CREDENTIALS: 'AUTH_002',     // 帳號或密碼錯誤
  EMAIL_TAKEN: 'AUTH_003',         // Email 已註冊
  CODE_INVALID: 'AUTH_004',        // 驗證碼錯誤或過期
  FORBIDDEN: 'AUTH_005',           // 已登入但無權限（非該店成員／角色不足）
  SHOPCODE_TAKEN: 'AUTH_006',      // shopCode 已被使用
  VALIDATION: 'REQ_001',           // zod 驗證失敗
  NOT_FOUND: 'REQ_002',            // 資源不存在（或不屬於該租戶）
  CONFLICT: 'REQ_003',             // 狀態衝突（例：時段重疊、重複操作）
  FEATURE_LOCKED: 'FEAT_001',      // 功能未訂閱
  LINE_NOT_CONFIGURED: 'LINE_001', // 尚未設定 LINE channel
  LINE_API_ERROR: 'LINE_002',      // LINE 平台回傳錯誤
  INTERNAL: 'SYS_001',
} as const;

export function ok<T>(data?: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

export function fail(status: number, message: string, code?: string) {
  return NextResponse.json({ success: false, message, code }, { status });
}

/** route handler 最外層包這個：zod 錯誤→400、ApiHttpError→對應狀態、其他→500 */
export class ApiHttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** 會改到資料的 HTTP method；只有這些需要留稽核紀錄。 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 一個丟出來的錯最後會變成哪個狀態碼。與 `handle()` 的 catch 同一套規則。 */
function statusForThrown(e: unknown): number {
  if (e instanceof ApiHttpError) return e.status;
  if ((e as { name?: string } | null)?.name === 'ZodError') return 400;
  return 500;
}

/**
 * 代登入狀態下**自動**留下稽核紀錄。由 `handle()` 對寫入型請求呼叫。
 *
 * ⚠️ 為什麼掛在 `handle()` 裡，而不是給寫入型 route 一個要自己記得換上的包裝：
 * 那等於 160 幾個必須記得的地方，少一個沒寫，那個地方就是稽核的破口——而稽核的
 * 價值恰恰在於「沒有例外」。這個檔案上一版正是那樣寫的（`handleTenantWrite`），
 * 結果**沒有任何一支 route 用它**：函式在、註解在、測試也在，稽核卻一次都沒發生。
 * 名字出現在某處不等於那件事真的會發生（PB-027）。現在唯一的入口就是 `handle()`，
 * 沒有東西需要記得。
 *
 * ⚠️ 順序是刻意的——**先記錄，再執行**：
 *
 *   ① 沒有代登入 cookie → 直接跑 handler，行為與從前完全相同（一般店家零額外成本）
 *   ② 有的話解析代登入狀態；不成立同樣直接跑 handler
 *   ③ 先寫一列 action（`status = 0`，代表「已受理、尚未執行」）
 *      這一步失敗 → 整個請求 503 擋掉，**業務寫入還沒發生**，fail closed
 *   ④ 執行 handler
 *   ⑤ 補上真實狀態碼（失敗只記 log，不影響已完成的業務寫入）
 *
 * 反過來寫（執行完才記）的話，稽核寫入失敗時那筆業務寫入已經發生、收不回來，
 * 而紀錄裡沒有它——正好是稽核最不該有的狀態。
 */
async function withImpersonationAudit(
  req: Request,
  ctx: any,
  fn: (req: Request, ctx: any) => Promise<Response>,
): Promise<Response> {
  // 動態 import：`platform-admin` 會用到 `next/headers`，靜態相依會把它拉進
  // 每一支用了 `handle()` 的 route 的模組圖，包含不需要它的那些。
  const { cookies } = await import('next/headers');
  const {
    IMPERSONATION_COOKIE,
    loadActiveImpersonation,
    recordImpersonatedAction,
    finishImpersonatedAction,
  } = await import('./platform-admin');

  // ① 沒有 cookie 就沒有代登入可言。先看這個，一般流量因此不會多一次 auth 往返。
  if (!(await cookies()).get(IMPERSONATION_COOKIE)?.value) return fn(req, ctx);

  let impersonation = null as Awaited<ReturnType<typeof loadActiveImpersonation>>;
  try {
    const { requireUser } = await import('./tenant');
    const { user } = await requireUser();
    impersonation = await loadActiveImpersonation(user.id);
  } catch (e) {
    /**
     * ⚠️ 這裡曾經是 `catch { impersonation = null; }`——**任何**錯誤都當成「沒有代登入」。
     * 最終風險審查抓到那是 fail-open，而且是可利用的：
     *
     *   handler 內的 `requireTenant()` 會**再解析一次**代登入。所以只要這一層的
     *   查詢瞬時失敗、而 handler 那次成功，這筆寫入就會以代登入身分（service role）
     *   執行完畢，而 `impersonation_actions` 一列都沒有——正好是「代登入期間每次
     *   寫入都有紀錄」這條驗收要擋的情況。
     *
     * 只有「未登入」是合法的吞掉理由（交給 handler 自己的 requireTenant() 回正確
     * 錯誤碼，這一層不搶著回 401）。其餘一律 fail closed：什麼都還沒發生，擋掉最便宜。
     * 這與 `platform-admin.ts` 的「查詢失敗不放行」是同一個立場。
     */
    if (e instanceof ApiHttpError && e.status === 401) {
      impersonation = null;
    } else {
      console.error('[impersonation] failed to resolve session; refusing the write', e);
      return fail(503, '無法確認代入狀態，已中止本次操作', ERR.INTERNAL);
    }
  }

  if (!impersonation) return fn(req, ctx); // ②

  let actionId: string;
  try {
    actionId = await recordImpersonatedAction({
      sessionId: impersonation.sessionId,
      tenantId: impersonation.tenantId,
      method: req.method,
      path: new URL(req.url).pathname,
    });
  } catch (e) {
    console.error('[impersonation] audit pre-insert failed; refusing the write', e);
    return fail(503, '無法寫入代入稽核紀錄，已中止本次操作', ERR.INTERNAL); // ③
  }

  let res: Response;
  try {
    res = await fn(req, ctx); // ④
  } catch (e) {
    // handler 丟錯時 `handle()` 會把它轉成信封。這裡若不補狀態碼，那一列會永遠停在
    // `status = 0`（「已受理、尚未執行」），稽核上看起來像「這次請求消失了」——
    // 但它發生過，只是失敗了。**失敗的嘗試同樣要留得下來**，否則想藏一次操作，
    // 只要讓它丟錯就行。
    //
    // ⚠️ 狀態碼要記**真實的那個**，不能一律 500：route 的 403/404/409 是用
    // `throw new ApiHttpError` 表達、輸入錯誤是 ZodError，全記成 500 會讓租戶看到的
    // 紀錄把「被拒絕的嘗試」和「系統壞了」混成一團。規則與下面 `handle()` 的 catch
    // 一致，改動時兩邊要一起改。
    await finishImpersonatedAction(actionId, statusForThrown(e)); // ⑤
    throw e;
  }
  await finishImpersonatedAction(actionId, res.status); // ⑤
  return res;
}

export function handle(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      // 讀取型請求不改資料，沒有東西要稽核，也不必為它多做任何事。
      if (!WRITE_METHODS.has(req.method)) return await fn(req, ctx);
      return await withImpersonationAudit(req, ctx, fn);
    } catch (e: any) {
      if (e instanceof ApiHttpError) return fail(e.status, e.message, e.code);
      if (e?.name === 'ZodError')
        return fail(400, e.issues?.[0]?.message ?? '輸入格式錯誤', ERR.VALIDATION);
      console.error('[api]', req.method, new URL(req.url).pathname, e);
      return fail(500, '系統發生錯誤，請稍後再試', ERR.INTERNAL);
    }
  };
}
