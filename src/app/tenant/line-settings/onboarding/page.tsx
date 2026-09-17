'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardCopy, Eye, EyeOff,
  ExternalLink, Grid3x3, MessageSquareText, PlugZap, Sparkles,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { FormGroup, FormText, Input, Label } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  getTenantSettings, saveLineSettings, syncLineWebhook, verifyLineSetup,
} from '@/services/settings';
import { buildWebhookUrl, maskSecret } from '@/config/tenant-settings';
import type { TenantSettings } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { lineSetupWizardPage as t } from '@/i18n/zh-TW/line-setup-wizard';
import {
  WIZARD_STEP_KEYS, allVerifiableChecksPassed, canAdvanceFromStep, credentialsConfigured,
  deriveStartingStep, stepStatus,
  type VerifyCheck, type WizardStepKey,
} from '@/lib/line-setup-wizard';

const CHANNEL_SECRET_LENGTH = 32;
const ACCESS_TOKEN_MIN_LENGTH = 100;
const isUrlLike = (v: string) => /^https?:\/\//i.test(v.trim());

const ACK_STORAGE_KEY = 'line-setup-wizard.autoReplyAck';

/** localStorage 是每個瀏覽器各自的、非權威的便利記憶——僅用於「這台瀏覽器上
 * 使用者是否已勾過確認」的 UI 便利性，絕不是任何步驟是否算「通過」的依據
 * （通過與否只看 verify 的真實 checks）。讀寫都包 try/catch，失敗就當沒勾過。 */
function readAckFromStorage(): boolean {
  try {
    return window.localStorage.getItem(ACK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
function writeAckToStorage(value: boolean) {
  try {
    if (value) window.localStorage.setItem(ACK_STORAGE_KEY, '1');
    else window.localStorage.removeItem(ACK_STORAGE_KEY);
  } catch {
    /* 私密瀏覽模式等情境下讀寫會丟例外，忽略即可——不影響精靈本身的正確性 */
  }
}

function StepStatusBadge({ status }: { status: 'NOT_CHECKED' | 'PASS' | 'FAIL' | 'INFO' }) {
  if (status === 'PASS') return <Badge tone="success">{t.stepStatus.pass}</Badge>;
  if (status === 'FAIL') return <Badge tone="danger">{t.stepStatus.fail}</Badge>;
  if (status === 'INFO') return <Badge tone="info">{t.stepStatus.info}</Badge>;
  return <Badge tone="neutral">{t.stepStatus.notChecked}</Badge>;
}

export default function LineSetupWizardPage() {
  const toast = useToast();

  const [loading, setLoading] = React.useState(true);
  const [settings, setSettings] = React.useState<TenantSettings | null>(null);
  const [step, setStep] = React.useState<WizardStepKey>('CREDENTIALS_INPUT');

  /* --- 步驟一：憑證表單（沿用既有 LINE 設定頁的「重新輸入」語意，見該頁檔頭） --- */
  const [channelId, setChannelId] = React.useState('');
  const [secretEditing, setSecretEditing] = React.useState(false);
  const [secretInput, setSecretInput] = React.useState('');
  const [secretVisible, setSecretVisible] = React.useState(false);
  const [tokenEditing, setTokenEditing] = React.useState(false);
  const [tokenInput, setTokenInput] = React.useState('');
  const [tokenVisible, setTokenVisible] = React.useState(false);
  const [savingCredentials, setSavingCredentials] = React.useState(false);

  /* --- verify 結果：單一真相來源，步驟二～五都讀同一份 --- */
  const [checks, setChecks] = React.useState<VerifyCheck[] | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [syncingWebhook, setSyncingWebhook] = React.useState(false);

  const [autoReplyAck, setAutoReplyAck] = React.useState(false);

  const shopCode = settings?.basic.shopCode ?? '';
  const webhookUrl = settings
    ? settings.line.webhookUrl || buildWebhookUrl(APP_URL, shopCode)
    : '';

  const presence = React.useMemo(
    () => ({
      channelId: !!channelId,
      channelSecret: secretEditing ? !!secretInput : !!settings?.line.channelSecret,
      channelAccessToken: tokenEditing ? !!tokenInput : !!settings?.line.channelAccessToken,
    }),
    [channelId, secretEditing, secretInput, tokenEditing, tokenInput, settings],
  );

  const runVerify = React.useCallback(async (): Promise<VerifyCheck[] | null> => {
    setVerifying(true);
    try {
      const res = await verifyLineSetup();
      setChecks(res.checks);
      return res.checks;
    } catch (e) {
      toast.show(
        `${t.messages.verifyFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
      return null;
    } finally {
      setVerifying(false);
    }
  }, [toast]);

  /* ------------------------------------------------------------------ 載入 */
  React.useEffect(() => {
    void (async () => {
      try {
        const s = await getTenantSettings();
        setSettings(s);
        setChannelId(s.line.channelId);
        setAutoReplyAck(readAckFromStorage());

        const configured = credentialsConfigured({
          channelId: !!s.line.channelId,
          channelSecret: !!s.line.channelSecret,
          channelAccessToken: !!s.line.channelAccessToken,
        });

        if (configured) {
          // 🔑 用真實 provider 狀態重建進度，不是只讀 React state 或猜測。
          const realChecks = await runVerify();
          setStep(deriveStartingStep(
            { channelId: true, channelSecret: true, channelAccessToken: true },
            realChecks,
          ));
        } else {
          setStep('CREDENTIALS_INPUT');
        }
      } catch (e) {
        toast.show(
          `${t.messages.loadFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
          'danger',
        );
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------------------------- 衍生值 */
  const channelIdWarning = (() => {
    if (!channelId) return '';
    if (isUrlLike(channelId)) return t.credentials.channelIdIsUrl;
    if (!/^\d+$/.test(channelId)) return t.credentials.channelIdNotNumber;
    return '';
  })();
  const secretWarning = (() => {
    if (!secretEditing || !secretInput) return '';
    if (isUrlLike(secretInput)) return t.credentials.channelSecretIsUrl;
    if (secretInput.length < CHANNEL_SECRET_LENGTH) return t.credentials.channelSecretTooShort(secretInput.length);
    return '';
  })();
  const tokenWarning = (() => {
    if (!tokenEditing || !tokenInput) return '';
    if (isUrlLike(tokenInput)) return t.credentials.channelAccessTokenIsUrl;
    if (tokenInput.length < ACCESS_TOKEN_MIN_LENGTH) return t.credentials.channelAccessTokenTooShort(tokenInput.length);
    return '';
  })();

  const checkByKey = (key: string) => checks?.find((c) => c.key === key) ?? null;

  const copy = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.show(t.messages.copied);
    } catch {
      toast.show(t.messages.copyFailed, 'warning');
    }
  };

  /* -------------------------------------------------------------- 動作 */
  const saveCredentials = async () => {
    if (!channelId.trim()) {
      toast.show(t.credentials.channelIdRequired, 'warning');
      return;
    }
    setSavingCredentials(true);
    try {
      await saveLineSettings({
        channelId: channelId.trim(),
        channelSecret: secretEditing ? secretInput.trim() : '',
        channelAccessToken: tokenEditing ? tokenInput.trim() : '',
      });
      setSettings((s) => (s ? {
        ...s,
        line: {
          ...s.line,
          channelId: channelId.trim(),
          channelSecret: secretEditing ? maskSecret(secretInput.trim()) : s.line.channelSecret,
          channelAccessToken: tokenEditing ? maskSecret(tokenInput.trim()) : s.line.channelAccessToken,
        },
      } : s));
      setSecretEditing(false);
      setSecretInput('');
      setSecretVisible(false);
      setTokenEditing(false);
      setTokenInput('');
      setTokenVisible(false);
      toast.show(t.credentials.saved);
      const realChecks = await runVerify();
      setStep(deriveStartingStep(
        { channelId: true, channelSecret: true, channelAccessToken: true },
        realChecks,
      ));
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSavingCredentials(false);
    }
  };

  const fixWebhook = async () => {
    setSyncingWebhook(true);
    try {
      const res = await syncLineWebhook();
      if (res.synced) {
        toast.show(t.botWebhook.fixSucceeded);
        await runVerify();
      } else {
        toast.show(`${t.botWebhook.fixFailedPrefix}${res.message}`, 'danger');
      }
    } catch (e) {
      toast.show(
        `${t.botWebhook.fixFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSyncingWebhook(false);
    }
  };

  const goNext = () => {
    const idx = WIZARD_STEP_KEYS.indexOf(step);
    if (idx < WIZARD_STEP_KEYS.length - 1) setStep(WIZARD_STEP_KEYS[idx + 1]);
  };
  const goPrev = () => {
    const idx = WIZARD_STEP_KEYS.indexOf(step);
    if (idx > 0) setStep(WIZARD_STEP_KEYS[idx - 1]);
  };

  const toggleAck = (value: boolean) => {
    setAutoReplyAck(value);
    writeAckToStorage(value);
  };

  /* -------------------------------------------------------------- render */
  if (loading || !settings) {
    return (
      <>
        <PageHeader eyebrow={nav.navSystem} title={t.title} />
        <Card>
          <CardBody className="py-10 text-center text-muted">{common.loading}</CardBody>
        </Card>
      </>
    );
  }

  const currentIndex = WIZARD_STEP_KEYS.indexOf(step);

  return (
    <>
      <PageHeader
        eyebrow={nav.navSystem}
        title={t.title}
        actions={
          <Link className="btn btn-outline btn-sm" href="/tenant/line-settings">
            {t.backToLineSettings}
          </Link>
        }
      />

      <p className="mb-4 text-base text-neutral-700">{t.subtitle}</p>

      {/* ---------------------------------------------------------- 進度條 */}
      <div className="mb-4 flex flex-wrap gap-2 overflow-x-auto">
        {WIZARD_STEP_KEYS.map((key, i) => (
          <div
            key={key}
            data-active={key === step}
            className="flex items-center gap-1 whitespace-nowrap rounded-pill border border-neutral-250 px-3 py-1 text-2xs text-secondary data-[active=true]:border-primary data-[active=true]:bg-primary-50 data-[active=true]:text-primary data-[active=true]:font-semibold"
          >
            {i < currentIndex ? <CheckCircle2 size={12} className="text-success" /> : null}
            {t.steps[key]}
          </div>
        ))}
      </div>

      {/* ======================================================= 步驟一 */}
      {step === 'CREDENTIALS_INPUT' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlugZap size={16} />
              {t.credentials.title}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Alert tone="info" className="mb-4 text-xs">{t.credentials.intro}</Alert>
            <div className="mb-4 flex flex-wrap gap-2">
              <a className="btn btn-outline btn-sm" href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} />
                {t.credentials.helpLinks.manager}
              </a>
              <a className="btn btn-outline btn-sm" href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer">
                <ExternalLink size={13} />
                {t.credentials.helpLinks.developers}
              </a>
            </div>

            {settings.line.channelId ? (
              <Alert tone="neutral" className="mb-4 text-xs">{t.credentials.alreadyConfiguredHint}</Alert>
            ) : null}

            <FormGroup>
              <Label required htmlFor="wizChannelId">{t.credentials.channelId}</Label>
              <Input
                id="wizChannelId"
                inputMode="numeric"
                value={channelId}
                placeholder={t.credentials.channelIdPlaceholder}
                onChange={(e) => setChannelId(e.target.value)}
              />
              <FormText>{t.credentials.channelIdHelp}</FormText>
              {channelIdWarning ? <Alert tone="danger" className="mt-2 text-xs">{channelIdWarning}</Alert> : null}
            </FormGroup>

            <FormGroup>
              <Label required htmlFor="wizSecret">{t.credentials.channelSecret}</Label>
              <div className="flex items-stretch gap-2">
                {secretEditing ? (
                  <Input
                    id="wizSecret"
                    type={secretVisible ? 'text' : 'password'}
                    autoComplete="off"
                    value={secretInput}
                    placeholder={t.credentials.channelSecretPlaceholder}
                    onChange={(e) => setSecretInput(e.target.value)}
                  />
                ) : (
                  <Input
                    id="wizSecret"
                    readOnly
                    value={maskSecret(settings.line.channelSecret)}
                    placeholder={t.credentials.secretMaskedPlaceholder}
                  />
                )}
                {secretEditing ? (
                  <>
                    <Button
                      variant="outline"
                      aria-label={secretVisible ? t.credentials.secretHide : t.credentials.secretShow}
                      onClick={() => setSecretVisible((v) => !v)}
                    >
                      {secretVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </Button>
                    <Button variant="secondary" onClick={() => { setSecretEditing(false); setSecretInput(''); }}>
                      {t.credentials.secretCancelReenter}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setSecretEditing(true)}>
                    {t.credentials.secretReenter}
                  </Button>
                )}
              </div>
              <FormText>{t.credentials.channelSecretHelp}</FormText>
              {secretWarning ? <Alert tone="danger" className="mt-2 text-xs">{secretWarning}</Alert> : null}
            </FormGroup>

            <FormGroup>
              <Label required htmlFor="wizToken">{t.credentials.channelAccessToken}</Label>
              <div className="flex items-stretch gap-2">
                {tokenEditing ? (
                  <Input
                    id="wizToken"
                    type={tokenVisible ? 'text' : 'password'}
                    autoComplete="off"
                    value={tokenInput}
                    placeholder={t.credentials.channelAccessTokenPlaceholder}
                    onChange={(e) => setTokenInput(e.target.value)}
                  />
                ) : (
                  <Input
                    id="wizToken"
                    readOnly
                    value={maskSecret(settings.line.channelAccessToken)}
                    placeholder={t.credentials.secretMaskedPlaceholder}
                  />
                )}
                {tokenEditing ? (
                  <>
                    <Button
                      variant="outline"
                      aria-label={tokenVisible ? t.credentials.secretHide : t.credentials.secretShow}
                      onClick={() => setTokenVisible((v) => !v)}
                    >
                      {tokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </Button>
                    <Button variant="secondary" onClick={() => { setTokenEditing(false); setTokenInput(''); }}>
                      {t.credentials.secretCancelReenter}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setTokenEditing(true)}>
                    {t.credentials.secretReenter}
                  </Button>
                )}
              </div>
              <FormText>{t.credentials.channelAccessTokenHelp}</FormText>
              {tokenWarning ? <Alert tone="danger" className="mt-2 text-xs">{tokenWarning}</Alert> : null}
            </FormGroup>

            <div className="flex justify-end">
              <Button loading={savingCredentials} loadingText={t.credentials.saving} onClick={() => void saveCredentials()}>
                {t.credentials.save}
                <ArrowRight size={14} />
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ======================================================= 步驟二 */}
      {step === 'CONNECTION' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlugZap size={16} />
              {t.connection.title}
              <StepStatusBadge status={stepStatus('CONNECTION', checks)} />
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Alert tone="info" className="mb-3 text-xs">
              {t.connection.intro}
              <ul className="ml-4 mt-1 list-disc">
                {t.connection.items.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </Alert>

            <div className="mb-3 flex flex-col gap-2">
              {(['CREDENTIALS', 'TOKEN', 'ID_SECRET_PAIR'] as const).map((key) => {
                const c = checkByKey(key);
                return (
                  <div key={key} className="flex items-start gap-2 rounded-md border border-neutral-250 px-3 py-2">
                    {c?.status === 'PASS' ? (
                      <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-success" />
                    ) : (
                      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-danger" />
                    )}
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-dark">{t.connection.checkNames[key]}</div>
                      <div className="form-text">{c?.message ?? t.stepStatus.notChecked}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button variant="outline" size="sm" loading={verifying} loadingText={t.connection.checking} onClick={() => void runVerify()}>
              {t.nav.retryCheck}
            </Button>

            <div className="mt-4 flex justify-between">
              <Button variant="secondary" onClick={goPrev}>
                <ArrowLeft size={14} />
                {t.nav.prev}
              </Button>
              <Button disabled={!canAdvanceFromStep('CONNECTION', checks)} onClick={goNext}>
                {t.nav.next}
                <ArrowRight size={14} />
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ======================================================= 步驟三 */}
      {step === 'BOT_MODE_WEBHOOK' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText size={16} />
              {t.botWebhook.title}
              <StepStatusBadge status={stepStatus('BOT_MODE_WEBHOOK', checks)} />
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Alert tone="info" className="mb-3 text-xs">{t.botWebhook.intro}</Alert>

            <div className="mb-3 flex flex-col gap-2">
              {(['BOT_MODE', 'WEBHOOK'] as const).map((key) => {
                const c = checkByKey(key);
                return (
                  <div key={key} className="rounded-md border border-neutral-250 px-3 py-2">
                    <div className="flex items-start gap-2">
                      {c?.status === 'PASS' ? (
                        <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-success" />
                      ) : (
                        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-danger" />
                      )}
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-dark">{t.botWebhook.checkNames[key]}</div>
                        <div className="form-text">{c?.message ?? t.stepStatus.notChecked}</div>
                      </div>
                    </div>
                    {c?.status === 'FAIL' && key === 'BOT_MODE' ? (
                      <Alert tone="warning" className="mt-2 text-xs">{t.botWebhook.botModeFailHint}</Alert>
                    ) : null}
                    {c?.status === 'FAIL' && key === 'WEBHOOK' ? (
                      <div className="mt-2">
                        <Alert tone="warning" className="mb-2 text-xs">{t.botWebhook.webhookFailHint}</Alert>
                        <div className="mb-2 flex items-stretch gap-2">
                          <Input readOnly value={webhookUrl} aria-label={t.botWebhook.webhookUrlLabel} />
                          <Button variant="outline" size="sm" onClick={() => void copy(webhookUrl)}>
                            <ClipboardCopy size={13} />
                            {t.botWebhook.copyWebhookUrl}
                          </Button>
                        </div>
                        <Button
                          variant="success"
                          size="sm"
                          loading={syncingWebhook}
                          loadingText={t.botWebhook.fixing}
                          onClick={() => void fixWebhook()}
                        >
                          {t.botWebhook.fixWebhook}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <Button variant="outline" size="sm" loading={verifying} loadingText={t.botWebhook.checking} onClick={() => void runVerify()}>
              {t.botWebhook.recheck}
            </Button>

            <div className="mt-4 flex justify-between">
              <Button variant="secondary" onClick={goPrev}>
                <ArrowLeft size={14} />
                {t.nav.prev}
              </Button>
              <Button disabled={!canAdvanceFromStep('BOT_MODE_WEBHOOK', checks)} onClick={goNext}>
                {t.nav.next}
                <ArrowRight size={14} />
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ======================================================= 步驟四 */}
      {step === 'WEBHOOK_TEST' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlugZap size={16} />
              {t.webhookTest.title}
              <StepStatusBadge status={stepStatus('WEBHOOK_TEST', checks)} />
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Alert tone="info" className="mb-3 text-xs">{t.webhookTest.intro}</Alert>

            {(() => {
              const c = checkByKey('WEBHOOK_TEST');
              return (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-neutral-250 px-3 py-2">
                  {c?.status === 'PASS' ? (
                    <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-success" />
                  ) : (
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-danger" />
                  )}
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-dark">{t.webhookTest.checkName}</div>
                    <div className="form-text">{c?.message ?? t.stepStatus.notChecked}</div>
                    {c?.status === 'PASS' ? (
                      <div className="form-text mt-1">{t.webhookTest.passMessage}</div>
                    ) : c?.status === 'FAIL' ? (
                      <div className="form-text mt-1">{t.webhookTest.failHint}</div>
                    ) : null}
                  </div>
                </div>
              );
            })()}

            <Button variant="outline" size="sm" loading={verifying} loadingText={t.webhookTest.testing} onClick={() => void runVerify()}>
              {t.webhookTest.runTest}
            </Button>

            <div className="mt-4 flex justify-between">
              <Button variant="secondary" onClick={goPrev}>
                <ArrowLeft size={14} />
                {t.nav.prev}
              </Button>
              <Button disabled={!canAdvanceFromStep('WEBHOOK_TEST', checks)} onClick={goNext}>
                {t.nav.next}
                <ArrowRight size={14} />
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ======================================================= 步驟五 */}
      {step === 'AUTO_REPLY_CONFIRM' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle size={16} />
              {t.autoReplyConfirm.title}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <Alert tone="info" title={t.autoReplyConfirm.infoTitle}>
              <p className="mt-1">{t.autoReplyConfirm.infoBody}</p>
              <ol className="ml-4 mt-2 list-decimal">
                {t.autoReplyConfirm.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
              <p className="mt-2 font-semibold">{t.autoReplyConfirm.whyItMatters}</p>
              <a
                className="btn btn-outline btn-sm mt-2"
                href="https://manager.line.biz/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={13} />
                {t.autoReplyConfirm.cta}
              </a>
            </Alert>

            <label className="mt-4 flex items-start gap-2 text-base text-neutral-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={autoReplyAck}
                onChange={(e) => toggleAck(e.target.checked)}
              />
              <span>{t.autoReplyConfirm.ackLabel}</span>
            </label>
            <FormText>{t.autoReplyConfirm.ackHint}</FormText>

            <div className="mt-4 flex justify-between">
              <Button variant="secondary" onClick={goPrev}>
                <ArrowLeft size={14} />
                {t.nav.prev}
              </Button>
              <Button onClick={goNext}>
                {t.nav.goToCapabilities}
                <ArrowRight size={14} />
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ======================================================= 步驟六 */}
      {step === 'CAPABILITIES' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles size={16} />
              {t.capabilities.title}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-base text-neutral-700">{t.capabilities.intro}</p>

            <div className="flex flex-col gap-3">
              <div className="rounded-md border border-neutral-250 p-3">
                <div className="flex items-center gap-2">
                  <Grid3x3 size={15} />
                  <span className="text-base font-semibold text-dark">{t.capabilities.richMenu.title}</span>
                  <Badge tone="success">{t.capabilities.richMenu.available}</Badge>
                </div>
                <div className="form-text mt-1">
                  {settings.line.richMenuBgImageUrl || settings.line.richMenuTheme !== 'LINE_GREEN'
                    ? t.capabilities.richMenu.configured
                    : t.capabilities.richMenu.notConfigured}
                </div>
                <Link className="btn btn-outline btn-sm mt-2" href="/tenant/line-settings">
                  {t.capabilities.richMenu.cta}
                </Link>
              </div>

              <div className="rounded-md border border-neutral-250 p-3">
                <div className="flex items-center gap-2">
                  <MessageSquareText size={15} />
                  <span className="text-base font-semibold text-dark">{t.capabilities.flexMenu.title}</span>
                  <Badge tone="success">{t.capabilities.flexMenu.available}</Badge>
                </div>
                <div className="form-text mt-1">
                  {settings.line.flexMenuEnabled ? t.capabilities.flexMenu.enabled : t.capabilities.flexMenu.disabled}
                </div>
                <Link className="btn btn-outline btn-sm mt-2" href="/tenant/line-settings">
                  {t.capabilities.flexMenu.cta}
                </Link>
              </div>

              <div className="rounded-md border border-dashed border-neutral-250 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-dark">{t.capabilities.testMessage.title}</span>
                  <Badge tone="neutral">{t.capabilities.testMessage.notReadyTitle}</Badge>
                </div>
                <div className="form-text mt-1">{t.capabilities.testMessage.notReadyBody}</div>
              </div>

              <div className="rounded-md border border-neutral-250 p-3">
                <div className="text-base font-semibold text-dark">{t.capabilities.notificationLedger.title}</div>
                <div className="form-text mt-1">{t.capabilities.notificationLedger.body}</div>
                <Link className="btn btn-outline btn-sm mt-2" href="/tenant/line-settings">
                  {t.capabilities.notificationLedger.cta}
                </Link>
              </div>
            </div>

            <div className="mt-4 flex justify-between">
              <Button variant="secondary" onClick={goPrev}>
                <ArrowLeft size={14} />
                {t.nav.prev}
              </Button>
              <Button onClick={goNext}>
                {t.nav.next}
                <ArrowRight size={14} />
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* ======================================================= 步驟七 */}
      {step === 'DONE' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-success" />
              {t.done.title}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-base text-neutral-700">{t.done.intro}</p>

            <div className="mb-3">
              <div className="mb-1 text-base font-semibold text-dark">{t.done.workingTitle}</div>
              <ul className="ml-4 list-disc text-base text-neutral-700">
                {(checks ?? [])
                  .filter((c) => c.status === 'PASS')
                  .map((c) => <li key={c.key}>{c.message}</li>)}
              </ul>
              {!allVerifiableChecksPassed(checks) ? (
                <Alert tone="warning" className="mt-2 text-xs">
                  {(checks ?? []).filter((c) => c.status === 'FAIL').map((c) => c.message).join('；')}
                </Alert>
              ) : null}
            </div>

            <div className="mb-3">
              <div className="mb-1 text-base font-semibold text-dark">{t.done.manualTitle}</div>
              <ul className="ml-4 list-disc text-base text-neutral-700">
                <li>{t.done.manualItem}{autoReplyAck ? t.done.manualItemAcked : ''}</li>
              </ul>
            </div>

            <div className="mb-4">
              <div className="mb-1 text-base font-semibold text-dark">{t.done.deferredTitle}</div>
              <ul className="ml-4 list-disc text-base text-neutral-700">
                <li>{t.done.deferredItem}</li>
              </ul>
            </div>

            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="secondary" onClick={() => setStep('CREDENTIALS_INPUT')}>
                {t.done.runAgain}
              </Button>
              <Link className="btn btn-primary" href="/tenant/line-settings">
                {t.done.backToSettings}
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
