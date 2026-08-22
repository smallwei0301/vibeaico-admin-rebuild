import { describe, it, expect, vi, beforeEach } from 'vitest';

const createServerClientMock = vi.fn();
const createClientMock = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: any[]) => createServerClientMock(...args),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: any[]) => createClientMock(...args),
}));

const cookieStore = {
  getAll: vi.fn(),
  set: vi.fn(),
};

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(cookieStore),
}));

import { createServerSupabase, createAdminSupabase } from '@/server/supabase';

describe('supabase — createServerSupabase (01 §5.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-anon.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-123';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-456';
    createServerClientMock.mockReturnValue({ kind: 'server-client' });
    createClientMock.mockReturnValue({ kind: 'admin-client' });
  });

  it('用 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_ANON_KEY 呼叫 createServerClient', async () => {
    const client = await createServerSupabase();
    expect(createServerClientMock).toHaveBeenCalledTimes(1);
    const [url, key] = createServerClientMock.mock.calls[0];
    expect(url).toBe('https://project-anon.supabase.co');
    expect(key).toBe('anon-key-123');
    expect(client).toEqual({ kind: 'server-client' });
  });

  it('cookie adapter：getAll() 轉呼叫 cookie store 的 getAll()', async () => {
    cookieStore.getAll.mockReturnValue([{ name: 'a', value: '1' }]);
    await createServerSupabase();
    const [, , options] = createServerClientMock.mock.calls[0];
    const result = options.cookies.getAll();
    expect(cookieStore.getAll).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ name: 'a', value: '1' }]);
  });

  it('cookie adapter：setAll([...]) 對每個項目呼叫 store.set(name, value, options)', async () => {
    await createServerSupabase();
    const [, , options] = createServerClientMock.mock.calls[0];
    const opts1 = { path: '/', httpOnly: true };
    const opts2 = { path: '/', maxAge: 3600 };
    options.cookies.setAll([
      { name: 'x', value: '111', options: opts1 },
      { name: 'y', value: '222', options: opts2 },
    ]);
    expect(cookieStore.set).toHaveBeenCalledTimes(2);
    expect(cookieStore.set).toHaveBeenNthCalledWith(1, 'x', '111', opts1);
    expect(cookieStore.set).toHaveBeenNthCalledWith(2, 'y', '222', opts2);
  });
});

describe('supabase — createAdminSupabase (01 §5.2, 鐵則 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-anon.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key-123';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-456';
    createServerClientMock.mockReturnValue({ kind: 'server-client' });
    createClientMock.mockReturnValue({ kind: 'admin-client' });
  });

  it('用 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY（不是 anon key）呼叫 createClient', () => {
    const client = createAdminSupabase();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [url, key] = createClientMock.mock.calls[0];
    expect(url).toBe('https://project-anon.supabase.co');
    expect(key).toBe('service-role-key-456');
    expect(key).not.toBe('anon-key-123');
    expect(client).toEqual({ kind: 'admin-client' });
  });

  it('options 含 auth: { persistSession: false, autoRefreshToken: false }', () => {
    createAdminSupabase();
    const [, , options] = createClientMock.mock.calls[0];
    expect(options).toEqual({ auth: { persistSession: false, autoRefreshToken: false } });
  });
});
