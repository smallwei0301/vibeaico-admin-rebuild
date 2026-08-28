import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(
  new URL('../../scripts/verify/keyword-replies-preview-live.cjs', import.meta.url),
), 'utf8');

describe('issue #5 Preview verifier safety contract', () => {
  it('uses shared secure Preview helpers and never embeds login credentials', () => {
    expect(source).toContain("require('./_preview-lib.cjs')");
    expect(source).toContain("required('TEST_EMAIL')");
    expect(source).toContain("required('TEST_PASSWORD')");
    expect(source).not.toMatch(/password\s*[:=]\s*['\"][^'\"]+['\"]/i);
  });

  it('fails closed unless Production Preview DML is explicitly authorized', () => {
    expect(source).toContain("const EXPECTED_AUTHORIZATION = `issue-5-keyword-probe:${PROD_REF}`");
    expect(source).toContain('process.env.ALLOW_PRODUCTION_PREVIEW_DML !== EXPECTED_AUTHORIZATION');
    expect(source).toContain('BLOCKED_BY_OWNER: Preview uses Production Supabase');
    expect(source.indexOf('ALLOW_PRODUCTION_PREVIEW_DML'))
      .toBeLessThan(source.indexOf("required('TEST_EMAIL')"));
  });

  it('requires the deployed Preview and local capture server to use the same commit', () => {
    expect(source).toContain("execFileSync('git', ['rev-parse', 'HEAD']");
    expect(source).toContain('PREVIEW_GIT_COMMIT_SHA');
    expect(source).toContain('PREVIEW_SHA !== LOCAL_SHA');
  });

  it('signs the webhook and captures the exact mock LINE reply', () => {
    expect(source).toContain("createHmac('sha256', CHANNEL_SECRET)");
    expect(source).toContain("call.path === '/v2/bot/message/reply'");
    expect(source).toContain("messages[0]?.text === REPLY");
    expect(source).not.toContain('https://api.line.me');
  });

  it('deletes by authenticated API and verifies cleanup from finally', () => {
    const finallyBlock = source.slice(source.indexOf('} finally {'));
    expect(finallyBlock).toContain('deleteProbeKeywords(page)');
    expect(source).toContain("method: 'DELETE'");
    expect(source).toContain("remaining.length === 0");
    expect(finallyBlock).toContain('delete from chat_messages');
  });
});
