'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, CalendarClock, CheckCircle2, ChevronRight } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { dashboardPage as t } from '@/i18n/zh-TW/pages/dashboard';
import { formatDateTime } from '@/lib/utils';
import type { GuideActionInbox as Inbox, GuideActionItem } from '@/server/guide-action-inbox';
import { getGuideActionInbox } from '@/services/guide-action-inbox';

const SECTIONS = [
  { key: 'immediate', title: t.guideInbox.sections.immediate, tone: 'danger' as const },
  { key: 'today', title: t.guideInbox.sections.today, tone: 'warning' as const },
  { key: 'upcoming', title: t.guideInbox.sections.upcoming, tone: 'info' as const },
] as const;

function ActionCard({ item }: { item: GuideActionItem }) {
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-dark">{t.guideInbox.reasons[item.reason]}</p>
        <p className="mt-1 truncate text-sm font-medium text-dark">{item.subject}</p>
        <p className="truncate text-xs text-secondary">{item.detail}</p>
        {item.dueAt ? (
          <p className="mt-1 text-xs text-secondary">
            {t.guideInbox.deadline(formatDateTime(item.dueAt))}
            {item.overdue ? <Badge className="ml-2" tone="danger">{t.guideInbox.overdue}</Badge> : null}
          </p>
        ) : null}
      </div>
      <Link href={item.href} className="btn btn-primary btn-sm w-full justify-center sm:w-auto sm:flex-shrink-0">
        {t.guideInbox.actions[item.reason]}
        <ChevronRight size={14} />
      </Link>
    </li>
  );
}

export function GuideActionInbox() {
  const [inbox, setInbox] = React.useState<Inbox | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void getGuideActionInbox()
      .then((result) => { if (active) setInbox(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  if (failed) return <Alert tone="danger" className="mb-4">{t.guideInbox.loadFailed}</Alert>;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle><AlertCircle size={18} className="text-warning" />{t.guideInbox.title}</CardTitle>
      </CardHeader>
      <CardBody>
        {!inbox ? (
          <p className="text-sm text-secondary" aria-live="polite">{t.guideInbox.loading}</p>
        ) : SECTIONS.every(({ key }) => inbox[key].length === 0) ? (
          <EmptyState icon={CheckCircle2} title={t.guideInbox.emptyTitle} description={t.guideInbox.emptyDescription} />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {SECTIONS.map(({ key, title, tone }) => (
              <section key={key} aria-labelledby={`guide-inbox-${key}`} className="min-w-0">
                <h3 id={`guide-inbox-${key}`} className="mb-2 flex items-center gap-2 text-sm font-bold">
                  <CalendarClock size={15} />
                  {title}
                  <Badge tone={tone}>{inbox[key].length}</Badge>
                </h3>
                {inbox[key].length > 0 ? (
                  <ul className="space-y-2">{inbox[key].map((item) => <ActionCard key={item.id} item={item} />)}</ul>
                ) : (
                  <p className="rounded-lg bg-surface-subtle p-3 text-sm text-secondary">{t.guideInbox.emptyTitle}</p>
                )}
              </section>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
