import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { inferMigrationRiskTier } from '../../scripts/agents/production-db-release-plan.mjs';
import { tenantOwnedPublicStorageUrl } from '@/server/storage';

const readRepoFile = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const MIGRATION_PATH = 'supabase/migrations/0123_issue_589_richmenu_asset_retirement.sql';

const functionBody = (sql: string, name: string) => {
  const match = sql.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    'i',
  ));
  if (!match) throw new Error(`missing function ${name}`);
  return match[0];
};

const triggerBody = (sql: string) => functionBody(sql, 'prevent_retired_richmenu_asset');
const rpcBody = (sql: string) => functionBody(sql, 'retire_richmenu_asset');

function assertRetirementContract(sql: string) {
  const trigger = triggerBody(sql);
  const rpc = rpcBody(sql);

  expect(sql).toContain('create table public.richmenu_asset_retirements');
  expect(sql).not.toContain('create table if not exists public.richmenu_asset_retirements');
  expect(sql).toMatch(/primary key\s*\(tenant_id, image_url\)/i);
  expect(inferMigrationRiskTier(sql)).toBe('AUTHZ');
  expect(sql).toContain('enable row level security');
  expect(sql).toContain('revoke all on table public.richmenu_asset_retirements from public;');
  expect(sql).toContain('revoke all on table public.richmenu_asset_retirements from anon, authenticated;');
  expect(sql).toContain('revoke all on table public.richmenu_asset_retirements from service_role;');
  expect(sql).not.toContain('grant select, insert on table public.richmenu_asset_retirements to service_role;');

  const references = functionBody(sql, 'richmenu_asset_references');
  expect(references).toContain("p_line->>'richMenuBgImageUrl'");
  expect(references).toContain("jsonb_array_elements(");
  expect(references).toContain("card->>'imageUrl'");
  expect(references).toContain("raise exception 'richmenu flexCards must be an array'");
  expect(references).toContain("raise exception 'richmenu flexCards entries must be objects with string imageUrl values'");
  expect(references).toContain("using errcode = '22023'");
  expect(references).toMatch(/p_line\s*\?\s*'flexCards'[\s\S]*jsonb_typeof\(p_line->'flexCards'\)\s*<>\s*'array'/i);
  expect(references).toMatch(/jsonb_array_elements\(p_line->'flexCards'\)[\s\S]*jsonb_typeof\(card\)\s*<>\s*'object'/i);
  expect(references).toMatch(/card\s*\?\s*'imageUrl'[\s\S]*jsonb_typeof\(card->'imageUrl'\)\s*<>\s*'string'/i);
  expect(references).toMatch(/select distinct refs\.image_url[\s\S]*order by refs\.image_url/i);

  expect(trigger).toContain("pg_advisory_xact_lock(");
  expect(trigger).toContain('security definer');
  expect(trigger).toContain("hashtext(new.tenant_id::text || ':' || v_image_url)");
  expect(trigger).toContain("new.tenant_id::text || ':' || v_image_url");
  expect(rpc).toContain("pg_advisory_xact_lock(");
  expect(rpc).toContain('security definer');
  expect(rpc).toContain("hashtext(p_tenant_id::text || ':' || p_image_url)");
  expect(rpc).toContain("p_tenant_id::text || ':' || p_image_url");

  expect(trigger).toMatch(/for v_image_url in[\s\S]*order by image_url/i);
  expect(trigger.indexOf('pg_advisory_xact_lock')).toBeLessThan(
    trigger.indexOf('richmenu_asset_retirements'),
  );
  expect(trigger).toContain("constraint = 'richmenu_asset_not_retired'");
  expect(trigger).toContain("errcode = '23514'");
  expect(trigger).toContain('retired.tenant_id = new.tenant_id');
  expect(trigger).toContain('retired.image_url = candidate.image_url');
  expect(sql).toMatch(/create trigger trg_prevent_retired_richmenu_asset[\s\S]*before insert or update of tenant_id, line[\s\S]*execute function public\.prevent_retired_richmenu_asset\(\)/i);

  expect(rpc).toContain('where settings.tenant_id = p_tenant_id');
  expect(rpc).toContain('from public.richmenu_asset_references(settings.line)');
  expect(rpc.indexOf('pg_advisory_xact_lock')).toBeLessThan(rpc.indexOf('from public.tenant_settings'));
  expect(rpc).toContain('return false;');
  expect(rpc).toContain('insert into public.richmenu_asset_retirements');
  expect(rpc).toMatch(/on conflict \(tenant_id, image_url\) do nothing;[\s\S]*if not found then[\s\S]*return false;/i);
  expect(rpc).toContain('return true;');

  // DB identity is intentionally exact. The existing server parser, not SQL,
  // owns origin/path decoding; this keeps external and another tenant's URL
  // outside the future retirement call path.
  expect(references).not.toMatch(/decode|lower\(|regexp_replace/i);
  const storage = readRepoFile('src/server/storage.ts');
  expect(storage).toContain('parsed.origin !== supabaseOrigin');
  expect(storage).toContain('path.startsWith(`${tenantId}/`)');
  expect(storage).toContain('const marker = `/storage/v1/object/public/${bucket}/`;');

  for (const signature of [
    'richmenu_asset_references(jsonb)',
    'prevent_retired_richmenu_asset()',
    'retire_richmenu_asset(uuid, text)',
  ]) {
    const escaped = signature.replace(/[()]/g, '\\$&');
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${escaped}\\s+from public`, 'i'));
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${escaped}\\s+from anon, authenticated`, 'i'));
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${escaped}\\s+to service_role`, 'i'));
    expect(sql).toMatch(new RegExp(`alter function public\\.${escaped}\\s+set search_path = ''`, 'i'));
  }
  expect(sql).toContain('p.proacl::text');
  expect(sql).toContain('c.relacl::text');
  expect(sql).toMatch(/v_acl like '%service_role=%'/);
}

describe('#589 richmenu asset retirement schema-prep', () => {
  it('keeps background and Flex references in one tenant-scoped retirement contract', () => {
    assertRetirementContract(readRepoFile(MIGRATION_PATH));
  });

  it('fails closed when an adversary removes the stale-write trigger defense', () => {
    const mutated = readRepoFile(MIGRATION_PATH)
      .replace("constraint = 'richmenu_asset_not_retired'", "constraint = 'removed_guard'");
    expect(() => assertRetirementContract(mutated)).toThrow();
  });

  it('fails closed when an adversary removes the shared advisory lock', () => {
    const mutated = readRepoFile(MIGRATION_PATH)
      .replaceAll('pg_advisory_xact_lock', 'removed_advisory_lock');
    expect(() => assertRetirementContract(mutated)).toThrow();
  });

  it('fails closed when an adversary removes tenant scoping from the trigger', () => {
    const mutated = readRepoFile(MIGRATION_PATH)
      .replace('retired.tenant_id = new.tenant_id', 'retired.tenant_id = retired.tenant_id');
    expect(() => assertRetirementContract(mutated)).toThrow();
  });

  it('fails closed when an adversary reopens the RPC to PUBLIC', () => {
    const mutated = readRepoFile(MIGRATION_PATH)
      .replace('revoke all on function public.retire_richmenu_asset(uuid, text) from public;', '-- removed');
    expect(() => assertRetirementContract(mutated)).toThrow();
  });

  it('fails closed when an adversary turns malformed flexCards into an empty reference set', () => {
    const mutated = readRepoFile(MIGRATION_PATH)
      .replace("raise exception 'richmenu flexCards must be an array'", '-- removed');
    expect(() => assertRetirementContract(mutated)).toThrow();
  });

  it('fails closed when an adversary allows malformed flexCard entries', () => {
    const mutated = readRepoFile(MIGRATION_PATH)
      .replace(
        "raise exception 'richmenu flexCards entries must be objects with string imageUrl values'",
        '-- removed',
      );
    expect(() => assertRetirementContract(mutated)).toThrow();
  });

  it('fails closed when an adversary restores direct service_role table INSERT', () => {
    const mutated = readRepoFile(MIGRATION_PATH)
      .replace(
        'revoke all on table public.richmenu_asset_retirements from service_role;',
        'grant insert on table public.richmenu_asset_retirements to service_role;',
      );
    expect(() => assertRetirementContract(mutated)).toThrow();
  });
});

describe('#589 canonical URL boundary reserved for Phase B callers', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example';
  });

  it('collapses query, fragment, and percent-encoding aliases to one URL', () => {
    expect(tenantOwnedPublicStorageUrl(
      'https://storage.example/storage/v1/object/public/richmenu-assets/tenant-a/hero%20image.png?cache=2#editor',
      'richmenu-assets',
      'tenant-a',
    )).toBe('https://storage.example/storage/v1/object/public/richmenu-assets/tenant-a/hero%20image.png');
    expect(tenantOwnedPublicStorageUrl(
      'https://storage.example/storage/v1/object/public/richmenu-assets/tenant-a/%68ero%20image.png',
      'richmenu-assets',
      'tenant-a',
    )).toBe('https://storage.example/storage/v1/object/public/richmenu-assets/tenant-a/hero%20image.png');
  });

  it('rejects external, other-bucket, and other-tenant URLs before retirement', () => {
    for (const url of [
      'https://evil.example/storage/v1/object/public/richmenu-assets/tenant-a/x.png',
      'https://storage.example/storage/v1/object/public/other-bucket/tenant-a/x.png',
      'https://storage.example/storage/v1/object/public/richmenu-assets/tenant-b/x.png',
    ]) {
      expect(tenantOwnedPublicStorageUrl(url, 'richmenu-assets', 'tenant-a')).toBeNull();
    }
  });
});
