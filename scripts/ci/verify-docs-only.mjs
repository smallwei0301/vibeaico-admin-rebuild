#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const DOCS_ONLY_PATHS = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md']);

function isDocsPath(path) {
  return typeof path === 'string'
    && !/[\r\n]/.test(path)
    && (DOCS_ONLY_PATHS.has(path)
      || path.startsWith('docs/')
      || path.startsWith('.agents/')
      || path.startsWith('.claude/'));
}

function fail(message) {
  console.error(`Documentation-only revalidation failed: ${message}`);
  process.exit(1);
}

const base = process.env.BASE_REVISION;
const head = process.env.HEAD_REVISION;
if (!base || !head || /^0+$/.test(base) || /^0+$/.test(head)) {
  fail('base/head revision is missing');
}

let diff;
try {
  diff = execFileSync(
    'git',
    ['diff', '--name-status', '-z', '--find-renames', base, head],
    { encoding: 'buffer' },
  );
} catch {
  fail('git diff could not resolve the candidate revisions');
}

const fields = diff.toString('utf8').split('\0');
if (fields.at(-1) === '') fields.pop();
if (fields.length === 0) fail('the candidate diff is empty');

const changedPaths = [];
for (let index = 0; index < fields.length;) {
  const status = fields[index++];
  if (!status) fail('empty status record');
  const kind = status[0];
  if (!['A', 'M', 'D', 'R'].includes(kind)) {
    fail(`unsupported status ${status}`);
  }

  if (kind === 'R') {
    const oldPath = fields[index++];
    const newPath = fields[index++];
    if (!oldPath || !newPath) fail('malformed rename record');
    changedPaths.push(oldPath, newPath);
  } else {
    const path = fields[index++];
    if (!path) fail(`malformed ${kind} record`);
    changedPaths.push(path);
  }
}

if (changedPaths.length === 0) fail('no changed paths were parsed');
const unsafe = changedPaths.find((path) => !isDocsPath(path));
if (unsafe) fail(`non-allowlisted path ${JSON.stringify(unsafe)}`);

console.log(`Independent documentation allowlist revalidation passed for ${changedPaths.length} path(s).`);
for (const path of changedPaths) console.log(`changed_path=${path.replaceAll(/[\r\n]/g, ' ')}`);
