import type { Customer, TourOrder } from '@/lib/types';

export type GuideTravelerFilter = 'ALL' | 'TODAY' | 'REPLY' | 'RETURNING';

export type GuideTravelerOrder = Pick<
  TourOrder,
  'id' | 'orderNo' | 'tripTitle' | 'planName' | 'departsOn' | 'startTime'
  | 'partySize' | 'status' | 'paymentStatus'
>;

export type GuideTravelerConversation = {
  id: string;
  customerId: string | null;
  customerName: string;
  unread: number;
};

export type GuideTraveler = {
  customer: Customer;
  /** Existing TourOrder facts joined by the service-owned customer identity fields. */
  orders: GuideTravelerOrder[];
  /** Next non-cancelled order, or the latest non-cancelled order when there is no future one. */
  primaryOrder: GuideTravelerOrder | null;
  unreadCount: number;
  todayDeparture: boolean;
  waitingReply: boolean;
  /** Existing bookingCount is the only repeat-visit signal used by this surface. */
  returning: boolean;
};

export type GuideTravelerMetrics = {
  total: number;
  todayDeparture: number;
  waitingReply: number;
  returning: number;
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizedPhone(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function matchesCustomer(customer: Customer, order: TourOrder): boolean {
  const customerPhone = normalizedPhone(customer.phone);
  const orderPhone = normalizedPhone(order.customerPhone);
  if (customerPhone && orderPhone) return customerPhone === orderPhone;
  return normalized(customer.name) !== '' && normalized(customer.name) === normalized(order.customerName);
}

function orderForDisplay(order: TourOrder): GuideTravelerOrder {
  return {
    id: order.id,
    orderNo: order.orderNo,
    tripTitle: order.tripTitle,
    planName: order.planName,
    departsOn: order.departsOn,
    startTime: order.startTime,
    partySize: order.partySize,
    status: order.status,
    paymentStatus: order.paymentStatus,
  };
}

function compareOrders(a: GuideTravelerOrder, b: GuideTravelerOrder): number {
  return a.departsOn.localeCompare(b.departsOn)
    || a.startTime.localeCompare(b.startTime)
    || a.tripTitle.localeCompare(b.tripTitle)
    || a.id.localeCompare(b.id);
}

function unreadForCustomer(
  customer: Customer,
  conversations: readonly GuideTravelerConversation[],
): number {
  return conversations
    .filter((conversation) => (
      conversation.customerId === customer.id
      || (customer.lineUserId !== null && conversation.id === customer.lineUserId)
    ))
    .reduce((sum, conversation) => sum + Math.max(conversation.unread, 0), 0);
}

/**
 * Join existing customer, tour-order and chat service facts for the GUIDE list.
 * No new persistence or cross-tenant identity is introduced here.
 */
export function buildGuideTravelers(
  customers: readonly Customer[],
  orders: readonly TourOrder[],
  conversations: readonly GuideTravelerConversation[],
  todayIso: string,
): GuideTraveler[] {
  const hasToday = isDateKey(todayIso);

  return customers.map((customer) => {
    const customerOrders = orders
      .filter((order) => matchesCustomer(customer, order))
      .map(orderForDisplay)
      .sort(compareOrders);
    const nonCancelled = customerOrders.filter((order) => order.status !== 'CANCELLED');
    const future = hasToday
      ? nonCancelled.filter((order) => order.departsOn >= todayIso)
      : [];
    const primaryOrder = future[0] ?? nonCancelled.at(-1) ?? null;
    const unreadCount = unreadForCustomer(customer, conversations);

    return {
      customer,
      orders: customerOrders,
      primaryOrder,
      unreadCount,
      todayDeparture: hasToday && nonCancelled.some((order) => order.departsOn === todayIso),
      waitingReply: unreadCount > 0,
      returning: customer.bookingCount >= 2,
    };
  });
}

function compareTravelers(a: GuideTraveler, b: GuideTraveler): number {
  return Number(b.waitingReply) - Number(a.waitingReply)
    || Number(b.todayDeparture) - Number(a.todayDeparture)
    || Number(b.customer.atRisk) - Number(a.customer.atRisk)
    || (a.primaryOrder?.departsOn ?? '9999-12-31').localeCompare(b.primaryOrder?.departsOn ?? '9999-12-31')
    || Number(b.returning) - Number(a.returning)
    || a.customer.name.localeCompare(b.customer.name)
    || a.customer.id.localeCompare(b.customer.id);
}

function matchesQuery(row: GuideTraveler, query: string): boolean {
  const q = normalized(query);
  if (!q) return true;
  const searchable = [
    row.customer.name,
    row.customer.phone,
    row.customer.email,
    ...row.customer.tags,
    ...row.orders.flatMap((order) => [order.tripTitle, order.planName, order.orderNo]),
  ];
  return searchable.some((value) => normalized(value).includes(q));
}

export function filterGuideTravelers(
  travelers: readonly GuideTraveler[],
  filter: GuideTravelerFilter = 'ALL',
  query = '',
): GuideTraveler[] {
  return [...travelers]
    .filter((row) => {
      if (filter === 'TODAY') return row.todayDeparture;
      if (filter === 'REPLY') return row.waitingReply;
      if (filter === 'RETURNING') return row.returning;
      return true;
    })
    .filter((row) => matchesQuery(row, query))
    .sort(compareTravelers);
}

export function summarizeGuideTravelers(
  travelers: readonly GuideTraveler[],
): GuideTravelerMetrics {
  return {
    total: travelers.length,
    todayDeparture: travelers.filter((row) => row.todayDeparture).length,
    waitingReply: travelers.filter((row) => row.waitingReply).length,
    returning: travelers.filter((row) => row.returning).length,
  };
}
