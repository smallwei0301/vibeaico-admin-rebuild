/**
 * Issue #17 C+ attribution for existing staff reports.
 *
 * `bookings.final_price` already includes every applied add-on.  Attribute the
 * base exactly once to the booking staff, then attribute each snapshot only to
 * its explicit performance staff.  NONE deliberately receives no individual
 * credit; inactive/deleted staff remain excluded by the caller's active map.
 */
export type StaffRevenueAggregate = { revenue: number };
export type PerformanceBooking = {
  id: string; staff_id: string | null; status: string; final_price: number | string;
};
export type PerformanceAddon = {
  booking_id: string; applied_amount: number | string;
  performance_mode: 'PRIMARY' | 'SPECIFIC_STAFF' | 'NONE';
  performance_staff_id: string | null;
};

export function applyBookingAddonAttribution(
  byStaff: Map<string, StaffRevenueAggregate>,
  bookings: PerformanceBooking[],
  addons: PerformanceAddon[],
) {
  const byBooking = new Map<string, PerformanceAddon[]>();
  for (const addon of addons) {
    const list = byBooking.get(addon.booking_id) ?? [];
    list.push(addon);
    byBooking.set(addon.booking_id, list);
  }

  for (const booking of bookings) {
    if (booking.status !== 'COMPLETED') continue;
    const applied = byBooking.get(booking.id) ?? [];
    const addonTotal = applied.reduce((sum, addon) => sum + Number(addon.applied_amount), 0);
    const base = byStaff.get(booking.staff_id ?? '');
    if (base) base.revenue += Number(booking.final_price) - addonTotal;
    for (const addon of applied) {
      if (addon.performance_mode === 'NONE' || !addon.performance_staff_id) continue;
      const staff = byStaff.get(addon.performance_staff_id);
      if (staff) staff.revenue += Number(addon.applied_amount);
    }
  }
}
