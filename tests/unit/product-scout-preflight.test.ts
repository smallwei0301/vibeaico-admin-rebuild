import { describe, expect, it } from 'vitest';
import { validateProductScoutPreflight } from '../../scripts/agents/product-scout-preflight.mjs';

const now = Date.parse('2026-10-01T01:00:00Z');
const packet = (): any => ({
  schemaVersion: 1, stage: 'PRE_SOL_TRIAGE', workstream: 'PRODUCT_MAINLINE', runId: 'fixture-run',
  scope: ['src/app/api/auth/tenant/register/route.ts'], startedAt: '2026-10-01T00:30:00Z',
  transitionRequestedAt: '2026-10-01T00:40:00Z', triageActor: 'sol-triage',
  catalog: { provider: 'OPENAI', models: ['gpt-6-luna', 'gpt-6.1-sol'], observedAt: '2026-10-01T00:30:01Z', evidenceRef: 'fixture:catalog' },
  scout: { actor: 'scout-session', evidenceRef: 'fixture:scout', startedAt: '2026-10-01T00:31:00Z', completedAt: '2026-10-01T00:32:00Z',
    requestedModelId: 'gpt-6-luna', servedVerified: false,
    task: { id: 'scout-task', requestedModel: 'luna', actualModel: 'unknown', actualModelId: 'unknown', count: 1, accepted: true, role: 'narrow auth scope inventory', contextClass: 'compact' },
    output: [{ id: 'candidate-1', scope: ['src/app/api/auth/tenant/register/route.ts'], summary: 'Observed registration scope; no new ownership claim' }] },
  aggregator: { actor: 'aggregator-session', evidenceRef: 'fixture:aggregate', startedAt: '2026-10-01T00:33:00Z', completedAt: '2026-10-01T00:34:00Z',
    sourceOutputIds: ['candidate-1'], scope: ['src/app/api/auth/tenant/register/route.ts'], summary: 'One deduplicated candidate for triage' },
});
const check = (p: any, options = {}) => validateProductScoutPreflight(p, { now, ...options });

describe('prospective Product scout and Aggregator local preflight', () => {
  it('accepts truthful unknown actual without promoting served verification', () => {
    expect(check(packet())).toEqual({ status: 'PASS', errors: [] });
  });
  it('exempts pure governance without importing Product startup tasks', () => {
    expect(check({ workstream: 'MODEL_GOVERNANCE', scope: ['docs/AGENT-EXECUTION.md'] })).toEqual({ status: 'NOT_REQUIRED', errors: [] });
  });
  it('rejects Product scope falsely declaring governance or missing scope', () => {
    expect(check({ workstream: 'MODEL_GOVERNANCE', scope: packet().scope }).status).toBe('FAIL');
    expect(check({ workstream: 'MODEL_GOVERNANCE' }).status).toBe('FAIL');
  });
  it.each([{}, null, 'bad'])('rejects malformed catalog models %j without throwing', models => {
    const p = packet(); p.catalog.models = models;
    expect(check(p).status).toBe('FAIL');
  });
  it('rejects missing scout even with a completed Aggregator', () => {
    const p = packet(); delete p.scout;
    expect(check(p).status).toBe('FAIL');
  });
  it.each(['implicit-model', 'wrong-model', 'missing-catalog', 'other-provider-model'])('rejects %s selection', kind => {
    const p = packet();
    if (kind === 'implicit-model') delete p.scout.requestedModelId;
    if (kind === 'wrong-model') p.scout.requestedModelId = 'gpt-6.1-sol';
    if (kind === 'missing-catalog') p.catalog.models = [];
    if (kind === 'other-provider-model') p.scout.requestedModelId = 'claude-haiku-4-5';
    expect(check(p).status).toBe('FAIL');
  });
  it('retains the Anthropic provider-local scout mapping', () => {
    const p = packet(); p.catalog.provider = 'ANTHROPIC'; p.catalog.models = ['claude-haiku-4-5']; p.scout.requestedModelId = 'claude-haiku-4-5';
    expect(check(p).status).toBe('PASS');
  });
  it.each(['before-scout', 'after-triage', 'same-actor', 'missing-receipt'])('rejects %s Aggregator receipt', kind => {
    const p = packet();
    if (kind === 'before-scout') p.aggregator.startedAt = p.startedAt;
    if (kind === 'after-triage') p.aggregator.completedAt = '2026-10-01T00:41:00Z';
    if (kind === 'same-actor') p.aggregator.actor = p.triageActor;
    if (kind === 'missing-receipt') delete p.aggregator.evidenceRef;
    expect(check(p).status).toBe('FAIL');
  });
  it.each(['empty', 'unscoped', 'outside-scope', 'unconsumed', 'placeholder', 'malformed'])('rejects %s output', kind => {
    const p = packet();
    if (kind === 'empty') p.scout.output = [];
    if (kind === 'unscoped') p.scout.output[0].scope = [];
    if (kind === 'outside-scope') p.scout.output[0].scope = ['src/unowned.ts'];
    if (kind === 'unconsumed') p.aggregator.sourceOutputIds = ['invented'];
    if (kind === 'placeholder') p.scout.output[0].summary = 'TBD';
    if (kind === 'malformed') p.scout.output = [null];
    expect(check(p).status).toBe('FAIL');
  });
  it('rejects served claims for unknown actual and missing identity receipt for named actual', () => {
    const p = packet(); p.scout.servedVerified = true;
    expect(check(p).status).toBe('FAIL');
    p.scout.task.actualModel = 'luna'; p.scout.task.actualModelId = 'gpt-6-luna';
    expect(check(p).status).toBe('FAIL');
    p.scout.identityEvidenceRef = 'fixture:runtime-observation';
    expect(check(p).status).toBe('PASS');
  });
  it('does not accept self-written reasons or authority lists inside the packet', () => {
    const p = packet(); delete p.scout;
    p.exception = { reason: 'I can do it faster', authorityRef: 'fixture:owner-decision' };
    p.approvedAuthorities = [{ type: 'OWNER', ref: p.exception.authorityRef }];
    expect(check(p).status).toBe('FAIL');
  });
  it('accepts only independently supplied explicit scoped Owner/policy exception', () => {
    const p = packet(); delete p.scout; delete p.aggregator;
    p.exception = { reason: 'Owner approved a bounded recovery', authorityRef: 'fixture:owner-decision' };
    const authority = { type: 'OWNER', ref: p.exception.authorityRef, runId: p.runId, scope: p.scope, permission: 'SCOUT_BYPASS', quote: 'Allow scout bypass for this run and scope', approvedAt: '2026-10-01T00:35:00Z' };
    expect(check(p, { approvedAuthorities: [authority] }).status).toBe('PASS_WITH_AUTHORIZED_EXCEPTION');
    for (const patch of [{ type: 'AGENT' }, { runId: 'other-run' }, { scope: ['src/other.ts'] }, { permission: 'REVIEW' }]) {
      expect(check(p, { approvedAuthorities: [{ ...authority, ...patch }] }).status).toBe('FAIL');
    }
  });
  it.each([undefined, '', ' ', 'unknown', 'TBD', 'none', 'n/a'])('rejects absent or placeholder authority refs %j on both sides', ref => {
    const p = packet(); delete p.scout; delete p.aggregator;
    p.exception = { reason: 'Owner approved bounded recovery', authorityRef: ref };
    const authority = { type: 'OWNER', ref, runId: p.runId, scope: p.scope, permission: 'SCOUT_BYPASS', quote: 'Allow scoped bypass', approvedAt: '2026-10-01T00:35:00Z' };
    expect(check(p, { approvedAuthorities: [authority] }).status).toBe('FAIL');
    expect(check({ ...p, exception: { ...p.exception, authorityRef: 'fixture:owner' } }, { approvedAuthorities: [authority] }).status).toBe('FAIL');
    expect(check(p, { approvedAuthorities: [{ ...authority, ref: 'fixture:owner' }] }).status).toBe('FAIL');
  });
  it('rejects replayed catalogs, future triage and invalid workstreams instead of touching historical Run schemas', () => {
    const mutations: Array<(p: any) => void> = [p => { p.catalog.observedAt = '2026-09-30T00:00:00Z'; }, p => { p.transitionRequestedAt = '2026-10-02T00:00:00Z'; }, p => { p.workstream = 'invented'; }];
    for (const mutate of mutations) {
      const p = packet(); mutate(p); expect(check(p).status).toBe('FAIL');
    }
  });
});
