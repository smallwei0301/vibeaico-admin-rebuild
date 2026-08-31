import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyPr,
  evaluateDeclaredSupersession,
  findBudgetViolations,
  inferIssueNumber,
  parseLifecycleMetadata,
  runJanitor,
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

const lifecycle = `<!-- pr-lifecycle
issue: 40
state: ACTIVE
supersedes: 72
-->`;

function janitorSource(overrides: Record<string, unknown> = {}) {
  return pr({
    number: 75,
    body: lifecycle,
    head: {
      ref: "agent/issue-40-new",
      sha: "newsha",
      repo: { full_name: "acme/repo" },
    },
    ...overrides,
  });
}

function janitorTarget(overrides: Record<string, unknown> = {}) {
  return pr({
    number: 72,
    title: "Issue #40 old candidate",
    head: { ref: "agent/issue-40-old", sha: "oldsha" },
    ...overrides,
  });
}

function mockJanitorApi({
  source = janitorSource(),
  target = janitorTarget(),
  sourceAtFetch = () => source,
  targetAtFetch = () => target,
}: {
  source?: any;
  target?: any;
  sourceAtFetch?: (count: number) => any;
  targetAtFetch?: (count: number) => any;
} = {}) {
  let sourceFetches = 0;
  let targetFetches = 0;
  const calls: Array<{ method: string; path: string }> = [];
  const fetchMock = vi.fn(async (input: string | URL, options?: RequestInit) => {
    const url = new URL(String(input));
    const method = options?.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    calls.push({ method, path });
    const route = url.pathname.replace("/repos/acme/repo", "");

    if (route === "/pulls" && method === "GET") return Response.json([source, target]);
    if (route === "/compare/oldsha...newsha" && method === "GET") return Response.json({ status: "ahead" });
    if (route === "/pulls/75" && method === "GET") return Response.json(sourceAtFetch(++sourceFetches));
    if (route === "/pulls/72" && method === "GET") return Response.json(targetAtFetch(++targetFetches));
    if (route === "/issues/72/comments" && method === "GET") return Response.json([]);
    if (route === "/issues/72/comments" && method === "POST") return Response.json({ id: 1 }, { status: 201 });
    if (route === "/pulls/72" && method === "PATCH") return Response.json({ ...target, state: "closed" });
    throw new Error(`Unexpected GitHub API call: ${method} ${path}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GITHUB_REPOSITORY", "acme/repo");
  vi.stubEnv("GITHUB_TOKEN", "test-token");
  return { calls, fetchMock, getSourceFetches: () => sourceFetches, getTargetFetches: () => targetFetches };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

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

  it("uses title or branch as the primary legacy signal even when the body mentions dependencies", () => {
    expect(
      inferIssueNumber(
        pr({
          title: "Draft: reconstruct #40 notification safety",
          head: { ref: "agent/issue-40-current-main", sha: "x" },
          body: "Depends on Issue #41 and validates PR #57 before final Issue #40 audit.",
        }),
      ),
    ).toBe(40);
  });

  it("returns null when primary references are ambiguous", () => {
    expect(inferIssueNumber(pr({ title: "bridge #40 with #41", head: { ref: "feature/mixed", sha: "x" } }))).toBeNull();
  });

  it("does not fall back to title, body, or branch when lifecycle issue is blank", () => {
    expect(inferIssueNumber(pr({
      title: "fix #64",
      head: { ref: "agent/issue-64", sha: "x" },
      body: "<!-- pr-lifecycle\nissue:\nstate: ACTIVE\nsupersedes:\n--> references #78",
    }))).toBeNull();
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

  it("never lets an ACTIVE PR supersede itself", () => {
    const self = pr({
      number: 75,
      body: `<!-- pr-lifecycle\nissue: 40\nstate: ACTIVE\nsupersedes: 75\n-->`,
      head: { ref: "agent/issue-40-new", sha: "newsha" },
    });
    expect(evaluateDeclaredSupersession({ source: self, target: self, compareStatus: "identical" })).toEqual({
      safe: false,
      reason: "SELF_SUPERSESSION",
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
    expect(violations[0].active.map((row: { number: number }) => row.number)).toEqual([10, 11]);
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
    expect(classifyPr(pr({ body: "" }))).toMatchObject({ state: "JANITOR_REVIEW" });
  });
});

describe("runJanitor mutation races", () => {
  it("re-fetches both PRs immediately before each safe comment and close", async () => {
    const api = mockJanitorApi();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await runJanitor({ apply: true });

    expect(result.actions).toEqual([{ source: 75, target: 72, reason: "DECLARED_AND_ANCESTRY_PROVEN" }]);
    expect(result.reviews).toEqual([]);
    expect(api.getSourceFetches()).toBe(2);
    expect(api.getTargetFetches()).toBe(2);
    expect(api.calls.some((call) => call.method === "POST")).toBe(true);
    expect(api.calls.some((call) => call.method === "PATCH" && call.path === "/repos/acme/repo/pulls/72")).toBe(true);
  });

  it("returns JANITOR_REVIEW and makes no mutation when the source head changed after compare", async () => {
    const api = mockJanitorApi({
      sourceAtFetch: () => janitorSource({ head: { ref: "agent/issue-40-new", sha: "rewritten" } }),
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await runJanitor({ apply: true });

    expect(result.actions).toEqual([]);
    expect(result.reviews).toEqual([{ source: 75, target: 72, reason: "JANITOR_REVIEW_SOURCE_CHANGED" }]);
    expect(api.calls.some((call) => call.method === "POST" || call.method === "PATCH")).toBe(false);
  });

  it("returns JANITOR_REVIEW and makes no mutation when the target synchronized after compare", async () => {
    const api = mockJanitorApi({
      targetAtFetch: () => janitorTarget({ head: { ref: "agent/issue-40-old", sha: "synchronized" } }),
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await runJanitor({ apply: true });

    expect(result.actions).toEqual([]);
    expect(result.reviews).toEqual([{ source: 75, target: 72, reason: "JANITOR_REVIEW_TARGET_CHANGED" }]);
    expect(api.calls.some((call) => call.method === "POST" || call.method === "PATCH")).toBe(false);
  });

  it("returns JANITOR_REVIEW and makes no mutation when the source becomes a fork", async () => {
    const api = mockJanitorApi({
      sourceAtFetch: () => janitorSource({
        head: { ref: "agent/issue-40-new", sha: "newsha", repo: { full_name: "attacker/fork" } },
      }),
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await runJanitor({ apply: true });

    expect(result.actions).toEqual([]);
    expect(result.reviews).toEqual([
      { source: 75, target: 72, reason: "JANITOR_REVIEW_SOURCE_NOT_SAME_REPOSITORY" },
    ]);
    expect(api.calls.some((call) => call.method === "POST" || call.method === "PATCH")).toBe(false);
  });

  it("re-fetches both PRs again before close and stops if the source changes after commenting", async () => {
    const api = mockJanitorApi({
      sourceAtFetch: (count) => (
        count === 1
          ? janitorSource()
          : janitorSource({ head: { ref: "agent/issue-40-new", sha: "rewritten" } })
      ),
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await runJanitor({ apply: true });

    expect(result.actions).toEqual([]);
    expect(result.reviews).toEqual([{ source: 75, target: 72, reason: "JANITOR_REVIEW_SOURCE_CHANGED" }]);
    expect(api.getSourceFetches()).toBe(2);
    expect(api.getTargetFetches()).toBe(2);
    expect(api.calls.some((call) => call.method === "POST" && call.path.startsWith("/repos/acme/repo/issues/72/comments"))).toBe(true);
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
  });
});
