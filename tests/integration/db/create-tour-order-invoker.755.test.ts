/**
 * #755 R1 / 0136：Production 角色配置下 create_tour_order 的 refund_policy_snapshot。
 *
 * 只能在本機隔離 Supabase（TEST_PROFILE=LOCAL_ISOLATED 且 TEST_ENV_ID 為 local-pr-* 或 vibeaico-*）
 * 執行；共享 canonical TEST 與 Production 一律 skip——此測試需要建立 role 並更改函式 owner，
 * 屬於 DB 層級變更，沒有授權在共享 TEST 做。
 *
 * 手法：每個案例都在單一 transaction 內
 *   1. 建立一個 nosuperuser／nobypassrls／noinherit 的 role（模擬 production_migration_owner），
 *      並把 create_tour_order 的 owner 改成它（trips 仍屬 postgres 並啟用 RLS）；
 *   2. 以 service_role（無 JWT）呼叫，量測 refund_policy_snapshot；
 *   3. 最後一律 ROLLBACK，role／owner／訂單全部不留痕跡。
 * 「修復前」＝函式維持 SECURITY DEFINER，預期 snapshot 為 NULL（重現 #755）；
 * 「修復後」＝套用 0136 的 ALTER ... SECURITY INVOKER，預期 snapshot 等於 trips.refund_policy_type。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OWNER = 'test_755_migration_owner';
const SIGNATURE =
  'public.create_tour_order(uuid, text, uuid, integer, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz)';
const POLICIES = ['STANDARD', 'FLEXIBLE', 'STRICT'] as const;

const isLocalIsolated =
  process.env.TEST_PROFILE === 'LOCAL_ISOLATED' &&
  /^local-pr-|^vibeaico-/.test(String(process.env.TEST_ENV_ID ?? process.env.LOCAL_PROJECT_ID ?? ''));
const localDescribe = isLocalIsolated ? describe : describe.skip;

class Rollback extends Error {}

localDescribe('#755 create_tour_order under the Production role layout (local isolated only)', () => {
  let admin: ReturnType<typeof postgres>;

  beforeAll(() => {
    admin = postgres(LOCAL_DB_URL, { max: 2, prepare: false });
  });
  afterAll(async () => {
    await admin?.end({ timeout: 2 }).catch(() => undefined);
  });

  /** 在 transaction 內以 Production 角色配置執行 fn，結束後一律 rollback。 */
  async function inProductionLayout<T>(
    invoker: boolean,
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> {
    let result!: T;
    try {
      await admin.begin(async (tx) => {
        await tx.unsafe(`create role ${OWNER} nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit`);
        await tx.unsafe(`grant create on schema public to ${OWNER}`);
        // owner 對函式讀寫的表有權限（Production 的 owner 擁有 departures/plans，並可讀 trips），
        // 但 trips 的 RLS 仍會過濾掉它看得到的列。
        await tx.unsafe(`grant select on public.trips, public.trip_departures, public.trip_plans, public.trip_plan_seasons to ${OWNER}`);
        await tx.unsafe(`grant insert, select on public.tour_orders to ${OWNER}`);
        await tx.unsafe(`alter function ${SIGNATURE} owner to ${OWNER}`);
        if (invoker) await tx.unsafe(`alter function ${SIGNATURE} security invoker`);
        result = await fn(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    return result;
  }

  async function createOrder(tx: postgres.TransactionSql, tenant: string, departure: string) {
    await tx.unsafe('set local role service_role');
    await tx.unsafe("select set_config('request.jwt.claims', '', true)");
    const rows = await tx.unsafe(
      `select public.create_tour_order($1, $2, $3, 1, null, '{}'::jsonb, 'MANUAL', null, '', null) as id`,
      [tenant, `T755-${randomUUID().slice(0, 8)}`, departure],
    );
    return rows[0].id as string;
  }

  async function snapshotOf(tx: postgres.TransactionSql, orderId: string) {
    await tx.unsafe('reset role');
    const rows = await tx.unsafe('select refund_policy_snapshot as s from public.tour_orders where id = $1', [orderId]);
    return rows[0].s as string | null;
  }

  it('before R1 (SECURITY DEFINER, non-bypass owner) the snapshot is silently NULL', async () => {
    const snapshots = await inProductionLayout(false, async (tx) => {
      const out: Array<string | null> = [];
      for (const policy of POLICIES) {
        await tx.unsafe('reset role');
        await tx.unsafe('update public.trips set refund_policy_type = $1 where id = $2', [policy, TRIP_A.id]);
        out.push(await snapshotOf(tx, await createOrder(tx, SHOP_A.id, TRIP_A.departure1)));
      }
      return out;
    });
    expect(snapshots).toEqual([null, null, null]);
  });

  it('after R1 (SECURITY INVOKER) service_role without JWT snapshots STANDARD/FLEXIBLE/STRICT exactly', async () => {
    const snapshots = await inProductionLayout(true, async (tx) => {
      const out: Array<string | null> = [];
      for (const policy of POLICIES) {
        await tx.unsafe('reset role');
        await tx.unsafe('update public.trips set refund_policy_type = $1 where id = $2', [policy, TRIP_A.id]);
        out.push(await snapshotOf(tx, await createOrder(tx, SHOP_A.id, TRIP_A.departure1)));
      }
      return out;
    });
    expect(snapshots).toEqual([...POLICIES]);
  });

  it('after R1 a cross-tenant call fails with DEPARTURE_NOT_FOUND and creates no order', async () => {
    const outcome = await inProductionLayout(true, async (tx) => {
      await tx.unsafe('reset role');
      const [{ n: before }] = await tx.unsafe('select count(*)::int as n from public.tour_orders');
      let message = '';
      await tx.savepoint(async (sp) => {
        try {
          await createOrder(sp, SHOP_B.id, TRIP_A.departure1);
        } catch (error) {
          message = (error as Error).message;
          throw error;
        }
      }).catch(() => undefined);
      await tx.unsafe('reset role');
      const [{ n: after }] = await tx.unsafe('select count(*)::int as n from public.tour_orders');
      return { before, after, message };
    });
    expect(outcome.message).toContain('DEPARTURE_NOT_FOUND');
    expect(outcome.after).toBe(outcome.before);
  });
});
