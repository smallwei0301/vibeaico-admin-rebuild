import { describe, expect, it } from 'vitest';
import { ApiHttpError, ERR } from '@/server/http';
import {
  raiseMembershipLevelWriteError,
  resolveMembershipLevelId,
} from '@/server/membership-levels';

describe('Issue #35：membership default assignment contract (Y.5)', () => {
  it('active highest reached threshold wins', () => {
    expect(resolveMembershipLevelId([
      { id: 'default', threshold: 0, active: true, isDefault: true },
      { id: 'silver', threshold: 1000, active: true },
      { id: 'gold', threshold: 5000, active: true },
    ], 5200)).toBe('gold');
  });

  it('when no threshold is reached, falls back to active default and ignores inactive levels', () => {
    expect(resolveMembershipLevelId([
      { id: 'inactive-default', threshold: 0, active: false, isDefault: true },
      { id: 'default', threshold: 1000, active: true, isDefault: true },
      { id: 'unreached', threshold: 5000, active: true },
    ], 100)).toBe('default');
  });

  it('with no active default and no reached threshold, remains null', () => {
    expect(resolveMembershipLevelId([
      { id: 'inactive', threshold: 1000, active: false, isDefault: true },
    ], 100)).toBeNull();
  });
});

describe('Issue #35：membership default unique conflict mapping', () => {
  it('maps PostgreSQL 23505 to 409 REQ_003 without weakening the invariant', () => {
    expect(() => raiseMembershipLevelWriteError({ code: '23505' })).toThrow(ApiHttpError);
    try {
      raiseMembershipLevelWriteError({ code: '23505' });
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: ERR.CONFLICT });
    }
  });

  it('does not rewrite unrelated database errors', () => {
    const error = { code: '42P01', message: 'missing relation' };
    expect(() => raiseMembershipLevelWriteError(error)).toThrow(error);
  });
});
