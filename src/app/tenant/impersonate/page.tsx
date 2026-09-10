'use client';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { ApiError } from '@/lib/api';
import { impersonationPage as t } from '@/i18n/zh-TW/pages/impersonation';
import {
  getImpersonationTarget,
  startImpersonation,
  type ImpersonationTarget,
} from '@/services/platform-impersonation';

/**
 * `/tenant/impersonate?guide=<guideId>` —— 從 Midao 管理者後台點進來的落點（21 分冊 §8.4 方案 A）。
 *
 * ⚠️ 這一頁**刻意不是**「點了就直接進去」。它存在的兩個理由：
 *
 *   1. **理由在這裡收集。** 裁示要求全程 audit，而沒有理由的進入紀錄，
 *      稽核時等於沒有紀錄。
 *   2. **防誤點。** 不小心碰到 Midao 那顆按鈕，不會就這樣靜默進了別人的店。
 *
 * 四種狀態各自誠實：未登入、不是 platform admin、找不到對應店家、可以進入。
 * 「找不到對應店家」不偽裝成錯誤——那是常見且合法的狀態（店家沒在 Midao 上架）。
 */
function ImpersonateConfirmInner() {
  const router = useRouter();
  const params = useSearchParams();
  const guide = params?.get('guide') ?? undefined;
  const tenantId = params?.get('tenantId') ?? undefined;

  const [target, setTarget] = React.useState<ImpersonationTarget | null>(null);
  const [error, setError] = React.useState<string>('');
  const [loading, setLoading] = React.useState(true);
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!guide && !tenantId) {
      setError(t.errors.noTarget);
      setLoading(false);
      return;
    }
    let alive = true;
    void getImpersonationTarget({ guide, tenantId })
      .then((x) => alive && setTarget(x))
      .catch((e: unknown) => {
        if (!alive) return;
        // 逐種狀態給不同的話。全部收斂成一句「發生錯誤」會讓人不知道要去修什麼。
        if (e instanceof ApiError && e.status === 401) setError(t.errors.notLoggedIn);
        else if (e instanceof ApiError && e.status === 403) setError(t.errors.notPlatformAdmin);
        else if (e instanceof ApiError && e.status === 404) setError(t.errors.noTenantForGuide);
        else setError(t.errors.failed);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [guide, tenantId]);

  const submit = async () => {
    if (!target || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await startImpersonation({ tenantId: target.tenantId, reason });
      router.push('/tenant/dashboard');
    } catch (e: unknown) {
      setError(e instanceof ApiError && e.message ? e.message : t.errors.failed);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <Card>
        <div className="space-y-4 p-6">
          <div className="flex items-center gap-2 text-warning">
            <ShieldAlert size={18} />
            <span className="text-sm font-bold">{t.confirm.eyebrow}</span>
          </div>
          <h1 className="text-xl font-bold">{t.confirm.title}</h1>

          {loading ? (
            <div className="text-sm text-neutral-500">…</div>
          ) : error && !target ? (
            <div role="alert" className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          ) : target ? (
            <>
              <p className="text-sm text-neutral-600">{t.confirm.intro}</p>

              <div className="rounded-md bg-neutral-100 px-3 py-2 text-sm">
                <div className="text-neutral-500">{t.confirm.targetLabel}</div>
                <div className="font-bold">
                  {target.tenantName}（{target.shopCode}）
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-bold" htmlFor="impersonation-reason">
                  {t.confirm.reasonLabel}
                </label>
                <Input
                  id="impersonation-reason"
                  value={reason}
                  maxLength={200}
                  placeholder={t.confirm.reasonPlaceholder}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-neutral-500">{t.confirm.reasonHint}</p>
              </div>

              <p className="text-xs text-neutral-500">{t.confirm.limitNotice}</p>

              {error && (
                <div role="alert" className="text-sm text-danger">
                  {error}
                </div>
              )}

              <Button
                onClick={() => void submit()}
                disabled={submitting || reason.trim().length < 8}
                block
              >
                {submitting ? t.confirm.submitting : t.confirm.submit}
              </Button>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

/**
 * `useSearchParams()` 在靜態預先渲染時會 bail out，Next 15 要求包在 Suspense 裡，
 * 否則 build 直接失敗（實際撞到過，不是預防性寫法）。
 */
export default function ImpersonateConfirmPage() {
  return (
    <React.Suspense fallback={<div className="mx-auto w-full max-w-lg px-4 py-10 text-sm text-neutral-500">…</div>}>
      <ImpersonateConfirmInner />
    </React.Suspense>
  );
}
