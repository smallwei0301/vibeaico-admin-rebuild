'use client';
import * as React from 'react';
import { getDashboardStats } from '@/services/reports';
import { createWizardRequestGate } from '@/lib/line-setup-wizard';

/** 與設定載入、憑證及 verify 分開；同時只允許一個額度請求。 */
export function usePushQuota() {
  const [quotaState, setQuotaState] = React.useState<
    { status: 'loading' } | { status: 'error' } | { status: 'ready'; used: number; total: number }
  >({ status: 'loading' });
  const mounted = React.useRef(false);
  const gate = React.useRef(createWizardRequestGate());
  const pending = React.useRef(false);
  const retryQuota = React.useCallback(async () => {
    if (!mounted.current || pending.current) return;
    pending.current = true;
    const request = gate.current.begin();
    const current = () => mounted.current && gate.current.isCurrent(request);
    setQuotaState({ status: 'loading' });
    try {
      const stats = await getDashboardStats();
      if (current()) setQuotaState({ status: 'ready', used: stats.pushQuotaUsed, total: stats.pushQuotaTotal });
    } catch {
      if (current()) setQuotaState({ status: 'error' });
    } finally {
      if (current()) pending.current = false;
    }
  }, []);
  React.useEffect(() => {
    mounted.current = true;
    void retryQuota();
    return () => {
      mounted.current = false;
      gate.current.invalidate();
      pending.current = false;
    };
  }, [retryQuota]);
  return { quotaState, retryQuota };
}

