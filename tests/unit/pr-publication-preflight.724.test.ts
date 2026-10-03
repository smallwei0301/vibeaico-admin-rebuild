import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { validatePublicationMetadata } from '../../scripts/agents/agent-wip-preflight.mjs';
import { materializeProfileBody } from '../../scripts/agents/pr-metadata-profile.mjs';
import {
  findMatchingPublicationReceipt,
  parsePublicationReceipt,
  publicationPolicyApplies,
  publicationContract,
  renderPublicationReceipt,
  resolvePublicationBaseWakeup,
} from '../../scripts/agents/pr-publication-receipt.mjs';
import { parse } from 'yaml';

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const files = [
  { filename: 'docs/a.md', status: 'modified', sha: '1'.repeat(40) },
  { filename: 'scripts/agents/x.mjs', previous_filename: 'scripts/agents/y.mjs', status: 'renamed', sha: '2'.repeat(40) },
];

function governanceBody() {
  const compact = [
    '<!-- pr-lifecycle',
    'issue: 724',
    'state: ACTIVE',
    'supersedes:',
    '-->',
    'PR_PROFILE: GOVERNANCE_SOURCE_ONLY',
    'WORK_ORIGIN: AGENT',
    'LANE_STATE: ACTIVE',
    'CLOSEABILITY_SCORE: 4',
    'SELECTION_REASON: GOVERNANCE',
    'REMAINING_AUTONOMOUS_STEPS: source checks -> merge -> main reread',
    'OWNER_OR_EXTERNAL_BLOCKER: none',
    'CLOSURE_SWEEP_TARGET: #724',
    'GOVERNANCE_SCOPE_EXCEPTION: none',
    'ASTRA_RATIONALE: pure governance receipt tooling; no Product runtime or provider mutation',
  ].join('\n');
  const materialized = materializeProfileBody(compact);
  if (!materialized.valid) throw new Error(materialized.errors.join('; '));
  return materialized.body;
}

describe('#724 immutable Agent PR publication preflight receipt', () => {
  it('grandfathers PRs opened before the actual policy merge despite a later live base', () => {
    const rolloutMergedAt = '2026-10-03T07:00:00Z';
    expect(publicationPolicyApplies({ origin: 'AGENT', createdAt: '2026-10-03T06:59:59Z', rolloutMergedAt })).toBe(false);
    expect(publicationPolicyApplies({ origin: 'AGENT', createdAt: rolloutMergedAt, rolloutMergedAt })).toBe(true);
    expect(publicationPolicyApplies({ origin: 'OWNER', createdAt: '2026-10-03T08:00:00Z', rolloutMergedAt })).toBe(false);
    expect(publicationPolicyApplies({ origin: 'UNKNOWN', createdAt: '2026-10-03T08:00:00Z', rolloutMergedAt })).toBe(false);
    expect(() => publicationPolicyApplies({ origin: 'AGENT', createdAt: 'invalid', rolloutMergedAt })).toThrow();
  });

  it('wakes only open Agent PRs based on main after a base push, and fails closed on unreadable inventory', async () => {
    const pr = (number: number, origin: string, base = 'main', state = 'open') => ({
      number, state, body: `WORK_ORIGIN: ${origin}`, base: { ref: base, repo: { full_name: 'owner/repo' } },
    });
    const emptyBody = { ...pr(5, 'AGENT'), body: null };
    const github = { rest: { pulls: { list: () => {} } }, paginate: async () => [pr(1, 'AGENT'), pr(2, 'OWNER'), pr(3, 'AGENT', 'release'), pr(4, 'AGENT', 'main', 'closed'), emptyBody] };
    expect(await resolvePublicationBaseWakeup({ github, owner: 'owner', repo: 'repo', baseRef: 'main' })).toEqual({ numbers: [1, 5], associationIncomplete: false });
    await expect(resolvePublicationBaseWakeup({ github: { rest: { pulls: { list: () => {} } }, paginate: async () => { throw new Error('api'); } }, owner: 'owner', repo: 'repo', baseRef: 'main' })).rejects.toThrow('PUBLICATION_BASE_WAKEUP_UNAVAILABLE');
  });

  it('binds the receipt to exact body, file inventory, base and head', () => {
    const body = governanceBody();
    const original = publicationContract({ body, files, baseSha: base, headSha: head });
    expect(publicationContract({ body, files: [...files].reverse(), baseSha: base, headSha: head })).toEqual(original);
    for (const changed of [
      publicationContract({ body: body + '\n', files, baseSha: base, headSha: head }),
      publicationContract({ body, files: [{ ...files[0], sha: '3'.repeat(40) }, files[1]], baseSha: base, headSha: head }),
      publicationContract({ body, files, baseSha: 'c'.repeat(40), headSha: head }),
      publicationContract({ body, files, baseSha: base, headSha: 'd'.repeat(40) }),
    ]) expect(changed.contractSha256).not.toBe(original.contractSha256);
  });

  it('accepts only a matching immutable github-actions receipt, never self-asserted PASS', () => {
    const contract = publicationContract({ body: governanceBody(), files, baseSha: base, headSha: head });
    const body = renderPublicationReceipt({ prNumber: 99, contract });
    expect(parsePublicationReceipt(body)).toMatchObject({ prNumber: 99, headSha: head, result: 'PASS' });
    const bot = { user: { login: 'github-actions[bot]', type: 'Bot' }, body };
    expect(findMatchingPublicationReceipt([bot], { prNumber: 99, contract })).toBe(bot);
    expect(findMatchingPublicationReceipt([{ user: { login: 'owner', type: 'User' }, body }], { prNumber: 99, contract })).toBeNull();
    expect(findMatchingPublicationReceipt([{ ...bot, body: body.replace(head, 'e'.repeat(40)) }], { prNumber: 99, contract })).toBeNull();
  });

  it('reuses the existing preflight validators for deterministic metadata', () => {
    const body = governanceBody();
    const valid = validatePublicationMetadata({ body, changedFiles: ['docs/a.md'], prNumber: 724, action: 'opened' });
    expect(valid.valid).toBe(true);
    const missingRetroactive = body.replace(/^- RETROACTIVE_TRACKING_MIGRATION: false\n/m, '');
    const invalid = validatePublicationMetadata({ body: missingRetroactive, changedFiles: ['docs/a.md'], prNumber: 724, action: 'opened' });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join('\n')).toContain('RETROACTIVE_TRACKING_MIGRATION');
  });

  it('fails Product publication metadata before active publication when binding fields are absent', () => {
    const invalid = validatePublicationMetadata({
      body: [
        '<!-- pr-lifecycle', 'issue: none', 'state: ACTIVE', '-->',
        'WORKSTREAM: PRODUCT_MAINLINE', 'WORK_ORIGIN: AGENT', 'BPLUS_MODE: true',
        'AGENT_LANE: TERRA_BUILD', 'LANE_STATE: ACTIVE', 'ACTIVE_CANDIDATE: true',
        'DELIVERY_UNIT_TYPE: SLICE', 'COUNT_IN_DELIVERY_OUTCOME: false',
        'RETROACTIVE_TRACKING_MIGRATION: false', 'TEST_PROFILE: SOURCE_ONLY',
        'FINAL_CANONICAL_REQUIRED: false', 'REQUESTED_MODEL / ACTUAL_MODEL: requested=terra; actual=unknown',
      ].join('\n'),
      changedFiles: ['src/app/x.ts'],
      prNumber: 1,
      action: 'opened',
    });
    expect(invalid.valid).toBe(false);
    const errors = invalid.errors.join('\n');
    expect(errors).toMatch(/RUN_ID|SCORECARD_PATH|issue|COUNT_IN_DELIVERY_OUTCOME/i);
  });

  it('validates AUDIT_READY SOURCE_FREEZE against the live exact head, never an empty or claimed head', () => {
    const freeze = JSON.stringify({ head, writes: 'STOPPED', at: new Date().toISOString() });
    const body = [
      'WORK_ORIGIN: AGENT', 'LANE_STATE: ACTIVE', 'AGENT_LANE: TERRA_BUILD',
      'DUAL_TERRA_PILOT: true', 'TERRA_SLOT: 1', 'COMPLETION_CLAIM: AUDIT_READY',
      `SOURCE_FREEZE: ${freeze}`,
    ].join('\n');
    const input = { body, changedFiles: ['src/app/example.ts'], prNumber: 724, action: 'opened' };
    expect(validatePublicationMetadata({ ...input, headSha: head }).errors).not.toContain('SOURCE_FREEZE does not match live exact head');
    expect(validatePublicationMetadata({ ...input, headSha: 'c'.repeat(40) }).errors).toContain('SOURCE_FREEZE does not match live exact head');
    expect(validatePublicationMetadata(input).errors).toContain('SOURCE_FREEZE does not match live exact head');
  });

  it('wires Draft staging, trusted receipt verification and base-policy grandfathering into the remote guard', () => {
    const workflow = fs.readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8');
    for (const needle of [
      'validatePublicationMetadata',
      'pr-publication-receipt.mjs',
      'current.base.sha',
      "current.draft === true",
      'PUBLICATION_PREFLIGHT_RECEIPT_REQUIRED',
      'findMatchingPublicationReceipt',
    ]) expect(workflow).toContain(needle);
    const parsed = parse(workflow);
    expect(parsed.on.push.branches).toContain('main');
    const guard = parsed.jobs.guard.steps.find((step: any) => step.with?.script).with.script;
    expect(guard).toContain('publicationPolicyApplies');
    expect(guard).toMatch(/validatePublicationMetadata\([\s\S]*?headSha: current\.head\.sha/);
    expect(guard).toContain('if (publicationApplies) metadataErrors.push(...publicationValidation.errors)');
    expect(guard).not.toMatch(/^\s*metadataErrors\.push\(\.\.\.publicationValidation\.errors\);/m);
    expect(workflow).toContain('resolvePublicationBaseWakeup');
  });
});
