import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state: {
    line: Record<string, unknown>;
    upsertError: { code?: string; constraint?: string; message?: string } | null;
  } = { line: {}, upsertError: null };

  const upsert = vi.fn(async (payload: { line: Record<string, unknown> }) => {
    if (state.upsertError) return { error: state.upsertError };
    state.line = payload.line;
    return { error: null };
  });

  const sessionSupabase = {
    from: vi.fn((table: string) => {
      if (table !== 'tenant_settings') throw new Error(`unexpected table: ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { line: state.line }, error: null })),
          })),
        })),
        upsert,
      };
    }),
  };

  const rpc = vi.fn(async (..._args: unknown[]) => ({
    data: true as boolean | null,
    error: null as { message: string } | null,
  }));
  const remove = vi.fn(async () => ({ error: null as { message: string } | null }));
  const storageFrom = vi.fn(() => ({ remove }));
  const admin = { rpc, storage: { from: storageFrom } };

  return { state, upsert, sessionSupabase, rpc, remove, storageFrom, admin };
});

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => mocks.admin,
}));

vi.mock('@/server/tenant', () => ({
  requireTenant: async () => ({
    supabase: mocks.sessionSupabase,
    tenantId: 'tenant-a',
    user: { id: 'user-a' },
  }),
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

import { PUT } from '@/app/api/settings/line/route';
import { POST } from '@/app/api/settings/line/flex-menu/route';

const ORIGIN = 'https://storage.example';
const BUCKET = 'richmenu-assets';
const tenantUrl = (name: string) =>
  `${ORIGIN}/storage/v1/object/public/${BUCKET}/tenant-a/${name}`;
const tenantAliasUrl = (name: string) => `${tenantUrl(name)}?cache=2#editor`;
const otherBucketUrl = (name: string) =>
  `${ORIGIN}/storage/v1/object/public/product-images/tenant-a/${name}`;
const otherTenantUrl = (name: string) => tenantUrl(name).replace('/tenant-a/', '/tenant-b/');
const card = (imageUrl: string, title = '卡片') => ({
  title,
  subtitle: '',
  imageUrl,
  ad: false,
  linkUrl: '',
});

function jsonRequest(url: string, method: string, body: Record<string, unknown>) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putLine(body: Record<string, unknown>) {
  return PUT(jsonRequest('http://localhost/api/settings/line', 'PUT', body), {});
}

function postFlex(body: Record<string, unknown>) {
  return POST(jsonRequest('http://localhost/api/settings/line/flex-menu', 'POST', body), {});
}

describe('richmenu-assets runtime retirement (#589 Phase B)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
    mocks.state.line = {};
    mocks.state.upsertError = null;
    mocks.upsert.mockClear();
    mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null });
    mocks.remove.mockReset().mockResolvedValue({ error: null });
    mocks.storageFrom.mockClear();
  });

  it('background replace retires and removes only the old object', async () => {
    const oldUrl = tenantUrl('old.png');
    mocks.state.line = { richMenuBgImageUrl: oldUrl };

    const response = await putLine({ richMenuBgImageUrl: tenantUrl('new.png') });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('retire_richmenu_asset', {
      p_tenant_id: 'tenant-a',
      p_image_url: oldUrl,
    });
    expect(mocks.storageFrom).toHaveBeenCalledWith(BUCKET);
    expect(mocks.remove).toHaveBeenCalledWith(['tenant-a/old.png']);
  });

  it('background removal retires and removes the old object', async () => {
    const oldUrl = tenantUrl('old.png');
    mocks.state.line = { richMenuBgImageUrl: oldUrl };

    const response = await putLine({ richMenuBgImageUrl: '' });

    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(['tenant-a/old.png']);
  });

  it('keeps a URL shared by background and Flex when only background changes', async () => {
    const shared = tenantUrl('shared.png');
    mocks.state.line = { richMenuBgImageUrl: shared, flexCards: [card(shared)] };

    const response = await putLine({ richMenuBgImageUrl: tenantUrl('new.png') });

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('keeps a URL shared by two Flex cards when one card is removed', async () => {
    const shared = tenantUrl('shared.png');
    mocks.state.line = { flexCards: [card(shared, '一'), card(shared, '二')] };

    const response = await postFlex({ flexCards: [card(shared, '二')] });

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('removing the last Flex reference retires and removes the object', async () => {
    const oldUrl = tenantUrl('old.png');
    mocks.state.line = { flexCards: [card(oldUrl)] };

    const response = await postFlex({ flexCards: [] });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('retire_richmenu_asset', {
      p_tenant_id: 'tenant-a',
      p_image_url: oldUrl,
    });
    expect(mocks.remove).toHaveBeenCalledWith(['tenant-a/old.png']);
  });

  it('clearing Flex cards retires each unique canonical URL once', async () => {
    const first = tenantUrl('first.png');
    const second = tenantUrl('second.png');
    mocks.state.line = { flexCards: [card(first), card(tenantAliasUrl('first.png')), card(second)] };

    const response = await postFlex({ flexCards: [] });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls.map((call) => {
      const [name, args] = call as [string, { p_image_url: string }];
      return [name, args.p_image_url];
    })).toEqual([
      ['retire_richmenu_asset', first],
      ['retire_richmenu_asset', second],
    ]);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it('does not clean up on an unrelated line settings save', async () => {
    mocks.state.line = { richMenuBgImageUrl: tenantUrl('existing.png') };

    const response = await putLine({ channelId: '1234567890' });

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('treats external, other-bucket, and cross-tenant URLs as no-op cleanup candidates', async () => {
    mocks.state.line = {
      richMenuBgImageUrl: tenantUrl('owned.png'),
      flexCards: [card(otherBucketUrl('bucket.png')), card(otherTenantUrl('tenant.png'))],
    };

    const response = await putLine({
      richMenuBgImageUrl: 'https://cdn.example.com/external.png',
      flexCards: [card(otherBucketUrl('bucket-2.png')), card(otherTenantUrl('tenant-2.png'))],
    });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('retire_richmenu_asset', {
      p_tenant_id: 'tenant-a',
      p_image_url: tenantUrl('owned.png'),
    });
    expect(mocks.remove).toHaveBeenCalledWith(['tenant-a/owned.png']);
  });

  it('canonicalizes a tenant-owned alias before writing and does not treat it as a replacement', async () => {
    const canonical = tenantUrl('same.png');
    mocks.state.line = { richMenuBgImageUrl: canonical };

    const response = await putLine({ richMenuBgImageUrl: tenantAliasUrl('same.png') });

    expect(response.status).toBe(200);
    expect(mocks.state.line.richMenuBgImageUrl).toBe(canonical);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not remove when the retirement RPC returns false or an error', async () => {
    const oldUrl = tenantUrl('old.png');
    mocks.state.line = { richMenuBgImageUrl: oldUrl };
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });

    const falseResponse = await putLine({ richMenuBgImageUrl: tenantUrl('new.png') });
    expect(falseResponse.status).toBe(200);
    expect(mocks.remove).not.toHaveBeenCalled();

    mocks.state.line = { richMenuBgImageUrl: oldUrl };
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc unavailable' } });
    const errorResponse = await putLine({ richMenuBgImageUrl: tenantUrl('newer.png') });
    expect(errorResponse.status).toBe(200);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('keeps the settings success response when Storage remove fails or throws', async () => {
    const oldUrl = tenantUrl('old.png');
    mocks.state.line = { richMenuBgImageUrl: oldUrl };
    mocks.remove.mockResolvedValueOnce({ error: { message: 'Storage unavailable' } });
    expect((await putLine({ richMenuBgImageUrl: tenantUrl('new.png') })).status).toBe(200);

    mocks.state.line = { richMenuBgImageUrl: oldUrl };
    mocks.remove.mockRejectedValueOnce(new Error('network down'));
    expect((await putLine({ richMenuBgImageUrl: tenantUrl('newer.png') })).status).toBe(200);
  });

  it('maps stale background restore to a truthful 409', async () => {
    mocks.state.upsertError = {
      code: '23514',
      constraint: 'richmenu_asset_not_retired',
      message: 'richmenu asset has been retired',
    };

    const response = await putLine({ richMenuBgImageUrl: tenantUrl('retired.png') });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ success: false, code: 'REQ_003' });
  });

  it('maps stale Flex publish to the same truthful 409', async () => {
    mocks.state.upsertError = {
      code: '23514',
      constraint: 'richmenu_asset_not_retired',
      message: 'richmenu asset has been retired',
    };

    const response = await postFlex({ flexCards: [card(tenantUrl('retired.png'))] });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ success: false, code: 'REQ_003' });
  });
});
