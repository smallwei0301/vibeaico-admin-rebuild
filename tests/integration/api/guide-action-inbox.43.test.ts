/**
 * GUIDE action inbox API — #43-A 第一個可出貨資料類別：待確認預約。
 * 這個檔案只讀 seed 資料，驗證 tenant 邊界；不建立、不修改、不清理資料。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { GuideActionInboxItem } from '@/lib/types';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let ownerA: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

describe('GET /api/guide/action-inbox（#43-A）', () => {
  it('登入租戶回傳待確認預約的可操作欄位與優先級', async () => {
    const res = await ownerA.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);

    const pending = body.data?.find((item) => item.id === SHOP_A.bookingPending);
    expect(pending).toMatchObject({
      id: SHOP_A.bookingPending,
      kind: 'BOOKING_REQUEST',
      bookingNo: 'BSEED0001',
      href: '/tenant/bookings?status=PENDING',
    });
    expect(['IMMEDIATE', 'TODAY', 'UPCOMING']).toContain(pending?.priority);
    expect(pending?.customerName).toBe('顧客 A1（測試）');
    expect(pending?.serviceName).toBe('基礎剪髮（測試）');
  });

  it('未登入回 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/guide/action-inbox`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });

  it('SHOP_B 不會看到 SHOP_A 的待確認預約', async () => {
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
    const res = await ownerB.get('/api/guide/action-inbox');
    expect(res.status).toBe(200);
    const body = await readJson<GuideActionInboxItem[]>(res);
    expect(body.success).toBe(true);
    expect(body.data ?? []).toEqual([]);
    expect(body.data?.some((item) => item.id === SHOP_A.bookingPending)).toBe(false);
  });
});
