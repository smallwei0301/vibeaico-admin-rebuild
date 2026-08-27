import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(
  fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8',
);

describe('行程匯入／匯出接線（issue #8）', () => {
  it('service 只透過 API adapter 呼叫匯入與匯出端點', () => {
    const code = source('src/services/tours.ts');
    expect(code).toMatch(/request(?:<.*>)?\(\s*['"]\/api\/trips\/import['"]/);
    expect(code).toMatch(/request(?:<.*>)?\(\s*`\/api\/trips\/\$\{id\}\/export`/);
    expect(code).toMatch(/importTripsJson[\s\S]*?\(\) => null/);
    expect(code).toMatch(/exportTripJson[\s\S]*?\(\) => null/);
  });

  it('清單頁讀 JSON 檔案後 await service，成功後才重載', () => {
    const code = source('src/app/tenant/trips/page.tsx');
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).toContain('type="file"');
    expect(code).toContain('accept="application/json,.json"');
    expect(code).toContain('JSON.parse(await file.text())');
    expect(code).toContain('await importTripsJson(payload)');
    expect(code).toContain('await load()');
    expect(code).toContain('importNotDownloaded');
  });

  it('詳情頁有 await 匯出與 mock 未完成提示', () => {
    const code = source('src/app/tenant/trips/[id]/page.tsx');
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).toContain('await exportTripJson(tripId)');
    expect(code).toContain('exportNotDownloaded');
    expect(code).toContain('t.actions.exportJson');
  });
});
