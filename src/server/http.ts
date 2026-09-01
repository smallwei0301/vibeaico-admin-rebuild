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

export function fail<T>(status: number, message: string, code?: string, data?: T) {
  return NextResponse.json({ success: false, message, code, data }, { status });
}

/** route handler 最外層包這個：zod 錯誤→400、ApiHttpError→對應狀態、其他→500 */
export class ApiHttpError<T = unknown> extends Error {
  constructor(public status: number, message: string, public code?: string, public data?: T) {
    super(message);
  }
}

export function handle(fn: (req: Request, ctx: any) => Promise<Response>) {
  return async (req: Request, ctx: any) => {
    try {
      return await fn(req, ctx);
    } catch (e: any) {
      if (e instanceof ApiHttpError) return fail(e.status, e.message, e.code, e.data);
      if (e?.name === 'ZodError')
        return fail(400, e.issues?.[0]?.message ?? '輸入格式錯誤', ERR.VALIDATION);
      console.error('[api]', req.method, new URL(req.url).pathname, e);
      return fail(500, '系統發生錯誤，請稍後再試', ERR.INTERNAL);
    }
  };
}
