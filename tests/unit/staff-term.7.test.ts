import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getTenantSettings, saveTenantSettings } from '@/services/settings';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/staff/page.tsx');

describe('staff #7: 自訂員工稱呼 saves through the real tenant-settings API, not a fake delay', () => {
  it('does not fake the save with a timeout, and calls saveTenantSettings with staffTerm in the patch', () => {
    // 反向斷言：原本的假延遲必須被移除
    expect(page).not.toContain('setTimeout(r, 320)');

    expect(page).toContain("from '@/services/settings'");
    expect(page).toContain('getTenantSettings');
    expect(page).toContain('saveTenantSettings');

    const modal = page.slice(
      page.indexOf('function StaffTermModal'),
      page.lastIndexOf('/* ============'),
    );
    const onClick = modal.slice(modal.indexOf('onClick={async () => {'), modal.indexOf('{common.save}'));
    // 儲存前先讀目前完整的 basic（PUT /api/settings 的 basic 群組是整包覆蓋，不是 partial）
    expect(onClick).toContain('const current = await getTenantSettings()');
    expect(onClick).toContain('await saveTenantSettings({ basic: { ...current.basic, staffTerm: nextTerm } })');
    // onSaved 必須在儲存成功之後才呼叫
    expect(onClick.indexOf('await saveTenantSettings')).toBeLessThan(onClick.indexOf('onSaved('));
  });

  it('shows the real backend error on failure, not a made-up message', () => {
    const modal = page.slice(
      page.indexOf('function StaffTermModal'),
      page.lastIndexOf('/* ============'),
    );
    expect(modal).toContain('catch (e)');
    expect(modal).toContain("setError(e instanceof Error ? e.message : t.messages.unknownError)");
    expect(modal).toContain('{error ? <FormError>{error}</FormError> : null}');
  });

  it('loads the current staffTerm from getTenantSettings() on page mount instead of an empty default', () => {
    const loadEffect = page.slice(
      page.indexOf('setStaffTermLoading(true);'),
      page.indexOf('}, [toast]);', page.indexOf('setStaffTermLoading(true);')),
    );
    expect(loadEffect).toContain('const settings = await getTenantSettings()');
    expect(loadEffect).toContain('setStaffTerm(settings.basic.staffTerm)');
  });

  it('an empty draft is sent as the explicit default term, not a bare empty string', () => {
    const modal = page.slice(page.indexOf('function StaffTermModal'), page.lastIndexOf('/* ============'));
    expect(modal).toContain("const nextTerm = draft.trim() || t.staffTerm.defaultTerm;");
  });
});

describe('staff #7 mock round-trip: saving staffTerm in mock mode actually persists', () => {
  it('a saved staffTerm shows up in the next getTenantSettings() read (survives a fresh "reload")', async () => {
    const before = await getTenantSettings();
    expect(before.basic.staffTerm).toBeTruthy();

    await saveTenantSettings({ basic: { ...before.basic, staffTerm: '設計師' } });

    const after = await getTenantSettings();
    expect(after.basic.staffTerm).toBe('設計師');

    // 恢復預設，避免污染其他測試的 mock 狀態
    await saveTenantSettings({ basic: { ...after.basic, staffTerm: '服務人員' } });
    const restored = await getTenantSettings();
    expect(restored.basic.staffTerm).toBe('服務人員');
  });

  it('saveTenantSettings does not touch other basic fields when only staffTerm changes', async () => {
    const before = await getTenantSettings();
    await saveTenantSettings({ basic: { ...before.basic, staffTerm: '教練' } });
    const after = await getTenantSettings();
    expect(after.basic.tenantName).toBe(before.basic.tenantName);
    expect(after.basic.shopCode).toBe(before.basic.shopCode);

    await saveTenantSettings({ basic: { ...after.basic, staffTerm: '服務人員' } });
  });
});
