import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('Issue #15 wiring stays on real service paths', () => {
  it('chat image UI waits for service response instead of creating a local success bubble', () => {
    const page = read('../../src/app/tenant/chat/page.tsx');
    expect(page).toContain('sendImage({ lineUserId: targetId, file })');
    expect(page).not.toContain('URL.createObjectURL(file)');
    expect(page).toContain('setSendingImage(true)');
  });

  it('reports UI downloads the reports endpoint, not unrelated exports', () => {
    const page = read('../../src/app/tenant/reports/page.tsx');
    expect(page).toContain('exportReports(format, rangeDates(range))');
    expect(page).not.toContain('exportCustomersExcel');
    expect(page).not.toContain('exportBookingsCsv');
  });

  it('all three sortable catalog pages expose the independent LINE endpoint', () => {
    for (const pagePath of [
      '../../src/app/tenant/services/page.tsx',
      '../../src/app/tenant/products/page.tsx',
      '../../src/app/tenant/portfolio/page.tsx',
    ]) {
      const page = read(pagePath);
      expect(page).toContain('reorder');
      expect(page).toMatch(/reorder(?:Services|Products|Portfolios)Line/);
    }
  });

  it('migration owns chat storage and the second sort column', () => {
    const migration = read('../../supabase/migrations/0017_issue_15_chat_images_and_dual_sort.sql');
    expect(migration).toContain("'chat-images'");
    expect(migration).toContain('line_sort_order');
  });
});
