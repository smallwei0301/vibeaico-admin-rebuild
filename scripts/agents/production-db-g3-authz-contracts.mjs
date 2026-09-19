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
  '0115_issue_21_external_calendars': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/db/external-calendars-rls.21.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/external-calendars-rls.21.test.ts',
        fragment: 'B 店登入使用者讀不到 A 店的 external calendar（tenant 隔離）',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/external-calendars-rls.21.test.ts',
        fragment: 'authenticated 角色不能直接寫入 external calendar event cache',
      }),
    ]),
  }),
  '0116_issue_18_owner_notify': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/db/owner-notify-rls.18.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/owner-notify-rls.18.test.ts',
        fragment: 'B 店登入使用者讀不到 A 店的 owner-notify bind request（tenant 隔離）',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/owner-notify-rls.18.test.ts',
        fragment: 'B 店登入使用者不能直接在 A 店建立 owner-notify bind request',
      }),
    ]),
  }),
  // 0124 only enables RLS on the historical recipient shape before 0116
  // completes the canonical table/policy shape. The same live-TEST RLS
  // assertions cover the compatibility precondition and the successor.
  '0124_issue_18_owner_notify_legacy_shape': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/db/owner-notify-rls.18.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/owner-notify-rls.18.test.ts',
        fragment: 'B 店登入使用者讀不到 A 店的 owner-notify bind request（tenant 隔離）',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/owner-notify-rls.18.test.ts',
        fragment: 'B 店登入使用者不能直接在 A 店建立 owner-notify bind request',
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
  '0119_issue_18_owner_notify_confirm_atomic': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/db/owner-notify-rls.18.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/owner-notify-rls.18.test.ts',
        fragment: '0119 owner-notify confirm RPC 僅在請求所屬租戶內確認，不可跨租戶消費 bind request',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/owner-notify-rls.18.test.ts',
        fragment: '0119 未登入與已登入角色都不得直接呼叫 confirm_owner_notify_bind RPC',
      }),
    ]),
  }),
  // 0125 only normalizes the historical enum before 0121 owns the current
  // booking-addons RPC contract. The live RPC, tenant-boundary, and role
  // assertions therefore cover both identities after the ordered pair runs.
  '0125_issue_17_booking_addons_legacy_enum': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/booking-addons.17.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/booking-addons.17.test.ts',
        fragment: 'A 店的 idempotency key 不得命中 B 店（即使字面值相同）',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/booking-addons.17.test.ts',
        fragment: '未登入與已登入使用者都不得直接呼叫 create_booking_addon／delete_booking_addon rpc',
      }),
    ]),
  }),
  '0121_issue_17_booking_addons_hardening': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/booking-addons.17.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/booking-addons.17.test.ts',
        fragment: 'A 店的 idempotency key 不得命中 B 店（即使字面值相同）',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/booking-addons.17.test.ts',
        fragment: '未登入與已登入使用者都不得直接呼叫 create_booking_addon／delete_booking_addon rpc',
      }),
    ]),
  }),
  '0123_issue_589_richmenu_asset_retirement': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/db/richmenu-asset-retirement-authz.589.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/richmenu-asset-retirement-authz.589.test.ts',
        fragment: 'retirement RPC is tenant-scoped: another tenant can retire the same URL independently',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/richmenu-asset-retirement-authz.589.test.ts',
        fragment: 'browser roles cannot execute or write richmenu retirement bookkeeping directly',
      }),
    ]),
  }),
  '0126_issue_402_keyword_reply_images_authz': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/upload-welcome-card.28.test.ts',
    ]),
    // 0126 is deliberately an ACL-only successor; tenant ownership is enforced
    // by the validated upload route and is not a new assertion of this SQL.
    tenantBoundaryAssertions: Object.freeze([]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/upload-welcome-card.28.test.ts',
        fragment: 'rejects direct authenticated keyword-reply-images uploads, same shape as welcome-card-images (#402)',
      }),
    ]),
  }),
});

export function getProductionDbG3AuthzContract(repoFile) {
  return PRODUCTION_DB_G3_AUTHZ_CONTRACTS[String(repoFile ?? '').trim()] ?? null;
}
