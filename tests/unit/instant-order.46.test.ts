import { describe, expect, it, vi } from 'vitest';
import { createInstantTourOrder, mapInstantOrderError, type CreateInstantOrderInput } from '@/server/instant-order';
import { ERR } from '@/server/http';

const INPUT: CreateInstantOrderInput = {
  tenantId: 't', planId: 'p', startsAt: '2026-10-27T02:00:00.000Z', partySize: 2, customerId: null,
  contact: { name: 'a' }, note: '', idempotencyKey: 'k', expectedTotal: 2000, orderNo: 'ORD-1', source: 'VIBEAI_SHOP',
};

function admin(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { rpc, client: { rpc } as never };
}

describe('#46 INSTANT 建單 wrapper', () => {
  it('以 0138 RPC 簽章傳參（12 個 p_ 參數）', async () => {
    const { rpc, client } = admin({ data: { orderId: 'o', departureId: 'd', holdExpiresAt: 'x', deduped: false } });
    await createInstantTourOrder(client, INPUT);
    expect(rpc).toHaveBeenCalledWith('create_instant_tour_order', {
      p_tenant: 't', p_plan: 'p', p_starts_at: INPUT.startsAt, p_party_size: 2, p_customer: null,
      p_contact: { name: 'a' }, p_note: '', p_idempotency_key: 'k', p_expected_total: 2000,
      p_order_no: 'ORD-1', p_source: 'VIBEAI_SHOP', p_payment_method: null,
    });
  });

  it('成功回傳 orderId／departureId／deduped', async () => {
    const { client } = admin({ data: { orderId: 'o', departureId: 'd', holdExpiresAt: '2026-10-24T12:00:00Z', totalAmount: 2000, deduped: true } });
    await expect(createInstantTourOrder(client, INPUT)).resolves.toMatchObject({ ok: true, orderId: 'o', departureId: 'd', totalAmount: 2000, deduped: true });
  });

  it('RPC 回應缺 orderId 時 fail closed（拋錯，不假裝成功）', async () => {
    const { client } = admin({ data: {} });
    await expect(createInstantTourOrder(client, INPUT)).rejects.toThrow('INSTANT_ORDER_RPC_BAD_RESPONSE');
  });

  it.each([
    [{ code: 'P0022', message: 'SLOT_TAKEN' }, 'SLOT_TAKEN', 409, ERR.SLOT_TAKEN],
    [{ code: 'P0020', message: 'STAFF_OCCUPIED' }, 'STAFF_OCCUPIED', 409, ERR.STAFF_OCCUPIED],
    [{ code: 'P0001', message: 'SEATS_UNAVAILABLE' }, 'SEATS_UNAVAILABLE', 409, ERR.SEATS_UNAVAILABLE],
    [{ code: 'P0021', message: 'INVALID_START', details: 'LEAD_TIME' }, 'INVALID_START', 400, ERR.INVALID_START],
    [{ code: 'P0023', message: 'INSTANT_NOT_AVAILABLE' }, 'INSTANT_NOT_AVAILABLE', 409, ERR.INSTANT_UNAVAILABLE],
    [{ code: 'P0024', message: 'INSTANT_NOT_CONFIGURED' }, 'INSTANT_NOT_CONFIGURED', 409, ERR.INSTANT_UNAVAILABLE],
    [{ code: 'P0025', message: 'IDEMPOTENCY_KEY_REUSED' }, 'IDEMPOTENCY_KEY_REUSED', 409, ERR.CONFLICT],
    [{ code: 'P0003', message: 'PARTY_SIZE_OUT_OF_RANGE' }, 'INVALID_ARGUMENTS', 400, ERR.VALIDATION],
    [{ code: 'P0002', message: 'PLAN_NOT_FOUND' }, 'PLAN_NOT_FOUND', 404, ERR.NOT_FOUND],
  ])('對映 %j', (error, kind, status, code) => {
    expect(mapInstantOrderError(error)).toMatchObject({ ok: false, kind, status, code });
  });

  it('PRICE_CHANGED（P0004）帶現價；INVALID_START 帶原因', () => {
    expect(mapInstantOrderError({ code: 'P0004', message: 'PRICE_CHANGED', details: '{"unitPrice" : 1200, "total" : 2400}' }))
      .toMatchObject({ kind: 'PRICE_CHANGED', status: 409, code: ERR.PRICE_CHANGED, quote: { unitPrice: 1200, total: 2400 } });
    expect(mapInstantOrderError({ code: 'P0004', message: 'PRICE_CHANGED', details: 'not json' })?.quote).toBeUndefined();
    expect(mapInstantOrderError({ code: 'P0021', message: 'INVALID_START', details: 'BEYOND_WINDOW' })?.reason).toBe('BEYOND_WINDOW');
  });

  it('多義 SQLSTATE 不誤分類：DEPARTURE_NOT_FOUND(P0002)、未知 P0001／P0003 回 null', () => {
    expect(mapInstantOrderError({ code: 'P0002', message: 'DEPARTURE_NOT_FOUND' })).toBeNull();
    expect(mapInstantOrderError({ code: 'P0001', message: 'something else' })).toBeNull();
    expect(mapInstantOrderError({ code: 'P0003', message: 'weird' })).toBeNull();
    expect(mapInstantOrderError(null)).toBeNull();
  });

  it('未知錯誤（例如 0138 尚未套用的 PGRST202）原樣拋出，不退回非原子路徑', async () => {
    const err = { code: 'PGRST202', message: 'Could not find the function public.create_instant_tour_order' };
    const { client } = admin({ error: err });
    await expect(createInstantTourOrder(client, INPUT)).rejects.toBe(err);
  });

  it('已知衝突不拋錯，回 {ok:false}', async () => {
    const { client } = admin({ error: { code: 'P0022', message: 'SLOT_TAKEN' } });
    await expect(createInstantTourOrder(client, INPUT)).resolves.toMatchObject({ ok: false, kind: 'SLOT_TAKEN', status: 409 });
  });

  it('冪等重送：回傳原單 status；原單已取消（P0025 ORDER_CANCELLED）回衝突並帶原因', async () => {
    const ok = admin({ data: { orderId: 'o', departureId: 'd', status: 'CONFIRMED', deduped: true } });
    await expect(createInstantTourOrder(ok.client, INPUT)).resolves.toMatchObject({ ok: true, status: 'CONFIRMED', deduped: true });
    const cancelled = admin({ error: { code: 'P0025', message: 'IDEMPOTENCY_KEY_REUSED', details: 'ORDER_CANCELLED' } });
    await expect(createInstantTourOrder(cancelled.client, INPUT)).resolves.toMatchObject({
      ok: false, kind: 'IDEMPOTENCY_KEY_REUSED', status: 409, reason: 'ORDER_CANCELLED',
    });
  });
});
