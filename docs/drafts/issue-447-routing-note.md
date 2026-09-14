# Issue #447 source-stage routing note

The current ChatGPT session is GPT-5.6 Sol. It produced the initial source-only controlled-writer candidate because no build-tier sub-agent/connector is exposed in this session.

This is recorded as a routing deviation, not silently relabeled as Terra. The candidate may use Draft CI to discover source defects, but it must not become merge-ready solely from this session's implementation evidence.

Before Ready/merge, either:

1. a build-tier Product agent independently reconstructs/verifies the implementation and records truthful build-tier evidence, or
2. current canonical Product routing is explicitly changed by a newer Owner/governance decision.

Final Risk remains separate and mandatory for the Product/Production execution boundary. No Production database write is authorized by this note.
