import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildObserverSnapshotFromRaw } from '../../scripts/agents/schema-drift-watch.mjs';

const script = 'scripts/agents/schema-drift-watch.mjs';
const workflow = readFileSync('.github/workflows/agent-schema-drift-watch.yml', 'utf8');
const calls = workflow.split('\n').filter(line => line.trim().startsWith(`node ${script} `));
const main = 'a'.repeat(40);
const raw = {
  metadata: { counts: { columns: 1, constraints: 0, indexes: 0, views: 0, policies: 0, routines: 0, triggers: 0 }, items: [{ surface: 'columns', key: 'public.tours.id', value: 'uuid|false|' }] },
  acl: { tables: [], functions: [] },
  ledger: [{ version: '0105', name: '0105_previous_migration' }],
};

describe('schema observer workflow CLI contract #589', () => {
  it('executes every workflow command prefix through the real CLI without remote credentials', () => {
    expect(calls).toHaveLength(4);
    const dir = mkdtempSync(join(tmpdir(), 'observer-cli-'));
    try {
      const rawPath = join(dir, 'raw.json');
      writeFileSync(rawPath, JSON.stringify(raw));
      const snapshots = ['LOCAL_EXPECTED', 'TEST', 'PRODUCTION'].map((environment, index) => {
        const file = join(dir, `${environment}.json`);
        writeFileSync(file, JSON.stringify(buildObserverSnapshotFromRaw({ environment,
          projectRef: ['local-fresh', 'nmwhwngojosmagjuvxol', 'egehnijjpgijmccagxac'][index],
          observedAt: new Date().toISOString(), observedMainSha: main,
          evidenceRef: 'local:cli-contract', raw,
        })));
        return file;
      });
      for (const [index, line] of calls.entries()) {
        const prefix = line.trim().slice(`node ${script} `.length).split(' --')[0].split(/\s+/);
        expect(prefix[0]).toBe('--command');
        const command = prefix[1];
        expect(['normalize', 'capture', 'compare']).toContain(command);
        const out = join(dir, `out-${index}.json`);
        // An invalid environment exits before any credential or network lookup.
        const args = command === 'normalize'
          ? ['--environment', 'LOCAL_EXPECTED', '--project-ref', 'local-fresh', '--raw-json', rawPath]
          : command === 'capture' ? ['--environment', 'INVALID']
            : ['--expected-snapshot', snapshots[0], '--test-snapshot', snapshots[1], '--production-snapshot', snapshots[2]];
        const result = spawnSync(process.execPath, [script, ...prefix, ...args,
          '--current-main-sha', main, '--json-out', out], { encoding: 'utf8' });
        expect(result.error).toBeUndefined();
        expect(result.stderr).not.toContain('INVALID_ARGUMENT');
        expect(result.status, result.stderr).toBe(command === 'capture' ? 2 : 0);
        expect(JSON.parse(readFileSync(out, 'utf8')).status)
          .toBe(command === 'capture' ? 'EVIDENCE_UNAVAILABLE' : command === 'compare' ? 'MATCH' : 'CAPTURED');
      }
      const legacy = spawnSync(process.execPath, [script, 'normalize', '--json-out', join(dir, 'legacy.json')], { encoding: 'utf8' });
      expect(legacy.status).toBe(1);
      expect(legacy.stderr).toContain('INVALID_ARGUMENT');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
