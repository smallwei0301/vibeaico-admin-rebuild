'use client';

import * as React from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { ApiError, request } from '@/lib/api';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import type { TourOrder, TourOrderStatus } from '@/lib/types';

const STATUS_TONE: Record<TourOrderStatus, 'warning' | 'success' | 'primary' | 'neutral'> = {
  PENDING: 'warning', CONFIRMED: 'success', COMPLETED: 'primary', CANCELLED: 'neutral',
};

function messageForError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'REQ_004') return t.myOrders.errors.rateLimited;
    if (e.code === 'REQ_001') return t.myOrders.errors.validation;
    return e.message || t.myOrders.errors.generic;
  }
  return t.myOrders.errors.generic;
}

export function MyOrdersSearch({
  shopCode, initialContact = '',
}: { shopCode: string; initialContact?: string }) {
  const [contact, setContact] = React.useState(initialContact);
  const [searching, setSearching] = React.useState(false);
  const [error, setError] = React.useState('');
  // undefined＝尚未查詢過；[]＝查過但沒有結果；長度 > 0＝有結果。
  const [orders, setOrders] = React.useState<TourOrder[] | undefined>(undefined);

  const search = React.useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSearching(true);
    setError('');
    try {
      const res = await request<{ orders: TourOrder[] }>('/api/public/tour-requests/mine', {
        method: 'POST',
        body: JSON.stringify({ shopCode, contact: trimmed }),
      });
      setOrders(res.orders);
    } catch (err) {
      setError(messageForError(err));
      setOrders(undefined);
    } finally {
      setSearching(false);
    }
  }, [shopCode]);

  // 從申請狀態頁帶著已知聯絡方式過來時，直接自動查一次，不用旅客再打一次字。
  React.useEffect(() => {
    if (initialContact.trim()) void search(initialContact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searching) return;
    void search(contact);
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t.myOrders.title}</h1>
        <p className="text-sm text-secondary">{t.myOrders.description}</p>
      </header>

      <form className="card" onSubmit={submit}>
        <div className="card-body flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="contact">
              {t.myOrders.contactLabel}
            </label>
            <input
              id="contact"
              className="form-control"
              placeholder={t.myOrders.contactPlaceholder}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              required
            />
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={!contact.trim() || searching}>
            {searching ? t.myOrders.searching : t.myOrders.submit}
          </button>
        </div>
      </form>

      {orders === undefined ? (
        <EmptyState icon={Search} title={t.myOrders.initialTitle} description={t.myOrders.initialDescription} />
      ) : orders.length === 0 ? (
        <EmptyState title={t.myOrders.emptyTitle} description={t.myOrders.emptyDescription} />
      ) : (
        <section className="flex flex-col gap-3">
          <p className="text-2xs text-secondary">{t.myOrders.resultCount(orders.length)}</p>
          <ul className="flex flex-col gap-2">
            {orders.map((order) => (
              <li key={order.id} className="card">
                <div className="card-body flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{order.tripTitle}</span>
                    <Badge tone={STATUS_TONE[order.status]}>{t.myOrders.status[order.status]}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 text-2xs text-secondary">
                    <span>{order.planName}</span>
                    <span>{order.departsOn}{order.startTime ? ` ${order.startTime}` : ''}</span>
                    <span>{t.status.partyUnit(order.partySize)}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-dark">{formatCurrency(order.totalAmount)}</span>
                    <span className="text-2xs text-secondary">{formatDateTime(order.createdAt)}</span>
                  </div>
                  <Link
                    href={`/s/${shopCode}/requests/${order.id}?contact=${encodeURIComponent(contact.trim())}`}
                    className="text-sm text-primary underline"
                  >
                    {t.myOrders.viewDetail}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href={`/s/${shopCode}`} className="text-sm text-secondary underline">
        {t.myOrders.backToShop}
      </Link>
    </>
  );
}
