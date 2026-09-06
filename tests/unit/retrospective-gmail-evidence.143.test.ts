import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  resolve(process.cwd(), '.agents/skills/vibeaico-agent-retrospective/SKILL.md'),
  'utf8',
);

describe('Issue #143 retrospective Gmail evidence contract', () => {
  it('loads Gmail before scoring run ledgers', () => {
    expect(skill).toContain('version: "1.3.0"');
    expect(skill).toContain('search Gmail for that exact window');
    expect(skill).toContain('Read the full relevant Gmail messages or threads');
    expect(skill.indexOf('search Gmail for that exact window')).toBeLessThan(
      skill.indexOf('Find `docs/metrics/agent-runs/*.json`'),
    );
  });

  it('records reproducible but redacted email evidence', () => {
    for (const required of [
      'Gmail query',
      'message IDs',
      'received timestamps',
      'branch, exact SHA, deployment ID, workflow ID, provider error code or quota signal',
      'Never copy access tokens, passwords, keys or full secret-bearing messages',
    ]) {
      expect(skill).toContain(required);
    }
  });

  it('does not confuse unavailable Gmail with zero incidents', () => {
    expect(skill).toContain('GMAIL_EVIDENCE_UNAVAILABLE');
    expect(skill).toContain('GMAIL_FULL_BODY_NOT_VERIFIED');
    expect(skill).toContain('It must never be rewritten as「沒有事故」');
  });

  it('keeps live provider state above notification and PR prose', () => {
    const live = skill.indexOf('live provider API／dashboard state');
    const gmail = skill.indexOf('full Gmail message／thread from the provider');
    const bot = skill.indexOf('GitHub provider-bot comment or status');
    const prose = skill.indexOf('PR／Issue prose');
    expect(live).toBeGreaterThan(-1);
    expect(live).toBeLessThan(gmail);
    expect(gmail).toBeLessThan(bot);
    expect(bot).toBeLessThan(prose);
  });

  it('requires the final retrospective to expose Gmail and live-state differences', () => {
    expect(skill).toContain('Gmail／外部通知事件摘要');
    expect(skill).toContain('Gmail、GitHub 與 live provider 的差異');
    expect(skill).toContain('Vercel deployment count split by main, explicit Preview and blocked branch');
  });
});
