import { ISSUE_46_0110_0136_CLOSURE, stripSqlComments } from './production-db-release-plan.mjs';

// G3 closure 原生驗收契約：REQUEST／refund snapshot／seasonal snapshot／#755 invoker 四個家族。
// 觸發規則見 ISSUE_46_CLOSURE_FAMILIES 與 CREATE_TOUR_ORDER_WRITER_PREFIXES：
// plan 含任一 create_tour_order 寫入者（完整清單見 CREATE_TOUR_ORDER_WRITER_PREFIXES，此處不列舉編號）即必須通過全部四個家族，
// 其餘 migration 只觸發各家族自己宣告的編號。coverage 與 cleanup 皆由同一份家族表推導。
// 0136 的 role/tenant fragment 契約在下方重用，不重複定義。
// 沒有任何合成的通過報告可以證明原生 snapshot 套件曾執行；缺任一 exact assertion 即 fail closed。
export const ISSUE_46_CLOSURE_COVERAGE = Object.freeze({
  scope: ISSUE_46_0110_0136_CLOSURE,

  requiredAssertions: Object.freeze([
    Object.freeze({ file: 'tests/integration/db/tour-refund-snapshot.46.test.ts', fullName: '#46 refund policy stays immutable on real TourOrders persists STANDARD, preserves the old whole order and updates only new snapshots' }),
    Object.freeze({ file: 'tests/integration/db/tour-refund-snapshot.46.test.ts', fullName: '#46 refund policy stays immutable on real TourOrders persists FLEXIBLE, preserves the old whole order and updates only new snapshots' }),
    Object.freeze({ file: 'tests/integration/db/tour-refund-snapshot.46.test.ts', fullName: '#46 refund policy stays immutable on real TourOrders persists STRICT, preserves the old whole order and updates only new snapshots' }),
    Object.freeze({"file": "tests/integration/api/tour-request-accept.46.test.ts", "fullName": "REQUEST 訂單送出申請時不鎖名額（18 分冊 §0.2；0111 修正的假成功） 建立 REQUEST 訂單後 seats_booked 完全不動，訂單以 PENDING／seats_reserved=false 入列"}),
    Object.freeze({"file": "tests/integration/api/tour-request-accept.46.test.ts", "fullName": "導遊接受 REQUEST 訂單（accept） 接受成功：鎖名額、hold_expires_at 用 plan 預設算出、狀態轉 CONFIRMED"}),
    Object.freeze({"file": "tests/integration/api/tour-request-accept.46.test.ts", "fullName": "導遊接受 REQUEST 訂單（accept） 重查名額時已被別的案件用掉 → 409 TOUR_001，且不改動任何資料"}),
    Object.freeze({"file": "tests/integration/api/tour-request-accept.46.test.ts", "fullName": "導遊接受 REQUEST 訂單（accept） 別家店的訂單 → 404，不改動任何資料"}),
    Object.freeze({"file": "tests/integration/api/tour-request-accept.46.test.ts", "fullName": "導遊拒絕 REQUEST 訂單（reject） 別家店的訂單 → 404，不改動任何資料"}),
    Object.freeze({"file": "tests/integration/api/tour-request-accept.46.test.ts", "fullName": "cancel_tour_order 對 seats_reserved 的守門（0111 Final Risk B1，claude-fable-5-1） 取消一筆從未被接受的 PENDING REQUEST 訂單 → 200，seats_booked 完全不動（從未鎖過，不該被放）"}),
    Object.freeze({"file": "tests/integration/api/tour-request-accept.46.test.ts", "fullName": "cancel_tour_order 對 seats_reserved 的守門（0111 Final Risk B1，claude-fable-5-1） 取消一筆已被接受（CONFIRMED，seats_reserved=true）的 REQUEST 訂單 → 名額釋放剛好一次"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'normal PER_PERSON × 3'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'normal PER_GROUP ignores party multip…'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'cross-year January inclusive endpoint'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'cross-year December inclusive endpoint'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'cross-year outside range uses base'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'winning null override uses base, not …'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'shortest span beats earlier sortOrder…'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'equal span chooses smaller sortOrder'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'zero override is a real free price, n…'"}),
    Object.freeze({"file": "tests/integration/db/plan-seasonal-order-snapshot.42.test.ts", "fullName": "#42 persisted seasonal prices become immutable TourOrder snapshots 'equal span and sortOrder uses stable …'"}),
    Object.freeze({ file: 'tests/integration/api/create-tour-order-invoker.755.test.ts', fullName: '#755 / 0136 create_tour_order refund policy snapshot boundary service_role create_tour_order snapshots STANDARD/FLEXIBLE/STRICT equal to trips.refund_policy_type, then restores' }),
    Object.freeze({ file: 'tests/integration/api/create-tour-order-invoker.755.test.ts', fullName: '#755 / 0136 create_tour_order refund policy snapshot boundary service_role create_tour_order rejects another tenant id for an existing departure without creating an order' }),
    Object.freeze({ file: 'tests/integration/api/create-tour-order-invoker.755.test.ts', fullName: '#755 / 0136 create_tour_order refund policy snapshot boundary anon and authenticated roles cannot execute create_tour_order directly' }),
  ]),
});

// 依 plan 實際 migration 內容觸發 closure 驗收（#725 Final Risk N2）：
// 每個 closure 原生測試檔由哪些 migration 編號保護；plan 含任一者即必須通過該檔的 exact assertions。
// 單一來源（#771 review NB1／NB4）：每個 closure 家族同時宣告「哪些 migration 編號觸發」與「對應 TEST cleanup 掃描範圍」，
// coverage（closureRequiredAssertionsForPlan）與 cleanup（test-artifacts cleanupScopes）都由此推導，無法各自漂移。
// 規則（#771 Codex P1）：任何後續 create_tour_order 的改寫者（create or replace）或變更者（alter）
// 都會承接並可能破壞先前所有 create_tour_order 契約，因此必須觸發其測試所經過的全部家族。
// 下表各家族 migrations 欄位只是「該家族自己的」觸發編號（逐檔核對 supabase/migrations）；
// 完整的 create_tour_order 改寫者集合（本體／SECURITY／ACL）以下方 CREATE_TOUR_ORDER_WRITER_PREFIXES 為準，會再併入每個家族。
// accept／reject／cancel／expire_tour_* 的最後改寫者為 0111（0130 之後沒有任何 migration 再動）；
// 0136 另外明確 grant select on trip_plan_seasons（0128 新表），故 seasonal 也由 0136 觸發。
// 單一來源：所有改寫 public.create_tour_order「本體／SECURITY 屬性／EXECUTE ACL」的 migration 編號
// （create or replace function、alter function、grant／revoke … on function public.create_tour_order）。
// 無論次序，任何一個仍 pending 的 writer 重放都可能覆寫較新的函式本體、SECURITY INVOKER 或 EXECUTE grants（#755 invoker 家族驗證），
// 因此都觸發全部四個家族。tests/unit 會掃描 supabase/migrations，新增 writer 卻漏列於此會使測試失敗。
// 證據：0087:160／0110:81／0111:124／0130:46／0132:45 為 create or replace，0136:30 為 alter function … security invoker，
// 0087:262／0088:16,28,40／0110:152 為 revoke／grant on function。
// 明確排除 0099：它 drop 的是另一個「舊簽章」overload（#37/#41 時期），不改現行函式的本體、安全屬性或 ACL。
export const CREATE_TOUR_ORDER_WRITER_PREFIXES = Object.freeze(['0087', '0088', '0110', '0111', '0130', '0132', '0136']);
export const CREATE_TOUR_ORDER_EXCLUDED_DDL = Object.freeze({
  '0099': 'drop function if exists 只移除舊簽章 overload，不改現行 create_tour_order 的本體／安全屬性／ACL',
});

// schema 層級的函式 ACL（grant/revoke … on all functions|routines in schema、alter default privileges … functions|routines）
// 與動態 SQL（execute 內含 create_tour_order）無法由靜態 regex 精確歸屬，一律 fail closed：
// 任何 migration 命中都必須在下列 map 逐檔附理由，否則 tests/unit 掃描失敗。
// 目前 supabase/migrations 沒有任何命中（0095／0101／0105 的 default privileges 字樣皆在註解內，已剝除）。
export const CREATE_TOUR_ORDER_SCHEMA_WIDE_ACL_EXCLUSIONS = Object.freeze({});
export const CREATE_TOUR_ORDER_DYNAMIC_SQL_EXCLUSIONS = Object.freeze({});
// Unicode 跳脫識別字（U&"publ\0069c"."create_tour_ord\0065r"）可拼出任何函式名而躲過字面比對，一律 fail closed：
// 命中 U&" 或 U&' 的 migration 必須在此逐檔附理由。目前 supabase/migrations 沒有任何命中。
export const CREATE_TOUR_ORDER_UNICODE_IDENTIFIER_EXCLUSIONS = Object.freeze({});

// 單一來源：create_tour_order DDL 掃描（#777）。純函式，同時供真實 migration 與合成 mutation 字串使用。
// 先以 lexer 剝除註解（註解內程式碼不會執行；字串內的 -- 或 /* 不當成註解），再以大小寫不敏感、跨行 regex 比對。
// 識別字容許引號與點號兩側空白：public.create_tour_order／"public"."create_tour_order"／public . create_tour_order。
// 註解剝除一律使用 release-plan 認得字串／引號識別字／dollar-quote／巢狀區塊註解的 lexer；畸形輸入會丟 UNSUPPORTED_SQL_LEXICAL_FORM（fail closed，不得吞掉）。
export { stripSqlComments };
// schema 限定詞不限 public（任何 schema 的 create_tour_order 都可能被 set schema／rename 搬進 public），一律 fail closed。
const TOUR_ORDER_IDENT = '(?:(?:"[^"]+"|[A-Za-z_][\\w$]*)\\s*\\.\\s*)?"?create_tour_order"?(?![\\w"])';
const ROUTINE_KIND = '(?:function|procedure|routine)';
const WRITER_RE = new RegExp(
  `\\b(?:create\\s+(?:or\\s+replace\\s+)?${ROUTINE_KIND}\\s+${TOUR_ORDER_IDENT}\\s*\\(`
  + `|alter\\s+${ROUTINE_KIND}\\s+${TOUR_ORDER_IDENT}`
  + `|alter\\s+${ROUTINE_KIND}\\b[^;]*?\\brename\\s+to\\s+${TOUR_ORDER_IDENT}`
  + `|(?:grant|revoke)\\b[^;]*?\\bon\\s+${ROUTINE_KIND}\\b[^;]*?${TOUR_ORDER_IDENT})`, 'i');
const DROP_RE = new RegExp(`\\bdrop\\s+${ROUTINE_KIND}\\s+(?:if\\s+exists\\s+)?${TOUR_ORDER_IDENT}`, 'i');
const SCHEMA_WIDE_ACL_RE = /\b(?:(?:grant|revoke)\b[^;]*?\bon\s+all\s+(?:functions|routines|procedures)\s+in\s+schema\b|alter\s+default\s+privileges\b[^;]*?\b(?:functions|routines|procedures)\b)/i;
// execute（排除 grant/revoke … execute on）語句內出現 create_tour_order；以 ; 為語句界線，保守 fail closed。
const UNICODE_IDENTIFIER_RE = /\bu&['"]/i;
const DYNAMIC_SQL_RE = /\bexecute\b(?!\s+on\b)[^;]*?create_tour_order/i;

export function scanCreateTourOrderDdl(sqlText) {
  const sql = stripSqlComments(sqlText);
  return {
    writer: WRITER_RE.test(sql),
    drop: DROP_RE.test(sql),
    schemaWideAcl: SCHEMA_WIDE_ACL_RE.test(sql),
    dynamicSql: DYNAMIC_SQL_RE.test(sql),
    unicodeIdentifier: UNICODE_IDENTIFIER_RE.test(sql),
  };
}

const ISSUE_46_CLOSURE_FAMILY_TABLE = Object.freeze([
  Object.freeze({
    file: 'tests/integration/api/tour-request-accept.46.test.ts',
    migrations: Object.freeze(['0111', '0130', '0132', '0136']),
    cleanup: Object.freeze({migration:'0111_issue_46_guide_request_accept',table:'tour_orders',filterColumn:'note',filterOperator:'like',filterValue:'request-accept-46-%'}),
  }),
  Object.freeze({
    file: 'tests/integration/db/tour-refund-snapshot.46.test.ts',
    migrations: Object.freeze(['0130', '0132', '0136']),
    cleanup: Object.freeze({migration:'0130_issue_46_refund_policy_snapshot',table:'trips',filterColumn:'slug',filterOperator:'like',filterValue:'refund-snapshot-46-%'}),
  }),
  Object.freeze({
    file: 'tests/integration/db/plan-seasonal-order-snapshot.42.test.ts',
    migrations: Object.freeze(['0128', '0132', '0136']),
    cleanup: Object.freeze({migration:'0132_issue_42_seasonal_price_resolution',table:'trips',filterColumn:'slug',filterOperator:'like',filterValue:'snapshot-42-%'}),
  }),
  Object.freeze({
    file: 'tests/integration/api/create-tour-order-invoker.755.test.ts',
    migrations: Object.freeze(['0136']),
    cleanup: Object.freeze({migration:'0136_issue_755_create_tour_order_invoker',table:'tour_orders',filterColumn:'note',filterOperator:'like',filterValue:'#755 probe%'}),
  }),
]);

// 家族實際觸發編號＝自身宣告編號 ∪ 全部 create_tour_order writer。
export const ISSUE_46_CLOSURE_FAMILIES = Object.freeze(ISSUE_46_CLOSURE_FAMILY_TABLE.map((family) => Object.freeze({
  ...family,
  migrations: Object.freeze([...new Set([...family.migrations, ...CREATE_TOUR_ORDER_WRITER_PREFIXES])].sort()),
})));

export const closureFamilyPrefixes = (family) => family.migrations;

export const ISSUE_46_CLOSURE_FILE_MIGRATIONS = Object.freeze(
  Object.fromEntries(ISSUE_46_CLOSURE_FAMILIES.map((family) => [family.file, family.migrations])));

const migrationPrefix = (migration) => String(migration?.repoFile ?? '').split('_')[0];

export function planHasClosureMigration(plan, prefixes) {
  const present = new Set((plan?.migrations ?? []).map(migrationPrefix));
  return prefixes.some((prefix) => present.has(prefix));
}

/** closure 專用 scope 一律全要；其他 scope（如 FULL_PENDING_SET）依 plan 內容逐檔觸發。 */
export function closureRequiredAssertionsForPlan(plan) {
  const all = plan?.migrationScope === ISSUE_46_CLOSURE_COVERAGE.scope;
  return ISSUE_46_CLOSURE_COVERAGE.requiredAssertions.filter((row) =>
    all || planHasClosureMigration(plan, ISSUE_46_CLOSURE_FILE_MIGRATIONS[row.file] ?? []));
}

export const PRODUCTION_DB_G3_AUTHZ_CONTRACTS = Object.freeze({
  // Remote G3 requires every semantic case; the isolated raw catalog case
  // remains explicitly NOT_RUN remotely and cannot establish catalog evidence.
  '0135_issue_46_guide_interval_availability': Object.freeze({
    requiredFiles: Object.freeze(["tests/integration/db/guide-interval-availability.46.test.ts"]),
    requiredAssertions: Object.freeze([
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate persists canonical default and two-value CHECK, refusing unknown/null policy",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate allows default policy without shifts but excludes foreign/missing/inactive/unbookable staff",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for invalid interval null/2030-01-15T03:00:00Z",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for invalid interval 2030-01-15T02:00:00Z/null",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for invalid interval 2030-01-15T03:00:00Z/2030-01-15T02:00:00Z",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for invalid interval 2030-01-15T02:00:00Z/2030-01-15T02:00:00Z",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for invalid interval -infinity/2030-01-15T03:00:00Z",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for invalid interval 2030-01-15T02:00:00Z/infinity",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate revokes both authenticated and anonymous invocation while service role works",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate requires whole interval union coverage; adjacent shifts join, a gap rejects",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate uses tenant Tokyo and New York DST calendar wall times for shifts",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for DST gap/fold shift 2030-03-10",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for DST gap/fold shift 2030-11-03",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for corrupt timezone null",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for corrupt timezone",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for corrupt timezone invalid/zone",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for corrupt timezone 8",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate uses default only for missing legacy settings",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate booking PENDING has the canonical occupancy behavior",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate booking CONFIRMED has the canonical occupancy behavior",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate booking CANCELLED has the canonical occupancy behavior",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate booking COMPLETED has the canonical occupancy behavior",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate single block includes whole-tenant/personal scope null",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate single block includes whole-tenant/personal scope personal",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate weekly block follows tenant calendar and retained duration across DST, not fixed +08",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate full-day weekly block ends at next local midnight 2030-11-03T04:00:00Z",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate full-day weekly block ends at next local midnight 2030-03-10T05:00:00Z",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate unrelated historical/future ambiguous shifts and departures do not poison a covered interval",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate ambiguous recurring block wall time cannot report available",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate noncancelled departure blocks PRIMARY using Plan duration; cancellation releases",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate noncancelled departure blocks ASSISTANT using Plan duration; cancellation releases",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate no-time departure occupies the tenant calendar day (23-hour DST day)",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate active external ERROR keeps cached UTC busy truth, inactive does not block",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate fails closed for a mismatched cached-event tenant instead of silently ignoring it",
      "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate rejects Kwajalein 23-hour fold, while unambiguous adjacent calendar dates are covered",
    ].map((fullName) => Object.freeze({ file: "tests/integration/db/guide-interval-availability.46.test.ts", fullName }))),
    localOnlyPending: Object.freeze({
      file: "tests/integration/db/guide-interval-availability.46.test.ts",
      fullName: "Issue #46 admitted native availability contract 0135 staff policy and service-only tenant interval predicate reads actual isolated PostgreSQL tzdata and function ACL/catalog",
    }),
    tenantBoundaryAssertions: Object.freeze([Object.freeze({
      file: "tests/integration/db/guide-interval-availability.46.test.ts",
      fragment: 'allows default policy without shifts but excludes foreign/missing/inactive/unbookable staff',
    })]),
    negativeRoleAssertions: Object.freeze([Object.freeze({
      file: "tests/integration/db/guide-interval-availability.46.test.ts",
      fragment: 'revokes both authenticated and anonymous invocation while service role works',
    })]),
  }),
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
  '0127_issue_589_authz_constraint_reconciliation': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/authz-constraint-reconciliation.589.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/authz-constraint-reconciliation.589.test.ts',
        fragment: 'authenticated tenant cannot read another tenant booking addons or owner notify recipients',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/authz-constraint-reconciliation.589.test.ts',
        fragment: 'anon cannot read or write reconciled tables while authenticated addon writes remain denied',
      }),
    ]),
  }),
  '0128_issue_42_plan_seasonal_pricing': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/db/plan-seasonal-pricing.42.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/plan-seasonal-pricing.42.test.ts',
        fragment: 'B 店 owner 完全查不到（tenant 隔離）',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/db/plan-seasonal-pricing.42.test.ts',
        fragment: 'authenticated 角色不能直接寫入 seasonal pricing',
      }),
    ]),
  }),
  // 0130 and 0132 replace the same service_role-only create_tour_order
  // function while preserving its tenant and browser-role boundary. Bind both
  // identities to the live route/direct-RPC assertions instead of inheriting a
  // generic suite-green claim.
  '0130_issue_46_refund_policy_snapshot': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/tour-order-authz.447.test.ts',
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
        fragment: 'authenticated role cannot invoke SECURITY DEFINER create_tour_order directly',
      }),
    ]),
  }),
  '0131_issue_37_atomic_departure_staff': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/departure-staff-rpc-acl.37.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/departure-staff-rpc-acl.37.test.ts',
        fragment: 'service_role RPC rejects another tenant id for an existing departure without mutation',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/departure-staff-rpc-acl.37.test.ts',
        fragment: 'anon and authenticated roles cannot execute replace_trip_departure_staff directly',
      }),
    ]),
  }),
  '0134_issue_37_rpc_invoker_owner_compat': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/departure-staff-rpc-acl.37.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/departure-staff-rpc-acl.37.test.ts',
        fragment: 'service_role RPC rejects another tenant id for an existing departure without mutation',
      }),
      Object.freeze({
        file: 'tests/integration/api/departure-staff-rpc-acl.37.test.ts',
        fragment: 'service_role writes and reads back a nonempty assignment, then restores the fixture',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/departure-staff-rpc-acl.37.test.ts',
        fragment: 'anon and authenticated roles cannot execute replace_trip_departure_staff directly',
      }),
    ]),
  }),
  '0136_issue_755_create_tour_order_invoker': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/create-tour-order-invoker.755.test.ts',
    ]),
    tenantBoundaryAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/create-tour-order-invoker.755.test.ts',
        fragment: 'service_role create_tour_order rejects another tenant id for an existing departure without creating an order',
      }),
      Object.freeze({
        file: 'tests/integration/api/create-tour-order-invoker.755.test.ts',
        fragment: 'service_role create_tour_order snapshots STANDARD/FLEXIBLE/STRICT equal to trips.refund_policy_type, then restores',
      }),
    ]),
    negativeRoleAssertions: Object.freeze([
      Object.freeze({
        file: 'tests/integration/api/create-tour-order-invoker.755.test.ts',
        fragment: 'anon and authenticated roles cannot execute create_tour_order directly',
      }),
    ]),
  }),
  '0132_issue_42_seasonal_price_resolution': Object.freeze({
    requiredFiles: Object.freeze([
      'tests/integration/api/tour-order-authz.447.test.ts',
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
        fragment: 'authenticated role cannot invoke SECURITY DEFINER create_tour_order directly',
      }),
    ]),
  }),
  // 0133 changes only the FK shape used by the booking-addons read path; the
  // existing RPC assertions remain the canonical tenant/role boundary.
  '0133_issue_680_booking_addons_composite_fk_expand': Object.freeze({
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
});

export function getProductionDbG3AuthzContract(repoFile) {
  return PRODUCTION_DB_G3_AUTHZ_CONTRACTS[String(repoFile ?? '').trim()] ?? null;
}
