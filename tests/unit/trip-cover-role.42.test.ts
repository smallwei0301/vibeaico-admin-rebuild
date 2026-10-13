import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canManageTripCover } from '@/lib/trip-cover';

describe('#42 封面權限（Codex P2）', () => {
  it('只有 OWNER／MANAGER 可更換封面', () => {
    expect(canManageTripCover('OWNER')).toBe(true);
    expect(canManageTripCover('MANAGER')).toBe(true);
    expect(canManageTripCover('STAFF')).toBe(false);
    expect(canManageTripCover(undefined)).toBe(false);
    expect(canManageTripCover(null)).toBe(false);
  });
  it('頁面 handler 在上傳／移除前先以 canEditCover 早退', () => {
    const src = readFileSync('src/app/tenant/trips/[id]/page.tsx', 'utf8');
    expect(src).toContain('canManageTripCover(currentTenant?.role)');
    expect(src).toMatch(/if \(!file \|\| !canEditCover \|\| coverListedBlocked \|\| coverBusy \|\| busy\) return;/);
    expect(src).toMatch(/if \(!canEditCover \|\| coverListedBlocked \|\| coverBusy \|\| busy\) return;/);
  });
});
