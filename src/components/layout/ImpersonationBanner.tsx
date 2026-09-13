'use client';
import * as React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { impersonationPage as t } from '@/i18n/zh-TW/pages/impersonation';
import { endImpersonation, getImpersonationState, type ImpersonationState } from '@/services/platform-impersonation';

/**
 * 代入中的常駐橫幅（21 分冊 §2）。
 *
 * ⚠️ 它存在的理由只有一個：讓代入中的人**時時刻刻知道自己不是自己**。
 * 一個看起來和平常一模一樣的後台，是最容易讓人忘記「這是別人的店」的介面。
 * 因此它不可關閉、不可摺疊，只有「結束代入」。
 *
 * 剩餘時間每 30 秒重算一次。逾時後 session 在伺服器端本來就失效了，這裡改顯示
 * 「已逾時」而不是繼續倒數——顯示一個早就不成立的剩餘時間是另一種假成功。
 */
export function ImpersonationBanner() {
  const [state, setState] = React.useState<ImpersonationState | null>(null);
  const [ending, setEnding] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    let alive = true;
    void getImpersonationState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState(null));
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!state?.active) return null;

  const msLeft = state.expiresAt ? new Date(state.expiresAt).getTime() - now : 0;
  const expired = msLeft <= 0;
  const minutesLeft = Math.max(0, Math.ceil(msLeft / 60_000));

  const finish = async () => {
    setEnding(true);
    try {
      await endImpersonation();
    } finally {
      // 不論成功與否都重新載入：伺服器端的 cookie 已清或已失效，
      // 停在原畫面會讓人以為還在代入中。
      window.location.assign('/tenant/dashboard');
    }
  };

  return (
    <div
      role="status"
      /* tailwind.config.ts 沒有 warning 的淺色階，改用 tokens.css 既有的
         --badge-warning-bg/fg（CONVENTIONS 硬規則允許 var(--…)），不自己寫死色碼。 */
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-warning bg-[var(--badge-warning-bg)] px-4 py-2 text-sm text-[var(--badge-warning-fg)]"
    >
      <ShieldAlert size={16} className="text-warning" />
      <span className="font-bold">{t.banner.label}</span>
      <span>
        {t.banner.inShop}
        <span className="font-bold">
          {state.tenantName}
          {state.shopCode ? `（${state.shopCode}）` : ''}
        </span>
      </span>
      <span className={expired ? 'font-bold text-danger' : ''}>
        {expired ? t.banner.expired : `${t.banner.remaining} ${minutesLeft} ${t.banner.minuteSuffix}`}
      </span>
      <Button size="sm" variant="outline" onClick={() => void finish()} disabled={ending}>
        {ending ? t.banner.ending : t.banner.end}
      </Button>
    </div>
  );
}
