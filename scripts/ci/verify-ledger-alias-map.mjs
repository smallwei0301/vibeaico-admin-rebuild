#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * #396 —— repo `supabase/migrations/**` 與正式庫（Production）provider migration
 * 帳本（`supabase_migrations.schema_migrations`）的對照表 checker。
 *
 * 背景：53 個 repo migration 檔案跟正式庫的 49 筆 ledger row **不會**用名字對上，
 * 而且不是同一種原因：有些是已套用但改了名字（ALIAS）、有些是 repo 上存在但
 * 故意沒套用（NOT_APPLIED）、有些是正式庫有但 repo 沒有對應檔案（LEDGER_ONLY）。
 * `0082` 這個 4 碼前綴更是同時撞了三件事（見 supabase/ledger-alias-map.json 的
 * knownPrefixCollisions 與對 0083_staff_display_fields 那筆的說明）。任何用「前綴」
 * 或「數字」做自動比對的工具，都會在這裡得到錯誤答案。
 *
 * 這支 script 只做 source-only 比對：
 *   - repo 端：讀 `supabase/migrations/*.sql` 的檔名（不讀檔案內容、不連資料庫）；
 *   - 正式庫端：讀一份**手動蒐證、已提交進 repo 的** ledger row 名稱快照
 *     （`docs/schema-truth/*-production-ledger-snapshot.json`），不現場查詢。
 *   - 對照表：`supabase/ledger-alias-map.json`。
 *
 * Fail closed：repo 檔案沒被對照表涵蓋、ledger row 沒被涵蓋、對照表指到不存在的
 * 檔案／row、對照表本身格式錯誤、或偵測到未被對照表明確承認的前綴撞號，
 * 一律視為失敗，不放行。
 *
 * 結構仿照 scripts/ci/local-isolated-test-policy.mjs／
 * scripts/agents/migration-identity-compare.mjs 的風格：可測試的 pure function +
 * 薄 CLI wrapper。
 */

export const CLASSIFICATIONS = Object.freeze(['EXACT', 'ALIAS', 'NOT_APPLIED', 'LEDGER_ONLY']);
const CLASSIFICATION_SET = new Set(CLASSIFICATIONS);
const REPO_FILE_PATTERN = /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const PREFIXED_NAME_PATTERN = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const PRODUCTION_PROJECT_REF = 'egehnijjpgijmccagxac';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertExactKeys(value, expectedKeys, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label}：必須是一個 object`);
    return false;
  }
  const actual = new Set(Object.keys(value));
  const expected = new Set(expectedKeys);
  for (const key of actual) {
    if (!expected.has(key)) errors.push(`${label}：出現未知欄位 "${key}"`);
  }
  for (const key of expected) {
    if (!actual.has(key)) errors.push(`${label}：缺少必要欄位 "${key}"`);
  }
  return errors.length === 0;
}

/**
 * 依 4 碼前綴把「repo 檔名」與「ledger row 名稱」放進同一個空間裡比對。
 * 同一前綴底下如果出現超過一個**不同的完整名稱**（不論來源是 repo 還是
 * ledger），就是一次撞號——`0082` 正是這種情況：repo 檔案
 * `0082_reconcile_booking_addon_notify_fields`、ledger row
 * `0082_reconcile_booking_addon_notify_fields`（同名，不算撞）、
 * 以及另一筆 ledger row `0082_staff_display_fields`（不同名，撞）。
 *
 * 純函式，不吃對照表、不吃檔案系統，只吃兩個字串陣列，方便單元測試直接
 * 灌造樣資料，也方便對「一律回報沒有撞號」這種閹割版做突變測試。
 */
/**
 * @param {{ repoFiles?: string[], ledgerRowNames?: string[] }} [params]
 */
export function detectPrefixCollisions({ repoFiles = [], ledgerRowNames = [] } = {}) {
  const byPrefix = new Map();
  const record = (name, source) => {
    const match = PREFIXED_NAME_PATTERN.exec(name);
    if (!match) return;
    const prefix = match[1];
    const bucket = byPrefix.get(prefix) ?? new Map();
    const sources = bucket.get(name) ?? new Set();
    sources.add(source);
    bucket.set(name, sources);
    byPrefix.set(prefix, bucket);
  };
  for (const name of repoFiles) record(name, 'repo');
  for (const name of ledgerRowNames) record(name, 'ledger');

  const collisions = [];
  for (const [prefix, bucket] of byPrefix) {
    if (bucket.size <= 1) continue;
    const names = [...bucket.keys()].sort().map((name) => ({
      name,
      sources: [...bucket.get(name)].sort(),
    }));
    collisions.push({ prefix, names });
  }
  return collisions.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

function collisionKey(collision) {
  return `${collision.prefix}::${collision.names.map((entry) => entry.name).sort().join('|')}`;
}

/**
 * 驗證 `supabase/ledger-alias-map.json` 本身的形狀：未知分類、缺 evidence、
 * 重複的 entry、entry 形狀跟它宣稱的分類對不上，一律視為格式錯誤。
 * 不觸碰檔案系統或 ledger 快照——單純檢查這份 JSON 內部自洽。
 */
export function validateAliasMapShape(aliasMap) {
  const errors = [];
  if (
    !assertExactKeys(
      aliasMap,
      ['schemaVersion', 'issue', 'description', 'ledgerSnapshotRef', 'classifications', 'knownPrefixCollisions', 'entries'],
      'alias map',
      errors,
    )
  ) {
    return { errors };
  }

  if (aliasMap.schemaVersion !== 1) errors.push('alias map：schemaVersion 必須是 1');
  if (!isNonEmptyString(aliasMap.ledgerSnapshotRef)) errors.push('alias map：ledgerSnapshotRef 必須是非空字串');
  if (!Array.isArray(aliasMap.entries)) {
    errors.push('alias map：entries 必須是陣列');
    return { errors };
  }

  const seenRepoFiles = new Map(); // repoFile -> index
  const seenLedgerNames = new Map(); // ledgerName -> index

  aliasMap.entries.forEach((entry, index) => {
    const label = `entries[${index}]`;
    if (!assertExactKeys(entry, ['repoFile', 'ledgerNames', 'classification', 'evidence'], label, errors)) return;

    const classification = entry.classification;
    if (!CLASSIFICATION_SET.has(classification)) {
      errors.push(`${label}：未知的 classification "${classification}"（只能是 ${CLASSIFICATIONS.join('/')}）`);
    }
    if (!isNonEmptyString(entry.evidence)) {
      errors.push(`${label}：evidence 必須是非空字串（每一筆都要有可查證的理由）`);
    }
    if (!Array.isArray(entry.ledgerNames) || entry.ledgerNames.some((name) => !isNonEmptyString(name))) {
      errors.push(`${label}：ledgerNames 必須是「非空字串」陣列`);
      return;
    }
    if (new Set(entry.ledgerNames).size !== entry.ledgerNames.length) {
      errors.push(`${label}：ledgerNames 內部重複`);
    }

    const repoFile = entry.repoFile;
    if (repoFile !== null && !isNonEmptyString(repoFile)) {
      errors.push(`${label}：repoFile 必須是非空字串或 null`);
      return;
    }

    if (!CLASSIFICATION_SET.has(classification)) return; // 分類本身已錯，形狀檢查沒有意義

    if (classification === 'EXACT') {
      if (!isNonEmptyString(repoFile) || entry.ledgerNames.length !== 1 || entry.ledgerNames[0] !== repoFile) {
        errors.push(`${label}：EXACT 必須是 repoFile 與唯一一筆 ledgerNames 逐字相同`);
      }
    } else if (classification === 'ALIAS') {
      if (!isNonEmptyString(repoFile) || entry.ledgerNames.length === 0) {
        errors.push(`${label}：ALIAS 必須有 repoFile 且至少一筆 ledgerNames`);
      } else if (entry.ledgerNames.includes(repoFile)) {
        errors.push(`${label}：ALIAS 的 ledgerNames 不可等於 repoFile（那樣是 EXACT，不是 ALIAS）`);
      }
    } else if (classification === 'NOT_APPLIED') {
      if (!isNonEmptyString(repoFile) || entry.ledgerNames.length !== 0) {
        errors.push(`${label}：NOT_APPLIED 必須有 repoFile 且 ledgerNames 必須是空陣列`);
      }
    } else if (classification === 'LEDGER_ONLY') {
      if (repoFile !== null || entry.ledgerNames.length === 0) {
        errors.push(`${label}：LEDGER_ONLY 必須 repoFile 為 null，且至少一筆 ledgerNames`);
      }
    }

    if (isNonEmptyString(repoFile)) {
      if (seenRepoFiles.has(repoFile)) {
        errors.push(`${label}：repoFile "${repoFile}" 已經在 entries[${seenRepoFiles.get(repoFile)}] 出現過（重複 entry）`);
      } else {
        seenRepoFiles.set(repoFile, index);
      }
    }
    for (const ledgerName of entry.ledgerNames) {
      if (seenLedgerNames.has(ledgerName)) {
        errors.push(`${label}：ledger row "${ledgerName}" 已經在 entries[${seenLedgerNames.get(ledgerName)}] 出現過（同一筆 ledger row 被兩個 entry 認領）`);
      } else {
        seenLedgerNames.set(ledgerName, index);
      }
    }
  });

  if (!Array.isArray(aliasMap.knownPrefixCollisions)) {
    errors.push('alias map：knownPrefixCollisions 必須是陣列');
  } else {
    aliasMap.knownPrefixCollisions.forEach((item, index) => {
      const label = `knownPrefixCollisions[${index}]`;
      if (!assertExactKeys(item, ['prefix', 'names', 'evidence'], label, errors)) return;
      if (typeof item.prefix !== 'string' || !/^\d{4}$/.test(item.prefix)) {
        errors.push(`${label}：prefix 必須是 4 位數字字串`);
      }
      if (!Array.isArray(item.names) || item.names.length < 2 || item.names.some((name) => !isNonEmptyString(name))) {
        errors.push(`${label}：names 至少要有兩個不同的非空字串`);
      } else if (new Set(item.names).size !== item.names.length) {
        errors.push(`${label}：names 內部重複`);
      }
      if (!isNonEmptyString(item.evidence)) errors.push(`${label}：evidence 必須是非空字串`);
    });
  }

  return { errors };
}

/**
 * 驗證 ledger 快照檔案本身的形狀（環境、project ref、row 名稱陣列）。
 */
export function validateLedgerSnapshotShape(snapshot) {
  const errors = [];
  if (
    !assertExactKeys(
      snapshot,
      ['schemaVersion', 'issue', 'environment', 'projectRef', 'capturedAt', 'source', 'note', 'rowCount', 'ledgerRowNames'],
      'ledger snapshot',
      errors,
    )
  ) {
    return { errors };
  }
  if (snapshot.schemaVersion !== 1) errors.push('ledger snapshot：schemaVersion 必須是 1');
  if (snapshot.environment !== 'PRODUCTION') errors.push('ledger snapshot：environment 必須是 PRODUCTION');
  if (snapshot.projectRef !== PRODUCTION_PROJECT_REF) {
    errors.push(`ledger snapshot：projectRef 必須是 ${PRODUCTION_PROJECT_REF}`);
  }
  if (!isNonEmptyString(snapshot.capturedAt)) errors.push('ledger snapshot：capturedAt 必須是非空字串');
  if (!Array.isArray(snapshot.ledgerRowNames) || snapshot.ledgerRowNames.some((name) => !isNonEmptyString(name))) {
    errors.push('ledger snapshot：ledgerRowNames 必須是「非空字串」陣列');
    return { errors };
  }
  if (new Set(snapshot.ledgerRowNames).size !== snapshot.ledgerRowNames.length) {
    errors.push('ledger snapshot：ledgerRowNames 內部重複');
  }
  if (snapshot.rowCount !== snapshot.ledgerRowNames.length) {
    errors.push('ledger snapshot：rowCount 與 ledgerRowNames.length 不一致');
  }
  return { errors };
}

/**
 * 核心比對邏輯：repo 檔名清單 + ledger row 名稱清單 + 對照表 → 通過或一串錯誤。
 * 純函式，完全不碰檔案系統／資料庫，方便建造樣資料做單元測試與突變測試。
 */
/**
 * @param {{ repoFiles?: string[], ledgerRowNames?: string[], aliasMap: any, ledgerSnapshot?: any }} params
 */
export function verifyLedgerAliasMap({ repoFiles = [], ledgerRowNames = [], aliasMap, ledgerSnapshot } = {}) {
  const errors = [];

  if (new Set(repoFiles).size !== repoFiles.length) errors.push('repo 檔名清單內部重複（同一個檔名出現兩次）');
  for (const name of repoFiles) {
    if (!REPO_FILE_PATTERN.test(name)) errors.push(`repo 檔名格式不對: "${name}"（必須是 NNNN_name）`);
  }

  const shapeResult = validateAliasMapShape(aliasMap);
  errors.push(...shapeResult.errors);

  if (ledgerSnapshot) {
    const snapshotResult = validateLedgerSnapshotShape(ledgerSnapshot);
    errors.push(...snapshotResult.errors);
  }

  // 對照表本身格式都錯了的話，後面的交叉比對只會製造雜訊，直接停在這裡。
  if (shapeResult.errors.length > 0 || !Array.isArray(aliasMap?.entries)) {
    return { ok: false, errors };
  }

  const repoFileSet = new Set(repoFiles);
  const ledgerNameSet = new Set(ledgerRowNames);
  const accountedRepoFiles = new Set();
  const accountedLedgerNames = new Set();

  aliasMap.entries.forEach((entry, index) => {
    const label = `entries[${index}]`;
    if (isNonEmptyString(entry.repoFile)) {
      if (!repoFileSet.has(entry.repoFile)) {
        errors.push(`${label}：repoFile "${entry.repoFile}" 在 supabase/migrations/ 裡找不到這個檔案`);
      } else {
        accountedRepoFiles.add(entry.repoFile);
      }
    }
    for (const ledgerName of entry.ledgerNames ?? []) {
      if (!ledgerNameSet.has(ledgerName)) {
        errors.push(`${label}：ledger row "${ledgerName}" 在 ledger 快照裡找不到（可能是快照過期，或這筆是錯的）`);
      } else {
        accountedLedgerNames.add(ledgerName);
      }
    }
  });

  for (const file of repoFiles) {
    if (!accountedRepoFiles.has(file)) {
      errors.push(`repo 檔案 "${file}" 沒有被 supabase/ledger-alias-map.json 的任何 entry 涵蓋（新加的 migration 必須先決定它的分類）`);
    }
  }
  for (const name of ledgerRowNames) {
    if (!accountedLedgerNames.has(name)) {
      errors.push(`ledger row "${name}" 沒有被 supabase/ledger-alias-map.json 的任何 entry 涵蓋`);
    }
  }

  // 前綴撞號：不管對照表怎麼寫，先用原始資料算一次事實；再要求每一次偵測到
  // 的撞號，都要有 knownPrefixCollisions 裡逐字對得上的紀錄——對不上就是
  // 未被承認的撞號，或是對照表裡放了一筆已經不成立的舊紀錄，兩者都 fail closed。
  const detected = detectPrefixCollisions({ repoFiles, ledgerRowNames });
  const detectedKeys = new Set(detected.map(collisionKey));
  const knownKeys = new Set(
    (aliasMap.knownPrefixCollisions ?? [])
      .filter((item) => typeof item?.prefix === 'string' && Array.isArray(item?.names))
      .map((item) => `${item.prefix}::${[...item.names].sort().join('|')}`),
  );

  for (const collision of detected) {
    const key = collisionKey(collision);
    if (!knownKeys.has(key)) {
      const detail = collision.names.map((entry) => `${entry.name}（${entry.sources.join('+')}）`).join('、');
      errors.push(
        `前綴 ${collision.prefix} 同時代表多個不同的變更，但 supabase/ledger-alias-map.json 的 knownPrefixCollisions 沒有逐字承認：${detail}`,
      );
    }
  }
  for (const item of aliasMap.knownPrefixCollisions ?? []) {
    if (typeof item?.prefix !== 'string' || !Array.isArray(item?.names)) continue;
    const key = `${item.prefix}::${[...item.names].sort().join('|')}`;
    if (!detectedKeys.has(key)) {
      errors.push(
        `knownPrefixCollisions 裡的前綴 ${item.prefix}（${item.names.join('、')}）已經跟目前的 repo／ledger 資料對不上，是過期紀錄，必須更新或移除`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function readRepoMigrationBasenames(migrationsDir) {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length))
    .sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function cli() {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
  const aliasMapPath = path.join(repoRoot, 'supabase', 'ledger-alias-map.json');

  const aliasMap = readJson(aliasMapPath);
  const ledgerSnapshotPath = path.join(repoRoot, aliasMap.ledgerSnapshotRef ?? '');
  const ledgerSnapshot = fs.existsSync(ledgerSnapshotPath) ? readJson(ledgerSnapshotPath) : null;

  if (!ledgerSnapshot) {
    console.error(`[verify-ledger-alias-map] 找不到 ledgerSnapshotRef 指到的檔案: ${aliasMap.ledgerSnapshotRef}`);
    process.exitCode = 1;
    return;
  }

  const repoFiles = readRepoMigrationBasenames(migrationsDir);
  const result = verifyLedgerAliasMap({
    repoFiles,
    ledgerRowNames: ledgerSnapshot.ledgerRowNames ?? [],
    aliasMap,
    ledgerSnapshot,
  });

  if (result.ok) {
    console.log(
      `[verify-ledger-alias-map] OK — ${repoFiles.length} 個 repo migration 檔案、${(ledgerSnapshot.ledgerRowNames ?? []).length} 筆正式庫 ledger row 全數對得上 supabase/ledger-alias-map.json。`,
    );
    return;
  }

  console.error(`[verify-ledger-alias-map] 失敗，共 ${result.errors.length} 個問題：`);
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli();
}
