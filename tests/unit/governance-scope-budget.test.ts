import { describe, expect, it } from "vitest";
import { evaluateGovernanceScope, GOVERNANCE_SCOPE_BUDGET } from "../../scripts/agents/governance-scope-budget.mjs";

const branch = "governance/large-owner-approved";

function governancePr({ files = 8, additions = 500, deletions = 300, exception = "none", state = "ACTIVE" } = {}) {
  return {
    changed_files: files,
    additions,
    deletions,
    head: { ref: branch },
    body: [
      "- WORK_ORIGIN: AGENT",
      "- AGENT_LANE: GOVERNANCE",
      `- LANE_STATE: ${state}`,
      `- GOVERNANCE_SCOPE_EXCEPTION: ${exception}`,
    ].join("\n"),
  };
}

const approvedDecision = [
  "- GOVERNANCE_SCOPE_EXCEPTION: APPROVED",
  `- GOVERNANCE_SCOPE_BRANCH: ${branch}`,
].join("\n");

describe("governance scope budget", () => {
  it("keeps the default budget at 8 files and 800 changed lines", () => {
    expect(GOVERNANCE_SCOPE_BUDGET).toEqual({ maxFiles: 8, maxChangedLines: 800 });
  });

  it("allows an active Agent governance PR exactly at the budget", () => {
    expect(evaluateGovernanceScope(governancePr())).toMatchObject({
      applies: true,
      allowed: true,
      files: 8,
      changedLines: 800,
      errors: [],
    });
  });

  it("blocks a ninth file", () => {
    const result = evaluateGovernanceScope(governancePr({ files: 9, additions: 400, deletions: 200 }));
    expect(result.allowed).toBe(false);
    expect(result.errors[0]).toContain("9 files / 600 changed lines");
  });

  it("blocks line 801", () => {
    const result = evaluateGovernanceScope(governancePr({ additions: 600, deletions: 201 }));
    expect(result.allowed).toBe(false);
    expect(result.errors[0]).toContain("8 files / 801 changed lines");
  });

  it("accepts a trusted Owner Decision for the exact branch", () => {
    const exception = "OWNER:docs/decisions/2026-09-02-scope.md";
    expect(evaluateGovernanceScope(
      governancePr({ files: 12, additions: 900, deletions: 50, exception }),
      { loadDecision: () => approvedDecision },
    )).toMatchObject({ allowed: true, exception });
  });

  it("rejects a missing or wrong-branch decision", () => {
    const pr = governancePr({ files: 12, exception: "OWNER:docs/decisions/missing.md" });
    expect(evaluateGovernanceScope(pr, { loadDecision: () => null }).errors).toContain(
      "Scope exception decision must exist on trusted main and approve this exact branch",
    );
    expect(evaluateGovernanceScope(pr, { loadDecision: () => approvedDecision.replace(branch, "other-branch") }).allowed).toBe(false);
  });

  it("rejects an Issue number or vague exception prose", () => {
    for (const exception of ["OWNER:#113", "Owner said okay"]) {
      const result = evaluateGovernanceScope(governancePr({ files: 12, exception }));
      expect(result.allowed).toBe(false);
      expect(result.errors).toContain("GOVERNANCE_SCOPE_EXCEPTION must be none or OWNER:docs/decisions/<file>.md");
    }
  });

  it("fails closed when GitHub size metrics are missing", () => {
    const result = evaluateGovernanceScope({ body: governancePr().body, head: { ref: branch } });
    expect(result.allowed).toBe(false);
    expect(result.errors[0]).toContain("scope metrics are unavailable");
  });

  it("does not apply to parked or non-governance work", () => {
    expect(evaluateGovernanceScope(governancePr({ files: 99, state: "PARKED" })).applies).toBe(false);
    const product = governancePr({ files: 99 });
    product.body = product.body.replace("AGENT_LANE: GOVERNANCE", "AGENT_LANE: TERRA_BUILD");
    expect(evaluateGovernanceScope(product).applies).toBe(false);
  });
});
