#!/usr/bin/env node
// scripts/db/run-migrations.mjs
//
// 依序把 supabase/migrations/000N_*.sql 套用到指定的 Supabase 專案。
//
// 為什麼用 Management API 而不是 psql / supabase db push：
//   本專案的開發沙箱只放行 HTTPS（流量都經一個會重新終結 TLS 的政策代理），
//   PostgreSQL 的 wire protocol（psql、pooler、supabase db push 都用它）無法穿過
//   —— CONNECT 到 5432 雖然會回 200，但代理接著預期 TLS ClientHello 來重新終結，
//   而 Postgres 會先送 8 bytes 明文 SSLRequest，於是卡死。詳見 GitHub issue #1。
//   Supabase Management API 走純 HTTPS（api.supabase.com），是唯一能穿過的通道。
//
// 用法：
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db/run-migrations.mjs <project_ref>
//   例：SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db/run-migrations.mjs egehnijjpgijmccagxac
//
//   token 需要是 Supabase「Personal Access Token」（sbp_ 開頭，在
//   https://supabase.com/dashboard/account/tokens 產生）。專案的 anon /
//   service_role / sb_secret 這些「專案 API key」都**不能**用在 Management API。
//
// 冪等性：這些 migration 多數是 `create table`（沒有 if not exists），對已存在的
//   schema 重跑會報錯。此腳本設計成「一次性、對乾淨專案套用」；重跑前請先確認
//   目標專案是空的，或分段挑未套用的檔案跑。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'supabase', 'migrations');
const API = 'https://api.supabase.com';

const token = process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = process.argv[2];

if (!token) {
  console.error('[migrate] 缺 SUPABASE_ACCESS_TOKEN（Supabase Personal Access Token，sbp_ 開頭）。');
  process.exit(1);
}
if (!projectRef) {
  console.error('[migrate] 用法：SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db/run-migrations.mjs <project_ref>');
  process.exit(1);
}

async function runSql(query, label) {
  const res = await fetch(`${API}/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[migrate] ✗ ${label} 失敗（HTTP ${res.status}）：${text}`);
    return false;
  }
  console.log(`[migrate] ✓ ${label}`);
  return true;
}

async function main() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.error(`[migrate] ${MIGRATIONS_DIR} 沒有 .sql 檔。`);
    process.exit(1);
  }
  console.log(`[migrate] 目標專案：${projectRef}，共 ${files.length} 個 migration：`);
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const ok = await runSql(sql, f);
    if (!ok) {
      console.error('[migrate] 中止：前一個 migration 失敗，後續不執行（順序不可顛倒）。');
      process.exit(1);
    }
  }
  console.log('[migrate] 全部 migration 套用完成。');
}

main().catch((err) => {
  console.error('[migrate] 未預期錯誤：', err);
  process.exit(1);
});
