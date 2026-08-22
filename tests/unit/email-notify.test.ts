import { describe, it, expect } from 'vitest';
import { resolveBookingNotifications } from '@/server/email/notify';
import { notifySettingsSchema } from '@/config/tenant-settings';

/**
 * resolveBookingNotifications — 05-EMAIL-RESEND.md §3 開關對應表的純函式版本。
 * 純邏輯判斷，不碰網路/DB（12 分冊 §3）。
 */
describe('resolveBookingNotifications (05 §3)', () => {
  const notifyDefaults = notifySettingsSchema.parse({});

  function notify(overrides: Partial<typeof notifyDefaults> = {}) {
    return notifySettingsSchema.parse({ ...notifyDefaults, ...overrides });
  }

  describe('kind = NEW', () => {
    it('notifyNewBooking 開 + tenantEmail 有值 → 寄店家', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: true }),
        tenantEmail: 'shop@example.com',
        kind: 'NEW',
        staffEmail: null,
      });
      expect(targets).toEqual([{ to: 'shop@example.com', kind: 'NEW' }]);
    });

    it('notifyNewBooking 關 → 不寄店家', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: false }),
        tenantEmail: 'shop@example.com',
        kind: 'NEW',
        staffEmail: null,
      });
      expect(targets).toEqual([]);
    });

    it('notifyNewBooking 開但 tenantEmail 空字串 → 不寄店家（未填 email）', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: true }),
        tenantEmail: '',
        kind: 'NEW',
        staffEmail: null,
      });
      expect(targets).toEqual([]);
    });

    it('notifyStaffBooking 開 + 有指定員工 email → 除了店家外，額外寄該員工', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: true, notifyStaffBooking: true }),
        tenantEmail: 'shop@example.com',
        kind: 'NEW',
        staffEmail: 'staff@example.com',
      });
      expect(targets).toEqual([
        { to: 'shop@example.com', kind: 'NEW' },
        { to: 'staff@example.com', kind: 'NEW' },
      ]);
    });

    it('notifyStaffBooking 開但 staffEmail 為 null（未指定員工 / 員工未填 email）→ 不寄員工', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: true, notifyStaffBooking: true }),
        tenantEmail: 'shop@example.com',
        kind: 'NEW',
        staffEmail: null,
      });
      expect(targets).toEqual([{ to: 'shop@example.com', kind: 'NEW' }]);
    });

    it('notifyStaffBooking 關 + 有 staffEmail → 仍不寄員工', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: true, notifyStaffBooking: false }),
        tenantEmail: 'shop@example.com',
        kind: 'NEW',
        staffEmail: 'staff@example.com',
      });
      expect(targets).toEqual([{ to: 'shop@example.com', kind: 'NEW' }]);
    });

    it('notifyNewBooking 關但 notifyStaffBooking 開 + 有 staffEmail → 只寄員工，不寄店家', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: false, notifyStaffBooking: true }),
        tenantEmail: 'shop@example.com',
        kind: 'NEW',
        staffEmail: 'staff@example.com',
      });
      expect(targets).toEqual([{ to: 'staff@example.com', kind: 'NEW' }]);
    });

    it('全部關 + tenantEmail/staffEmail 皆有值 → 完全不寄', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: false, notifyStaffBooking: false }),
        tenantEmail: 'shop@example.com',
        kind: 'NEW',
        staffEmail: 'staff@example.com',
      });
      expect(targets).toEqual([]);
    });
  });

  describe('kind = CANCELLED', () => {
    it('notifyBookingCancel 開 + tenantEmail 有值 → 寄店家', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyBookingCancel: true }),
        tenantEmail: 'shop@example.com',
        kind: 'CANCELLED',
        staffEmail: null,
      });
      expect(targets).toEqual([{ to: 'shop@example.com', kind: 'CANCELLED' }]);
    });

    it('notifyBookingCancel 關 → 不寄店家', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyBookingCancel: false }),
        tenantEmail: 'shop@example.com',
        kind: 'CANCELLED',
        staffEmail: null,
      });
      expect(targets).toEqual([]);
    });

    it('notifyBookingCancel 開但 tenantEmail 空字串 → 不寄', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyBookingCancel: true }),
        tenantEmail: '',
        kind: 'CANCELLED',
        staffEmail: null,
      });
      expect(targets).toEqual([]);
    });

    it('CANCELLED 不看 notifyStaffBooking，即使開著且有 staffEmail 也不寄員工', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyBookingCancel: true, notifyStaffBooking: true }),
        tenantEmail: 'shop@example.com',
        kind: 'CANCELLED',
        staffEmail: 'staff@example.com',
      });
      expect(targets).toEqual([{ to: 'shop@example.com', kind: 'CANCELLED' }]);
    });

    it('CANCELLED 不受 notifyNewBooking 開關影響（各自獨立）', () => {
      const targets = resolveBookingNotifications({
        notify: notify({ notifyNewBooking: false, notifyBookingCancel: true }),
        tenantEmail: 'shop@example.com',
        kind: 'CANCELLED',
        staffEmail: null,
      });
      expect(targets).toEqual([{ to: 'shop@example.com', kind: 'CANCELLED' }]);
    });
  });
});
