import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';
import {
  validateGithubSchemaStagedRelease,
  validateSchemaStagedRelease,
} from '../../scripts/agents/schema-staged-release-policy.mjs';

const sha = 'a'.repeat(40);
const activationBody = [
  'SCHEMA_RELEASE_STAGE: ACTIVATE',
  'CANONICAL_TEST_STATUS: VERIFIED_GREEN',
  'SCHEMA_READINESS_EVIDENCE_PATH: docs/schema-truth/release-evidence/widget.json',
].join('\n');
const migration = 'supabase/migrations/20260916000000_add_widget.sql';
const runtime = 'src/server/widgets.ts';
const guardedBody = [
  'MIGRATION_TOUCH: true',
  'SCHEMA_RELEASE_STAGE: PREPARE',
  'SCHEMA_ACTIVATION_GATE: DEFAULT_OFF',
  'SCHEMA_ACTIVATION_ENV: WIDGET_SCHEMA_ENABLED',
  `SCHEMA_ACTIVATION_GUARD_PATH: ${runtime}`,
  'SCHEMA_ACTIVATION_GATE_SYMBOL: isWidgetSchemaEnabled',
].join('\n');
const guard = `// schema-activation-gate: WIDGET_SCHEMA_ENABLED default-off symbol=isWidgetSchemaEnabled\nexport function isWidgetSchemaEnabled() { return process.env.WIDGET_SCHEMA_ENABLED === 'true'; }\nexport function readWidget() { if (!isWidgetSchemaEnabled()) return null; return { id: 'widget' }; }\n`;
const receiptPath = 'docs/schema-truth/release-evidence/widget.json';
const receipt = JSON.stringify({ schemaVersion: 1, preparedCommit: sha,
  canonicalTest: { workflowRunId: 123, workflowName: 'ci' },
  productionSchema: { workflowRunId: 456, workflowName: 'agent-schema-drift-watch' },
});
const errors = (input: any) => validateSchemaStagedRelease(input).join('\n');

describe('#530 schema staged-release policy', () => {
  it('allows schema-prep-only and migration plus docs/tests without inventing an activation gate', () => {
    assert.equal(errors({ body: 'MIGRATION_TOUCH: true', changedFiles: [migration] }), '');
    assert.equal(errors({ body: 'MIGRATION_TOUCH: true', changedFiles: [migration, 'docs/schema-truth/plan.md', 'tests/unit/schema.test.ts'] }), '');
  });

  it('fails closed for migration plus Product runtime unless a changed default-off guard is mechanically visible', () => {
    assert.match(errors({ body: 'MIGRATION_TOUCH: true', changedFiles: [migration, runtime] }), /SCHEMA_RELEASE_STAGE=PREPARE/);
    assert.match(errors({ body: guardedBody, changedFiles: [migration, runtime] }), /guard bytes are unavailable/);
    assert.equal(errors({ body: guardedBody, changedFiles: [migration, runtime], readFile: () => guard }), '');
  });

  it('rejects lookalike gate evidence that is default-on, undocumented, or outside the changed runtime path', () => {
    for (const mutate of [
      (content: string) => content.replace("=== 'true'", "!== 'true'"),
      (content: string) => content.replace('schema-activation-gate:', 'activation-gate:'),
    ]) {
      assert.match(errors({ body: guardedBody, changedFiles: [migration, runtime], readFile: () => mutate(guard) }), /not mechanically proven/);
    }
    assert.match(errors({
      body: guardedBody.replace(runtime, 'src/server/other.ts'), changedFiles: [migration, runtime], readFile: () => guard,
    }), /must name a changed Product runtime file/);
    const fake = `// schema-activation-gate: WIDGET_SCHEMA_ENABLED default-off symbol=isWidgetSchemaEnabled\nconst example = "process.env.WIDGET_SCHEMA_ENABLED === 'true'; if (isWidgetSchemaEnabled()) {}";`;
    assert.match(errors({ body: guardedBody, changedFiles: [migration, runtime], readFile: () => fake }), /not mechanically proven|not controlled/);
  });

  it('requires every exported runtime entry to return before dependent work when the gate is disabled', () => {
    const unguarded = guard.replace('if (!isWidgetSchemaEnabled()) return null; ', '');
    assert.match(errors({ body: guardedBody, changedFiles: [migration, runtime], readFile: () => unguarded }), /every exported runtime entry must early-return/);
  });

  it('rejects module-load database/network work outside an otherwise gated exported entry', () => {
    const topLevelQuery = `${guard}\nconst unsafe = client.from('new_schema_table');`;
    assert.match(errors({ body: guardedBody, changedFiles: [migration, runtime], readFile: () => topLevelQuery }), /top-level database or network side effect/);
  });

  it('requires a later activation to cite canonical TEST and Production schema evidence with exact identities', () => {
    assert.equal(errors({ body: activationBody, changedFiles: [runtime], readFile: (name: string) => name === receiptPath ? receipt : undefined }), '');
    assert.match(errors({ body: activationBody, changedFiles: [runtime], readFile: () => '{' }), /not valid JSON/);
    assert.match(errors({ body: activationBody, changedFiles: [runtime], readFile: () => JSON.stringify({ schemaVersion: 1 }) }), /preparedCommit SHA/);
    assert.match(errors({ body: activationBody, changedFiles: [migration, runtime] }), /must not include migration evidence/);
  });

  it('treats migration metadata as a trigger and rejects a changed migration hidden behind false metadata', () => {
    assert.match(errors({ body: 'MIGRATION_TOUCH: false', changedFiles: [migration] }), /conflicts with changed supabase\/migrations evidence/);
    assert.match(errors({ body: 'MIGRATION_TOUCH: true\nSCHEMA_RELEASE_STAGE: ACTIVATE', changedFiles: [runtime] }), /must not include migration evidence/);
  });

  it('blocks the live historical mixed-release shapes from #519, #524 and #526 without rewriting them', () => {
    const fixtures = [
      ['#519', 'supabase/migrations/0116_issue_18_owner_notify.sql', 'src/server/owner-notify.ts', 'src/app/api/settings/line/owner-notify/route.ts'],
      ['#524', 'supabase/migrations/0117_issue_25b_support_chat_threads.sql', 'src/config/env.ts', 'src/server/support-chat-threads.ts'],
      ['#526', 'supabase/migrations/0118_issue_25c_platform_donations.sql', 'src/server/donations.ts', 'src/app/api/donations/route.ts'],
    ];
    for (const [identity, migrationPath, ...runtimePaths] of fixtures) {
      assert.match(errors({ body: 'MIGRATION_TOUCH: true', changedFiles: [migrationPath, ...runtimePaths] }),
        /SCHEMA_RELEASE_STAGE=PREPARE/, `${identity} must remain a blocked mixed migration/runtime shape`);
    }
  });

  it('uses only the exact immutable remote guard blob and fails closed on unavailable evidence', async () => {
    const bytes = Buffer.from(guard);
    const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    const requested: unknown[] = [];
    const input = {
      github: { rest: { git: { getBlob: async (request: unknown) => {
        requested.push(request); return { data: { encoding: 'base64', content: bytes.toString('base64'), sha: blobSha, size: bytes.length } };
      } }, repos: { getContent: async () => ({ data: { encoding: 'base64', content: Buffer.from(receipt).toString('base64'),
        sha: createHash('sha1').update(`blob ${Buffer.byteLength(receipt)}\0`).update(receipt).digest('hex'), size: Buffer.byteLength(receipt) } }),
      compareCommits: async () => ({ data: { status: 'ahead' } }),
      actions: { getWorkflowRun: async () => ({ data: { name: 'ci', conclusion: 'success', head_sha: sha } }) } } } },
      owner: 'owner', repo: 'repo',
      current: { body: guardedBody, changed_files: 2, head: { sha } },
      changedFiles: [
        { filename: migration, status: 'added', sha: 'c'.repeat(40) },
        { filename: runtime, status: 'modified', sha: blobSha },
      ],
    };
    assert.deepEqual(await validateGithubSchemaStagedRelease(input), []);
    assert.deepEqual(requested, [{ owner: 'owner', repo: 'repo', file_sha: blobSha }]);
    input.github.rest.git.getBlob = async () => { throw new Error('unavailable'); };
    assert.match((await validateGithubSchemaStagedRelease(input)).join('\n'), /guard bytes are unavailable/);
  });

  it('live-verifies the base receipt workflow runs and rejects a wrong head or failed postcheck', async () => {
    const receiptBytes = Buffer.from(receipt);
    const receiptSha = createHash('sha1').update(`blob ${receiptBytes.length}\0`).update(receiptBytes).digest('hex');
    const calls: number[] = [];
    const input = {
      github: { paginate: async () => [{ name: 'integration', conclusion: 'success', steps: [
        { name: 'Run integration tests', conclusion: 'success' }, { name: 'Run E2E tests', conclusion: 'success' },
      ] }], rest: {
        git: { getBlob: async () => ({ data: {} }) },
        repos: {
          getContent: async () => ({ data: { encoding: 'base64', content: receiptBytes.toString('base64'), sha: receiptSha, size: receiptBytes.length } }),
          compareCommits: async () => ({ data: { status: 'ahead' } }),
        },
        actions: { getWorkflowRun: async ({ run_id }: { run_id: number }) => {
          calls.push(run_id);
          return { data: { name: run_id === 123 ? 'ci' : 'agent-schema-drift-watch', conclusion: 'success', head_sha: sha } };
        } },
      } }, owner: 'owner', repo: 'repo',
      current: { body: activationBody, changed_files: 1, head: { sha: 'd'.repeat(40) }, base: { sha: 'e'.repeat(40) } },
      changedFiles: [{ filename: runtime, status: 'modified', sha: 'd'.repeat(40) }],
    };
    assert.deepEqual(await validateGithubSchemaStagedRelease(input), []);
    assert.deepEqual(calls, [123, 456]);
    input.github.rest.actions.getWorkflowRun = async ({ run_id }: { run_id: number }) => ({
      data: { name: run_id === 123 ? 'ci' : 'agent-schema-drift-watch', conclusion: run_id === 456 ? 'failure' : 'success', head_sha: sha },
    });
    assert.match((await validateGithubSchemaStagedRelease(input)).join('\n'), /productionSchema workflow run is not a successful/);
  });

  it('recognises config/root runtime changes and a migration rename from its previous path', async () => {
    assert.match(errors({ body: 'MIGRATION_TOUCH: true', changedFiles: [migration, 'src/config/env.ts'] }), /SCHEMA_RELEASE_STAGE=PREPARE/);
    assert.match(errors({ body: 'MIGRATION_TOUCH: true', changedFiles: [migration, 'middleware.ts'] }), /SCHEMA_RELEASE_STAGE=PREPARE/);
    const input = {
      github: { rest: { git: { getBlob: async () => ({ data: {} }) } } }, owner: 'owner', repo: 'repo',
      current: { body: 'MIGRATION_TOUCH: true', changed_files: 2, head: { sha } },
      changedFiles: [
        { filename: 'docs/schema-truth/archive.sql', previous_filename: migration, status: 'renamed', sha: 'c'.repeat(40) },
        { filename: runtime, status: 'modified', sha: 'd'.repeat(40) },
      ],
    };
    assert.match((await validateGithubSchemaStagedRelease(input)).join('\n'), /SCHEMA_RELEASE_STAGE=PREPARE/);
  });

  it('wires the same helper into local preflight and the trusted required guard', () => {
    const preflight = readFileSync(path.resolve('scripts/agents/agent-wip-preflight.mjs'), 'utf8');
    const workflow = readFileSync(path.resolve('.github/workflows/agent-wip-guard.yml'), 'utf8');
    assert.match(preflight, /validateSchemaStagedRelease\(/);
    assert.match(workflow, /schema-staged-release-policy\.mjs/);
    assert.match(workflow, /validateGithubSchemaStagedRelease\(\{\s*github, owner, repo, current, changedFiles: ownFiles,?\s*\}\)/);
    assert.match(workflow, /schemaStageErrors\.length === 0/);
  });
});
