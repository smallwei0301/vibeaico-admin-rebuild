/**
 * tests/unit/impersonation-tenant-scope-lock.test.ts
 * -----------------------------------------------------------------------------
 * 規格：`docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md` §2.4
 *
 * 代登入分支**必然繞過 RLS**：管理者不是租戶成員，用他自己的 session client 一列都
 * 讀不到，所以那條路徑改用 service role。於是租戶邊界**完全落在解析出的 `tenantId`
 * 上，沒有第二道防線**——今天靠 RLS 兜底的查詢，在代登入下就是跨租戶查詢。
 *
 * 21 分冊承諾了一條原始碼鎖來守這件事。第一版沒交付；第二版交付了但強度不足，
 * 最終風險評估（第二輪）逐條點名並實證了四個漏抓，本版全部修掉：
 *
 *   1. 用**括號深度**找述句真正的結尾，不再用固定字元窗跨述句比對
 *      （舊版：後面 500 字內有別條查詢帶 tenant_id 就會誤放）
 *   2. 掃描範圍含 `src/server/**` 收 client 參數的 helper，不只 route.ts
 *      （舊版：helper 裡的洩漏永遠綠）
 *   3. 間接規則取**查詢之前最近的**宣告（不是檔案裡第一個同名變數），
 *      並追 `.update()`／`.upsert()`，也追 `rows.push({...})` 這種先宣告後填的寫法
 *   4. 有負向對照組：合成一段沒收窄的程式必須被判定為違規，
 *      否則 `isTenantScoped()` 恆真時「零違規」也會是綠的（PB-029）
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 明列的例外：這些查詢**本來就不該**以 tenant_id 收窄，鍵值本身就是邊界。
 * 每一條都要有理由，而且寫死路徑——新增一支就必須在這裡具名。
 */
const EXEMPT = new Map<string, string>([
  [
    'src/server/platform-admin.ts:platform_admins',
    'platform_admins 沒有 tenant_id 欄位（平台身分不屬於任何店），以 user_id 查是唯一的查法',
  ],
  [
    'src/server/platform-admin.ts:impersonation_sessions',
    'session 以 id／admin_user_id 收窄——「只有本人能結束自己的 session」正是這裡要的邊界；' +
      '以 tenant_id 收窄反而錯（管理者不是那家店的成員）',
  ],
  [
    'src/server/platform-admin.ts:impersonation_actions',
    'finishImpersonatedAction() 以 action id 補狀態碼；那一列是前一步剛插的，id 即邊界',
  ],
]);

/** 把註解換成等長空白：保留位移（行號才會對），但不讓註解裡的範例程式被當成真的查詢。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** 從 `.from(` 往後走到括號深度回到 0 的那個 `;`——述句真正的結尾。 */
function statementAt(src: string, index: number): string {
  let depth = 0;
  for (let i = index; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ';' && depth <= 0) return src.slice(index, i);
  }
  return src.slice(index);
}

/** 查詢之前最近的一次 `const/let <name>` 或 `<name>.push(`。 */
function nearestSourceOf(src: string, name: string, before: number): string[] {
  const found: string[] = [];
  for (const pattern of [
    new RegExp(`(?:const|let)\\s+${name}\\b`, 'g'),
    new RegExp(`\\b${name}\\.push\\(`, 'g'),
  ]) {
    let last = -1;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(src)) && m.index < before) last = m.index;
    if (last >= 0) found.push(statementAt(src, last));
  }
  return found;
}

export function isTenantScoped(src: string, index: number): boolean {
  const statement = statementAt(src, index);
  if (/tenant_id|tenantId/.test(statement)) return true;

  // 先把 payload 組好再交出去的寫法：追一層。再深的間接會讓這條鎖自己變成猜謎，
  // 寧可讓它紅、由人具名加進 EXEMPT。
  const indirect = statement.match(/\.(?:insert|update|upsert)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/);
  if (!indirect) return false;
  return nearestSourceOf(src, indirect[1], index).some((s) => /tenant_id|tenantId/.test(s));
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (entry.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

/** 代登入可達、且會碰資料庫的檔案。 */
function scannedFiles(): string[] {
  const out: string[] = [];
  for (const f of walk(join(process.cwd(), 'src/app/api'))) {
    if (!f.endsWith('route.ts')) continue;
    const src = readFileSync(f, 'utf8');
    if (/requireTenant\b|requireTenantManager\b/.test(src)) out.push(f);
  }
  for (const f of walk(join(process.cwd(), 'src/server'))) {
    const src = readFileSync(f, 'utf8');
    // 收 client 當參數的 helper：route 會把 `t.supabase`（代登入下是 service role）傳進來。
    if (/SupabaseClient/.test(src) && /\.from\(/.test(src)) out.push(f);
  }
  return out;
}

const FROM_RE = /\.from\(\s*[`'"]([A-Za-z_0-9]+)[`'"]\s*\)/g;

describe('代登入可達路徑的租戶收窄（21 分冊 §2.4 的原始碼鎖）', () => {
  const files = scannedFiles();

  it('掃到的檔案與查詢數量合理（掃不到東西的掃描器永遠是綠的）', () => {
    expect(files.length).toBeGreaterThan(100);
    let statements = 0;
    for (const f of files) {
      statements += (stripComments(readFileSync(f, 'utf8')).match(FROM_RE) ?? []).length;
    }
    expect(statements).toBeGreaterThan(400);
  });

  it('每一支查詢都在同一段述句裡收窄到解析出的 tenantId', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(process.cwd(), file).split('\\').join('/');
      const src = stripComments(readFileSync(file, 'utf8'));
      const re = new RegExp(FROM_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (EXEMPT.has(`${rel}:${m[1]}`)) continue;
        if (isTenantScoped(src, m.index)) continue;
        offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length} → ${m[1]}`);
      }
    }
    expect(
      offenders,
      '這些查詢沒有在同一段述句裡收窄到 tenantId。代登入下 RLS 不會兜底，' +
        `它們就是跨租戶查詢：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('例外清單裡的檔案都還存在（清單腐化就等於偷偷放寬）', () => {
    const rels = new Set(files.map((f) => relative(process.cwd(), f).split('\\').join('/')));
    for (const key of EXEMPT.keys()) expect(rels).toContain(key.split(':')[0]);
  });

  // ── 負向對照組：掃描器自己壞掉的話，上面兩條也會是綠的 ────────────────────
  describe('掃描器本身（對照組）', () => {
    const at = (snippet: string) => snippet.indexOf('.from(');

    it('沒有收窄的查詢會被判定為違規', () => {
      const s = `const { data } = await t.supabase.from('bookings').select('*').eq('status', 'PENDING');`;
      expect(isTenantScoped(s, at(s))).toBe(false);
    });

    it('後面另一條查詢帶 tenant_id 不能讓前一條過關（舊版字元窗的漏抓）', () => {
      const s =
        `const a = await t.supabase.from('bookings').select('*').in('id', ids);\n` +
        `const b = await t.supabase.from('services').select('*').eq('tenant_id', t.tenantId);`;
      expect(isTenantScoped(s, at(s))).toBe(false);
    });

    it('鏈上帶 tenant_id 會過關', () => {
      const s = `const { data } = await t.supabase.from('bookings').select('*').eq('tenant_id', t.tenantId);`;
      expect(isTenantScoped(s, at(s))).toBe(true);
    });

    it('先組 payload 再 insert（含 push）會過關', () => {
      const s =
        `const rows = [];\n` +
        `rows.push({ tenant_id: t.tenantId, name });\n` +
        `const { error } = await t.supabase.from('services').insert(rows);`;
      expect(isTenantScoped(s, s.indexOf(`.from('services')`))).toBe(true);
    });

    it('payload 變數本身沒有 tenant_id 就不會過關', () => {
      const s = `const rows = [{ name }];\nconst { error } = await t.supabase.from('services').insert(rows);`;
      expect(isTenantScoped(s, s.indexOf(`.from('services')`))).toBe(false);
    });

    it('註解裡的範例查詢不算數', () => {
      const s = stripComments(`// .from('services').select('*')\nconst x = 1;`);
      expect(new RegExp(FROM_RE.source, 'g').test(s)).toBe(false);
    });
  });
});
