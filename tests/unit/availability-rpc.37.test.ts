import { describe, expect, it } from 'vitest';
import { ApiHttpError } from '@/server/http';
import { throwAvailabilityRpcError } from '@/server/availability-rpc';

describe('availability RPC error contract (#37)', () => {
  it('preserves the established booking-overlap message while keeping other availability conflicts explicit', () => {
    const capture = (message: string): ApiHttpError => {
      try {
        throwAvailabilityRpcError({ message });
      } catch (error) {
        expect(error).toBeInstanceOf(ApiHttpError);
        return error as ApiHttpError;
      }
      throw new Error('Expected availability RPC error');
    };

    const bookingConflict = capture('AVAILABILITY_BOOKING:staff-a');
    expect(bookingConflict.status).toBe(409);
    expect(bookingConflict.message).toBe('該時段已有預約');

    const departureConflict = capture('AVAILABILITY_DEPARTURE:guide-a');
    expect(departureConflict.message).toContain('人員在該時段不可用');
  });
});
