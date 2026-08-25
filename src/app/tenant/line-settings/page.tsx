'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, CheckCircle2, ClipboardCheck, ClipboardCopy, Eye, EyeOff,
  ExternalLink, Grid3x3, Images, Link2, MessageSquareText, Megaphone, Palette, Plug,
  QrCode, HelpCircle, Reply, RotateCcw, Save, Unlink, UserPlus, XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  CharCounter, FormGroup, FormText, Input, Label, SwitchField, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import {
  getTenantSettings, saveLineSettings, testLineConnection, verifyLineSetup,
} from '@/services/settings';
import { buildWebhookUrl, lineSettingsSchema, maskSecret } from '@/config/tenant-settings';
import type { LineSettings, TenantSettings } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { common } from '@/i18n/zh-TW/common';
import { cn } from '@/lib/utils';
import { nav } from '@/i18n/zh-TW/nav';
import { lineSettingsPage as t } from '@/i18n/zh-TW/pages/line-settings';

/* -------------------------------------------------------------------------- */
/* 常數                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Rich Menu 主題配色 / 文字顏色。
 * ⚠️ 這些 hex 不是「設計 token」，而是要存進 tenant_settings 的**資料值**
 *    （richMenuTheme / richMenuTextColor，見 src/config/tenant-settings.ts），
 *    是 LINE 官方選單底圖的配色，與本後台的佈景無關，因此不走 Tailwind token。
 */
/** BOUTIQUE 是進階主題（選單設計頁才開放，見 rich-menu-design.ts），這裡的快速
 *  預覽只收原本 5 色，故排除它以免多一個沒有 i18n 文案的鍵。 */
const THEME_PRESETS: { key: Exclude<LineSettings['richMenuTheme'], 'BOUTIQUE'>; swatch: string }[] = [
  { key: 'LINE_GREEN', swatch: '#06C755' },
  { key: 'OCEAN_BLUE', swatch: '#1E88E5' },
  { key: 'ROYAL_PURPLE', swatch: '#7E57C2' },
  { key: 'SUNSET_ORANGE', swatch: '#FB8C00' },
  { key: 'DARK', swatch: '#263238' },
];

const TEXT_COLOR_PRESETS: { key: keyof typeof t.richMenu.textColors; value: string }[] = [
  { key: 'white', value: '#FFFFFF' },
  { key: 'black', value: '#000000' },
  { key: 'gold', value: '#F5C518' },
  { key: 'pink', value: '#FF80AB' },
  { key: 'skyblue', value: '#4FC3F7' },
];

/** LINE 設定的 schema 預設值（「恢復預設」與初始 state 用），不在頁面重寫顏色字面值 */
const LINE_DEFAULTS = lineSettingsSchema.parse({});

const CHANNEL_SECRET_LENGTH = 32;
const ACCESS_TOKEN_MIN_LENGTH = 100;

const isUrlLike = (v: string) => /^https?:\/\//i.test(v.trim());

/** severity 省略時視為 FAIL（後端未帶 = 舊行為） */
type VerifyCheck = { key: string; pass: boolean; message: string; severity?: 'FAIL' | 'WARN' };

/* -------------------------------------------------------------------------- */

export default function LineSettingsPage() {
  const toast = useToast();

  const [loading, setLoading] = React.useState(true);
  const [settings, setSettings] = React.useState<TenantSettings | null>(null);

  /* --- 表單 draft（非密文欄位可直接編輯） --- */
  const [channelId, setChannelId] = React.useState('');
  const [lineBasicId, setLineBasicId] = React.useState('');

  /**
   * 🔐 Channel Secret / Access Token 的「不變更」語意
   * ---------------------------------------------------------------------------
   * getTenantSettings() 回來的密文欄位已經是遮罩字串（明文永遠不離開伺服器，
   * 見 src/services/settings.ts 與 tenant-settings 的 SECRET_FIELDS）。
   *
   *   1. 預設狀態：欄位是唯讀的，顯示 maskSecret(已存值)。
   *      maskSecret 對已遮罩的字串是冪等的（頭 4 尾 4 不變），所以再遮一次仍安全。
   *   2. 使用者按「重新輸入」→ 切成空白、可編輯的欄位，開始輸入新的明文。
   *   3. 儲存時：沒按「重新輸入」就送 **空字串**，後端把空字串解讀為「不變更」；
   *      有重新輸入才送新明文，由後端用 SETTINGS_ENCRYPTION_KEY 加密後覆蓋。
   */
  const [secretEditing, setSecretEditing] = React.useState(false);
  const [secretInput, setSecretInput] = React.useState('');
  const [secretVisible, setSecretVisible] = React.useState(false);
  const [tokenEditing, setTokenEditing] = React.useState(false);
  const [tokenInput, setTokenInput] = React.useState('');
  const [tokenVisible, setTokenVisible] = React.useState(false);

  /* --- 其他區塊 --- */
  const [autoReplyEnabled, setAutoReplyEnabled] = React.useState(true);
  const [defaultReply, setDefaultReply] = React.useState('');

  const [flexMenuEnabled, setFlexMenuEnabled] = React.useState(true);
  const [flexMenuFallback, setFlexMenuFallback] =
    React.useState<LineSettings['flexMenuFallback']>('HINT');
  const [flexHeaderColor, setFlexHeaderColor] = React.useState(LINE_DEFAULTS.flexHeaderColor);
  const [flexHeaderTitle, setFlexHeaderTitle] = React.useState('');
  const [flexHeaderSubtitle, setFlexHeaderSubtitle] = React.useState('');
  const [flexShowTip, setFlexShowTip] = React.useState(true);
  const [campaignKeywordEnabled, setCampaignKeywordEnabled] = React.useState(true);

  const [richMenuTheme, setRichMenuTheme] =
    React.useState<LineSettings['richMenuTheme']>('LINE_GREEN');
  const [richMenuBgImageUrl, setRichMenuBgImageUrl] = React.useState('');
  const [richMenuNoOverlay, setRichMenuNoOverlay] = React.useState(false);
  const [richMenuTextColor, setRichMenuTextColor] = React.useState(LINE_DEFAULTS.richMenuTextColor);
  const [richMenuPublished, setRichMenuPublished] = React.useState(false);

  /* --- 忙碌狀態 --- */
  const [savingLine, setSavingLine] = React.useState(false);
  const [savingAutoReply, setSavingAutoReply] = React.useState(false);
  const [savingFlex, setSavingFlex] = React.useState(false);
  const [creatingRichMenu, setCreatingRichMenu] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);

  /* --- modal --- */
  const [tutorialOpen, setTutorialOpen] = React.useState(false);
  const [verifyChecks, setVerifyChecks] = React.useState<VerifyCheck[] | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);

  /* ------------------------------------------------------------------ 載入 */

  const applySettings = React.useCallback((s: TenantSettings) => {
    setSettings(s);
    setChannelId(s.line.channelId);
    setLineBasicId(s.line.lineBasicId);
    setAutoReplyEnabled(s.line.autoReplyEnabled);
    setDefaultReply(s.line.defaultReply);
    setFlexMenuEnabled(s.line.flexMenuEnabled);
    setFlexMenuFallback(s.line.flexMenuFallback);
    setFlexHeaderColor(s.line.flexHeaderColor);
    setFlexHeaderTitle(s.line.flexHeaderTitle);
    setFlexHeaderSubtitle(s.line.flexHeaderSubtitle);
    setFlexShowTip(s.line.flexShowTip);
    setCampaignKeywordEnabled(s.line.campaignKeywordEnabled);
    setRichMenuTheme(s.line.richMenuTheme);
    setRichMenuBgImageUrl(s.line.richMenuBgImageUrl);
    setRichMenuNoOverlay(s.line.richMenuNoOverlay);
    setRichMenuTextColor(s.line.richMenuTextColor);
    /* 密文欄位一律回到「不變更」狀態 */
    setSecretEditing(false);
    setSecretInput('');
    setTokenEditing(false);
    setTokenInput('');
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        applySettings(await getTenantSettings());
      } catch (e) {
        toast.show(
          `${t.messages.loadFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
          'danger',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [applySettings, toast]);

  /* -------------------------------------------------------------- 衍生值 */

  const shopCode = settings?.basic.shopCode ?? '';
  const webhookUrl = settings
    ? settings.line.webhookUrl || buildWebhookUrl(APP_URL, shopCode)
    : '';
  const addFriendUrl = lineBasicId
    ? `https://line.me/R/ti/p/${encodeURIComponent(lineBasicId)}`
    : '';

  /** 三組金鑰都在（密文以「已存有遮罩值」或「本次重新輸入」判定）就視為已設定 */
  const hasSecret = secretEditing ? !!secretInput : !!settings?.line.channelSecret;
  const hasToken = tokenEditing ? !!tokenInput : !!settings?.line.channelAccessToken;
  const configured = !!channelId && hasSecret && hasToken;

  const channelIdWarning = (() => {
    if (!channelId) return '';
    if (isUrlLike(channelId)) return t.form.channelIdIsUrl;
    if (!/^\d+$/.test(channelId)) return t.form.channelIdNotNumber;
    return '';
  })();

  const secretWarning = (() => {
    if (!secretEditing || !secretInput) return '';
    if (isUrlLike(secretInput)) return t.form.channelSecretIsUrl;
    if (secretInput.length < CHANNEL_SECRET_LENGTH) {
      return t.form.channelSecretTooShort(secretInput.length);
    }
    return '';
  })();

  const tokenWarning = (() => {
    if (!tokenEditing || !tokenInput) return '';
    if (isUrlLike(tokenInput)) return t.form.channelAccessTokenIsUrl;
    if (tokenInput.length < ACCESS_TOKEN_MIN_LENGTH) {
      return t.form.channelAccessTokenTooShort(tokenInput.length);
    }
    return '';
  })();

  /* -------------------------------------------------------------- 動作 */

  const copy = async (text: string, message: string) => {
    if (!text) {
      toast.show(t.form.webhookEmpty, 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.show(message);
    } catch {
      toast.show(t.messages.copyFailed, 'warning');
    }
  };

  const patchLocalLine = (patch: Partial<LineSettings>) =>
    setSettings((s) => (s ? { ...s, line: { ...s.line, ...patch } } : s));

  const saveLine = async () => {
    if (!channelId.trim()) {
      toast.show(t.form.channelIdRequired, 'warning');
      return;
    }
    setSavingLine(true);
    try {
      /* 🔐 沒重新輸入 → 送空字串＝不變更；重新輸入 → 送新明文由後端加密覆蓋 */
      const patch: Partial<LineSettings> = {
        channelId: channelId.trim(),
        channelSecret: secretEditing ? secretInput.trim() : '',
        channelAccessToken: tokenEditing ? tokenInput.trim() : '',
        lineBasicId: lineBasicId.trim(),
      };
      await saveLineSettings(patch);
      /* 存完立刻回到遮罩狀態：新明文不留在畫面上 */
      patchLocalLine({
        channelId: patch.channelId,
        lineBasicId: patch.lineBasicId,
        channelSecret: secretEditing
          ? maskSecret(secretInput.trim())
          : settings?.line.channelSecret ?? '',
        channelAccessToken: tokenEditing
          ? maskSecret(tokenInput.trim())
          : settings?.line.channelAccessToken ?? '',
      });
      setSecretEditing(false);
      setSecretInput('');
      setSecretVisible(false);
      setTokenEditing(false);
      setTokenInput('');
      setTokenVisible(false);
      toast.show(t.form.saved);
    } catch (e) {
      toast.show(
        `${t.form.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSavingLine(false);
    }
  };

  const saveAutoReply = async () => {
    setSavingAutoReply(true);
    try {
      await saveLineSettings({ autoReplyEnabled, defaultReply });
      patchLocalLine({ autoReplyEnabled, defaultReply });
      toast.show(t.autoReply.saved);
    } catch (e) {
      toast.show(
        `${t.form.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSavingAutoReply(false);
    }
  };

  const saveFlexMenu = async () => {
    setSavingFlex(true);
    try {
      await saveLineSettings({
        flexMenuEnabled, flexMenuFallback, flexHeaderColor,
        flexHeaderTitle, flexHeaderSubtitle, flexShowTip, campaignKeywordEnabled,
      });
      patchLocalLine({
        flexMenuEnabled, flexMenuFallback, flexHeaderColor,
        flexHeaderTitle, flexHeaderSubtitle, flexShowTip, campaignKeywordEnabled,
      });
      toast.show(t.flexMenu.saved);
    } catch (e) {
      toast.show(
        `${t.form.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSavingFlex(false);
    }
  };

  const resetFlexMenu = () => {
    setFlexHeaderColor(LINE_DEFAULTS.flexHeaderColor);
    setFlexHeaderTitle(LINE_DEFAULTS.flexHeaderTitle);
    setFlexHeaderSubtitle(LINE_DEFAULTS.flexHeaderSubtitle);
    setFlexShowTip(LINE_DEFAULTS.flexShowTip);
    toast.show(t.flexMenu.resetDone, 'info');
  };

  const createRichMenu = async () => {
    setCreatingRichMenu(true);
    try {
      await saveLineSettings({
        richMenuTheme, richMenuBgImageUrl, richMenuNoOverlay, richMenuTextColor,
      });
      patchLocalLine({
        richMenuTheme, richMenuBgImageUrl, richMenuNoOverlay, richMenuTextColor,
      });
      setRichMenuPublished(true);
      toast.show(
        richMenuBgImageUrl
          ? richMenuNoOverlay
            ? t.richMenu.createdNoOverlay
            : t.richMenu.createdCustomBg
          : t.richMenu.created,
      );
    } catch (e) {
      toast.show(
        `${t.richMenu.createFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setCreatingRichMenu(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const res = await testLineConnection();
      if (res.ok) {
        toast.show(res.message);
      } else {
        toast.show(`${t.connection.testFailedPrefix}${res.message}`, 'danger');
      }
    } catch (e) {
      toast.show(
        `${t.connection.testFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setTesting(false);
    }
  };

  const runVerify = async () => {
    setVerifying(true);
    try {
      const res = await verifyLineSetup();
      setVerifyChecks(res.checks);
    } catch (e) {
      toast.show(
        `${t.connection.verifyFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setVerifying(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await saveLineSettings({
        channelId: '', channelSecret: '', channelAccessToken: '', lineBasicId: '',
      });
      setChannelId('');
      setLineBasicId('');
      setRichMenuPublished(false);
      patchLocalLine({
        channelId: '', channelSecret: '', channelAccessToken: '', lineBasicId: '', webhookUrl: '',
      });
      setConfirmDisconnect(false);
      toast.show(t.disconnect.done);
    } catch (e) {
      toast.show(
        `${t.disconnect.failedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setDisconnecting(false);
    }
  };

  // 分開算：WARN 是「我們查不到／還沒做」，不該和「真的壞了」混在一起——
  // 兩者混算會讓報告永遠不可能顯示「全部通過」，久了店家整份忽略。
  const failCount = verifyChecks?.filter((c) => !c.pass && c.severity !== 'WARN').length ?? 0;
  const warnCount = verifyChecks?.filter((c) => !c.pass && c.severity === 'WARN').length ?? 0;

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

  return (
    <>
      <PageHeader
        eyebrow={nav.navSystem}
        title={t.title}
        actions={
          <Button variant="outline" size="sm" onClick={() => setTutorialOpen(true)}>
            <Images size={14} />
            {t.viewTutorial}
          </Button>
        }
      />

      {/* ============================================ 🔴 設定完成後必做（警示） */}
      <Alert tone="danger" className="mb-4" title={t.mustDo.title}>
        <p className="mt-1">{t.mustDo.lead}</p>
        <ol className="ml-4 list-decimal">
          {t.mustDo.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-2">{t.mustDo.ctaLead}</p>
        <a
          className="btn btn-danger btn-sm mt-2"
          href={t.mustDo.ctaHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={13} />
          {t.mustDo.cta}
        </a>
        <p className="mt-2 font-semibold">{t.mustDo.footer}</p>
      </Alert>

      {/* ==================================================== 五步驟教學卡 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText size={16} />
            {t.tutorial.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <Alert
            tone="info"
            className="mb-3"
            title={t.tutorial.tipTitle}
            action={
              <div className="btn-group">
                <Button variant="outline" size="sm" onClick={() => setTutorialOpen(true)}>
                  {t.tutorial.detailBtn}
                </Button>
                <Button variant="success" size="sm" onClick={() => setTutorialOpen(true)}>
                  <Images size={13} />
                  {t.tutorial.imageBtn}
                </Button>
              </div>
            }
          >
            {t.tutorial.tipBody}
          </Alert>

          <div className="flex flex-col gap-4">
            {t.tutorial.steps.map((step) => (
              <div key={step.title} className="rounded-md bg-neutral-50 p-4">
                <h3 className="mb-3 text-md font-bold text-primary">{step.title}</h3>
                <ul className="flex flex-col gap-1 text-base text-neutral-700">
                  {step.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {step.note ? (
                  <Alert tone="warning" className="mt-3 text-xs">{step.note}</Alert>
                ) : null}
              </div>
            ))}
          </div>

          <Alert tone="danger" className="mt-3 text-xs" title={t.tutorial.mustDoThree.title}>
            <p>{t.tutorial.mustDoThree.body}</p>
            <ul>
              {t.tutorial.mustDoThree.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </Alert>

          <Alert tone="warning" className="mt-2 text-xs" title={t.tutorial.verifyWebhook.title}>
            {t.tutorial.verifyWebhook.body}
          </Alert>

          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className="btn btn-outline btn-sm"
              href={t.tutorial.consoleHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={13} />
              {t.tutorial.consoleLink}
            </a>
            <a
              className="btn btn-outline btn-sm"
              href={t.tutorial.managerHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={13} />
              {t.tutorial.managerLink}
            </a>
          </div>
        </CardBody>
      </Card>

      {/* ========================================================== 設定表單 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 size={16} />
            {t.tutorial.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <Alert tone="info" className="mb-4 text-xs">{t.form.intro}</Alert>

          {/* ---------------------------------------------------- Channel ID */}
          <FormGroup>
            <Label required htmlFor="channelId">
              {t.form.channelId}
              <Badge tone="neutral" className="ml-2">{t.form.channelIdBadge}</Badge>
            </Label>
            <Input
              id="channelId"
              inputMode="numeric"
              value={channelId}
              placeholder={t.form.channelIdPlaceholder}
              onChange={(e) => setChannelId(e.target.value)}
            />
            {channelIdWarning ? (
              <Alert tone="danger" className="mt-2 text-xs">{channelIdWarning}</Alert>
            ) : null}
          </FormGroup>

          {/* ----------------------------------------- 🔐 Channel Secret */}
          <FormGroup>
            <Label required htmlFor="channelSecret">
              {t.form.channelSecret}
              <Badge tone="neutral" className="ml-2">{t.form.channelSecretBadge}</Badge>
            </Label>
            <div className="flex items-stretch gap-2">
              {secretEditing ? (
                <Input
                  id="channelSecret"
                  type={secretVisible ? 'text' : 'password'}
                  autoComplete="off"
                  value={secretInput}
                  placeholder={t.form.channelSecretPlaceholder}
                  onChange={(e) => setSecretInput(e.target.value)}
                />
              ) : (
                /* 唯讀遮罩：maskSecret 對已遮罩字串冪等，明文永遠不會出現在這裡 */
                <Input
                  id="channelSecret"
                  readOnly
                  value={maskSecret(settings.line.channelSecret)}
                  placeholder={t.form.secretMaskedPlaceholder}
                />
              )}
              {secretEditing ? (
                <>
                  <Button
                    variant="outline"
                    aria-label={secretVisible ? t.form.secretHide : t.form.secretShow}
                    title={secretVisible ? t.form.secretHide : t.form.secretShow}
                    onClick={() => setSecretVisible((v) => !v)}
                  >
                    {secretVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => { setSecretEditing(false); setSecretInput(''); setSecretVisible(false); }}
                  >
                    {t.form.secretCancelReenter}
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setSecretEditing(true)}>
                  {t.form.secretReenter}
                </Button>
              )}
            </div>
            <FormText>{t.form.secretKeepHint}</FormText>
            {secretWarning ? (
              <Alert tone="danger" className="mt-2 text-xs">{secretWarning}</Alert>
            ) : null}
          </FormGroup>

          {/* ----------------------------------- 🔐 Channel Access Token */}
          <FormGroup>
            <Label required htmlFor="channelAccessToken">
              {t.form.channelAccessToken}
              <Badge tone="neutral" className="ml-2">{t.form.channelAccessTokenBadge}</Badge>
            </Label>
            <div className="flex items-stretch gap-2">
              {tokenEditing ? (
                <Input
                  id="channelAccessToken"
                  type={tokenVisible ? 'text' : 'password'}
                  autoComplete="off"
                  value={tokenInput}
                  placeholder={t.form.channelAccessTokenPlaceholder}
                  onChange={(e) => setTokenInput(e.target.value)}
                />
              ) : (
                <Input
                  id="channelAccessToken"
                  readOnly
                  value={maskSecret(settings.line.channelAccessToken)}
                  placeholder={t.form.secretMaskedPlaceholder}
                />
              )}
              {tokenEditing ? (
                <>
                  <Button
                    variant="outline"
                    aria-label={tokenVisible ? t.form.secretHide : t.form.secretShow}
                    title={tokenVisible ? t.form.secretHide : t.form.secretShow}
                    onClick={() => setTokenVisible((v) => !v)}
                  >
                    {tokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => { setTokenEditing(false); setTokenInput(''); setTokenVisible(false); }}
                  >
                    {t.form.secretCancelReenter}
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setTokenEditing(true)}>
                  {t.form.secretReenter}
                </Button>
              )}
            </div>
            <FormText>{t.form.secretKeepHint}</FormText>
            {tokenWarning ? (
              <Alert tone="danger" className="mt-2 text-xs">{tokenWarning}</Alert>
            ) : null}
          </FormGroup>

          {/* ------------------------------------------------- Webhook URL */}
          <FormGroup>
            <Label htmlFor="webhookUrl">{t.form.webhookUrl}</Label>
            <div className="flex items-stretch gap-2">
              <Input id="webhookUrl" readOnly value={webhookUrl} />
              <Button variant="outline" onClick={() => void copy(webhookUrl, t.messages.copied)}>
                <ClipboardCopy size={14} />
                {t.form.webhookCopy}
              </Button>
            </div>
            <FormText>{t.form.webhookHelp}</FormText>
          </FormGroup>

          {/* ------------------------------------------------ 基本 ID */}
          <FormGroup>
            <Label htmlFor="lineBasicId">
              {t.form.lineBasicId}
              <span className="form-text ml-1">{t.form.lineBasicIdOptional}</span>
            </Label>
            <Input
              id="lineBasicId"
              value={lineBasicId}
              placeholder={t.form.lineBasicIdPlaceholder}
              onChange={(e) => setLineBasicId(e.target.value)}
            />
            <FormText>{t.form.lineBasicIdHelp}</FormText>
          </FormGroup>

          <div className="flex justify-end">
            <Button loading={savingLine} loadingText={t.form.saving} onClick={() => void saveLine()}>
              <Save size={14} />
              {t.form.save}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ========================================================== 連線狀態 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity size={16} />
            {t.connection.title}
          </CardTitle>
          {configured ? (
            <Badge tone="success">{t.connection.connected}</Badge>
          ) : (
            <Badge tone="neutral">{t.connection.notConfigured}</Badge>
          )}
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={testing}
              loadingText={t.connection.testing}
              onClick={() => void runTest()}
            >
              <Plug size={13} />
              {t.connection.test}
            </Button>
            <Button
              variant="warning"
              size="sm"
              loading={verifying}
              loadingText={t.connection.verifying}
              onClick={() => void runVerify()}
            >
              <ClipboardCheck size={13} />
              {t.connection.verify}
            </Button>
          </div>
          <FormText>
            {t.connection.hintLead}
            {t.connection.hintTail}
          </FormText>
        </CardBody>
      </Card>

      {/* ======================================================= QR Code 卡 */}
      <Card className="mb-4">
        <CardHeader>
          <div>
            <CardTitle>{t.botInfo.title}</CardTitle>
            <div className="form-text">{t.botInfo.subtitle}</div>
          </div>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-md border border-neutral-250 bg-neutral-50 text-center">
              <QrCode size={48} className="text-neutral-400" />
              <span className="px-2 text-2xs text-secondary">
                {addFriendUrl ? t.botInfo.qrTitle : t.botInfo.noQr}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-base font-semibold text-dark">{t.botInfo.qrTitle}</div>
              <FormText>{t.botInfo.qrHelp}</FormText>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  className="btn btn-line"
                  href={addFriendUrl || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!addFriendUrl}
                >
                  <UserPlus size={14} />
                  {t.botInfo.addFriend}
                </a>
                <Button
                  variant="outline"
                  onClick={() =>
                    addFriendUrl
                      ? void copy(addFriendUrl, t.botInfo.copiedLink)
                      : toast.show(t.botInfo.noLink, 'warning')
                  }
                >
                  <Link2 size={14} />
                  {t.botInfo.copyLink}
                </Button>
                {/*
                  * ⚠️ 本站沒有任何 QR 圖檔可下載（方框裡是 lucide 圖示，不是真 QR），
                  * 舊實作只 toast「QR Code 已下載！」讓店家空等一個不存在的檔案。
                  * 在真的能產出圖檔之前，按鈕一律停用並說明去哪裡拿。禁止復原。
                  */}
                <Button
                  variant="outline"
                  disabled
                  title={t.botInfo.downloadDisabledHint}
                >
                  <QrCode size={14} />
                  {t.botInfo.downloadQr}
                </Button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* =================================================== 如何讓顧客加入 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone size={16} />
            {t.promotion.title}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {t.promotion.items.map((item) => (
              <div key={item.no} className="rounded-md border border-neutral-250 p-3">
                <Badge tone="primary">{item.no}</Badge>
                <div className="mt-2 text-base font-semibold text-dark">{item.title}</div>
                <div className="form-text">{item.desc}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* ========================================================== 自動回覆 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Reply size={16} />
            {t.autoReply.title}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <SwitchField
            label={t.autoReply.enable}
            checked={autoReplyEnabled}
            onCheckedChange={setAutoReplyEnabled}
          />
          <Alert tone="info" className="mt-3 text-xs">{t.autoReply.offHint}</Alert>
          <Alert tone="neutral" className="mb-3 text-xs">
            {t.autoReply.keywordTip}
            <Link className="ml-1 underline" href={t.autoReply.keywordTipHref}>
              {nav.keyword_replies}
            </Link>
          </Alert>
          <Alert tone="neutral" className="mb-3 text-xs">
            {t.autoReply.welcomeTip}
            <Link className="ml-1 underline" href={t.autoReply.welcomeTipHref}>
              {nav.settings}
            </Link>
          </Alert>

          <FormGroup>
            <Label htmlFor="defaultReply">{t.autoReply.defaultReply}</Label>
            <Textarea
              id="defaultReply"
              rows={3}
              maxLength={t.autoReply.defaultReplyMax}
              value={defaultReply}
              placeholder={t.autoReply.defaultReplyPlaceholder}
              onChange={(e) => setDefaultReply(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <FormText>{t.autoReply.defaultReplyHelp}</FormText>
              <CharCounter value={defaultReply} max={t.autoReply.defaultReplyMax} />
            </div>
          </FormGroup>

          <div className="flex justify-end">
            <Button
              loading={savingAutoReply}
              loadingText={t.autoReply.saving}
              onClick={() => void saveAutoReply()}
            >
              {t.autoReply.save}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ======================================================= Flex 主選單 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText size={16} />
            {t.flexMenu.title}
          </CardTitle>
          <Link className="btn btn-outline btn-sm" href={t.flexMenu.designHref}>
            <Palette size={13} />
            {t.flexMenu.designLink}
          </Link>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-base text-neutral-700">{t.flexMenu.intro}</p>

          <SwitchField
            label={t.flexMenu.enable}
            description={
              <>
                <div>{t.flexMenu.enableOffHint}</div>
                <div>{t.flexMenu.enableOffHint2}</div>
              </>
            }
            checked={flexMenuEnabled}
            onCheckedChange={(v) => {
              setFlexMenuEnabled(v);
              toast.show(v ? t.flexMenu.enabledToast : t.flexMenu.disabledToast, 'info');
            }}
          />

          {!flexMenuEnabled ? (
            <div className="mt-3">
              <Label>{t.flexMenu.fallbackTitle}</Label>
              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-2 text-base text-neutral-700">
                  <input
                    type="radio"
                    name="flexMenuFallbackMode"
                    className="mt-1"
                    checked={flexMenuFallback === 'HINT'}
                    onChange={() => { setFlexMenuFallback('HINT'); toast.show(t.flexMenu.fallbackHintToast, 'info'); }}
                  />
                  {t.flexMenu.fallbackHint}
                </label>
                <label className="flex items-start gap-2 text-base text-neutral-700">
                  <input
                    type="radio"
                    name="flexMenuFallbackMode"
                    className="mt-1"
                    checked={flexMenuFallback === 'SILENT'}
                    onChange={() => { setFlexMenuFallback('SILENT'); toast.show(t.flexMenu.fallbackSilentToast, 'info'); }}
                  />
                  {t.flexMenu.fallbackSilent}
                </label>
              </div>
            </div>
          ) : null}

          <SwitchField
            label={t.flexMenu.campaignKeyword}
            description={
              <>
                <div>{t.flexMenu.campaignKeywordOn}</div>
                <div>{t.flexMenu.campaignKeywordOff}</div>
                <div>{t.flexMenu.campaignKeywordWarning}</div>
              </>
            }
            checked={campaignKeywordEnabled}
            onCheckedChange={(v) => {
              setCampaignKeywordEnabled(v);
              toast.show(
                v ? t.flexMenu.campaignKeywordOnToast : t.flexMenu.campaignKeywordOffToast,
                'info',
              );
            }}
          />

          <div className="mt-4 grid gap-x-4 md:grid-cols-2">
            <FormGroup>
              <Label htmlFor="flexHeaderColor">{t.flexMenu.headerColor}</Label>
              <div className="flex gap-2">
                <input
                  id="flexHeaderColor"
                  type="color"
                  className="form-control h-9 w-16 p-1"
                  value={flexHeaderColor}
                  onChange={(e) => setFlexHeaderColor(e.target.value)}
                />
                <Input
                  aria-label={t.flexMenu.headerColor}
                  value={flexHeaderColor}
                  onChange={(e) => setFlexHeaderColor(e.target.value)}
                />
              </div>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="flexHeaderTitle">{t.flexMenu.headerTitle}</Label>
              <Input
                id="flexHeaderTitle"
                value={flexHeaderTitle}
                placeholder={t.flexMenu.headerTitlePlaceholder}
                onChange={(e) => setFlexHeaderTitle(e.target.value)}
              />
              <FormText>{t.flexMenu.headerTitleHelp}</FormText>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="flexHeaderSubtitle">{t.flexMenu.headerSubtitle}</Label>
              <Input
                id="flexHeaderSubtitle"
                value={flexHeaderSubtitle}
                placeholder={t.flexMenu.headerSubtitlePlaceholder}
                onChange={(e) => setFlexHeaderSubtitle(e.target.value)}
              />
            </FormGroup>
          </div>

          <SwitchField
            label={t.flexMenu.showTip}
            checked={flexShowTip}
            onCheckedChange={setFlexShowTip}
          />

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={resetFlexMenu}>
              <RotateCcw size={14} />
              {t.flexMenu.reset}
            </Button>
            <Button
              loading={savingFlex}
              loadingText={t.flexMenu.saving}
              onClick={() => void saveFlexMenu()}
            >
              {t.flexMenu.save}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ========================================================= Rich Menu */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3x3 size={16} />
            {t.richMenu.title}
            {richMenuPublished ? (
              <Badge tone="success">{t.richMenu.isDefault}</Badge>
            ) : (
              <Badge tone="neutral">{t.richMenu.notConfigured}</Badge>
            )}
          </CardTitle>
          <Link className="btn btn-outline btn-sm" href={t.richMenu.advancedDesignHref}>
            <Palette size={13} />
            {t.richMenu.advancedDesign}
          </Link>
        </CardHeader>
        <CardBody>
          {/* 即時預覽 */}
          <div className="mb-4">
            <div className="mb-2 text-base font-semibold text-dark">{t.richMenu.previewTitle}</div>
            <div className="rounded-md border border-neutral-250 p-3">
              <div className="mb-2 text-2xs text-secondary">{t.richMenu.previewChatArea}</div>
              <div
                className="grid grid-cols-4 gap-px overflow-hidden rounded-sm"
                style={{
                  backgroundColor:
                    THEME_PRESETS.find((p) => p.key === richMenuTheme)?.swatch,
                  backgroundImage: richMenuBgImageUrl ? `url(${richMenuBgImageUrl})` : undefined,
                  backgroundSize: 'cover',
                }}
              >
                {t.richMenu.previewItems.map((item) => (
                  <div
                    key={item}
                    className="flex h-12 items-center justify-center text-2xs font-semibold"
                    style={{ color: richMenuNoOverlay ? 'transparent' : richMenuTextColor }}
                  >
                    {richMenuNoOverlay ? '' : item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 主題配色 */}
          <FormGroup>
            <Label>{t.richMenu.themeTitle}</Label>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  data-active={richMenuTheme === preset.key}
                  onClick={() => setRichMenuTheme(preset.key)}
                  className="flex items-center gap-2 rounded-md border border-neutral-250 px-3 py-1.5 text-xs data-[active=true]:border-primary data-[active=true]:shadow-focus"
                >
                  <span
                    className="inline-block h-4 w-4 rounded-pill"
                    style={{ backgroundColor: preset.swatch }}
                  />
                  {t.richMenu.themes[preset.key]}
                </button>
              ))}
            </div>
          </FormGroup>

          {/* 自訂背景 */}
          <FormGroup>
            <Label htmlFor="richMenuBgImageUrl">{t.richMenu.customBg}</Label>
            <Input
              id="richMenuBgImageUrl"
              value={richMenuBgImageUrl}
              placeholder={t.richMenu.customBgUrlPlaceholder}
              onChange={(e) => setRichMenuBgImageUrl(e.target.value)}
            />
            <FormText>{t.richMenu.customBgHelp}</FormText>
          </FormGroup>

          <FormGroup>
            <label className="flex items-start gap-2 text-base text-neutral-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={richMenuNoOverlay}
                onChange={(e) => setRichMenuNoOverlay(e.target.checked)}
              />
              <span>
                {t.richMenu.noOverlay}
                <span className="form-text block">{t.richMenu.noOverlayHelp}</span>
              </span>
            </label>
          </FormGroup>

          {/* 文字顏色 */}
          <FormGroup>
            <Label>{t.richMenu.textColor}</Label>
            <div className="flex flex-wrap gap-2">
              {TEXT_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  data-active={richMenuTextColor === preset.value}
                  onClick={() => setRichMenuTextColor(preset.value)}
                  className="flex items-center gap-2 rounded-md border border-neutral-250 px-3 py-1.5 text-xs data-[active=true]:border-primary data-[active=true]:shadow-focus"
                >
                  <span
                    className="inline-block h-4 w-4 rounded-pill border border-neutral-250"
                    style={{ backgroundColor: preset.value }}
                  />
                  {t.richMenu.textColors[preset.key]}
                </button>
              ))}
            </div>
          </FormGroup>

          <Button
            block
            variant="success"
            loading={creatingRichMenu}
            loadingText={t.richMenu.creating}
            onClick={() => void createRichMenu()}
          >
            {t.richMenu.create}
          </Button>

          <Alert tone="neutral" className="mt-3 text-xs">{t.richMenu.footnote}</Alert>
          <Alert tone="neutral" className="text-xs">{t.richMenu.chatBgNote}</Alert>
        </CardBody>
      </Card>

      {/* ========================================================== 使用說明 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle size={16} />
            {t.help.title}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <h3 className="mb-2 text-base font-bold text-dark">{t.help.canDoTitle}</h3>
          <ul className="mb-4 ml-4 list-disc text-base text-neutral-700">
            {t.help.canDo.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>

          <h3 className="mb-2 text-base font-bold text-dark">{t.help.faqTitle}</h3>
          <div className="flex flex-col gap-3">
            {t.help.faq.map((item) => (
              <div key={item.q}>
                <div className="text-base font-semibold text-dark">{item.q}</div>
                <div className="form-text">{item.a}</div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* ========================================================== 解除綁定 */}
      <Card className="mb-4 border-danger">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger">
            <Unlink size={16} />
            {t.disconnect.title}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-base text-neutral-700">{t.disconnect.body1}</p>
          <p className="mt-1 text-base text-neutral-700">{t.disconnect.body2}</p>
          <div className="mt-3">
            <Button
              variant="outlineDanger"
              size="sm"
              loading={disconnecting}
              loadingText={t.disconnect.processing}
              onClick={() => setConfirmDisconnect(true)}
            >
              <XCircle size={13} />
              {t.disconnect.action}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ modal：檢查報告 */}
      <Modal
        open={verifyChecks !== null}
        onClose={() => setVerifyChecks(null)}
        size="lg"
        title={
          <span className="flex items-center gap-2">
            <ClipboardCheck size={16} />
            {t.verifyReport.title}
          </span>
        }
        footer={
          <Button variant="secondary" onClick={() => setVerifyChecks(null)}>
            {t.verifyReport.close}
          </Button>
        }
      >
        <div className="mb-3">
          {failCount > 0 ? (
            <Badge tone="danger">{t.verifyReport.failCount(failCount)}</Badge>
          ) : warnCount > 0 ? (
            <Badge tone="warning">{t.verifyReport.warnCount(warnCount)}</Badge>
          ) : (
            <Badge tone="success">{t.verifyReport.allPass}</Badge>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {(verifyChecks ?? []).map((c) => (
            <div
              key={c.key}
              className="flex items-start gap-2 rounded-md border border-neutral-250 px-3 py-2"
            >
              {c.pass ? (
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-success" />
              ) : (
                <AlertTriangle
                  size={16}
                  className={cn(
                    'mt-0.5 flex-shrink-0',
                    c.severity === 'WARN' ? 'text-warning' : 'text-danger',
                  )}
                />
              )}
              <div className="min-w-0">
                <div className="text-base font-semibold text-dark">
                  {t.verifyReport.checkNames[c.key as keyof typeof t.verifyReport.checkNames] ?? c.key}
                </div>
                <div className="form-text">{c.message}</div>
                {!c.pass && c.key === 'AUTO_REPLY' ? (
                  <div className="form-text font-semibold">{t.verifyReport.culprit}</div>
                ) : null}
                {!c.pass && c.key === 'WEBHOOK' ? (
                  <div className="form-text">{t.verifyReport.webhookOffHint}</div>
                ) : null}
                {/* 失敗項目附上「怎麼修 + 直接點過去」——只講哪裡錯、不講去哪修，
                    店家只能自己猜（AUTO_REPLY／RICH_MENU 兩項使用者實測卡住） */}
                {!c.pass && t.verifyReport.fixHints[c.key] ? (
                  <>
                    <div className="form-text">{t.verifyReport.fixHints[c.key].steps}</div>
                    {t.verifyReport.fixHints[c.key].href.startsWith('/') ? (
                      <Link
                        className="btn btn-outline btn-sm mt-2"
                        href={t.verifyReport.fixHints[c.key].href}
                      >
                        {t.verifyReport.fixHints[c.key].linkText}
                      </Link>
                    ) : (
                      <a
                        className="btn btn-outline btn-sm mt-2"
                        href={t.verifyReport.fixHints[c.key].href}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink size={13} />
                        {t.verifyReport.fixHints[c.key].linkText}
                      </a>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <a
          className="btn btn-outline btn-sm mt-3"
          href={t.tutorial.managerHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={13} />
          {t.verifyReport.gotoLineConsole}
        </a>
      </Modal>

      {/* ------------------------------------------------ modal：圖文教學 */}
      <Modal
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        size="xl"
        title={t.tutorial.modalTitle}
        footer={
          <Button variant="secondary" onClick={() => setTutorialOpen(false)}>
            {common.close}
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap gap-3 text-xs text-secondary">
          <span>{t.tutorial.legendRed}</span>
          <span>{t.tutorial.legendMosaic}</span>
          <span>{t.tutorial.legendGray}</span>
        </div>
        <ol className="flex flex-col gap-4">
          {t.tutorial.steps.map((step) => (
            <li key={step.title}>
              <div className="text-base font-bold text-dark">{step.title}</div>
              <ul className="ml-4 list-disc text-base text-neutral-700">
                {step.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {step.note ? <div className="form-text">{step.note}</div> : null}
            </li>
          ))}
        </ol>
      </Modal>

      {/* ------------------------------------------- 確認：解除 LINE 綁定 */}
      <ConfirmModal
        open={confirmDisconnect}
        danger
        loading={disconnecting}
        title={t.disconnect.confirmTitle}
        confirmText={t.disconnect.action}
        message={<span className="whitespace-pre-line">{t.disconnect.confirmMessage}</span>}
        onClose={() => setConfirmDisconnect(false)}
        onConfirm={() => void disconnect()}
      />
    </>
  );
}
