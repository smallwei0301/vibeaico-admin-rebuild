'use client';

import { pickRedirectContact } from '@/lib/public-contact';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ApiError, request } from '@/lib/api';
import { publicTourRequestPage as t, NOTE_MAX_LENGTH } from '@/i18n/zh-TW/pages/public-tour-request';
import { formatCurrency } from '@/lib/utils';
import { priceChangedQuoteFromError, isPriceChangedError, type PriceChangedQuote } from '@/lib/public-price-change';
import { shouldBlockSubmit, canSubmitBooking, resolveBookingTotal, seasonalHeadlineKind } from '@/lib/public-booking-price';
import type { PublicRequestPlan } from '@/server/public-tour-request';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatDepartureDate(departsOn: string): string {
  const [y, m, d] = departsOn.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}（${WEEKDAYS[weekday]}）`;
}

/** #909：名額不足（TOUR_001）或團次不可預約（REQ_003）——需要清除已選團次並重新讀取。 */
function isStaleDepartureError(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'TOUR_001' || e.code === 'REQ_003');
}

/** 後端錯誤碼 → 這一頁的中文訊息。查不到就退回通用訊息，不顯示原始錯誤碼給旅客。 */
function messageForError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'TOUR_001': return t.errors.seatsUnavailable;
      case 'TOUR_003': return t.errors.priceChangedNoQuote;
      case 'TOUR_004': return t.errors.priceUnverifiable;
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
  // #1015：同一 tick 連點兩次時 state 尚未重繪，以 ref 同步擋下第二次送出；成功後不重置，直到導頁。
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState('');
  // #749：頁面金額與實際金額不符時，後端回的現價；旅客確認後以此金額再送出。改團次或人數即作廢。
  const [confirmedQuote, setConfirmedQuote] = React.useState<PriceChangedQuote | null>(null);

  const partySizeInvalid = !Number.isInteger(partySize) || partySize < plan.minParty || partySize > plan.maxParty;
  const hasContact = !!(contactPhone.trim() || contactLine.trim() || contactEmail.trim());
  // 實際金額摘要只使用 resolveBookingTotal 的結果（與 create_tour_order 同順序：季節單價 → PER_GROUP 一口價／PER_PERSON × 人數）。
  const selectedDeparture = plan.departures.find((d) => d.id === departureId);
  const bookingTotal = resolveBookingTotal(selectedDeparture, plan, partySize);
  const canSubmit = canSubmitBooking({
    departureId, contactName, hasContact, partySize, minParty: plan.minParty, maxParty: plan.maxParty, submitting,
    seasonalPricing: plan.seasonalPricing, bookingTotal,
  });

  // 送出時鎖定的金額：旅客已確認新金額就用它，否則用頁面目前顯示的金額（算不出時不帶，維持舊行為）。
  const expectedTotal = confirmedQuote ? confirmedQuote.total : bookingTotal?.total;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (shouldBlockSubmit({ canSubmit, inFlight: inFlight.current })) return;
    inFlight.current = true;
    setSubmitting(true);
    setError('');
    try {
      const res = await request<{ orderId: string; orderNo: string }>('/api/public/tour-requests', {
        method: 'POST',
        body: JSON.stringify({
          shopCode, planId: plan.planId, departureId, partySize, expectedTotal,
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim() || undefined,
          contactLine: contactLine.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          preferredNote: preferredNote.trim() || undefined,
          specialRequest: specialRequest.trim() || undefined,
        }),
      });
      const contact = pickRedirectContact(contactPhone, contactLine, contactEmail);
      // #1015：成功路徑刻意不重置 submitting／inFlight，按鈕保持停用直到導頁完成，避免重複建單。
      router.replace(
        `/s/${shopCode}/requests/${res.orderId}?contact=${encodeURIComponent(contact)}&created=1`,
      );
    } catch (err) {
      inFlight.current = false;
      setSubmitting(false);
      const quote = priceChangedQuoteFromError(err);
      if (quote) {
        setConfirmedQuote(quote);
        setError('');
      } else {
        if (isPriceChangedError(err)) setConfirmedQuote(null);
        // #909：名額被搶或團次失效時，已選團次已不可信：清除選擇並重新讀取伺服器端團次清單。
        if (isStaleDepartureError(err)) {
          setDepartureId('');
          setConfirmedQuote(null);
          router.refresh();
        }
        setError(messageForError(err));
      }
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
          {seasonalHeadlineKind(plan) === 'by-departure' ? t.form.seasonalHeadline : seasonalHeadlineKind(plan) === 'contact' ? t.form.seasonalContactHeadline : <>{formatCurrency(plan.pricePerPerson)}{t.form.planPriceUnit[plan.priceType]}</>}
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
                onChange={(e) => { setDepartureId(e.target.value); setConfirmedQuote(null); }}
                required
              >
                <option value="">{t.form.departurePlaceholder}</option>
                {plan.departures.map((d) => (
                  <option key={d.id} value={d.id}>
                    {t.form.departureOption(formatDepartureDate(d.departsOn), d.startTime, d.seatsLeft)}
                    {d.unitPrice !== undefined ? t.form.departurePrice(formatCurrency(d.unitPrice), t.form.planPriceUnit[plan.priceType]) : ''}
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
              value={Number.isNaN(partySize) ? '' : partySize}
              onChange={(e) => { setPartySize(e.target.value === '' ? NaN : Number(e.target.value)); setConfirmedQuote(null); }}
              aria-invalid={partySizeInvalid || undefined}
              aria-describedby={partySizeInvalid ? 'partySize-error' : undefined}
              required
            />
            {partySizeInvalid ? (
              <p id="partySize-error" className="text-sm text-danger">
                {t.errors.partySizeOutOfRange(plan.minParty, plan.maxParty)}
              </p>
            ) : null}
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
              id="preferredNote" className="form-control" rows={2} maxLength={NOTE_MAX_LENGTH}
              value={preferredNote} onChange={(e) => setPreferredNote(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="specialRequest">{t.form.specialRequestLabel}</label>
            <textarea
              id="specialRequest" className="form-control" rows={2} maxLength={NOTE_MAX_LENGTH}
              value={specialRequest} onChange={(e) => setSpecialRequest(e.target.value)}
            />
          </div>

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          {confirmedQuote ? (
            <div role="alert" className="flex flex-col gap-1 rounded-md border border-warning px-3 py-2 text-sm text-warning">
              <span className="font-medium">{t.form.priceChangedTitle}</span>
              <span>
                {t.form.priceChangedDescription(
                  `${formatCurrency(confirmedQuote.unitPrice)}${t.form.planPriceUnit[confirmedQuote.priceType]}`,
                  formatCurrency(confirmedQuote.total),
                )}
              </span>
            </div>
          ) : null}

          {bookingTotal && !confirmedQuote ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t.form.totalLabel}</span>
              <span className="text-base font-semibold">
                {plan.priceType === 'PER_GROUP'
                  ? t.form.totalPerGroup(formatCurrency(bookingTotal.total))
                  : t.form.totalPerPerson(formatCurrency(bookingTotal.unitPrice), partySize, formatCurrency(bookingTotal.total))}
              </span>
            </div>
          ) : selectedDeparture && plan.seasonalPricing && !confirmedQuote ? (
            <p className="text-sm text-secondary">{t.form.totalUnknown}</p>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {submitting ? t.form.submitting : confirmedQuote ? t.form.submitConfirmNewPrice : t.form.submit}
          </button>
        </div>
      </form>

      <Link href={`/s/${shopCode}`} className="text-sm text-secondary underline">
        {t.form.backToShop}
      </Link>
    </>
  );
}
