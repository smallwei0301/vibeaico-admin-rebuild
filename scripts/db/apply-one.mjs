#!/usr/bin/env node
// scripts/db/apply-one.mjs
//
// 套用「單一一支」migration 到指定的 Supabase 專案（run-migrations.mjs 是整批
// 從 0001 跑起，對已上線的專案不能用；補做單一 migration 時用這支）。
//
// 用法：
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db/apply-one.mjs <檔名> <project_ref> [更多 ref...]
//   例：… apply-one.mjs 0015_tenants_business_type.sql nmwhwngojosmagjuvxol egehnijjpgijmccagxac
//
// 通道與 token 種類的說明同 run-migrations.mjs 檔頭（必須是帳號層級的 sbp_ PAT，
// 專案 API key 不適用）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'supabase', 'migrations');

const token = process.env.SUPABASE_ACCESS_TOKEN;
const [file, ...refs] = process.argv.slice(2);

if (!token) {
  console.error('[apply-one] 缺 SUPABASE_ACCESS_TOKEN（sbp_ 開頭的 Personal Access Token）。');
  process.exit(1);
}
if (!file || refs.length === 0) {
  console.error('[apply-one] 用法：apply-one.mjs <migration 檔名> <project_ref> [更多 ref...]');
  process.exit(1);
}

const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

let failed = false;
for (const ref of refs) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (res.ok) {
    console.log(`[apply-one] ${ref} ✓ ${file}`);
  } else {
    failed = true;
    console.error(`[apply-one] ${ref} ✗ ${file} — HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
}
process.exit(failed ? 1 : 0);
