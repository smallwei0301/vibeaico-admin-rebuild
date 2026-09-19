import { describe, expect, it, vi } from 'vitest';

import {
  buildProductionDbTestCoverageEvidence,
  captureProductionDbTestCleanupEvidence,
} from '../../scripts/agents/production-db-g3-test-artifacts.mjs';

const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const TEST_URL = 'https://nmwhwngojosmagjuvxol.supabase.co';
const AUTHZ_FILE = 'tests/integration/db/traveler-risk-policy.44.test.ts';
const SHOP_A = 'a1000000-0000-4000-8000-000000000001';

function plan(migrations: any[] = [
  { repoFile: '0105_issue_44_traveler_risk_policies', riskTier: 'AUTHZ', sha256: '1'.repeat(64) },
  { repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: '2'.repeat(64) },
]) {
  return {
    schemaVersion: 1,
    releaseId: 'release-20260915-447',
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    productionProjectRef: 'egehnijjpgijmccagxac',
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: migrations.some((item) => item.riskTier === 'AUTHZ') ? 'AUTHZ' : 'SCHEMA_REPAIR',
    migrations,
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    numTotalTests: 3,
    numPassedTests: 3,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
    testResults: [
      {
        name: `/home/runner/work/repo/repo/${AUTHZ_FILE}`,
        assertionResults: [
          { status: 'passed', fullName: 'RLS：跨租戶隔離 A owner 指派一筆政策後，B owner 完全查不到（連自己店過濾都不用做）' },
          { status: 'passed', fullName: 'RLS：跨租戶隔離 A owner 想寫入 tenant_id=B 店 → RLS 拒絕 insert（is_tenant_member(B)=false）' },
          { status: 'passed', fullName: '角色門檻：MANAGER 以上才能套用政策 STAFF 讀得到，但寫不了（42501，不是「安靜失敗回 0 筆」）' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('Production DB G3 TEST artifact builders #447', () => {
  it('builds AUTHZ coverage from actual passing Vitest JSON assertions', () => {
    const result = buildProductionDbTestCoverageEvidence({
      report: report(),
      plan: plan(),
      sourceRunId: '34920000000',
      sourceRunAttempt: 1,
    });
    expect(result).toMatchObject({
      status: 'TEST_COVERAGE_VERIFIED',
      mainSha: MAIN,
      testProjectRef: 'nmwhwngojosmagjuvxol',
      executedTests: 3,
      executedFiles: [AUTHZ_FILE],
      databaseMutationAuthorized: false,
      productionMutationPerformed: false,
    });
    expect(result.migrations['0105_issue_44_traveler_risk_policies']).toMatchObject({
      status: 'MIGRATION_TEST_COVERAGE_VERIFIED',
      tenantBoundaryVerified: true,
      negativeRoleTestsPassed: true,
    });
  });

  it('rejects failed, empty, pending, or partial Vitest reports', () => {
    for (const bad of [
      report({ success: false, numFailedTests: 1, numPassedTests: 2 }),
      report({ numTotalTests: 0, numPassedTests: 0, testResults: [] }),
      report({ numPendingTests: 1, numPassedTests: 2 }),
      report({ numPassedTests: 2 }),
    ]) {
      expect(() => buildProductionDbTestCoverageEvidence({
        report: bad,
        plan: plan(),
        sourceRunId: '1',
        sourceRunAttempt: 1,
      })).toThrow(/INCOMPLETE_VITEST_COVERAGE/);
    }
  });

  it('accepts only the explicitly documented shared-TEST pending suites', () => {
    const result = buildProductionDbTestCoverageEvidence({
      report: report({
        numTotalTests: 5,
        numPassedTests: 3,
        numPendingTests: 2,
        testResults: [
          ...report().testResults,
          {
            name: '/home/runner/work/repo/repo/tests/integration/db/richmenu-asset-retirement.589.test.ts',
            assertionResults: [
              { status: 'pending', fullName: 'Issue #589 real PostgreSQL retirement contract re-reads references' },
              { status: 'pending', fullName: 'Issue #589 real PostgreSQL retirement contract keeps tenant scope' },
            ],
          },
        ],
      }),
      plan: plan([{ repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: '2'.repeat(64) }]),
      sourceRunId: '1',
      sourceRunAttempt: 1,
    });
    expect(result).toMatchObject({
      executedTests: 3,
      totalTests: 5,
      pendingTests: 2,
      allowedPendingTests: 2,
    });
  });

  it('rejects a pending assertion outside the canonical-TEST allowlist', () => {
    expect(() => buildProductionDbTestCoverageEvidence({
      report: report({
        numTotalTests: 4,
        numPassedTests: 3,
        numPendingTests: 1,
        testResults: [
          ...report().testResults,
          {
            name: '/home/runner/work/repo/repo/tests/integration/api/unknown.test.ts',
            assertionResults: [{ status: 'pending', fullName: 'unexpected skipped coverage' }],
          },
        ],
      }),
      plan: plan([{ repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: '2'.repeat(64) }]),
      sourceRunId: '1',
      sourceRunAttempt: 1,
    })).toThrow(/UNAPPROVED_VITEST_PENDING/);
  });

  it('rejects 0105 coverage if required tenant-boundary or negative-role assertions did not actually pass', () => {
    const missingBoundary = report({
      numTotalTests: 2,
      numPassedTests: 2,
      testResults: [{
        name: AUTHZ_FILE,
        assertionResults: [
          { status: 'passed', fullName: 'RLS：跨租戶隔離 A owner 指派一筆政策後，B owner 完全查不到（連自己店過濾都不用做）' },
          { status: 'passed', fullName: '角色門檻：MANAGER 以上才能套用政策 STAFF 讀得到，但寫不了（42501）' },
        ],
      }],
    });
    expect(() => buildProductionDbTestCoverageEvidence({
      report: missingBoundary,
      plan: plan(),
      sourceRunId: '1',
      sourceRunAttempt: 1,
    })).toThrow(/TENANT_BOUNDARY_TEST_REQUIRED/);

    const missingNegative = report({
      numTotalTests: 2,
      numPassedTests: 2,
      testResults: [{
        name: AUTHZ_FILE,
        assertionResults: [
          { status: 'passed', fullName: 'RLS：跨租戶隔離 A owner 指派一筆政策後，B owner 完全查不到' },
          { status: 'passed', fullName: 'RLS：跨租戶隔離 A owner 想寫入 tenant_id=B 店 → RLS 拒絕 insert' },
        ],
      }],
    });
    expect(() => buildProductionDbTestCoverageEvidence({
      report: missingNegative,
      plan: plan(),
      sourceRunId: '1',
      sourceRunAttempt: 1,
    })).toThrow(/NEGATIVE_ROLE_TEST_REQUIRED/);
  });

  it('fails closed for an unknown AUTHZ migration', () => {
    expect(() => buildProductionDbTestCoverageEvidence({
      report: report(),
      plan: plan([{ repoFile: '0110_unknown_authz', riskTier: 'AUTHZ', sha256: '3'.repeat(64) }]),
      sourceRunId: '1',
      sourceRunAttempt: 1,
    })).toThrow(/AUTHZ_TEST_MAPPING_REQUIRED/);
  });

  it('binds #21 and #18 to their concrete canonical-TEST RLS assertions', () => {
    const externalFile = 'tests/integration/db/external-calendars-rls.21.test.ts';
    const ownerNotifyFile = 'tests/integration/db/owner-notify-rls.18.test.ts';
    const result = buildProductionDbTestCoverageEvidence({
      plan: plan([
        { repoFile: '0115_issue_21_external_calendars', riskTier: 'AUTHZ', sha256: '3'.repeat(64) },
        { repoFile: '0116_issue_18_owner_notify', riskTier: 'AUTHZ', sha256: '4'.repeat(64) },
      ]),
      report: report({
        numTotalTests: 4,
        numPassedTests: 4,
        testResults: [
          {
            name: externalFile,
            assertionResults: [
              { status: 'passed', fullName: '0115 external calendars RLS B 店登入使用者讀不到 A 店的 external calendar（tenant 隔離）' },
              { status: 'passed', fullName: '0115 external calendars RLS authenticated 角色不能直接寫入 external calendar event cache' },
            ],
          },
          {
            name: ownerNotifyFile,
            assertionResults: [
              { status: 'passed', fullName: '0116 owner notification RLS B 店登入使用者讀不到 A 店的 owner-notify bind request（tenant 隔離）' },
              { status: 'passed', fullName: '0116 owner notification RLS B 店登入使用者不能直接在 A 店建立 owner-notify bind request' },
            ],
          },
        ],
      }),
      sourceRunId: '34920000000',
      sourceRunAttempt: 1,
    });
    expect(result.migrations['0115_issue_21_external_calendars']).toMatchObject({
      tenantBoundaryVerified: true,
      negativeRoleTestsPassed: true,
    });
    expect(result.migrations['0116_issue_18_owner_notify']).toMatchObject({
      tenantBoundaryVerified: true,
      negativeRoleTestsPassed: true,
    });
  });

  it('binds the #18 legacy-shape RLS precondition to the same concrete assertions', () => {
    const ownerNotifyFile = 'tests/integration/db/owner-notify-rls.18.test.ts';
    const result = buildProductionDbTestCoverageEvidence({
      plan: plan([
        { repoFile: '0124_issue_18_owner_notify_legacy_shape', riskTier: 'AUTHZ', sha256: '4'.repeat(64) },
      ]),
      report: report({
        numTotalTests: 2,
        numPassedTests: 2,
        testResults: [{
          name: ownerNotifyFile,
          assertionResults: [
            { status: 'passed', fullName: '0124 owner notification RLS B 店登入使用者讀不到 A 店的 owner-notify bind request（tenant 隔離）' },
            { status: 'passed', fullName: '0124 owner notification RLS B 店登入使用者不能直接在 A 店建立 owner-notify bind request' },
          ],
        }],
      }),
      sourceRunId: '34920000000',
      sourceRunAttempt: 1,
    });
    expect(result.migrations['0124_issue_18_owner_notify_legacy_shape']).toMatchObject({
      tenantBoundaryVerified: true,
      negativeRoleTestsPassed: true,
    });
  });

  it('binds every remaining Issue #589 AUTHZ migration to live integration assertions', () => {
    const ownerNotifyFile = 'tests/integration/db/owner-notify-rls.18.test.ts';
    const bookingAddonsFile = 'tests/integration/api/booking-addons.17.test.ts';
    const richmenuFile = 'tests/integration/db/richmenu-asset-retirement-authz.589.test.ts';
    const uploadFile = 'tests/integration/api/upload-welcome-card.28.test.ts';
    const result = buildProductionDbTestCoverageEvidence({
      plan: plan([
        { repoFile: '0119_issue_18_owner_notify_confirm_atomic', riskTier: 'AUTHZ', sha256: '1'.repeat(64) },
        { repoFile: '0125_issue_17_booking_addons_legacy_enum', riskTier: 'AUTHZ', sha256: '2'.repeat(64) },
        { repoFile: '0121_issue_17_booking_addons_hardening', riskTier: 'AUTHZ', sha256: '3'.repeat(64) },
        { repoFile: '0123_issue_589_richmenu_asset_retirement', riskTier: 'AUTHZ', sha256: '4'.repeat(64) },
        { repoFile: '0126_issue_402_keyword_reply_images_authz', riskTier: 'AUTHZ', sha256: '5'.repeat(64) },
      ]),
      report: {
        numTotalTests: 7,
        numPassedTests: 7,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        success: true,
        testResults: [
          {
            name: ownerNotifyFile,
            assertionResults: [
              { status: 'passed', fullName: '0119 owner-notify confirm RPC 僅在請求所屬租戶內確認，不可跨租戶消費 bind request' },
              { status: 'passed', fullName: '0119 未登入與已登入角色都不得直接呼叫 confirm_owner_notify_bind RPC' },
            ],
          },
          {
            name: bookingAddonsFile,
            assertionResults: [
              { status: 'passed', fullName: 'A 店的 idempotency key 不得命中 B 店（即使字面值相同）' },
              { status: 'passed', fullName: '未登入與已登入使用者都不得直接呼叫 create_booking_addon／delete_booking_addon rpc' },
            ],
          },
          {
            name: richmenuFile,
            assertionResults: [
              { status: 'passed', fullName: 'retirement RPC is tenant-scoped: another tenant can retire the same URL independently' },
              { status: 'passed', fullName: 'browser roles cannot execute or write richmenu retirement bookkeeping directly' },
            ],
          },
          {
            name: uploadFile,
            assertionResults: [
              { status: 'passed', fullName: 'rejects direct authenticated keyword-reply-images uploads, same shape as welcome-card-images (#402)' },
            ],
          },
        ],
      },
      sourceRunId: '34920000000',
      sourceRunAttempt: 1,
    });

    for (const repoFile of [
      '0119_issue_18_owner_notify_confirm_atomic',
      '0125_issue_17_booking_addons_legacy_enum',
      '0121_issue_17_booking_addons_hardening',
      '0123_issue_589_richmenu_asset_retirement',
      '0126_issue_402_keyword_reply_images_authz',
    ]) {
      expect(result.migrations[repoFile]).toMatchObject({
        status: 'MIGRATION_TEST_COVERAGE_VERIFIED',
        tenantBoundaryVerified: true,
        negativeRoleTestsPassed: true,
      });
    }
  });

  it('captures migration-scoped cleanup using GET only and the canonical SHOP_A tenant filter', async () => {
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      const text = String(url);
      expect(text).toContain('/rest/v1/traveler_risk_policies?');
      expect(decodeURIComponent(text)).toContain(`tenant_id=eq.${SHOP_A}`);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await captureProductionDbTestCleanupEvidence({
      plan: plan(),
      testSupabaseUrl: TEST_URL,
      serviceRoleKey: 'test-service-role-only',
      sourceRunId: '34920000000',
      sourceRunAttempt: 1,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'TEST_CLEANUP_VERIFIED',
      cleanup: 'PASSED',
      residueCount: 0,
      scopeKind: 'PRODUCTION_DB_RELEASE_MIGRATION_FIXTURES',
      readOnly: true,
      databaseMutationAuthorized: false,
      productionMutationPerformed: false,
    });
  });

  it('rejects wrong TEST hosts before network and rejects scoped residue', async () => {
    const fetchSpy = vi.fn();
    await expect(captureProductionDbTestCleanupEvidence({
      plan: plan(),
      testSupabaseUrl: 'https://egehnijjpgijmccagxac.supabase.co',
      serviceRoleKey: 'key',
      sourceRunId: '1',
      sourceRunAttempt: 1,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })).rejects.toThrow(/WRONG_TEST_PROJECT/);
    expect(fetchSpy).not.toHaveBeenCalled();

    const residueFetch = vi.fn(async () => new Response('[{"id":"leftover"}]', { status: 200 }));
    await expect(captureProductionDbTestCleanupEvidence({
      plan: plan(),
      testSupabaseUrl: TEST_URL,
      serviceRoleKey: 'key',
      sourceRunId: '1',
      sourceRunAttempt: 1,
      fetchImpl: residueFetch as unknown as typeof fetch,
    })).rejects.toThrow(/TEST_CLEANUP_RESIDUE/);
  });

  it('does not invent a global cleanup claim for a schema-only release with no release-specific fixtures', async () => {
    const schemaPlan = plan([
      { repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: '2'.repeat(64) },
    ]);
    const fetchSpy = vi.fn();
    const result = await captureProductionDbTestCleanupEvidence({
      plan: schemaPlan,
      testSupabaseUrl: TEST_URL,
      serviceRoleKey: 'key',
      sourceRunId: '1',
      sourceRunAttempt: 1,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'TEST_CLEANUP_VERIFIED',
      residueCount: 0,
      scopeKind: 'NO_RELEASE_SPECIFIC_FIXTURES',
      checkedScopes: [],
    });
  });
});
