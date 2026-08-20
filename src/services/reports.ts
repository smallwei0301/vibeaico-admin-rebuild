import { adapt, request } from '@/lib/api';
import type { DashboardAlerts, DashboardStats, StaffPerformance } from '@/lib/types';
import { MOCK_DASHBOARD_ALERTS, MOCK_DASHBOARD_STATS, MOCK_STAFF_PERFORMANCE } from '@/mock';

export const getDashboardStats = () =>
  adapt<DashboardStats>(() => MOCK_DASHBOARD_STATS, () => request<DashboardStats>('/api/reports/dashboard'));

export const getDashboardAlerts = () =>
  adapt<DashboardAlerts>(() => MOCK_DASHBOARD_ALERTS, () => request<DashboardAlerts>('/api/reports/dashboard-alerts'));

export const getStaffPerformance = () =>
  adapt<StaffPerformance[]>(() => MOCK_STAFF_PERFORMANCE, () => request<StaffPerformance[]>('/api/reports/staff-performance'));
