'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiError, request } from '@/lib/api';
import { publicTourRequestPage as t } from '@/i18n/zh-TW/pages/public-tour-request';
import { formatCurrency } from '@/lib/utils';
import type { PublicRequestPlan } from '@/server/public-tour-request';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatDepartureDate(departsOn: string): string {
  const [y, m, d] = departsOn.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}（${WEEKDAYS[weekday]}）`;
}

/** 後端錯誤碼 → 這一頁的中文訊息。查不到就退回通用訊息，不顯示原始錯誤碼給旅客。 */
function messageForError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'TOUR_001': return t.errors.seatsUnavailable;
      case 'REQ_003': return t.errors.departureUnavailable;
      case 'REQ_001': return e.message || t.errors.validation;
      case 'REQ_002': return t.errors.notFound;
      case 'FEAT_001': return t.errors.featureLocked;
      default: return e.message || t.errors.generic;
    }
  }
  return t.errors.generic;
}

export function RequestForm({
  shopCode, plan,
}: { shopCode: string; plan: PublicRequestPlan }) {
  const router = useRouter();

  const [departureId, setDepartureId] = React.useState('');
  const [partySize, setPartySize] = React.useState(plan.minParty);
  const [contactName, setContactName] = React.useState('');
  const [contactPhone, setContactPhone] = React.useState('');
  const [contactLine, setContactLine] = React.useState('');
  const [contactEmail, setContactEmail] = React.useState('');
  const [preferredNote, setPreferredNote] = React.useState('');
  const [specialRequest, setSpecialRequest] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  const hasContact = !!(contactPhone.trim() || contactLine.trim() || contactEmail.trim());
  const canSubmit = !!departureId && !!contactName.trim() && hasContact
    && partySize >= plan.minParty && partySize <= plan.maxParty && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await request<{ orderId: string; orderNo: string }>('/api/public/tour-requests', {
        method: 'POST',
        body: JSON.stringify({
          shopCode, planId: plan.planId, departureId, partySize,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim() || undefined,
          contactLine: contactLine.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          preferredNote: preferredNote.trim() || undefined,
          specialRequest: specialRequest.trim() || undefined,
        }),
      });
      const contact = (contactPhone || contactLine || contactEmail).trim();
      router.push(
        `/s/${shopCode}/requests/${res.orderId}?contact=${encodeURIComponent(contact)}`,
      );
    } catch (err) {
      setError(messageForError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <header className="flex flex-col gap-1">
        <div className="badge badge-primary w-fit">{t.form.eyebrow}</div>
        <h1 className="text-2xl font-semibold">{plan.planName}</h1>
        <p className="text-sm text-secondary">{plan.tripTitle}</p>
        {plan.planDescription ? (
          <p className="whitespace-pre-line text-sm text-secondary">{plan.planDescription}</p>
        ) : null}
        <div className="text-sm font-medium text-dark">
          {formatCurrency(plan.pricePerPerson)}{t.form.planPriceUnit[plan.priceType]}
          {' · '}
          {t.form.partyRange(plan.minParty, plan.maxParty)}
        </div>
      </header>

      <section className="card">
        <div className="card-body flex flex-col gap-1">
          <h2 className="text-base font-medium">{t.form.cancellationPolicyTitle}</h2>
          <p className="text-sm text-secondary">{t.form.cancellationPolicy[plan.refundPolicyType]}</p>
          <p className="text-2xs text-muted">{t.form.cancellationPolicyNote}</p>
        </div>
      </section>

      <p className="rounded-md border border-warning px-3 py-2 text-sm text-warning">
        {t.form.disclaimer}
      </p>

      <form className="card" onSubmit={submit}>
        <div className="card-body flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="departureId">
              {t.form.departureLabel}
            </label>
            {plan.departures.length === 0 ? (
              <p className="text-sm text-secondary">{t.form.departuresEmpty}</p>
            ) : (
              <select
                id="departureId"
                className="form-select"
                value={departureId}
                onChange={(e) => setDepartureId(e.target.value)}
                required
              >
                <option value="">{t.form.departurePlaceholder}</option>
                {plan.departures.map((d) => (
                  <option key={d.id} value={d.id}>
                    {t.form.departureOption(formatDepartureDate(d.departsOn), d.startTime, d.seatsLeft)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="partySize">{t.form.partyLabel}</label>
            <input
              id="partySize"
              type="number"
              className="form-control"
              min={plan.minParty}
              max={plan.maxParty}
              value={partySize}
              onChange={(e) => setPartySize(Number(e.target.value))}
              required
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="contactName">{t.form.nameLabel}</label>
            <input
              id="contactName"
              className="form-control"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
            <div className="text-sm font-medium">{t.form.contactSectionTitle}</div>
            <p className="text-2xs text-muted">{t.form.contactHint}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <label className="text-2xs text-secondary" htmlFor="contactPhone">{t.form.phoneLabel}</label>
                <input
                  id="contactPhone" className="form-control"
                  value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-2xs text-secondary" htmlFor="contactLine">{t.form.lineLabel}</label>
                <input
                  id="contactLine" className="form-control"
                  value={contactLine} onChange={(e) => setContactLine(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-2xs text-secondary" htmlFor="contactEmail">{t.form.emailLabel}</label>
                <input
                  id="contactEmail" type="email" className="form-control"
                  value={contactEmail} onChange={(e) => setContactEmail(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="preferredNote">{t.form.preferredNoteLabel}</label>
            <textarea
              id="preferredNote" className="form-control" rows={2}
              value={preferredNote} onChange={(e) => setPreferredNote(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="specialRequest">{t.form.specialRequestLabel}</label>
            <textarea
              id="specialRequest" className="form-control" rows={2}
              value={specialRequest} onChange={(e) => setSpecialRequest(e.target.value)}
            />
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitting ? t.form.submitting : t.form.submit}
          </button>
        </div>
      </form>

      <Link href={`/s/${shopCode}`} className="text-sm text-secondary underline">
        {t.form.backToShop}
      </Link>
    </>
  );
}
