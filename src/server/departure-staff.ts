import { ApiHttpError, ERR } from '@/server/http';
import {
  departureInterval, loadStaffAvailability, type AvailabilityStaff, type StaffAvailability,
} from '@/server/staff-availability';

export type DepartureAssignment = { staffId: string; role: 'PRIMARY' | 'ASSISTANT' };

export async function listAssignableStaff(supabase: any, tenantId: string): Promise<AvailabilityStaff[]> {
  const { data, error } = await supabase.from('staff').select('id, name, availability_policy')
    .eq('tenant_id', tenantId).eq('active', true).eq('bookable', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((staff: any) => ({
    id: staff.id, name: staff.name,
    availabilityPolicy: staff.availability_policy ?? 'DEFAULT_AVAILABLE',
  }));
}

/** 0/1/2+ is an observed staff count, not a persisted product mode. */
export async function departureStaffAvailability(params: {
  supabase: any;
  tenantId: string;
  departsOn: string;
  startTime?: string | null;
  durationMinutes: number;
  excludeDepartureId?: string;
}): Promise<{ staff: AvailabilityStaff[]; availability: StaffAvailability[] }> {
  const staff = await listAssignableStaff(params.supabase, params.tenantId);
  const interval = departureInterval(params.departsOn, params.startTime, params.durationMinutes);
  const availability = await loadStaffAvailability({
    supabase: params.supabase, tenantId: params.tenantId, date: params.departsOn,
    staff, interval, excludeDepartureId: params.excludeDepartureId,
  });
  return { staff, availability };
}

export async function resolveOpenDepartureAssignments(params: {
  supabase: any;
  tenantId: string;
  departsOn: string;
  startTime?: string | null;
  durationMinutes: number;
  primaryStaffId?: string | null;
  assistantStaffIds?: string[];
  excludeDepartureId?: string;
}): Promise<DepartureAssignment[]> {
  const { staff, availability } = await departureStaffAvailability(params);
  if (staff.length === 0)
    throw new ApiHttpError(409, '請先新增至少一位可帶團導遊，再建立銷售中的團次', ERR.CONFLICT);

  const primaryStaffId = staff.length === 1 ? staff[0].id : params.primaryStaffId;
  if (!primaryStaffId)
    throw new ApiHttpError(400, '請選擇主導遊', ERR.VALIDATION);
  const assistants = [...new Set(params.assistantStaffIds ?? [])].filter((id) => id !== primaryStaffId);
  const selected = [primaryStaffId, ...assistants];
  const known = new Set(staff.map((item) => item.id));
  if (selected.some((id) => !known.has(id)))
    throw new ApiHttpError(404, '找不到可指派的導遊', ERR.NOT_FOUND);

  const conflicts = availability.filter((item) => selected.includes(item.staffId) && !item.available);
  if (conflicts.length > 0) {
    const first = conflicts[0];
    const reason = first.conflicts[0];
    const name = staff.find((item) => item.id === first.staffId)?.name ?? '導遊';
    throw new ApiHttpError(409,
      `${name} 無法帶團：${availabilityReasonText(reason?.reason)}${reason?.conflictStart ? `（${reason.conflictStart}）` : ''}`,
      ERR.CONFLICT);
  }
  return [
    { staffId: primaryStaffId, role: 'PRIMARY' },
    ...assistants.map((staffId) => ({ staffId, role: 'ASSISTANT' as const })),
  ];
}

export async function replaceDepartureAssignments(
  supabase: any, tenantId: string, departureId: string, assignments: DepartureAssignment[],
): Promise<void> {
  const { error: removeError } = await supabase.from('trip_departure_staff')
    .delete().eq('tenant_id', tenantId).eq('departure_id', departureId);
  if (removeError) throw removeError;
  if (assignments.length === 0) return;
  const { error: insertError } = await supabase.from('trip_departure_staff').insert(
    assignments.map((assignment) => ({
      tenant_id: tenantId, departure_id: departureId,
      staff_id: assignment.staffId, role: assignment.role,
    })),
  );
  if (insertError) throw insertError;
}

function availabilityReasonText(reason: string | undefined): string {
  return ({ SHIFT: '未落在可接案時間', BOOKING: '與一般預約衝突', BLOCK: '與不可接案時間衝突', DEPARTURE: '與其他團次衝突' } as Record<string, string>)[reason ?? ''] ?? '時段衝突';
}
