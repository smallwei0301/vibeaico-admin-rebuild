import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { loadCheckedTestEnv, TEST_ENV_IDENTITY_KEYS } from '../../scripts/agents/test-env-policy.mjs';

// Synthetic values only. No real .env file, DB, server, or provider is accessed.
const fileKey = '1'.repeat(64);
const inheritedKey = '2'.repeat(64);
const testUrl = 'http://127.0.0.1:54321';
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
function write(root: string, path: string, text: string) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}
function fixture<T>(run: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'test-env-384-'));
  try { return run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function child(root: string, code: string, overrides: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  for (const key of [...TEST_ENV_IDENTITY_KEYS, 'NODE_OPTIONS']) delete env[key];
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: root, encoding: 'utf8', timeout: 5_000,
    env: {
      ...env, SETTINGS_ENCRYPTION_KEY: inheritedKey,
      TEST_SUPABASE_URL: testUrl, TEST_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://platform.invalid', ...overrides,
    },
  });
}
function entryFixture(root: string, hasFile = true) {
  if (hasFile) write(root, '.env.test', `SETTINGS_ENCRYPTION_KEY=${fileKey}\nTEST_SUPABASE_URL=${testUrl}\nTEST_SUPABASE_SERVICE_ROLE_KEY=synthetic-service-key\n`);
  write(root, 'scripts/agents/test-env-policy.mjs', source('scripts/agents/test-env-policy.mjs'));
  write(root, 'scripts/test/_supabase-admin.mjs', source('scripts/test/_supabase-admin.mjs'));
  // The unused SDK import is a deny-all stub. It cannot create a real client.
  write(root, 'node_modules/@supabase/supabase-js/package.json', '{"type":"module","exports":"./index.js"}');
  write(root, 'node_modules/@supabase/supabase-js/index.js', 'export function createClient() { throw new Error("SDK_CLIENT_FORBIDDEN_IN_UNIT_TEST"); }');
  const compiled = ts.transpileModule(source('tests/integration/global-setup.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  write(root, 'tests/integration/global-setup.mjs',
    `const __dirname = ${JSON.stringify(join(root, 'tests/integration'))};\n` + compiled);
  // Real setup control flow, fake destructive boundary. A regression can only
  // write a local marker and exit, never start a database or next dev server.
  write(root, 'scripts/test/reset-db.mjs',
    'import { writeFileSync } from "node:fs"; writeFileSync("reset-reached", "yes"); process.exit(71);');
}
const adminEntry = 'import { loadTestEnv, assertSafeTestUrl } from "./scripts/test/_supabase-admin.mjs"; loadTestEnv(); assertSafeTestUrl(); console.log("ENV_READY");';
const setupEntry = 'import setup from "./tests/integration/global-setup.mjs"; await setup();';

describe('test environment identity gate (#384)', () => {
  it('loads missing values, accepts matching identities and preserves unrelated precedence', () => fixture((root) => {
    write(root, '.env.test', `SETTINGS_ENCRYPTION_KEY=${fileKey}\nUNRELATED=file\nNEW_VALUE=loaded\n`);
    const env: NodeJS.ProcessEnv = { SETTINGS_ENCRYPTION_KEY: fileKey, UNRELATED: 'inherited' };
    assert.equal(loadCheckedTestEnv(join(root, '.env.test'), env), true);
    assert.deepEqual(env, { SETTINGS_ENCRYPTION_KEY: fileKey, UNRELATED: 'inherited', NEW_VALUE: 'loaded' });
  }));

  it('rejects a conflicting encryption key before any environment assignment and redacts values', () => fixture((root) => {
    write(root, '.env.test', `NEW_VALUE=must-not-load\nSETTINGS_ENCRYPTION_KEY=${fileKey}\n`);
    const env = { SETTINGS_ENCRYPTION_KEY: inheritedKey };
    assert.throws(() => loadCheckedTestEnv(join(root, '.env.test'), env), (error: unknown) => {
      const message = String(error);
      assert.match(message, /TEST_ENV_CONFLICT.*SETTINGS_ENCRYPTION_KEY/);
      assert.match(message, /sha256:[a-f0-9]{12}/);
      assert.equal(message.includes(fileKey), false);
      assert.equal(message.includes(inheritedKey), false);
      return true;
    });
    assert.deepEqual(env, { SETTINGS_ENCRYPTION_KEY: inheritedKey });
  }));

  it('covers database identity, encryption, authentication and cron settings', () => fixture((root) => {
    assert.deepEqual([...TEST_ENV_IDENTITY_KEYS], [
      'SETTINGS_ENCRYPTION_KEY', 'AUTH_SECRET', 'TEST_SUPABASE_URL',
      'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SERVICE_ROLE_KEY', 'TEST_CRON_SECRET', 'CRON_SECRET',
    ]);
    for (const key of TEST_ENV_IDENTITY_KEYS) {
      write(root, '.env.test', `${key}=file-value\n`);
      assert.throws(() => loadCheckedTestEnv(join(root, '.env.test'), { [key]: 'inherited-value' }), /TEST_ENV_CONFLICT/);
    }
  }));

  it('treats an inherited empty value as a conflict, not a missing value', () => fixture((root) => {
    write(root, '.env.test', `SETTINGS_ENCRYPTION_KEY=${fileKey}\n`);
    assert.throws(() => loadCheckedTestEnv(join(root, '.env.test'), { SETTINGS_ENCRYPTION_KEY: '' }), /TEST_ENV_CONFLICT/);
  }));

  it('reports all identity conflicts without loading an unrelated setting', () => fixture((root) => {
    write(root, '.env.test', `NEW_VALUE=no\nSETTINGS_ENCRYPTION_KEY=${fileKey}\nTEST_SUPABASE_URL=${testUrl}\n`);
    const env = { SETTINGS_ENCRYPTION_KEY: inheritedKey, TEST_SUPABASE_URL: 'https://wrong.invalid' };
    const before = { ...env };
    assert.throws(() => loadCheckedTestEnv(join(root, '.env.test'), env), (error: unknown) => {
      assert.match(String(error), /SETTINGS_ENCRYPTION_KEY.*TEST_SUPABASE_URL/);
      assert.equal(String(error).includes('wrong.invalid'), false);
      return true;
    });
    assert.deepEqual(env, before);
  }));

  it('keeps external CI injection when no .env.test file exists', () => fixture((root) => {
    const env = { SETTINGS_ENCRYPTION_KEY: fileKey };
    assert.equal(loadCheckedTestEnv(join(root, '.env.test'), env), false);
    assert.deepEqual(env, { SETTINGS_ENCRYPTION_KEY: fileKey });
  }));

  it('does not convert an unreadable file into the missing-file CI path', () => fixture((root) => {
    const env = { SETTINGS_ENCRYPTION_KEY: inheritedKey };
    assert.throws(() => loadCheckedTestEnv(root, env), /Cannot read .env.test/);
    assert.deepEqual(env, { SETTINGS_ENCRYPTION_KEY: inheritedKey });
  }));

  it('uses Node env syntax for export, quotes, comments and multiline values', () => fixture((root) => {
    write(root, '.env.test', 'export AUTH_SECRET="a # literal" # outside\nMULTILINE="first\nsecond"\n');
    const env: NodeJS.ProcessEnv = { AUTH_SECRET: 'a # literal' };
    assert.equal(loadCheckedTestEnv(join(root, '.env.test'), env), true);
    assert.equal(env.MULTILINE, 'first\nsecond');
  }));

  it('reproduces native loadEnvFile retaining the inherited wrong key', () => fixture((root) => {
    write(root, '.env.test', `SETTINGS_ENCRYPTION_KEY=${fileKey}\n`);
    const result = child(root, `process.loadEnvFile('.env.test'); if (process.env.SETTINGS_ENCRYPTION_KEY !== '${inheritedKey}') process.exit(1); console.log('INHERITED_WINS');`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /INHERITED_WINS/);
  }));

  it('actual integration setup rejects mismatch before reset or server startup', () => fixture((root) => {
    entryFixture(root);
    const result = child(root, setupEntry);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TEST_ENV_CONFLICT/);
    assert.equal(existsSync(join(root, 'reset-reached')), false);
    assert.equal(result.stderr.includes(inheritedKey), false);
  }));

  it('actual setup with matching keys reaches the deny-all reset boundary', () => fixture((root) => {
    entryFixture(root);
    const result = child(root, setupEntry, { SETTINGS_ENCRYPTION_KEY: fileKey });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /71/);
    assert.equal(existsSync(join(root, 'reset-reached')), true);
  }));

  it('actual reset/seed loader cannot bypass comparison when DB variables already exist', () => fixture((root) => {
    entryFixture(root);
    const result = child(root, adminEntry);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TEST_ENV_CONFLICT/);
    assert.equal(result.stdout.includes('ENV_READY'), false);
  }));

  it('actual reset/seed loader accepts matching file and inherited values', () => fixture((root) => {
    entryFixture(root);
    const result = child(root, adminEntry, { SETTINGS_ENCRYPTION_KEY: fileKey });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ENV_READY/);
  }));

  it('actual reset/seed loader preserves the file-free CI path', () => fixture((root) => {
    entryFixture(root, false);
    const result = child(root, adminEntry);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ENV_READY/);
  }));

  it('the independent Production URL lock still rejects an externally injected target', () => fixture((root) => {
    entryFixture(root, false);
    const result = child(root, adminEntry, { TEST_SUPABASE_URL: 'https://egehnijjpgijmccagxac.supabase.co' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /安全鎖/);
    assert.equal(result.stdout.includes('ENV_READY'), false);
  }));
});
