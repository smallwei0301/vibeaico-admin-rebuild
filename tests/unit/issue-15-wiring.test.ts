import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('Issue #15 wiring stays on real service paths', () => {
  it('chat image UI waits for service response instead of creating a local success bubble', () => {
    const page = read('../../src/app/tenant/chat/page.tsx');
    const service = read('../../src/services/chat.ts');
    expect(page).toContain('sendImage({ lineUserId: targetId, file })');
    expect(page).not.toContain('URL.createObjectURL(file)');
    expect(page).toContain('setSendingImage(true)');
    expect(service).toContain('storageRef:');
    expect(service).not.toContain('originalContentUrl: uploaded.url');
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

  it('catalog reorder routes use one complete-collection RPC, not filtered row updates', () => {
    for (const routePath of [
      '../../src/app/api/services/reorder/route.ts',
      '../../src/app/api/services/reorder-line/route.ts',
      '../../src/app/api/products/reorder/route.ts',
      '../../src/app/api/products/reorder-line/route.ts',
      '../../src/app/api/portfolios/reorder/route.ts',
      '../../src/app/api/portfolios/reorder-line/route.ts',
    ]) {
      const route = read(routePath);
      expect(route).toContain('reorderCatalogItems');
      expect(route).not.toContain('.update(');
    }
    const migration = read('../../supabase/migrations/0019_issue_15_atomic_catalog_reorder.sql');
    expect(migration).toContain('reorder_catalog_items');
    expect(migration).toContain('with ordinality');
    expect(migration).toContain("errcode = '22023'");
  });

  it('create/duplicate return server positions and export validates real CSV downloads', () => {
    for (const routePath of [
      '../../src/app/api/services/route.ts',
      '../../src/app/api/products/route.ts',
      '../../src/app/api/portfolios/route.ts',
      '../../src/app/api/services/[id]/duplicate/route.ts',
    ]) {
      expect(read(routePath)).toContain('nextCatalogPositions');
    }
    const reports = read('../../src/services/reports.ts');
    expect(reports).toContain("startsWith('text/csv')");
    expect(reports).toContain('blob.size === 0');
    const exportHelpers = read('../../src/server/report-export.ts');
    expect(exportHelpers).toContain('日期區間需同時提供');
    expect(exportHelpers).toContain("typeof value === 'string'");
  });

  it('migration owns chat storage and the second sort column', () => {
    const migration = read('../../supabase/migrations/0017_issue_15_chat_images_and_dual_sort.sql');
    expect(migration).toContain("'chat-images'");
    expect(migration).toContain('line_sort_order');
    for (const migrationPath of [
      '../../supabase/migrations/0017_issue_15_chat_images_and_dual_sort.sql',
      '../../supabase/migrations/0020_issue_15_quota_rpc_guard.sql',
    ]) {
      const quotaMigration = read(migrationPath);
      expect(quotaMigration).toContain('returning true into accepted');
      expect(quotaMigration).toContain('p_count > p_quota');
      expect(quotaMigration).not.toContain('return found');
    }
  });
});
