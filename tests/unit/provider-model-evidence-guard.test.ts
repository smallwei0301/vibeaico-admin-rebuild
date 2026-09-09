import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const evidenceDir = path.join(root, 'docs/metrics/review-evidence');

/**
 * Scoreboard contract v1 intentionally has no executable provider served-model verifier.
 * The schema reserves PROVIDER_VERIFIED for a future trusted integration, but until that
 * verifier exists in repo and this test is deliberately replaced, committed evidence must
 * stay OPERATOR_ATTESTED or UNKNOWN. A provider-looking string is not provider proof.
 */
describe('provider model identity evidence admission', () => {
  it('fails closed: committed review evidence cannot claim PROVIDER_VERIFIED in contract v1', () => {
    if (!fs.existsSync(evidenceDir)) return;

    const violations: string[] = [];
    for (const name of fs.readdirSync(evidenceDir).filter((item) => item.endsWith('.json'))) {
      const packet = JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
      for (const [index, record] of (packet.records ?? []).entries()) {
        if (record.identityEvidence === 'PROVIDER_VERIFIED') {
          violations.push(`${name} records[${index}] ${record.subject ?? 'unknown-subject'}`);
        }
      }
    }

    expect(
      violations,
      `PROVIDER_VERIFIED is reserved until an executable trusted provider verifier exists; found: ${violations.join(', ')}`,
    ).toEqual([]);
  });
});
