import { describe, expect, it } from "vitest";

import {
  canonicalIssueEvidenceRef,
  canonicalIssueSubject,
} from "../../scripts/agents/score-run-v2.mjs";

describe("Delivery Unit repository identity", () => {
  it("accepts the current repository and rejects the same Issue number from another repository", () => {
    expect(
      canonicalIssueSubject(
        "https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/10",
      ),
    ).toBe("issue#10");
    expect(
      canonicalIssueSubject(
        "https://github.com/smallwei0301/tour-platform/issues/10",
      ),
    ).toBeNull();
    expect(
      canonicalIssueEvidenceRef(
        "https://api.github.com/repos/smallwei0301/tour-platform/issues/10",
      ),
    ).toBeNull();
  });
});
