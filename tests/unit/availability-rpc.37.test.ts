import { describe, expect, it } from 'vitest';
import { ApiHttpError } from '@/server/http';
import { throwAvailabilityRpcError } from '@/server/availability-rpc';

function capture(message: string): ApiHttpError {
  try {
    throwAvailabilityRpcError({ message });
  } catch (error) {
    expect(error).toBeInstanceOf(ApiHttpError);
    return error as ApiHttpError;
  }
  throw new Error('Expected availability RPC error');
}

describe('availability RPC error contract (#37)', () => {
  it('preserves booking and departure conflict messages', () => {
    const bookingConflict = capture('AVAILABILITY_BOOKING:staff-a');
    expect(bookingConflict.status).toBe(409);
    expect(bookingConflict.message).toBe('該時段已有預約');

    const departureConflict = capture('AVAILABILITY_DEPARTURE:guide-a');
    expect(departureConflict.status).toBe(409);
    expect(departureConflict.message).toContain('人員在該時段不可用');
  });

  it('rejects a cross-tenant or inactive staff id without turning it into a 500', () => {
    const error = capture('STAFF_NOT_ASSIGNABLE:foreign-staff');
    expect(error.status).toBe(404);
    expect(error.message).toBe('找不到可指派導遊');
  });
});
