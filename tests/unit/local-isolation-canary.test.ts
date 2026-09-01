import { describe, expect, it } from 'vitest';

import { assertLocalSupabaseUrl } from '../../scripts/test/local-isolation-canary.mjs';

describe('local Supabase isolation canary', () => {
  it('accepts only loopback Supabase URLs', () => {
    expect(assertLocalSupabaseUrl('http://127.0.0.1:54321').hostname).toBe('127.0.0.1');
    expect(assertLocalSupabaseUrl('http://localhost:54321').hostname).toBe('localhost');
  });

  it('refuses a remote Supabase URL before any write', () => {
    expect(() => assertLocalSupabaseUrl('https://example.supabase.co')).toThrow(
      'Local isolation canary refuses non-local Supabase host',
    );
  });
});
