import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lineSettingsReadSchema, lineSettingsSchema } from '@/config/tenant-settings';

const state = vi.hoisted(() => ({
  tenantId: 'tenant-a',
  rows: {} as Record<string, Record<string, any>>,
  queryError: null as Error | null,
  writeError: null as Error | null,
  eq: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/server/crypto', () => ({
  decryptSecret: (value: string) => value ? `decrypted-${value}` : '',
  encryptSecret: (value: string) => `encrypted-${value}`,
}));
vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({
    tenantId: state.tenantId, tenantName: 'Readback test', shopCode: 'readback-test',
    supabase: {
      from: (table: string) => {
        if (table !== 'tenant_settings') throw new Error(`Unexpected table: ${table}`);
        return {
          select: () => ({ eq: (key: string, id: string) => {
            state.eq(key, id);
            return { maybeSingle: async () => ({ data: state.rows[id] ?? null, error: state.queryError }) };
          } }),
          upsert: async (payload: Record<string, any>) => {
            state.upsert(payload);
            if (!state.writeError) state.rows[payload.tenant_id] = { ...state.rows[payload.tenant_id], ...payload };
            return { error: state.writeError };
          },
        };
      },
    },
  }),
}));
vi.mock('@/server/supabase', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/server/storage', () => ({
  removeWelcomeCardImage: vi.fn(), tenantOwnedPublicStorageUrl: vi.fn(), WELCOME_CARD_BUCKET: 'test',
}));
vi.mock('@/server/business-hours-blocks', () => ({ rebuildAutoBlocks: vi.fn() }));

import { GET } from '@/app/api/settings/route';
import { PUT } from '@/app/api/settings/line/route';

async function getSettings() {
  const response = await GET(new Request('http://localhost/api/settings'), {});
  return { response, body: await response.json() };
}
async function saveLine(patch: Record<string, unknown>) {
  return PUT(new Request('http://localhost/api/settings/line', {
    method: 'PUT', body: JSON.stringify(patch), headers: { 'Content-Type': 'application/json' },
  }), {});
}

beforeEach(() => {
  state.tenantId = 'tenant-a';
  state.rows = {
    'tenant-a': {
      line: { channelId: '123', richMenuId: 'richmenu-a', channelSecret: 'legacy-leak' },
      line_channel_secret_enc: 'secret-value', line_channel_access_token_enc: 'token-value',
    },
    'tenant-b': { line: { richMenuId: 'richmenu-b' } },
  };
  state.queryError = null;
  state.writeError = null;
  state.eq.mockClear();
  state.upsert.mockClear();
});

describe('saved Rich Menu ID readback (#47)', () => {
  it('returns the authenticated tenant record while redacting secrets and encrypted columns', async () => {
    const { response, body } = await getSettings();
    expect(response.status).toBe(200);
    expect(body.data.line.richMenuId).toBe('richmenu-a');
    expect(state.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('legacy-leak');
    expect(serialized).not.toContain('decrypted-secret-value');
    expect(serialized).not.toContain('decrypted-token-value');
    expect(serialized).not.toContain('line_channel_secret_enc');
    state.tenantId = 'tenant-b';
    expect((await getSettings()).body.data.line.richMenuId).toBe('richmenu-b');
  });

  it('defaults old/missing records to no saved ID', async () => {
    state.rows['tenant-a'] = { line: { channelId: '123' } };
    expect((await getSettings()).body.data.line.richMenuId).toBe('');
    state.rows['tenant-a'] = { line: { richMenuId: null } };
    expect((await getSettings()).body.data.line.richMenuId).toBe('');
    delete state.rows['tenant-a'];
    expect((await getSettings()).body.data.line.richMenuId).toBe('');
  });

  it('preserves the saved ID through a normal settings save and a subsequent read', async () => {
    expect((await saveLine({ richMenuTheme: 'OCEAN_BLUE', channelAccessToken: '' })).status).toBe(200);
    expect((await getSettings()).body.data.line.richMenuId).toBe('richmenu-a');
    expect(state.upsert.mock.calls[0][0].line.channelSecret).toBeUndefined();
    expect(state.upsert.mock.calls[0][0].line_channel_access_token_enc).toBeUndefined();
  });

  it('ignores a client-forged ID passed through the settings API', async () => {
    expect(lineSettingsSchema.partial().parse({ richMenuId: 'forged' })).toEqual({});
    expect(lineSettingsReadSchema.parse({ richMenuId: 'saved' }).richMenuId).toBe('saved');
    await saveLine({ richMenuId: 'forged', autoReplyEnabled: false });
    expect((await getSettings()).body.data.line.richMenuId).toBe('richmenu-a');
    state.rows['tenant-a'] = { line: {} };
    await saveLine({ richMenuId: 'forged' });
    expect((await getSettings()).body.data.line.richMenuId).toBe('');
  });
});
