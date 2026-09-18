import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const testEnvironment = String(process.env.TEST_ENV_ID ?? process.env.LOCAL_PROJECT_ID ?? '');
const isLocalIsolated = process.env.TEST_PROFILE === 'LOCAL_ISOLATED'
  && /^(local-pr-|local-schema-|vibeaico-)/.test(testEnvironment);

const localDescribe = isLocalIsolated ? describe : describe.skip;

type RichMenuLine = {
  richMenuBgImageUrl: string;
  flexCards: Array<{ imageUrl: string }>;
};

type Fixture = {
  tenantId: string;
  otherTenantId: string;
  background: string;
  flexA: string;
  flexB: string;
  unreferenced: string;
};

let db: ReturnType<typeof postgres>;
let fixture: Fixture;
let createdTenantIds: string[] = [];

function lineWith(background: string, ...flexCards: string[]): RichMenuLine {
  return {
    richMenuBgImageUrl: background,
    flexCards: flexCards.map((imageUrl) => ({ imageUrl })),
  };
}

async function createTenant(line: RichMenuLine): Promise<string> {
  const id = randomUUID();
  const suffix = id.replaceAll('-', '').slice(0, 20);
  await db.unsafe(
    'insert into public.tenants (id, shop_code, name) values ($1::uuid, $2, $3)',
    [id, `issue-589-${suffix}`, `Issue 589 ${suffix}`],
  );
  await db.unsafe(
    'insert into public.tenant_settings (tenant_id, line) values ($1::uuid, $2::jsonb)',
    [id, JSON.stringify(line)],
  );
  createdTenantIds.push(id);
  return id;
}

async function updateLine(
  tenantId: string,
  line: RichMenuLine,
  connection: { unsafe: ReturnType<typeof postgres>['unsafe'] } = db,
): Promise<void> {
  await connection.unsafe(
    'update public.tenant_settings set line = $2::jsonb where tenant_id = $1::uuid',
    [tenantId, JSON.stringify(line)],
  );
}

async function callRetire(
  connection: { begin: ReturnType<typeof postgres>['begin'] },
  tenantId: string,
  imageUrl: string,
): Promise<boolean> {
  return connection.begin(async (tx) => {
    await tx.unsafe('set local role service_role');
    const rows = await tx.unsafe(
      'select public.retire_richmenu_asset($1::uuid, $2::text) as retired',
      [tenantId, imageUrl],
    );
    return rows[0]?.retired === true;
  });
}

async function retirementRows(tenantId: string) {
  return db.unsafe(
    'select image_url from public.richmenu_asset_retirements where tenant_id = $1::uuid order by image_url',
    [tenantId],
  );
}

async function eventually(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

localDescribe('Issue #589 real PostgreSQL retirement contract', () => {
  beforeAll(() => {
    db = postgres(LOCAL_DB_URL, { max: 8, prepare: false });
  });

  beforeEach(async () => {
    const tenantId = randomUUID();
    fixture = {
      tenantId,
      otherTenantId: '',
      background: `https://storage.example/storage/v1/object/public/richmenu-assets/${tenantId}/background.png`,
      flexA: `https://storage.example/storage/v1/object/public/richmenu-assets/${tenantId}/flex-a.png`,
      flexB: `https://storage.example/storage/v1/object/public/richmenu-assets/${tenantId}/flex-b.png`,
      unreferenced: `https://storage.example/storage/v1/object/public/richmenu-assets/${tenantId}/unused.png`,
    };
    fixture.tenantId = await createTenant(
      lineWith(fixture.background, fixture.flexA, fixture.flexB),
    );
    fixture.otherTenantId = await createTenant(lineWith(''));
  });

  afterEach(async () => {
    if (createdTenantIds.length) {
      await db.unsafe(
        'delete from public.tenants where id = any($1::uuid[])',
        [createdTenantIds],
      );
    }
    createdTenantIds = [];
  });

  afterAll(async () => {
    await db?.end({ timeout: 2 }).catch(() => undefined);
  });

  it('re-reads background and every Flex reference before creating a retirement row', async () => {
    expect(await callRetire(db, fixture.tenantId, fixture.background)).toBe(false);
    expect(await callRetire(db, fixture.tenantId, fixture.flexA)).toBe(false);
    expect(await callRetire(db, fixture.tenantId, fixture.flexB)).toBe(false);
    expect(await callRetire(db, fixture.tenantId, fixture.unreferenced)).toBe(true);

    const rows = await retirementRows(fixture.tenantId);
    expect(rows.map((row) => row.image_url)).toEqual([fixture.unreferenced]);

    await expect(
      updateLine(fixture.tenantId, lineWith(fixture.background, fixture.unreferenced)),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps retirement tenant-scoped and allows another tenant to use the same URL', async () => {
    expect(await callRetire(db, fixture.tenantId, fixture.unreferenced)).toBe(true);

    await expect(
      updateLine(fixture.otherTenantId, lineWith('', fixture.unreferenced)),
    ).resolves.toBeUndefined();

    expect((await retirementRows(fixture.tenantId)).map((row) => row.image_url))
      .toEqual([fixture.unreferenced]);
    expect(await retirementRows(fixture.otherTenantId)).toEqual([]);
  });

  it('rejects browser roles and direct service_role table writes while allowing the RPC', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(db.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx.unsafe(
          'select public.retire_richmenu_asset($1::uuid, $2::text)',
          [fixture.tenantId, fixture.unreferenced],
        );
      })).rejects.toMatchObject({ code: '42501' });
    }

    const directUrl = `${fixture.unreferenced}.direct`;
    await expect(db.begin(async (tx) => {
      await tx.unsafe('set local role service_role');
      await tx.unsafe(
        'insert into public.richmenu_asset_retirements (tenant_id, image_url) values ($1::uuid, $2)',
        [fixture.tenantId, directUrl],
      );
    })).rejects.toMatchObject({ code: '42501' });

    expect(await callRetire(db, fixture.tenantId, fixture.unreferenced)).toBe(true);
  });

  it('fails closed on malformed JSON with the live PostgreSQL error code', async () => {
    for (const malformed of [
      { flexCards: {} },
      { flexCards: [1] },
      { flexCards: [{ imageUrl: 7 }] },
      { richMenuBgImageUrl: null },
    ]) {
      await expect(db.begin(async (tx) => {
        await tx.unsafe('set local role service_role');
        await tx.unsafe(
          'select * from public.richmenu_asset_references($1::jsonb)',
          [JSON.stringify(malformed)],
        );
      })).rejects.toMatchObject({ code: '22023' });
    }
  });

  it('observes a writer-first commit after waiting on the shared advisory lock', async () => {
    const writer = await db.reserve();
    const retireConnection = await db.reserve();
    await retireConnection.unsafe("set application_name = 'issue-589-retirement-rpc'");

    let releaseWriter!: () => void;
    const writerRelease = new Promise<void>((resolve) => { releaseWriter = resolve; });
    let writerReady!: () => void;
    const writerStarted = new Promise<void>((resolve) => { writerReady = resolve; });

    const writerPromise = writer.begin(async (tx) => {
      await updateLine(
        fixture.tenantId,
        lineWith(fixture.unreferenced),
        tx,
      );
      writerReady();
      await writerRelease;
    });

    try {
      await writerStarted;
      const keyRows = await db.unsafe(
        'select hashtext($1::text)::integer as key',
        [`${fixture.tenantId}:${fixture.unreferenced}`],
      );
      const probe = await db.begin(async (tx) => tx.unsafe(
        'select pg_try_advisory_xact_lock($1::integer) as locked',
        [keyRows[0].key],
      ));
      expect(probe[0].locked).toBe(false);

      const retirePromise = callRetire(
        retireConnection,
        fixture.tenantId,
        fixture.unreferenced,
      );
      const observedWaiting = await eventually(async () => {
        const rows = await db.unsafe(
          `select 1
             from pg_stat_activity
            where application_name = 'issue-589-retirement-rpc'
              and wait_event_type = 'Lock'
              and wait_event = 'advisory'`,
        );
        return rows.length === 1;
      });
      expect(observedWaiting).toBe(true);

      releaseWriter();
      await expect(writerPromise).resolves.toBeUndefined();
      await expect(retirePromise).resolves.toBe(false);
      expect(await retirementRows(fixture.tenantId)).toEqual([]);
    } finally {
      releaseWriter();
      await Promise.allSettled([writerPromise]);
      writer.release();
      retireConnection.release();
    }
  });
});
