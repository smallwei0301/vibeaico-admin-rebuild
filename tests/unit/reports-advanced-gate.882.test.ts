import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const page = read('src/app/tenant/reports/page.tsx');
const route = read('src/app/api/reports/advanced/route.ts');

describe('#882 進階報表 gate 與後端對齊', () => {
  it('頁面不再使用未收錄的 ADVANCED_REPORT 與 mock 預設解鎖旗標', () => {
    expect(page).not.toContain('ADVANCED_REPORT');
    expect(page).not.toContain('MOCK_ADVANCED_REPORT_SUBSCRIBED');
  });
  it('gate 使用型別化的 BASIC_REPORT', () => {
    expect(page).toContain("import type { FeatureCode } from '@/config/features'");
    expect(page).toMatch(/ADVANCED_GATE_CODE: FeatureCode = 'BASIC_REPORT'/);
    expect(page).toContain('f.code === ADVANCED_GATE_CODE');
  });
  it('找不到功能 → 視為未訂閱 (false)', () => {
    expect(page).toContain('setAdvancedUnlocked(found ? found.active : false)');
  });
  it('鎖定 CTA 導向 BASIC_REPORT', () => {
    expect(page).toContain('/tenant/feature-store?feature=${ADVANCED_GATE_CODE}');
  });
  it('API route 仍要求 BASIC_REPORT（與前端同步）', () => {
    expect(route).toMatch(/requireFeature\([^)]*'BASIC_REPORT'\)/);
  });
});
