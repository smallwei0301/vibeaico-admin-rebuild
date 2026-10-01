import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadPublicTripDetails, type PublicShop } from '@/server/public-shop';
import { publicShopPage } from '@/i18n/zh-TW/pages/public-shop';
import { publicTripDetailsPage as t } from '@/i18n/zh-TW/pages/public-trip-details';
import { formatCurrency } from '@/lib/utils';

type Params = {
  params: Promise<{ shopCode: string; slug: string }>;
};

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shopCode, slug } = await params;
  try {
    const data = await loadPublicTripDetails(shopCode, slug);
    if (!data) return { title: t.metadata.notFound };
    return {
      title: `${data.trip.title}｜${data.shop.name}`,
      description: data.trip.summary || t.metadata.description(data.trip.title),
    };
  } catch (error) {
    console.error('[public-trip-details] generateMetadata failed', {
      shopCode,
      slug,
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    });
    return { title: t.metadata.notFound };
  }
}

function formatDepartureDate(departsOn: string): string {
  const [year, month, day] = departsOn.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${month}/${day}（${t.departures.weekdays[weekday] ?? ''}）`;
}

function ContactActions({ shop }: { shop: PublicShop }) {
  const actions: React.ReactNode[] = [];
  if (shop.lineBasicId) {
    actions.push(
      <a
        key="line"
        className="btn btn-line"
        href={`https://line.me/R/ti/p/${encodeURIComponent(shop.lineBasicId)}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t.contact.viaLine}
      </a>,
    );
  }
  if (shop.phone) {
    actions.push(
      <a key="phone" className="btn btn-outline" href={`tel:${shop.phone.replace(/[^\d+]/g, '')}`}>
        {t.contact.viaPhone(shop.phone)}
      </a>,
    );
  }
  if (shop.email) {
    actions.push(
      <a key="email" className="btn btn-outline" href={`mailto:${shop.email}`}>
        {t.contact.viaEmail(shop.email)}
      </a>,
    );
  }
  return actions.length ? <div className="flex flex-wrap gap-2">{actions}</div> : (
    <p className="text-sm text-secondary">{t.contact.noContact}</p>
  );
}

export default async function PublicTripDetailsPage({ params }: Params) {
  const { shopCode, slug } = await params;
  const data = await loadPublicTripDetails(shopCode, slug);
  if (!data) notFound();

  const { shop, trip } = data;
  const refundPolicy = publicShopPage.trips.cancellationPolicy[trip.refundPolicyType];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <Link href={`/s/${shopCode}`} className="text-sm text-secondary underline underline-offset-4">
        {t.navigation.backToShop(shop.name)}
      </Link>

      <header className="flex flex-col gap-2">
        <div className="badge badge-primary w-fit">{t.trip.eyebrow}</div>
        <h1 className="text-2xl font-semibold">{trip.title}</h1>
        {trip.tagline ? <p className="text-base font-medium">{trip.tagline}</p> : null}
        <div className="flex flex-wrap gap-2 text-sm text-secondary">
          {trip.region ? <span>{trip.region}</span> : null}
          {trip.category ? <span>{trip.category}</span> : null}
          {trip.location ? <span>{trip.location}</span> : null}
          {trip.durationHours ? <span>{t.trip.durationHours(trip.durationHours)}</span> : null}
        </div>
        {trip.coverImageUrl ? (
          <Image
            src={trip.coverImageUrl}
            alt={trip.title}
            width={960}
            height={600}
            unoptimized
            className="mt-2 aspect-[8/5] w-full rounded-lg object-cover"
          />
        ) : null}
        {trip.summary ? <p className="whitespace-pre-line text-sm text-secondary">{trip.summary}</p> : null}
      </header>

      {trip.description ? (
        <section className="card">
          <div className="card-body flex flex-col gap-2">
            <h2 className="text-lg font-medium">{t.trip.descriptionTitle}</h2>
            <p className="whitespace-pre-line text-sm">{trip.description}</p>
          </div>
        </section>
      ) : null}

      {trip.galleryUrls.length ? (
        <section className="card">
          <div className="card-body flex flex-col gap-3">
            <h2 className="text-lg font-medium">{t.trip.galleryTitle}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {trip.galleryUrls.map((url, index) => (
                <Image
                  key={url}
                  src={url}
                  alt={t.trip.galleryAlt(trip.title, index + 1)}
                  width={480}
                  height={480}
                  unoptimized
                  className="aspect-square w-full rounded-lg object-cover"
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {trip.meetingPoint || trip.meetingPointMapUrl ? (
        <section className="card">
          <div className="card-body flex flex-col gap-2">
            <h2 className="text-lg font-medium">{t.trip.locationTitle}</h2>
            {trip.meetingPoint ? (
              <p className="text-sm">
                <span className="font-medium">{t.trip.meetingPointLabel}：</span>
                {trip.meetingPoint}
              </p>
            ) : null}
            {trip.meetingPointMapUrl ? (
              <a
                className="btn btn-outline w-fit"
                href={trip.meetingPointMapUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t.trip.mapLink}
              </a>
            ) : null}
          </div>
        </section>
      ) : null}

      {trip.inclusions.length || trip.exclusions.length || trip.notices.length || trip.safetyNotice ? (
        <section className="card">
          <div className="card-body flex flex-col gap-4">
            {trip.inclusions.length ? (
              <div>
                <h2 className="text-base font-medium">{t.trip.inclusionsTitle}</h2>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {trip.inclusions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                </ul>
              </div>
            ) : null}
            {trip.exclusions.length ? (
              <div>
                <h2 className="text-base font-medium">{t.trip.exclusionsTitle}</h2>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {trip.exclusions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                </ul>
              </div>
            ) : null}
            {trip.notices.length ? (
              <div>
                <h2 className="text-base font-medium">{t.trip.noticesTitle}</h2>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {trip.notices.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                </ul>
              </div>
            ) : null}
            {trip.safetyNotice ? (
              <div className="rounded-md border border-warning p-3">
                <h2 className="text-base font-medium">{t.trip.safetyTitle}</h2>
                <p className="mt-1 whitespace-pre-line text-sm">{trip.safetyNotice}</p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-body flex flex-col gap-3">
          <h2 className="text-lg font-medium">{t.plans.title}</h2>
          {trip.plans.length === 0 ? (
            <p className="text-sm text-secondary">{t.plans.empty}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {trip.plans.map((plan) => (
                <li key={plan.id} className="rounded-md border border-neutral-200 p-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{plan.name}</h3>
                      <span className="badge badge-neutral">{t.plans.mode[plan.salesMode]}</span>
                    </div>
                    {plan.description ? (
                      <p className="whitespace-pre-line text-sm text-secondary">{plan.description}</p>
                    ) : null}
                    <div className="flex flex-wrap gap-2 text-sm">
                      <span>{t.plans.price(formatCurrency(plan.pricePerPerson), t.plans.priceUnit[plan.priceType])}</span>
                      <span className="text-secondary">{t.plans.partyRange(plan.minParty, plan.maxParty)}</span>
                    </div>
                    <p className="text-2xs text-secondary">{t.plans.priceNote}</p>
                    {plan.departures.length ? (
                      <div className="flex flex-col gap-1">
                        <h4 className="text-sm font-medium">{t.departures.title}</h4>
                        <ul className="flex flex-wrap gap-2">
                          {plan.departures.map((departure) => (
                            <li key={departure.id} className="badge badge-primary">
                              {formatDepartureDate(departure.departsOn)}{' '}
                              {departure.startTime || t.departures.noStartTime}{' · '}
                              {t.departures.seatsLeft(departure.seatsLeft)}
                            </li>
                          ))}
                        </ul>
                        <p className="text-2xs text-secondary">{t.departures.availabilityNote}</p>
                      </div>
                    ) : (
                      <p className="text-sm text-secondary">{t.departures.empty}</p>
                    )}
                    {plan.salesMode === 'REQUEST' ? (
                      <Link className="btn btn-primary w-fit" href={`/s/${shopCode}/plans/${plan.id}/request`}>
                        {t.plans.requestCta}
                      </Link>
                    ) : null}
                    {plan.salesMode === 'FIXED_DEPARTURE' ? (
                      <Link className="btn btn-primary w-fit" href={`/s/${shopCode}/plans/${plan.id}/book`}>
                        {t.plans.fixedCta}
                      </Link>
                    ) : null}
                    {plan.salesMode === 'INSTANT' ? (
                      <p className="text-sm text-warning">{t.plans.instantNote}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-body flex flex-col gap-3">
          <h2 className="text-base font-medium">{t.trip.cancellationPolicyTitle}</h2>
          <p className="text-sm text-secondary">{refundPolicy}</p>
          <h2 className="text-base font-medium">{t.contact.title}</h2>
          <ContactActions shop={shop} />
        </div>
      </section>
    </main>
  );
}
