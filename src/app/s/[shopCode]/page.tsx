/**
 * `/s/{shopCode}` — 公開店家頁（issue #46 第一片）
 * -----------------------------------------------------------------------------
 * 後台有 7 個地方把這個網址當成「你的公開預約網址」顯示給店家，其中兩處還是可以
 * 直接點的連結。在這個檔存在之前，那 7 個地方全部指向 404。
 *
 * ## 這一版能做什麼、不能做什麼（刻意寫在這裡）
 *
 * **能**：顧客看得到店家名稱、聯絡方式、已發布的行程與方案、近期還有空位的出團
 * 日期、以及上架中的服務項目。
 *
 * **不能**：線上下單與付款。那條鏈（#12 旅客 checkout／#32 顧客端付款）**整個
 * 還沒有建** —— `/pay/*` 在 `src/app/` 底下不存在。所以這一頁**沒有任何「立即預約」
 * 按鈕**，而是明確告訴顧客要怎麼聯絡店家。
 *
 * 放一顆按了沒反應的按鈕，比沒有按鈕糟得多：顧客會以為自己訂好了。這是本專案
 * 反覆記錄的那類缺陷（假成功），不要在第一個顧客看得到的頁面上重演。
 *
 * ## 為什麼是 Server Component
 *
 * CLAUDE.md 的「頁面永不 fetch」是針對 `/tenant/*` 那些 `'use client'` 頁面說的：
 * 它們的資料入口一律走 `src/services/*` ＋ `adapt()`，好讓 mock／真實兩條路可以
 * 整批切換。這一頁不同：
 *
 *   - 它是**公開**頁，沒有登入 session 可用；
 *   - 相關資料表的 RLS 是 `is_tenant_member(tenant_id)`，匿名訪客一列都讀不到；
 *   - 它是唯讀、沒有互動狀態，不需要變成 client component。
 *
 * 所以走伺服器端直接讀（`src/server/public-shop.ts`，以 service role 並自行收窄
 * 範圍）。那個檔的檔頭寫明了它為什麼必須嚴格 —— service role 繞過 RLS，那裡沒收好
 * 就沒有第二道防線。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPublicShop, type PublicShopData } from '@/server/public-shop';
import { publicShopPage as t } from '@/i18n/zh-TW/pages/public-shop';
import { formatCurrency } from '@/lib/utils';

type Params = { params: Promise<{ shopCode: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shopCode } = await params;
  const data = await loadPublicShop(shopCode);
  if (!data) return { title: t.notFound.title };
  return {
    title: data.shop.name,
    description: data.shop.description || undefined,
  };
}

/** 台北時區的「今天」；用來把日期顯示成 M/D（週X）。 */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatDepartureDate(departsOn: string): string {
  const [y, m, d] = departsOn.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}/${d}（${WEEKDAYS[weekday]}）`;
}

function ContactActions({ shop }: { shop: PublicShopData['shop'] }) {
  const actions: React.ReactNode[] = [];
  if (shop.lineBasicId) {
    // LINE 官方帳號基本 ID 形如 @abc1234x；加好友連結是 line.me/R/ti/p/{basicId}
    actions.push(
      <a
        key="line"
        className="btn btn-primary"
        href={`https://line.me/R/ti/p/${encodeURIComponent(shop.lineBasicId)}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t.booking.viaLine}
      </a>,
    );
  }
  if (shop.phone) {
    actions.push(
      <a key="tel" className="btn btn-outline" href={`tel:${shop.phone.replace(/[^\d+]/g, '')}`}>
        {t.booking.viaPhone(shop.phone)}
      </a>,
    );
  }
  if (shop.email) {
    actions.push(
      <a key="mail" className="btn btn-outline" href={`mailto:${shop.email}`}>
        {t.booking.viaEmail(shop.email)}
      </a>,
    );
  }
  if (actions.length === 0) {
    return <p className="text-sm text-secondary">{t.booking.noContact}</p>;
  }
  return <div className="flex flex-wrap gap-2">{actions}</div>;
}

export default async function PublicShopPage({ params }: Params) {
  const { shopCode } = await params;
  const data = await loadPublicShop(shopCode);
  if (!data) notFound();

  const { shop, trips, services } = data;
  const hasContent = trips.length > 0 || services.length > 0;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{shop.name}</h1>
        {shop.description ? (
          <p className="whitespace-pre-line text-sm text-secondary">{shop.description}</p>
        ) : null}
      </header>

      {/* ⚠️ 這一段刻意放在最上面：顧客來這一頁最想知道的就是「怎麼預約」，
          而目前的誠實答案是「用 LINE 或電話聯絡」，不是一顆假按鈕。 */}
      <section className="card">
        <div className="card-body flex flex-col gap-3">
          <h2 className="text-base font-medium">{t.booking.title}</h2>
          <p className="text-sm text-secondary">{t.booking.howTo}</p>
          <ContactActions shop={shop} />
        </div>
      </section>

      {!hasContent ? (
        <section className="card">
          <div className="card-body flex flex-col gap-1">
            <h2 className="text-base font-medium">{t.emptyShop.title}</h2>
            <p className="text-sm text-secondary">{t.emptyShop.description}</p>
          </div>
        </section>
      ) : null}

      {trips.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{t.trips.title}</h2>
          {trips.map((trip) => {
            const prices = trip.plans.map((p) => p.pricePerPerson).filter((n) => n > 0);
            const lowest = prices.length > 0 ? Math.min(...prices) : null;
            return (
              <article key={trip.id} className="card">
                <div className="card-body flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-base font-medium">{trip.title}</h3>
                    <div className="flex flex-wrap gap-2 text-2xs text-secondary">
                      {trip.location ? <span>{trip.location}</span> : null}
                      {trip.durationHours ? (
                        <span>{t.trips.durationHours(trip.durationHours)}</span>
                      ) : null}
                      {lowest != null ? (
                        <span>{t.trips.priceFrom(formatCurrency(lowest))}</span>
                      ) : null}
                    </div>
                    {trip.summary ? (
                      <p className="whitespace-pre-line text-sm text-secondary">{trip.summary}</p>
                    ) : null}
                  </div>

                  {trip.plans.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {trip.plans.map((plan) => (
                        <li key={plan.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className="font-medium">{plan.name}</span>
                          <span>{formatCurrency(plan.pricePerPerson)}</span>
                          <span className="text-2xs text-secondary">
                            {t.trips.partyRange(plan.minParty, plan.maxParty)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="flex flex-col gap-1">
                    <div className="text-2xs font-medium text-secondary">
                      {t.trips.departuresTitle}
                    </div>
                    {trip.departures.length === 0 ? (
                      <p className="text-2xs text-secondary">{t.trips.departuresEmpty}</p>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {trip.departures.map((departure) => (
                          <li key={departure.id} className="badge badge-primary">
                            {formatDepartureDate(departure.departsOn)}
                            {' '}
                            {departure.startTime || t.trips.noStartTime}
                            {' · '}
                            {t.trips.seatsLeft(departure.capacity - departure.seatsBooked)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {services.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{t.services.title}</h2>
          <ul className="flex flex-col gap-2">
            {services.map((service) => (
              <li key={service.id} className="card">
                <div className="card-body flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{service.name}</span>
                    <span>{formatCurrency(service.price)}</span>
                    <span className="text-2xs text-secondary">
                      {t.services.minutes(service.durationMinutes)}
                    </span>
                  </div>
                  {service.description ? (
                    <p className="text-sm text-secondary">{service.description}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {shop.phone || shop.email || shop.address ? (
        <section className="card">
          <div className="card-body flex flex-col gap-1">
            <h2 className="text-base font-medium">{t.contact.title}</h2>
            {shop.phone ? (
              <div className="text-sm">{t.contact.phone}：{shop.phone}</div>
            ) : null}
            {shop.email ? (
              <div className="text-sm">{t.contact.email}：{shop.email}</div>
            ) : null}
            {shop.address ? (
              <div className="text-sm">{t.contact.address}：{shop.address}</div>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
