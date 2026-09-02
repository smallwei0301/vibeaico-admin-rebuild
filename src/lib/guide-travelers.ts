import type { Customer, Paged, TourOrder } from '@/lib/types';

export type GuideTravelerFilter = 'ALL' | 'TODAY' | 'REPLY' | 'RETURNING';

export const GUIDE_AGGREGATION_PAGE_SIZE = 200;

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
  /** Existing TourOrder facts joined by an unambiguous service-owned identity. */
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

/**
 * Read a paged service resource in full. The service/API contract remains
 * paged; the GUIDE aggregation is the caller that owns the need for a
 * complete list.
 */
export async function loadAllGuidePages<T>(
  loadPage: (page: number, size: number) => Promise<Paged<T>>,
  pageSize = GUIDE_AGGREGATION_PAGE_SIZE,
): Promise<T[]> {
  const first = await loadPage(0, pageSize);
  const totalPages = Number.isFinite(first.totalPages)
    ? Math.max(1, Math.floor(first.totalPages))
    : 1;
  const rows = [...first.content];

  for (let page = 1; page < totalPages; page += 1) {
    const next = await loadPage(page, pageSize);
    rows.push(...next.content);
  }

  return rows;
}

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

type CustomerIdentityIndex = {
  byName: Map<string, Customer[]>;
  byPhone: Map<string, Customer[]>;
};

function addIdentity(
  index: Map<string, Customer[]>,
  key: string,
  customer: Customer,
): void {
  if (!key) return;
  const matches = index.get(key);
  if (matches) {
    matches.push(customer);
  } else {
    index.set(key, [customer]);
  }
}

function buildCustomerIdentityIndex(customers: readonly Customer[]): CustomerIdentityIndex {
  const index: CustomerIdentityIndex = { byName: new Map(), byPhone: new Map() };
  for (const customer of customers) {
    addIdentity(index.byName, normalized(customer.name), customer);
    addIdentity(index.byPhone, normalizedPhone(customer.phone), customer);
  }
  return index;
}

/**
 * Resolve each order to at most one customer. Phone is the strongest
 * available identity in the current TourOrder contract. A name-only join is
 * retained for old rows missing phone data, but only when the name is unique
 * and no stored phone contradicts it. Unresolved rows are left unjoined
 * rather than attributed to the wrong tenant-local customer.
 */
function resolveOrderCustomer(
  order: TourOrder,
  index: CustomerIdentityIndex,
): Customer | null {
  const orderPhone = normalizedPhone(order.customerPhone);
  if (orderPhone) {
    const phoneMatches = index.byPhone.get(orderPhone) ?? [];
    if (phoneMatches.length === 1) return phoneMatches[0];
    if (phoneMatches.length > 1) {
      const orderName = normalized(order.customerName);
      const nameMatches = phoneMatches.filter((customer) => (
        orderName !== '' && normalized(customer.name) === orderName
      ));
      return nameMatches.length === 1 ? nameMatches[0] : null;
    }
  }

  const orderName = normalized(order.customerName);
  if (!orderName) return null;
  const nameMatches = index.byName.get(orderName) ?? [];
  if (nameMatches.length !== 1) return null;

  const [customer] = nameMatches;
  // A non-empty customer phone plus a different non-empty order phone is a
  // contradiction, not permission to fall back to the display name.
  if (orderPhone && normalizedPhone(customer.phone)) return null;
  return customer;
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
  const identityIndex = buildCustomerIdentityIndex(customers);
  const ordersByCustomerId = new Map<string, GuideTravelerOrder[]>();

  for (const order of orders) {
    const customer = resolveOrderCustomer(order, identityIndex);
    if (!customer) continue;
    const customerOrders = ordersByCustomerId.get(customer.id);
    const displayOrder = orderForDisplay(order);
    if (customerOrders) {
      customerOrders.push(displayOrder);
    } else {
      ordersByCustomerId.set(customer.id, [displayOrder]);
    }
  }

  return customers.map((customer) => {
    const customerOrders = [...(ordersByCustomerId.get(customer.id) ?? [])].sort(compareOrders);
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
