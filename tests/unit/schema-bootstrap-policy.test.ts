import { describe, expect, it } from 'vitest';
import {
  classifySchemaBootstrapAcceptance,
  schemaBootstrapGovernanceInstallOnlyFiles,
} from '../../scripts/agents/schema-bootstrap-policy.mjs';

describe('schema bootstrap Product acceptance classification', () => {
  it('allows only the bounded governance guard install to stop after replay/probes', () => {
    const result = classifySchemaBootstrapAcceptance(schemaBootstrapGovernanceInstallOnlyFiles);
    expect(result).toEqual({
      productAcceptanceRequired: false,
      reason: 'GOVERNANCE_GUARD_INSTALL_ONLY',
      outsideGovernanceInstallScope: [],
    });
  });

  it.each([
    ['canonical migration', 'supabase/migrations/0102_future.sql'],
    ['historical compatibility SQL', 'supabase/local-migrations/historical-integration-baseline/0019_future.sql'],
    ['seed', 'scripts/test/seed.mjs'],
    ['schema profile helper', 'scripts/test/tour-seed-profile.mjs'],
    ['known guide fixture', 'tests/integration/api/guide-action-inbox.43.test.ts'],
    ['known public-shop fixture', 'tests/integration/api/public-shop.46.test.ts'],
    ['future unknown Product file', 'src/server/future-schema-consumer.ts'],
  ])('fails closed to full Product acceptance for %s', (_label, path) => {
    const result = classifySchemaBootstrapAcceptance([
      '.github/workflows/agent-schema-bootstrap.yml',
      path,
    ]);
    expect(result.productAcceptanceRequired).toBe(true);
    expect(result.reason).toBe('PRODUCT_OR_UNKNOWN_PATH_CHANGED');
    expect(result.outsideGovernanceInstallScope).toEqual([path]);
  });

  it('fails closed when the changed-file inventory is empty', () => {
    expect(classifySchemaBootstrapAcceptance([])).toMatchObject({
      productAcceptanceRequired: true,
      reason: 'UNKNOWN_OR_EMPTY_CHANGED_FILE_INVENTORY',
    });
  });

  it('fails closed when the changed-file inventory contains an invalid entry', () => {
    expect(classifySchemaBootstrapAcceptance([
      '.github/workflows/agent-schema-bootstrap.yml',
      '',
    ])).toMatchObject({
      productAcceptanceRequired: true,
      reason: 'INVALID_CHANGED_FILE_INVENTORY',
    });
  });
});
