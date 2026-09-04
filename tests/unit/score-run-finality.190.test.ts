import { describe, expect, it } from "vitest";

import { createRunLedgerV2 } from "../../scripts/agents/run-ledger-v2.mjs";
import { renderMarkdownV2, scoreRunV2 } from "../../scripts/agents/score-run-v2.mjs";

function contradictedCiClaim() {
  return {
    type: "CI_GREEN",
    subject: "issue#190 exact-head first attempt",
    claimedState: "success",
    observedState: "failed",
    verification: "CONTRADICTED",
    evidenceRef: "github:actions/runs/190",
  };
}

function runWithContradiction(status = "IN_PROGRESS"): any {
  const run: any = createRunLedgerV2("2026-09-05-finality-order-test", "2026-09-05T00:00:00Z");
  run.status = status;
  run.completionTruth = {
    status: "VERIFIED",
    checkedAt: "2026-09-05T00:01:00Z",
    claims: [contradictedCiClaim()],
  };
  return run;
}

describe("Issue #190 score finality ordering", () => {
  it("keeps an IN_PROGRESS contradiction visible without assigning F-HARD", () => {
    const run = runWithContradiction();
    const result = scoreRunV2(run);

    expect(result.scoreStatus).toBe("NOT_GRADED");
    expect(result.grade).toBe("NOT_GRADED");
    expect(result.total).toBeNull();
    expect(result.comparisonEligible).toBe(false);
    expect(result.gradingGaps).toContain("run is still in progress");
    expect(result.hardFailures).toContain(
      "CI_GREEN issue#190 exact-head first attempt contradicts live evidence",
    );

    const markdown = renderMarkdownV2(run, result);
    expect(markdown).toContain("> 評分狀態：**NOT_GRADED**");
    expect(markdown).toContain("> 分數：尚不評分");
    expect(markdown).toContain("## 結案前必須修正的硬性問題");
    expect(markdown).not.toContain("0 / 100（F-HARD）");
  });

  it("keeps CLOSURE_RECOVERY safety problems diagnostic while remaining ungraded", () => {
    const run: any = createRunLedgerV2("2026-09-05-closure-recovery-test", "2026-09-05T00:00:00Z");
    run.status = "CLOSURE_RECOVERY";
    run.quality.safetyViolations = 1;
    run.quality.hardFailReasons = ["completion claim was not verified"];

    const result = scoreRunV2(run);

    expect(result.scoreStatus).toBe("NOT_GRADED");
    expect(result.total).toBeNull();
    expect(result.gradingGaps).toContain("run is still in progress");
    expect(result.hardFailures).toEqual(expect.arrayContaining([
      "completion claim was not verified",
      "quality.safetyViolations > 0",
    ]));
  });

  it("assigns F-HARD when the same contradiction reaches a final Run status", () => {
    const run = runWithContradiction("COMPLETE");
    const result = scoreRunV2(run);

    expect(result.scoreStatus).toBe("HARD_FAIL");
    expect(result.grade).toBe("F-HARD");
    expect(result.total).toBe(0);
    expect(result.comparisonEligible).toBe(false);
    expect(result.hardFailures).toContain(
      "CI_GREEN issue#190 exact-head first attempt contradicts live evidence",
    );
  });
});
