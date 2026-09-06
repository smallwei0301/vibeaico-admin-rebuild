import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Issue #34 靜態鎖：src/app/tenant/** 與 src/components/** 底下，任何檔案
 * 直接從 '@/mock' import 名稱以 MOCK_ 開頭的 binding，都必須出現在下面的
 * WHITELIST 裡，且每一筆都要有 reason + owner（issue 編號）——不接受沒主人
 * 的白名單條目（Issue #34 原文明講）。
 *
 * 背景：#34 的根因就是 AppShell 直接把 MOCK_SIDEBAR_COUNTS / MOCK_SETUP_STATUS /
 * MOCK_USER 塞進 Sidebar/Topbar，real 模式也照樣顯示假資料。這顆鎖不是要禁絕
 * MOCK_* import（骨架 demo 本來就需要），而是要讓「新增一個未經審查的直接
 * import」在 CI 就變紅，逼下一個人明確登記理由和 owner，而不是悄悄重蹈覆轍。
 *
 * `byMode()` / `applyMockMode()` 這類輔助函式不算「直接 import MOCK_*」，
 * 因為它們本身就是 CLAUDE.md 認可的、mode-safe 的存取方式，不在鎖定範圍內。
 */

const ROOTS = ['src/app/tenant', 'src/components'];
const REPO_ROOT = join(__dirname, '..', '..');

type WhitelistEntry = {
  file: string;
  /** 這個檔案直接 import 的、以 MOCK_ 開頭的 binding 名稱（含 applyMockMode 以外的 MOCK_* 常數） */
  bindings: string[];
  reason: string;
  owner: string;
};

/**
 * 白名單 —— 每一筆都必須是「已知、已審查、有主人」的直接 MOCK_* import。
 * 新增一筆前先確認：這個 import 是否只在 USE_MOCK 分支內使用？如果不是，
 * 這就是 #34 那種 bug，不該白名單，應該改走 src/services/* 的 adapt() service。
 */
const WHITELIST: WhitelistEntry[] = [
  {
    file: 'src/components/layout/AppShell.tsx',
    bindings: ['MOCK_TENANTS', 'MOCK_SIDEBAR_COUNTS', 'MOCK_SETUP_STATUS', 'MOCK_USER'],
    reason:
      '骨架 demo：切換店家時同步套用該業態的假資料（租戶清單/側欄徽章/開店進度/使用者名稱），' +
      '全部包在 `if (USE_MOCK)` 區塊內；real 分支改走 src/services/shell.ts 的 ' +
      'sidebarCounts()/currentUserName() 與 settings.ts 的 getSetupStatus()，不讀這幾個 binding。',
    owner: '#34',
  },
  {
    file: 'src/components/layout/BusinessTypeContext.tsx',
    bindings: ['MOCK_TENANTS'],
    reason:
      'React context 的預設值（僅在 Provider 缺席時的 fallback，不影響 real 模式下 ' +
      '正常掛載的頁面），沿用骨架既有作法，非 #34 範圍內的行為。',
    owner: '#34',
  },
  {
    file: 'src/app/tenant/customers/page.tsx',
    bindings: ['MOCK_CUSTOMERS'],
    reason:
      '骨架階段從假顧客資料推導「顧客標籤」下拉選單選項（對應原站 ' +
      '/api/customers/tags，尚未接後端），在 render 時求值以跟隨業態切換，' +
      '與 #34 的側欄外框值無關，維持既有骨架行為。',
    owner: '#7',
  },
];

/** 掃描一個目錄底下所有 .ts/.tsx 檔（略過 node_modules，此鎖不需要） */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 抓一個檔案裡所有 `import { A, B } from '@/mock'` 的具名 import，回傳其中以 MOCK_ 開頭的名字 */
function directMockBindings(source: string): string[] {
  const found: string[] = [];
  const importRe = /import\s*\{([^}]*)\}\s*from\s*['"]@\/mock['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source))) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+as\s+/)[0].trim()); // `Foo as Bar` → Foo
    for (const n of names) {
      if (n.startsWith('MOCK_')) found.push(n);
    }
  }
  return found;
}

function scan(): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const root of ROOTS) {
    const abs = join(REPO_ROOT, root);
    for (const file of listSourceFiles(abs)) {
      const src = readFileSync(file, 'utf8');
      const bindings = directMockBindings(src);
      if (bindings.length > 0) {
        hits.set(relative(REPO_ROOT, file), bindings);
      }
    }
  }
  return hits;
}

describe('Issue #34 — MOCK_* 直接 import 靜態鎖', () => {
  it('白名單每一筆都有 reason 與 owner（不接受沒主人的條目）', () => {
    for (const entry of WHITELIST) {
      expect(entry.reason.trim().length, `${entry.file} 缺 reason`).toBeGreaterThan(0);
      expect(entry.owner.trim().length, `${entry.file} 缺 owner`).toBeGreaterThan(0);
      expect(entry.owner).toMatch(/^#\d+$/);
    }
  });

  it('白名單登記的 bindings 與檔案實際 import 的內容一致（不是憑空登記）', () => {
    for (const entry of WHITELIST) {
      const full = join(REPO_ROOT, entry.file);
      const src = readFileSync(full, 'utf8');
      const actual = directMockBindings(src).sort();
      expect(actual, `${entry.file} 實際 import 與白名單登記不符`).toEqual([...entry.bindings].sort());
    }
  });

  it('src/app/tenant/** 與 src/components/** 沒有未登記在白名單的直接 MOCK_* import', () => {
    const hits = scan();
    const whitelistedFiles = new Set(WHITELIST.map((e) => e.file));

    const unlisted: string[] = [];
    for (const [file, bindings] of hits) {
      if (!whitelistedFiles.has(file)) {
        unlisted.push(`${file}: ${bindings.join(', ')}`);
      }
    }

    expect(
      unlisted,
      '發現未登記在白名單的直接 MOCK_* import — 請確認這是不是 #34 那種「real 模式也讀 mock」' +
        '的 bug；如果是刻意的骨架行為，補一筆有 reason + owner 的白名單條目。',
    ).toEqual([]);

    // 白名單裡列的每個檔案，也必須是真的還存在直接 import（避免白名單登記過期、
    // 掩蓋掉「其實已經修好了」或「檔案已經不在了」的事實）。
    for (const file of whitelistedFiles) {
      expect(hits.has(file), `白名單登記了 ${file}，但該檔案已經沒有直接 MOCK_* import 了 — 請移除白名單條目`).toBe(true);
    }
  });
});
