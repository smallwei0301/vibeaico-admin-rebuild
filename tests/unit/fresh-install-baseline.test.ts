import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BASELINE_MANIFEST,
  HISTORICAL_MANIFEST,
  planFreshInstallBaseline,
} from '../../scripts/agents/fresh-install-baseline.mjs';

const ROOT = process.cwd();
const canonicalDir = path.join(ROOT, 'supabase/migrations');
const historicalDir = path.join(ROOT, 'supabase/local-migrations/historical-integration-baseline');
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_MANIFEST), 'utf8'));
const historical = JSON.parse(fs.readFileSync(path.join(ROOT, HISTORICAL_MANIFEST), 'utf8'));
type PlannedFile = {
  name: string;
  content: Buffer;
  origin: string;
  sourcePath: string;
  classification?: string;
  localTransform?: string | null;
};
type BaselinePlan = {
  profile: string;
  files: PlannedFile[];
  compatibilityEntries: Array<{ name: string }>;
};
const canonical = fs.readdirSync(canonicalDir)
  .map((name) => ({ name, content: fs.readFileSync(path.join(canonicalDir, name)) }));

function plan(): BaselinePlan {
  return planFreshInstallBaseline(
    canonical,
    baseline,
    historical,
    (name: string) => fs.readFileSync(path.join(historicalDir, name)),
  ) as BaselinePlan;
}

describe('fresh-install compatibility baseline', () => {
  it('stages only the reviewed historical prerequisites around canonical main', () => {
    const result = plan();
    expect(result.profile).toBe('FRESH_INSTALL_COMPATIBILITY_BASELINE');
    expect(result.compatibilityEntries.map((entry) => entry.name)).toEqual([
      '0016_tour_domain_core.sql',
      '0017_chat_images_bucket_and_line_sort_order.sql',
      '0020_booking_addons.sql',
      '0026_tour_departures_addons_orders.sql',
      '0030_trip_plan_global_limit.sql',
      '0031_trip_plan_limit_lock_repair.sql',
      '0032_trip_plan_statement_guard.sql',
    ]);
    expect(result.files).toHaveLength(canonical.length + 7);
    expect(result.files.map((file) => file.name)).toEqual(
      [...result.files].map((file) => file.name).sort(),
    );
    expect(result.files.filter((file) => file.origin === 'COMPATIBILITY_ONLY'))
      .toHaveLength(7);
    expect(result.files.some((file) => file.name.startsWith('0038'))).toBe(false);
    expect(result.files.some((file) => file.name.startsWith('0040'))).toBe(false);
  });

  it('keeps booking_addons and next_tour_order_no births before their canonical consumers', () => {
    const result = plan();
    const names = result.files.map((file) => file.name);
    expect(names.indexOf('0020_booking_addons.sql')).toBeLessThan(
      names.indexOf('0082_reconcile_booking_addon_notify_fields.sql'),
    );
    expect(names.indexOf('0026_tour_departures_addons_orders.sql')).toBeLessThan(
      names.indexOf('0097_close_server_only_rpc_public_execute.sql'),
    );
    const bookingBirth = fs.readFileSync(path.join(historicalDir, '0020_booking_addons.sql'), 'utf8');
    const orderBirth = fs.readFileSync(path.join(historicalDir, '0026_tour_departures_addons_orders.sql'), 'utf8');
    expect(bookingBirth).toContain('create table booking_addons');
    expect(orderBirth).toContain('create or replace function next_tour_order_no');
  });

  it('preserves the Owner-approved statement-level 100-plan guard and lock', () => {
    const result = plan();
    for (const name of [
      '0030_trip_plan_global_limit.sql',
      '0031_trip_plan_limit_lock_repair.sql',
      '0032_trip_plan_statement_guard.sql',
    ]) {
      const entry = result.files.find((file) => file.name === name);
      expect(entry, name).toBeDefined();
      const source = entry!.content.toString('utf8');
      expect(source).toContain('lock table public.trip_plans in share row exclusive mode');
      expect(source).toContain('public.enforce_trip_plan_limit()');
      expect(source).toContain('> 100');
    }
    const statement = result.files.find((file) => file.name === '0032_trip_plan_statement_guard.sql')!
      .content.toString('utf8');
    expect(statement).toContain('referencing new table as new_trip_plans');
    expect(statement).toContain('for no key update');
    expect(statement).toContain('trip_plan_limit_guard_update');
    expect(baseline.contracts.tripPlanLimit).toMatchObject({
      maxPlansPerTenantTrip: 100,
      shape: 'STATEMENT_LEVEL',
      function: 'public.enforce_trip_plan_limit()',
    });
  });

  it('rejects a changed canonical byte digest or unapproved historical classification', () => {
    const changedCanonical = canonical.map((file) => ({ ...file }));
    changedCanonical[0] = { ...changedCanonical[0], content: Buffer.concat([changedCanonical[0].content, Buffer.from('-- changed\n')]) };
    expect(() => planFreshInstallBaseline(
      changedCanonical,
      baseline,
      historical,
      (name: string) => fs.readFileSync(path.join(historicalDir, name)),
    )).toThrow(/canonical migration bytes changed/);

    const changedManifest = structuredClone(baseline);
    changedManifest.entries[0].classification = 'ACTIVE_RUNTIME';
    expect(() => planFreshInstallBaseline(
      canonical,
      changedManifest,
      historical,
      (name: string) => fs.readFileSync(path.join(historicalDir, name)),
    )).toThrow(/invalid or colliding baseline entry/);
  });

  it('rejects tampered historical bytes and a weakened cap contract', () => {
    const tampered = structuredClone(baseline);
    tampered.entries[2].blobSha = crypto.createHash('sha1').update('tampered').digest('hex');
    expect(() => planFreshInstallBaseline(
      canonical,
      tampered,
      historical,
      (name: string) => fs.readFileSync(path.join(historicalDir, name)),
    )).toThrow(/exact historical source/);

    const weakened = structuredClone(baseline);
    weakened.contracts.tripPlanLimit.maxPlansPerTenantTrip = 101;
    expect(() => planFreshInstallBaseline(
      canonical,
      weakened,
      historical,
      (name: string) => fs.readFileSync(path.join(historicalDir, name)),
    )).toThrow(/approved statement-level 100-plan guard/);
  });

  it('keeps CI proof tied to exact statement triggers and a concurrent boundary race', () => {
    const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/agent-schema-bootstrap.yml'), 'utf8');
    expect(workflow).toContain("tgtype=4 AND tgnewtable='new_trip_plans'");
    expect(workflow).toContain("tgtype=16 AND tgnewtable='new_trip_plans'");
    expect(workflow).toContain("tgfoid=to_regprocedure('public.enforce_trip_plan_limit()')");
    expect(workflow).toContain('Prove the parent lock serializes two concurrent inserts');
    expect(workflow).toContain("application_name='issue-298-race-a' AND wait_event_type='Lock'");
    expect(workflow).not.toMatch(/\bsleep\s/);
    expect(workflow).toContain("[ \"$FINAL_COUNT\" != \"100\" ]");
  });
});
