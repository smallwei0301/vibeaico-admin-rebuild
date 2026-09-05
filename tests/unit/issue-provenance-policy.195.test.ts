import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  REQUIRED_AGENT_PROVENANCE_HEADINGS,
  readHeadingSection,
  runCli,
  validateIssueProvenance,
} from '../../scripts/agents/issue-provenance-policy.mjs';

function agentIssueBody(overrides: Partial<Record<string, string>> = {}): string {
  const sections: Record<string, string> = {
    '## Issue origin': 'AGENT_DISCOVERED',
    '### Parent Issue / PR': 'Issue #104 / PR #194',
    '### Discovered stage': 'RETROSPECTIVE',
    '### Scope Firewall reason': 'Governance-only parser; no Product runtime.',
    '### Why this cannot remain in the parent Issue': 'The parent is observation-only and this needs a bounded source change.',
    '### Blocks current goal': 'YES',
    '### Evidence': '- github:issue#193\n- repo:scripts/agents/issue-provenance-policy.mjs',
    '### Requested model / actual model': 'requested=Terra implementation + Sol audit；actual=unknown',
  };
  Object.assign(sections, overrides);
  return Object.entries(sections).map(([heading, value]) => `${heading}\n\n${value}`).join('\n\n');
}

describe('Issue #195 shared provenance policy', () => {
  it('keeps one canonical list of seven required Agent headings', () => {
    expect(REQUIRED_AGENT_PROVENANCE_HEADINGS).toEqual([
      '### Parent Issue / PR',
      '### Discovered stage',
      '### Scope Firewall reason',
      '### Why this cannot remain in the parent Issue',
      '### Blocks current goal',
      '### Evidence',
      '### Requested model / actual model',
    ]);
  });

  it('accepts a complete Agent-discovered Issue and actual=unknown', () => {
    const result = validateIssueProvenance(agentIssueBody());
    expect(result).toMatchObject({
      origin: 'agent',
      isAgent: true,
      valid: true,
      missingHeadings: [],
      emptyHeadings: [],
      errors: [],
    });
  });

  it('does not let Live evidence impersonate the exact Evidence heading', () => {
    const body = agentIssueBody().replace('### Evidence', '### Live evidence');
    const result = validateIssueProvenance(body);
    expect(result.valid).toBe(false);
    expect(result.missingHeadings).toContain('### Evidence');
    expect(result.errors).toContain('missing required heading: ### Evidence');
  });

  it.each(['', 'none', 'TBD', '<!-- later -->'])('rejects an Evidence shell containing only %j', (value) => {
    const result = validateIssueProvenance(agentIssueBody({ '### Evidence': value }));
    expect(result.valid).toBe(false);
    expect(result.emptyHeadings).toContain('### Evidence');
    expect(result.errors).toContain('### Evidence must contain substantive non-placeholder content');
  });

  it.each(['MAYBE', 'UNKNOWN', 'YES because it matters', ''])('requires exact YES or NO for Blocks current goal: %j', (value) => {
    const result = validateIssueProvenance(agentIssueBody({ '### Blocks current goal': value }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('### Blocks current goal must be exactly YES or NO');
  });

  it('requires both requested and actual model fields', () => {
    const requestedOnly = validateIssueProvenance(agentIssueBody({
      '### Requested model / actual model': 'requested=Terra',
    }));
    expect(requestedOnly.valid).toBe(false);
    expect(requestedOnly.errors).toContain(
      '### Requested model / actual model must contain actual=<model or unknown>',
    );

    const actualOnly = validateIssueProvenance(agentIssueBody({
      '### Requested model / actual model': 'actual=unknown',
    }));
    expect(actualOnly.valid).toBe(false);
    expect(actualOnly.errors).toContain(
      '### Requested model / actual model must contain requested=<model or role>',
    );
  });

  it('does not impose Agent fields on an Owner-directed Issue', () => {
    const result = validateIssueProvenance('## Issue origin\n\nOWNER_DIRECTED\n\nAGENT_DISCOVERED is discussed only as documentation.');
    expect(result).toEqual({
      origin: 'owner-or-unknown',
      isAgent: false,
      valid: true,
      missingHeadings: [],
      emptyHeadings: [],
      errors: [],
    });
  });

  it('classifies by the Issue origin section, not a stray marker elsewhere', () => {
    const body = '# Notes\n\nThe string AGENT_DISCOVERED appears in an example, not in Issue origin.';
    expect(validateIssueProvenance(body)).toMatchObject({
      origin: 'owner-or-unknown',
      isAgent: false,
      valid: true,
    });
  });

  it('reads a heading section only until the next Markdown heading', () => {
    const body = '### Evidence\n\n- github:issue#195\n\n### Requested model / actual model\n\nrequested=Terra; actual=unknown';
    expect(readHeadingSection(body, '### Evidence')).toBe('- github:issue#195');
  });

  it('uses the shared module from the trusted workflow instead of another inline heading list', () => {
    const workflow = fs.readFileSync(
      path.resolve(process.cwd(), '.github/workflows/issue-provenance.yml'),
      'utf8',
    );
    expect(workflow).toContain('scripts/agents/issue-provenance-policy.mjs');
    expect(workflow).toContain('policy.validateIssueProvenance');
    expect(workflow).not.toContain('const requiredHeadings =');
    expect(workflow).toContain('persist-credentials: false');
  });

  it('fails the CLI before Issue creation when --body is missing or unreadable', () => {
    expect(() => runCli([])).toThrow(/Usage: issue-provenance-policy\.mjs --body/);
    expect(() => runCli(['--body', '/definitely/not/a/real/issue-body.md'])).toThrow(
      /issue body file does not exist/,
    );
  });

  it('runs the CLI against a real body file and reports the classified origin', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-provenance-'));
    const file = path.join(directory, 'issue.md');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      fs.writeFileSync(file, agentIssueBody(), 'utf8');
      const result = runCli(['--body', file]);
      expect(result.valid).toBe(true);
      expect(result.origin).toBe('agent');
      expect(log).toHaveBeenCalledWith('ISSUE_PROVENANCE_PASS origin=agent');
    } finally {
      log.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns the same exact error through the CLI and policy', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-provenance-'));
    const file = path.join(directory, 'issue.md');
    try {
      fs.writeFileSync(
        file,
        agentIssueBody().replace('### Evidence', '### Live evidence'),
        'utf8',
      );
      expect(() => runCli(['--body', file])).toThrow(
        /missing required heading: ### Evidence/,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
