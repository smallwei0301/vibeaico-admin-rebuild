#!/usr/bin/env node
// scripts/db/schema-fingerprint-diff.mjs
//
// issue #197 建議處置第 1／第 4 步的工具：比對兩個 schema 的 public base table，
// 找出「repo 的 migrations 是否還能重現線上」。
//
// ## 為什麼不是「grep 欄位名有沒有出現在 migrations 目錄裡」
//
// #197 自己就標註過那個方法的缺陷：通用欄位名會產生偽陰性。`description` 因為
// 出現在 `services` 的建表語句裡，就讓 `service_categories.description` 被誤判為
// 「repo 有」。用出現次數代替實際結構，是 PB-027 的形狀。
//
// 這支腳本比的是**實際建出來的結構**：每張 public base table 取
// 「欄位數 + 排序後欄位名的 md5」當指紋。指紋相同即逐欄一致；不同才需要展開看
// 是哪幾欄。40 張表只需要一次查詢，適合放進 CI。
//
// ## 兩種來源
//
//   --project <ref>   經 Supabase Management API（純 HTTPS）。沙箱只放行 HTTPS，
//                     PostgreSQL wire protocol 穿不過政策代理——理由見
//                     `run-migrations.mjs` 檔頭。需要 SUPABASE_ACCESS_TOKEN。
//   --psql <conninfo> 經本機 psql，用來對「以 repo migrations 現建的乾淨資料庫」
//                     取指紋。conninfo 直接餵給 psql（例：'-h /tmp -p 5432 -U postgres dbname'）。
//   --file <path>     讀先前 --emit 出來的 JSON。
//
// ## 用法
//
//   # 取一份指紋存檔
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db/schema-fingerprint-diff.mjs \
//     --project nmwhwngojosmagjuvxol --emit test-schema.json
//
//   # 比對兩份（任意來源組合）；不一致時 exit 1，適合當 CI gate
//   node scripts/db/schema-fingerprint-diff.mjs \
//     --left  --psql '-h /tmp -p 5432 -U postgres repo_schema' \
//     --right --file test-schema.json
//
// ⚠️ 本腳本**只讀取** information_schema，不執行任何 DDL 或 DML。
// ⚠️ 它比的是欄位集合，不比型別、約束、索引。指紋一致 ≠ 完全一致——
//    別把它當成「完全對齊」的證明（那正是本腳本要防的那類推論）。

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.supabase.com';

/** 每張 public base table 一列：table|欄位數|排序後欄位名的 md5 */
const FINGERPRINT_SQL = `
select c.table_name || '|' || count(*) || '|' ||
       md5(string_agg(c.column_name, ',' order by c.column_name)) as line
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name = c.table_name
   and t.table_type = 'BASE TABLE'
 where c.table_schema = 'public'
 group by c.table_name
 order by c.table_name
`;

const COLUMNS_SQL = (table) => `
select string_agg(column_name, ',' order by column_name)
  from information_schema.columns
 where table_schema = 'public' and table_name = '${table.replace(/'/g, "''")}'
`;

function parseLines(lines) {
  const out = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const [table, count, hash] = line.split('|');
    out.set(table, { count: Number(count), hash });
  }
  return out;
}

async function viaProject(ref, query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('缺 SUPABASE_ACCESS_TOKEN（Supabase Personal Access Token，sbp_ 開頭）');
  const res = await fetch(`${API}/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API HTTP ${res.status}: ${text}`);
  const rows = JSON.parse(text);
  return rows.map((r) => String(Object.values(r)[0] ?? ''));
}

function viaPsql(conninfo, query) {
  const args = [...conninfo.split(/\s+/).filter(Boolean), '-tA', '-c', query];
  const out = execFileSync('psql', args, { encoding: 'utf8' });
  return out.split('\n');
}

async function load(source, query) {
  if (source.kind === 'project') return parseLines(await viaProject(source.value, query));
  if (source.kind === 'psql') return parseLines(viaPsql(source.value, query));
  if (source.kind === 'file') {
    const parsed = JSON.parse(readFileSync(source.value, 'utf8'));
    return new Map(Object.entries(parsed));
  }
  throw new Error(`未知來源：${source.kind}`);
}

/** 指紋不同時，把「只在左」「只在右」的欄位列出來（此時才需要第二次查詢）。 */
async function columnsOf(source, table) {
  if (source.kind === 'file') return null; // 檔案只存指紋，展不開
  const rows = source.kind === 'project'
    ? await viaProject(source.value, COLUMNS_SQL(table))
    : viaPsql(source.value, COLUMNS_SQL(table));
  return (rows[0] ?? '').split(',').filter(Boolean);
}

/**
 * `--left` / `--right` 是選用的：沒有寫的話，來源依出現順序填 left 再填 right。
 *
 * 這一點要明講，因為天真的寫法（用一個 `side` 變數、預設 'left'）會讓
 * `--psql A --file B` 把 B 覆蓋掉 A，然後**安靜地拿 B 跟 B 自己比**，回報
 * 「完全一致」。那正是這支腳本存在的目的所要防的事：一個看起來通過、實際上
 * 什麼都沒比的結果。
 */
function parseArgs(argv) {
  const sources = { left: null, right: null };
  let side = null;
  let emit = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--left' || a === '--right') { side = a.slice(2); continue; }
    if (a === '--emit') { emit = argv[++i]; continue; }
    if (a === '--project' || a === '--psql' || a === '--file') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} 後面缺少值`);
      const target = side ?? (sources.left ? 'right' : 'left');
      if (sources[target]) throw new Error(`${target} 已經指定過來源了（一邊只能有一個）`);
      sources[target] = { kind: a.slice(2), value };
      side = null;
      continue;
    }
    throw new Error(`未知參數：${a}`);
  }
  return { sources, emit };
}

async function main() {
  const { sources, emit } = parseArgs(process.argv.slice(2));
  if (!sources.left) {
    console.error('用法見本檔檔頭。至少要給一個來源（--project / --psql / --file）。');
    process.exit(2);
  }

  const left = await load(sources.left, FINGERPRINT_SQL);

  if (emit) {
    writeFileSync(emit, `${JSON.stringify(Object.fromEntries(left), null, 2)}\n`);
    console.log(`[schema-diff] 已寫出 ${left.size} 張表的指紋到 ${emit}`);
    if (!sources.right) return;
  }

  if (!sources.right) {
    for (const [table, fp] of [...left].sort()) console.log(`${table}|${fp.count}|${fp.hash}`);
    return;
  }

  const right = await load(sources.right, FINGERPRINT_SQL);
  const tables = [...new Set([...left.keys(), ...right.keys()])].sort();

  const onlyLeft = [];
  const onlyRight = [];
  const differing = [];
  for (const table of tables) {
    const l = left.get(table);
    const r = right.get(table);
    if (!r) { onlyLeft.push(table); continue; }
    if (!l) { onlyRight.push(table); continue; }
    if (l.hash !== r.hash) differing.push({ table, l, r });
  }

  const same = tables.length - onlyLeft.length - onlyRight.length - differing.length;
  console.log(`[schema-diff] 共 ${tables.length} 張表：${same} 張指紋一致`);

  if (onlyLeft.length) console.log(`\n只在左側存在（${onlyLeft.length}）：\n  ${onlyLeft.join('\n  ')}`);
  if (onlyRight.length) console.log(`\n只在右側存在（${onlyRight.length}）：\n  ${onlyRight.join('\n  ')}`);

  for (const { table, l, r } of differing) {
    console.log(`\n${table}：左 ${l.count} 欄 / 右 ${r.count} 欄`);
    const [lc, rc] = await Promise.all([columnsOf(sources.left, table), columnsOf(sources.right, table)]);
    if (!lc || !rc) { console.log('  （其中一側是指紋檔，展不開欄位）'); continue; }
    const ls = new Set(lc);
    const rs = new Set(rc);
    const onlyL = lc.filter((c) => !rs.has(c));
    const onlyR = rc.filter((c) => !ls.has(c));
    if (onlyL.length) console.log(`  只在左：${onlyL.join(', ')}`);
    if (onlyR.length) console.log(`  只在右：${onlyR.join(', ')}`);
  }

  const drifted = onlyLeft.length + onlyRight.length + differing.length;
  if (drifted) {
    console.error(`\n[schema-diff] ✗ ${drifted} 張表不一致。`);
    process.exit(1);
  }
  console.log('\n[schema-diff] ✓ 兩側的 public base table 欄位集合完全一致。');
}

main().catch((err) => {
  console.error('[schema-diff] 失敗：', err.message);
  process.exit(2);
});
