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
  '0111_issue_46_guide_request_accept': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/tour-request-accept.46.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/tour-request-accept.46.test.ts',
        fragment: '別家店的訂單 → 404，不改動任何資料',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([]),
  }),
  '0113_issue_23_promotion_page_view_events': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/promotion-stats.23.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/promotion-stats.23.test.ts',
        fragment: 'B 店登入使用者讀不到 A 店的事件（tenant 隔離）',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/promotion-stats.23.test.ts',
        fragment: 'authenticated 角色沒有 insert policy',
      }),
    ]),
  }),
  // #455 TERRA_BUILD (2026-09-16): support_chat_threads/support_chat_messages
  // RLS (p_sct_r/p_sct_i/p_sct_u/p_scm_r/p_scm_i) already has real live-TEST
  // tenant-boundary coverage in the existing #? integration suite. There is no
  // negative-role restriction for this feature by design — STAFF is
  // deliberately allowed the same access as MANAGER/OWNER (support chat is a
  // communication channel, not a privileged action), which the existing test
  // asserts directly ("STAFF 也能建立 thread（這是溝通管道，不需要 MANAGER）"). An
  // empty `negativeRoleAssertions` here is therefore an honest reflection of
  // the feature, not a missing check.
  '0117_issue_25b_support_chat_threads': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/support-chat-threads.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/support-chat-threads.test.ts',
        fragment: 'B 店的列表裡沒有 A 店的 thread id',
      }),
      Object.freeze({
        file: 'tests/integration/api/support-chat-threads.test.ts',
        fragment: 'B 店直接打 A 店的 thread 詳情',
      }),
      Object.freeze({
        file: 'tests/integration/api/support-chat-threads.test.ts',
        fragment: 'B 店對 A 店的 thread 追加留言',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([]),
  }),
  '0118_issue_25c_platform_donations': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/donations.25c.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/donations.25c.test.ts',
        fragment: '別人的訂單 id 拿去 checkout 回 404',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([]),
  }),
});

export function getProductionDbG3AuthzContract(repoFile) {
  return PRODUCTION_DB_G3_AUTHZ_CONTRACTS[String(repoFile ?? '').trim()] ?? null;
}
