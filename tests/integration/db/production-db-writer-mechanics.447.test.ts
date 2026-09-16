import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const OWNER = 'test_447_migration_owner';
const WRITER = 'test_447_migration_writer';
const SCHEMA = 'test_447_writer';
const PASSWORD = 'local_only_447_writer_password';
const LOCK_KEY = 44720260916;

const isLocalIsolated =
  process.env.TEST_PROFILE === 'LOCAL_ISOLATED' &&
  /^local-pr-|^vibeaico-/.test(String(process.env.TEST_ENV_ID ?? process.env.LOCAL_PROJECT_ID ?? ''));

const localDescribe = isLocalIsolated ? describe : describe.skip;

localDescribe('Issue #447 dedicated Production-writer mechanics on isolated PostgreSQL', () => {
  let admin: ReturnType<typeof postgres>;
  let writer: ReturnType<typeof postgres>;

  beforeAll(async () => {
    admin = postgres(LOCAL_DB_URL, { max: 3, prepare: false });

    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await admin.unsafe(`drop role if exists ${WRITER}`);
    await admin.unsafe(`drop role if exists ${OWNER}`);

    await admin.unsafe(`create role ${OWNER} nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit`);
    await admin.unsafe(`create role ${WRITER} login password '${PASSWORD}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit`);
    await admin.unsafe(`grant ${OWNER} to ${WRITER} with inherit false, set true`);
    await admin.unsafe(`create schema ${SCHEMA} authorization ${OWNER}`);

    writer = postgres(`postgresql://${WRITER}:${PASSWORD}@127.0.0.1:54322/postgres`, {
      max: 4,
      prepare: false,
    });
  });

  afterAll(async () => {
    await writer?.end({ timeout: 2 }).catch(() => undefined);
    if (admin) {
      await admin.unsafe(`drop schema if exists ${SCHEMA} cascade`).catch(() => undefined);
      await admin.unsafe(`drop role if exists ${WRITER}`).catch(() => undefined);
      await admin.unsafe(`drop role if exists ${OWNER}`).catch(() => undefined);
      await admin.end({ timeout: 2 }).catch(() => undefined);
    }
  });

  it('proves LOGIN writer can SET ROLE only to the NOLOGIN migration owner', async () => {
    const roleRows = await writer.unsafe(`
      select current_user as current_user,
             session_user as session_user,
             pg_has_role(current_user, '${OWNER}', 'SET') as can_set_owner,
             pg_has_role(current_user, 'postgres', 'SET') as can_set_postgres
    `);
    expect(roleRows[0]).toMatchObject({
      current_user: WRITER,
      session_user: WRITER,
      can_set_owner: true,
      can_set_postgres: false,
    });

    await writer.begin(async (tx) => {
      await tx.unsafe(`set local role ${OWNER}`);
      const current = await tx.unsafe('select current_user as current_user, session_user as session_user');
      expect(current[0]).toMatchObject({ current_user: OWNER, session_user: WRITER });
      await tx.unsafe(`create table ${SCHEMA}.owner_probe(id integer primary key)`);
    });

    await expect(writer.unsafe('set role postgres')).rejects.toMatchObject({ code: '42501' });
    const owner = await admin.unsafe(`select pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='${SCHEMA}' and c.relname='owner_probe'`);
    expect(owner[0]?.owner).toBe(OWNER);
  });

  it('serializes writers with a database advisory transaction lock', async () => {
    const first = await writer.reserve();
    const second = await writer.reserve();
    try {
      await first.unsafe('begin');
      await first.unsafe(`set local role ${OWNER}`);
      const firstLock = await first.unsafe(`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`);
      expect(firstLock[0]?.locked).toBe(true);

      await second.unsafe('begin');
      await second.unsafe(`set local role ${OWNER}`);
      const secondLock = await second.unsafe(`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`);
      expect(secondLock[0]?.locked).toBe(false);

      await first.unsafe('commit');
      const secondAfter = await second.unsafe(`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`);
      expect(secondAfter[0]?.locked).toBe(true);
      await second.unsafe('rollback');
    } finally {
      await first.unsafe('rollback').catch(() => undefined);
      await second.unsafe('rollback').catch(() => undefined);
      first.release();
      second.release();
    }
  });

  it('rolls back schema changes when one statement fails', async () => {
    await expect(writer.begin(async (tx) => {
      await tx.unsafe(`set local role ${OWNER}`);
      await tx.unsafe(`create table ${SCHEMA}.rollback_probe(id integer primary key)`);
      await tx.unsafe(`insert into ${SCHEMA}.rollback_probe(id) values (1)`);
      await tx.unsafe(`insert into ${SCHEMA}.rollback_probe(id) values (1)`);
    })).rejects.toMatchObject({ code: '23505' });

    const rows = await admin.unsafe(`select to_regclass('${SCHEMA}.rollback_probe')::text as relation`);
    expect(rows[0]?.relation ?? null).toBeNull();
  });

  it('enforces the writer statement timeout inside the transaction', async () => {
    await expect(writer.begin(async (tx) => {
      await tx.unsafe(`set local role ${OWNER}`);
      await tx.unsafe("set local statement_timeout = '100ms'");
      await tx.unsafe('select pg_sleep(1)');
    })).rejects.toMatchObject({ code: '57014' });
  });

  it('surfaces a real connection loss instead of silently continuing', async () => {
    const victim = await writer.reserve();
    try {
      const pidRows = await victim.unsafe('select pg_backend_pid() as pid');
      const pid = Number(pidRows[0]?.pid);
      expect(Number.isInteger(pid) && pid > 0).toBe(true);
      const terminated = await admin.unsafe(`select pg_terminate_backend(${pid}) as terminated`);
      expect(terminated[0]?.terminated).toBe(true);
      await expect(victim.unsafe('select 1')).rejects.toBeTruthy();
    } finally {
      victim.release();
    }
  });
});
