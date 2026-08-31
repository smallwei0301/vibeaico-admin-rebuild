'use client';
import * as React from 'react';
import {
  BadgeCheck, CreditCard, ExternalLink, Pencil, Plus, ShieldCheck, Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardFooter } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, Select, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { common } from '@/i18n/zh-TW/common';
import { nav, resolveNavTerms } from '@/i18n/zh-TW/nav';
import { useBusinessType } from '@/components/layout/BusinessTypeContext';
import { paymentMethodsPage as t } from '@/i18n/zh-TW/pages/payment-methods';
import { formatNumber } from '@/lib/utils';
import { USE_MOCK } from '@/config/env';
import {
  createPaymentMethod, deletePaymentMethod, listPaymentMethods, testPaymentCharge,
  testPaymentConnection, togglePaymentMethodActive, updatePaymentMethod,
  type PaymentMethodPayload,
} from '@/services/payment-methods';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type MethodType = 'LINE_PAY' | 'JKOPAY' | 'BANK_TRANSFER' | 'CASH' | 'ONLINE_PAYMENT' | 'OTHER';
type GatewaySource = 'own' | 'demo';
type GatewayProvider = 'NEWEBPAY' | 'ECPAY';

/** 原站 /api/payment-methods */
type PaymentMethod = {
  id: string;
  methodType: MethodType | '';
  displayName: string;
  qrImageUrl: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  gatewaySource: GatewaySource;
  gatewayProvider: GatewayProvider;
  gatewayMerchantId: string;
  /** 🔐 後端回傳一律遮罩；沒重新輸入就送空字串代表不變更 */
  gatewayHashKeySet: boolean;
  gatewayHashIvSet: boolean;
  gatewaySandbox: boolean;
  /** 實刷小額測試完成才算完整收款流程驗證 */
  gatewayVerified: boolean;
  connectionVerified?: boolean;
  e2eVerified?: boolean;
  verificationError?: string | null;
  gatewayHashKey?: string;
  gatewayHashIv?: string;
  sortOrder: number;
  active: boolean;
  instructions: string;
};

const MOCK_METHODS: PaymentMethod[] = [
  {
    id: 'pm_1', methodType: 'LINE_PAY', displayName: 'LINE Pay', qrImageUrl: 'line-pay-qr.png',
    bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
    gatewaySource: 'own', gatewayProvider: 'NEWEBPAY', gatewayMerchantId: '',
    gatewayHashKeySet: false, gatewayHashIvSet: false, gatewaySandbox: false,
    gatewayVerified: false, sortOrder: 1, active: true, instructions: '轉帳後請於 LINE 傳送截圖給我們核對。',
  },
  {
    id: 'pm_2', methodType: 'BANK_TRANSFER', displayName: '國泰世華銀行', qrImageUrl: '',
    bankName: '國泰世華銀行', bankCode: '013', accountNumber: '1234-5678-9012', accountHolderName: '王小明',
    gatewaySource: 'own', gatewayProvider: 'NEWEBPAY', gatewayMerchantId: '',
    gatewayHashKeySet: false, gatewayHashIvSet: false, gatewaySandbox: false,
    gatewayVerified: false, sortOrder: 2, active: true, instructions: '',
  },
  {
    id: 'pm_3', methodType: 'ONLINE_PAYMENT', displayName: '線上刷卡付款', qrImageUrl: '',
    bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
    gatewaySource: 'demo', gatewayProvider: 'ECPAY', gatewayMerchantId: '2000132',
    gatewayHashKeySet: true, gatewayHashIvSet: true, gatewaySandbox: true,
    gatewayVerified: false, sortOrder: 3, active: false, instructions: '',
  },
  {
    id: 'pm_4', methodType: 'CASH', displayName: '現金', qrImageUrl: '',
    bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
    gatewaySource: 'own', gatewayProvider: 'NEWEBPAY', gatewayMerchantId: '',
    gatewayHashKeySet: false, gatewayHashIvSet: false, gatewaySandbox: false,
    gatewayVerified: false, sortOrder: 4, active: true, instructions: '',
  },
];

/**
 * 原站 inline JS 的銀行代碼對照。
 * 索引與 i18n 的 `paymentMethodsPage.banks` 一一對應，避免在頁面重複寫銀行名稱。
 */
const BANK_CODES: string[] = [
  '004', '005', '006', '007', '008', '009', '011', '012', '013', '016',
  '017', '050', '052', '053', '054', '081', '021', '810', '103', '108',
  '147', '803', '805', '806', '807', '808', '809', '812', '816', '822',
  '809', '118', '389', '824', '823', '700', '',
];

const bankCodeOf = (name: string): string => {
  const i = t.banks.indexOf(name as (typeof t.banks)[number]);
  return i >= 0 ? BANK_CODES[i] : '';
};

/** 藍新申請頁 */
const NEWEBPAY_APPLY_URL = 'https://www.newebpay.com/';

const QR_MAX_BYTES = 5 * 1024 * 1024;

const NEEDS_QR: MethodType[] = ['LINE_PAY', 'JKOPAY', 'OTHER'];
const NEEDS_BANK: MethodType[] = ['BANK_TRANSFER'];

/* -------------------------------------------------------------------------- */

export default function PaymentMethodsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<PaymentMethod[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [formTarget, setFormTarget] = React.useState<PaymentMethod | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = React.useState<PaymentMethod | null>(null);
  const [testTarget, setTestTarget] = React.useState<PaymentMethod | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  const nextId = React.useRef(1);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      if (USE_MOCK) {
        setRows([...MOCK_METHODS].sort((a, b) => a.sortOrder - b.sortOrder));
      } else {
        const data = await listPaymentMethods();
        setRows((data ?? []) as PaymentMethod[]);
      }
    } catch (e) {
      toast.show(
        `${t.messages.loadFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const toggleActive = async (m: PaymentMethod) => {
    try {
      if (USE_MOCK) {
        setRows((list) => list.map((x) => (x.id === m.id ? { ...x, active: !x.active } : x)));
      } else {
        const saved = await togglePaymentMethodActive(m.id, !m.active);
        if (saved) upsert(saved as PaymentMethod);
      }
      toast.show(t.messages.statusUpdated, 'success');
    } catch (e) {
      toast.show(
        `${t.messages.toggleFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    }
  };

  const checkConnection = async (m: PaymentMethod) => {
    try {
      if (USE_MOCK) {
        toast.show(t.testCharge.checkIncomplete, 'warning');
        return;
      }
      const result = await testPaymentConnection(m.id);
      if (result?.method) upsert(result.method as PaymentMethod);
      toast.show(
        result?.message ?? t.testCharge.checkIncomplete,
        result?.ok ? 'success' : 'warning',
      );
    } catch (e) {
      toast.show(
        `${t.messages.connectionError}${e instanceof Error ? ` ${e.message}` : ''}`,
        'danger',
      );
    }
  };

  const upsert = (draft: PaymentMethod) => {
    setRows((list) => (list.some((m) => m.id === draft.id)
      ? list.map((m) => (m.id === draft.id ? draft : m))
      : [...list, draft]).sort((a, b) => a.sortOrder - b.sortOrder));
  };

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <Button onClick={() => setFormTarget(null)}>
            <Plus size={15} />{t.actions.create}
          </Button>
        }
      />

      <Alert tone="info" title={t.status.title} className="mb-4">
        <div>{t.status.body}</div>
        <div className="mt-1">{t.status.verificationBody}</div>
      </Alert>

      {loading ? (
        <div className="py-10 text-center text-muted">{common.loading}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title={t.empty.title}
          description={t.empty.description}
          action={
            <Button onClick={() => setFormTarget(null)}>
              <Plus size={15} />{t.actions.create}
            </Button>
          }
        />
      ) : (
        <div className="card-grid">
          {rows.map((m) => (
            <Card key={m.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-md font-bold text-dark">{m.displayName}</div>
                    <div className="text-xs text-secondary">
                      {m.methodType ? t.methodTypes[m.methodType] : common.notConfigured}
                    </div>
                  </div>
                  <Badge tone={m.active ? 'success' : 'neutral'}>
                    {m.active ? t.badges.active : t.badges.inactive}
                  </Badge>
                </div>

                {NEEDS_QR.includes(m.methodType as MethodType) ? (
                  <div className="mt-2 text-xs text-secondary">
                    {m.qrImageUrl || t.badges.noImage}
                  </div>
                ) : null}

                {m.methodType === 'BANK_TRANSFER' ? (
                  <div className="mt-2 text-xs text-neutral-700">
                    <div>{m.bankName}{m.bankCode ? ` (${m.bankCode})` : ''}</div>
                    <div className="tabular-nums">{m.accountNumber}</div>
                    {m.accountHolderName ? <div>{m.accountHolderName}</div> : null}
                  </div>
                ) : null}

                {m.methodType === 'ONLINE_PAYMENT' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral">
                      {m.gatewaySource === 'demo'
                        ? t.form.demoLabel
                        : t.form.providerNames[m.gatewayProvider]}
                    </Badge>
                    {m.gatewaySource === 'demo' ? (
                      <Badge tone="info">{t.badges.demo}</Badge>
                    ) : null}
                    {m.gatewaySandbox ? <Badge tone="warning">{t.badges.sandbox}</Badge> : null}
                    {m.e2eVerified || m.gatewayVerified ? (
                      <Badge tone="success">{t.badges.e2eVerified}</Badge>
                    ) : m.connectionVerified ? (
                      <Badge tone="info">{t.badges.connectionVerified}</Badge>
                    ) : (
                      <Badge tone="danger">{t.badges.notVerifiedLong}</Badge>
                    )}
                    {m.verificationError ? (
                      <span className="text-xs text-secondary">{m.verificationError}</span>
                    ) : null}
                  </div>
                ) : null}

                {m.instructions ? (
                  <p className="form-text">{m.instructions}</p>
                ) : null}

                <div className="form-text tabular-nums">
                  {t.form.sortOrder}{' '}{formatNumber(m.sortOrder)}
                </div>
              </CardBody>

              <CardFooter>
                <div className="btn-group flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => setFormTarget(m)}>
                    <Pencil size={13} />{common.edit}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void toggleActive(m)}>
                    {m.active ? t.actions.disable : t.actions.enable}
                  </Button>
                  {m.methodType === 'ONLINE_PAYMENT' ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => void checkConnection(m)}>
                        <ShieldCheck size={13} />{t.actions.testConnection}
                      </Button>
                      <Button
                        variant="success" size="sm"
                        disabled={!m.connectionVerified && !m.e2eVerified && !m.gatewayVerified}
                        title={t.testCharge.pendingHint}
                        onClick={() => setTestTarget(m)}
                      >
                        <ShieldCheck size={13} />{t.actions.testCharge}
                      </Button>
                    </>
                  ) : null}
                  <Button variant="outlineDanger" size="sm" onClick={() => setDeleteTarget(m)}>
                    <Trash2 size={13} />{t.actions.delete}
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* ------------------------------------------- modal 1：新增/編輯 */}
      <MethodFormModal
        open={formTarget !== undefined}
        method={formTarget ?? null}
        onClose={() => setFormTarget(undefined)}
        onSaved={async (draft, isEdit) => {
          if (USE_MOCK) {
            const id = isEdit ? draft.id : `pm_new_${nextId.current++}`;
            upsert({ ...draft, id });
          } else {
            const payload: PaymentMethodPayload = {
              ...draft,
              methodType: draft.methodType as PaymentMethodPayload['methodType'],
            };
            const saved = isEdit
              ? await updatePaymentMethod(draft.id, payload)
              : await createPaymentMethod(payload);
            if (!saved) throw new Error(t.messages.saveFailedFull);
            upsert(saved as PaymentMethod);
          }
          setFormTarget(undefined);
          toast.show(t.messages.saved, 'success');
        }}
      />

      {/* ------------------------------------------------ modal 2：刪除確認 */}
      <ConfirmModal
        open={!!deleteTarget}
        danger
        loading={deleting}
        title={t.confirm.deleteTitle}
        confirmText={common.delete}
        message={t.confirm.delete}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            if (USE_MOCK) {
              setRows((list) => list.filter((m) => m.id !== deleteTarget.id));
            } else {
              await deletePaymentMethod(deleteTarget.id);
              setRows((list) => list.filter((m) => m.id !== deleteTarget.id));
            }
            setDeleteTarget(null);
            toast.show(t.messages.deleted, 'success');
          } catch (e) {
            toast.show(
              `${t.messages.deleteFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
              'danger',
            );
          } finally {
            setDeleting(false);
          }
        }}
      />

      {/* modal 3：完整收款流程測試；由 #12 checkout/callback 實作真正閉環。 */}
      <ConfirmModal
        open={!!testTarget}
        loading={testing}
        title={t.actions.testCharge}
        confirmText={common.confirmText}
        message={t.testCharge.pendingMessage}
        onClose={() => setTestTarget(null)}
        onConfirm={async () => {
          if (!testTarget) return;
          setTesting(true);
          try {
            if (USE_MOCK) {
              toast.show(t.testCharge.pendingMessage, 'warning');
            } else {
              const result = await testPaymentCharge(testTarget.id);
              toast.show(result?.message ?? t.testCharge.pendingMessage, 'warning');
            }
          } catch (e) {
            toast.show(
              `${t.messages.connectionError}${e instanceof Error ? ` ${e.message}` : ''}`,
              'danger',
            );
          } finally {
            setTesting(false);
            setTestTarget(null);
          }
        }}
      />
    </>
  );
}

/* ========================================================================== */
/* 新增 / 編輯收款方式                                                          */
/* ========================================================================== */

const EMPTY_METHOD: PaymentMethod = {
  id: '', methodType: '', displayName: '', qrImageUrl: '',
  bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
  gatewaySource: 'own', gatewayProvider: 'NEWEBPAY', gatewayMerchantId: '',
  gatewayHashKeySet: false, gatewayHashIvSet: false, gatewaySandbox: false,
  gatewayVerified: false, sortOrder: 0, active: true, instructions: '',
};

function MethodFormModal({
  open, method, onClose, onSaved,
}: {
  open: boolean;
  method: PaymentMethod | null;
  onClose: () => void;
  onSaved: (draft: PaymentMethod, isEdit: boolean) => void | Promise<void>;
}) {
  /** 跨頁文案的「目錄／訂單」名稱依當下模式展開（14 分冊 §8.13） */
  const businessType = useBusinessType();
  const toast = useToast();
  const isEdit = !!method;

  const [draft, setDraft] = React.useState<PaymentMethod>(EMPTY_METHOD);
  /** 🔐 只有重新輸入才會送出；留空代表不變更 */
  const [hashKey, setHashKey] = React.useState('');
  const [hashIv, setHashIv] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [gatewayDirty, setGatewayDirty] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDraft(method ?? EMPTY_METHOD);
    setHashKey('');
    setHashIv('');
    setError('');
    setGatewayDirty(false);
  }, [open, method]);

  const patch = (p: Partial<PaymentMethod>) => setDraft((d) => ({ ...d, ...p }));
  const patchGateway = (p: Partial<PaymentMethod>) => { setGatewayDirty(true); patch(p); };

  const type = draft.methodType as MethodType;
  const showQr = NEEDS_QR.includes(type);
  const showBank = NEEDS_BANK.includes(type);
  const showGateway = type === 'ONLINE_PAYMENT';

  const bankMatches = draft.bankName
    ? t.banks.filter((b) => b.includes(draft.bankName))
    : [];

  const validate = (): string => {
    if (!draft.methodType) return t.form.requiredFields;
    if (!draft.displayName.trim()) return t.form.requiredFields;
    if (showBank && (!draft.bankName.trim() || !draft.accountNumber.trim())) {
      return t.form.requiredFields;
    }
    if (showGateway && draft.gatewaySource === 'own') {
      if (!draft.gatewayMerchantId.trim()) return t.form.requiredFields;
      if (!draft.gatewayHashKeySet && !hashKey.trim()) return t.form.requiredFields;
      if (!draft.gatewayHashIvSet && !hashIv.trim()) return t.form.requiredFields;
    }
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      await onSaved(
        {
          ...draft,
          gatewayHashKeySet: draft.gatewayHashKeySet || !!hashKey.trim(),
          gatewayHashIvSet: draft.gatewayHashIvSet || !!hashIv.trim(),
          gatewayHashKey: hashKey,
          gatewayHashIv: hashIv,
        },
        isEdit,
      );
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedFull}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? t.form.editTitle : t.form.createTitle}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={saving} loadingText={common.saving} onClick={() => void submit()}>
            {common.save}
          </Button>
        </>
      }
    >
      <p className="form-text mb-4">{common.requiredHint}</p>

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label required htmlFor="methodType">{t.form.methodType}</Label>
          <Select
            id="methodType" value={draft.methodType}
            options={[...t.methodTypeOptions]}
            onChange={(e) => patch({ methodType: e.target.value as MethodType | '' })}
          />
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="displayName">{t.form.displayName}</Label>
          <Input
            id="displayName" value={draft.displayName} placeholder={t.form.displayNamePlaceholder}
            onChange={(e) => patch({ displayName: e.target.value })}
          />
        </FormGroup>
      </div>

      {/* -------------------------------------------------------- QR Code */}
      {showQr ? (
        <FormGroup>
          <Label htmlFor="qrUpload">{t.form.qrCode}</Label>
          <Input
            id="qrUpload" type="file" accept="image/*" className="mb-2"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && file.size > QR_MAX_BYTES) {
                toast.show(t.form.qrTooLarge, 'warning');
                e.target.value = '';
                return;
              }
              patch({ qrImageUrl: file ? file.name : '' });
            }}
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-secondary">
              {draft.qrImageUrl || t.form.qrNoImage}
            </span>
            {draft.qrImageUrl ? (
              <Button variant="outline" size="sm" onClick={() => patch({ qrImageUrl: '' })}>
                {t.form.qrRemove}
              </Button>
            ) : null}
          </div>
        </FormGroup>
      ) : null}

      {/* ------------------------------------------------------- 銀行轉帳 */}
      {showBank ? (
        <>
          <FormText className="mb-2">{t.form.bankHint}</FormText>
          <div className="grid gap-x-4 md:grid-cols-2">
            <FormGroup>
              <Label required htmlFor="bankName">{t.form.bankName}</Label>
              <Input
                id="bankName" value={draft.bankName} list="bankNameOptions"
                placeholder={t.form.bankNamePlaceholder}
                onChange={(e) => {
                  const name = e.target.value;
                  patch({ bankName: name, bankCode: bankCodeOf(name) || draft.bankCode });
                }}
              />
              <datalist id="bankNameOptions">
                {t.banks.map((b) => <option key={b} value={b} />)}
              </datalist>
              {draft.bankName && bankMatches.length === 0 ? (
                <FormText>{t.form.bankNoMatch}</FormText>
              ) : null}
            </FormGroup>

            <FormGroup>
              <Label htmlFor="bankCode">{t.form.bankCode}</Label>
              <Input
                id="bankCode" value={draft.bankCode} placeholder={t.form.bankCodePlaceholder}
                onChange={(e) => patch({ bankCode: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label required htmlFor="accountNumber">{t.form.accountNumber}</Label>
              <Input
                id="accountNumber" value={draft.accountNumber}
                placeholder={t.form.accountNumberPlaceholder}
                onChange={(e) => patch({ accountNumber: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="accountHolderName">{t.form.accountHolder}</Label>
              <Input
                id="accountHolderName" value={draft.accountHolderName}
                placeholder={t.form.accountHolderPlaceholder}
                onChange={(e) => patch({ accountHolderName: e.target.value })}
              />
            </FormGroup>
          </div>
        </>
      ) : null}

      {/* --------------------------------------------------- 線上刷卡付款 */}
      {showGateway ? (
        <div className="mb-4 rounded-md border border-neutral-250 p-3">
          <p className="form-text">
            {t.form.onlineIntroLead}
            <strong>{t.form.onlineIntroStrong}</strong>
            {t.form.onlineIntroTail}
          </p>
          <p className="form-text">
            {t.form.onlineStepLead}
            <strong>{t.form.onlineStepStrong}</strong>
            {resolveNavTerms(t.form.onlineStepMiddle, businessType)}
            <strong>{t.form.onlineStepStrong2}</strong>
            {t.form.onlineStepTail}
          </p>
          <p className="form-text">
            {t.form.onlineApplyNote}
            {' '}
            <a
              className="inline-flex items-center gap-1 underline"
              href={NEWEBPAY_APPLY_URL}
              target="_blank"
              rel="noreferrer"
            >
              {t.form.onlineApplyLink}<ExternalLink size={12} />
            </a>
          </p>

          <FormGroup>
            <Label>{t.form.gatewaySource}</Label>
            <label className="mb-1 flex items-center gap-2 text-base">
              <input
                type="radio" name="gatewaySource" checked={draft.gatewaySource === 'own'}
                onChange={() => patchGateway({ gatewaySource: 'own' })}
              />
              {t.form.gatewaySourceOwn}
            </label>
            <label className="flex items-center gap-2 text-base">
              <input
                type="radio" name="gatewaySource" checked={draft.gatewaySource === 'demo'}
                onChange={() => patchGateway({ gatewaySource: 'demo' })}
              />
              {t.form.gatewaySourceDemo}
            </label>
          </FormGroup>

          {draft.gatewaySource === 'demo' ? (
            <Alert tone="info" className="mb-3">
              {t.form.demoNoticeLead}
              <strong>{t.form.demoNoticeStrong}</strong>
              {t.form.demoNoticeMiddle}
              <strong>{t.form.demoNoticeCard}</strong>
              {t.form.demoNoticeMiddle2}
              <strong>{t.form.demoNoticeStrong2}</strong>
              {t.form.demoNoticeTail}
            </Alert>
          ) : (
            <>
              <FormGroup>
                <Label required htmlFor="gatewayProvider">{t.form.gatewayProvider}</Label>
                <Select
                  id="gatewayProvider" value={draft.gatewayProvider}
                  options={[...t.form.gatewayProviderOptions]}
                  onChange={(e) => patchGateway({
                    gatewayProvider: e.target.value as GatewayProvider,
                  })}
                />
              </FormGroup>

              <div className="grid gap-x-4 md:grid-cols-2">
                <FormGroup>
                  <Label required htmlFor="gatewayMerchantId">{t.form.merchantId}</Label>
                  <Input
                    id="gatewayMerchantId" value={draft.gatewayMerchantId}
                    placeholder={t.form.merchantIdPlaceholder}
                    onChange={(e) => patchGateway({ gatewayMerchantId: e.target.value })}
                  />
                </FormGroup>

                <FormGroup>
                  <Label required htmlFor="gatewayHashKey">{t.form.hashKey}</Label>
                  <Input
                    id="gatewayHashKey" value={hashKey}
                    placeholder={draft.gatewayHashKeySet ? t.form.hashKeySet : t.form.hashKeyPlaceholder}
                    onChange={(e) => { setGatewayDirty(true); setHashKey(e.target.value); }}
                  />
                </FormGroup>

                <FormGroup>
                  <Label required htmlFor="gatewayHashIv">{t.form.hashIv}</Label>
                  <Input
                    id="gatewayHashIv" value={hashIv}
                    placeholder={draft.gatewayHashIvSet ? t.form.hashIvSet : t.form.hashIvPlaceholder}
                    onChange={(e) => { setGatewayDirty(true); setHashIv(e.target.value); }}
                  />
                </FormGroup>
              </div>

              <label className="mb-2 flex items-center gap-2 text-base">
                <input
                  type="checkbox" checked={draft.gatewaySandbox}
                  onChange={(e) => patchGateway({ gatewaySandbox: e.target.checked })}
                />
                {t.form.sandbox}
              </label>
            </>
          )}

          {gatewayDirty ? (
            <Alert tone="warning">{t.testCharge.dirtyBeforeTest}</Alert>
          ) : draft.e2eVerified || draft.gatewayVerified ? (
            <Alert tone="success" icon={<BadgeCheck size={16} />}>{t.badges.e2eVerified}</Alert>
          ) : draft.connectionVerified ? (
            <Alert tone="info" icon={<BadgeCheck size={16} />}>{t.badges.connectionVerified}</Alert>
          ) : (
            <Alert tone="warning">{t.badges.notVerifiedLong}</Alert>
          )}
        </div>
      ) : null}

      <div className="grid gap-x-4 md:grid-cols-2">
        <FormGroup>
          <Label htmlFor="sortOrder">{t.form.sortOrder}</Label>
          <Input
            id="sortOrder" type="number" value={String(draft.sortOrder)}
            onChange={(e) => patch({ sortOrder: Number(e.target.value) || 0 })}
          />
        </FormGroup>
      </div>

      <label className="mb-3 flex items-center gap-2 text-base">
        <input
          type="checkbox" checked={draft.active}
          onChange={(e) => patch({ active: e.target.checked })}
        />
        {t.form.isActive}
      </label>

      <FormGroup>
        <Label htmlFor="instructions">{t.form.instructions}</Label>
        <Textarea
          id="instructions" rows={2} value={draft.instructions}
          placeholder={t.form.instructionsPlaceholder}
          onChange={(e) => patch({ instructions: e.target.value })}
        />
      </FormGroup>

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}
