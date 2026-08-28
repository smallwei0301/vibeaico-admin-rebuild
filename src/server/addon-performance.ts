/** C+ revenue allocation for completed bookings and frozen tour-addon snapshots. */
export type PerformanceBucket = { bookingCount: number; completed: number; revenue: number };
export type PerformanceBooking = { id: string; staffId: string | null; status: string; finalPrice: number };
export type BookingAddonPerformance = {
  bookingId: string; appliedAmount: number; performanceMode: 'PRIMARY' | 'SPECIFIC_STAFF' | 'NONE';
  performanceStaffId: string | null;
};
export type TourAddonPerformance = { performanceStaffId: string | null; performanceAmount: number | null };

export function aggregatePerformance(
  staffIds: string[], bookings: PerformanceBooking[], bookingAddons: BookingAddonPerformance[], tourAddons: TourAddonPerformance[],
): Map<string, PerformanceBucket> {
  const byStaff = new Map(staffIds.map((id) => [id, { bookingCount: 0, completed: 0, revenue: 0 }]));
  const addonsByBooking = new Map<string, BookingAddonPerformance[]>();
  for (const addon of bookingAddons) {
    const items = addonsByBooking.get(addon.bookingId) ?? [];
    items.push(addon); addonsByBooking.set(addon.bookingId, items);
  }
  const addRevenue = (staffId: string | null, amount: number) => {
    const bucket = staffId ? byStaff.get(staffId) : undefined;
    if (bucket) bucket.revenue += amount;
  };
  for (const booking of bookings) {
    const bucket = booking.staffId ? byStaff.get(booking.staffId) : undefined;
    if (bucket) bucket.bookingCount += 1;
    if (booking.status !== 'COMPLETED') continue;
    if (bucket) bucket.completed += 1;
    const addons = addonsByBooking.get(booking.id) ?? [];
    // The service share remains with the booking staff. Addons can override it,
    // or be excluded; never use null to infer NONE.
    addRevenue(booking.staffId, Math.max(0, booking.finalPrice - addons.reduce((sum, addon) => sum + addon.appliedAmount, 0)));
    for (const addon of addons) {
      addRevenue(
        addon.performanceMode === 'PRIMARY' ? booking.staffId
          : addon.performanceMode === 'SPECIFIC_STAFF' ? addon.performanceStaffId : null,
        addon.appliedAmount,
      );
    }
  }
  for (const addon of tourAddons) addRevenue(addon.performanceStaffId, addon.performanceAmount ?? 0);
  return byStaff;
}
