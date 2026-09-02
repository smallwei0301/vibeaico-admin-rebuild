import { describe, expect, it } from "vitest";
import { createRunLedgerV2, validateRunLedgerV2 } from "../../scripts/agents/run-ledger-v2.mjs";
import { canonicalIssueSubject, computeDeliveryOutcome, scoreRunV2 } from "../../scripts/agents/score-run-v2.mjs";
import { reviewRunsV2 } from "../../scripts/agents/review-runs-v2.mjs";

function claim(type: string, subject: string, observedState: string, evidenceRef = `github:${subject}`): any {
  return {
    type,
    subject,
    claimedState: observedState,
    observedState,
    verification: "VERIFIED",
    evidenceRef,
  };
}

function completedRun(id = "2026-09-02-delivery-v2"): any {
  const run: any = createRunLedgerV2(id, "2026-09-02T00:00:00Z");
  run.status = "COMPLETE";
  run.endedAt = "2026-09-02T02:00:00Z";
  run.main = { startSha: "a", endSha: "b" };
  run.inventory = {
    openIssuesStart: 10, openIssuesEnd: 9, openPrsStart: 4, openPrsEnd: 3,
    mainTerraPeak: 1, reserveTerraPeak: 1, activeCandidatePeak: 2, sharedTestPeak: 1,
    closureSweeps: 1, closureAdvancedOrClosed: 1,
  };
  run.modelUsage.weightedUsageImprovementPercent = 10;
  run.modelUsage.tasks = [
    { id: "l1", requestedModel: "luna", actualModel: "luna", role: "truth", count: 2, contextClass: "compact", accepted: true, inputTokens: null, outputTokens: null, cachedTokens: null },
    { id: "t1", requestedModel: "terra", actualModel: "terra", role: "build", count: 1, contextClass: "medium", accepted: true, inputTokens: null, outputTokens: null, cachedTokens: null },
    { id: "s1", requestedModel: "sol", actualModel: "sol", role: "audit", count: 1, contextClass: "compact", accepted: true, inputTokens: null, outputTokens: null, cachedTokens: null },
  ];
  run.delivery = {
    issuesStarted: 1, issuesClosed: 1, auditReady: 0, ownerBlockedComplete: 0,
    exactHeadCiOnly: 0, commitOnly: 0, unfinishedCarryover: 0, cycleTimeMinutes: 120,
  };
  run.ci = { fullCiRuns: 1, invalidReruns: 0, firstPassRatePercent: 100, sharedTestCollisions: 0 };
  run.quality = {
    acceptanceEvidenceCoveragePercent: 100, auditFirstPassRatePercent: 100,
    unresolvedP0: 0, unresolvedP1: 0, reopenedIssues: 0, postMergeRegressions: 0,
    safetyViolations: 0, hardFailReasons: [],
  };
  run.flow = {
    lunaTasks: 2, lunaAccepted: 2, lunaDelegationRatePercent: 80,
    duplicateAgentTasks: 0, ownershipCollisions: 0, waitTimeConvertedPercent: 100,
    solTouches: 2, solIssues: 1,
  };
  run.auditability = {
    evidenceFieldsCompletePercent: 100, exactHeadTestCoveragePercent: 100,
    stalePendingDescriptions: 0, preciseBlockersPercent: 100, scoreInputsCompletePercent: 100,
  };
  run.completionTruth = {
    status: "VERIFIED",
    checkedAt: "2026-09-02T02:01:00Z",
    claims: [claim("ISSUE_CLOSED", "issue#10", "closed"), claim("RUN_COMPLETE", id, "complete")],
  };
  return run;
}

describe("Delivery Outcome v2", () => {
  it("creates a valid v2 ledger with a truth section", () => {
    const run: any = createRunLedgerV2("2026-09-02-empty");
    expect(run.schemaVersion).toBe(2);
    expect(validateRunLedgerV2(run)).toEqual([]);
  });

  it("canonicalizes supported Issue references to one delivery identity", () => {
    expect([
      canonicalIssueSubject("issue#10"),
      canonicalIssueSubject("Issue: 10"),
      canonicalIssueSubject("#10"),
      canonicalIssueSubject("https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/10"),
      canonicalIssueSubject("https://api.github.com/repos/smallwei0301/vibeaico-admin-rebuild/issues/10"),
    ]).toEqual(["issue#10", "issue#10", "issue#10", "issue#10", "issue#10"]);
    expect(canonicalIssueSubject("pull#10")).toBeNull();
  });

  it("counts only unique verified CLOSED and complete OWNER_BLOCKED evidence as outcomes", () => {
    const run = completedRun();
    run.delivery = { ...run.delivery, issuesClosed: 1, ownerBlockedComplete: 1, auditReady: 5, exactHeadCiOnly: 4, commitOnly: 9, unfinishedCarryover: 3 };
    run.completionTruth.claims.splice(1, 0, claim("OWNER_BLOCKED_COMPLETE", "issue#11", "owner_blocked_complete"));
    expect(computeDeliveryOutcome(run)).toEqual({
      shippedUnits: 1,
      autonomousOutcomeUnits: 1.75,
      wipInventory: { auditReady: 5, exactHeadCiOnly: 4, commitOnly: 9, unfinishedCarryover: 3 },
    });
  });

  it("does not let duplicate CLOSED claims cover two shipped units", () => {
    const run = completedRun("2026-09-02-duplicate-closed");
    run.delivery.issuesStarted = 2;
    run.delivery.issuesClosed = 2;
    run.completionTruth.claims = [
      claim("ISSUE_CLOSED", "issue#10", "closed"),
      claim("ISSUE_CLOSED", "#10", "closed"),
      claim("RUN_COMPLETE", run.runId, "complete"),
    ];

    const result = scoreRunV2(run);
    expect(result.scoreStatus).toBe("NOT_GRADED");
    expect(result.shippedUnits).toBe(1);
    expect(result.gradingGaps).toContain(
      "delivery.issuesClosed=2 does not match 1 unique verified ISSUE_CLOSED subject(s)",
    );
  });

  it("accepts two distinct verified CLOSED Issues as two shipped units", () => {
    const run = completedRun("2026-09-02-distinct-closed");
    run.delivery.issuesStarted = 2;
    run.delivery.issuesClosed = 2;
    run.completionTruth.claims.splice(1, 0, claim("ISSUE_CLOSED", "issue#11", "closed"));

    const result = scoreRunV2(run);
    expect(result.scoreStatus).toBe("GRADED_V2");
    expect(result.shippedUnits).toBe(2);
  });

  it("hard-fails one Issue verified as both CLOSED and OWNER_BLOCKED_COMPLETE", () => {
    const run = completedRun("2026-09-02-contradictory-delivery-state");
    run.delivery.ownerBlockedComplete = 1;
    run.completionTruth.claims.splice(1, 0, claim("OWNER_BLOCKED_COMPLETE", "#10", "owner_blocked_complete"));

    const result = scoreRunV2(run);
    expect(result.scoreStatus).toBe("HARD_FAIL");
    expect(result.grade).toBe("F-HARD");
    expect(result.autonomousOutcomeUnits).toBe(1);
    expect(result.hardFailures).toContain(
      "issue#10 is verified as both ISSUE_CLOSED and OWNER_BLOCKED_COMPLETE",
    );
  });

  it("deduplicates repeated OWNER_BLOCKED evidence instead of adding another 0.75", () => {
    const run = completedRun("2026-09-02-duplicate-owner-blocked");
    run.status = "OWNER_BLOCKED";
    run.delivery.issuesClosed = 0;
    run.delivery.ownerBlockedComplete = 1;
    run.completionTruth.claims = [
      claim("OWNER_BLOCKED_COMPLETE", "issue#10", "owner_blocked_complete"),
      claim("OWNER_BLOCKED_COMPLETE", "https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/10", "owner_blocked_complete"),
      claim("RUN_COMPLETE", run.runId, "complete"),
    ];

    const result = scoreRunV2(run);
    expect(result.scoreStatus).toBe("GRADED_V2");
    expect(result.shippedUnits).toBe(0);
    expect(result.autonomousOutcomeUnits).toBe(0.75);
  });

  it("does not count malformed Issue subjects or placeholder evidence", () => {
    const run = completedRun("2026-09-02-malformed-delivery-evidence");
    run.completionTruth.claims[0] = claim("ISSUE_CLOSED", "TBD", "closed", "TBD");

    const result = scoreRunV2(run);
    expect(result.scoreStatus).toBe("NOT_GRADED");
    expect(result.shippedUnits).toBe(0);
    expect(result.gradingGaps).toContain("ISSUE_CLOSED TBD does not identify one canonical Issue");
    expect(result.gradingGaps).toContain("ISSUE_CLOSED TBD has no usable evidenceRef");
  });

  it("rejects an empty evidenceRef at ledger validation", () => {
    const run = completedRun("2026-09-02-empty-evidence-ref");
    run.completionTruth.claims[0].evidenceRef = "";
    expect(validateRunLedgerV2(run)).toContain(
      "completionTruth.claims[0].evidenceRef is required for VERIFIED claims",
    );
  });

  it("does not grade an IN_PROGRESS run or calculate a tiny-denominator ratio", () => {
    const run: any = createRunLedgerV2("2026-09-02-progress");
    run.delivery.commitOnly = 1;
    run.modelUsage.tasks = [{ id: "t", requestedModel: "terra", actualModel: "unknown", role: "build", count: 1, contextClass: "medium", accepted: true, inputTokens: null, outputTokens: null, cachedTokens: null }];
    const result = scoreRunV2(run);
    expect(result.scoreStatus).toBe("NOT_GRADED");
    expect(result.total).toBeNull();
    expect(result.shippedUnits).toBe(0);
    expect(result.weightedUsagePerShippedUnit).toBeNull();
  });

  it("does not silently fill missing percentages with 50", () => {
    const run = completedRun();
    run.quality.acceptanceEvidenceCoveragePercent = null;
    const result = scoreRunV2(run);
    expect(result.scoreStatus).toBe("NOT_GRADED");
    expect(result.gradingGaps).toContain("quality.acceptanceEvidenceCoveragePercent is missing");
  });

  it("hard-fails a local green claim when the live job was skipped", () => {
    const run = completedRun();
    run.completionTruth.claims.push({
      type: "LOCAL_TEST_GREEN", subject: "run#123", claimedState: "success",
      observedState: "skipped", verification: "VERIFIED", evidenceRef: "github:run#123",
    });
    const result = scoreRunV2(run);
    expect(result.scoreStatus).toBe("HARD_FAIL");
    expect(result.grade).toBe("F-HARD");
  });

  it("calculates per-shipped usage only after at least one verified shipment", () => {
    const result = scoreRunV2(completedRun());
    expect(result.scoreStatus).toBe("GRADED_V2");
    expect(result.shippedUnits).toBe(1);
    expect(result.weightedUsagePerShippedUnit).not.toBeNull();
  });

  it("keeps one complete OWNER_BLOCKED visible without calling it shipped", () => {
    const run = completedRun("2026-09-02-owner-blocked");
    run.status = "OWNER_BLOCKED";
    run.delivery.issuesClosed = 0;
    run.delivery.ownerBlockedComplete = 1;
    run.completionTruth.claims = [
      claim("OWNER_BLOCKED_COMPLETE", "issue#10", "owner_blocked_complete"),
      claim("RUN_COMPLETE", run.runId, "complete"),
    ];
    const result = scoreRunV2(run);
    expect(result.shippedUnits).toBe(0);
    expect(result.autonomousOutcomeUnits).toBe(0.75);
    expect(result.weightedUsagePerShippedUnit).toBeNull();
    expect(result.weightedUsagePerAutonomousOutcome).toBeNull();
  });

  it("retrospective compares only completed truth-verified v2 runs", () => {
    const complete = completedRun("2026-09-02-complete");
    const progress: any = createRunLedgerV2("2026-09-02-progress");
    const result = reviewRunsV2([{ file: "complete.json", run: complete }, { file: "progress.json", run: progress }]);
    expect(result.eligible.map((item: any) => item.run.runId)).toEqual(["2026-09-02-complete"]);
    expect(result.excluded.map((item: any) => item.run.runId)).toEqual(["2026-09-02-progress"]);
  });
});
