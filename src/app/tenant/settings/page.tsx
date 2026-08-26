'use client';
import * as React from 'react';
import {
  Bell, Calculator, CalendarPlus, ChevronRight, ClipboardCopy, Clock, Coins, ExternalLink,
  Gift, Info, KeyRound, Lock, Mail, MessageSquareText, Plus, RotateCcw, ShieldCheck,
  ShoppingCart, Store, Trash2, Upload, UserCheck, Zap,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/Tabs';
import { ConfirmModal } from '@/components/ui/Modal';
import {
  CharCounter, FormGroup, FormText, Input, Label, Select, SwitchField, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { getTenantSettings, saveTenantSettings } from '@/services/settings';
import { changePassword } from '@/services/auth';
import { uploadImage } from '@/services/upload';
import { buildPublicBookingUrl } from '@/config/tenant-settings';
import type { TenantSettings } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { common } from '@/i18n/zh-TW/common';
import { nav, resolveNavTerms } from '@/i18n/zh-TW/nav';
import { useBusinessType } from '@/components/layout/BusinessTypeContext';
import { settingsPage as t } from '@/i18n/zh-TW/pages/settings';

/* -------------------------------------------------------------------------- */
/* 常數（模組層算好，render 期不碰 Date / Math.random）                          */
/* -------------------------------------------------------------------------- */

/** 原站 .time-select 的選項：00:00 ~ 23:30，每 30 分鐘一格 */
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of ['00', '30']) out.push(`${String(h).padStart(2, '0')}:${m}`);
  }
  return out;
})();

const TAB_KEYS = ['basic', 'business', 'notification', 'points', 'calendarSync', 'security'] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** 原站以 hash 記住分頁（#basic / #business / …） */
const HASH_TO_TAB: Record<string, TabKey> = {
  '#basic': 'basic',
  '#business': 'business',
  '#notification': 'notification',
  '#points': 'points',
  '#calendar-sync': 'calendarSync',
  '#security': 'security',
};
const TAB_TO_HASH: Record<TabKey, string> = {
  basic: '#basic',
  business: '#business',
  notification: '#notification',
  points: '#points',
  calendarSync: '#calendar-sync',
  security: '#security',
};

/*
 * ⚠️ ICS 訂閱網址（本檔「行事曆同步」分頁）後端尚未建置：
 * `/ics/{shopCode}/{token}.ics` 這條路由在 src/app 底下不存在，也沒有
 * `/api/settings/calendar` 可以發或撤 token。舊實作在這裡放了一個假 token
 * 與 REGENERATED_ICS_TOKENS 輪替陣列，按「重新產生網址」就換下一個假值並
 * toast「已產生新網址」——店家會以為舊網址已被撤銷（假的安全操作），
 * 實際上什麼都沒失效。禁止復原。
 */

const MAX_CUSTOM_FIELDS = 5;
const MAX_CUSTOM_FIELD_NAME = 20;
const MAX_WELCOME_FEATURE_LINES = 8;

const roundPoints = (raw: number, mode: TenantSettings['points']['rounding']): number => {
  if (mode === 'CEIL') return Math.ceil(raw);
  if (mode === 'ROUND') return Math.round(raw);
  return Math.floor(raw);
};

const nonEmptyLines = (text: string): string[] =>
  text.split('\n').map((l) => l.trim()).filter(Boolean);

/* -------------------------------------------------------------------------- */

export default function SettingsPage() {
  /** 跨頁文案的「目錄／訂單」名稱依當下模式展開（14 分冊 §8.13） */
  const businessType = useBusinessType();
  const toast = useToast();

  const [tab, setTab] = React.useState<TabKey>('basic');
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState<TenantSettings | null>(null);
  const [savingSection, setSavingSection] = React.useState<TabKey | null>(null);

  /* 歡迎卡片圖片上傳（issue #28 ⑥）：隱藏的 <input type="file"> 由按鈕觸發 */
  const welcomeImageFileRef = React.useRef<HTMLInputElement>(null);
  const [welcomeImageBusy, setWelcomeImageBusy] = React.useState(false);

  /* 點數試算（原站 #testAmount，預設 100） */
  const [testAmount, setTestAmount] = React.useState('100');

  /* 帳號安全 */
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [confirmPasswordChange, setConfirmPasswordChange] = React.useState(false);
  const [passwordBusy, setPasswordBusy] = React.useState(false);

  React.useEffect(() => {
    const hash = window.location.hash;
    if (HASH_TO_TAB[hash]) setTab(HASH_TO_TAB[hash]);
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        setDraft(await getTenantSettings());
      } catch (e) {
        toast.show(
          `${t.messages.loadFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
          'danger',
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const changeTab = (key: string) => {
    const next = key as TabKey;
    setTab(next);
    window.history.replaceState(null, '', TAB_TO_HASH[next]);
  };

  /* ---------------------------------------------------------- draft 更新 */

  const patchBasic = (p: Partial<TenantSettings['basic']>) =>
    setDraft((d) => (d ? { ...d, basic: { ...d.basic, ...p } } : d));
  const patchBusiness = (p: Partial<TenantSettings['business']>) =>
    setDraft((d) => (d ? { ...d, business: { ...d.business, ...p } } : d));
  const patchNotify = (p: Partial<TenantSettings['notify']>) =>
    setDraft((d) => (d ? { ...d, notify: { ...d.notify, ...p } } : d));
  const patchPrivacy = (p: Partial<TenantSettings['privacy']>) =>
    setDraft((d) => (d ? { ...d, privacy: { ...d.privacy, ...p } } : d));
  const patchPoints = (p: Partial<TenantSettings['points']>) =>
    setDraft((d) => (d ? { ...d, points: { ...d.points, ...p } } : d));

  /* -------------------------------------------------------------- 儲存 */

  const persist = async (
    section: TabKey,
    patch: Partial<TenantSettings>,
    successMessage: string,
  ) => {
    setSavingSection(section);
    try {
      await saveTenantSettings(patch);
      toast.show(successMessage);
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSavingSection(null);
    }
  };

  const saveBasic = async () => {
    if (!draft) return;
    if (!draft.basic.tenantName.trim()) {
      toast.show(t.basic.tenantNameInvalid, 'warning');
      return;
    }
    if (draft.basic.tenantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.basic.tenantEmail)) {
      toast.show(t.basic.tenantEmailInvalid, 'warning');
      return;
    }
    await persist('basic', { basic: draft.basic }, t.basic.saved);
  };

  const validateBusiness = (b: TenantSettings['business']): string => {
    if (b.perDayMode) {
      const openDays = b.perDayHours.filter((slots) => slots.length > 0);
      if (openDays.length === 0) return t.business.validation.atLeastOneOpenDay;
      for (let day = 0; day < b.perDayHours.length; day += 1) {
        const slots = [...b.perDayHours[day]].sort((x, y) => x.start.localeCompare(y.start));
        for (const s of slots) {
          if (s.start >= s.end) return t.business.validation.perDayOrder(common.weekdays[day]);
        }
        for (let i = 1; i < slots.length; i += 1) {
          if (slots[i].start < slots[i - 1].end) {
            return t.business.validation.perDayOverlap(common.weekdays[day]);
          }
        }
      }
    } else {
      if (b.businessStart >= b.businessEnd) return t.business.validation.endAfterStart;
      const hasBreakStart = !!b.breakStart;
      const hasBreakEnd = !!b.breakEnd;
      if (hasBreakStart !== hasBreakEnd) return t.business.validation.breakPair;
      if (hasBreakStart && hasBreakEnd) {
        if (b.breakStart >= b.breakEnd) return t.business.validation.breakEndAfterStart;
        if (b.breakStart < b.businessStart) return t.business.validation.breakStartTooEarly;
        if (b.breakEnd > b.businessEnd) return t.business.validation.breakEndTooLate;
      }
      if (b.closedDays.length >= 7) return t.business.validation.atLeastOneOpenDay;
    }
    const days = b.advanceBookingUnit === 'MONTH' ? b.advanceBookingValue * 30 : b.advanceBookingValue;
    if (days < 1 || days > 180) return t.business.validation.advanceRange;
    return '';
  };

  const saveBusiness = async () => {
    if (!draft) return;
    const err = validateBusiness(draft.business);
    if (err) {
      toast.show(`${t.business.validation.checkPrefix}${err}`, 'warning');
      return;
    }
    await persist('business', { business: draft.business }, t.business.saved);
  };

  const saveNotification = async () => {
    if (!draft) return;
    const fields = nonEmptyLines(draft.business.bookingCustomFields);
    if (fields.length > MAX_CUSTOM_FIELDS) {
      toast.show(t.notification.validation.customFieldsTooMany(fields.length), 'warning');
      return;
    }
    if (fields.some((f) => f.replace(/\*$/, '').trim().length > MAX_CUSTOM_FIELD_NAME)) {
      toast.show(t.notification.validation.customFieldNameTooLong, 'warning');
      return;
    }
    const features = nonEmptyLines(draft.notify.welcomeFeatureListText);
    if (features.length > MAX_WELCOME_FEATURE_LINES) {
      toast.show(t.notification.validation.welcomeFeatureTooMany(features.length), 'warning');
      return;
    }
    /* 預約自訂欄位屬於 business 群組（見 tenant-settings schema），但原站放在通知設定頁一起存 */
    await persist(
      'notification',
      {
        notify: draft.notify,
        privacy: draft.privacy,
        business: { ...draft.business, bookingCustomFields: draft.business.bookingCustomFields },
      },
      t.notification.saved,
    );
  };

  /**
   * 歡迎卡片圖片：選檔 → 上傳 → **存進 tenant_settings** → 顯示成功（issue #28 ⑥）。
   *
   * 修改前這顆鈕的 onClick 整個內容是 `() => toast.show(t.notification
   * .welcomeCardImageUpdated)`：不開檔案選擇器、不上傳、不改任何 state，
   * 畫面卻說「歡迎卡片圖片已更新」——全站最赤裸的一筆假成功。
   *
   * 為什麼上傳完要**接著存回資料庫**（而不是只 patchNotify 等使用者按儲存）：
   * 作法對齊 issue #7 已經定下的 rich-menu 底圖那條路（先 uploadImage、再
   * saveLineSettings、最後才 toast）。成功訊息說的是「已更新」，那就得真的更新到
   * 重整後還在；只放進 React state 的話，使用者離開頁面圖就沒了，而畫面已經說成功。
   *
   * ⚠️ 代價據實寫在畫面上（`welcomeCardImageUpdated` 文案）：這一步會把「通知設定」
   * 這一組**當下的其他未儲存變更一起存進去**——PUT /api/settings 是整組覆蓋，
   * 只送 welcomeCardImageUrl 會把同組其他欄位打回預設值，那才是真的災難。
   */
  const uploadWelcomeCardImage = async (file: File) => {
    if (!draft) return;
    setWelcomeImageBusy(true);
    try {
      const url = await uploadImage(file, 'welcome-card-images');
      const notify = { ...draft.notify, welcomeCardImageUrl: url };
      await saveTenantSettings({ notify });
      patchNotify({ welcomeCardImageUrl: url });
      toast.show(t.notification.welcomeCardImageUpdated);
    } catch (e) {
      toast.show(
        `${t.notification.welcomeCardImageUploadFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setWelcomeImageBusy(false);
      if (welcomeImageFileRef.current) welcomeImageFileRef.current.value = '';
    }
  };

  /**
   * 移除歡迎卡片圖片 —— 同樣要真的存回去（原本只清本地 state 就報「已移除」）。
   *
   * ⚠️ 只清掉 tenant_settings 裡的網址，**不刪 Storage 物件**：那張圖可能還被
   * 別處引用，而且刪檔失敗與清欄位失敗要分開處理。孤兒物件的清理是既有技術債
   * （06 分冊 §8.5 第 5 條同一類），畫面上的文案因此只說「移除歡迎卡片圖片」，
   * 不宣稱檔案被刪掉。
   */
  const removeWelcomeCardImage = async () => {
    if (!draft) return;
    setWelcomeImageBusy(true);
    try {
      const notify = { ...draft.notify, welcomeCardImageUrl: '' };
      await saveTenantSettings({ notify });
      patchNotify({ welcomeCardImageUrl: '' });
      toast.show(t.notification.welcomeCardImageRemoved);
    } catch (e) {
      toast.show(
        `${t.notification.welcomeCardImageRemoveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setWelcomeImageBusy(false);
    }
  };

  const savePoints = async () => {
    if (!draft) return;
    if (draft.points.pointEarnRate < 1 || draft.points.pointEarnRate > 1000) {
      toast.show(t.points.rateInvalid, 'warning');
      return;
    }
    await persist('points', { points: draft.points }, t.points.saved);
  };

  /* ------------------------------------------------------------ 小工具 */

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(message);
    } catch {
      toast.show(t.messages.networkError, 'warning');
    }
  };

  const publicUrl = draft ? buildPublicBookingUrl(APP_URL, draft.basic.shopCode) : '';

  const submitPasswordChange = async () => {
    setPasswordBusy(true);
    try {
      // 真的送到後端改密碼（POST /api/auth/change-password，03 分冊 §4：
      // 後端會先用 currentPassword 重新驗證一次，錯的話回 400 AUTH_002）。
      // 這裡先前是 480ms 的假延遲＋直接顯示「密碼已更改」——舊密碼其實永遠有效，
      // 是 00 分冊鐵則 12 點名的假成功；成功 toast 只能出現在 await 成功之後。
      await changePassword({ currentPassword, newPassword });
      setConfirmPasswordChange(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.show(t.security.changed);
    } catch (e) {
      toast.show(
        `${t.security.failedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setPasswordBusy(false);
    }
  };

  const requestPasswordChange = () => {
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) {
      toast.show(t.security.incomplete, 'warning');
      return;
    }
    setConfirmPasswordChange(true);
  };

  /* -------------------------------------------------------- 逐日營業時間 */

  const setPerDaySlots = (day: number, slots: { start: string; end: string }[]) => {
    setDraft((d) => {
      if (!d) return d;
      const next = d.business.perDayHours.map((s, i) => (i === day ? slots : s));
      return { ...d, business: { ...d.business, perDayHours: next } };
    });
  };

  const tabItems: TabItem[] = [
    { key: 'basic', label: t.tabs.basic, icon: Store },
    { key: 'business', label: t.tabs.business, icon: Clock },
    { key: 'notification', label: t.tabs.notification, icon: Bell },
    { key: 'points', label: t.tabs.points, icon: Coins },
    { key: 'calendarSync', label: t.tabs.calendarSync, icon: CalendarPlus },
    { key: 'security', label: t.tabs.security, icon: ShieldCheck },
  ];

  const amountNumber = Number(testAmount) || 0;
  const previewPoints = draft
    ? roundPoints(amountNumber / Math.max(draft.points.pointEarnRate, 1), draft.points.rounding)
    : 0;

  return (
    <>
      <PageHeader eyebrow={nav.navSystem} title={t.title} />

      <Tabs items={tabItems} value={tab} onChange={changeTab} />

      {loading || !draft ? (
        <Card className="mt-4">
          <CardBody className="py-10 text-center text-muted">{common.loading}</CardBody>
        </Card>
      ) : (
        <>
          {/* ============================================================ 基本資訊 */}
          <TabPanel active={tab === 'basic'}>
            <Alert tone="primary" className="mb-4" title={t.basic.publicUrl.title}>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Input className="w-full max-w-md bg-neutral-0" readOnly value={publicUrl} />
                <Button onClick={() => void copy(publicUrl, t.messages.copiedPublicUrl)}>
                  <ClipboardCopy size={14} />
                  {t.basic.publicUrl.copy}
                </Button>
                <Button
                  variant="outline"
                  aria-label={t.basic.publicUrl.openLabel}
                  title={t.basic.publicUrl.openLabel}
                  onClick={() => window.open(publicUrl, '_blank', 'noopener')}
                >
                  <ExternalLink size={14} />
                </Button>
              </div>
              <FormText>{t.basic.publicUrl.help}</FormText>
            </Alert>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store size={16} />
                  {t.basic.heading}
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="grid gap-x-4 md:grid-cols-2">
                  <FormGroup>
                    <Label required htmlFor="tenantName">{t.basic.tenantName}</Label>
                    <Input
                      id="tenantName"
                      value={draft.basic.tenantName}
                      placeholder={t.basic.tenantNamePlaceholder}
                      onChange={(e) => patchBasic({ tenantName: e.target.value })}
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="tenantPhone">{t.basic.tenantPhone}</Label>
                    <Input
                      id="tenantPhone"
                      type="tel"
                      value={draft.basic.tenantPhone}
                      placeholder={t.basic.tenantPhonePlaceholder}
                      onChange={(e) => patchBasic({ tenantPhone: e.target.value })}
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="tenantEmail">{t.basic.tenantEmail}</Label>
                    <Input
                      id="tenantEmail"
                      type="email"
                      value={draft.basic.tenantEmail}
                      placeholder={t.basic.tenantEmailPlaceholder}
                      onChange={(e) => patchBasic({ tenantEmail: e.target.value })}
                    />
                    <FormText>{t.basic.tenantEmailHelp}</FormText>
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="tenantAddress">{t.basic.tenantAddress}</Label>
                    <Input
                      id="tenantAddress"
                      value={draft.basic.tenantAddress}
                      placeholder={t.basic.tenantAddressPlaceholder}
                      onChange={(e) => patchBasic({ tenantAddress: e.target.value })}
                    />
                    <FormText>{t.basic.tenantAddressHelp}</FormText>
                  </FormGroup>
                </div>

                <FormGroup>
                  <Label htmlFor="tenantDescription">{t.basic.tenantDescription}</Label>
                  <Textarea
                    id="tenantDescription"
                    rows={3}
                    maxLength={t.basic.tenantDescriptionMax}
                    value={draft.basic.tenantDescription}
                    placeholder={t.basic.tenantDescriptionPlaceholder}
                    onChange={(e) => patchBasic({ tenantDescription: e.target.value })}
                  />
                  <div className="flex justify-end">
                    <CharCounter
                      value={draft.basic.tenantDescription}
                      max={t.basic.tenantDescriptionMax}
                    />
                  </div>
                </FormGroup>

                <div className="flex justify-end">
                  <Button
                    loading={savingSection === 'basic'}
                    loadingText={t.basic.saving}
                    onClick={() => void saveBasic()}
                  >
                    {t.basic.save}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </TabPanel>

          {/* ============================================================ 營業設定 */}
          <TabPanel active={tab === 'business'}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock size={16} />
                  {t.business.heading}
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Alert tone="neutral" className="mb-4">{t.business.intro}</Alert>

                <SwitchField
                  label={t.business.perDayMode}
                  description={t.business.perDayModeHelp}
                  checked={draft.business.perDayMode}
                  onCheckedChange={(v) => patchBusiness({ perDayMode: v })}
                >
                  <Alert tone="info" className="mb-3 text-xs">{t.business.perDayNotice}</Alert>
                  <div className="flex flex-col gap-2">
                    {common.weekdays.map((label, day) => {
                      const slots = draft.business.perDayHours[day] ?? [];
                      const open = slots.length > 0;
                      return (
                        <div
                          key={label}
                          className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-250 px-3 py-2"
                        >
                          <label className="flex w-24 items-center gap-1.5 text-xs font-semibold text-neutral-700">
                            <input
                              type="checkbox"
                              checked={open}
                              onChange={(e) =>
                                setPerDaySlots(
                                  day,
                                  e.target.checked ? [{ start: '09:00', end: '18:00' }] : [],
                                )
                              }
                            />
                            {label}
                          </label>
                          {open ? (
                            <>
                              {slots.map((slot, idx) => (
                                <span key={`${label}-${idx}`} className="flex items-center gap-1">
                                  <Select
                                    className="form-select-sm w-auto"
                                    aria-label={`${label} ${t.business.businessStart}`}
                                    value={slot.start}
                                    onChange={(e) =>
                                      setPerDaySlots(
                                        day,
                                        slots.map((s, i) =>
                                          i === idx ? { ...s, start: e.target.value } : s,
                                        ),
                                      )
                                    }
                                    options={TIME_OPTIONS.map((v) => ({ value: v, label: v }))}
                                  />
                                  <span className="text-xs text-secondary">{t.business.perDayTo}</span>
                                  <Select
                                    className="form-select-sm w-auto"
                                    aria-label={`${label} ${t.business.businessEnd}`}
                                    value={slot.end}
                                    onChange={(e) =>
                                      setPerDaySlots(
                                        day,
                                        slots.map((s, i) =>
                                          i === idx ? { ...s, end: e.target.value } : s,
                                        ),
                                      )
                                    }
                                    options={TIME_OPTIONS.map((v) => ({ value: v, label: v }))}
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t.business.perDayRemoveSlot}
                                    title={t.business.perDayRemoveSlot}
                                    onClick={() =>
                                      setPerDaySlots(day, slots.filter((_, i) => i !== idx))
                                    }
                                  >
                                    <Trash2 size={13} />
                                  </Button>
                                </span>
                              ))}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setPerDaySlots(day, [...slots, { start: '09:00', end: '18:00' }])
                                }
                              >
                                <Plus size={13} />
                                {t.business.perDayAddSlot}
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-muted">{t.business.perDayClosed}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </SwitchField>

                {!draft.business.perDayMode ? (
                  <div className="mt-4 grid gap-x-4 md:grid-cols-2">
                    <FormGroup>
                      <Label required htmlFor="businessStart">{t.business.businessStart}</Label>
                      <Select
                        id="businessStart"
                        value={draft.business.businessStart}
                        onChange={(e) => patchBusiness({ businessStart: e.target.value })}
                        options={TIME_OPTIONS.map((v) => ({ value: v, label: v }))}
                      />
                    </FormGroup>

                    <FormGroup>
                      <Label required htmlFor="businessEnd">{t.business.businessEnd}</Label>
                      <Select
                        id="businessEnd"
                        value={draft.business.businessEnd}
                        onChange={(e) => patchBusiness({ businessEnd: e.target.value })}
                        options={TIME_OPTIONS.map((v) => ({ value: v, label: v }))}
                      />
                    </FormGroup>

                    <FormGroup>
                      <Label htmlFor="breakStart">{t.business.breakStart}</Label>
                      <Select
                        id="breakStart"
                        value={draft.business.breakStart}
                        onChange={(e) => patchBusiness({ breakStart: e.target.value })}
                      >
                        <option value="">{common.none}</option>
                        {TIME_OPTIONS.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </Select>
                      <FormText>{t.business.breakStartHelp}</FormText>
                    </FormGroup>

                    <FormGroup>
                      <Label htmlFor="breakEnd">{t.business.breakEnd}</Label>
                      <Select
                        id="breakEnd"
                        value={draft.business.breakEnd}
                        onChange={(e) => patchBusiness({ breakEnd: e.target.value })}
                      >
                        <option value="">{common.none}</option>
                        {TIME_OPTIONS.map((v) => (
                          <option key={v} value={v}>{v}</option>
                        ))}
                      </Select>
                      <FormText>{t.business.breakEndHelp}</FormText>
                    </FormGroup>
                  </div>
                ) : null}

                <div className="grid gap-x-4 md:grid-cols-2">
                  <FormGroup>
                    <Label htmlFor="slotInterval">{t.business.slotInterval}</Label>
                    <Select
                      id="slotInterval"
                      value={String(draft.business.slotInterval)}
                      onChange={(e) =>
                        patchBusiness({
                          slotInterval: Number(e.target.value) as TenantSettings['business']['slotInterval'],
                        })
                      }
                      options={[...t.business.slotIntervalOptions]}
                    />
                    <FormText>{t.business.slotIntervalHelp}</FormText>
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="advanceBookingValue">{t.business.advanceBooking}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="advanceBookingValue"
                        type="number"
                        min={1}
                        className="w-28"
                        value={String(draft.business.advanceBookingValue)}
                        onChange={(e) =>
                          patchBusiness({ advanceBookingValue: Number(e.target.value) || 1 })
                        }
                      />
                      <Select
                        className="w-28"
                        aria-label={t.business.advanceBooking}
                        value={draft.business.advanceBookingUnit}
                        onChange={(e) =>
                          patchBusiness({
                            advanceBookingUnit: e.target
                              .value as TenantSettings['business']['advanceBookingUnit'],
                          })
                        }
                        options={[...t.business.advanceBookingUnits]}
                      />
                    </div>
                    <FormText>
                      {draft.business.advanceBookingUnit === 'MONTH'
                        ? t.business.advanceBookingHelpMonth(draft.business.advanceBookingValue)
                        : t.business.advanceBookingHelpDay(draft.business.advanceBookingValue)}
                    </FormText>
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="minAdvanceBookingDays">{t.business.minAdvanceBookingDays}</Label>
                    <Input
                      id="minAdvanceBookingDays"
                      type="number"
                      min={0}
                      value={String(draft.business.minAdvanceBookingDays)}
                      onChange={(e) =>
                        patchBusiness({ minAdvanceBookingDays: Number(e.target.value) || 0 })
                      }
                    />
                    <FormText>{t.business.minAdvanceBookingDaysHelp}</FormText>
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="bookingCutoffDate">{t.business.bookingCutoffDate}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="bookingCutoffDate"
                        type="date"
                        value={draft.business.bookingCutoffDate}
                        onChange={(e) => patchBusiness({ bookingCutoffDate: e.target.value })}
                      />
                      <Button
                        variant="secondary"
                        onClick={() => patchBusiness({ bookingCutoffDate: '' })}
                      >
                        {t.business.bookingCutoffClear}
                      </Button>
                    </div>
                    <FormText>{t.business.bookingCutoffHelp}</FormText>
                    {draft.business.bookingCutoffDate ? (
                      <FormText>
                        {t.business.bookingCutoffSummary(draft.business.bookingCutoffDate)}
                        {t.business.bookingCutoffSummarySuffix}
                      </FormText>
                    ) : null}
                  </FormGroup>
                </div>

                <FormGroup>
                  <Label>{t.business.closedDays}</Label>
                  <div className="flex flex-wrap gap-3">
                    {common.weekdays.map((label, day) => (
                      <label key={label} className="flex items-center gap-1.5 text-base text-neutral-700">
                        <input
                          type="checkbox"
                          checked={draft.business.closedDays.includes(day)}
                          onChange={(e) =>
                            patchBusiness({
                              closedDays: e.target.checked
                                ? [...draft.business.closedDays, day].sort((a, b) => a - b)
                                : draft.business.closedDays.filter((x) => x !== day),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <FormText>{t.business.closedDaysHelp}</FormText>
                </FormGroup>

                <div className="mt-4 flex justify-end">
                  <Button
                    loading={savingSection === 'business'}
                    loadingText={t.business.saving}
                    onClick={() => void saveBusiness()}
                  >
                    {t.business.save}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </TabPanel>

          {/* ============================================================ 通知設定 */}
          <TabPanel active={tab === 'notification'}>
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell size={16} />
                  {t.notification.heading}
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Alert tone="neutral" className="mb-3">{t.notification.intro}</Alert>
                <Alert tone="info" className="mb-4 text-xs" title={t.notification.quotaTipTitle}>
                  {t.notification.quotaTipBody}
                </Alert>

                {/* ---- 顧客通知 ---- */}
                <h3 className="mb-3 flex items-center gap-2 text-md font-bold text-dark">
                  <Bell size={15} />
                  {t.notification.customerSection}
                </h3>
                <SwitchField
                  label={t.notification.bookingReminder}
                  description={
                    <>
                      <div>{t.notification.bookingReminderHelp}</div>
                      <div>
                        <strong>{t.notification.featureLock.names.reminder}</strong>
                        {t.notification.featureLock.reminder}
                      </div>
                    </>
                  }
                  checked={draft.notify.notifyBookingReminder}
                  onCheckedChange={(v) => patchNotify({ notifyBookingReminder: v })}
                >
                  <div className="w-56">
                    <Label className="text-xs" htmlFor="reminderHoursBefore">
                      {t.notification.reminderHoursBefore}
                    </Label>
                    <Select
                      id="reminderHoursBefore"
                      className="form-select-sm"
                      value={String(draft.notify.reminderHoursBefore)}
                      onChange={(e) => patchNotify({ reminderHoursBefore: Number(e.target.value) })}
                      options={[...t.notification.reminderHoursOptions]}
                    />
                  </div>
                </SwitchField>

                {/* ---- 生日祝福與顧客喚回 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <Gift size={15} />
                  {t.notification.birthdaySection}
                </h3>
                <SwitchField
                  label={t.notification.birthdayGreeting}
                  description={
                    <>
                      <div>{t.notification.birthdayGreetingHelp}</div>
                      <div>
                        <strong>{t.notification.featureLock.names.birthday}</strong>
                        {t.notification.featureLock.birthday}
                      </div>
                    </>
                  }
                  checked={draft.notify.enableBirthdayGreeting}
                  onCheckedChange={(v) => patchNotify({ enableBirthdayGreeting: v })}
                >
                  <div className="w-full max-w-lg">
                    <Label className="text-xs" htmlFor="birthdayGreetingMessage">
                      {t.notification.birthdayMessage}
                    </Label>
                    <Textarea
                      id="birthdayGreetingMessage"
                      rows={2}
                      className="form-control-sm"
                      value={draft.notify.birthdayGreetingMessage}
                      placeholder={t.notification.birthdayMessagePlaceholder}
                      onChange={(e) => patchNotify({ birthdayGreetingMessage: e.target.value })}
                    />
                  </div>
                </SwitchField>

                <SwitchField
                  label={t.notification.customerRecall}
                  description={
                    <>
                      <div>{t.notification.customerRecallHelp}</div>
                      <div>
                        <strong>{t.notification.featureLock.names.recall}</strong>
                        {t.notification.featureLock.recall}
                      </div>
                    </>
                  }
                  checked={draft.notify.enableCustomerRecall}
                  onCheckedChange={(v) => patchNotify({ enableCustomerRecall: v })}
                >
                  <div className="flex flex-col gap-3">
                    <div className="w-56">
                      <Label className="text-xs" htmlFor="customerRecallDays">
                        {t.notification.customerRecallDays}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="customerRecallDays"
                          type="number"
                          min={1}
                          className="form-control-sm w-24"
                          value={String(draft.notify.customerRecallDays)}
                          onChange={(e) =>
                            patchNotify({ customerRecallDays: Number(e.target.value) || 1 })
                          }
                        />
                        <span className="text-xs text-secondary">
                          {t.notification.customerRecallDaysUnit}
                        </span>
                      </div>
                    </div>
                    <div className="w-full max-w-lg">
                      <Label className="text-xs" htmlFor="customerRecallMessage">
                        {t.notification.customerRecallMessage}
                      </Label>
                      <Textarea
                        id="customerRecallMessage"
                        rows={2}
                        className="form-control-sm"
                        value={draft.notify.customerRecallMessage}
                        placeholder={t.notification.customerRecallMessagePlaceholder}
                        onChange={(e) => patchNotify({ customerRecallMessage: e.target.value })}
                      />
                    </div>
                  </div>
                </SwitchField>

                {/* ---- LINE 預約狀態推播 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <MessageSquareText size={15} />
                  {t.notification.lineSection}
                </h3>
                <SwitchField
                  label={t.notification.bookingConfirmed}
                  description={t.notification.bookingConfirmedHelp}
                  checked={draft.notify.notifyBookingConfirmed}
                  onCheckedChange={(v) => patchNotify({ notifyBookingConfirmed: v })}
                />
                <SwitchField
                  label={t.notification.bookingCompleted}
                  description={t.notification.bookingCompletedHelp}
                  checked={draft.notify.notifyBookingCompleted}
                  onCheckedChange={(v) => patchNotify({ notifyBookingCompleted: v })}
                />
                <SwitchField
                  label={t.notification.bookingCancelled}
                  description={t.notification.bookingCancelledHelp}
                  checked={draft.notify.notifyBookingCancelled}
                  onCheckedChange={(v) => patchNotify({ notifyBookingCancelled: v })}
                />
                <SwitchField
                  label={t.notification.bookingModified}
                  description={t.notification.bookingModifiedHelp}
                  checked={draft.notify.notifyBookingModified}
                  onCheckedChange={(v) => patchNotify({ notifyBookingModified: v })}
                />
                <SwitchField
                  label={t.notification.bookingNoShow}
                  description={t.notification.bookingNoShowHelp}
                  checked={draft.notify.notifyBookingNoShow}
                  onCheckedChange={(v) => patchNotify({ notifyBookingNoShow: v })}
                />

                {/* ---- Email 預約通知 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <Mail size={15} />
                  {t.notification.emailSection}
                </h3>
                <Alert
                  tone="warning"
                  className="mb-3"
                  action={
                    <Link className="btn btn-outline btn-sm" href="/tenant/feature-store">
                      {t.notification.emailLockedCta}
                    </Link>
                  }
                >
                  {t.notification.emailLocked}
                </Alert>
                <SwitchField
                  label={t.notification.newBooking}
                  description={t.notification.newBookingHelp}
                  checked={draft.notify.notifyNewBooking}
                  onCheckedChange={(v) => patchNotify({ notifyNewBooking: v })}
                />
                <SwitchField
                  label={t.notification.bookingCancel}
                  description={t.notification.bookingCancelHelp}
                  checked={draft.notify.notifyBookingCancel}
                  onCheckedChange={(v) => patchNotify({ notifyBookingCancel: v })}
                />
                <SwitchField
                  label={t.notification.staffBooking}
                  description={t.notification.staffBookingHelp}
                  checked={draft.notify.notifyStaffBooking}
                  onCheckedChange={(v) => patchNotify({ notifyStaffBooking: v })}
                />
                <SwitchField
                  label={t.notification.productOrder}
                  description={t.notification.productOrderHelp}
                  checked={draft.notify.notifyProductOrder}
                  onCheckedChange={(v) => patchNotify({ notifyProductOrder: v })}
                />

                {/* ---- 預約自動確認 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <Zap size={15} />
                  {t.notification.autoConfirmSection}
                </h3>
                <SwitchField
                  label={t.notification.autoConfirm}
                  description={
                    <>
                      <div>{t.notification.autoConfirmHelp}</div>
                      <div>{t.notification.autoConfirmHelpExtra}</div>
                      <div>{t.notification.autoConfirmOffHint}</div>
                    </>
                  }
                  checked={draft.business.autoConfirmEnabled}
                  onCheckedChange={(v) => patchBusiness({ autoConfirmEnabled: v })}
                />

                {/* ---- 商品訂單線上收款 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <ShoppingCart size={15} />
                  {t.notification.productPaymentSection}
                </h3>
                <SwitchField
                  label={t.notification.productOnlinePayment}
                  description={
                    <>
                      <div>{t.notification.productOnlinePaymentHelp}</div>
                      <div>{t.notification.productOnlinePaymentPrereq}</div>
                      <div>{t.notification.paymentGatewayNone}</div>
                    </>
                  }
                  checked={draft.business.productOnlinePaymentEnabled}
                  onCheckedChange={(v) => patchBusiness({ productOnlinePaymentEnabled: v })}
                />

                {/* ---- 強制指定服務人員 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <UserCheck size={15} />
                  {t.notification.staffMandatorySection}
                </h3>
                <SwitchField
                  label={t.notification.staffMandatory}
                  description={
                    <>
                      <div>{t.notification.staffMandatoryHelp}</div>
                      <div>{t.notification.staffMandatoryOffHint}</div>
                      <div>{resolveNavTerms(t.notification.staffMandatoryNotice, businessType)}</div>
                    </>
                  }
                  checked={draft.business.staffSelectionMandatory}
                  onCheckedChange={(v) => patchBusiness({ staffSelectionMandatory: v })}
                />

                {/* ---- 隱私防護 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <Lock size={15} />
                  {t.notification.privacySection}
                </h3>
                <SwitchField
                  label={t.notification.privacyProtection}
                  description={
                    <>
                      <div>{t.notification.privacyProtectionHelp}</div>
                      <div>{t.notification.privacyProtectionExtra}</div>
                    </>
                  }
                  checked={draft.privacy.privacyProtectionEnabled}
                  onCheckedChange={(v) => patchPrivacy({ privacyProtectionEnabled: v })}
                />
                <SwitchField
                  label={t.notification.collectEmail}
                  description={
                    <>
                      <div>{t.notification.collectEmailHelp}</div>
                      <div>{t.notification.collectEmailExtra}</div>
                      <div>{t.notification.collectEmailTip}</div>
                    </>
                  }
                  checked={draft.privacy.collectCustomerEmailEnabled}
                  onCheckedChange={(v) => patchPrivacy({ collectCustomerEmailEnabled: v })}
                />
                <SwitchField
                  label={t.notification.collectBirthday}
                  description={
                    <>
                      <div>{t.notification.collectBirthdayHelp}</div>
                      <div>{t.notification.collectBirthdayExtra}</div>
                    </>
                  }
                  checked={draft.privacy.collectCustomerBirthdayEnabled}
                  onCheckedChange={(v) => patchPrivacy({ collectCustomerBirthdayEnabled: v })}
                />
                <SwitchField
                  label={t.notification.collectGender}
                  description={t.notification.collectGenderHelp}
                  checked={draft.privacy.collectCustomerGenderEnabled}
                  onCheckedChange={(v) => patchPrivacy({ collectCustomerGenderEnabled: v })}
                />
                <SwitchField
                  label={t.notification.deferProfile}
                  description={
                    <>
                      <div>{t.notification.deferProfileHelp}</div>
                      <div>{t.notification.deferProfileExtra}</div>
                    </>
                  }
                  checked={draft.privacy.deferProfileCollectionEnabled}
                  onCheckedChange={(v) => patchPrivacy({ deferProfileCollectionEnabled: v })}
                />

                {/* ---- 加好友歡迎訊息 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <MessageSquareText size={15} />
                  {t.notification.welcomeSection}
                </h3>

                <FormGroup>
                  <Label htmlFor="welcomeMessageText">{t.notification.welcomeMessageText}</Label>
                  <Textarea
                    id="welcomeMessageText"
                    rows={2}
                    value={draft.notify.welcomeMessageText}
                    placeholder={t.notification.welcomeMessageTextPlaceholder}
                    onChange={(e) => patchNotify({ welcomeMessageText: e.target.value })}
                  />
                  <FormText>{t.notification.welcomeMessageTextHelp}</FormText>
                </FormGroup>

                <FormGroup>
                  <Label htmlFor="welcomeCardTitle">{t.notification.welcomeCardTitle}</Label>
                  <Input
                    id="welcomeCardTitle"
                    value={draft.notify.welcomeCardTitle}
                    placeholder={t.notification.welcomeCardTitlePlaceholder}
                    onChange={(e) => patchNotify({ welcomeCardTitle: e.target.value })}
                  />
                  <FormText>{t.notification.welcomeCardTitleHelp}</FormText>
                </FormGroup>

                <FormGroup>
                  <Label>{t.notification.welcomeCardImage}</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="w-full max-w-md"
                      value={draft.notify.welcomeCardImageUrl}
                      placeholder={t.notification.welcomeCardImage}
                      onChange={(e) => patchNotify({ welcomeCardImageUrl: e.target.value })}
                    />
                    {/*
                      * issue #28 ⑥：這顆鈕以前的 onClick 整個內容就是一句
                      * toast.show('歡迎卡片圖片已更新')。現在是
                      *   選檔 → uploadImage(file,'welcome-card-images') → POST /api/upload
                      *        → saveTenantSettings({notify}) → PUT /api/settings
                      * 成功訊息排在兩個 await **之後**。禁止改回只跳 toast。
                      */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={welcomeImageBusy}
                      onClick={() => welcomeImageFileRef.current?.click()}
                    >
                      <Upload size={13} />
                      {welcomeImageBusy ? common.loading : t.notification.welcomeCardImageUpload}
                    </Button>
                    <input
                      ref={welcomeImageFileRef}
                      type="file"
                      className="hidden"
                      /* LINE 的圖片訊息只收 JPEG / PNG，見 /api/upload 的 LINE_BOUND_BUCKETS */
                      accept="image/jpeg,image/png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadWelcomeCardImage(file);
                      }}
                    />
                    {draft.notify.welcomeCardImageUrl ? (
                      <Button
                        variant="outlineDanger"
                        size="sm"
                        disabled={welcomeImageBusy}
                        onClick={() => { void removeWelcomeCardImage(); }}
                      >
                        <Trash2 size={13} />
                        {t.notification.welcomeCardImageRemove}
                      </Button>
                    ) : null}
                  </div>
                </FormGroup>

                <FormGroup>
                  <Label htmlFor="welcomeFeatureListText">
                    {t.notification.welcomeFeatureListText}
                  </Label>
                  <Textarea
                    id="welcomeFeatureListText"
                    rows={4}
                    value={draft.notify.welcomeFeatureListText}
                    placeholder={t.notification.welcomeFeatureListTextPlaceholder}
                    onChange={(e) => patchNotify({ welcomeFeatureListText: e.target.value })}
                  />
                  <FormText>{t.notification.welcomeFeatureListTextHelp}</FormText>
                </FormGroup>

                <FormGroup>
                  <Label htmlFor="profileCollectIntroText">
                    {t.notification.profileCollectIntroText}
                  </Label>
                  <Textarea
                    id="profileCollectIntroText"
                    rows={2}
                    value={draft.notify.profileCollectIntroText}
                    placeholder={t.notification.profileCollectIntroTextPlaceholder}
                    onChange={(e) => patchNotify({ profileCollectIntroText: e.target.value })}
                  />
                  <FormText>{t.notification.profileCollectIntroTextHelp}</FormText>
                </FormGroup>

                <FormGroup>
                  <Label htmlFor="profileCollectDoneText">
                    {t.notification.profileCollectDoneText}
                  </Label>
                  <Textarea
                    id="profileCollectDoneText"
                    rows={2}
                    value={draft.notify.profileCollectDoneText}
                    placeholder={t.notification.profileCollectDoneTextPlaceholder}
                    onChange={(e) => patchNotify({ profileCollectDoneText: e.target.value })}
                  />
                  <FormText>{t.notification.profileCollectDoneTextHelp}</FormText>
                </FormGroup>

                {/* ---- 預約自訂欄位 ---- */}
                <h3 className="mb-3 mt-6 flex items-center gap-2 text-md font-bold text-dark">
                  <Info size={15} />
                  {t.notification.customFieldsSection}
                </h3>
                <FormGroup>
                  <Label htmlFor="bookingCustomFieldsText">
                    {t.notification.bookingCustomFields}
                  </Label>
                  <Textarea
                    id="bookingCustomFieldsText"
                    rows={3}
                    value={draft.business.bookingCustomFields}
                    placeholder={t.notification.bookingCustomFieldsPlaceholder}
                    onChange={(e) => patchBusiness({ bookingCustomFields: e.target.value })}
                  />
                  <FormText>{t.notification.bookingCustomFieldsHelp}</FormText>
                </FormGroup>

                <div className="flex justify-end">
                  <Button
                    loading={savingSection === 'notification'}
                    loadingText={t.notification.saving}
                    onClick={() => void saveNotification()}
                  >
                    {t.notification.save}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </TabPanel>

          {/* ============================================================ 點數設定 */}
          <TabPanel active={tab === 'points'}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coins size={16} />
                  {t.points.heading}
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Alert tone="info" className="mb-4">{t.points.intro}</Alert>
                <Alert tone="warning" className="mb-4 text-xs">
                  <strong>{t.points.featureLockName}</strong>
                  {t.points.featureLock}
                </Alert>

                <SwitchField
                  label={t.points.earnEnabled}
                  description={t.points.earnEnabledHelp}
                  checked={draft.points.pointEarnEnabled}
                  onCheckedChange={(v) => patchPoints({ pointEarnEnabled: v })}
                >
                  <div className="flex flex-col gap-4">
                    <div>
                      <Label className="text-xs" htmlFor="pointEarnRate">{t.points.earnRate}</Label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-secondary">{t.points.earnRatePrefix}</span>
                        <Input
                          id="pointEarnRate"
                          type="number"
                          min={1}
                          max={1000}
                          className="w-28"
                          value={String(draft.points.pointEarnRate)}
                          onChange={(e) =>
                            patchPoints({ pointEarnRate: Number(e.target.value) || 0 })
                          }
                        />
                        <span className="text-xs text-secondary">{t.points.earnRateSuffix}</span>
                      </div>
                      <FormText>{t.points.earnRateHelp}</FormText>
                    </div>

                    <div>
                      <Label className="text-xs">{t.points.roundingTitle}</Label>
                      <div className="flex flex-col gap-2">
                        <label className="flex items-start gap-2 text-base text-neutral-700">
                          <input
                            type="radio"
                            name="pointRoundMode"
                            className="mt-1"
                            checked={draft.points.rounding === 'FLOOR'}
                            onChange={() => patchPoints({ rounding: 'FLOOR' })}
                          />
                          <span>
                            <span className="font-semibold">{t.points.roundingFloor}</span>
                            <Badge tone="success" className="ml-1">{t.points.roundingFloorTag}</Badge>
                            <span className="form-text block">{t.points.roundingFloorExample}</span>
                          </span>
                        </label>
                        <label className="flex items-start gap-2 text-base text-neutral-700">
                          <input
                            type="radio"
                            name="pointRoundMode"
                            className="mt-1"
                            checked={draft.points.rounding === 'ROUND'}
                            onChange={() => patchPoints({ rounding: 'ROUND' })}
                          />
                          <span>
                            <span className="font-semibold">{t.points.roundingRound}</span>
                            <span className="form-text block">{t.points.roundingRoundExample}</span>
                          </span>
                        </label>
                        <label className="flex items-start gap-2 text-base text-neutral-700">
                          <input
                            type="radio"
                            name="pointRoundMode"
                            className="mt-1"
                            checked={draft.points.rounding === 'CEIL'}
                            onChange={() => patchPoints({ rounding: 'CEIL' })}
                          />
                          <span>
                            <span className="font-semibold">{t.points.roundingCeil}</span>
                            <span className="form-text block">{t.points.roundingCeilExample}</span>
                          </span>
                        </label>
                      </div>
                    </div>

                    {/* 點數試算 */}
                    <Card className="bg-neutral-50">
                      <CardBody>
                        <div className="mb-2 flex items-center gap-2 text-base font-bold text-dark">
                          <Calculator size={15} />
                          {t.points.calculatorTitle}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Label className="mb-0 text-xs" htmlFor="testAmount">
                            {t.points.calculatorAmount}
                          </Label>
                          <span className="text-xs text-secondary">
                            {t.points.calculatorCurrency}
                          </span>
                          <Input
                            id="testAmount"
                            type="number"
                            min={0}
                            className="w-32"
                            value={testAmount}
                            onChange={(e) => setTestAmount(e.target.value)}
                          />
                          <ChevronRight size={14} className="text-secondary" />
                          <Badge tone="primary">{t.points.calculatorResult(previewPoints)}</Badge>
                        </div>
                      </CardBody>
                    </Card>
                  </div>
                </SwitchField>

                <div className="mt-4 flex justify-end">
                  <Button
                    loading={savingSection === 'points'}
                    loadingText={t.points.saving}
                    onClick={() => void savePoints()}
                  >
                    {t.points.save}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </TabPanel>

          {/* ========================================================== 行事曆同步 */}
          <TabPanel active={tab === 'calendarSync'}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarPlus size={16} />
                  {t.calendarSync.heading}
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Alert tone="neutral" className="mb-4">{t.calendarSync.intro}</Alert>

                <Alert tone="warning" title={t.calendarSync.notBuilt.title} className="mb-4">
                  {t.calendarSync.notBuilt.body}
                </Alert>

                {/*
                  * ⚠️ 沒有 ICS 端點就沒有可用的訂閱網址：欄位不可再填入任何看起來
                  * 像真網址的字串，複製／加入 Google／重新產生一律停用（見檔案上方註解）。
                  */}
                <FormGroup>
                  <Label htmlFor="calIcsUrl">{t.calendarSync.urlLabel}</Label>
                  <Input
                    id="calIcsUrl" readOnly disabled
                    value={t.calendarSync.notBuilt.urlUnavailable}
                  />
                </FormGroup>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled title={t.calendarSync.notBuilt.disabledHint}>
                    <CalendarPlus size={14} />
                    {t.calendarSync.google}
                  </Button>
                  <Button variant="secondary" disabled title={t.calendarSync.notBuilt.disabledHint}>
                    {t.calendarSync.copy}
                  </Button>
                  <Button
                    variant="outlineDanger" size="sm"
                    disabled title={t.calendarSync.notBuilt.disabledHint}
                  >
                    <RotateCcw size={13} />
                    {t.calendarSync.regenerate}
                  </Button>
                </div>

                <FormText className="mt-3">
                  <Link className="underline" href="/tenant/calendar-sync">
                    {t.calendarSync.moreLinkText}
                  </Link>
                </FormText>
              </CardBody>
            </Card>
          </TabPanel>

          {/* ============================================================ 帳號安全 */}
          <TabPanel active={tab === 'security'}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck size={16} />
                  {t.security.heading}
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Alert tone="warning" className="mb-4">{t.security.warning}</Alert>

                <div className="max-w-md">
                  <FormGroup>
                    <Label required htmlFor="currentPassword">{t.security.currentPassword}</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label required htmlFor="newPassword">{t.security.newPassword}</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <FormText>{t.security.newPasswordHelp}</FormText>
                  </FormGroup>

                  <FormGroup>
                    <Label required htmlFor="confirmPassword">{t.security.confirmPassword}</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </FormGroup>

                  <Button
                    loading={passwordBusy}
                    loadingText={t.security.submitting}
                    onClick={requestPasswordChange}
                  >
                    <KeyRound size={14} />
                    {t.security.submit}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </TabPanel>
        </>
      )}

      {/* ------------------------------------------------ 確認：更改密碼 */}
      <ConfirmModal
        open={confirmPasswordChange}
        loading={passwordBusy}
        title={t.security.confirmTitle}
        confirmText={t.security.submit}
        message={t.security.confirmMessage}
        onClose={() => setConfirmPasswordChange(false)}
        onConfirm={() => void submitPasswordChange()}
      />
    </>
  );
}
