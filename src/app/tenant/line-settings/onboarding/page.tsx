'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Modal';
import { FormGroup, FormText, Input, Label } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  createLineRichMenu,
  disconnectLineSettings,
  getTenantSettings,
  saveLineSettings,
  testLineConnection,
  verifyLineSetup,
} from '@/services/settings';
import { buildWebhookUrl } from '@/config/tenant-settings';
import type { TenantSettings } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { lineSetupWizardCopy as t } from '@/i18n/zh-TW/line-setup-wizard';
import {
  confirmAutoReplyCheck,
  createLineSetupWizard,
  createRichMenuCheck,
  lineTestResultToCheck,
  lineUserError,
  mapLineVerifyChecks,
  mergeLineSetupChecks,
  type LineSetupStepKey,
  type LineSetupStepStatus,
} from '@/lib/line-setup-wizard';

const VERIFY_STEP_KEYS = new Set<LineSetupStepKey>([
  'WEBHOOK_URL',
  'WEBHOOK_ENABLED',
  'RICH_MENU',
  'QUOTA',
]);

function statusTone(status: LineSetupStepStatus): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'PASSED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'ACTION_REQUIRED') return 'warning';
  return 'neutral';
}

function StatusIcon({ status }: { status: LineSetupStepStatus }) {
  if (status === 'PASSED') return <CheckCircle2 size={20} className="text-success" aria-hidden />;
  if (status === 'FAILED') return <CircleAlert size={20} className="text-danger" aria-hidden />;
  if (status === 'ACTION_REQUIRED') return <ShieldCheck size={20} className="text-warning" aria-hidden />;
  if (status === 'BLOCKED') return <Unlink size={20} className="text-secondary" aria-hidden />;
  return <ClipboardCheck size={20} className="text-secondary" aria-hidden />;
}

export default function LineOnboardingPage() {
  const toast = useToast();
  const [loading, setLoading] = React.useState(true);
  const [settings, setSettings] = React.useState<TenantSettings | null>(null);
  const [wizard, setWizard] = React.useState(createLineSetupWizard);
  const [expanded, setExpanded] = React.useState<LineSetupStepKey | null>('CREDENTIALS');
  const [channelId, setChannelId] = React.useState('');
  const [channelSecret, setChannelSecret] = React.useState('');
  const [accessToken, setAccessToken] = React.useState('');
  const [formError, setFormError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [creatingRichMenu, setCreatingRichMenu] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [runningAll, setRunningAll] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);

  const applySettings = React.useCallback((next: TenantSettings) => {
    setSettings(next);
    setChannelId(next.line.channelId);
    setChannelSecret('');
    setAccessToken('');
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        applySettings(await getTenantSettings());
      } catch {
        setFormError(t.errors.generic);
      } finally {
        setLoading(false);
      }
    })();
  }, [applySettings]);

  const hasSavedCredentials = Boolean(
    settings?.line.channelId
      && settings.line.channelSecret
      && settings.line.channelAccessToken,
  );
  const credentialsDirty = Boolean(
    settings && (
      channelId.trim() !== settings.line.channelId
      || channelSecret.trim()
      || accessToken.trim()
    ),
  );
  const canRunSavedChecks = hasSavedCredentials && !credentialsDirty;
  const webhookUrl = settings
    ? settings.line.webhookUrl || buildWebhookUrl(APP_URL, settings.basic.shopCode)
    : '';
  const progressPercent = Math.round((wizard.completedCount / wizard.steps.length) * 100);
  const busy = saving || testing || verifying || creatingRichMenu || disconnecting || runningAll;

  const saveCredentials = async () => {
    const id = channelId.trim();
    const secret = channelSecret.trim();
    const token = accessToken.trim();
    if (!/^\d+$/.test(id)) {
      setFormError(t.credentials.invalidId);
      setExpanded('CREDENTIALS');
      return;
    }
    if (!settings?.line.channelSecret && !secret) {
      setFormError(t.credentials.required);
      setExpanded('CREDENTIALS');
      return;
    }
    if (!settings?.line.channelAccessToken && !token) {
      setFormError(t.credentials.required);
      setExpanded('CREDENTIALS');
      return;
    }

    setFormError('');
    setSaving(true);
    try {
      await saveLineSettings({
        channelId: id,
        channelSecret: secret,
        channelAccessToken: token,
      });
      const refreshed = await getTenantSettings();
      applySettings(refreshed);
      // 新憑證會使舊的 provider evidence 過期，重新從待檢查開始才誠實。
      setWizard(createLineSetupWizard());
      toast.show(t.credentials.saved);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setFormError(lineUserError('CREDENTIALS', message));
      toast.show(lineUserError('CREDENTIALS', message), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const runCredentials = async (announce = true) => {
    if (!canRunSavedChecks) {
      setFormError(credentialsDirty ? t.credentials.saveBeforeTest : t.credentials.required);
      setExpanded('CREDENTIALS');
      return false;
    }
    setTesting(true);
    try {
      const result = await testLineConnection();
      setWizard((current) => mergeLineSetupChecks(current, [lineTestResultToCheck(result)]));
      setExpanded('CREDENTIALS');
      if (announce) {
        toast.show(
          result.ok ? result.message : lineUserError('CREDENTIALS', result.message),
          result.ok ? 'info' : 'danger',
        );
      }
      return result.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setWizard((current) => mergeLineSetupChecks(current, [
        lineTestResultToCheck({ ok: false, message }),
      ]));
      setExpanded('CREDENTIALS');
      if (announce) toast.show(lineUserError('CREDENTIALS', message), 'danger');
      return false;
    } finally {
      setTesting(false);
    }
  };

  const runVerify = async (announce = true) => {
    if (!canRunSavedChecks) {
      setFormError(credentialsDirty ? t.credentials.saveBeforeTest : t.credentials.required);
      setExpanded('CREDENTIALS');
      return false;
    }
    setVerifying(true);
    try {
      const result = await verifyLineSetup();
      setWizard((current) => mergeLineSetupChecks(current, mapLineVerifyChecks(result.checks)));
      setExpanded('WEBHOOK_URL');
      if (announce) toast.show(t.checksUpdated);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (announce) toast.show(lineUserError('GENERAL', message), 'danger');
      return false;
    } finally {
      setVerifying(false);
    }
  };

  const runAllChecks = async () => {
    if (!canRunSavedChecks) {
      setFormError(credentialsDirty ? t.credentials.saveBeforeTest : t.credentials.required);
      setExpanded('CREDENTIALS');
      return;
    }
    setRunningAll(true);
    try {
      await runCredentials(false);
      await runVerify(false);
      toast.show(t.checksUpdated);
    } finally {
      setRunningAll(false);
    }
  };

  const confirmAutoReply = () => {
    setWizard((current) => mergeLineSetupChecks(current, [confirmAutoReplyCheck()]));
    setExpanded('AUTO_REPLY');
    toast.show(t.autoReplyConfirmed, 'info');
  };

  const publishRichMenu = async () => {
    if (!canRunSavedChecks) {
      setFormError(credentialsDirty ? t.credentials.saveBeforeTest : t.credentials.required);
      setExpanded('CREDENTIALS');
      return;
    }
    setCreatingRichMenu(true);
    try {
      const result = await createLineRichMenu();
      setWizard((current) => mergeLineSetupChecks(current, [createRichMenuCheck(result)]));
      setExpanded('RICH_MENU');
      toast.show(t.richMenuAccepted, 'info');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setWizard((current) => mergeLineSetupChecks(current, [{
        key: 'RICH_MENU',
        status: 'FAILED',
        detail: message,
        summary: lineUserError('RICH_MENU', message),
      }]));
      setExpanded('RICH_MENU');
      toast.show(lineUserError('RICH_MENU', message), 'danger');
    } finally {
      setCreatingRichMenu(false);
    }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) {
      toast.show(t.errors.generic, 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.show(t.actions.copiedWebhook);
    } catch {
      toast.show(t.errors.generic, 'warning');
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectLineSettings();
      setSettings((current) => current ? {
        ...current,
        line: {
          ...current.line,
          channelId: '',
          channelSecret: '',
          channelAccessToken: '',
        },
      } : current);
      setChannelId('');
      setChannelSecret('');
      setAccessToken('');
      setWizard(createLineSetupWizard());
      setExpanded('CREDENTIALS');
      setConfirmDisconnect(false);
      toast.show(t.disconnect.done);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.show(
        `${t.disconnect.failed}${message ? lineUserError('GENERAL', message) : t.errors.generic}`,
        'danger',
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const runStep = (key: LineSetupStepKey) => {
    if (key === 'CREDENTIALS') {
      void runCredentials();
      return;
    }
    if (key === 'AUTO_REPLY') {
      confirmAutoReply();
      return;
    }
    if (VERIFY_STEP_KEYS.has(key)) void runVerify();
  };

  if (loading || !settings) {
    return (
      <>
        <PageHeader eyebrow={nav.navSystem} eyebrowHref={t.settingsHref} title={t.title} subtitle={t.subtitle} />
        <Card><CardBody className="py-10 text-center text-muted">{common.loading}</CardBody></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={nav.navSystem}
        eyebrowHref={t.settingsHref}
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Link className="btn btn-outline btn-sm" href={t.settingsHref}>
            <Link2 size={13} />
            {t.settingsLink}
          </Link>
        }
      />

      <Alert tone="info" className="mb-4" title={t.tenantOnlyNotice}>
        <p>{t.providerAcceptance}</p>
        <p className="mt-1">{settings.basic.tenantName}（{settings.basic.shopCode}）</p>
      </Alert>

      <Card className="mb-4">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>{wizard.ready ? t.readyTitle : t.notReadyTitle}</CardTitle>
            <FormText>{wizard.ready ? t.readyDescription : t.notReadyDescription}</FormText>
          </div>
          <Badge tone={wizard.ready ? 'success' : 'warning'}>
            {t.progressLabel(wizard.completedCount, wizard.steps.length)}
          </Badge>
        </CardHeader>
        <CardBody>
          <div
            className="h-2 overflow-hidden rounded-pill bg-neutral-200"
            role="progressbar"
            aria-label={t.progressLabel(wizard.completedCount, wizard.steps.length)}
            aria-valuemin={0}
            aria-valuemax={wizard.steps.length}
            aria-valuenow={wizard.completedCount}
          >
            <div className="h-full rounded-pill bg-primary transition-all" style={{ width: progressPercent + '%' }} />
          </div>
          <Button
            block
            className="mt-4 sm:w-auto"
            loading={runningAll}
            loadingText={t.runningChecks}
            disabled={!canRunSavedChecks}
            onClick={() => void runAllChecks()}
          >
            <RefreshCw size={14} />
            {t.runChecks}
          </Button>
          {!canRunSavedChecks ? (
            <FormText className="mt-2">
              {credentialsDirty ? t.credentials.saveBeforeTest : t.credentials.required}
            </FormText>
          ) : null}
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound size={17} />
            {t.credentials.title}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="mb-4 text-base text-neutral-700">{t.credentials.intro}</p>
          <div className="grid gap-x-4 md:grid-cols-2">
            <FormGroup>
              <Label required htmlFor="guide-line-channel-id">{t.credentials.channelId}</Label>
              <Input
                id="guide-line-channel-id"
                inputMode="numeric"
                autoComplete="off"
                value={channelId}
                placeholder={t.credentials.channelIdPlaceholder}
                onChange={(event) => setChannelId(event.target.value)}
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="guide-line-channel-secret">
                {t.credentials.channelSecret}
                {settings.line.channelSecret ? <span className="form-text ml-1">{t.credentials.stored}</span> : null}
              </Label>
              <Input
                id="guide-line-channel-secret"
                type="password"
                autoComplete="new-password"
                value={channelSecret}
                placeholder={settings.line.channelSecret ? settings.line.channelSecret : t.credentials.channelSecretPlaceholder}
                onChange={(event) => setChannelSecret(event.target.value)}
              />
            </FormGroup>
            <FormGroup className="md:col-span-2">
              <Label htmlFor="guide-line-access-token">
                {t.credentials.accessToken}
                {settings.line.channelAccessToken ? <span className="form-text ml-1">{t.credentials.stored}</span> : null}
              </Label>
              <Input
                id="guide-line-access-token"
                type="password"
                autoComplete="new-password"
                value={accessToken}
                placeholder={settings.line.channelAccessToken ? settings.line.channelAccessToken : t.credentials.accessTokenPlaceholder}
                onChange={(event) => setAccessToken(event.target.value)}
              />
              <FormText>{t.credentials.secretHint}</FormText>
            </FormGroup>
          </div>
          {formError ? <Alert tone="danger" className="mb-4">{formError}</Alert> : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              loading={testing}
              loadingText={t.credentials.testing}
              disabled={!canRunSavedChecks}
              onClick={() => void runCredentials()}
            >
              <ShieldCheck size={14} />
              {t.credentials.test}
            </Button>
            <Button loading={saving} loadingText={t.credentials.saving} onClick={() => void saveCredentials()}>
              <Save size={14} />
              {t.credentials.save}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck size={17} />
            {t.checksTitle}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <ol className="flex flex-col gap-3">
            {wizard.steps.map((step, index) => {
              const open = expanded === step.key;
              const stepCopy = t.steps[step.key];
              return (
                <li key={step.key} className="rounded-lg border border-neutral-200">
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 p-3 text-left"
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : step.key)}
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-pill bg-neutral-100 text-sm font-semibold text-secondary">
                      {index + 1}
                    </span>
                    <StatusIcon status={step.status} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold text-dark">{stepCopy.label}</span>
                      <span className="block truncate text-sm text-secondary">{step.title}</span>
                    </span>
                    <Badge tone={statusTone(step.status)}>{t.status[step.status]}</Badge>
                    <ChevronDown size={17} className={open ? 'rotate-180 text-secondary' : 'text-secondary'} aria-hidden />
                  </button>
                  {open ? (
                    <div className="border-t border-neutral-200 px-3 pb-4 pt-3 sm:px-4">
                      <p className="text-base text-neutral-700">{step.description}</p>
                      {step.key === 'WEBHOOK_URL' ? (
                        <div className="mt-3 rounded-md bg-neutral-50 p-3">
                          <FormText>{t.steps.WEBHOOK_URL.urlHint}</FormText>
                          <code className="mt-1 block break-all text-sm text-dark">{webhookUrl}</code>
                        </div>
                      ) : null}
                      {step.evidence ? (
                        <Badge tone="neutral" className="mt-3">
                          {t.evidence[step.evidence]}
                        </Badge>
                      ) : null}
                      {step.detail ? (
                        <details className="mt-3 rounded-md bg-neutral-50 p-3 text-sm text-secondary">
                          <summary className="cursor-pointer font-semibold">{t.actions.details}</summary>
                          <code className="mt-2 block break-all whitespace-pre-wrap">{step.detail}</code>
                        </details>
                      ) : null}
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {step.key === 'AUTO_REPLY' && step.status !== 'PASSED' ? (
                          <>
                            <Button variant="warning" size="sm" onClick={confirmAutoReply}>
                              {t.actions.confirmAutoReply}
                            </Button>
                            <a
                              className="btn btn-outline btn-sm"
                              href="https://manager.line.biz/"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink size={13} />
                              {t.actions.openLineManager}
                            </a>
                          </>
                        ) : null}
                        {step.key === 'RICH_MENU' ? (
                          <>
                            <Button
                              variant="success"
                              size="sm"
                              loading={creatingRichMenu}
                              loadingText={t.actions.creatingRichMenu}
                              disabled={!canRunSavedChecks || busy}
                              onClick={() => void publishRichMenu()}
                            >
                              {t.actions.createRichMenu}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              loading={verifying}
                              loadingText={t.runningChecks}
                              disabled={!canRunSavedChecks || busy}
                              onClick={() => void runVerify()}
                            >
                              {t.actions.retry}
                            </Button>
                          </>
                        ) : null}
                        {step.key !== 'AUTO_REPLY' && step.key !== 'RICH_MENU' && step.status !== 'BLOCKED' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            loading={step.key === 'CREDENTIALS' ? testing : verifying}
                            loadingText={step.key === 'CREDENTIALS' ? t.credentials.testing : t.runningChecks}
                            disabled={!canRunSavedChecks || busy}
                            onClick={() => runStep(step.key)}
                          >
                            <RefreshCw size={13} />
                            {t.actions.retry}
                          </Button>
                        ) : null}
                        {step.key === 'WEBHOOK_URL' ? (
                          <>
                            <Button variant="outline" size="sm" onClick={() => void copyWebhook()}>
                              <Copy size={13} />
                              {t.actions.copyWebhook}
                            </Button>
                            <a
                              className="btn btn-outline btn-sm"
                              href="https://manager.line.biz/"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink size={13} />
                              {t.actions.openLineManager}
                            </a>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>

      <Card className="border-danger">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger">
            <Unlink size={17} />
            {t.disconnect.title}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-base text-neutral-700">{t.disconnect.description}</p>
          <Button
            variant="outlineDanger"
            size="sm"
            className="mt-4"
            loading={disconnecting}
            loadingText={t.disconnect.processing}
            disabled={!hasSavedCredentials || busy}
            onClick={() => setConfirmDisconnect(true)}
          >
            <Unlink size={13} />
            {t.disconnect.action}
          </Button>
        </CardBody>
      </Card>

      <ConfirmModal
        open={confirmDisconnect}
        danger
        loading={disconnecting}
        title={t.disconnect.confirmTitle}
        confirmText={t.disconnect.action}
        message={t.disconnect.confirmMessage}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => void disconnect()}
      />
    </>
  );
}
