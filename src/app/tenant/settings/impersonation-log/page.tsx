'use client';
import * as React from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { impersonationPage as t } from '@/i18n/zh-TW/pages/impersonation';
import {
  getImpersonationLog,
  type ImpersonationActionEntry,
  type ImpersonationLogEntry,
} from '@/services/platform-impersonation';

/**
 * `/tenant/settings/impersonation-log` —— 店家自己查得到平台進來過幾次、做了什麼。
 *
 * 這一頁是 Owner 2026-08-27 裁示裡「**租戶可查紀錄**」那一句的落點。它不是給平台
 * 看的報表，是給**被進入的那一方**看的。所以它歸在店家的設定底下，不在任何平台頁。
 *
 * ⚠️ 空的時候顯示「目前沒有平台管理者進入過你的後台」——但**只有查詢真的成功
 * 且真的是零筆時才顯示**。查詢失敗時顯示錯誤，不得讓故障冒充「沒有紀錄」（PB-023）：
 * 對這一頁來說，那個謊言的內容剛好是「沒有人進來過」。
 */
const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '';

export default function ImpersonationLogPage() {
  const [sessions, setSessions] = React.useState<ImpersonationLogEntry[]>([]);
  const [actions, setActions] = React.useState<ImpersonationActionEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void getImpersonationLog()
      .then((d) => {
        if (!alive) return;
        setSessions(d.sessions);
        setActions(d.actions);
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const empty = !loading && !failed && sessions.length === 0 && actions.length === 0;

  return (
    <>
      <PageHeader title={t.log.title} />
      <Card>
        <div className="space-y-6 p-6">
          <p className="text-sm text-neutral-600">{t.log.intro}</p>

          {loading && <div className="text-sm text-neutral-500">…</div>}

          {failed && (
            <div role="alert" className="rounded-md bg-neutral-100 px-3 py-2 text-sm text-danger">
              {t.log.loadFailed}
            </div>
          )}

          {empty && <EmptyState title={t.log.empty} />}

          {!loading && !failed && sessions.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-bold">{t.log.sessionsTitle}</h2>
              <ul className="space-y-2">
                {sessions.map((s) => (
                  <li key={s.id} className="rounded-md bg-neutral-100 px-3 py-2 text-sm">
                    <div className="font-bold">
                      {t.log.reason}：{s.reason}
                    </div>
                    <div className="text-neutral-600">
                      {t.log.startedAt} {fmt(s.startedAt)}
                      {' ・ '}
                      {t.log.endedAt}{' '}
                      {s.endedAt
                        ? fmt(s.endedAt)
                        : new Date(s.expiresAt) <= new Date()
                          ? t.log.autoExpired
                          : t.log.stillActive}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!loading && !failed && actions.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-bold">{t.log.actionsTitle}</h2>
              <ul className="space-y-1">
                {actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-3 text-sm">
                    <span className="text-neutral-500">{fmt(a.at)}</span>
                    <span className="font-bold">{a.method}</span>
                    <span className="break-all">{a.path}</span>
                    <span className="text-neutral-500">{a.status || ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs text-neutral-500">{t.log.scopeNotice}</p>
        </div>
      </Card>
    </>
  );
}
