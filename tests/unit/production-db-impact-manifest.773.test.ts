import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildProductionConsistencyEvidence } from '../../scripts/agents/production-db-consistency-evidence.mjs';
import { selectedProductionMigrations } from '../../scripts/agents/production-db-release-plan.mjs';

// #773: FULL_PENDING_SET / ISSUES_17_680 G2 source check must not hit AMBIGUOUS_IMPACT_OWNERSHIP.
// Each object rewritten by a later migration is registered only under its final writer (#589 rule).
const root = process.cwd();
const aliasMap = JSON.parse(readFileSync(resolve(root, 'supabase/ledger-alias-map.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/production-db-impact-manifest.json'), 'utf8'));
const MAIN = 'a'.repeat(40);
const PLAN_DIGEST = 'b'.repeat(64);

function planFor(scope: string) {
  const selection = selectedProductionMigrations(aliasMap, scope);
  return {
    selection,
    plan: {
      mainSha: MAIN, planDigest: PLAN_DIGEST,
      migrations: selection.migrations.map((repoFile: string) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` })),
    },
  };
}
const emptyReport = () => ({
  observedMainSha: MAIN, status: 'MATCH', differenceCount: 0, differences: [],
  environments: { TEST: { observedAt: '2026-10-05T00:00:00Z' }, PRODUCTION: { observedAt: '2026-10-05T00:00:00Z' } },
  environmentStatuses: { TEST: 'MATCH', PRODUCTION: 'MATCH' }, exceptionSummary: { expired: 0, unmatched: 0 },
  safety: { authorizesDatabaseWrite: false },
});
const run = (plan: any, impactManifest: unknown = manifest) =>
  buildProductionConsistencyEvidence({ report: emptyReport(), plan, impactManifest, mainSha: MAIN, planDigest: PLAN_DIGEST });
const entry = (m: any, prefix: string) => m.entries.find((e: any) => e.repoFile.startsWith(prefix));

const finalOwners: [string, string, string][] = [
  ['policies:public.owner_notify_recipients.p_owner_notify_recipients_all', '0116', '0127'],
  ['constraints:public.booking_addons.booking_addons_performance_staff_id_fkey', '0121', '0133'],
  ['acl:table:public.booking_addons', '0133', '0127'],
];
const ownersOf = (m: any, key: string, repoFiles: string[]) => m.entries
  .filter((e: any) => repoFiles.includes(e.repoFile) && e.impacts.some((i: any) => `${i.surface}:${i.objectKey}` === key))
  .map((e: any) => e.repoFile.slice(0, 4));

describe('#773 G2 source check has no duplicate impact owners', () => {
  // ISSUE_46_0110_0136_CLOSURE is covered by production-db-impact-manifest.755.test.ts.
  for (const scope of ['FULL_PENDING_SET', 'ISSUES_17_680']) {
    it(`${scope} does not throw AMBIGUOUS_IMPACT_OWNERSHIP with the real alias map and manifest`, () => {
      const { plan } = planFor(scope);
      try { run(plan); } catch (error) {
        expect(String((error as Error).message)).not.toMatch(/AMBIGUOUS_IMPACT_OWNERSHIP/);
        throw error;
      }
    });
  }

  it('each duplicate key is owned by exactly its final writer in FULL_PENDING_SET', () => {
    const files: string[] = planFor('FULL_PENDING_SET').selection.migrations;
    for (const [key, , finalOwner] of finalOwners) {
      expect(ownersOf(manifest, key, files), key).toEqual([finalOwner]);
    }
  });

  it('ISSUES_17_680 (0121, 0125, 0133) registers the fkey only under 0133 and does not own the booking_addons table ACL', () => {
    const files: string[] = planFor('ISSUES_17_680').selection.migrations;
    expect(ownersOf(manifest, 'constraints:public.booking_addons.booking_addons_performance_staff_id_fkey', files)).toEqual(['0133']);
    // 0133 only grants on create/delete_booking_addon functions; the table ACL is 0127's (not in this scope).
    expect(ownersOf(manifest, 'acl:table:public.booking_addons', files)).toEqual([]);
  });

  it('re-adding a key to its non-final entry still fails closed as AMBIGUOUS_IMPACT_OWNERSHIP', () => {
    const { plan } = planFor('FULL_PENDING_SET');
    for (const [key, nonFinal] of finalOwners) {
      const [surface, ...rest] = key.split(':');
      const m: any = structuredClone(manifest);
      entry(m, nonFinal).impacts.push({ surface, objectKey: rest.join(':') });
      expect(() => run(plan, m), key).toThrow(/AMBIGUOUS_IMPACT_OWNERSHIP/);
    }
  });
});
