import { describe, expect, it } from 'vitest';

import {
  assertLocalSupabaseUrl,
  calculateBarrierWaitMs,
} from '../../scripts/test/local-isolation-canary.mjs';

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

  it('makes both matrix jobs wait for the same future barrier', () => {
    expect(calculateBarrierWaitMs(1_100, 1_000_000)).toBe(100_000);
    expect(calculateBarrierWaitMs(1_000, 1_002_000)).toBe(0);
  });

  it('fails instead of pretending overlap when a slot misses the barrier', () => {
    expect(() => calculateBarrierWaitMs(1_000, 1_006_000)).toThrow(
      'Local isolation slot missed the shared barrier',
    );
  });
});
