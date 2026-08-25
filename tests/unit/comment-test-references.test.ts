/**
 * 「註解裡引用的測試檔必須真的存在」靜態鎖
 * -----------------------------------------------------------------------------
 * 這是本專案發現的一種假成功型態，記在 `14-GAP-AUDIT.md` §6.6：
 *
 *   程式碼註解裡寫「由 tests/⟨某個路徑⟩ 把關」，但那個檔案根本不存在。
 *
 * 危險之處在於它**看起來比沒有註解更可信**——讀 code review 的人看到那一行就
 * 不會再追，於是一段完全沒有測試覆蓋的程式碼，帶著一張偽造的通行證通過審查。
 * 成本極低、極難察覺。
 *
 * ⚠️ 這條鎖之所以存在，是因為**光把規則寫進稽核清單擋不住**：
 * 2026-08-25 把這個型態寫進 §6.6 之後**不到兩小時**，同一批工作裡就又長出一個：
 * `src/i18n/zh-TW/nav.ts:88` 的註解指向一個叫 `mode-links.test.ts` 的檔案，
 * 真名是 `mode-parent-links.29.test.ts`。人會忘記、改檔名時不會回頭改註解——
 * 只有機器每次都記得。
 *
 * ⚠️ 本檔的說明刻意**不寫成完整路徑形狀**（只寫檔名、不加 `tests/` 前綴），
 * 因為下面的正規式會把它當成真的引用。這比「把本檔排除在掃描範圍外」好——
 * 自我排除會變成一個誰都能往裡面丟壞引用而不被發現的漏洞。
 *
 * 這條鎖只驗「檔案存在」，不驗「內容真的涵蓋所宣稱的東西」——後者只能靠人讀。
 * 但至少把最廉價的那種假通行證擋掉。
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/** 掃 src 與 tests 兩邊——測試檔的註解也會互相引用 */
const FILES = [...walk(resolve(ROOT, 'src')), ...walk(resolve(ROOT, 'tests'))];
const REF = /tests\/[A-Za-z0-9_./-]+\.(?:test|spec)\.(?:ts|tsx|cjs|mjs)/g;

describe('註解裡引用的測試檔必須真的存在（§6.6 的假通行證）', () => {
  it('掃描範圍不是空的（避免這條規則靜悄悄失效）', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('src/ 與 tests/ 裡提到的每一個 tests/*.test.ts 路徑都指向真實檔案', () => {
    const missing: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(REF)) {
        const referenced = m[0];
        if (!existsSync(resolve(ROOT, referenced))) {
          missing.push(`${relative(ROOT, file)} → ${referenced}`);
        }
      }
    }
    expect(
      missing,
      '這些地方引用了不存在的測試檔——註解宣稱有測試把關，實際沒有：\n' +
        missing.join('\n') +
        '\n（改檔名時記得回頭改註解；或者那個測試根本還沒寫，那就別在註解裡宣稱它存在）',
    ).toEqual([]);
  });

  it('至少真的有在追蹤一些引用（否則正規式壞了也不會有人知道）', () => {
    const found = FILES.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(REF)].map((m) => m[0]));
    expect(new Set(found).size).toBeGreaterThan(3);
  });
});
