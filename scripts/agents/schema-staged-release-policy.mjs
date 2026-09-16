import { createHash } from 'node:crypto';
import { readField } from './agent-wip-policy.mjs';

const failure = (reason) => `SCHEMA_STAGED_RELEASE_REJECTED: ${reason}`;
const upper = (value) => String(value ?? '').trim().toUpperCase();
const migrationPath = (name) => /^supabase\/migrations\/[^/]+/.test(name);
const runtimePath = (name) => (/^(?:middleware\.[cm]?[jt]s|next\.config\.[cm]?[jt]s)$/.test(name)
  || /^src\/(?:app|components|config|features|lib|pages|server|services)\//.test(name))
  && !/(?:^|\/)__(?:tests|mocks)__(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name);
const normalPath = (name) => typeof name === 'string' && name.length > 0
  && !name.includes('\\') && !name.includes('\0') && !name.startsWith('/') && !name.split('/').includes('..');
const readinessPath = (name) => /^docs\/schema-truth\/release-evidence\/[^/]+\.json$/.test(name);

// Preserve offsets while blanking prose. A textual gate in an example, comment,
// or string literal is not executable evidence.
function executableSource(content) {
  const source = String(content ?? '');
  const output = source.split('');
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    if (quote) {
      if (source[index] === '\\') { output[index] = ' '; if (index + 1 < source.length) output[++index] = ' '; continue; }
      if (source[index] === quote) { quote = null; continue; }
      output[index] = source[index] === '\n' ? '\n' : ' ';
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      output[index++] = ' '; output[index] = ' ';
      while (index + 1 < source.length && source[index + 1] !== '\n') output[++index] = ' ';
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      output[index++] = ' '; output[index] = ' ';
      while (index + 1 < source.length && !(source[index + 1] === '*' && source[index + 2] === '/')) {
        output[++index] = source[index] === '\n' ? '\n' : ' ';
      }
      if (index + 2 < source.length) { output[++index] = ' '; output[++index] = ' '; }
      continue;
    }
    if (['\'', '"', '`'].includes(source[index])) quote = source[index];
  }
  return output.join('');
}

function defaultOffExpression(content, executable, env) {
  const dot = `process\\.env\\.${env}\\s*===\\s*(['\"])true\\1`;
  const bracket = `process\\.env\\[\\s*(['\"])${env}\\1\\s*\\]\\s*===\\s*(['\"])true\\2`;
  const expression = new RegExp(`(?:${dot})|(?:${bracket})`, 'g');
  return [...content.matchAll(expression)].some((match) => executable[match.index] === 'p');
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return index;
  }
  return -1;
}

// A changed runtime entry can only pass PREPARE when its first executable branch
// returns/throws on a disabled gate. This makes the remainder of every exported
// request/UI entry unreachable by default, rather than accepting a stray `if`.
function guardedRuntimeEntries(content, symbol) {
  const source = executableSource(content);
  const expressions = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g,
    /\bexport\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g,
  ];
  const entries = [];
  for (const expression of expressions) {
    for (const match of source.matchAll(expression)) {
      const open = match.index + match[0].length - 1;
      const close = matchingBrace(source, open);
      if (close < 0) return { valid: false, reason: 'changed runtime has an unclosed exported entry body' };
      entries.push({ name: match[1] ?? 'default', start: match.index, close, body: source.slice(open + 1, close) });
    }
  }
  const protectedEntries = entries.filter((entry) => entry.name !== symbol);
  if (!protectedEntries.length) return { valid: false, reason: 'changed runtime has no exported entry controlled by the default-off gate' };
  const earlyReturn = new RegExp(`^\\s*if\\s*\\(\\s*!\\s*${symbol}\\s*\\([^)]*\\)\\s*\\)\\s*(?:\\{\\s*)?(?:return|throw)\\b`);
  if (!protectedEntries.every((entry) => earlyReturn.test(entry.body))) {
    return { valid: false, reason: `every exported runtime entry must early-return or throw when ${symbol} is disabled` };
  }
  // The contract also bans database/network work while a module loads. Masking
  // exported bodies lets us inspect only real top-level effects, not comments,
  // strings, or the already-guarded entries.
  const topLevel = source.split('');
  for (const entry of entries) {
    for (let index = entry.start; index <= entry.close; index += 1) {
      if (topLevel[index] !== '\n') topLevel[index] = ' ';
    }
  }
  if (/\bawait\b|\bfetch\s*\(|\.(?:from|rpc)\s*\(|\bcreate(?:Admin)?Supabase\s*\(/.test(topLevel.join(''))) {
    return { valid: false, reason: 'changed runtime has a top-level database or network side effect outside the default-off gate' };
  }
  return { valid: true };
}

function readinessReceipt(content) {
  if (typeof content !== 'string') return 'schema readiness receipt bytes are unavailable';
  let receipt;
  try { receipt = JSON.parse(content); } catch { return 'schema readiness receipt is not valid JSON'; }
  if (receipt?.schemaVersion !== 1) return 'schema readiness receipt requires schemaVersion=1';
  if (!/^[a-f0-9]{40}$/.test(receipt?.preparedCommit ?? '')) return 'schema readiness receipt requires preparedCommit SHA';
  if (!Number.isSafeInteger(receipt?.canonicalTest?.workflowRunId) || receipt.canonicalTest.workflowRunId <= 0
    || receipt?.canonicalTest?.workflowName !== 'ci') {
    return 'schema readiness receipt requires canonical TEST ci workflow run identity';
  }
  if (!Number.isSafeInteger(receipt?.productionSchema?.workflowRunId) || receipt.productionSchema.workflowRunId <= 0
    || receipt?.productionSchema?.workflowName !== 'agent-schema-drift-watch') {
    return 'schema readiness receipt requires Production schema read-only postcheck workflow run identity';
  }
  return null;
}

/**
 * #530's policy is deliberately small: the file inventory is the trigger, and
 * a same-PR migration/runtime change must prove every changed runtime path is
 * controlled by one default-off gate. The same pure function is used before push and from trusted main in
 * the required GitHub guard; neither entrypoint executes PR code.
 */
export function validateSchemaStagedRelease({ body = '', changedFiles = [], readFile = () => undefined } = {}) {
  if (!Array.isArray(changedFiles) || changedFiles.some((name) => !normalPath(name))) {
    return [failure('complete canonical changed-file paths are required')];
  }
  const paths = [...new Set(changedFiles)];
  const migrations = paths.filter(migrationPath);
  const runtimes = paths.filter(runtimePath);
  const declaredMigration = upper(readField(body, 'MIGRATION_TOUCH'));
  const stage = upper(readField(body, 'SCHEMA_RELEASE_STAGE'));
  const errors = [];

  if (declaredMigration && !['TRUE', 'FALSE'].includes(declaredMigration)) {
    errors.push(failure('MIGRATION_TOUCH must be true or false when declared'));
  }
  if (migrations.length && declaredMigration === 'FALSE') {
    errors.push(failure('MIGRATION_TOUCH=false conflicts with changed supabase/migrations evidence'));
  }
  if (stage && !['PREPARE', 'ACTIVATE'].includes(stage)) {
    errors.push(failure('SCHEMA_RELEASE_STAGE must be PREPARE or ACTIVATE when declared'));
  }

  const migrationTouched = migrations.length > 0 || declaredMigration === 'TRUE';
  if (migrationTouched && runtimes.length) {
    if (stage !== 'PREPARE') {
      errors.push(failure('migration plus Product runtime requires SCHEMA_RELEASE_STAGE=PREPARE'));
    }
    const gate = upper(readField(body, 'SCHEMA_ACTIVATION_GATE'));
    const env = String(readField(body, 'SCHEMA_ACTIVATION_ENV') ?? '').trim();
    const guardPath = String(readField(body, 'SCHEMA_ACTIVATION_GUARD_PATH') ?? '').trim();
    const symbol = String(readField(body, 'SCHEMA_ACTIVATION_GATE_SYMBOL') ?? '').trim();
    if (gate !== 'DEFAULT_OFF') errors.push(failure('migration plus Product runtime requires SCHEMA_ACTIVATION_GATE=DEFAULT_OFF'));
    if (!/^[A-Z][A-Z0-9_]*$/.test(env)) errors.push(failure('SCHEMA_ACTIVATION_ENV must be an uppercase environment variable name'));
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(symbol)) errors.push(failure('SCHEMA_ACTIVATION_GATE_SYMBOL must be a JavaScript identifier'));
    if (!runtimes.includes(guardPath)) {
      errors.push(failure('SCHEMA_ACTIVATION_GUARD_PATH must name a changed Product runtime file'));
    } else {
      let content;
      try { content = readFile(guardPath); } catch { content = undefined; }
      if (typeof content !== 'string') {
        errors.push(failure(`default-off guard bytes are unavailable: ${guardPath}`));
      } else {
        const marker = new RegExp(`schema-activation-gate:\\s*${env}\\s+default-off\\s+symbol=${symbol}`, 'i');
        const executable = executableSource(content);
        const definition = new RegExp(`(?:function|const)\\s+${symbol}\\b`);
        if (!marker.test(content) || !definition.test(executable) || !defaultOffExpression(content, executable, env)) {
          errors.push(failure(`default-off guard is not mechanically proven in ${guardPath}`));
        }
      }
    }
    for (const runtimePath of runtimes) {
      let content;
      try { content = readFile(runtimePath); } catch { content = undefined; }
      if (typeof content !== 'string') {
        errors.push(failure(`runtime gate bytes are unavailable: ${runtimePath}`));
      } else {
        const controlled = guardedRuntimeEntries(content, symbol);
        if (!controlled.valid) errors.push(failure(`${controlled.reason}: ${runtimePath}`));
      }
    }
  }

  if (stage === 'PREPARE' && !migrationTouched) {
    errors.push(failure('SCHEMA_RELEASE_STAGE=PREPARE requires migration evidence'));
  }
  if (stage === 'ACTIVATE') {
    if (migrationTouched) errors.push(failure('SCHEMA_RELEASE_STAGE=ACTIVATE must not include migration evidence'));
    if (!runtimes.length) errors.push(failure('SCHEMA_RELEASE_STAGE=ACTIVATE requires changed Product runtime/API/UI evidence'));
    const receiptPath = String(readField(body, 'SCHEMA_READINESS_EVIDENCE_PATH') ?? '').trim();
    if (!readinessPath(receiptPath)) errors.push(failure('activation requires SCHEMA_READINESS_EVIDENCE_PATH under docs/schema-truth/release-evidence'));
    else if (paths.includes(receiptPath)) errors.push(failure('activation must cite readiness evidence already present on main, not change it'));
    else {
      let content;
      try { content = readFile(receiptPath); } catch { content = undefined; }
      const receiptError = readinessReceipt(content);
      if (receiptError) errors.push(failure(receiptError));
    }
  }
  return [...new Set(errors)];
}

function blobText(data, expectedSha) {
  if (data?.encoding !== 'base64' || typeof data.content !== 'string' || data.sha !== expectedSha) return null;
  const bytes = Buffer.from(data.content, 'base64');
  const digest = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (digest !== expectedSha || data.size !== bytes.length) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

/** Trusted-main wrapper: reads only an immutable blob in the complete PR diff. */
export async function validateGithubSchemaStagedRelease({ github, owner, repo, current, changedFiles } = {}) {
  if (!Array.isArray(changedFiles) || !Number.isInteger(current?.changed_files)
    || changedFiles.length !== current.changed_files || changedFiles.some((file) => !normalPath(file?.filename))
    || new Set(changedFiles.map((file) => file.filename)).size !== changedFiles.length
    || !/^[a-f0-9]{40}$/.test(current?.head?.sha ?? '')) {
    return [failure('complete exact-head changed-file inventory required')];
  }
  const body = current.body ?? '';
  const guardPath = String(readField(body, 'SCHEMA_ACTIVATION_GUARD_PATH') ?? '').trim();
  const paths = [...new Set(changedFiles.flatMap((file) => [file.filename, file.previous_filename].filter(normalPath)))];
  const runtimePaths = paths.filter(runtimePath);
  const contents = new Map();
  for (const file of changedFiles.filter((candidate) => runtimePaths.includes(candidate.filename))) {
    if (!['added', 'modified', 'renamed'].includes(file.status) || !/^[a-f0-9]{40}$/.test(file.sha ?? '')) continue;
    try {
      const { data } = await github.rest.git.getBlob({ owner, repo, file_sha: file.sha });
      const content = blobText(data, file.sha);
      if (content !== null) contents.set(file.filename, content);
    } catch { /* The shared function fails closed when the required bytes are absent. */ }
  }
  const receiptPath = String(readField(body, 'SCHEMA_READINESS_EVIDENCE_PATH') ?? '').trim();
  if (readinessPath(receiptPath) && !paths.includes(receiptPath)) {
    try {
      const { data } = await github.rest.repos.getContent({ owner, repo, path: receiptPath, ref: current.base.sha });
      const content = Array.isArray(data) ? null : blobText(data, data?.sha);
      if (content !== null) contents.set(receiptPath, content);
    } catch { /* The shared function fails closed when the immutable base receipt is unavailable. */ }
  }
  const errors = validateSchemaStagedRelease({
    body,
    changedFiles: paths,
    readFile: (name) => contents.get(name),
  });
  // A receipt is only useful when its prepared commit is actually in the base history,
  // and the two named workflow runs really succeeded for that exact source.
  const receipt = contents.get(receiptPath);
  let preparedCommit = '';
  try { preparedCommit = JSON.parse(receipt).preparedCommit ?? ''; } catch { /* format error already reported */ }
  if (!errors.length && /^[a-f0-9]{40}$/.test(preparedCommit)) {
    try {
      const { data } = await github.rest.repos.compareCommits({ owner, repo, base: preparedCommit, head: current.base.sha });
      if (!['ahead', 'identical'].includes(data?.status)) errors.push(failure('readiness receipt preparedCommit is not in current base history'));
    } catch { errors.push(failure('readiness receipt preparedCommit ancestry could not be verified')); }
    let parsed;
    try { parsed = JSON.parse(receipt); } catch { parsed = null; }
    for (const [kind, expectedName] of [['canonicalTest', 'ci'], ['productionSchema', 'agent-schema-drift-watch']]) {
      const runId = parsed?.[kind]?.workflowRunId;
      try {
        const { data } = await github.rest.actions.getWorkflowRun({ owner, repo, run_id: runId });
        if (data?.name !== expectedName || data?.conclusion !== 'success' || data?.head_sha !== preparedCommit) {
          errors.push(failure(`${kind} workflow run is not a successful ${expectedName} run for preparedCommit`));
        } else if (kind === 'canonicalTest') {
          const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
            owner, repo, run_id: runId, filter: 'latest', per_page: 100,
          });
          const integration = jobs.find((job) => job?.name === 'integration');
          const steps = new Map((integration?.steps ?? []).map((step) => [step.name, step.conclusion]));
          if (integration?.conclusion !== 'success'
            || steps.get('Run integration tests') !== 'success'
            || steps.get('Run E2E tests') !== 'success') {
            errors.push(failure('canonicalTest workflow did not execute successful integration and E2E steps'));
          }
        }
      } catch { errors.push(failure(`${kind} workflow run could not be live-verified`)); }
    }
  }
  return [...new Set(errors)];
}
