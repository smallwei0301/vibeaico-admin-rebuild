/**
 * GUIDE action inbox HTTP contract — 19 §3 / 12 §3.
 *
 * This test intentionally uses the real next server, auth cookies, RLS client and TEST seed.
 * Current main has not landed the tour source tables, so the successful response is the
 * canonical honest-empty fallback rather than fabricated demo actions. Once #40/#41 sources
 * land, retain the 401/RLS assertions and extend the seeded-state assertions here; do not
 * replace this route with a second action table.
 *
 * This file is source-only while the shared TEST lane is reserved by #40. It must be run through
 * `npm run test:integration` after that lane is released; it is not a unit-test substitute.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { GuideActionInbox } from '@/lib/types';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

const actionIds = (inbox: GuideActionInbox) => [
  ...inbox.immediate,
  ...inbox.today,
  ...inbox.upcoming,
].map((item) => item.id);

let ownerA: AuthedApi;
let ownerB: AuthedApi;

beforeAll(async () => {
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

describe('GET /api/guide/action-inbox（19 §3）', () => {
  it('已登入 GUIDE tenant → 200，回固定三區與租戶時區；沒有來源表時是誠實空值', async () => {
    const response = await ownerA.get('/api/guide/action-inbox');

    expect(response.status).toBe(200);
    const body = await readJson<GuideActionInbox & { timeZone: string }>(response);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data!.timeZone).toBe('Asia/Taipei');
    expect(body.data!.immediate).toEqual([]);
    expect(body.data!.today).toEqual([]);
    expect(body.data!.upcoming).toEqual([]);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const response = await fetch(`${BASE}/api/guide/action-inbox`);

    expect(response.status).toBe(401);
    const body = await readJson(response);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_001');
  });

  it('tenant B 的 HTTP response 不會包含 tenant A 的派生 action（RLS + tenant_id）', async () => {
    const [responseA, responseB] = await Promise.all([
      ownerA.get('/api/guide/action-inbox'),
      ownerB.get('/api/guide/action-inbox'),
    ]);

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    const bodyA = await readJson<GuideActionInbox>(responseA);
    const bodyB = await readJson<GuideActionInbox>(responseB);
    expect(bodyA.success).toBe(true);
    expect(bodyB.success).toBe(true);
    for (const id of actionIds(bodyA.data!)) expect(actionIds(bodyB.data!)).not.toContain(id);
    // Main has no tour sources yet; empty must remain empty rather than show A's mock data.
    expect(actionIds(bodyB.data!)).toEqual([]);
  });

  it('來源表尚未落地時不把資料庫相容性問題回成 500，而是回空收件匣', async () => {
    const response = await ownerB.get('/api/guide/action-inbox');

    expect(response.status).toBe(200);
    const body = await readJson<GuideActionInbox>(response);
    expect(body.success).toBe(true);
    expect(actionIds(body.data!)).toEqual([]);
  });
});
