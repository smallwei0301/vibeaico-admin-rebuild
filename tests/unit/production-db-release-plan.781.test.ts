import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { inferMigrationRiskTier, pgRe } from '../../scripts/agents/production-db-release-plan.mjs';

// #781：風險分類器改用 PostgreSQL 詞法（識別字含所有非 ASCII、空白只有 [ \t\n\r\f\v]）。

// 改寫前（origin/main 4679b611）對 supabase/migrations 內 83 支真實 migration 的分類結果；改寫後必須逐支相同。
const BASELINE_TIERS: Array<[string, string]> = [
  ['0001_extensions_and_functions.sql', 'AUTHZ'],
  ['0002_enums.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0003_tenants_and_accounts.sql', 'AUTHZ'],
  ['0004_core_business_tables.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0005_line_marketing_other.sql', 'ADDITIVE'],
  ['0006_rls_policies.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0007_views.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0008_storage_buckets.sql', 'ERR:MIXED_RISK_MIGRATION_NOT_ADMITTED'],
  ['0009_tenant_settings_insert_policy.sql', 'AUTHZ'],
  ['0010_auth_helpers.sql', 'AUTHZ'],
  ['0011_feature_store.sql', 'AUTHZ'],
  ['0012_points_transfer_and_bug_reports.sql', 'AUTHZ'],
  ['0013_cron_dedup_columns.sql', 'ADDITIVE'],
  ['0014_recreate_customers_view.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0065_issue_128_services_order_invariants.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0066_issue_8_tour_domain_core.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0067_issue_8_tour_integrity.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0068_issue_8_tour_rest_dml_acl.sql', 'ERR:DESTRUCTIVE_SQL_NOT_ADMITTED'],
  ['0069_welcome_card_images.sql', 'ERR:MIXED_RISK_MIGRATION_NOT_ADMITTED'],
  ['0070_welcome_card_image_retirement.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0071_welcome_card_image_retirement_acl.sql', 'AUTHZ'],
  ['0072_welcome_card_upload_acl.sql', 'ERR:MIXED_RISK_MIGRATION_NOT_ADMITTED'],
  ['0073_restore_keyword_reply_storage_write.sql', 'AUTHZ'],
  ['0074_block_times_recurrence_fields.sql', 'ERR:UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED'],
  ['0075_portfolios_line_sort_order.sql', 'ADDITIVE'],
  ['0076_customer_source.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0077_shop_design_branding.sql', 'ADDITIVE'],
  ['0078_staff_schedule_mode.sql', 'ERR:UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED'],
  ['0079_reconcile_category_bug_report_fields.sql', 'ADDITIVE'],
  ['0080_page_local_display_fields.sql', 'AUTHZ'],
  ['0081_reconcile_product_order_coupon_fields.sql', 'ADDITIVE'],
  ['0082_reconcile_booking_addon_notify_fields.sql', 'ERR:UNCLASSIFIED_DROP_NOT_ADMITTED'],
  ['0083_staff_display_fields.sql', 'ADDITIVE'],
  ['0084_catalog_position_bridge.sql', 'AUTHZ'],
  ['0086_keyword_reply_images_bucket.sql', 'BACKFILL'],
  ['0087_issue_8b_tour_orders.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0088_issue_8b_tour_order_rpc_acl.sql', 'AUTHZ'],
  ['0089_trip_display_fields.sql', 'ADDITIVE'],
  ['0090_atomic_booking_points_redemption.sql', 'AUTHZ'],
  ['0091_campaign_reward_grants.sql', 'AUTHZ'],
  ['0092_trip_departure_staff.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0093_booking_points_status_guard.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0094_tenant_payment_methods.sql', 'AUTHZ'],
  ['0095_platform_admin_impersonation.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0096_catalog_position_invariants.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0097_close_server_only_rpc_public_execute.sql', 'AUTHZ'],
  ['0098_reconcile_tour_orders_legacy_contact_columns.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0099_drop_legacy_create_tour_order_overload.sql', 'ERR:UNCLASSIFIED_DROP_NOT_ADMITTED'],
  ['0100_issue_350_expire_tour_order.sql', 'AUTHZ'],
  ['0101_catalog_rpc_close_public_and_anon_execute.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0102_assignment_tenant_parent_keys.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0103_tenants_business_type_contract.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0104_tour_order_lineage_keys.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0105_issue_44_traveler_risk_policies.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0106_deduplicate_redundant_indexes.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0107_issue_41_formation_state_model.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0108_issue_41_payment_state_model.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0109_issue_41_schema_precondition_assertions.sql', 'ERR:UNSUPPORTED_ROUTINE_INVOCATION_NOT_ADMITTED'],
  ['0110_issue_42_plan_duration_pricetype_yearround.sql', 'AUTHZ'],
  ['0111_issue_46_guide_request_accept.sql', 'AUTHZ'],
  ['0112_keyword_reply_images_upload_acl.sql', 'ERR:MIXED_RISK_MIGRATION_NOT_ADMITTED'],
  ['0113_issue_23_promotion_page_view_events.sql', 'AUTHZ'],
  ['0114_issue_22_banner_video_uploads.sql', 'ERR:MIXED_RISK_MIGRATION_NOT_ADMITTED'],
  ['0115_issue_21_external_calendars.sql', 'AUTHZ'],
  ['0116_issue_18_owner_notify.sql', 'AUTHZ'],
  ['0117_issue_25b_support_chat_threads.sql', 'AUTHZ'],
  ['0118_issue_25c_platform_donations.sql', 'AUTHZ'],
  ['0119_issue_18_owner_notify_confirm_atomic.sql', 'AUTHZ'],
  ['0121_issue_17_booking_addons_hardening.sql', 'AUTHZ'],
  ['0123_issue_589_richmenu_asset_retirement.sql', 'AUTHZ'],
  ['0124_issue_18_owner_notify_legacy_shape.sql', 'AUTHZ'],
  ['0125_issue_17_booking_addons_legacy_enum.sql', 'AUTHZ'],
  ['0126_issue_402_keyword_reply_images_authz.sql', 'AUTHZ'],
  ['0127_issue_589_authz_constraint_reconciliation.sql', 'AUTHZ'],
  ['0128_issue_42_plan_seasonal_pricing.sql', 'AUTHZ'],
  ['0129_issue_15_chat_images_bucket.sql', 'BACKFILL'],
  ['0130_issue_46_refund_policy_snapshot.sql', 'AUTHZ'],
  ['0131_issue_37_atomic_departure_staff.sql', 'AUTHZ'],
  ['0132_issue_42_seasonal_price_resolution.sql', 'AUTHZ'],
  ['0133_issue_680_booking_addons_composite_fk_expand.sql', 'AUTHZ'],
  ['0134_issue_37_rpc_invoker_owner_compat.sql', 'AUTHZ'],
  ['0135_issue_46_guide_interval_availability.sql', 'AUTHZ'],
  ['0136_issue_755_create_tour_order_invoker.sql', 'AUTHZ'],
];

describe('關鍵字邊界對齊 PG 識別字規則（#781 項目 1）', () => {
  it.each([
    ['alter table x drop constrainté;', '非 ASCII 接在 constraint 後是欄位名'],
    ['alter table x drop defaulté;', '非 ASCII 接在 default 後是欄位名'],
    ['alter table x drop constraint\u00a0y;', 'NBSP 在 PG 是識別字字元'],
    ['alter table x drop default\u2028y;', 'U+2028 在 PG 是識別字字元'],
    ['alter table x drop column constrainté;', 'DROP COLUMN 明示'],
  ])('%s（%s）判 DESTRUCTIVE', (sql) => {
    expect(() => inferMigrationRiskTier(sql)).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
  });

  it('對照組：真正的 DROP CONSTRAINT／DROP DEFAULT 仍是 SCHEMA_REPAIR，DROP COLUMN 仍被拒', () => {
    expect(inferMigrationRiskTier('alter table x drop constraint c;')).toBe('SCHEMA_REPAIR');
    expect(inferMigrationRiskTier('alter table x alter column a drop default;')).toBe('SCHEMA_REPAIR');
    expect(() => inferMigrationRiskTier('alter table x drop column y;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
  });

  it('關鍵字後接非 ASCII 是識別字的一部分，不是關鍵字（grante 不是 GRANT）', () => {
    expect(inferMigrationRiskTier('alter table x add column grant\u00e9 int;')).toBe('ADDITIVE');
    expect(inferMigrationRiskTier('alter table x add column grant int;')).toBe('AUTHZ');
  });

  it('pgRe：\\s 只認 PG 空白、\\b 以 PG 識別字字元為界、\\w 含非 ASCII', () => {
    expect(pgRe(/a\sb/).test('a\u00a0b')).toBe(false);
    expect(pgRe(/a\sb/).test('a\fb')).toBe(true);
    expect(pgRe(/\bdrop\b/i).test('dropé')).toBe(false);
    expect(pgRe(/\bdrop\b/i).test('x drop;')).toBe(true);
    expect(pgRe(/^[\w$]+$/).test('café$')).toBe(true);
    expect(pgRe(/a[\s\S]*b/).test('a\u00a0\nb')).toBe(true);
  });

  it('83 支真實 migration 的 risk tier 與改寫前完全相同', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const actual = new Map<string, string>();
    for (const [file] of BASELINE_TIERS) {
      const sql = readFileSync(join(dir, file), 'utf8');
      let tier: string;
      try {
        tier = inferMigrationRiskTier(sql, file.replace(/\.sql$/, ''));
      } catch (error) {
        tier = 'ERR:' + String((error as { code?: string; message: string }).code ?? (error as Error).message).slice(0, 60);
      }
      actual.set(file, tier);
    }
    expect(BASELINE_TIERS.length).toBe(83);
    expect(readdirSync(dir).filter((f) => f.endsWith('.sql')).length).toBeGreaterThanOrEqual(83);
    expect([...actual.entries()]).toEqual(BASELINE_TIERS);
  });
});

describe('standard_conforming_strings 一律 fail closed（#781 項目 2）', () => {
  it.each([
    "set standard_conforming_strings = 'off'; select 1;",
    'set standard_conforming_strings = false; select 1;',
    'set standard_conforming_strings to off; select 1;',
    'set local standard_conforming_strings TO \'off\';',
    'set "standard_conforming_strings" = off;',
    "select set_config('standard_conforming_strings', 'off', false);",
    "select set_config('Standard_Conforming_Strings','off',true);",
    'alter database postgres set standard_conforming_strings = off;',
  ])('%s', (sql) => {
    expect(() => inferMigrationRiskTier(sql)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
  });

  it('對照組：不提及該設定的語句不受影響', () => {
    expect(inferMigrationRiskTier('create table t (id int);')).toBe('ADDITIVE');
  });
});

describe('inferMigrationRiskTier 線性效能（#781 項目 3）', () => {
  it('400KB「alter function /* x */」病態輸入 < 2000ms（修前約 7～10 秒）', () => {
    const unit = 'alter function /* x */ ';
    const sql = unit.repeat(Math.ceil(400_000 / unit.length));
    const started = performance.now();
    inferMigrationRiskTier(sql);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(2000);
  }, 30_000);

  it('另一類病態輸入（create table 後接大量 grant 之外的 alter table）也不退化', () => {
    const unit = 'alter table t /* x */ ';
    const sql = unit.repeat(Math.ceil(200_000 / unit.length));
    const started = performance.now();
    try { inferMigrationRiskTier(sql); } catch { /* 拒絕與否不重要，只量時間 */ }
    expect(performance.now() - started).toBeLessThan(2000);
  }, 30_000);
});

describe('dollar-quote 分隔符緊貼關鍵字不得降級（#781 Final Risk B1）', () => {
  const head = 'create function f() returns void language sql as ';
  it.each<[string, string]>([
    [head + '$$select 1$$security definer;', 'AUTHZ'],
    ['create function f() returns void language plpgsql as $$begin perform 1; end$$security definer;', 'AUTHZ'],
    [head + '$$grant select on t to anon$$;', 'AUTHZ'],
    [head + '$f$revoke all on t from anon$f$;', 'AUTHZ'],
    [head + '$$alter role x superuser$$;', 'AUTHZ'],
    [head + '$$set role postgres$$;', 'AUTHZ'],
    [head + '$$reset role$$;', 'AUTHZ'],
  ])('%s -> %s', (sql, tier) => {
    expect(inferMigrationRiskTier(sql)).toBe(tier);
  });

  it.each([
    head + '$$truncate t$$;',
    head + '$$drop table t$$;',
  ])('%s 判 DESTRUCTIVE', (sql) => {
    expect(() => inferMigrationRiskTier(sql)).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
  });
});

describe('U&" 識別字與 ALTER ... SET fail closed（#781 Final Risk B2）', () => {
  it.each([
    'SET U&"standard_\\0063onforming_strings" = off;',
    'alter database postgres set U&"standard_\\0063onforming_strings" = off;',
    'set u&"standard_\\0063onforming_strings" = off;',
    'set U&"standard_!0063onforming_strings" UESCAPE \'!\' = off;',
    'alter database postgres set u&"x" uescape \'!\' = 1;',
  ])('%s', (sql) => {
    expect(() => inferMigrationRiskTier(sql)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
  });

  it.each([
    'alter database postgres set search_path = public;',
    'alter system set work_mem = 1;',
    'alter role x set search_path = public;',
    'alter user x set statement_timeout = 1;',
  ])('%s', (sql) => {
    expect(() => inferMigrationRiskTier(sql)).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
  });
});

describe('U& 解碼只針對 standard_conforming_strings（#781）', () => {
  it('無法解碼的跳脫 fail closed；無關名稱不受影響', () => {
    expect(() => inferMigrationRiskTier('set U&"standard_\\00zzonforming_strings" = off;')).toThrow(/UNSUPPORTED_SQL_LEXICAL_FORM/);
    expect(() => inferMigrationRiskTier('set U&"standard\\0063onforming_strings" = off;')).not.toThrow(/standard_conforming_strings via/);
  });
});
