export const PRODUCTION_DB_G3_AUTHZ_CONTRACTS = Object.freeze({
  '0105_issue_44_traveler_risk_policies': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/db/traveler-risk-policy.44.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/traveler-risk-policy.44.test.ts',
        fragment: 'A owner 指派一筆政策後，B owner 完全查不到',
      }),
      Object.freeze({
        file: 'tests/integration/db/traveler-risk-policy.44.test.ts',
        fragment: 'A owner 想寫入 tenant_id=B 店',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/traveler-risk-policy.44.test.ts',
        fragment: 'STAFF 讀得到，但寫不了',
      }),
    ]),
  }),
  '0110_issue_42_plan_duration_pricetype_yearround': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/tour-order-authz.447.test.ts',
      'tests/integration/api/plan-advanced-settings.10.test.ts',
      'tests/integration/api/tour-orders.10.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/tour-order-authz.447.test.ts',
        fragment: 'cross-tenant owner cannot use another tenant departure',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/tour-order-authz.447.test.ts',
        fragment: 'STAFF cannot use the MANAGER-only manual-order route',
      }),
      Object.freeze({
        file: 'tests/integration/api/tour-order-authz.447.test.ts',
        fragment: 'authenticated role cannot invoke SECURITY DEFINER create_tour_order directly',
      }),
    ]),
  }),
});

export function getProductionDbG3AuthzContract(repoFile) {
  return PRODUCTION_DB_G3_AUTHZ_CONTRACTS[String(repoFile ?? '').trim()] ?? null;
}
