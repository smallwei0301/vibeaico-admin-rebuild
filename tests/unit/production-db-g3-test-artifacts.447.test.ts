import { getProductionDbG3AuthzContract, ISSUE_46_CLOSURE_COVERAGE, ISSUE_46_CLOSURE_FAMILIES, ISSUE_46_CLOSURE_FILE_MIGRATIONS, CREATE_TOUR_ORDER_WRITER_PREFIXES, CREATE_TOUR_ORDER_EXCLUDED_DDL, CREATE_TOUR_ORDER_SCHEMA_WIDE_ACL_EXCLUSIONS, CREATE_TOUR_ORDER_DYNAMIC_SQL_EXCLUSIONS, CREATE_TOUR_ORDER_UNICODE_IDENTIFIER_EXCLUSIONS, CREATE_TOUR_ORDER_UNRESOLVED_EXECUTE_EXCLUSIONS, scanCreateTourOrderDdl } from '../../scripts/agents/production-db-g3-authz-contracts.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CANONICAL_MIGRATION_IDENTITY, normalizedRepoFile } from '../../scripts/agents/production-db-release-plan.mjs';

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

// #725 N2：plan 含 closure 成員（0111/0128/0130/0132/0136）時，對應 closure exact assertions 一律必填。
function withClosureRows(raw: any, files: string[]) {
  const extra = ISSUE_46_CLOSURE_COVERAGE.requiredAssertions.filter((row) => files.includes(row.file));
  const results = [...raw.testResults, ...files.map((file) => ({
    name: file,
    assertionResults: extra.filter((row) => row.file === file).map((row) => ({ status: 'passed', fullName: row.fullName })),
  }))];
  return { ...raw, numTotalTests: raw.numTotalTests + extra.length, numPassedTests: raw.numPassedTests + extra.length, testResults: results };
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

  it('allows only the named local-only #589 reconciliation assertions as canonical pending', () => {
    const result = buildProductionDbTestCoverageEvidence({
      report: report({
        numTotalTests: 4,
        numPassedTests: 3,
        numPendingTests: 1,
        testResults: [...report().testResults, {
          name: 'tests/integration/db/authz-constraint-reconciliation.589.test.ts',
          assertionResults: [{ status: 'pending', fullName: 'Issue #589 isolated PostgreSQL reconciliation preconditions and rollback PENDING precheck rolls back the reconciliation transaction without persistent ACL changes' }],
        }],
      }),
      plan: plan([{ repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: '2'.repeat(64) }]),
      sourceRunId: '1', sourceRunAttempt: 1,
    });
    expect(result.allowedPendingTests).toBe(1);

    expect(() => buildProductionDbTestCoverageEvidence({
      report: report({
        numTotalTests: 4, numPassedTests: 3, numPendingTests: 1,
        testResults: [...report().testResults, {
          name: 'tests/integration/db/authz-constraint-reconciliation.589.test.ts',
          assertionResults: [{ status: 'pending', fullName: 'unrelated skipped assertion' }],
        }],
      }),
      plan: plan([{ repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: '2'.repeat(64) }]),
      sourceRunId: '1', sourceRunAttempt: 1,
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
      plan: plan([{ repoFile: '0141_unknown_authz', riskTier: 'AUTHZ', sha256: '3'.repeat(64) }]),
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

  it('binds 0127 only to passing canonical REST role and tenant assertions', () => {
    const file = 'tests/integration/api/authz-constraint-reconciliation.589.test.ts';
    const result = buildProductionDbTestCoverageEvidence({
      plan: plan([{ repoFile: '0127_issue_589_authz_constraint_reconciliation', riskTier: 'AUTHZ', sha256: '6'.repeat(64) }]),
      report: report({
        numTotalTests: 2, numPassedTests: 2,
        testResults: [{ name: file, assertionResults: [
          { status: 'passed', fullName: '0127 reconciled table grants and RLS authenticated tenant cannot read another tenant booking addons or owner notify recipients' },
          { status: 'passed', fullName: '0127 reconciled table grants and RLS anon cannot read or write reconciled tables while authenticated addon writes remain denied' },
        ] }],
      }),
      sourceRunId: '1', sourceRunAttempt: 1,
    });
    expect(result.migrations['0127_issue_589_authz_constraint_reconciliation']).toMatchObject({
      tenantBoundaryVerified: true, negativeRoleTestsPassed: true,
    });
  });

  it('binds 0128 only to passing seasonal-pricing tenant and role assertions', () => {
    const file = 'tests/integration/db/plan-seasonal-pricing.42.test.ts';
    const result = buildProductionDbTestCoverageEvidence({
      plan: plan([{ repoFile: '0128_issue_42_plan_seasonal_pricing', riskTier: 'AUTHZ', sha256: '8'.repeat(64) }]),
      report: withClosureRows(report({
        numTotalTests: 2,
        numPassedTests: 2,
        testResults: [{ name: file, assertionResults: [
          { status: 'passed', fullName: '0128 seasonal pricing RLS and tenant-boundary contract A 店 owner 讀得到自己的季節定價，B 店 owner 完全查不到（tenant 隔離）' },
          { status: 'passed', fullName: '0128 seasonal pricing RLS and tenant-boundary contract anon 不能讀取，authenticated 角色不能直接寫入 seasonal pricing' },
        ] }],
      }), ['tests/integration/db/plan-seasonal-order-snapshot.42.test.ts']),
      sourceRunId: '1', sourceRunAttempt: 1,
    });
    expect(result.migrations['0128_issue_42_plan_seasonal_pricing']).toMatchObject({
      executedFiles: [file], tenantBoundaryVerified: true, negativeRoleTestsPassed: true,
    });
  });

  it('binds 0130-0133 to explicit current-main AUTHZ assertions', () => {
    const tourOrderFile = 'tests/integration/api/tour-order-authz.447.test.ts';
    const departureStaffFile = 'tests/integration/api/departure-staff-rpc-acl.37.test.ts';
    const bookingAddonsFile = 'tests/integration/api/booking-addons.17.test.ts';
    const result = buildProductionDbTestCoverageEvidence({
      plan: plan([
        { repoFile: '0130_issue_46_refund_policy_snapshot', riskTier: 'AUTHZ', sha256: 'a'.repeat(64) },
        { repoFile: '0131_issue_37_atomic_departure_staff', riskTier: 'AUTHZ', sha256: 'b'.repeat(64) },
        { repoFile: '0132_issue_42_seasonal_price_resolution', riskTier: 'AUTHZ', sha256: 'c'.repeat(64) },
        { repoFile: '0133_issue_680_booking_addons_composite_fk_expand', riskTier: 'AUTHZ', sha256: 'd'.repeat(64) },
      ]),
      report: withClosureRows(report({
        numTotalTests: 6,
        numPassedTests: 6,
        testResults: [
          { name: tourOrderFile, assertionResults: [
            { status: 'passed', fullName: 'cross-tenant owner cannot use another tenant departure' },
            { status: 'passed', fullName: 'authenticated role cannot invoke SECURITY DEFINER create_tour_order directly' },
          ] },
          { name: departureStaffFile, assertionResults: [
            { status: 'passed', fullName: 'service_role RPC rejects another tenant id for an existing departure without mutation' },
            { status: 'passed', fullName: 'anon and authenticated roles cannot execute replace_trip_departure_staff directly' },
          ] },
          { name: bookingAddonsFile, assertionResults: [
            { status: 'passed', fullName: 'A 店的 idempotency key 不得命中 B 店（即使字面值相同）' },
            { status: 'passed', fullName: '未登入與已登入使用者都不得直接呼叫 create_booking_addon／delete_booking_addon rpc' },
          ] },
        ],
      }), ['tests/integration/db/plan-seasonal-order-snapshot.42.test.ts', 'tests/integration/db/tour-refund-snapshot.46.test.ts', 'tests/integration/api/tour-request-accept.46.test.ts', 'tests/integration/api/create-tour-order-invoker.755.test.ts']),
      sourceRunId: '1', sourceRunAttempt: 1,
    });

    for (const repoFile of [
      '0130_issue_46_refund_policy_snapshot',
      '0131_issue_37_atomic_departure_staff',
      '0132_issue_42_seasonal_price_resolution',
      '0133_issue_680_booking_addons_composite_fk_expand',
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

  it('uses the composite line_users key instead of a nonexistent synthetic id during cleanup', async () => {
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      const text = decodeURIComponent(String(url));
      expect(text).toContain('/rest/v1/line_users?');
      expect(text).toContain('select=tenant_id,line_user_id');
      expect(text).not.toContain('select=id');
      expect(text).toContain('line_user_id=like.g3-447-owner-notify-%');
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await captureProductionDbTestCleanupEvidence({
      plan: plan([
        { repoFile: '0116_issue_18_owner_notify', riskTier: 'AUTHZ', sha256: '3'.repeat(64) },
      ]),
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
      checkedScopes: [{
        migration: '0116_issue_18_owner_notify',
        table: 'line_users',
        filter: 'line_user_id=like.g3-447-owner-notify-%',
        residueCount: 0,
      }],
    });
  });

  it('checks every 0127 REST fixture and rejects its residue', async () => {
    const migration = { repoFile: '0127_issue_589_authz_constraint_reconciliation', riskTier: 'AUTHZ', sha256: '7'.repeat(64) };
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const text = decodeURIComponent(String(url));
      if (text.includes('/rest/v1/booking_addons?')) expect(text).toContain('name=like.g3-589-0127-%');
      else {
        expect(text).toMatch(/\/(owner_notify_recipients|line_users)\?/);
        expect(text).toContain('line_user_id=like.g3-589-0127-%');
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await captureProductionDbTestCleanupEvidence({ plan: plan([migration]), testSupabaseUrl: TEST_URL, serviceRoleKey: 'key', sourceRunId: '1', sourceRunAttempt: 1, fetchImpl: fetchSpy as unknown as typeof fetch });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.checkedScopes).toHaveLength(3);

    await expect(captureProductionDbTestCleanupEvidence({
      plan: plan([migration]), testSupabaseUrl: TEST_URL, serviceRoleKey: 'key', sourceRunId: '1', sourceRunAttempt: 1,
      fetchImpl: vi.fn(async () => new Response('[{"line_user_id":"g3-589-0127-leftover"}]', { status: 200 })) as unknown as typeof fetch,
    })).rejects.toThrow(/TEST_CLEANUP_RESIDUE/);
  });

  it('checks 0128 seasonal-pricing fixtures by name and rejects residue', async () => {
    const migration = { repoFile: '0128_issue_42_plan_seasonal_pricing', riskTier: 'AUTHZ', sha256: '9'.repeat(64) };
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const text = decodeURIComponent(String(url));
      // 0128 屬 closure 成員（#725 N2）：另含 snapshot-42 trips 清理 scope
      expect(text).toMatch(/\/rest\/v1\/(trip_plan_seasons\?.*name=like\.g3-42-0128-%|trips\?.*slug=like\.snapshot-42-%)/);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const result = await captureProductionDbTestCleanupEvidence({
      plan: plan([migration]), testSupabaseUrl: TEST_URL, serviceRoleKey: 'key', sourceRunId: '1', sourceRunAttempt: 1,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.checkedScopes).toEqual(expect.arrayContaining([{
      migration: '0128_issue_42_plan_seasonal_pricing',
      table: 'trip_plan_seasons',
      filter: 'name=like.g3-42-0128-%',
      residueCount: 0,
    }]));
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

describe('#46 exact semantic coverage and fixture cleanup', () => {
  const file = 'tests/integration/db/guide-interval-availability.46.test.ts';
  const target = '0135_issue_46_guide_interval_availability';
  const targetPlan = () => plan([{repoFile:target,riskTier:'AUTHZ',sha256:'d'.repeat(64)}]);
  function semanticReport() {
    const contract = getProductionDbG3AuthzContract(target)!;
    const passed = contract.requiredAssertions.map((row: any) => ({status:'passed',fullName:row.fullName}));
    return report({numTotalTests:36,numPassedTests:35,numPendingTests:1,testResults:[{name:file,assertionResults:[...passed,{status:'pending',fullName:contract.localOnlyPending.fullName}]}]});
  }
  const coverage = (raw: any, selected = targetPlan()) => buildProductionDbTestCoverageEvidence({report:raw,plan:selected,sourceRunId:'123',sourceRunAttempt:1});
  it('requires 35 exact passed semantic cases, labels the sole isolated catalog case NOT_RUN', () => {
    const result = coverage(semanticReport());
    expect(result.executedTests).toBe(35); expect(result.localOnlyNotRun).toHaveLength(1);
    expect(result.migrations[target]).toMatchObject({tenantBoundaryVerified:true,negativeRoleTestsPassed:true});
  });
  it('rejects altered names/files, semantic pending, blanket pending and absent executed cases', () => {
    for (const mutation of ['name','file','semanticPending','allPending','missing']) {
      const raw = semanticReport(); const rows = raw.testResults[0].assertionResults;
      if (mutation === 'name') rows[35].fullName += '!';
      if (mutation === 'file') raw.testResults[0].name += '.wrong';
      if (mutation === 'semanticPending') { rows[0].status='pending';raw.numPassedTests=34;raw.numPendingTests=2; }
      if (mutation === 'allPending') { rows.forEach((row:any)=>{row.status='pending';});raw.numPassedTests=0;raw.numPendingTests=36; }
      if (mutation === 'missing') { rows.shift();raw.numTotalTests=35;raw.numPassedTests=34; }
      expect(()=>coverage(raw)).toThrow();
    }
  });
  it('permits only exact POLICY_SKIP names when 0135 is absent from the plan', () => {
    const raw = semanticReport();const rows=raw.testResults[0].assertionResults;
    rows.forEach((row:any)=>{row.status='pending';row.fullName=row.fullName.replace('Issue #46 admitted native availability contract ', '#46 POLICY_SKIP/NOT_RUN: SOURCE_PREPARE not admitted; no hooks/fixtures/auth ');});
    const other = report();raw.testResults.push(...other.testResults);raw.numTotalTests=39;raw.numPassedTests=3;raw.numPendingTests=36;
    expect(coverage(raw,plan()).allowedPendingTests).toBe(36);
    expect(()=>coverage(raw)).toThrow(/UNAPPROVED_VITEST_PENDING/);
    rows[0].fullName += '!';expect(()=>coverage(raw,plan())).toThrow(/UNAPPROVED_VITEST_PENDING/);
  });
  it('checks g46 tenant fixtures using read-only GET and rejects residue/errors', async () => {
    for (const outcome of ['clean','residue','error']) {
      const fetchImpl=vi.fn(async (url:any,init:any)=>{
        expect(init.method).toBe('GET');const parsed=new URL(url);
        expect(parsed.pathname).toBe('/rest/v1/tenants');expect(parsed.searchParams.get('shop_code')).toBe('like.g46-%');
        return new Response(JSON.stringify(outcome==='residue'?[{id:'leftover'}]:[]),{status:outcome==='error'?500:200});
      });
      const run=captureProductionDbTestCleanupEvidence({plan:targetPlan(),testSupabaseUrl:TEST_URL,serviceRoleKey:'mock',sourceRunId:'123',sourceRunAttempt:1,fetchImpl});
      if(outcome==='clean') expect(await run).toMatchObject({scopeKind:'PRODUCTION_DB_RELEASE_MIGRATION_FIXTURES',residueCount:0});
      else await expect(run).rejects.toThrow(outcome==='residue'?'TEST_CLEANUP_RESIDUE':'TEST_CLEANUP_READ_FAILED');
    }
  });
});


describe('#46 closure requires exact native snapshot evidence', () => {
  const closurePlan=()=>({...plan([{repoFile:'0130_issue_46_refund_policy_snapshot',riskTier:'AUTHZ',sha256:'f'.repeat(64)}]),migrationScope:ISSUE_46_CLOSURE_COVERAGE.scope});
  const build=(raw:any)=>buildProductionDbTestCoverageEvidence({report:raw,plan:closurePlan(),sourceRunId:'123',sourceRunAttempt:1});
  it('fails closed for generic ACL green and missing REQUEST/seasonal exact cases', () => {
    expect(()=>build(report())).toThrow(/REQUIRED_SEMANTIC_TEST_MISSING/);
    expect(ISSUE_46_CLOSURE_COVERAGE.requiredAssertions.some(row=>row.file==='tests/integration/db/plan-seasonal-order-snapshot.42.test.ts')).toBe(true);
    expect(ISSUE_46_CLOSURE_COVERAGE.requiredAssertions.some(row=>row.fullName.includes('409 TOUR_001'))).toBe(true);
  });
  it('rejects missing/pending refund cases even if all other synthetic cases claim passed', () => {
    const rows=ISSUE_46_CLOSURE_COVERAGE.requiredAssertions;
    const files=[...new Set(rows.map(row=>row.file))];
    const raw=report({numTotalTests:rows.length,numPassedTests:rows.length,testResults:files.map(file=>({name:file,assertionResults:rows.filter(row=>row.file===file).map(row=>({status:'passed',fullName:row.fullName}))}))});
    // This synthetic report only exercises the exact-name gate; add current ACL
    // proof to distinguish missing behavior evidence from generic authz failure.
    const aclFile='tests/integration/api/tour-order-authz.447.test.ts';
    const contract=getProductionDbG3AuthzContract('0130_issue_46_refund_policy_snapshot');
    const acl=[...contract.tenantBoundaryAssertions,...contract.negativeRoleAssertions].map((row:any)=>({status:'passed',fullName:row.fragment}));
    raw.testResults.push({name:aclFile,assertionResults:acl});raw.numTotalTests+=acl.length;raw.numPassedTests+=acl.length;
    expect(build(raw).reportSuccess).toBe(true);
    const incomplete=structuredClone(raw);incomplete.testResults[0].assertionResults[0].fullName+='!';
    expect(()=>build(incomplete)).toThrow(/REQUIRED_SEMANTIC_TEST_MISSING/);
    const pending=structuredClone(raw);pending.testResults[0].assertionResults[0].status='pending';pending.numPassedTests--;pending.numPendingTests++;
    expect(()=>build(pending)).toThrow(/UNAPPROVED_VITEST_PENDING/);
  });
});


it('#46 closure independently reads owned refund/seasonal parent prefixes and rejects residue', async () => {
  for(const residue of [false,true]) {
    const seen:string[]=[];
    const fetchImpl=vi.fn(async(url:any,init:any)=>{
      const parsed=new URL(url);expect(init.method).toBe('GET');expect(['/rest/v1/trips','/rest/v1/tour_orders']).toContain(parsed.pathname);
      const filter=parsed.searchParams.get('slug') ?? parsed.searchParams.get('note')!;seen.push(filter);
      return new Response(JSON.stringify(residue&&filter==='like.refund-snapshot-46-%'?[{id:'leftover'}]:[]),{status:200});
    });
    const run=captureProductionDbTestCleanupEvidence({plan:{...plan([{repoFile:'0130_issue_46_refund_policy_snapshot',riskTier:'AUTHZ',sha256:'f'.repeat(64)}]),migrationScope:ISSUE_46_CLOSURE_COVERAGE.scope},testSupabaseUrl:TEST_URL,serviceRoleKey:'mock',sourceRunId:'123',sourceRunAttempt:1,fetchImpl});
    if(residue)await expect(run).rejects.toThrow(/TEST_CLEANUP_RESIDUE/);
    else {expect((await run).residueCount).toBe(0);expect(seen).toEqual(['like.request-accept-46-%','like.refund-snapshot-46-%','like.snapshot-42-%','like.#755 probe%']);}
  }
});


it('#46 closure requires exact #755/0136 native evidence and cleans its probe orders', () => {
  const rows=ISSUE_46_CLOSURE_COVERAGE.requiredAssertions.filter(row=>row.file==='tests/integration/api/create-tour-order-invoker.755.test.ts');
  expect(rows.map(row=>row.fullName.replace('#755 / 0136 create_tour_order refund policy snapshot boundary ',''))).toEqual([
    'service_role create_tour_order snapshots STANDARD/FLEXIBLE/STRICT equal to trips.refund_policy_type, then restores',
    'service_role create_tour_order rejects another tenant id for an existing departure without creating an order',
    'anon and authenticated roles cannot execute create_tour_order directly',
  ]);
  const closurePlan={...plan([{repoFile:'0130_issue_46_refund_policy_snapshot',riskTier:'AUTHZ',sha256:'f'.repeat(64)}]),migrationScope:ISSUE_46_CLOSURE_COVERAGE.scope};
  const all=ISSUE_46_CLOSURE_COVERAGE.requiredAssertions;
  const aclContract=getProductionDbG3AuthzContract('0130_issue_46_refund_policy_snapshot');
  const make=(skip:string|null)=>{
    const list:Array<{file:string;fullName:string;status:string}>=all.filter(row=>row.fullName!==skip).map(row=>({file:row.file,fullName:row.fullName,status:'passed'}));
    list.push(...[...aclContract.tenantBoundaryAssertions,...aclContract.negativeRoleAssertions].map((row:any)=>({file:'tests/integration/api/tour-order-authz.447.test.ts',fullName:row.fragment,status:'passed'})));
    const files=[...new Set(list.map(row=>row.file))];
    return report({numTotalTests:list.length,numPassedTests:list.length,testResults:files.map(file=>({name:file,assertionResults:list.filter(row=>row.file===file)}))});
  };
  const build=(raw:any)=>buildProductionDbTestCoverageEvidence({report:raw,plan:closurePlan,sourceRunId:'123',sourceRunAttempt:1});
  expect(build(make(null)).reportSuccess).toBe(true);
  for(const row of rows) expect(()=>build(make(row.fullName))).toThrow(/REQUIRED_SEMANTIC_TEST_MISSING/);
});

it('#46 closure REQUEST marker cleanup rejects residue and HTTP errors', async () => {
  for(const outcome of ['residue','error']) {
    const fetchImpl=vi.fn(async(url:any,init:any)=>{
      const parsed=new URL(url);expect(init.method).toBe('GET');
      if (parsed.pathname === '/rest/v1/tour_orders') {
        if (parsed.searchParams.get('note') === 'like.#755 probe%') return new Response('[]',{status:200});
        expect(parsed.searchParams.get('note')).toBe('like.request-accept-46-%');
        return new Response(JSON.stringify(outcome==='residue'?[{id:'leftover'}]:[]),{status:outcome==='error'?500:200});
      }
      expect(parsed.pathname).toBe('/rest/v1/trips');
      expect(['like.refund-snapshot-46-%','like.snapshot-42-%']).toContain(parsed.searchParams.get('slug'));
      return new Response('[]',{status:200});
    });
    await expect(captureProductionDbTestCleanupEvidence({plan:{...plan([{repoFile:'0111_issue_46_guide_request_accept',riskTier:'AUTHZ',sha256:'f'.repeat(64)}]),migrationScope:ISSUE_46_CLOSURE_COVERAGE.scope},testSupabaseUrl:TEST_URL,serviceRoleKey:'mock',sourceRunId:'123',sourceRunAttempt:1,fetchImpl})).rejects.toThrow(outcome==='residue'?'TEST_CLEANUP_RESIDUE':'TEST_CLEANUP_READ_FAILED');
  }
});


// Captured from actual main a30acac native collection with lock-pinned
// Vitest 4.1.11; these are formatter outputs, not reconstructed scenario names.
const actualSeasonalRendered46 = [
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'normal PER_PERSON × 3'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'normal PER_GROUP ignores party multip…'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'cross-year January inclusive endpoint'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'cross-year December inclusive endpoint'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'cross-year outside range uses base'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'winning null override uses base, not …'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'shortest span beats earlier sortOrder…'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'equal span chooses smaller sortOrder'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'zero override is a real free price, n…'",
  "#42 persisted seasonal prices become immutable TourOrder snapshots 'equal span and sortOrder uses stable …'"
];
it('#46 binds actual rendered seasonal titles and rejects the old raw names', () => {
  const seasonal='tests/integration/db/plan-seasonal-order-snapshot.42.test.ts';
  const requirements=ISSUE_46_CLOSURE_COVERAGE.requiredAssertions;
  const rows: Array<{file:string;fullName:string;status:string}>=requirements.filter(row=>row.file!==seasonal).map(row=>({...row,status:'passed'}));
  rows.push(...actualSeasonalRendered46.map(fullName=>({file:seasonal,fullName,status:'passed'})));
  const aclFile='tests/integration/api/tour-order-authz.447.test.ts';
  const acl=getProductionDbG3AuthzContract('0130_issue_46_refund_policy_snapshot');
  rows.push(...[...acl.tenantBoundaryAssertions,...acl.negativeRoleAssertions].map((row:any)=>({file:aclFile,fullName:row.fragment,status:'passed'})));
  const files=[...new Set(rows.map(row=>row.file))];
  const raw=report({numTotalTests:rows.length,numPassedTests:rows.length,testResults:files.map(file=>({name:file,assertionResults:rows.filter(row=>row.file===file)}))});
  const selected={...plan([{repoFile:'0130_issue_46_refund_policy_snapshot',riskTier:'AUTHZ',sha256:'f'.repeat(64)}]),migrationScope:ISSUE_46_CLOSURE_COVERAGE.scope};
  const build=(value:any)=>buildProductionDbTestCoverageEvidence({report:value,plan:selected,sourceRunId:'123',sourceRunAttempt:1});
  expect(build(raw).reportSuccess).toBe(true);
  const wrong=structuredClone(raw);
  wrong.testResults.find((file:any)=>file.name===seasonal)!.assertionResults[0].fullName='#42 persisted seasonal prices become immutable TourOrder snapshots normal PER_PERSON × 3';
  expect(()=>build(wrong)).toThrow(/REQUIRED_SEMANTIC_TEST_MISSING/);
  const pending=structuredClone(raw);pending.testResults.find((file:any)=>file.name===seasonal)!.assertionResults[0].status='pending';pending.numPassedTests--;pending.numPendingTests++;
  expect(()=>build(pending)).toThrow(/UNAPPROVED_VITEST_PENDING/);
});

describe('#725 N2 closure evidence follows plan migration content, not scope name', () => {
  const item=(repoFile:string)=>({repoFile,riskTier:'AUTHZ',sha256:'f'.repeat(64)});
  const fullPlan=(files:string[],scope?:string)=>({...plan(files.map(item)),...(scope?{migrationScope:scope}:{migrationScope:'FULL_PENDING_SET'})});
  const F_REFUND='tests/integration/db/tour-refund-snapshot.46.test.ts';
  const F_SEASONAL='tests/integration/db/plan-seasonal-order-snapshot.42.test.ts';
  const F_INVOKER='tests/integration/api/create-tour-order-invoker.755.test.ts';
  const F_REQUEST='tests/integration/api/tour-request-accept.46.test.ts';
  const rowsFor=(planValue:any,files:string[],skip:string|null=null)=>{
    const list:Array<{file:string;fullName:string;status:string}>=[];
    for(const m of planValue.migrations){
      const c=getProductionDbG3AuthzContract(m.repoFile);
      if(!c) continue; // 例如 0087 無 AUTHZ 契約，只受 closure 家族規則約束
      for(const f of c.requiredFiles) list.push({file:f,fullName:`dummy ${f}`,status:'passed'});
      list.push(...[...c.tenantBoundaryAssertions,...c.negativeRoleAssertions].map((r:any)=>({file:r.file??'tests/integration/api/tour-order-authz.447.test.ts',fullName:r.fragment,status:'passed'})));
      list.push(...(c.requiredAssertions??[]).map((r:any)=>({file:r.file,fullName:r.fullName,status:'passed'})));
    }
    list.push(...ISSUE_46_CLOSURE_COVERAGE.requiredAssertions.filter(r=>files.includes(r.file)&&r.fullName!==skip).map(r=>({file:r.file,fullName:r.fullName,status:'passed'})));
    const fs=[...new Set(list.map(r=>r.file))];
    return report({numTotalTests:list.length,numPassedTests:list.length,testResults:fs.map(file=>({name:file,assertionResults:list.filter(r=>r.file===file)}))});
  };
  const build=(p:any,raw:any)=>buildProductionDbTestCoverageEvidence({report:raw,plan:p,sourceRunId:'1',sourceRunAttempt:1});
  const exact=(file:string)=>ISSUE_46_CLOSURE_COVERAGE.requiredAssertions.filter(r=>r.file===file);

  it('FULL_PENDING_SET-style plan with 0130/0132/0136 requires every family of assertions (REQUEST included, #771 Codex P1)', () => {
    const p=fullPlan(['0130_issue_46_refund_policy_snapshot','0132_issue_42_seasonal_price_resolution','0136_issue_755_create_tour_order_invoker']);
    const all=[F_REQUEST,F_REFUND,F_SEASONAL,F_INVOKER];
    expect(build(p,rowsFor(p,all)).reportSuccess).toBe(true);
    for(const f of all){
      expect(exact(f).length).toBeGreaterThan(0);
      for(const row of exact(f)) expect(()=>build(p,rowsFor(p,all,row.fullName))).toThrow(/REQUIRED_SEMANTIC_TEST_MISSING/);
    }
  });

  const requires=(p:any,expected:string[])=>{
    const all=[F_REQUEST,F_REFUND,F_SEASONAL,F_INVOKER];
    expect(build(p,rowsFor(p,expected)).reportSuccess).toBe(true);
    // 只對「預期要求」的家族逐列缺漏必須 fail closed；未預期的家族不在報告內且仍通過（上一行 reportSuccess），
    // 這正是「不被觸發」的實際斷言，不另設空轉分支。
    for(const f of expected){
      for(const row of exact(f)) expect(()=>build(p,rowsFor(p,expected,row.fullName))).toThrow(/REQUIRED_SEMANTIC_TEST_MISSING/);
    }
    for(const f of all.filter(x=>!expected.includes(x))){
      expect(rowsFor(p,expected).testResults.some((file:any)=>file.name===f)).toBe(false);
    }
  };
  it('later create_tour_order writers inherit earlier contracts (#771 Codex P1)', () => {
    // #774：任何 writer（含較早的 0110／0130）重放都可能重置 0136 的 SECURITY INVOKER，故一律四家族。
    for(const name of ['0132_issue_42_seasonal_price_resolution','0136_issue_755_create_tour_order_invoker','0130_issue_46_refund_policy_snapshot','0110_issue_42_plan_duration_pricetype_yearround'])
      requires(fullPlan([name]),[F_REQUEST,F_REFUND,F_SEASONAL,F_INVOKER]);
  });

  it('every create_tour_order writer alone (even out of order) requires all four families (#774)', () => {
    const all=[F_REQUEST,F_REFUND,F_SEASONAL,F_INVOKER];
    const names:Record<string,string>={
      '0087':'0087_issue_8b_tour_orders','0088':'0088_issue_8b_tour_order_rpc_acl','0110':'0110_issue_42_plan_duration_pricetype_yearround',
      '0111':'0111_issue_46_guide_request_accept','0130':'0130_issue_46_refund_policy_snapshot',
      '0132':'0132_issue_42_seasonal_price_resolution','0136':'0136_issue_755_create_tour_order_invoker'};
    expect(Object.keys(names).sort()).toEqual([...CREATE_TOUR_ORDER_WRITER_PREFIXES].sort());
    for(const name of Object.values(names)){
      const p=fullPlan([name]);
      if(!getProductionDbG3AuthzContract(name)) p.migrations=p.migrations.map((m:any)=>({...m,riskTier:'SCHEMA_REPAIR'}));
      requires(p,all);
    }
  });

  it('0128 (not a create_tour_order writer) still triggers only the seasonal family', () => {
    requires(fullPlan(['0128_issue_42_plan_seasonal_pricing']),[F_SEASONAL]);
  });

  it('a plan with no closure member requires no closure assertions or cleanup scopes', async () => {
    const p=fullPlan(['0105_issue_44_traveler_risk_policies']);
    expect(build(p,report()).reportSuccess).toBe(true);
    const seen:string[]=[];
    const fetchImpl=vi.fn(async(url:any)=>{seen.push(new URL(url).search);return new Response('[]',{status:200});});
    await captureProductionDbTestCleanupEvidence({plan:p,testSupabaseUrl:TEST_URL,serviceRoleKey:'mock',sourceRunId:'1',sourceRunAttempt:1,fetchImpl});
    expect(seen.join('|')).not.toMatch(/request-accept-46|refund-snapshot-46|snapshot-42|755 probe/);
  });

  it('FULL_PENDING_SET plan cleans only the scopes of its selected members', async () => {
    const p=fullPlan(['0130_issue_46_refund_policy_snapshot','0136_issue_755_create_tour_order_invoker']);
    const seen:string[]=[];
    const fetchImpl=vi.fn(async(url:any)=>{const u=new URL(url);const v=u.searchParams.get('slug')??u.searchParams.get('note');if(v)seen.push(v);return new Response('[]',{status:200});});
    await captureProductionDbTestCleanupEvidence({plan:p,testSupabaseUrl:TEST_URL,serviceRoleKey:'mock',sourceRunId:'1',sourceRunAttempt:1,fetchImpl});
    expect(seen).toEqual(['like.request-accept-46-%','like.refund-snapshot-46-%','like.snapshot-42-%','like.#755 probe%']);
    const q=fullPlan(['0128_issue_42_plan_seasonal_pricing']);
    seen.length=0;
    await captureProductionDbTestCleanupEvidence({plan:q,testSupabaseUrl:TEST_URL,serviceRoleKey:'mock',sourceRunId:'1',sourceRunAttempt:1,fetchImpl});
    expect(seen).toEqual(['like.snapshot-42-%']);
  });

  it('0128-only plan labels the snapshot-42 cleanup scope with the triggering migration, not 0132 (#774)', async () => {
    const q=fullPlan(['0128_issue_42_plan_seasonal_pricing']);
    const r:any=await captureProductionDbTestCleanupEvidence({plan:q,testSupabaseUrl:TEST_URL,serviceRoleKey:'mock',sourceRunId:'1',sourceRunAttempt:1,fetchImpl:vi.fn(async()=>new Response('[]',{status:200})) as any});
    const text=JSON.stringify(r);
    expect(text).toContain('0128_issue_42_plan_seasonal_pricing');
    expect(text).not.toContain('0132_issue_42_seasonal_price_resolution');
  });

  it('every SQL migration that writes create_tour_order body/security/ACL is in CREATE_TOUR_ORDER_WRITER_PREFIXES (#774/#777)', () => {
    const dir=join(process.cwd(),'supabase/migrations');
    const files=readdirSync(dir).filter(f=>f.endsWith('.sql'));
    const scans=files.map(f=>({prefix:f.split('_')[0],scan:scanCreateTourOrderDdl(readFileSync(join(dir,f),'utf8'))}));
    const writers=scans.filter(x=>x.scan.writer).map(x=>x.prefix);
    expect(writers.length).toBeGreaterThan(0);
    for(const prefix of writers) expect(CREATE_TOUR_ORDER_WRITER_PREFIXES).toContain(prefix);
    for(const prefix of CREATE_TOUR_ORDER_WRITER_PREFIXES) expect(writers).toContain(prefix);
    // 唯一被排除的 create_tour_order DDL 是 0099（drop 舊 overload），且必須附理由。
    const excluded=scans.filter(x=>x.scan.drop&&!x.scan.writer).map(x=>x.prefix);
    expect(excluded).toEqual(['0099']);
    expect(Object.keys(CREATE_TOUR_ORDER_EXCLUDED_DDL)).toEqual(['0099']);
    expect(CREATE_TOUR_ORDER_EXCLUDED_DDL['0099']).toMatch(/overload/);
    expect(CREATE_TOUR_ORDER_WRITER_PREFIXES).not.toContain('0099');
    // schema 層級 ACL／動態 SQL fail closed：命中者必須逐檔列入 exclusion map（含理由）。
    for(const x of scans.filter(x=>x.scan.schemaWideAcl)) expect((CREATE_TOUR_ORDER_SCHEMA_WIDE_ACL_EXCLUSIONS as Record<string,string>)[x.prefix]).toMatch(/\S/);
    for(const x of scans.filter(x=>x.scan.unicodeIdentifier)) expect((CREATE_TOUR_ORDER_UNICODE_IDENTIFIER_EXCLUSIONS as Record<string,string>)[x.prefix]).toMatch(/\S/);
    const unresolved=scans.filter(x=>x.scan.unresolvedExecute).map(x=>x.prefix);
    for(const prefix of unresolved) expect((CREATE_TOUR_ORDER_UNRESOLVED_EXECUTE_EXCLUSIONS as Record<string,string>)[prefix]).toMatch(/\S/);
    // 排除表不得有已不再命中的陳舊項目。
    expect(Object.keys(CREATE_TOUR_ORDER_UNRESOLVED_EXECUTE_EXCLUSIONS).sort()).toEqual([...unresolved].sort());
    for(const x of scans.filter(x=>x.scan.dynamicSql)) expect(CREATE_TOUR_ORDER_WRITER_PREFIXES.includes(x.prefix)||!!(CREATE_TOUR_ORDER_DYNAMIC_SQL_EXCLUSIONS as Record<string,string>)[x.prefix]).toBe(true);
  });

  describe('scanCreateTourOrderDdl mutation cases (#777)', () => {
    const W='create or replace function public.create_tour_order(a int) returns void as $$ select 1 $$ language sql;';
    it.each([
      ['plain create or replace function', W],
      ['quoted schema and name', 'CREATE OR REPLACE FUNCTION "public"."create_tour_order"(a int) returns void as $$ select 1 $$ language sql;'],
      ['quoted name only', 'create function "create_tour_order"(a int) returns void as $$ select 1 $$ language sql;'],
      ['whitespace around the dot', 'create or replace function public . create_tour_order (a int) returns void as $$ select 1 $$ language sql;'],
      ['multi-line identifier', 'create or replace function\n  public\n  .\n  create_tour_order\n(a int) returns void as $$ select 1 $$ language sql;'],
      ['create or replace procedure', 'create or replace procedure public.create_tour_order(a int) as $$ select 1 $$ language sql;'],
      ['create or replace routine', 'create or replace routine public.create_tour_order(a int) as $$ select 1 $$ language sql;'],
      ['alter function', 'alter function public.create_tour_order(int) security invoker;'],
      ['alter routine', 'alter routine public.create_tour_order(int) security definer;'],
      ['alter routine quoted, no args', 'ALTER ROUTINE "public" . "create_tour_order" owner to postgres;'],
      ['revoke on function', 'revoke execute on function public.create_tour_order(int) from public;'],
      ['grant on routine quoted', 'grant execute on routine "public"."create_tour_order"(int) to service_role;'],
      ['grant on multiple functions', 'grant execute on function public.other(), public.create_tour_order(int) to service_role;'],
      ['write after a block comment', '/* header */ ' + W],
    ])('flags writer: %s', (_n, sql) => {
      expect(scanCreateTourOrderDdl(sql).writer).toBe(true);
    });

    it('string literals containing comment openers do not hide a real writer (#777 B1)', () => {
      const repro=`create table public.assets(path text check (path not like 'tmp/*'));
create or replace function public.create_tour_order(a int) returns void
language sql security definer as $$ select 1 $$;
/* 備註：上面改了安全屬性 */`;
      expect(scanCreateTourOrderDdl(repro).writer).toBe(true);
      expect(scanCreateTourOrderDdl("select '--'; create or replace function public.create_tour_order(a int) returns void as $$ $$;").writer).toBe(true);
      expect(scanCreateTourOrderDdl('select $t$ -- $t$; create or replace function public.create_tour_order(a int) returns void as $$ $$;').writer).toBe(true);
      expect(scanCreateTourOrderDdl("execute 'select 1 -- x' || 'create_tour_order';").dynamicSql).toBe(true);
    });

    it('Unicode-escaped quoted identifiers fail closed (#777 Codex P2)', () => {
      expect(scanCreateTourOrderDdl('CREATE FUNCTION U&"publ\\0069c".U&"create_tour_ord\\0065r"() returns void as $$ $$ language sql;').unicodeIdentifier).toBe(true);
      expect(scanCreateTourOrderDdl('create function public.u&"create_tour_ord\\+000065r"() returns void as $$ $$ language sql;').unicodeIdentifier).toBe(true);
      expect(scanCreateTourOrderDdl('alter function u&"x!0061" uescape \'!\' rename to y;').unicodeIdentifier).toBe(true);
      expect(scanCreateTourOrderDdl('create function public."create_tour_order"() returns void as $$ $$ language sql;').unicodeIdentifier).toBe(false);
      expect(scanCreateTourOrderDdl('-- U&"x"\n/* u&"y" */ select 1;').unicodeIdentifier).toBe(false);
    });

    it('Unicode string constants fail closed (#777 NB1)', () => {
      expect(scanCreateTourOrderDdl("execute U&'alter function public.create_tour_ord\\0065r() security definer';").unicodeIdentifier).toBe(true);
      expect(scanCreateTourOrderDdl("execute u&'x';").unicodeIdentifier).toBe(true);
      expect(scanCreateTourOrderDdl("select 'plain string', menu&'x';").unicodeIdentifier).toBe(false);
    });

    it('any schema qualifier and set schema count as writer (#777 NB2)', () => {
      const created='create function staging.create_tour_order() returns void as $$ $$ language sql;';
      expect(scanCreateTourOrderDdl(created).writer).toBe(true);
      expect(scanCreateTourOrderDdl('create function "my schema"."create_tour_order"() returns void as $$ $$ language sql;').writer).toBe(true);
      expect(scanCreateTourOrderDdl('alter function staging.create_tour_order() set schema public;').writer).toBe(true);
      expect(scanCreateTourOrderDdl('ALTER ROUTINE "staging" . "create_tour_order"(int) SET SCHEMA public;').writer).toBe(true);
      expect(scanCreateTourOrderDdl('alter procedure create_tour_order() set schema public;').writer).toBe(true);
      expect(scanCreateTourOrderDdl('alter function staging.tmp(int) rename to create_tour_order;').writer).toBe(true);
      expect(scanCreateTourOrderDdl('grant execute on function staging.create_tour_order(int) to anon;').writer).toBe(true);
      expect(scanCreateTourOrderDdl('revoke all on routine "s"."create_tour_order" from public;').writer).toBe(true);
      expect(scanCreateTourOrderDdl('create function staging.create_tour_order_v2() returns void as $$ $$ language sql;').writer).toBe(false);
    });

    it('identifier token handles "" escapes, three-part names and non-ASCII schemas (#777)', () => {
      const mk=(q:string)=>`create function ${q}() returns void as $$ $$ language sql;`;
      expect(scanCreateTourOrderDdl(mk('"a""b".create_tour_order')).writer).toBe(true);
      expect(scanCreateTourOrderDdl(mk('postgres.public.create_tour_order')).writer).toBe(true);
      expect(scanCreateTourOrderDdl(mk('éschema.create_tour_order')).writer).toBe(true);
      expect(scanCreateTourOrderDdl(mk('public.create_tour_order_v2')).writer).toBe(false);
      expect(scanCreateTourOrderDdl(mk('public.create_tour_orders')).writer).toBe(false);
      expect(scanCreateTourOrderDdl(mk('public.create_tour_orderé')).writer).toBe(false);
    });

    it('pathological inputs scan in bounded time (no catastrophic backtracking, #777)', () => {
      const time=(sql:string)=>{const t=performance.now();scanCreateTourOrderDdl(sql);return performance.now()-t;};
      expect(time('grant x on function '+'"'+'a'.repeat(20000)+'"')).toBeLessThan(200);
      expect(time('grant x on function '+'"aaa" '.repeat(3400))).toBeLessThan(200);
      expect(time('grant x on function '+'a.'.repeat(10000))).toBeLessThan(200);
      expect(time('select '+'"'+'a'.repeat(20000)+'"')).toBeLessThan(50);
    });

    it('EXECUTE whose target cannot be resolved statically fails closed (#777 Codex P2)', () => {
      const u=(sql:string)=>scanCreateTourOrderDdl(sql).unresolvedExecute;
      expect(u("EXECUTE 'alter function public.create_' || 'tour_order(int) security definer';")).toBe(true);
      expect(u("execute format('alter function %I.%I() security definer', 'public','create_tour_order');")).toBe(true);
      expect(u('execute v_sql;')).toBe(true);
      expect(u("execute 'select 1' || v_x;")).toBe(true);
      expect(u("do $$ begin execute pg_catalog.format('select %s', x) into y; end $$;")).toBe(true);
      expect(u("execute 'select 1';")).toBe(false);
      expect(u("execute 'select $1' using a;")).toBe(false);
      expect(u("execute $q$select 1$q$ into x;")).toBe(false);
      expect(u("execute 'it''s fine';")).toBe(false);
      expect(u('grant execute on function x() to y;')).toBe(false);
      expect(u('revoke execute on all functions in schema public from anon;')).toBe(false);
      expect(u('alter default privileges grant execute on functions to anon;')).toBe(false);
      expect(u('create trigger t before update on x for each row execute function public.f();')).toBe(false);
      expect(u("select 'execute v_sql;'; select \"execute\";")).toBe(false);
      expect(u('-- execute v_sql;\n/* execute x */ select 1;')).toBe(false);
    });

    it('E-string escapes, function/procedure variable names and dollar delimiters fail closed (#777)', () => {
      const u=(sql:string)=>scanCreateTourOrderDdl(sql).unresolvedExecute;
      expect(u("do $$ begin execute E'alter function public.create\\x5ftour_order(int) security definer'; end $$;")).toBe(true);
      expect(u("do $$ begin execute e'alter function public.create\\137tour_order(int) security definer'; end $$;")).toBe(true);
      expect(u("do $$ begin execute E'alter function public.create\\u005ftour_order(int) security definer'; end $$;")).toBe(true);
      expect(u("do $$ begin execute U&'alter function public.create\\005ftour_order(int) security definer'; end $$;")).toBe(true);
      expect(u("do $$ declare function text := 'alter function public.create_' || 'tour_order(int) security definer'; begin execute function; end $$;")).toBe(true);
      expect(u("do $$ declare procedure text := 'x'; begin execute procedure; end $$;")).toBe(true);
      expect(u("do $$ declare function text := 'x'; begin execute function(1); end $$;")).toBe(true);
      expect(u('select $x$a$x$execute v;')).toBe(true);
      expect(u("execute'select 1';")).toBe(false);
      expect(u('create trigger t before update on public.x for each row execute function public.f();')).toBe(false);
      expect(u('create constraint trigger t after insert on x deferrable for each row when (true) execute procedure "public"."f"(1);')).toBe(false);
      expect(u('create or replace trigger t before update on x for each row execute function f();')).toBe(false);
      expect(u('create event trigger e on ddl_command_start execute function public.f();')).toBe(false);
      expect(u('select 1; create trigger t before update on x for each statement execute function f();')).toBe(false);
      expect(u('grant execute on function x() to y;')).toBe(false);
    });

    it('unresolved EXECUTE scan is linear-time', () => {
      const t0=performance.now();
      scanCreateTourOrderDdl("execute 'select 1'"+" || 'x'".repeat(5000)+';');
      scanCreateTourOrderDdl("execute 'a';".repeat(5000));
      scanCreateTourOrderDdl('execute '+'$'.repeat(20000));
      scanCreateTourOrderDdl("execute "+"'"+'a'.repeat(20000)+"'");
      expect(performance.now()-t0).toBeLessThan(200);
    });

    it('nested block comments are stripped as one comment', () => {
      expect(scanCreateTourOrderDdl('/* outer /* inner */ '+W+' */ select 1;').writer).toBe(false);
      expect(scanCreateTourOrderDdl('/* outer /* inner */ x */ '+W).writer).toBe(true);
    });

    it.each([
      'alter function public.tmp(int) rename to create_tour_order;',
      'ALTER ROUTINE public.tmp(int) RENAME TO "create_tour_order";',
      'alter procedure public.tmp(int)\n  rename\n  to create_tour_order;',
    ])('flags rename to create_tour_order as writer: %#', (sql) => {
      expect(scanCreateTourOrderDdl(sql).writer).toBe(true);
    });

    it('malformed lexical forms throw instead of being skipped (fail closed)', () => {
      expect(() => scanCreateTourOrderDdl("select 'unterminated; "+W)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
      expect(() => scanCreateTourOrderDdl('select $$ unterminated; '+W)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
    });

    it('does not flag commented-out code (line and block comments)', () => {
      expect(scanCreateTourOrderDdl('-- '+W).writer).toBe(false);
      expect(scanCreateTourOrderDdl('/* '+W+'\n -- nested */ select 1;').writer).toBe(false);
      expect(scanCreateTourOrderDdl('/* a */ '+W+' /* b */').writer).toBe(true);
    });

    it('does not flag other functions or drop-only overload cleanup as a writer', () => {
      expect(scanCreateTourOrderDdl('create function public.create_tour_order_v2(a int) returns void as $$ select 1 $$ language sql;').writer).toBe(false);
      const drop=scanCreateTourOrderDdl('drop function if exists public.create_tour_order(uuid, int);');
      expect(drop.writer).toBe(false);
      expect(drop.drop).toBe(true);
      expect(scanCreateTourOrderDdl('DROP FUNCTION IF EXISTS "public"."create_tour_order"(uuid);').drop).toBe(true);
    });

    it.each([
      'grant execute on all functions in schema public to service_role;',
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;',
      'grant execute on all routines in schema "public" to authenticated;',
      'alter default privileges in schema public grant execute on functions to anon;',
      'ALTER DEFAULT PRIVILEGES\n  FOR ROLE postgres\n  REVOKE EXECUTE ON ROUTINES FROM public;',
    ])('flags schema-wide ACL fail closed: %s', (sql) => {
      expect(scanCreateTourOrderDdl(sql).schemaWideAcl).toBe(true);
    });

    it('ignores schema-wide ACL text inside comments and table-only default privileges', () => {
      expect(scanCreateTourOrderDdl('-- alter default privileges grant all on functions\n/* grant execute on all functions in schema public */').schemaWideAcl).toBe(false);
      expect(scanCreateTourOrderDdl('alter default privileges in schema public grant select on tables to anon;').schemaWideAcl).toBe(false);
      expect(scanCreateTourOrderDdl('grant select on all tables in schema public to anon;').schemaWideAcl).toBe(false);
    });

    it.each([
      "execute format('alter function public.%I(int) security definer', 'create_tour_order');",
      "do $$ begin execute 'revoke all on function public.' || 'create_tour_order' || '(int) from public'; end $$;",
      "EXECUTE\n  format('grant execute on function %s to anon', 'public.create_tour_order(int)');",
    ])('flags dynamic SQL mentioning create_tour_order: %#', (sql) => {
      expect(scanCreateTourOrderDdl(sql).dynamicSql).toBe(true);
    });

    it('plain grant/revoke execute and unrelated execute are not dynamic SQL', () => {
      expect(scanCreateTourOrderDdl('revoke execute on function public.create_tour_order(int) from public;').dynamicSql).toBe(false);
      expect(scanCreateTourOrderDdl("execute format('select 1 from %I', 'trips'); select create_tour_order(1);").dynamicSql).toBe(false);
      expect(scanCreateTourOrderDdl("-- execute format('x', 'create_tour_order');").dynamicSql).toBe(false);
    });
  });

  it('0128 alone (non-closure plan) requires every seasonal snapshot assertion (#771 NB1)', () => {
    const p=fullPlan(['0128_issue_42_plan_seasonal_pricing']);
    expect(exact(F_SEASONAL).length).toBeGreaterThan(0);
    expect(build(p,rowsFor(p,[F_SEASONAL])).reportSuccess).toBe(true);
    for(const row of exact(F_SEASONAL)) expect(()=>build(p,rowsFor(p,[F_SEASONAL],row.fullName))).toThrow(/REQUIRED_SEMANTIC_TEST_MISSING/);
  });

  it('coverage and cleanup share one mapping and cover every closure coverage file (#771 NB4)', () => {
    const coverageFiles=new Set(ISSUE_46_CLOSURE_COVERAGE.requiredAssertions.map(r=>r.file));
    expect(new Set(ISSUE_46_CLOSURE_FAMILIES.map(f=>f.file))).toEqual(coverageFiles);
    expect(new Set(Object.keys(ISSUE_46_CLOSURE_FILE_MIGRATIONS))).toEqual(coverageFiles);
    for(const family of ISSUE_46_CLOSURE_FAMILIES){
      expect(ISSUE_46_CLOSURE_FILE_MIGRATIONS[family.file]).toEqual(family.migrations);
      expect(family.cleanup.migration.split('_')[0]).toSatisfy((x:string)=>family.migrations.includes(x));
    }
  });

  it('closure scope still requires every assertion and all four cleanup scopes', () => {
    const p=fullPlan(['0130_issue_46_refund_policy_snapshot'],ISSUE_46_CLOSURE_COVERAGE.scope);
    expect(()=>build(p,rowsFor(p,[F_REFUND]))).toThrow(/REQUIRED_SEMANTIC_TEST_MISSING/);
    expect(build(p,rowsFor(p,[F_REFUND,F_SEASONAL,F_INVOKER,F_REQUEST])).reportSuccess).toBe(true);
  });
});

describe('plan migration identity fail-closed (#771 collaborator counterexample)', () => {
  const REAL = '0136_issue_755_create_tour_order_invoker';
  const row = (repoFile: unknown) => ({ repoFile, riskTier: 'SCHEMA_REPAIR', sha256: '2'.repeat(64) });
  const malformed: Record<string, any[]> = {
    'empty object row': [{}],
    'array row': [[REAL]],
    'null row': [null],
    'repoFile null': [row(null)],
    'repoFile number': [row(136)],
    'repoFile empty': [row('')],
    'repoFile leading space': [row(` ${REAL}`)],
    'repoFile path': [row(`supabase/migrations/${REAL}`)],
    'repoFile with .sql': [row(`${REAL}.sql`)],
    'duplicate identity': [row(REAL), row(REAL)],
    'valid row followed by null': [row(REAL), null],
  };
  for (const [label, migrations] of Object.entries(malformed)) {
    it(`coverage and cleanup reject ${label} with zero reads`, async () => {
      const bad = { ...plan(), migrations };
      expect(() => buildProductionDbTestCoverageEvidence({ report: report(), plan: bad, sourceRunId: '1', sourceRunAttempt: 1 }))
        .toThrow(/PLAN_MIGRATION_IDENTITY_INVALID/);
      const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
      await expect(captureProductionDbTestCleanupEvidence({ plan: bad, testSupabaseUrl: TEST_URL, serviceRoleKey: 'key', sourceRunId: '1', sourceRunAttempt: 1, fetchImpl: fetchSpy as unknown as typeof fetch }))
        .rejects.toThrow(/PLAN_MIGRATION_IDENTITY_INVALID/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it('a valid canonical plan still passes both entrypoints', async () => {
    const ok = plan();
    expect(buildProductionDbTestCoverageEvidence({ report: report(), plan: ok, sourceRunId: '1', sourceRunAttempt: 1 }).status).toBe('TEST_COVERAGE_VERIFIED');
    const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
    const r = await captureProductionDbTestCleanupEvidence({ plan: ok, testSupabaseUrl: TEST_URL, serviceRoleKey: 'key', sourceRunId: '1', sourceRunAttempt: 1, fetchImpl: fetchSpy as unknown as typeof fetch });
    expect(r.status).toBe('TEST_CLEANUP_VERIFIED');
  });
});

describe('producer and consumer share one migration identity validator (#774)', () => {
  it('normalizedRepoFile accepts exactly what the consumer regex accepts', () => {
    const samples=['0136_issue_755_create_tour_order_invoker','0105_x','Abc_1','0136','0136_Upper','0136-x','0136_a.b','_0136_x','0136_x.sql',' 0136_x','','a1234_x','0136_ä'];
    for(const v of samples){
      const consumer=CANONICAL_MIGRATION_IDENTITY.test(v);
      let producer=true;
      try{normalizedRepoFile(v);}catch{producer=false;}
      // producer 會 trim 前後空白，故以 trim 後的值比較一致性
      expect(producer).toBe(CANONICAL_MIGRATION_IDENTITY.test(v.trim()));
      if(v===v.trim()) expect(producer).toBe(consumer);
    }
  });
});
