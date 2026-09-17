import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  CLASSIFICATIONS,
  NOT_APPLIED_REASONS,
  detectPrefixCollisions,
  readJsonFile,
  runChecker,
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
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'supabase/production-ledger-snapshot.json');
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
      ledgerSnapshotRef: 'supabase/fixture.json',
      classifications: {
        EXACT: 'x',
        ALIAS: 'x',
        NOT_APPLIED: 'x',
        LEDGER_ONLY: 'x',
      },
      notAppliedReasons: {
        VERIFIED_NOT_APPLIED: 'x',
        PENDING_APPLY: 'x',
      },
      knownPrefixCollisions: [],
      entries: [
        { repoFile: '0001_a', ledgerNames: ['0001_a'], classification: 'EXACT', evidence: '名字一樣' },
        { repoFile: '0002_b', ledgerNames: ['renamed_b'], classification: 'ALIAS', evidence: '已套用但改名了' },
        {
          repoFile: '0003_c',
          ledgerNames: [],
          classification: 'NOT_APPLIED',
          notAppliedReason: 'VERIFIED_NOT_APPLIED',
          evidence: '查證過，刻意未套用',
        },
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
    delete notApplied.notAppliedReason;
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('EXACT 必須是'))).toBe(true);
  });

  it('（突變 c 的另一種寫法）把 NOT_APPLIED 標成 EXACT 且假造出一個從未套用的 ledger row → 必須被「row 不在快照裡」擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const notApplied = aliasMap.entries.find((entry: any) => entry.classification === 'NOT_APPLIED');
    notApplied.classification = 'EXACT';
    delete notApplied.notAppliedReason;
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

/**
 * 迴歸測試（pin #396 的 assertExactKeys 串聯修正）——這個 describe 存在的唯一理由，
 * 是擋住一個曾經真的發生過、而且所有既有測試都抓不到的回頭路。
 *
 * assertExactKeys() 的回傳值被呼叫端當成「這一筆 entry 還值不值得繼續檢查」：
 * 回 false 就 `return`，跳過這一筆剩下的所有形狀檢查與重複認領追蹤。所以它只能回報
 * **自己這一次**有沒有加出新的錯誤：
 *
 *   const before = errors.length;  …  return errors.length === before;   ← 正確
 *   return errors.length === 0;                                          ← 退版後的樣子
 *
 * 退版成 `errors.length === 0` 之後，只要前面任何一筆 entry 累積過錯誤，後面每一筆
 * 形狀完全正確的 entry 都會被誤判成「形狀壞掉」而整筆跳過——失敗訊息只剩第一個缺陷，
 * 第二、第三個缺陷靜靜消失，重複認領也不再被追蹤。
 *
 * 既有的突變測試每次只注入「一個」缺陷，所以退版後照樣全綠，這正是當初能通過審查的原因。
 * 底下這個案例刻意在同一份輸入裡放三個缺陷，而且第二、第三個只有在第一個沒有造成
 * 短路時才看得到，所以它對這次修正是敏感的：把上面兩行改回 `=== 0`，它必須變紅。
 */
describe('#396 迴歸：assertExactKeys 短路不得吃掉同一份輸入裡的後續缺陷', () => {
  function multiDefectAliasMap(): any {
    return {
      schemaVersion: 1,
      issue: 999,
      description: '造樣資料：同一份輸入裡刻意放三個缺陷',
      ledgerSnapshotRef: 'supabase/fixture.json',
      classifications: { EXACT: 'x', ALIAS: 'x', NOT_APPLIED: 'x', LEDGER_ONLY: 'x' },
      notAppliedReasons: { VERIFIED_NOT_APPLIED: 'x', PENDING_APPLY: 'x' },
      knownPrefixCollisions: [],
      entries: [
        // 缺陷 1：未知的 classification（第一個累積出錯誤的地方）。
        { repoFile: '0001_a', ledgerNames: ['0001_a'], classification: 'BOGUS', evidence: 'x' },
        // 缺陷 2：EXACT 卻與 ledgerNames 對不上——只有在缺陷 1 沒有短路時才看得到。
        { repoFile: '0002_b', ledgerNames: ['renamed_b'], classification: 'EXACT', evidence: 'x' },
        // 缺陷 3：repoFile 與 entries[1] 重複——重複追蹤只在 entries[1] 沒被跳過時才會建立。
        {
          repoFile: '0002_b',
          ledgerNames: [],
          classification: 'NOT_APPLIED',
          notAppliedReason: 'VERIFIED_NOT_APPLIED',
          evidence: 'x',
        },
      ],
    };
  }

  it('三個缺陷必須全部被回報，不能只剩第一個', () => {
    const { errors } = validateAliasMapShape(multiDefectAliasMap());

    // 缺陷 1：退版與否都會被抓到（它就是第一個錯誤）。
    expect(errors.some((e) => e.includes('entries[0]') && e.includes('未知的 classification'))).toBe(true);
    // 缺陷 2：退版後會消失。
    expect(errors.some((e) => e.includes('entries[1]') && e.includes('EXACT 必須是'))).toBe(true);
    // 缺陷 3：退版後會消失。
    expect(errors.some((e) => e.includes('entries[2]') && e.includes('0002_b') && e.includes('重複 entry'))).toBe(true);
  });

  it('形狀正確的 entry 不會因為前面某一筆已經出錯就被判成形狀壞掉', () => {
    const aliasMap = multiDefectAliasMap();
    // 只留下「前面一筆壞掉、後面一筆完全正確」的最小情境：
    // 正確的那一筆不該產生任何屬於它自己的錯誤訊息。
    aliasMap.entries = [
      { repoFile: '0001_a', ledgerNames: ['0001_a'], classification: 'BOGUS', evidence: 'x' },
      { repoFile: '0002_b', ledgerNames: ['renamed_b'], classification: 'ALIAS', evidence: 'x' },
    ];
    const { errors } = validateAliasMapShape(aliasMap);
    expect(errors.some((e) => e.includes('entries[1]'))).toBe(false);
    // 而且它確實被追蹤過：再加一筆同名 repoFile 就必須被判成重複。
    aliasMap.entries.push({ repoFile: '0002_b', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' });
    const second = validateAliasMapShape(aliasMap);
    expect(second.errors.some((e) => e.includes('entries[2]') && e.includes('重複 entry'))).toBe(true);
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
        notAppliedReasons: { VERIFIED_NOT_APPLIED: 'x', PENDING_APPLY: 'x' },
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
      classifications: { EXACT: 'x', ALIAS: 'x', NOT_APPLIED: 'x', LEDGER_ONLY: 'x' },
      notAppliedReasons: { VERIFIED_NOT_APPLIED: 'x', PENDING_APPLY: 'x' },
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

  // repo 端多出尚未套用的 0109、0110、0111、0112、0113、0114、0115、
  // 0116_issue_18_owner_notify、0117_issue_25b_support_chat_threads、
  // 0118_issue_25c_platform_donations（三者依序合併自 #519/#524/#526/#527 等
  // main 側 PR，見 supabase/ledger-alias-map.json 對應 evidence）、
  // 0119_issue_18_owner_notify_confirm_atomic（#18 缺口 A 併發修復，不改既有
  // 表結構／RLS，只新增兩支 service-role-only 函式），以及本候選
  // 0121_issue_17_booking_addons_hardening；正式庫快照維持 58 筆
  // 實際 ledger row（0106／0108／0107 已分別於 2026-09-14 經 Owner
  // 具名授權套用並重新擷取本快照；0105 於 2026-09-15 以唯讀查詢確認先前已套用
  // 於正式庫，本檔先前誤標記為 NOT_APPLIED，已一併更正，四者都在快照裡）。
  // #455 不會重寫、拆分或新增既有 migration 歷史；數字以 current main 的
  // 實際檔案為準。
  it('repo 有 69 個 migration 檔案，正式庫快照有 58 筆 ledger row', () => {
    expect(repoFiles).toHaveLength(69);
    expect(snapshot.ledgerRowNames).toHaveLength(58);
  });

  it('supabase/ledger-alias-map.json 完全涵蓋這 69 個 repo 檔案與 58 筆 ledger row', () => {
    const result = verifyLedgerAliasMap({
      repoFiles,
      ledgerRowNames: snapshot.ledgerRowNames,
      aliasMap,
      ledgerSnapshot: snapshot,
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('分類統計符合已查證的事實：51 EXACT、6 ALIAS、12 NOT_APPLIED、1 LEDGER_ONLY', () => {
    const counts: Record<string, number> = {};
    for (const entry of aliasMap.entries) {
      counts[entry.classification] = (counts[entry.classification] ?? 0) + 1;
    }
    // 2026-09-13：0069–0073 五支經 Owner 具名授權套用至正式庫並回讀驗證，
    // 因此從 NOT_APPLIED 轉為 EXACT（42 → 47）。2026-09-14：0106 套用至
    // Production 並完成 postflight（47 → 48）；0108 同日由 Owner 具名授權套用，
    // 同一次作業重新擷取本快照（48 → 49）；0107 同日稍晚由 Owner 具名授權套用
    // （PR #440 上線的 /api/guide/action-inbox 依賴它，正式庫當時尚未套用，見
    // docs/schema-truth/2026-09-14-production-0107-not-applied.md），同一次作業
    // 再次重新擷取本快照（49 → 50）。2026-09-15：以唯讀查詢重新核對正式庫，
    // 發現 0105 其實已經套用於正式庫，本檔先前誤標記為 NOT_APPLIED／
    // PENDING_APPLY，隨即更正為 EXACT（50 → 51）。尚未套用的是 0109、0110、
    // 0111、0112、0113、0114、0115、0116_issue_18_owner_notify、
    // 0117_issue_25b_support_chat_threads、0118_issue_25c_platform_donations、
    // 0119_issue_18_owner_notify_confirm_atomic 與本候選 0121_issue_17_booking_addons_hardening
    // （後幾筆合併自 origin/main 的 #519/#524/#526/#527/#575 等 PR，加上本 issue #17
    // 拆出的 migration-only successor），所以 NOT_APPLIED 是 12。
    // 十二者依 AGENTS.md 的規則，在合併進 main 之前都不是任何環境的套用授權。
    // 0109 是 SCHEMA_REPAIR；0112、0114 是 AUTHZ+BACKFILL 混合風險。三者各自
    // 留在既有 migration 歷史中，並標為 VERIFIED_NOT_APPLIED，直到未來獨立
    // release 有對應的審查與執行器。
    expect(counts.EXACT).toBe(51);
    expect(counts.ALIAS).toBe(6);
    expect(counts.NOT_APPLIED ?? 0).toBe(12);
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

  it('五個 welcome-card 相關檔案都是 EXACT，且帳本列名逐字等於檔名', () => {
    // 2026-09-13 套用前這五支是 NOT_APPLIED。套用後帳本列名必須**逐字等於檔名**，
    // 不得產生新的別名——0072 曾被誤寫成 0072_welcome_card_storage_side_door，
    // 已在同一次作業內更正，這條斷言就是防止那類錯誤再次悄悄留下。
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
      expect(entry.classification, `classification for ${file}`).toBe('EXACT');
      expect(entry.ledgerNames, `ledgerNames for ${file}`).toEqual([file]);
      expect(snapshot.ledgerRowNames, `snapshot row for ${file}`).toContain(file);
    }
  });
});

describe('#396 CLI 薄殼', () => {
  it('對已提交的真實資料執行 CLI，成功結束且印出 OK', () => {
    const output = execFileSync('node', [CHECKER_SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(output).toContain('OK');
  });
});

/**
 * 以下三組是 Final Risk 後補上的：checker 的**可讀性**與**歧義**本身也要有測試。
 * 「fail closed 但訊息像 CI runner 壞了」會讓下一個維護者選擇刪掉這道關卡，
 * 而不是修好對照表。
 */

function makeScratchRepo(options: {
  aliasMapText?: string;
  snapshotText?: string | null;
  snapshotAsDirectory?: boolean;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ledger-alias-map-'));
  mkdirSync(join(root, 'supabase', 'migrations'), { recursive: true });
  writeFileSync(join(root, 'supabase', 'migrations', '0001_a.sql'), '-- noop\n');

  const aliasMap = {
    schemaVersion: 1,
    issue: 999,
    description: 'x',
    ledgerSnapshotRef: 'supabase/production-ledger-snapshot.json',
    classifications: { EXACT: 'x', ALIAS: 'x', NOT_APPLIED: 'x', LEDGER_ONLY: 'x' },
    notAppliedReasons: { VERIFIED_NOT_APPLIED: 'x', PENDING_APPLY: 'x' },
    knownPrefixCollisions: [],
    entries: [{ repoFile: '0001_a', ledgerNames: ['0001_a'], classification: 'EXACT', evidence: 'x' }],
  };
  const snapshot = {
    schemaVersion: 1,
    issue: 999,
    environment: 'PRODUCTION',
    projectRef: 'egehnijjpgijmccagxac',
    capturedAt: '2026-09-13',
    source: 'x',
    note: 'x',
    rowCount: 1,
    ledgerRowNames: ['0001_a'],
  };

  writeFileSync(
    join(root, 'supabase', 'ledger-alias-map.json'),
    options.aliasMapText ?? JSON.stringify(aliasMap, null, 2),
  );
  if (options.snapshotAsDirectory) {
    mkdirSync(join(root, 'supabase', 'production-ledger-snapshot.json'));
  } else if (options.snapshotText !== null) {
    writeFileSync(
      join(root, 'supabase', 'production-ledger-snapshot.json'),
      options.snapshotText ?? JSON.stringify(snapshot, null, 2),
    );
  }
  return root;
}

describe('#396 CLI 診斷（壞掉的輸入必須說得出是哪個檔案壞在哪，不能丟 stack）', () => {
  const scratchRoots: string[] = [];
  function scratch(options?: Parameters<typeof makeScratchRepo>[0]) {
    const root = makeScratchRepo(options);
    scratchRoots.push(root);
    return root;
  }
  afterAll(() => {
    for (const root of scratchRoots) rmSync(root, { recursive: true, force: true });
  });

  it('乾淨的 scratch repo 通過', () => {
    const result = runChecker(scratch());
    expect(result.ok).toBe(true);
    expect(result.messages.join('\n')).toContain('OK');
  });

  it('對照表檔案不存在 → 指名檔案，不丟 ENOENT stack', () => {
    const root = scratch();
    rmSync(join(root, 'supabase', 'ledger-alias-map.json'));
    const result = runChecker(root);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('ledger-alias-map.json');
    expect(result.messages[0]).toContain('不存在');
  });

  it('對照表是目錄（EISDIR）→ 說明它是目錄', () => {
    const root = scratch();
    rmSync(join(root, 'supabase', 'ledger-alias-map.json'));
    mkdirSync(join(root, 'supabase', 'ledger-alias-map.json'));
    const result = runChecker(root);
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('目錄');
  });

  it('對照表 JSON 語法壞掉 → 說「不是合法的 JSON」，不丟 SyntaxError stack', () => {
    const result = runChecker(scratch({ aliasMapText: '{ "schemaVersion": 1, ' }));
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('不是合法的 JSON');
    expect(result.messages[0]).toContain('ledger-alias-map.json');
  });

  it('對照表最外層是陣列 → 說「最外層必須是 object」，不丟 TypeError', () => {
    const result = runChecker(scratch({ aliasMapText: '[]' }));
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('最外層必須是一個 JSON object');
    expect(result.messages[0]).toContain('陣列');
  });

  it('對照表最外層是 null → 同樣被擋下', () => {
    const result = runChecker(scratch({ aliasMapText: 'null' }));
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('最外層必須是一個 JSON object');
    expect(result.messages[0]).toContain('null');
  });

  it('對照表最外層是字串／數字 → 同樣被擋下', () => {
    for (const text of ['"oops"', '42']) {
      const result = runChecker(scratch({ aliasMapText: text }));
      expect(result.ok).toBe(false);
      expect(result.messages[0]).toContain('最外層必須是一個 JSON object');
    }
  });

  it('ledgerSnapshotRef 缺少或不是字串 → 指名這個欄位', () => {
    for (const text of ['{}', '{ "ledgerSnapshotRef": 123 }', '{ "ledgerSnapshotRef": "" }']) {
      const result = runChecker(scratch({ aliasMapText: text }));
      expect(result.ok).toBe(false);
      expect(result.messages[0]).toContain('ledgerSnapshotRef');
    }
  });

  it('ledgerSnapshotRef 指到不存在的路徑 → 指名路徑', () => {
    const result = runChecker(scratch({
      aliasMapText: JSON.stringify({ ledgerSnapshotRef: 'supabase/nope.json' }),
    }));
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('不存在');
    expect(result.messages[0]).toContain('supabase/nope.json');
  });

  it('ledgerSnapshotRef 指到一個目錄 → 說明它是目錄，而不是 EISDIR', () => {
    const result = runChecker(scratch({ snapshotAsDirectory: true }));
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('目錄');
    expect(result.messages[0]).not.toContain('EISDIR');
  });

  it('ledgerSnapshotRef 指到 repo 之外 → 拒絕', () => {
    const result = runChecker(scratch({
      aliasMapText: JSON.stringify({ ledgerSnapshotRef: '../../etc/passwd' }),
    }));
    expect(result.ok).toBe(false);
    expect(result.messages[0]).toContain('repo 之外');
  });

  it('快照 JSON 壞掉／最外層不是 object → 指名快照檔', () => {
    for (const text of ['{ oops', '[]']) {
      const result = runChecker(scratch({ snapshotText: text }));
      expect(result.ok).toBe(false);
      expect(result.messages[0]).toContain('production-ledger-snapshot.json');
    }
  });

  it('readJsonFile 本身不會把例外丟出來，一律回傳可讀訊息', () => {
    const result = readJsonFile('/definitely/not/here.json', '測試用檔案');
    expect(result.ok).toBe(false);
    const message = (result as { ok: false; message: string }).message;
    expect(message).toContain('測試用檔案');
    expect(message).toContain('不存在');
  });
});

describe('#396 NOT_APPLIED 的兩種狀態必須用列舉講清楚', () => {
  it('NOT_APPLIED_REASONS 剛好是兩種', () => {
    expect([...NOT_APPLIED_REASONS].sort()).toEqual(['PENDING_APPLY', 'VERIFIED_NOT_APPLIED']);
  });

  it('NOT_APPLIED 缺 notAppliedReason → 擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const entry = aliasMap.entries.find((e: any) => e.classification === 'NOT_APPLIED');
    delete entry.notAppliedReason;
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('notAppliedReason'))).toBe(true);
  });

  it('notAppliedReason 寫了不認得的值 → 擋下', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const entry = aliasMap.entries.find((e: any) => e.classification === 'NOT_APPLIED');
    entry.notAppliedReason = 'MAYBE_LATER';
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('notAppliedReason'))).toBe(true);
  });

  it('PENDING_APPLY 是合法值（新合併、尚未部署的 migration）', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    const entry = aliasMap.entries.find((e: any) => e.classification === 'NOT_APPLIED');
    entry.notAppliedReason = 'PENDING_APPLY';
    entry.evidence = '已合併進 main，尚未部署到正式庫。';
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(true);
  });

  it('非 NOT_APPLIED 的 entry 帶 notAppliedReason → 擋下（避免改分類時忘了拿掉）', () => {
    const { repoFiles, ledgerRowNames, aliasMap } = minimalFixture();
    aliasMap.entries[0].notAppliedReason = 'PENDING_APPLY';
    const result = verifyLedgerAliasMap({ repoFiles, ledgerRowNames, aliasMap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('只有 NOT_APPLIED 可以有 notAppliedReason'))).toBe(true);
  });

  it('對照表的 notAppliedReasons 定義必須跟 checker 認得的列舉逐字一致', () => {
    const { aliasMap } = minimalFixture();
    delete aliasMap.notAppliedReasons.PENDING_APPLY;
    const result = validateAliasMapShape(aliasMap);
    expect(result.errors.some((e) => e.includes('notAppliedReasons') && e.includes('PENDING_APPLY'))).toBe(true);
  });

  it('已提交的正式對照表：每一筆 NOT_APPLIED 都有合法的 notAppliedReason', () => {
    const aliasMap = loadRealAliasMap();
    const notApplied = aliasMap.entries.filter((e: any) => e.classification === 'NOT_APPLIED');
    // 目前為 12 筆：0110、0111、0113、0115、0116_issue_18_owner_notify、
    // 0117_issue_25b_support_chat_threads、0118_issue_25c_platform_donations、
    // 0119_issue_18_owner_notify_confirm_atomic、0121_issue_17_booking_addons_hardening
    // 這 9 支是 PENDING_APPLY；0109（SCHEMA_REPAIR）、0112 與 0114（AUTHZ+BACKFILL 混合）是
    // VERIFIED_NOT_APPLIED。0107／0108 已套用正式庫轉為 EXACT；0105 於
    // 2026-09-15 以唯讀查詢確認先前已套用於正式庫，本檔誤標記已更正為 EXACT。保留 main 那一版的
    // 意圖：釘住數量而不是只檢查「每一筆都有理由」，否則清單變空時這條規則會
    // 靜悄悄變成空轉。任何人日後新增或移除 NOT_APPLIED 都會先撞到這一行，被迫
    // 同時面對下面那條「必須有合法 notAppliedReason」的規則。
    expect(notApplied.length).toBe(12);
    for (const entry of notApplied) {
      expect(NOT_APPLIED_REASONS).toContain(entry.notAppliedReason);
    }
  });
});

describe('#396 名稱抄寫錯誤（空白／大小寫）必須擋下', () => {
  it('兩邊都抄成 "0001_a " 也不能通過', () => {
    const { aliasMap } = minimalFixture();
    aliasMap.entries[0].repoFile = '0001_a ';
    aliasMap.entries[0].ledgerNames = ['0001_a '];
    const result = verifyLedgerAliasMap({
      repoFiles: ['0001_a ', '0002_b', '0003_c'],
      ledgerRowNames: ['0001_a ', 'renamed_b', '0090_c'],
      aliasMap,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: string) => e.includes('空白'))).toBe(true);
  });

  it('ledger 快照裡的 row 名稱有前後空白 → 擋下', () => {
    const result = validateLedgerSnapshotShape({
      schemaVersion: 1,
      issue: 396,
      environment: 'PRODUCTION',
      projectRef: 'egehnijjpgijmccagxac',
      capturedAt: '2026-09-13',
      source: 'x',
      note: 'x',
      rowCount: 1,
      ledgerRowNames: [' 0001_a'],
    });
    expect(result.errors.some((e) => e.includes('空白'))).toBe(true);
  });

  it('大寫、雙底線、頭尾底線都不合法', () => {
    for (const bad of ['0001_A', '0001__a', '_0001_a', '0001_a_']) {
      const result = validateLedgerSnapshotShape({
        schemaVersion: 1,
        issue: 396,
        environment: 'PRODUCTION',
        projectRef: 'egehnijjpgijmccagxac',
        capturedAt: '2026-09-13',
        source: 'x',
        note: 'x',
        rowCount: 1,
        ledgerRowNames: [bad],
      });
      expect(result.errors.some((e) => e.includes(bad)), bad).toBe(true);
    }
  });

  it('目前實際存在的非數字前綴名稱仍然合法', () => {
    const result = validateLedgerSnapshotShape({
      schemaVersion: 1,
      issue: 396,
      environment: 'PRODUCTION',
      projectRef: 'egehnijjpgijmccagxac',
      capturedAt: '2026-09-13',
      source: 'x',
      note: 'x',
      rowCount: 3,
      ledgerRowNames: [
        'customer_source',
        'close_tour_seat_rpc_public_execute',
        'close_public_execute_on_server_only_security_definer_rpcs',
      ],
    });
    expect(result.errors).toEqual([]);
  });
});
