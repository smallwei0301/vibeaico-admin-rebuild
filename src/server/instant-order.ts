/**
 * src/server/instant-order.ts — INSTANT 自選時間下單的 RPC wrapper（issue #46 slice 1）
 * -----------------------------------------------------------------------------
 * 呼叫 `public.create_instant_tour_order`（0138）。所有判定（起始時刻清單、提前量、可售天數、
 * 時區 gap/fold、導遊占用、建團、報價比對、保留期限、冪等）都在那一支 RPC 的同一交易內完成，
 * 本檔只做兩件事：
 *   1. 組參數、呼叫 RPC；
 *   2. 把 RPC 的 SQLSTATE／message 對映成穩定的結果（HTTP 狀態與 ERR 碼），供後續公開 route 使用。
 *
 * 公開 route 與頁面不在本 slice：本檔刻意不做 zod 解析、shopCode 解析或 rate limit。
 *
 * ## 錯誤對映（RPC → HTTP）
 *   P0022 SLOT_TAKEN             → 409 TOUR_005
 *   P0020 STAFF_OCCUPIED         → 409 TOUR_006
 *   P0004 PRICE_CHANGED          → 409 TOUR_003（帶現價 quote）
 *   P0001 SEATS_UNAVAILABLE      → 409 TOUR_001
 *   P0021 INVALID_START          → 400 TOUR_007
 *   P0023/P0024 INSTANT_NOT_*    → 409 TOUR_008
 *   P0025 IDEMPOTENCY_KEY_REUSED → 409 REQ_003
 *   P0003 INVALID_ARGUMENTS／PARTY_SIZE_OUT_OF_RANGE → 400 REQ_001
 *   P0002 PLAN_NOT_FOUND         → 404 REQ_002
 * 其餘錯誤（連線失敗、RPC 不存在＝0138 尚未套用等）原樣拋出，fail closed，不退回任何非原子路徑。
 *
 * 注意：P0004 在 PL/pgSQL 是 assert_failure，不會被 `exception when others` 攔下；
 * 這是 0137 既有行為，本檔以 SQLSTATE 與 message 雙重比對。
 */
import { ERR } from '@/server/http';
import type { createAdminSupabase } from '@/server/supabase';

export type InstantOrderErrorKind =
  | 'SLOT_TAKEN'
  | 'STAFF_OCCUPIED'
  | 'PRICE_CHANGED'
  | 'SEATS_UNAVAILABLE'
  | 'INVALID_START'
  | 'INSTANT_NOT_AVAILABLE'
  | 'INSTANT_NOT_CONFIGURED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'INVALID_ARGUMENTS'
  | 'PLAN_NOT_FOUND';

export type InstantOrderFailure = {
  ok: false;
  kind: InstantOrderErrorKind;
  status: 400 | 404 | 409;
  code: string;
  message: string;
  /** PRICE_CHANGED 時的現價（RPC detail）。 */
  quote?: { unitPrice: number; total: number };
  /** 原因細節（RPC detail），見 mapInstantOrderError。 */
  reason?: string;
};

export type InstantOrderSuccess = {
  ok: true;
  orderId: string;
  departureId: string;
  holdExpiresAt: string | null;
  totalAmount?: number;
  startsAt?: string;
  endsAt?: string;
  /** 訂單狀態（新建為 PENDING；冪等重送時為原單當下狀態）。 */
  status?: string;
  /** true＝同一 idempotency key 重送，回的是原單。 */
  deduped: boolean;
};

export type InstantOrderResult = InstantOrderSuccess | InstantOrderFailure;

export type CreateInstantOrderInput = {
  tenantId: string;
  planId: string;
  /** UTC ISO instant。 */
  startsAt: string;
  partySize: number;
  customerId: string | null;
  contact: Record<string, unknown>;
  note: string;
  idempotencyKey: string;
  expectedTotal: number;
  orderNo: string;
  source: 'MIDAO' | 'VIBEAI_SHOP' | 'LINE' | 'MANUAL';
  paymentMethodId?: string | null;
};

type RpcError = { code?: string; message?: string; details?: string | null } | null | undefined;

const BY_CODE: Record<string, { kind: InstantOrderErrorKind; status: 400 | 404 | 409; code: string; message: string }> = {
  P0022: { kind: 'SLOT_TAKEN', status: 409, code: ERR.SLOT_TAKEN, message: '這個時段剛被預訂了，請選擇其他時間' },
  P0020: { kind: 'STAFF_OCCUPIED', status: 409, code: ERR.STAFF_OCCUPIED, message: '這個時段導遊無法接案，請選擇其他時間' },
  P0004: { kind: 'PRICE_CHANGED', status: 409, code: ERR.PRICE_CHANGED, message: '金額已更新，請重新確認' },
  P0001: { kind: 'SEATS_UNAVAILABLE', status: 409, code: ERR.SEATS_UNAVAILABLE, message: '名額不足' },
  P0021: { kind: 'INVALID_START', status: 400, code: ERR.INVALID_START, message: '這個出發時間無法預訂，請重新選擇' },
  P0023: { kind: 'INSTANT_NOT_AVAILABLE', status: 409, code: ERR.INSTANT_UNAVAILABLE, message: '此方案目前無法即時預訂' },
  P0024: { kind: 'INSTANT_NOT_CONFIGURED', status: 409, code: ERR.INSTANT_UNAVAILABLE, message: '此方案目前無法即時預訂' },
  P0025: { kind: 'IDEMPOTENCY_KEY_REUSED', status: 409, code: ERR.CONFLICT, message: '這筆預訂請求已用於不同內容，請重新送出' },
  P0003: { kind: 'INVALID_ARGUMENTS', status: 400, code: ERR.VALIDATION, message: '預訂資料不正確' },
  P0002: { kind: 'PLAN_NOT_FOUND', status: 404, code: ERR.NOT_FOUND, message: '找不到此方案' },
};

const BY_MESSAGE: Array<[string, string]> = [
  ['SLOT_TAKEN', 'P0022'],
  ['STAFF_OCCUPIED', 'P0020'],
  ['PRICE_CHANGED', 'P0004'],
  ['SEATS_UNAVAILABLE', 'P0001'],
  ['INVALID_START', 'P0021'],
  ['INSTANT_NOT_AVAILABLE', 'P0023'],
  ['INSTANT_NOT_CONFIGURED', 'P0024'],
  ['IDEMPOTENCY_KEY_REUSED', 'P0025'],
  ['INVALID_ARGUMENTS', 'P0003'],
  ['PARTY_SIZE_OUT_OF_RANGE', 'P0003'],
  ['PLAN_NOT_FOUND', 'P0002'],
];

function parseQuote(details: string | null | undefined): { unitPrice: number; total: number } | undefined {
  if (!details) return undefined;
  try {
    const d = JSON.parse(details) as { unitPrice?: unknown; total?: unknown };
    const unitPrice = Number(d.unitPrice);
    const total = Number(d.total);
    if (d.unitPrice == null || d.total == null || !Number.isFinite(unitPrice) || !Number.isFinite(total)) return undefined;
    return { unitPrice, total };
  } catch {
    return undefined;
  }
}

/**
 * RPC 錯誤 → 結果。無法辨識者回 null，呼叫端應原樣拋出（fail closed）。
 * SQLSTATE 與 message 都比對：message 優先決定種類，避免 P0001／P0003／P0002 這類
 * 多義 SQLSTATE（0087 另有 DEPARTURE_NOT_FOUND 同為 P0002）被誤分類。
 */
export function mapInstantOrderError(error: RpcError): InstantOrderFailure | null {
  if (!error) return null;
  const message = String(error.message ?? '');
  let sqlstate = error.code && BY_CODE[error.code] ? error.code : undefined;
  const byMessage = BY_MESSAGE.find(([name]) => message.includes(name));
  if (byMessage) sqlstate = byMessage[1];
  if (!sqlstate) return null;
  // P0002 只有 PLAN_NOT_FOUND 明確是方案不存在；其他 P0002（如 DEPARTURE_NOT_FOUND）不屬 INSTANT 的對映範圍。
  if (sqlstate === 'P0002' && !message.includes('PLAN_NOT_FOUND')) return null;
  if (sqlstate === 'P0001' && !message.includes('SEATS_UNAVAILABLE')) return null;
  if (sqlstate === 'P0003' && !byMessage) return null;
  const base = BY_CODE[sqlstate];
  const failure: InstantOrderFailure = { ok: false, ...base };
  if (base.kind === 'PRICE_CHANGED') failure.quote = parseQuote(error.details);
  // INVALID_START：WALL_CLOCK／NOT_IN_START_TIMES／LEAD_TIME／BEYOND_WINDOW；
  // IDEMPOTENCY_KEY_REUSED：REQUEST_MISMATCH／ORDER_CANCELLED（原單已取消或逾期，須換新 key 重新下單）；
  // INSTANT_NOT_CONFIGURED：LEAD_LT_HOLD 等。
  if ((base.kind === 'INVALID_START' || base.kind === 'IDEMPOTENCY_KEY_REUSED' || base.kind === 'INSTANT_NOT_CONFIGURED') && error.details) {
    failure.reason = String(error.details);
  }
  return failure;
}

function parseSuccess(data: unknown): InstantOrderSuccess {
  const row = (data ?? {}) as Record<string, unknown>;
  if (typeof row.orderId !== 'string' || typeof row.departureId !== 'string') {
    throw new Error('INSTANT_ORDER_RPC_BAD_RESPONSE');
  }
  return {
    ok: true,
    orderId: row.orderId,
    departureId: row.departureId,
    holdExpiresAt: typeof row.holdExpiresAt === 'string' ? row.holdExpiresAt : null,
    totalAmount: row.totalAmount == null ? undefined : Number(row.totalAmount),
    startsAt: typeof row.startsAt === 'string' ? row.startsAt : undefined,
    endsAt: typeof row.endsAt === 'string' ? row.endsAt : undefined,
    status: typeof row.status === 'string' ? row.status : undefined,
    deduped: row.deduped === true,
  };
}

/** 建立 INSTANT 訂單。已知業務衝突回 `{ok:false}`；未知錯誤原樣拋出。 */
export async function createInstantTourOrder(
  admin: ReturnType<typeof createAdminSupabase>,
  input: CreateInstantOrderInput,
): Promise<InstantOrderResult> {
  const { data, error } = await admin.rpc('create_instant_tour_order', {
    p_tenant: input.tenantId,
    p_plan: input.planId,
    p_starts_at: input.startsAt,
    p_party_size: input.partySize,
    p_customer: input.customerId,
    p_contact: input.contact,
    p_note: input.note,
    p_idempotency_key: input.idempotencyKey,
    p_expected_total: input.expectedTotal,
    p_order_no: input.orderNo,
    p_source: input.source,
    p_payment_method: input.paymentMethodId ?? null,
  });
  if (error) {
    const mapped = mapInstantOrderError(error);
    if (mapped) return mapped;
    throw error;
  }
  return parseSuccess(data);
}
