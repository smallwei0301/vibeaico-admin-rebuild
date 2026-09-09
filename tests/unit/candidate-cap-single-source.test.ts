/**
 * tests/unit/candidate-cap-single-source.test.ts
 * =============================================================================
 * Product candidate 上限（Owner 2026-09-09 裁示：2 → 3）的兩件事：
 *
 *   1. **數字只有一份。** 在這次收斂之前，同一個上限硬編碼在**九個位置**：
 *      `agent-wip-policy.mjs` 的檢查、`dual-terra-wip-policy.mjs` 的檢查、
 *      `agent-wip-guard.yml` 裡摘要表格與 PR 留言各一次的 `.../2`、同一支
 *      workflow 裡 `candidate:active` label 的描述字串，以及
 *      `score-run.mjs` 三處（`wipHealthy` 判定、建議文字、報告的「目標 ≤2」）
 *      與 `score-run-v2.mjs` 一處（完成度加分）。
 *
 *      ⚠️ 前五處是逐輪風險評估一處一處挖出來的（第五處是 label 描述，第六～九處
 *      是 scorer）——「我掃過了」在這件事上被推翻過兩次，所以本檔的每一條鎖都附
 *      對照組，且都經過變異驗證。
 *
 *      ⚠️ 這九處**不是等價的**：擋 PR 的只有 `agent-wip-guard.yml` →
 *      `dual-terra-wip-policy.mjs` 的 `validateGlobalWip`（全 repo 唯一非測試進入點）。
 *      `ci.yml` 雖然 import 了 `agent-wip-policy.mjs`，但只呼叫
 *      `decideTestValidation`，從不碰 `validateGlobalWip`——**那一份是死碼，
 *      目前只有本檔在執行它**。仍要一起鎖，因為 dual-terra 的 `validateGlobalWip`
 *      是另一份獨立實作，兩份各帶一個數字，留著就會分岔。而 `score-run*.mjs`
 *      **兩支都在 CI 真的跑**（`agent-run-scorecard.yml`、
 *      `agent-run-ledger-reconcile.yml`）：上限放寬後若不同步，一個峰值 3 的
 *      **合規** Run 會被扣 3 分完成度、標成 `wipHealthy=false`，並被建議「收斂
 *      候選」——把合規行為報成違規。
 *
 *   2. **上限本身是 3，而且 3 過、4 不過。** 只驗常數等於 3 是不夠的——那只證明
 *      有一個叫這個名字的數字，證不到閘門真的照它放行或擋下。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MAX_ACTIVE_CANDIDATES,
  summarizeActiveLanes,
  validateGlobalWip,
} from '../../scripts/agents/agent-wip-policy.mjs';
import {
  MAX_ACTIVE_CANDIDATES as DUAL_MAX,
  summarizeActiveLanes as dualSummarize,
  validateGlobalWip as dualValidate,
} from '../../scripts/agents/dual-terra-wip-policy.mjs';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const shaFor = (n: number) => n.toString(16).padStart(40, 'a');

/**
 * 一個 open 的 TERRA_BUILD active candidate。欄位取自 `agent-wip-policy.test.ts`
 * 的既有 helper，只留這條測試需要的部分。
 */
function candidatePr(number: number) {
  const rows = Object.entries({
    WORK_ORIGIN: 'AGENT',
    AGENT_LANE: 'TERRA_BUILD',
    LANE_STATE: 'ACTIVE',
    ACTIVE_CANDIDATE: 'true',
    CLOSEABILITY_SCORE: '4',
    SELECTION_REASON: 'CLOSE_READY',
    REMAINING_AUTONOMOUS_STEPS: 'one targeted test',
    OWNER_OR_EXTERNAL_BLOCKER: 'none',
    CLOSURE_SWEEP_TARGET: 'EMPTY_WITH_SCAN',
    TEST_LANE_REQUIRED: 'false',
    WHY_NOT_CLOSER_CANDIDATE: 'none',
    'REQUESTED_MODEL / ACTUAL_MODEL': 'requested=Terra; actual=unknown',
    BPLUS_MODE: 'true',
    RUN_ID: '2026-09-09-r01',
    RESERVE_BOUNDARY: 'none',
    SCORECARD_PATH: 'docs/metrics/agent-runs/2026-09-09-r01.json',
  }).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return {
    number,
    state: 'open',
    body: `<!-- pr-lifecycle\nissue: ${number}\nstate: ACTIVE\nsupersedes:\n-->\n\n${rows}`,
    html_url: `https://example.test/${number}`,
    head: { ref: `branch-${number}`, sha: shaFor(number), repo: { full_name: 'owner/repo' } },
    base: { sha: shaFor(number + 100) },
  };
}

const candidateError = (errors: string[]) =>
  errors.find((e) => e.includes('ACTIVE_CANDIDATE count is'));

describe('Product candidate 上限只有一份定義', () => {
  it('兩支活著的 policy 模組匯出同一個常數', () => {
    // dual-terra 是 re-export，不是自己再宣告一次；若哪天有人改成各寫各的，這裡會紅。
    expect(MAX_ACTIVE_CANDIDATES).toBe(DUAL_MAX);
  });

  it('`agent-wip-guard.yml` 不再自己寫死數字，而是從匯入的 policy 取', () => {
    const workflow = read('.github/workflows/agent-wip-guard.yml');
    // 對照組：必須真的抓得到，否則下面的 not.toMatch 只是因為找不到東西而恆真。
    expect(workflow).toContain('policy.MAX_ACTIVE_CANDIDATES');
    expect((workflow.match(/policy\.MAX_ACTIVE_CANDIDATES/g) ?? []).length).toBe(3);
    // 摘要與 PR 留言都不得再出現 `activeCandidates.length}/<數字>` 的寫死形式。
    expect(workflow).not.toMatch(/activeCandidates\.length\}\/\d/);
  });

  /**
   * ⚠️ 這一條是補上一個**被實測證明存在的盲區**。
   *
   * `candidate:active` 這個 GitHub label 的描述字串裡原本寫著
   * `maximum of two active Product delivery candidates`——那是第五處硬編碼，
   * 就在同一支 workflow 裡，而且 `createLabel` 會把它真的寫進 GitHub。
   *
   * 上面那條掃的是 `activeCandidates.length}/<數字>` 的形式，**掃不到這一行**：
   * 2026-09-09 的風險評估把 `two` 改成 `ninety-nine`，整個檔案 8/8 全綠。
   * 一個宣稱「字面量已全數收斂」的 PR，自己的鎖看不到自己漏掉的那一處。
   */
  it('`candidate:active` 的 label 描述也取自常數（createLabel 會把它寫進 GitHub）', () => {
    const workflow = read('.github/workflows/agent-wip-guard.yml');
    const labelLine = workflow.split('\n').find((l) => l.includes("'candidate:active'"));
    // 對照組：那一行必須存在。
    expect(labelLine, "找不到 'candidate:active' 的 label 定義").toBeTruthy();
    expect(labelLine).toContain('${policy.MAX_ACTIVE_CANDIDATES}');

    /*
     * ⚠️ 不用「片語比對」當唯一防線。只禁止 `maximum of <n> active Product
     * delivery candidates` 這個句型的話，有人改寫句子（例如
     * `cap of 2 active Product candidates (was ${…})`）就能同時保留插值又混進
     * 字面量而不被抓到——這是 2026-09-09 R3 實測存活的變異。
     * 這裡改成：把描述字串本體抓出來，斷言裡面**一個數字都不許有**。
     */
    const description = /'candidate:active':\s*\[[^,]+,\s*`([^`]*)`\]/.exec(labelLine ?? '')?.[1];
    // 對照組：抓不到描述就等於什麼都沒驗。
    expect(description, "解析不出 'candidate:active' 的描述字串").toBeTruthy();
    expect(
      description,
      'label 描述裡出現了寫死的數字；上限只能來自 ${policy.MAX_ACTIVE_CANDIDATES}',
    ).not.toMatch(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  });

  it('policy 模組裡不得再出現寫死的候選上限', () => {
    for (const file of [
      'scripts/agents/agent-wip-policy.mjs',
      'scripts/agents/dual-terra-wip-policy.mjs',
    ]) {
      const src = read(file);
      expect(
        src,
        `${file} 又把 ACTIVE_CANDIDATE 的上限寫死成數字了`,
      ).not.toMatch(/activeCandidates\.length > \d/);
    }
  });
});

describe('上限是 3：三個放行、第四個擋下', () => {
  it('常數是 3', () => {
    expect(MAX_ACTIVE_CANDIDATES).toBe(3);
  });

  /**
   * ⚠️ 這兩組才是真正的驗收。只斷言常數等於 3，證不到閘門有照它動作——
   * 有人把檢查改回 `> 2` 而常數留著 3，上面那條照樣綠。
   */
  for (const [label, summarize, validate] of [
    ['agent-wip-policy（CI 未執行此檢查，僅本測試覆蓋）', summarizeActiveLanes, validateGlobalWip],
    ['dual-terra-wip-policy（agent-wip-guard 實際執行的就是這支）', dualSummarize, dualValidate],
  ] as const) {
    it(`${label}：3 個 active candidate 不產生上限錯誤`, () => {
      const errors = validate(summarize([candidatePr(10), candidatePr(11), candidatePr(12)]));
      expect(candidateError(errors as string[]), `三個就被擋了：${errors.join(' / ')}`)
        .toBeUndefined();
    });

    it(`${label}：4 個 active candidate 會被擋下並報出實際數量`, () => {
      const errors = validate(summarize([
        candidatePr(10), candidatePr(11), candidatePr(12), candidatePr(13),
      ]));
      const found = candidateError(errors as string[]);
      expect(found, '第四個沒有被擋下').toBeDefined();
      expect(found).toContain('ACTIVE_CANDIDATE count is 4');
      expect(found).toContain('max is 3');
    });
  }
});

/**
 * ⚠️ 這一組鎖的是 2026-09-09 R3 挖出的第六～九處——而且和前五處不同，它們不是
 * 文件字串，是 **CI 每次都會執行的評分程式**：
 *
 *   `agent-run-scorecard.yml` 對 schema v1 帳本跑 `score-run.mjs --check`
 *   （逐字比對已 commit 的報告），對 v2 帳本跑 `score-run-v2.mjs` 再 `diff -u`；
 *   `agent-run-ledger-reconcile.yml` 也重跑 v2。
 *
 * 所以「上限放寬但 scorer 沒跟上」不是文件不一致，是**評分把合規 Run 判成違規**。
 */
describe('CI 在跑的兩支 scorer 也吃同一個常數', () => {
  it('score-run*.mjs 不得再出現寫死的候選上限', () => {
    for (const file of ['scripts/agents/score-run.mjs', 'scripts/agents/score-run-v2.mjs']) {
      const src = read(file);
      // 對照組：這兩支檔案必須真的在處理 activeCandidatePeak，否則下面恆真。
      expect(src, `${file} 沒有處理 activeCandidatePeak`).toContain('activeCandidatePeak');
      expect(src, `${file} 沒有從 policy 取常數`).toContain('MAX_ACTIVE_CANDIDATES');
      expect(
        src,
        `${file} 又把候選上限寫死成數字了`,
      ).not.toMatch(/activeCandidatePeak\)?\s*(?:<=|>)\s*\d/);
    }
    // v1 報告裡的「目標 ≤N」也必須是插值。
    expect(read('scripts/agents/score-run.mjs')).not.toMatch(/Active Candidate 峰值[^\n]*目標 ≤\d/);
  });

  /**
   * 行為驗收：只驗「檔案裡沒有字面量」證不到評分真的照常數動作。
   * 拿 repo 裡真實的帳本改一個欄位，看 MAX 與 MAX+1 的差別。
   */
  const ledger = (p: string) => JSON.parse(read(p)) as Record<string, never>;

  it('score-run（v1）：峰值等於上限算健康，上限 +1 才進建議清單', async () => {
    const { scoreRun, renderMarkdown } = await import('../../scripts/agents/score-run.mjs');
    const base = ledger('docs/metrics/agent-runs/2026-09-01-bplus-adoption.json');
    const at = (peak: number) => {
      const run = { ...base, inventory: { ...(base as any).inventory, activeCandidatePeak: peak } };
      return renderMarkdown(run, scoreRun(run)) as string;
    };
    const ok = at(MAX_ACTIVE_CANDIDATES);
    const over = at(MAX_ACTIVE_CANDIDATES + 1);
    expect(ok).toContain(`（目標 ≤${MAX_ACTIVE_CANDIDATES}）`);
    expect(ok, '峰值剛好等於上限卻被列進建議清單').not.toContain('Active Candidate 峰值超過');
    // 對照組：+1 必須真的被抓出來，否則上面那條只是因為這條路徑從不觸發才綠。
    expect(over, '超過上限卻沒有任何建議').toContain(
      `Active Candidate 峰值超過 ${MAX_ACTIVE_CANDIDATES}`,
    );
  });

  /**
   * v2 的評分被三道閘門擋在前面（未完成的 Run、hard fail、grading gap 都會提早
   * 回傳 `scores: null`），而 repo 裡現有的 v2 帳本全是 `IN_PROGRESS`，
   * 直接拿來跑只會得到 `NOT_GRADED`——那樣兩邊都是 null，相減永遠不等於 3，
   * 測試會變成「因為根本沒評分所以看不出差別」。
   * 所以這裡從真實帳本出發，把那三道閘門需要的欄位補成可評分狀態，
   * **只有 `activeCandidatePeak` 一個欄位在兩次呼叫之間不同**。
   */
  const gradableV2 = (peak: number) => {
    const b = ledger('docs/metrics/agent-runs/2026-09-04-product-delivery-r01.json') as any;
    return {
      ...b,
      status: 'BASELINE',
      endedAt: '2026-09-09T00:00:00Z',
      main: { ...b.main, endSha: 'a'.repeat(40) },
      completionTruth: {
        status: 'VERIFIED',
        checkedAt: '2026-09-09T00:00:00Z',
        claims: [{
          type: 'RUN_COMPLETE', subject: 'issue#1', claimedState: 'complete',
          observedState: 'complete', evidenceRef: 'issue/1', verification: 'VERIFIED',
        }],
      },
      quality: {
        ...b.quality, hardFailReasons: [], safetyViolations: 0,
        acceptanceEvidenceCoveragePercent: 100, auditFirstPassRatePercent: 100,
      },
      ci: { ...b.ci, firstPassRatePercent: 100 },
      flow: { ...b.flow, waitTimeConvertedPercent: 100 },
      modelUsage: { ...b.modelUsage, weightedUsageImprovementPercent: 0 },
      auditability: {
        ...b.auditability, evidenceFieldsCompletePercent: 100, exactHeadTestCoveragePercent: 100,
        preciseBlockersPercent: 100, scoreInputsCompletePercent: 100,
      },
      inventory: { ...b.inventory, activeCandidatePeak: peak, openIssuesEnd: 1, openPrsEnd: 1 },
    };
  };

  it('score-run-v2：峰值等於上限拿得到那 3 分完成度，上限 +1 拿不到', async () => {
    const { scoreRunV2 } = await import('../../scripts/agents/score-run-v2.mjs');
    const at = (peak: number) => scoreRunV2(gradableV2(peak)) as {
      scoreStatus: string; scores: { completion: number } | null;
    };
    const ok = at(MAX_ACTIVE_CANDIDATES);
    const over = at(MAX_ACTIVE_CANDIDATES + 1);
    // 對照組：兩次都必須真的被評分，否則下面只是 null - null。
    expect(ok.scoreStatus, '上限內的 Run 沒有被評分').toBe('GRADED_V2');
    expect(over.scoreStatus, '超過上限的 Run 沒有被評分').toBe('GRADED_V2');
    expect(ok.scores!.completion - over.scores!.completion).toBe(3);
  });
});
