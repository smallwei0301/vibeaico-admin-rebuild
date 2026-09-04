import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const appShell = readFileSync('src/components/layout/AppShell.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('Issue #34 AppShell real-mode mock regression lock', () => {
  it('does not directly render sidebar counts, setup progress, or user data from mock constants', () => {
    expect(appShell).not.toContain('MOCK_SIDEBAR_COUNTS');
    expect(appShell).not.toContain('MOCK_SETUP_STATUS');
    expect(appShell).not.toContain('MOCK_USER');
  });

  it('loads the three shell values through services and starts them as unknown', () => {
    for (const service of ['sidebarCounts', 'getSetupStatus', 'currentUser']) {
      expect(appShell).toContain(`${service}()`);
    }
    for (const state of ['counts', 'setupPercent', 'userName']) {
      expect(appShell).toMatch(new RegExp(`const \\[${state}, set\\w+\\] = React\\.useState<[^>]+ \\| null>\\(null\\)`));
    }
  });
});

type Allowance = { bindings: string[]; reason: string; owner: string };

const allowed: Record<string, Allowance> = {
  'src/components/layout/AppShell.tsx': {
    bindings: ['MOCK_TENANTS'],
    reason: 'The explicit mock branch needs the selectable demonstration tenant dataset; real tenant data is loaded through myTenants().',
    owner: '#34',
  },
  'src/app/tenant/customers/page.tsx': {
    bindings: ['MOCK_CUSTOMERS'],
    reason: 'The existing customer-tag mock fallback is outside the AppShell wiring scope and remains owned by its page-integration work.',
    owner: '#7',
  },
};

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

function importedMockConstants(file: string): string[] {
  const source = readFileSync(join(root, file), 'utf8');
  return [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@\/mock['"]/g)]
    .flatMap((match) => match[1].split(','))
    .map((binding) => binding.trim().split(/\s+as\s+/)[0])
    .filter((binding) => binding.startsWith('MOCK_'))
    .sort();
}

describe('Issue #34 direct MOCK_* import whitelist', () => {
  const importers = new Map(
    ['src/app/tenant', 'src/components'].flatMap((directory) => walk(join(root, directory)))
      .map((file) => relative(root, file).replace(/\\/g, '/'))
      .map((file) => [file, importedMockConstants(file)] as const)
      .filter(([, bindings]) => bindings.length > 0),
  );

  it('has a reason and owning issue for every current direct MOCK_* import', () => {
    expect([...importers.keys()].sort()).toEqual(Object.keys(allowed).sort());
    for (const [file, allowance] of Object.entries(allowed)) {
      expect(importers.get(file)).toEqual(allowance.bindings);
      expect(allowance.reason.length).toBeGreaterThan(20);
      expect(allowance.owner).toMatch(/^#\d+$/);
    }
  });
});
