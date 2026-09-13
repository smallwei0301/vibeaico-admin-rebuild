import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createCandidate, HISTORICAL_ROOT, planBootstrap } from '../../scripts/agents/schema-bootstrap-candidate.mjs';

const sql = Buffer.from('select 1;\n');
const blobSha = crypto.createHash('sha1').update(Buffer.from(`blob ${sql.length}\0`)).update(sql).digest('hex');
const canonical = () => [
  { name: '0001_base.sql', content: sql },
  { name: '0079_reconcile.sql', content: sql },
  { name: '0082_booking_addons_fields.sql', content: sql },
];
const historical = () => ({ version: 1, mode: 'LOCAL_ONLY_TRANSITIONAL',
  source: { repository: 'smallwei0301/vibeaico-admin-rebuild', head: 'a'.repeat(40) },
  files: [{ name: '0018_retired.sql', blobSha, retiredBy: '0079_reconcile.sql' },
    { name: '0020_booking_addons.sql', blobSha }],
});

function fixture(run: (root: string, destination: string, head: string) => void) {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-proof-'));
  const root = path.join(outer, 'repo');
  fs.mkdirSync(path.join(root, 'supabase/migrations'), { recursive: true });
  fs.mkdirSync(path.join(root, HISTORICAL_ROOT), { recursive: true });
  for (const file of canonical()) fs.writeFileSync(path.join(root, 'supabase/migrations', file.name), file.content);
  fs.writeFileSync(path.join(root, 'supabase/config.toml'), 'project_id = "fixture"\n[db.seed]\nenabled = false\n');
  fs.writeFileSync(path.join(root, HISTORICAL_ROOT, 'manifest.json'), JSON.stringify(historical()));
  for (const file of historical().files) fs.writeFileSync(path.join(root, HISTORICAL_ROOT, file.name), sql);
  fs.mkdirSync(path.join(root, 'supabase/local-migrations/issue-41-candidate-baseline'), { recursive: true });
  fs.writeFileSync(path.join(root, 'supabase/local-migrations/issue-41-candidate-baseline/0040_future.sql'), 'select 41;');
  fs.writeFileSync(path.join(root, '.env'), 'DO_NOT_COPY=fixture-only\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  git('init'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  try { run(root, path.join(outer, 'candidate'), git('rev-parse', 'HEAD')); }
  finally { fs.rmSync(outer, { recursive: true, force: true }); }
}

describe('schema bootstrap candidate does not launder overlay truth', () => {
  it('orders the missing historical birth before its canonical alteration and retires replaced history', () => {
    const plan = planBootstrap(canonical(), historical(), () => sql);
    assert.deepEqual(plan.files.map((file: { name: string }) => file.name),
      ['0001_base.sql', '0020_booking_addons.sql', '0079_reconcile.sql', '0082_booking_addons_fields.sql']);
    assert.deepEqual(plan.retired, [{ name: '0018_retired.sql', replacement: '0079_reconcile.sql' }]);
    assert.equal(plan.digest, planBootstrap(canonical().reverse(), historical(), () => sql).digest);
  });
  it('rejects a same-prefix collision even when names differ', () => {
    assert.throws(() => planBootstrap([...canonical(), { name: '0020_other.sql', content: sql }], historical(), () => sql), /colliding/);
  });
  it('rejects corrupt historical bytes', () => {
    assert.throws(() => planBootstrap(canonical(), historical(), () => Buffer.from('select 2;')), /blob mismatch/);
  });
  it('rejects unreviewed selectors in a historical manifest', () => {
    const manifest = historical();
    Object.assign(manifest.files[1], { sourceName: '../issue-41-candidate-baseline/0040_future.sql' });
    assert.throws(() => planBootstrap(canonical(), manifest, () => sql), /unknown historical/);
  });
  it('rejects missing canonical replacement', () => {
    const manifest = historical(); manifest.files[0].retiredBy = '0999_missing.sql';
    assert.throws(() => planBootstrap(canonical(), manifest, () => sql), /replacement/);
  });
  it('rejects arbitrary transforms', () => {
    const manifest = historical(); Object.assign(manifest.files[1], { localTransform: 'DROP_CHECKS' });
    assert.throws(() => planBootstrap(canonical(), manifest, () => sql), /unsupported transform/);
  });
  it('preserves the explicit transaction wrapper needed by historical SET LOCAL', () => {
    const manifest = historical(); Object.assign(manifest.files[1], { localTransform: 'WRAP_IN_TRANSACTION' });
    assert.equal(planBootstrap(canonical(), manifest, () => sql).files[1].content.toString(), 'begin;\nselect 1;\n\ncommit;\n');
  });
  it('creates only a disposable candidate, never copies .env or #41 SQL, and leaves source untouched', () => fixture((root, destination, head) => {
    const result = createCandidate({ root, destination, expectedHead: head, projectId: 'schema-proof-unit' });
    assert.equal(result.canonicalApproved, false);
    assert.equal(result.candidateOverlayIncluded, false);
    assert.equal(result.remoteDatabaseUsed, false);
    assert.equal(fs.existsSync(path.join(destination, '.env')), false);
    assert.equal(fs.existsSync(path.join(destination, 'supabase/local-migrations')), false);
    assert.equal(fs.existsSync(path.join(root, 'supabase/migrations/0020_booking_addons.sql')), false);
    assert.equal(fs.existsSync(path.join(destination, 'supabase/migrations/0040_future.sql')), false);
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
  }));
  it('refuses a stale source head', () => fixture((root, destination) => {
    assert.throws(() => createCandidate({ root, destination, expectedHead: 'f'.repeat(40), projectId: 'schema-proof-unit' }), /stale checkout/);
  }));
  it('refuses dirty source before writing output', () => fixture((root, destination, head) => {
    fs.appendFileSync(path.join(root, 'supabase/migrations/0001_base.sql'), '-- changed');
    assert.throws(() => createCandidate({ root, destination, expectedHead: head, projectId: 'schema-proof-unit' }), /dirty/);
    assert.equal(fs.existsSync(destination), false);
  }));
  it('refuses output within the checkout or an existing output directory', () => fixture((root, destination, head) => {
    assert.throws(() => createCandidate({ root, destination: path.join(root, 'candidate'), expectedHead: head, projectId: 'schema-proof-unit' }), /outside/);
    fs.mkdirSync(destination);
    assert.throws(() => createCandidate({ root, destination, expectedHead: head, projectId: 'schema-proof-unit' }), /outside/);
  }));
  it('refuses a symlinked schema source even when committed', () => fixture((root, destination) => {
    const file = path.join(root, 'supabase/migrations/0001_base.sql');
    fs.unlinkSync(file); fs.symlinkSync('../config.toml', file);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'symlink fixture');
    assert.throws(() => createCandidate({ root, destination, expectedHead: git('rev-parse', 'HEAD'), projectId: 'schema-proof-unit' }), /symlink/);
  }));
});
