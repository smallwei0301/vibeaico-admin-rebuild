'use client';
import * as React from 'react';
import Link from 'next/link';
import { Bot, Eraser, Heart, Info, PencilLine, Save } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { ConfirmModal } from '@/components/ui/Modal';
import { CharCounter, FormText, SwitchField, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { getAiSettings, listFeatures, saveAiSettings } from '@/services/settings';
import type { AiSettings } from '@/config/tenant-settings';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { aiSettingsPage as t } from '@/i18n/zh-TW/pages/ai-settings';

/* -------------------------------------------------------------------------- */
/* 本頁專用常數（不寫進 src/mock，避免與其他頁面衝突）                            */
/* -------------------------------------------------------------------------- */

/**
 * 7 個行業範本。
 * ⚠️ 原站的範本「內容」是 inline JS 裡的長段提示詞，spec 只保留了範本名稱，
 *    因此骨架階段 content 留空（套用後仍可自由編輯），待接真實後端時由
 *    /api/settings/line 回傳的範本庫填入。
 */
const TEMPLATE_KEYS = ['pet', 'nail', 'hair', 'clinic', 'gym', 'restaurant', 'spa'] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const TEMPLATE_CONTENT: Record<TemplateKey, string> = {
  pet: '', nail: '', hair: '', clinic: '', gym: '', restaurant: '', spa: '',
};

/* -------------------------------------------------------------------------- */

export default function AiSettingsPage() {
  const toast = useToast();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [featureActive, setFeatureActive] = React.useState(true);

  const [enabled, setEnabled] = React.useState(false);
  const [strictMode, setStrictMode] = React.useState(false);
  const [prompt, setPrompt] = React.useState('');

  /**
   * GET /api/ai-settings 回來的整包，原樣留著。
   *
   * `PUT /api/ai-settings` 是**整包覆蓋**（09 分冊 §7.1），而本頁只編輯
   * enabled / strictMode / personaNotes 三個欄位；不把 faq、handoffMessage
   * 一起送回去的話，zod 的 default 會把它們洗成 []／''，使用者在別處（webhook
   * 的常見問答、真人接手訊息）設定的東西就這樣不聲不響消失了。
   */
  const loadedRef = React.useRef<AiSettings | null>(null);

  const [templateTarget, setTemplateTarget] = React.useState<TemplateKey | null>(null);
  const [clearConfirm, setClearConfirm] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      try {
        /**
         * AI 設定的唯一來源是 `tenant_settings.ai`（GET /api/ai-settings）。
         *
         * ⚠️ 以前這裡讀的是 `getTenantSettings().line`，把 LINE 的靜態罐頭回覆
         * 當成 AI 設定顯示，儲存時再寫回去 —— 提示詞於是被逐字推播給顧客
         * （14 分冊 §7.3）。§8.1 裁決分家後，本頁不再讀寫 `line.*` 的任何欄位。
         */
        const ai = await getAiSettings();
        loadedRef.current = ai;
        setEnabled(ai.enabled);
        setStrictMode(ai.strictMode);
        setPrompt(ai.personaNotes);
      } catch {
        toast.show(t.messages.loadFailed, 'danger');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    void (async () => {
      try {
        const features = await listFeatures();
        setFeatureActive(features.some((f) => f.code === 'AI_ASSISTANT' && f.active));
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      }
    })();
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      /**
       * 只寫 `tenant_settings.ai`（§8.1 分家）。`faq` / `handoffMessage` 是本頁
       * 沒有 UI、但同一支端點整包覆蓋會清掉的欄位 —— 從載入時留下的整包帶回去。
       */
      const base = loadedRef.current;
      const next: AiSettings = {
        faq: base?.faq ?? [],
        handoffMessage: base?.handoffMessage ?? '',
        enabled,
        strictMode,
        personaNotes: prompt,
      };
      await saveAiSettings(next);
      loadedRef.current = next;
      toast.show(enabled ? t.messages.savedEnabled : t.messages.savedDisabled);
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = () => {
    if (!templateTarget) return;
    setPrompt(TEMPLATE_CONTENT[templateTarget]);
    setTemplateTarget(null);
    toast.show(t.templates.apply, 'info');
  };

  if (loading) {
    return (
      <>
        <PageHeader eyebrow={nav.navOperation} title={t.title} subtitle={t.subtitle} />
        <Card>
          <CardBody className="py-10 text-center text-muted">{common.loading}</CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow={nav.navOperation} title={t.title} subtitle={t.subtitle} />

      {!featureActive ? (
        <Alert tone="warning" className="mb-4">
          {t.feature.lockedLead}
          <strong>{t.feature.lockedStrong}</strong>
          {t.feature.lockedTail}
          <Link href="/tenant/feature-store" className="ml-2 font-semibold">
            {t.feature.goToStore}
          </Link>
        </Alert>
      ) : null}

      {/* ============================================== 快速套用行業範本 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <Bot size={16} />
            {t.templates.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <FormText className="mb-3 mt-0">{t.templates.cardDesc}</FormText>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {TEMPLATE_KEYS.map((key) => (
              <Button
                key={key}
                variant="outline"
                block
                onClick={() => setTemplateTarget(key)}
              >
                {t.templates.items[key].button}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* ==================================================== 自訂提示詞 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <Heart size={16} />
            {t.prompt.cardTitle}
          </CardTitle>
          <Button variant="outlineDanger" size="sm" onClick={() => setClearConfirm(true)}>
            <Eraser size={13} />
            {t.prompt.clear}
          </Button>
        </CardHeader>
        <CardBody>
          <SwitchField
            label={t.prompt.enabledLabel}
            description={t.prompt.enabledHelp}
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <SwitchField
            label={t.prompt.strictLabel}
            description={t.prompt.strictHelp}
            checked={strictMode}
            onCheckedChange={setStrictMode}
          />

          <div className="mt-4">
            <Textarea
              id="aiCustomPrompt"
              rows={t.prompt.rows}
              maxLength={t.prompt.max}
              placeholder={t.prompt.placeholder}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <FormText>{t.prompt.help}</FormText>
              <CharCounter value={prompt} max={t.prompt.max} />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button loading={saving} loadingText={t.prompt.saving} onClick={() => void save()}>
              <Save size={15} />
              {t.prompt.save}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ==================================================== AI 如何回覆 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <Info size={16} />
            {t.how.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-base">{t.how.lead}</p>
          <ul className="ml-5 mt-2 list-disc text-base text-neutral-700">
            {t.how.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <Alert tone="neutral" className="mt-3 text-base" icon={false}>
            <strong>{t.how.tipLabel}</strong>
            {t.how.tipText}
          </Alert>
        </CardBody>
      </Card>

      {/* ======================================================= 撰寫建議 */}
      <Card>
        <CardHeader>
          <CardTitle>
            <PencilLine size={16} />
            {t.writing.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="ml-5 list-disc text-base text-neutral-700">
            {t.writing.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {/* ------------------------------------------------------- 確認彈窗 */}
      <ConfirmModal
        open={!!templateTarget}
        title={t.templates.confirmTitle}
        message={
          <span className="whitespace-pre-line">
            {templateTarget ? t.templates.confirm(t.templates.items[templateTarget].name) : ''}
          </span>
        }
        onClose={() => setTemplateTarget(null)}
        onConfirm={applyTemplate}
      />

      <ConfirmModal
        open={clearConfirm}
        title={t.prompt.clearTitle}
        message={t.prompt.clearConfirm}
        danger
        onClose={() => setClearConfirm(false)}
        onConfirm={() => {
          setPrompt('');
          setClearConfirm(false);
        }}
      />
    </>
  );
}
