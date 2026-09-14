import { describe, expect, it } from 'vitest';

import { assertLiveLedgerMatchesAliasMap, expectedAppliedLedgerNames } from '../../scripts/db/controlled-production-db-release.mjs';

describe('Issue #447 provider ledger identity', () => {
  it('supports historical aliases but requires the exact full ledger names', () => {
    const aliasMap = { schemaVersion: 1, entries: [
      { repoFile: '0083_staff_display_fields', ledgerNames: ['0082_staff_display_fields'], classification: 'ALIAS', evidence: 'historical alias' },
      { repoFile: '0082_reconcile_booking_addon_notify_fields', ledgerNames: ['0082_reconcile_booking_addon_notify_fields'], classification: 'EXACT', evidence: 'exact' },
    ] };
    expect(expectedAppliedLedgerNames(aliasMap)).toEqual(['0082_reconcile_booking_addon_notify_fields', '0082_staff_display_fields']);
    expect(assertLiveLedgerMatchesAliasMap({ aliasMap, liveLedgerRows: [
      { version: '0082', name: '0082_reconcile_booking_addon_notify_fields' },
      { version: '20260907024138', name: '0082_staff_display_fields' },
    ] }).status).toBe('LIVE_LEDGER_VERIFIED');
  });

  it('does not collapse two rows just because their four-digit prefixes match', () => {
    const aliasMap = { schemaVersion: 1, entries: [
      { repoFile: '0083_staff_display_fields', ledgerNames: ['0082_staff_display_fields'], classification: 'ALIAS', evidence: 'historical alias' },
      { repoFile: '0082_reconcile_booking_addon_notify_fields', ledgerNames: ['0082_reconcile_booking_addon_notify_fields'], classification: 'EXACT', evidence: 'exact' },
    ] };
    expect(() => assertLiveLedgerMatchesAliasMap({ aliasMap, liveLedgerRows: [
      { version: '0082', name: '0082_reconcile_booking_addon_notify_fields' },
    ] })).toThrow(/LIVE_LEDGER_DRIFT/);
  });
});
