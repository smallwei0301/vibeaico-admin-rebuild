import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rejectTourRequestSchema } from '@/server/tour-domain';
import { mapTourOrder } from '@/server/mappers';
import { travelerVisibleRejectReason } from '@/lib/public-order-format';
import { REJECT_REASON_MAX_LENGTH, TOUR_ORDER_AUTO_EXPIRE_REASON } from '@/lib/tour-reject-reason';
import { TOUR_ORDER_AUTO_EXPIRE_REASON as serverConst } from '@/server/tour-orders';

const row = {
  id: 'o1', order_no: 'T1', trip_id: 't', plan_id: 'p', party_size: 2, status: 'CANCELLED',
  payment_status: 'UNPAID', source: 'VIBEAI_SHOP', created_at: '2026-10-01T00:00:00Z', contact: {},
};
const derived = { tripTitle: '', planName: '', departsOn: '', startTime: '', paymentMethodLabel: '', salesMode: 'REQUEST' as const };
const base = { status: 'CANCELLED', paymentStatus: 'UNPAID', salesMode: 'REQUEST', cancelReason: '該日額滿' };

describe('#944 rejectTourRequestSchema', () => {
  it('reason 可省略、可為空字串、200 字內通過', () => {
    expect(rejectTourRequestSchema.safeParse({}).success).toBe(true);
    expect(rejectTourRequestSchema.safeParse({ reason: '' }).success).toBe(true);
    expect(rejectTourRequestSchema.safeParse({ reason: 'a'.repeat(REJECT_REASON_MAX_LENGTH) }).success).toBe(true);
  });
  it('超過上限拒絕', () => {
    expect(rejectTourRequestSchema.safeParse({ reason: 'a'.repeat(REJECT_REASON_MAX_LENGTH + 1) }).success).toBe(false);
  });
  it('前後空白會被修剪', () => {
    expect(rejectTourRequestSchema.parse({ reason: '  額滿  ' }).reason).toBe('額滿');
  });
});

describe('#944 mapTourOrder 暴露 cancelReason', () => {
  it('有值則帶出，空白／缺失為 undefined', () => {
    expect(mapTourOrder({ ...row, cancel_reason: '額滿' }, derived).cancelReason).toBe('額滿');
    expect(mapTourOrder({ ...row, cancel_reason: '  ' }, derived).cancelReason).toBeUndefined();
    expect(mapTourOrder(row, derived).cancelReason).toBeUndefined();
  });
});

describe('#944 travelerVisibleRejectReason', () => {
  it('REQUEST 未付款已取消且有導遊理由才顯示', () => {
    expect(travelerVisibleRejectReason(base)).toBe('該日額滿');
    expect(travelerVisibleRejectReason({ ...base, cancelReason: '  第一行\n第二行 ' })).toBe('第一行\n第二行');
  });
  it('系統逾期標記不顯示（常數與 server 共用）', () => {
    expect(serverConst).toBe(TOUR_ORDER_AUTO_EXPIRE_REASON);
    expect(travelerVisibleRejectReason({ ...base, cancelReason: TOUR_ORDER_AUTO_EXPIRE_REASON })).toBeNull();
  });
  it('手動建單（source=MANUAL）即使方案現為 REQUEST 也不顯示；LINE／其他來源仍顯示', () => {
    expect(travelerVisibleRejectReason({ ...base, source: 'MANUAL' })).toBeNull();
    expect(travelerVisibleRejectReason({ ...base, source: 'LINE' })).toBe('該日額滿');
    expect(travelerVisibleRejectReason({ ...base, source: undefined })).toBe('該日額滿');
  });
  it('空、缺失、非取消、非 REQUEST、已付款／退款中一律不顯示', () => {
    expect(travelerVisibleRejectReason({ ...base, cancelReason: '' })).toBeNull();
    expect(travelerVisibleRejectReason({ ...base, cancelReason: undefined })).toBeNull();
    expect(travelerVisibleRejectReason({ ...base, status: 'PENDING' })).toBeNull();
    expect(travelerVisibleRejectReason({ ...base, status: 'CONFIRMED' })).toBeNull();
    expect(travelerVisibleRejectReason({ ...base, salesMode: 'INSTANT' })).toBeNull();
    expect(travelerVisibleRejectReason({ ...base, salesMode: undefined })).toBeNull();
    for (const p of ['PAID', 'PARTIAL', 'REFUND_PENDING', 'REFUNDED']) {
      expect(travelerVisibleRejectReason({ ...base, paymentStatus: p })).toBeNull();
    }
  });
});

describe('#944 原始碼守門', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
  it('導遊頁把原因傳給 rejectTourOrder', () => {
    expect(read('src/app/tenant/tour-orders/page.tsx')).toMatch(/rejectTourOrder\(order\.id, rejectReason\.trim\(\) \|\| undefined\)/);
  });
  it('旅客頁以純文字渲染並保留換行，且仍先過 contact 驗證', () => {
    const src = read('src/app/s/[shopCode]/requests/[orderId]/page.tsx');
    expect(src).toContain('whitespace-pre-line');
    expect(src).not.toContain('dangerouslySetInnerHTML');
    // StatusBody 只在 loader（含 contact 比對）回傳訂單後才會渲染
    expect(src).toContain('if (!contact) notFound()');
    expect(src).toContain('if (!order) notFound()');
    expect(src.indexOf('if (!order) notFound()')).toBeGreaterThan(src.indexOf('loadPublicTourRequestStatus(shopCode'));
  });
});
