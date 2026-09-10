/**
 * tests/unit/impersonation-audit-coverage.test.ts
 * -----------------------------------------------------------------------------
 * 規格：`docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md` §2.4、§7 驗收 4
 *
 * PB-027：名字出現在某處，不等於那件事真的會發生。
 *
 * 這一層的第一版是一個要 route 自己換上的包裝（`handleTenantWrite`）。函式寫好了、
 * 註解寫好了、單元測試也綠了——但**沒有任何一支 route 用它**，所以代登入期間的寫入
 * 實際上一筆稽核都沒留。單元測試證的是「這個包裝正確」，不是「這個包裝有被接上」。
 *
 * 本檔證的是後者：所有寫入型 route 都經過 `handle()`，而 `handle()` 是稽核唯一的入口。
 * 任何人新開一支寫入端點卻繞過 `handle()`，這裡就會紅。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const API_ROOT = join(process.cwd(), 'src/app/api');
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * 明列的例外，每一條都要有理由。清單刻意寫死路徑：新增一支就必須在這裡具名，
 * 不能靠一條模糊的 pattern 讓未來的端點默默溜過去。
 *
 * - LINE webhook：呼叫方是 LINE 的伺服器，沒有登入者、沒有 cookie，
 *   代登入在這條路徑上不可能成立；它也需要原始 body 做簽章驗證，
 *   而且依 LINE 規範必須一律回 200，套用 `handle()` 的錯誤轉換反而是錯的。
 */
const AUDIT_EXEMPT = new Set(['src/app/api/line/webhook/[shopCode]/route.ts']);

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) routeFiles(p, acc);
    else if (entry === 'route.ts') acc.push(p);
  }
  return acc;
}

describe('代登入稽核的覆蓋範圍（PB-027：接上了才算數）', () => {
  const files = routeFiles(API_ROOT);

  it('掃到的 route 檔數量合理（掃不到東西的掃描器永遠是綠的）', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('每一支寫入型 route 的 handler 都包在 handle() 裡', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(process.cwd(), file).split('\\').join('/');
      if (AUDIT_EXEMPT.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      for (const method of WRITE_METHODS) {
        const assigned = src.match(new RegExp(`export const ${method}\\s*=\\s*([A-Za-z_$][\\w$]*)`));
        if (assigned && assigned[1] !== 'handle') {
          offenders.push(`${relative(process.cwd(), file)} → ${method} = ${assigned[1]}()`);
        }
        if (!assigned && new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`).test(src)) {
          offenders.push(`${relative(process.cwd(), file)} → ${method}（直接 function 宣告，沒過 handle()）`);
        }
      }
    }
    expect(
      offenders,
      `這些寫入端點沒有經過 handle()，代登入期間對它們的操作不會留下稽核紀錄：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('例外清單裡的檔案都還存在（清單腐化就等於偷偷放寬）', () => {
    for (const rel of AUDIT_EXEMPT) {
      expect(files.map((f) => relative(process.cwd(), f).split('\\').join('/'))).toContain(rel);
    }
  });

  it('http.ts 沒有第二個「寫入型 route 專用」的外層包裝可以繞過稽核', () => {
    const http = readFileSync(join(process.cwd(), 'src/server/http.ts'), 'utf8');
    const exportedWrappers = [...http.matchAll(/export function (\w+)\s*\(fn:/g)].map((m) => m[1]);
    expect(exportedWrappers).toEqual(['handle']);
  });
});
