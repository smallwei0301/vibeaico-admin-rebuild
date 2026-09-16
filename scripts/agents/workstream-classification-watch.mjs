import { classifyWorkstream, routing } from './astra-review-policy.mjs';
import { boundaryPaths, validateBookkeepingWorkstream } from './governance-workstream-boundary.mjs';
import { validateIssueProvenance } from './issue-provenance-policy.mjs';

/** @type {Readonly<Record<string, string>>} */
const LABELS = Object.freeze({
  MODEL_GOVERNANCE: 'workstream:model-governance',
  PRODUCT_MAINLINE: 'workstream:product-mainline',
});
/** @param {any} item */
const workstreamLabels = item => (item.labels ?? [])
  .map(label => typeof label === 'string' ? label : label.name)
  .filter(name => String(name).startsWith('workstream:')).sort();
/** @param {any} item */
const snapshot = item => JSON.stringify([
  item.number, item.body, item.state, item.draft, item.head?.sha, item.base?.sha, workstreamLabels(item),
]);

/** Same trusted classifiers as admission; labels are consistency evidence, never authority.
 * @param {any} item @param {any[] | null} files @param {any} policy
 */
export function inspectClassification(item, files = null, policy = routing) {
  const isPr = Boolean(item.head);
  if (typeof item.created_at !== 'string' || !Number.isFinite(Date.parse(item.created_at))) {
    throw new Error('MISSING_CREATED_AT');
  }
  let result;
  if (isPr) {
    if (!Array.isArray(files) || !Number.isSafeInteger(item.changed_files) ||
        files.length !== item.changed_files ||
        new Set(files.map(file => file.filename)).size !== files.length ||
        files.some(file => typeof file.filename !== 'string' || !file.filename ||
          (file.status === 'renamed' && !file.previous_filename))) {
      throw new Error('INCOMPLETE_CHANGED_FILES');
    }
    const paths = boundaryPaths(files);
    if (paths.some(path => typeof path !== 'string' || /[\\\r\n\0]/.test(path) ||
        path.split('/').some(part => !part || part === '.' || part === '..'))) {
      throw new Error('INVALID_CHANGED_PATH');
    }
    result = classifyWorkstream({ body: item.body ?? '', changedFiles: paths, createdAt: item.created_at }, policy);
    result.errors.push(...validateBookkeepingWorkstream({ body: item.body ?? '', changedFiles: paths }));
  } else {
    const provenance = validateIssueProvenance(item.body ?? '', { requireWorkstream: true });
    result = { workstream: provenance.workstream, errors: provenance.errors.filter(error => error.startsWith('Issue WORKSTREAM')) };
  }
  // Historical unclassified PRs stay observable but are not silently reclassified or blocked.
  const legacy = isPr && result.workstream === 'LEGACY_UNCLASSIFIED' && result.errors.length === 0;
  const errors = [...result.errors];
  if (!legacy) {
    const expected = LABELS[result.workstream];
    const labels = workstreamLabels(item);
    if (!expected || labels.length !== 1 || labels[0] !== expected) errors.push('WORKSTREAM_BODY_LABEL_MISMATCH');
  }
  return {
    number: item.number, kind: isPr ? 'PR' : 'ISSUE',
    workstream: Object.hasOwn(LABELS, result.workstream) || legacy ? result.workstream : 'INVALID',
    status: legacy ? 'LEGACY_GRANDFATHERED' : errors.length ? 'FAIL' : 'PASS',
    contentEvidence: isPr && files.length === 0 ? 'CONFIRMED_ZERO_CONTENT' : 'CONTENT_PRESENT',
    errors: [...new Set(errors)],
  };
}

/** Read-only daily/manual observation. Never writes labels, bodies, statuses, or external state.
 * @param {{github: any, owner: string, repo: string, now?: Date, policySha: string, maxPages?: number}} input
 */
export async function observeClassifications({ github, owner, repo, now = new Date(), policySha, maxPages = 20 }) {
  if (!/^[a-f0-9]{40}$/.test(policySha) || !Number.isFinite(now.getTime()) ||
      !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 20) throw new Error('INVALID_OBSERVATION_INPUT');
  const cutoff = now.getTime() - 72 * 60 * 60 * 1000;
  /** @type {{status: string, observedAt: string, policySha: string, recentClosedHours: number,
   * counts: {issues: number | null, pullRequests: number | null, checked: number, legacy: number},
   * findings: any[], unavailable: any[]}} */
  const report = {
    status: 'EVIDENCE_UNAVAILABLE', observedAt: now.toISOString(), policySha, recentClosedHours: 72,
    counts: { issues: null, pullRequests: null, checked: 0, legacy: 0 }, findings: [], unavailable: [],
  };
  const get = async (resource, params = {}) => (await github.request(
    `GET /repos/{owner}/{repo}/${resource}`, { owner, repo, ...params },
  )).data;
  const pages = async (resource, params, recent = false) => {
    /** @type {any[]} */
    const rows = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const data = await get(resource, { ...params, per_page: 100, page });
      if (!Array.isArray(data)) throw new Error('INVALID_INVENTORY');
      if (recent && data.some(row => !Number.isFinite(Date.parse(row.updated_at)))) throw new Error('MISSING_UPDATED_AT');
      rows.push(...(recent ? data.filter(row => Date.parse(row.updated_at) >= cutoff) : data));
      if (data.length < 100 || (recent && data.every(row => Date.parse(row.updated_at) < cutoff))) return rows;
    }
    throw new Error('INVENTORY_TRUNCATED');
  };
  const inventory = async (resource, params, recent = false) => {
    try { return await pages(resource, params, recent); }
    catch { report.unavailable.push({ resource, reason: 'INVENTORY_UNAVAILABLE_OR_TRUNCATED' }); return null; }
  };
  // Issues endpoint includes open PRs. Closed PRs are independently paginated, not search-index snapshots.
  const open = await inventory('issues', { state: 'open', sort: 'updated', direction: 'desc' });
  const closed = await inventory('pulls', { state: 'closed', sort: 'updated', direction: 'desc' }, true);
  const issueRows = open?.filter(row => !row.pull_request) ?? [];
  const prRows = [...(open?.filter(row => row.pull_request) ?? []), ...(closed ?? [])];
  report.counts.issues = open === null ? null : issueRows.length;
  report.counts.pullRequests = open === null || closed === null ? null : prRows.length;
  const seen = new Set();
  for (const row of [...issueRows, ...prRows]) {
    const isPr = Boolean(row.pull_request || row.head);
    const number = row.number;
    const kind = isPr ? 'PR' : 'ISSUE';
    if (!Number.isSafeInteger(number) || number < 1 || seen.has(number)) {
      report.unavailable.push({ reason: 'INVALID_OR_CHANGING_INVENTORY' });
      continue;
    }
    seen.add(number);
    try {
      const resource = isPr ? `pulls/${number}` : `issues/${number}`;
      const current = await get(resource);
      if (current.number !== number || !['open', 'closed'].includes(current.state) ||
          !Array.isArray(current.labels) || (isPr && (!current.head?.sha || !current.base?.sha))) {
        throw new Error('INCOMPLETE_ITEM');
      }
      const files = isPr ? await pages(`pulls/${number}/files`, {}) : null;
      const result = inspectClassification(current, files);
      const fresh = await get(resource);
      if (snapshot(fresh) !== snapshot(current)) throw new Error('ITEM_CHANGED_DURING_READ');
      report.counts.checked += 1;
      if (result.status === 'LEGACY_GRANDFATHERED') report.counts.legacy += 1;
      if (result.errors.length) report.findings.push(result);
    } catch {
      // No raw provider errors or Issue bodies in evidence: they may contain credentials or private text.
      report.unavailable.push({ number, kind, reason: 'EVIDENCE_UNAVAILABLE_INCOMPLETE_OR_CHANGED' });
    }
  }
  report.status = report.unavailable.length ? 'EVIDENCE_UNAVAILABLE'
    : report.findings.length ? 'DRIFT_DETECTED' : 'PASS';
  return report;
}
