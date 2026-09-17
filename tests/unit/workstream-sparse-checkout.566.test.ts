import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = process.cwd();
const workflowPath = '.github/workflows/agent-workstream-classification.yml';
const temporaryDirectories: string[] = [];

function sparseFiles(): string[] {
  const workflow = readFileSync(resolve(root, workflowPath), 'utf8');
  const blocks = [...workflow.matchAll(/^          sparse-checkout: \|\r?\n((?: {12}[^\r\n]+\r?\n)+)/gm)];
  expect(blocks).toHaveLength(1);
  const paths = blocks[0][1].trim().split(/\r?\n/).map((line) => line.trim());
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    expect(path).toMatch(/^scripts\/agents\/[a-z0-9.-]+\.(?:mjs|json)$/);
  }
  return paths;
}

// A full repository checkout would hide a missing sparse dependency. Only copy
// the exact workflow inventory into a fresh directory and use a fresh Node process.
function loadSparsePolicy(paths: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'classification-sparse-566-'));
  temporaryDirectories.push(directory);
  for (const path of paths) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(root, path), target);
  }
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { resolve } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const policy = await import(pathToFileURL(resolve('scripts/agents/astra-review-policy.mjs')).href);
    const boundary = await import(pathToFileURL(resolve('scripts/agents/governance-workstream-boundary.mjs')).href);
    if (typeof policy.classifyWorkstream !== 'function' ||
        typeof boundary.validateBookkeepingWorkstream !== 'function') {
      throw new Error('Classification entrypoints were not loaded');
    }
    console.log('SPARSE_POLICY_IMPORT_OK');
  `], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10_000,
    // Do not expose CI or database credentials to the import-only smoke test.
    env: { PATH: process.env.PATH ?? '' },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('classification sparse-checkout dependency closure (#566)', () => {
  it('keeps trusted-main checkout and does not persist credentials', () => {
    const workflow = readFileSync(resolve(root, workflowPath), 'utf8');
    expect(workflow).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflow).toContain('sparse-checkout-cone-mode: false');
    expect(workflow).toContain('persist-credentials: false');
  });

  it('loads the real classification modules from only the workflow inventory', () => {
    const result = loadSparsePolicy(sparseFiles());
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('SPARSE_POLICY_IMPORT_OK');
  });

  it('detects the original missing final-risk-cost-policy dependency', () => {
    const result = loadSparsePolicy(sparseFiles().filter((path) => !path.endsWith('/final-risk-cost-policy.mjs')));
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain('final-risk-cost-policy.mjs');
  });

  it('does not let model-routing.json leak in from the full checkout', () => {
    const result = loadSparsePolicy(sparseFiles().filter((path) => !path.endsWith('/model-routing.json')));
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ENOENT');
    expect(result.stderr).toContain('model-routing.json');
  });
});
