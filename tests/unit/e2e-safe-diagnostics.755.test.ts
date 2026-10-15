import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directories: string[] = [];
const sentinel = 'SYNTHETIC_CREDENTIAL_MUST_NOT_BE_EXPORTED';
const tenantId = '11111111-1111-4111-8111-111111111111';
const tripId = '22222222-2222-4222-8222-222222222222';
const resource = 'a'.repeat(40) + '.json';

afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

function fixture(payload: unknown, pathname = '/api/auth/me') {
  const root = mkdtempSync(join(tmpdir(), 'safe-e2e-'));
  directories.push(root);
  const source = join(root, 'test-results'), output = join(root, 'safe-output');
  mkdirSync(source);
  const snapshot = { type: 'resource-snapshot', snapshot: {
    request: { url: `http://${sentinel}@localhost:3100${pathname}?token=${sentinel}`,
      method: 'GET', headers: [{ name: 'Authorization', value: sentinel }], cookies: [sentinel], postData: { text: sentinel } },
    response: { status: 200, headers: [{ name: 'Set-Cookie', value: sentinel }], cookies: [sentinel], content: { _sha1: resource } },
  } };
  execFileSync('python3', ['-c', `
import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 z.writestr('context.network', sys.argv[2]+'\\n')
 z.writestr('resources/'+sys.argv[3], sys.argv[4])
 z.writestr('context.trace', sys.argv[5])
 z.writestr('resources/page.html', sys.argv[5])
`, join(source, 'trace.zip'), JSON.stringify(snapshot), resource, JSON.stringify(payload), sentinel]);
  return { source, output };
}

function run(source: string, output: string) {
  execFileSync('python3', [resolve('scripts/agents/e2e-safe-diagnostics.py'), source, output]);
  const text = readFileSync(join(output, 'api-metadata.json'), 'utf8');
  expect(text).not.toContain(sentinel);
  expect(text).not.toMatch(/Authorization|Set-Cookie|postData|access_token|refresh_token|password|email/);
  return JSON.parse(text);
}

describe('safe E2E diagnostics export uses real ZIP resources and denies credential propagation', () => {
  it('retains auth tenant/role and HTTP status while dropping credentials, DOM and arbitrary response fields', () => {
    const f = fixture({ data: { tenantId, role: 'OWNER', access_token: sentinel, refresh_token: sentinel,
      email: sentinel, password: sentinel, nested: { cookies: sentinel } } });
    expect(run(f.source, f.output)).toMatchObject({ rawTracePublished: false, traces: [{ status: 'READ', requests: [{
      pathname: '/api/auth/me', method: 'GET', httpStatus: 200, data: { tenantId, role: 'OWNER' },
    }] }] });
  });
  it('retains only IDs/status and canonical synthetic fixture titles from trip responses', () => {
    const f = fixture({ data: [{ id: tripId, tenant_id: tenantId, status: 'PUBLISHED', title: 'E2E行程-abc123-已編輯',
      slug: sentinel, contact: sentinel, description: sentinel },
    { id: sentinel, tenantId: sentinel, status: sentinel, title: sentinel }] }, '/api/trips');
    expect(run(f.source, f.output).traces[0].requests[0].data).toEqual({ rowCount: 2, rows: [
      { id: tripId, tenantId, status: 'PUBLISHED', fixtureTitle: 'E2E行程-abc123-已編輯' },
      { id: null, tenantId: null, status: null, fixtureTitle: null },
    ] });
  });
  it('omits login/token endpoints and preserves missing/corrupt traces without raw errors', () => {
    const f = fixture({ data: { tenantId, token: sentinel } }, '/api/auth/login');
    expect(run(f.source, f.output).traces[0].requests).toEqual([]);
    writeFileSync(join(f.source, 'trace.zip'), sentinel);
    expect(run(f.source, f.output).traces[0].status).toBe('UNREADABLE_TRACE');
    rmSync(join(f.source, 'trace.zip'));
    expect(run(f.source, f.output)).toMatchObject({ status: 'NO_TRACES', traces: [] });
  });
});
