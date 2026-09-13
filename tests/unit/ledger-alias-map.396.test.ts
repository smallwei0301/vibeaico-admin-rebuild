import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CLASSIFICATIONS,
  detectPrefixCollisions,
  validateAliasMapShape,
  validateLedgerSnapshotShape,
  verifyLedgerAliasMap,
} from '../../scripts/ci/verify-ledger-alias-map.mjs';

/**
 * #396 —— supabase/ledger-alias-map.json 與它的 checker
 * scripts/ci/verify-ledger-alias-map.mjs 的契約測試。
 *
 * 這個 Issue 明確點名：前一次同題目的測試「5 個突變只抓到 4 個」——字串比對式的
 * 測試在輸入被弄壞時照樣綠燈。所以這裡分兩層：
 *
 *   1. 用建構出來的最小樣本測 exported pure function 的行為（不碰真檔案）。
 *   2. 對「真的」supabase/ledger-alias-map.json 與正式庫 ledger 快照做整體驗證，
 *      並且針對 Issue 指定的 5 種突變逐一驗證「壞掉的輸入必須讓測試紅」。
 */

const REPO_ROOT = resolve(process.cwd());
const ALIAS_MAP_PATH = resolve(REPO_ROOT, 'supabase/ledger-alias-map.json');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'supabase/migrations');
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'docs/schema-truth/2026-09-13-issue-396-production-ledger-snapshot.json');
const CHECKER_SCRIPT = resolve(REPO_ROOT, 'scripts/ci/verify-ledger-alias-map.mjs');

function loadRealAliasMap() {
  return JSON.parse(readFileSync(ALIAS_MAP_PATH, 'utf8'));
}
function loadRealSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
}
function loadRealRepoFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -4))
    .sort();
}

// 這些造樣資料的形狀故意用 `any` 放寬 TS 檢查：本檔測的是
// verifyLedgerAliasMap／validateAliasMapShape 這些 runtime 邊界（它們自己會驗證形狀），
// 不是在測 TypeScript 型別系統本身，所以刻意允許在單一測試裡動態改欄位（例如把
// classification 從 NOT_APPLIED 改成 EXACT）來模擬突變輸入。
function minimalFixture(): { repoFiles: string[]; ledgerRowNames: string[]; aliasMap: any } {
  return {
    repoFiles: ['0001_a', '0002_b', '0003_c'],
    ledgerRowNames: ['0001_a', 'renamed_b', '0090_c'],
    aliasMap: {
      schemaVersion: 1,
      issue: 999,
      description: '造樣資料',
      ledgerSnapshotRef: 'docs/schema-truth/fixture.json',
      classifications: {
        EXACT: 'x',
        ALIAS: 'x',
        NOT_APPLIED: 'x',
        LEDGER_ONLY: 'x',
      },
      knownPrefixCollisions: [],
      entries: [
        { repoFile: '0001_a', ledgerNames: ['0001_a'], classification: 'EXACT', evidence: '名字一樣' },
        { repoFile: '0002_b', ledgerNames: ['renamed_b'], classification: 'ALIAS', evidence: '已套用但改名了' },
        { repoFile: '0003_c', ledgerNames: [], classification: 'NOT_APPLIED', evidence: '查證過，未套用' },
        { repoFile: null, ledgerNames: ['0090_c'], classification: 'LEDGER_ONLY', evidence: '正式庫有，repo 沒有對應檔案' },
      ],
    },
  };
}

describe('#396 verifyLedgerAliasMap — 建構樣本', () => {
  it('乾淨樣本通過', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('CLASSIFICATIONS 剛好是四種，不多不少', () => {
    expect([...CLASSIFICATIONS].sort()).toEqual(['ALIAS', 'EXACT', 'LEDGER_ONLY', 'NOT_APPLIED']);
  });

  it('（突變 a）刪掉 ALIAS entry → repo 檔案與 ledger row 都變成未涵蓋', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    aliasMap.entries = aliasMap.entries.filter((entry: any) => entry.classification !== 'ALIAS');
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('0002_b') && e.includes('沒有被'))).toBe(true);
    expect(result.errors.some((e: string) => e.includes('renamed_b') && e.includes('沒有被'))).toBe(true);
  });

  it('（突變 b）ALIAS entry 指向錯的 ledger 名稱 → 指到不存在的 row，且真正的 row 仍未涵蓋', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const alias = aliasMap.entries.find((entry: any) => entry.classification === 'ALIAS');
    alias.ledgerNames = ['this_name_does_not_exist_in_ledger'];
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('this_name_does_not_exist_in_ledger') && e.includes('找不到'))).toBe(true);
    expect(result.errors.some((e: string) => e.includes('renamed_b') && e.includes('沒有被'))).toBe(true);
  });

  it('（突變 c）把 NOT_APPLIED entry 標成 EXACT，但 ledgerNames 沒有跟著補 → 形狀檢查抓到', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const notApplied = aliasMap.entries.find((entry: any) => entry.classification === 'NOT_APPLIED');
    notApplied.classification = 'EXACT';
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('EXACT 必須是'))).toBe(true);
  });

  it('（突變 c 的另一種寫法）把 NOT_APPLIED 標成 EXACT 且假造出一個從未套用的 ledger row → 必須被「row 不在快照裡」擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const notApplied = aliasMap.entries.find((entry: any) => entry.classification === 'NOT_APPLIED');
    notApplied.classification = 'EXACT';
    notApplied.ledgerNames = ['0003_c']; // 正式庫其實沒有這筆——0003_c 是「未套用」
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('0003_c') && e.includes('找不到'))).toBe(true);
  });

  it('（突變 e）多一個 repo 檔案沒有任何 entry 涵蓋 → 必須被擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const result = verifyLedgerAliasMap({
      repoFiles: [...repoFiles, '0004_new_migration_nobody_classified'],
      ledgerRowNames,
      aliasMap,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('0004_new_migration_nobody_classified') && e.includes('沒有被'))).toBe(true);
  });

  it('未知 classification 被擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    aliasMap.entries[0].classification = 'MAYBE';
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('未知的 classification'))).toBe(true);
  });

  it('缺 evidence 被擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    aliasMap.entries[0].evidence = '';
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('evidence'))).toBe(true);
  });

  it('重複 entry（同一個 repoFile 出現兩次）被擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    aliasMap.entries.push({ ...aliasMap.entries[0] });
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('重複 entry'))).toBe(true);
  });

  it('同一個 ledger row 被兩個 entry 認領被擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    aliasMap.entries.push({
      repoFile: null,
      ledgerNames: ['0001_a'],
      classification: 'LEDGER_ONLY',
      evidence: '故意造的衝突',
    });
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('0001_a') && e.includes('兩個 entry 認領'))).toBe(true);
  });

  it('ALIAS 的 ledgerNames 等於 repoFile 被擋下（那其實是 EXACT）', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const alias = aliasMap.entries.find((entry: any) => entry.classification === 'ALIAS');
    alias.ledgerNames = [alias.repoFile];
    const result = verifyLedgerAliasMap({ repoFiles: [...repoFiles], ledgerRowNames: [...ledgerRowNames, alias.repoFile], aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('ALIAS 的 ledgerNames 不可等於 repoFile'))).toBe(true);
  });
});

describe('#396 detectPrefixCollisions — pure function', () => {
  it('同前綴、不同完整名稱（跨 repo／ledger）回報一筆撞號', () => {
    const collisions = detectPrefixCollisions({
      repoFiles: ['0082_reconcile_booking_addon_notify_fields'],
      ledgerRowNames: ['0082_reconcile_booking_addon_notify_fields', '0082_staff_display_fields'],
    });
    expect(collisions).toHaveLength(1);
    expect(collisions[0].prefix).toBe('0082');
    const names = collisions[0].names.map((entry: any) => entry.name).sort();
    expect(names).toEqual(['0082_reconcile_booking_addon_notify_fields', '0082_staff_display_fields']);
  });

  it('同前綴、同名稱（EXACT 配對）不算撞號', () => {
    const collisions = detectPrefixCollisions({
      repoFiles: ['0001_extensions_and_functions'],
      ledgerRowNames: ['0001_extensions_and_functions'],
    });
    expect(collisions).toEqual([]);
  });

  it('沒有 4 碼前綴的名稱（例如 customer_source）不參與比對', () => {
    const collisions = detectPrefixCollisions({
      repoFiles: ['0076_customer_source'],
      ledgerRowNames: ['customer_source'],
    });
    expect(collisions).toEqual([]);
  });

  it('（突變 d 的直接探針）撞號偵測若被閹割成永遠回傳空陣列，這個測試必須紅', () => {
    // 這裡故意示範「閹割版」長什麼樣子，並斷言它跟正確版的行為不同——
    // 如果有人把 detectPrefixCollisions 改成 `() => []`，上面兩個測試會變綠，
    // 但這個測試專門比對「正確版在真正衝突的輸入上必須非空」，抓住那種閹割。
    const neutered = () => [];
    const real = detectPrefixCollisions({
      repoFiles: ['0082_reconcile_booking_addon_notify_fields'],
      ledgerRowNames: ['0082_reconcile_booking_addon_notify_fields', '0082_staff_display_fields'],
    });
    expect(real.length).toBeGreaterThan(0);
    expect(neutered().length).toBe(0);
    expect(real.length).not.toBe(neutered().length);
  });
});

describe('#396 verifyLedgerAliasMap — 前綴撞號必須被 knownPrefixCollisions 逐字承認', () => {
  function collisionFixture(): { repoFiles: string[]; ledgerRowNames: string[]; aliasMap: any } {
    return {
      repoFiles: ['0082_a'],
      ledgerRowNames: ['0082_a', '0082_b'],
      aliasMap: {
        schemaVersion: 1,
        issue: 999,
        description: 'x',
        ledgerSnapshotRef: 'x.json',
        classifications: { EXACT: 'x', ALIAS: 'x', NOT_APPLIED: 'x', LEDGER_ONLY: 'x' },
        knownPrefixCollisions: [],
        entries: [
          { repoFile: '0082_a', ledgerNames: ['0082_a'], classification: 'EXACT', evidence: 'x' },
          { repoFile: null, ledgerNames: ['0082_b'], classification: 'LEDGER_ONLY', evidence: 'x' },
        ],
      },
    };
  }

  it('沒有宣告 knownPrefixCollisions 時，未被承認的撞號會 fail closed', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = collisionFixture();
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('前綴 0082') && e.includes('沒有逐字承認'))).toBe(true);
  });

  it('補上逐字相符的 knownPrefixCollisions 之後通過', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = collisionFixture();
    aliasMap.knownPrefixCollisions = [{ prefix: '0082', names: ['0082_a', '0082_b'], evidence: '造樣資料的撞號說明' }];
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(true);
  });

  it('knownPrefixCollisions 裡放一筆已經不成立的過期紀錄 → 擋下（要求同步更新，不能放著不管）', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = collisionFixture();
    aliasMap.knownPrefixCollisions = [{ prefix: '0082', names: ['0082_a', '0082_b'], evidence: 'x' }];
    // 撞號本身已經解決（ledger 只剩一筆），但沒有把 knownPrefixCollisions 清掉。
    const result = verifyLedgerAliasMap({
      repoFiles,
      ledgerRowNames: ['0082_a'],
      aliasMap: { ...aliasMap, entries: [aliasMap.entries[0]] },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('過期紀錄'))).toBe(true);
  });
});

describe('#396 validateAliasMapShape / validateLedgerSnapshotShape', () => {
  it('LEDGER_ONLY 的 repoFile 必須是 null，不能是字串', () => {
    const result = validateAliasMapShape({
      schemaVersion: 1,
      issue: 1,
      description: 'x',
      ledgerSnapshotRef: 'x.json',
      classifications: {},
      knownPrefixCollisions: [],
      entries: [{ repoFile: 'oops', ledgerNames: ['x'], classification: 'LEDGER_ONLY', evidence: 'x' }],
    });
    expect(result.errors.some((e) => e.includes('LEDGER_ONLY 必須 repoFile 為 null'))).toBe(true);
  });

  it('ledger 快照的 projectRef 錯誤被擋下', () => {
    const result = validateLedgerSnapshotShape({
      schemaVersion: 1,
      issue: 396,
      environment: 'PRODUCTION',
      projectRef: 'wrong-ref',
      capturedAt: '2026-09-13T00:00:00Z',
      source: 'x',
      note: 'x',
      rowCount: 1,
      ledgerRowNames: ['0001_a'],
    });
    expect(result.errors.some((e) => e.includes('projectRef 必須是 egehnijjpgijmccagxac'))).toBe(true);
  });

  it('ledger 快照的 rowCount 與陣列長度不一致被擋下', () => {
    const result = validateLedgerSnapshotShape({
      schemaVersion: 1,
      issue: 396,
      environment: 'PRODUCTION',
      projectRef: 'egehnijjpgijmccagxac',
      capturedAt: '2026-09-13T00:00:00Z',
      source: 'x',
      note: 'x',
      rowCount: 5,
      ledgerRowNames: ['0001_a'],
    });
    expect(result.errors.some((e) => e.includes('rowCount 與 ledgerRowNames.length 不一致'))).toBe(true);
  });
});

describe('#396 已提交的正式資料', () => {
  const aliasMap = loadRealAliasMap();
  const snapshot = loadRealSnapshot();
  const repoFiles = loadRealRepoFiles();

  it('repo 有 53 個 migration 檔案，正式庫快照有 49 筆 ledger row', () => {
    expect(repoFiles).toHaveLength(53);
    expect(snapshot.ledgerRowNames).toHaveLength(49);
  });

  it('supabase/ledger-alias-map.json 完全涵蓋這 53 個 repo 檔案與 49 筆 ledger row', () => {
    const result = verifyLedgerAliasMap({
      repoFiles,
      ledgerRowNames: snapshot.ledgerRowNames,
      aliasMap,
      ledgerSnapshot: snapshot,
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('分類統計符合已查證的事實：42 EXACT、6 ALIAS、5 NOT_APPLIED、1 LEDGER_ONLY', () => {
    const counts: Record<string, number> = {};
    for (const entry of aliasMap.entries) {
      counts[entry.classification] = (counts[entry.classification] ?? 0) + 1;
    }
    expect(counts.EXACT).toBe(42);
    expect(counts.ALIAS).toBe(6);
    expect(counts.NOT_APPLIED).toBe(5);
    expect(counts.LEDGER_ONLY).toBe(1);
  });

  it('0082 前綴撞號確實被偵測到、且被 knownPrefixCollisions 逐字承認', () => {
    const collisions = detectPrefixCollisions({ repoFiles, ledgerRowNames: snapshot.ledgerRowNames });
    const found = collisions.find((c: any) => c.prefix === '0082');
    expect(found).toBeTruthy();
    const names = found!.names.map((entry: any) => entry.name).sort();
    expect(names).toEqual(['0082_reconcile_booking_addon_notify_fields', '0082_staff_display_fields']);

    const known = aliasMap.knownPrefixCollisions.find((item: any) => item.prefix === '0082');
    expect(known).toBeTruthy();
    expect([...known.names].sort()).toEqual(names);
  });

  it('0083_staff_display_fields 是 ALIAS，目標是 0082_staff_display_fields（而不是自己的前綴）', () => {
    const entry = aliasMap.entries.find((e: any) => e.repoFile === '0083_staff_display_fields');
    expect(entry.classification).toBe('ALIAS');
    expect(entry.ledgerNames).toEqual(['0082_staff_display_fields']);
  });

  it('五個 welcome-card 相關檔案都是 NOT_APPLIED', () => {
    const files = [
      '0069_welcome_card_images',
      '0070_welcome_card_image_retirement',
      '0071_welcome_card_image_retirement_acl',
      '0072_welcome_card_upload_acl',
      '0073_restore_keyword_reply_storage_write',
    ];
    for (const file of files) {
      const entry = aliasMap.entries.find((e: any) => e.repoFile === file);
      expect(entry, `entry for ${file}`).toBeTruthy();
      expect(entry.classification).toBe('NOT_APPLIED');
      expect(entry.ledgerNames).toEqual([]);
    }
  });
});

describe('#396 CLI 薄殼', () => {
  it('對已提交的真實資料執行 CLI，成功結束且印出 OK', () => {
    const output = execFileSync('node', [CHECKER_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(output).toContain('OK');
  });
});
