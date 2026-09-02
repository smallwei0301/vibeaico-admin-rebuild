import { describe, expect, it } from 'vitest';
import { applyBookingAddonAttribution } from '@/server/booking-addon-performance';

describe('Issue #17 booking add-on C+ attribution', () => {
  it('attributes base once and PRIMARY/SPECIFIC_STAFF snapshots without crediting NONE', () => {
    const byStaff = new Map([
      ['primary', { revenue: 0 }],
      ['specific', { revenue: 0 }],
    ]);

    applyBookingAddonAttribution(byStaff, [{
      id: 'booking', staff_id: 'primary', status: 'COMPLETED', final_price: 180,
    }], [
      { booking_id: 'booking', applied_amount: 20, performance_mode: 'PRIMARY', performance_staff_id: 'primary' },
      { booking_id: 'booking', applied_amount: 30, performance_mode: 'SPECIFIC_STAFF', performance_staff_id: 'specific' },
      { booking_id: 'booking', applied_amount: 10, performance_mode: 'NONE', performance_staff_id: null },
    ]);

    // 180 total = 120 base + 20 primary add-on + 30 specific add-on + 10 NONE.
    // NONE is intentionally uncredited, so individual totals are 140 and 30.
    expect(byStaff.get('primary')?.revenue).toBe(140);
    expect(byStaff.get('specific')?.revenue).toBe(30);
  });

  it('does not attribute non-completed bookings or add-ons assigned to inactive staff', () => {
    const byStaff = new Map([['active', { revenue: 0 }]]);
    applyBookingAddonAttribution(byStaff, [
      { id: 'pending', staff_id: 'active', status: 'PENDING', final_price: 100 },
      { id: 'complete', staff_id: null, status: 'COMPLETED', final_price: 50 },
    ], [
      { booking_id: 'pending', applied_amount: 20, performance_mode: 'PRIMARY', performance_staff_id: 'active' },
      { booking_id: 'complete', applied_amount: 20, performance_mode: 'SPECIFIC_STAFF', performance_staff_id: 'inactive' },
    ]);
    expect(byStaff.get('active')?.revenue).toBe(0);
  });
});
