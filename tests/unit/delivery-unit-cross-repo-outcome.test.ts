import { describe, expect, it } from "vitest";

import { createRunLedgerV2 } from "../../scripts/agents/run-ledger-v2.mjs";
import { scoreRunV2 } from "../../scripts/agents/score-run-v2.mjs";

describe("Delivery Unit foreign-repository evidence", () => {
  it("does not count or hard-fail an otherwise usable Issue URL from another repository", () => {
    const run: any = createRunLedgerV2("2026-09-02-foreign-repo-evidence");
    run.status = "COMPLETE";
    run.delivery.issuesClosed = 1;
    run.completionTruth = {
      status: "VERIFIED",
      checkedAt: "2026-09-02T06:10:00Z",
      claims: [
        {
          type: "ISSUE_CLOSED",
          subject: "issue#10",
          claimedState: "closed",
          observedState: "closed",
          verification: "VERIFIED",
          evidenceRef: "https://github.com/smallwei0301/tour-platform/issues/10",
        },
      ],
    };

    const result = scoreRunV2(run);

    expect(result.scoreStatus).toBe("NOT_GRADED");
    expect(result.shippedUnits).toBe(0);
    expect(result.hardFailures).toEqual([]);
    expect(result.gradingGaps).toContain(
      "ISSUE_CLOSED issue#10 evidenceRef does not identify one canonical Issue",
    );
  });
});
