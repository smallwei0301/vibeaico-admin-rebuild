import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  GUIDE_BASELINE_CAPABILITIES,
  isGuideBaselineCapability,
  resolveEntitlementSource,
} from '@/server/features';

const featureSource = readFileSync(
  resolve(process.cwd(), 'src/server/features.ts'),
  'utf8',
);
const tenantSource = readFileSync(
  resolve(process.cwd(), 'src/server/tenant.ts'),
  'utf8',
);

describe('GUIDE SaaS entitlement evaluator (#120-A)', () => {
  it('uses distinct GUIDE baseline capability names for basic notifications, reports, and availability', () => {
    expect(GUIDE_BASELINE_CAPABILITIES).toEqual([
      'GUIDE_TRANSACTION_NOTIFICATION',
      'GUIDE_BASIC_REPORT',
      'GUIDE_AVAILABILITY',
    ]);
    for (const capability of GUIDE_BASELINE_CAPABILITIES) {
      expect(isGuideBaselineCapability('GUIDE', capability)).toBe(true);
      expect(resolveEntitlementSource('GUIDE', capability, false)).toBe('GUIDE_BASELINE');
    }
  });

  it('does not silently promote old feature codes into the GUIDE baseline', () => {
    for (const oldFeatureCode of ['EMAIL_NOTIFICATION', 'BASIC_REPORT', 'SHIFT_MANAGEMENT']) {
      expect(resolveEntitlementSource('GUIDE', oldFeatureCode, false)).toBe('NONE');
      expect(resolveEntitlementSource('GUIDE', oldFeatureCode, true)).toBe('LEGACY_FEATURE');
    }
  });

  it('does not silently change LOCAL_SHOP or CLINIC Feature Store behavior', () => {
    for (const businessType of ['LOCAL_SHOP', 'CLINIC'] as const) {
      expect(resolveEntitlementSource(businessType, 'GUIDE_BASIC_REPORT', false)).toBe('NONE');
      expect(resolveEntitlementSource(businessType, 'BASIC_REPORT', true)).toBe('LEGACY_FEATURE');
    }
  });

  it('keeps existing GUIDE add-on and granted feature rows as a compatibility source', () => {
    expect(resolveEntitlementSource('GUIDE', 'AI_ASSISTANT', true)).toBe('LEGACY_FEATURE');
    expect(resolveEntitlementSource('GUIDE', 'AI_ASSISTANT', false)).toBe('NONE');
  });

  it('uses the server-owned tenant business type and does not create a parallel GUIDE feature truth', () => {
    expect(tenantSource).toContain("tenants(shop_code, name, business_type)");
    expect(tenantSource).toContain('businessType: ((m as any).tenants.business_type');
    expect(featureSource).toContain('businessType: BusinessType');
    expect(featureSource).toContain('source: EntitlementSource');
    expect(featureSource).not.toContain(".from('guide_features')");
    expect(featureSource).not.toMatch(/49|99|249/);
  });

  it('keeps the existing feature gate as the compatibility path while GUIDE routes get one new common entrypoint', () => {
    expect(featureSource).toContain('export async function isFeatureActive');
    expect(featureSource).toContain('export async function requireFeature');
    expect(featureSource).toContain('export async function getEntitlement');
    expect(featureSource).toContain('export async function isEntitled');
    expect(featureSource).toContain('export async function requireEntitlement');
  });
});
