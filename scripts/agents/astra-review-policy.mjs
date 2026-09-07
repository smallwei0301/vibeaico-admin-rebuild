import { readFileSync } from 'node:fs';
import { readField } from './agent-wip-policy.mjs';

export const routing = JSON.parse(readFileSync(new URL('./model-routing.json', import.meta.url), 'utf8'));
const SHA = /^[a-f0-9]{40}$/;
const meaningful = (s) => typeof s === 'string' && s.trim().length >= 8 && !/^(unknown|pending|none|n\/a|tbd)$/i.test(s.trim());
const fields = ['repository', 'baseSha', 'headSha', 'policyVersion', 'testBaseline', 'schemaBaseline'];

/** @param {{body?: string, changedFiles?: string[] | null}} [input] */
export function classifyAstra({ body = '', changedFiles = null } = {}, policy = routing) {
  const risks = readField(body, 'ASTRA_RISK').split(',').map(s => s.trim()).filter(Boolean);
  const errors = [];
  if (!risks.length || risks.some(r => r !== 'NONE' && !policy.highRisk.includes(r)) || (risks.includes('NONE') && risks.length > 1)) {
    errors.push('ASTRA_RISK must be NONE or a comma-separated list of configured risks');
  }
  if (!meaningful(readField(body, 'ASTRA_RATIONALE'))) errors.push('ASTRA_RATIONALE requires a concrete risk assessment');
  if (!Array.isArray(changedFiles) || !changedFiles.length) errors.push('Astra classification requires actual changed files');
  const sensitive = (changedFiles ?? []).some(path => policy.sensitivePaths.some(prefix => path.startsWith(prefix)));
  return { required: sensitive || risks.some(r => policy.highRisk.includes(r)), risks, errors };
}

// Only trusted GitHub review records supplied by the caller may become attestations.
// The author attests model identity; this is not provider-signed model telemetry.
/** @param {Array<Record<string, any>>} [reviews] */
export function parseAstraReviews(reviews = []) {
  return reviews.filter(r => r.trusted === true).flatMap(r => {
    const body = String(r.body ?? '');
    if (!body.includes('astra-review') && !['CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) return [];
    const record = { reviewState: r.state, commitId: r.commit_id, submittedAt: r.submitted_at, reviewId: r.id };
    const match = body.match(/```astra-review\s*\n([\s\S]*?)\n```/);
    try {
      if (!match) throw new Error('Malformed attestation');
      return [{ ...JSON.parse(match[1]), ...record }];
    } catch { return [{ ...record, parseError: true }]; }
  }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)) || Number(b.reviewId) - Number(a.reviewId));
}

/** @param {{body?: string, changedFiles?: string[] | null, context?: Record<string, string>, reviews?: Array<Record<string, any>>}} [input] */
export function evaluateAstra({ body = '', changedFiles = null, context = {}, reviews = [] } = {}, policy = routing) {
  const classification = classifyAstra({ body, changedFiles }, policy);
  if (classification.errors.length) return { ...classification, status: 'ASTRA_PENDING' };
  if (!classification.required) return { ...classification, status: 'NOT_REQUIRED' };
  const errors = [];
  if (!/^[\w.-]+\/[\w.-]+$/.test(context.repository ?? '')) errors.push('Missing repository identity');
  for (const key of ['baseSha', 'headSha']) if (!SHA.test(context[key] ?? '')) errors.push(`Missing exact ${key}`);
  if (context.policyVersion !== policy.version) errors.push('Trusted policy version mismatch');
  for (const key of ['testBaseline', 'schemaBaseline']) if (!meaningful(context[key])) errors.push(`Missing concrete ${key}`);
  // A newer negative/dismissed/invalid attestation for the candidate supersedes an older pass.
  const latest = parseAstraReviews(reviews).find(r => r.commitId === context.headSha);
  if (!latest) errors.push('No trusted Astra attestation for this head');
  else {
    for (const key of fields) if (latest[key] !== context[key]) errors.push(`Astra evidence is stale: ${key}`);
    if (latest.commitId !== context.headSha) errors.push('GitHub review commit differs from candidate');
    if (!['COMMENTED', 'APPROVED'].includes(latest.reviewState)) errors.push('Astra review is dismissed or requests changes');
    if (latest.verdict !== 'PASS') errors.push('Astra verdict is not PASS');
    if (latest.requestedModel !== policy.models.finalRisk || latest.actualModel !== policy.models.finalRisk) errors.push('Astra model identity is unverified');
    if (latest.identityEvidence !== 'OPERATOR_ATTESTED') errors.push('Missing explicit operator model attestation');
    if (!meaningful(latest.report) || !/^https:\/\/github\.com\//.test(latest.report)) errors.push('Missing durable review report URL');
    if (!meaningful(latest.findings)) errors.push('Missing Astra findings');
  }
  return { ...classification, errors, status: errors.length ? 'ASTRA_PENDING' : 'ASTRA_APPROVED' };
}

// REST calls are read-only. Never load policy/code from a PR or execute evidence content.
export async function evaluateGithubAstra({ github, owner, repo, current }, policy = routing) {
  const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: current.number, per_page: 100 });
  if (files.length !== current.changed_files) throw new Error('Incomplete changed-file inventory');
  const changedFiles = [...new Set(files.flatMap(f => [f.filename, f.previous_filename].filter(Boolean)))];
  const body = current.body ?? '';
  const classification = classifyAstra({ body, changedFiles }, policy);
  const reviews = [];
  if (classification.required && !classification.errors.length) {
    const records = await github.paginate(github.rest.pulls.listReviews, { owner, repo, pull_number: current.number, per_page: 100 });
    const permissions = new Map();
    for (const review of records.filter(r => r.body?.includes('astra-review') || ['CHANGES_REQUESTED', 'DISMISSED'].includes(r.state))) {
      const login = review.user?.login;
      if (!login) continue;
      if (!permissions.has(login)) {
        const response = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });
        permissions.set(login, ['admin', 'maintain', 'write'].includes(response.data.permission));
      }
      reviews.push({ ...review, trusted: permissions.get(login) });
    }
  }
  return evaluateAstra({ body, changedFiles, reviews, context: {
    repository: `${owner}/${repo}`, baseSha: current.base.sha, headSha: current.head.sha,
    policyVersion: policy.version, testBaseline: readField(body, 'ASTRA_TEST_BASELINE'),
    schemaBaseline: readField(body, 'ASTRA_SCHEMA_BASELINE'),
  } }, policy);
}
