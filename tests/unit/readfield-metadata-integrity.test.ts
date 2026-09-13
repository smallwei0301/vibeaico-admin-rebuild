import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';
import {
  AMBIGUOUS_FIELD, isPlaceholder, parseLaneMetadata, readField, validateLaneMetadata,
} from '../../scripts/agents/agent-wip-policy.mjs';
import { classifyAstra, evaluateAstra } from '../../scripts/agents/astra-review-policy.mjs';

// #347: use the actual template, including its governance example; do not replace it with a mock.
const TEMPLATE = readFileSync(resolve(process.cwd(), '.github/pull_request_template.md'), 'utf8');
const CREATED_AT = '2026-09-11T08:00:00Z';
const HONEST = [
  'WORKSTREAM: PRODUCT_MAINLINE',
  'AGENT_LANE: TERRA_BUILD',
  'ASTRA_RISK: TENANT_AUTH_BOUNDARY',
  'ASTRA_RATIONALE: A concrete assessment of the tenant authorization boundary.',
  'FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION',
].join('\n');
const GOVERNANCE = [
  'WORKSTREAM: MODEL_GOVERNANCE',
  'WORK_ORIGIN: AGENT',
  'AGENT_LANE: GOVERNANCE',
  'LANE_STATE: ACTIVE',
  'ACTIVE_CANDIDATE: false',
  'CLOSEABILITY_SCORE: 4',
  'SELECTION_REASON: OWNER_DIRECTED',
  'REMAINING_AUTONOMOUS_STEPS: source-only validation and review',
  'OWNER_OR_EXTERNAL_BLOCKER: none',
  'CLOSURE_SWEEP_TARGET: EMPTY_WITH_SCAN',
  'TEST_LANE_REQUIRED: false',
  'WHY_NOT_CLOSER_CANDIDATE: none',
  'BPLUS_MODE: false',
  'RUN_ID: none',
  'SCORECARD_PATH: none',
  'REQUESTED_MODEL / ACTUAL_MODEL: requested=not_requested; actual=unknown',
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: Pure governance parser change without Product runtime changes.',
  'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
].join('\n');
const governanceResult = (body = GOVERNANCE) => evaluateAstra({
  body, changedFiles: ['scripts/agents/agent-wip-policy.mjs'], context: { createdAt: CREATED_AT },
});
const closedContainers = {
  'three backticks': (text = '') => `\`\`\`text\n${text}\n\`\`\``,
  'three tildes': (text = '') => `~~~text\n${text}\n~~~`,
  'four backticks': (text = '') => `\`\`\`\`text\n${text}\n\`\`\`\``,
  'longer closing fence': (text = '') => `~~~~text\n${text}\n~~~~~~`,
  'HTML comment': (text = '') => `<!--\n${text}\n-->`,
  'four-space code': (text = '') => text.split('\n').map(line => `    ${line}`).join('\n'),
  'tab-indented code': (text = '') => text.split('\n').map(line => `\t${line}`).join('\n'),
  'space-tab code': (text = '') => text.split('\n').map(line => `  \t${line}`).join('\n'),
  'list-item fence': (text = '') => `- \`\`\`text\n${text}\n  \`\`\``,
  'ordered-item fence': (text = '') => `1. ~~~text\n${text}\n   ~~~`,
};

describe('readField metadata integrity — #347', () => {
  it('the original full-template regression never silently reads the example NONE', () => {
    const body = `${TEMPLATE}\n\n${HONEST}`;
    assert.notEqual(readField(body, 'ASTRA_RISK'), 'NONE');
    const result = classifyAstra({ body, changedFiles: ['src/server/tenant.ts'], createdAt: CREATED_AT });
    assert.notDeepEqual(result.risks, ['NONE']);
    assert.ok(result.errors.length > 0 || result.required);
  });

  it('a populated real template reads the Product risk, without a false block from examples', () => {
    let body = TEMPLATE;
    for (const line of HONEST.split('\n')) {
      const field = line.slice(0, line.indexOf(':'));
      body = body.replace(new RegExp(`^- ${field}:.*$`, 'm'), `- ${line}`);
    }
    assert.ok(body.includes('For MODEL_GOVERNANCE use:'));
    assert.ok(body.includes('```text\nAGENT_LANE: GOVERNANCE'));
    assert.equal(readField(body, 'AGENT_LANE'), 'TERRA_BUILD');
    assert.equal(readField(body, 'ASTRA_RISK'), 'TENANT_AUTH_BOUNDARY');
    const result = classifyAstra({ body, changedFiles: ['src/server/tenant.ts'], createdAt: CREATED_AT });
    assert.deepEqual(result.errors, []);
    assert.equal(result.required, true);
    assert.equal(result.workstream, 'PRODUCT_MAINLINE');
  });

  for (const [name, wrap] of Object.entries(closedContainers)) {
    it(`${name}: examples alone cannot grant the governance exemption`, () => {
      assert.equal(readField(wrap(GOVERNANCE), 'WORKSTREAM'), '');
      assert.equal(governanceResult(wrap(GOVERNANCE)).status, 'ASTRA_PENDING');
    });
    it(`${name}: examples do not conflict with an honest visible declaration`, () => {
      const body = `${wrap(GOVERNANCE)}\n\n${HONEST}`;
      assert.equal(readField(body, 'ASTRA_RISK'), 'TENANT_AUTH_BOUNDARY');
      const result = classifyAstra({ body, changedFiles: ['src/server/tenant.ts'], createdAt: CREATED_AT });
      assert.deepEqual(result.errors, []);
      assert.equal(result.required, true);
    });
  }

  for (const suffix of ['```text', '~~~~\n~~~', '```\n~~~', '<!-- unclosed comment']) {
    it(`unclosed container fails closed even after valid metadata: ${suffix}`, () => {
      const body = `${GOVERNANCE}\n\n${suffix}`;
      assert.ok(isPlaceholder(readField(body, 'ASTRA_RISK')));
      assert.equal(governanceResult(body).status, 'ASTRA_PENDING');
      assert.ok(validateLaneMetadata(parseLaneMetadata({ body })).length > 0);
    });
  }

  it('a shorter/mismatched fence cannot expose later apparent declarations', () => {
    for (const closing of ['```', '~~~~', '```` trailing prose']) {
      assert.equal(governanceResult(`\`\`\`\`text\n${closing}\n${GOVERNANCE}`).status, 'ASTRA_PENDING');
    }
  });

  for (const duplicate of [
    'ASTRA_RISK: NONE', 'astra_risk: NONE', '- ASTRA_RISK: NONE',
    'ASTRA_RISK: PAYMENT_CONSISTENCY', 'ASTRA_RISK:',
  ]) {
    it(`duplicate declarations fail, including equal and blank values: ${duplicate}`, () => {
      const body = `${GOVERNANCE}\n${duplicate}`;
      assert.equal(readField(body, 'ASTRA_RISK'), AMBIGUOUS_FIELD);
      assert.ok(isPlaceholder(readField(body, 'ASTRA_RISK')));
      assert.equal(governanceResult(body).status, 'ASTRA_PENDING');
    });
  }

  it('two blank declarations are still two declarations', () => {
    assert.equal(readField('ASTRA_RISK:\nASTRA_RISK:', 'ASTRA_RISK'), AMBIGUOUS_FIELD);
  });

  it('duplicate free-text rationale is rejected, not mistaken for a meaningful sentinel', () => {
    for (const body of [GOVERNANCE, HONEST]) {
      const rationale = readField(body, 'ASTRA_RATIONALE');
      for (const text of [rationale, 'Another concrete but conflicting assessment']) {
        const duplicate = `${body}\nASTRA_RATIONALE: ${text}`;
        const result = classifyAstra({ body: duplicate, changedFiles: ['src/server/tenant.ts'], createdAt: CREATED_AT });
        assert.ok(result.errors.includes('ASTRA_RATIONALE requires a concrete risk assessment'));
      }
    }
  });

  it('the canonical sentinel follows the existing lane validation failure path', () => {
    const body = `${GOVERNANCE}\nAGENT_LANE: GOVERNANCE`;
    const metadata = parseLaneMetadata({ body });
    assert.equal(metadata.lane, AMBIGUOUS_FIELD.toUpperCase());
    assert.ok(validateLaneMetadata(metadata).includes('AGENT_LANE is missing or invalid'));
  });

  it('comment masking does not join field tokens or remove another visible declaration', () => {
    assert.equal(readField('ASTRA_<!--hidden-->RISK: NONE', 'ASTRA_RISK'), '');
    assert.equal(readField('<!--\nASTRA_RISK: NONE\n-->\nASTRA_RISK: PAYMENT_CONSISTENCY', 'ASTRA_RISK'), 'PAYMENT_CONSISTENCY');
    assert.equal(readField('ASTRA_RATIONALE: Concrete <!-- hidden --> risk assessment.', 'ASTRA_RATIONALE').replace(/ +/g, ' '), 'Concrete risk assessment.');
    assert.equal(readField('<!-- first -->\n<!-- second -->\nASTRA_RISK: NONE', 'ASTRA_RISK'), 'NONE');
  });

  it('fence and comment markers inside code/comments do not leak into outer state', () => {
    for (const sample of [
      '```html\n<!-- literal unclosed comment\n```',
      '    <!-- literal indented comment',
      '<!--\n``` literal unclosed fence\n-->',
    ]) {
      assert.equal(governanceResult(`${sample}\n\n${GOVERNANCE}`).status, 'NOT_REQUIRED');
    }
  });

  it('ordinary rows, bullets, inline code, CRLF and exact escaped field names remain usable', () => {
    assert.equal(readField('   - WORK_ORIGIN: AGENT', 'WORK_ORIGIN'), 'AGENT');
    assert.equal(readField('* WORK_ORIGIN: AGENT', 'WORK_ORIGIN'), 'AGENT');
    assert.equal(readField('Example `ASTRA_RISK: NONE`\nASTRA_RISK: PAYMENT_CONSISTENCY', 'ASTRA_RISK'), 'PAYMENT_CONSISTENCY');
    assert.equal(readField('ASTRA_RISK:\nWORK_ORIGIN: AGENT', 'ASTRA_RISK'), '');
    assert.equal(readField('ASTRA_RISK: NONE\r\nWORK_ORIGIN: AGENT', 'WORK_ORIGIN'), 'AGENT');
    assert.equal(readField('A.B: exact\nAxB: not exact', 'A.B'), 'exact');
    assert.equal(readField('missing field', 'ASTRA_RISK'), '');
    assert.equal(governanceResult(GOVERNANCE.replaceAll('\n', '\r\n')).status, 'NOT_REQUIRED');
  });

  it('truthful unknown governance is nonblocking, but mixed Product scope is still rejected', () => {
    assert.equal(governanceResult().status, 'NOT_REQUIRED');
    assert.deepEqual(validateLaneMetadata(parseLaneMetadata({ body: GOVERNANCE })), []);
    const result = classifyAstra({ body: GOVERNANCE, changedFiles: ['src/server/tenant.ts'], createdAt: CREATED_AT });
    assert.ok(result.errors.some(error => error.includes('Product/non-governance')));
  });

  it('Product high risk still requires Final Risk evidence', () => {
    const result = evaluateAstra({ body: HONEST, changedFiles: ['src/server/tenant.ts'], context: { createdAt: CREATED_AT } });
    assert.equal(result.required, true);
    assert.equal(result.status, 'ASTRA_PENDING');
    assert.ok(result.errors.includes('No trusted Astra attestation for this head'));
  });

  it('all governance consumers share the canonical reader', () => {
    for (const path of [
      'scripts/agents/governance-scope-budget.mjs',
      'scripts/agents/completion-truth.mjs',
      'scripts/agents/astra-review-policy.mjs',
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      assert.doesNotMatch(source, /function readField\s*\(/, path);
      assert.match(source, /import \{[^}]*readField[^}]*\} from ["']\.\/agent-wip-policy\.mjs["']/, path);
    }
  });
});
