import { describe, expect, it } from "vitest";

import {
  classifyPr,
  evaluateDeclaredSupersession,
  findBudgetViolations,
  inferIssueNumber,
  parseLifecycleMetadata,
} from "../../scripts/agents/pr-janitor.mjs";

function pr(overrides: Record<string, unknown> = {}) {
  return {
    number: 75,
    state: "open",
    title: "feat(#40): notification safety",
    body: "",
    head: { ref: "agent/issue-40", sha: "newsha" },
    ...overrides,
  } as any;
}

describe("PR lifecycle metadata", () => {
  it("parses machine-readable lifecycle fields", () => {
    expect(
      parseLifecycleMetadata(`before\n<!-- pr-lifecycle\nissue: 40\nstate: ACTIVE\nsupersedes: #59, 72,72\n-->\nafter`),
    ).toEqual({
      issue: 40,
      state: "ACTIVE",
      supersedes: [59, 72],
      explicit: true,
    });
  });

  it("fails closed on an unknown state", () => {
    expect(
      parseLifecycleMetadata(`<!-- pr-lifecycle\nissue: 40\nstate: MAGIC\nsupersedes:\n-->`),
    ).toMatchObject({ issue: 40, state: null, supersedes: [] });
  });
});

describe("issue inference", () => {
  it("prefers explicit lifecycle issue", () => {
    const row = pr({
      title: "mentions #999",
      body: `<!-- pr-lifecycle\nissue: 40\nstate: ACTIVE\nsupersedes:\n-->`,
    });
    expect(inferIssueNumber(row)).toBe(40);
  });

  it("infers one unambiguous issue from title or branch", () => {
    expect(inferIssueNumber(pr({ title: "fix Issue #41", head: { ref: "feature/work", sha: "x" } }))).toBe(41);
    expect(inferIssueNumber(pr({ title: "group formation", head: { ref: "agent/issue-41-epoch", sha: "x" } }))).toBe(41);
  });

  it("returns null when references are ambiguous", () => {
    expect(inferIssueNumber(pr({ title: "bridge #40 with #41", head: { ref: "feature/mixed", sha: "x" } }))).toBeNull();
  });
});

describe("supersession safety", () => {
  const source = pr({
    number: 75,
    body: `<!-- pr-lifecycle\nissue: 40\nstate: ACTIVE\nsupersedes: 72\n-->`,
    head: { ref: "agent/issue-40-new", sha: "newsha" },
  });
  const target = pr({
    number: 72,
    title: "Issue #40 old candidate",
    head: { ref: "agent/issue-40-old", sha: "oldsha" },
  });

  it("allows close only when declared, same-issue ancestry is proven", () => {
    expect(evaluateDeclaredSupersession({ source, target, compareStatus: "ahead" })).toEqual({
      safe: true,
      reason: "DECLARED_AND_ANCESTRY_PROVEN",
    });
    expect(evaluateDeclaredSupersession({ source, target, compareStatus: "identical" }).safe).toBe(true);
  });

  it("refuses diverged or issue-mismatched candidates", () => {
    expect(evaluateDeclaredSupersession({ source, target, compareStatus: "diverged" })).toMatchObject({
      safe: false,
      reason: "ANCESTRY_DIVERGED",
    });

    const otherIssue = pr({
      number: 72,
      title: "Issue #41 old candidate",
      head: { ref: "agent/issue-41-old", sha: "oldsha" },
    });
    expect(evaluateDeclaredSupersession({ source, target: otherIssue, compareStatus: "ahead" })).toMatchObject({
      safe: false,
      reason: "ISSUE_MISMATCH_OR_UNKNOWN",
    });
  });
});

describe("PR budget", () => {
  it("flags more than one ACTIVE or more than two total PRs for one issue", () => {
    const rows = [
      pr({
        number: 10,
        body: `<!-- pr-lifecycle\nissue: 40\nstate: ACTIVE\nsupersedes:\n-->`,
      }),
      pr({
        number: 11,
        body: `<!-- pr-lifecycle\nissue: 40\nstate: ACTIVE\nsupersedes:\n-->`,
      }),
      pr({
        number: 12,
        body: `<!-- pr-lifecycle\nissue: 40\nstate: VALIDATION\nsupersedes:\n-->`,
      }),
    ];

    const violations = findBudgetViolations(rows);
    expect(violations).toHaveLength(1);
    expect(violations[0].issue).toBe(40);
    expect(violations[0].active.map((row) => row.number)).toEqual([10, 11]);
  });

  it("keeps one ACTIVE plus one VALIDATION within budget", () => {
    const rows = [
      pr({
        number: 10,
        body: `<!-- pr-lifecycle\nissue: 40\nstate: ACTIVE\nsupersedes:\n-->`,
      }),
      pr({
        number: 11,
        body: `<!-- pr-lifecycle\nissue: 40\nstate: VALIDATION\nsupersedes:\n-->`,
      }),
    ];
    expect(findBudgetViolations(rows)).toEqual([]);
    expect(classifyPr(rows[0])).toMatchObject({ issue: 40, state: "ACTIVE" });
  });
});
