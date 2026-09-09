'use client';
import * as React from 'react';
import {
  CreditCard, Pencil, Plus, Trash2,
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
import { nav } from '@/i18n/zh-TW/nav';
import { paymentMethodsPage as t } from '@/i18n/zh-TW/pages/payment-methods';
import { formatNumber } from '@/lib/utils';
import {
  createPaymentMethod, deletePaymentMethod, listPaymentMethods,
  setPaymentMethodActive, updatePaymentMethod, type PaymentMethodRow,
} from '@/services';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type MethodType = 'LINE_PAY' | 'JKOPAY' | 'BANK_TRANSFER' | 'CASH' | 'ONLINE_PAYMENT' | 'OTHER';

/**
 * 頁面用的一列。
 *
 * ⚠️ 這裡**刻意沒有任何 gateway 欄位**（原本有 gatewaySource／gatewayProvider／
 * gatewayMerchantId／gatewayHashKeySet／gatewayHashIvSet／gatewaySandbox／
 * gatewayVerified 七個）。那七個欄位沒有任何後端會儲存，卻讓表單看起來可以設定
 * 金流、讓「實刷測試」看起來會驗證——按完還會把 gatewayVerified 設成 true 並
 * 顯示「已驗證開通」。店家會據此認為可以開始收錢。
 *
 * 線上刷卡屬 #9 第三步（需要藍新／綠界商店帳號，與 #12／#32 綁定）。在那之前，
 * 這一頁對它只做一件事：誠實說它還沒開通。
 */
type PaymentMethod = PaymentMethodRow;

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


const NEEDS_QR: MethodType[] = ['LINE_PAY', 'JKOPAY', 'OTHER'];
const NEEDS_BANK: MethodType[] = ['BANK_TRANSFER'];

/* -------------------------------------------------------------------------- */

export default function PaymentMethodsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<PaymentMethod[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [formTarget, setFormTarget] = React.useState<PaymentMethod | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = React.useState<PaymentMethod | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listPaymentMethods());
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

  /**
   * ⚠️ 啟停先寫後端、成功才重新載入，**不做樂觀更新**。
   *
   * 原本這裡只 setState 再跳「已更新」，重整就還原。改成樂觀更新加回滾也可以，
   * 但這一頁的操作頻率極低（店家設定一次就不太動），多一次往返換到「畫面上看到
   * 的一定是資料庫裡的」比較划算。
   */
  const toggleActive = async (m: PaymentMethod) => {
    try {
      await setPaymentMethodActive(m.id, !m.active);
      toast.show(t.messages.statusUpdated);
      await load();
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedFull}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    }
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
                    {/* 原本這裡有四個 badge（金流商／示範／沙箱／已驗證開通），
                        全部沒有後端支撐。「已驗證開通」是按下假的實刷測試後出現的。 */}
                    <Badge tone="warning">{t.onlineNotReady.badge}</Badge>
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
                  <Button variant="outline" size="sm" onClick={() => toggleActive(m)}>
                    {m.active ? t.actions.disable : t.actions.enable}
                  </Button>
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
          try {
            if (isEdit) {
              await updatePaymentMethod(draft.id, draft);
            } else {
              await createPaymentMethod(draft);
            }
            setFormTarget(undefined);
            toast.show(isEdit ? t.messages.updated : t.messages.created);
            await load();
          } catch (e) {
            toast.show(
              `${t.messages.saveFailedFull}${e instanceof Error ? e.message : t.messages.unknownError}`,
              'danger',
            );
          }
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
            await deletePaymentMethod(deleteTarget.id);
            setDeleteTarget(null);
            toast.show(t.messages.deleted);
            await load();
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

    </>
  );
}

/* ========================================================================== */
/* 新增 / 編輯收款方式                                                          */
/* ========================================================================== */

/**
 * ⚠️ `methodType` 用 `'' as MethodType`：表單第一格是「請選擇」，而 `validate()`
 * 會擋住沒選的情況。給一個真的預設值（例如 CASH）會讓沒選類型的表單直接通過。
 */
const EMPTY_METHOD: PaymentMethod = {
  id: '', methodType: '' as MethodType, displayName: '', qrImageUrl: '',
  bankName: '', bankCode: '', accountNumber: '', accountHolderName: '',
  sortOrder: 0, active: true, instructions: '',
};

function MethodFormModal({
  open, method, onClose, onSaved,
}: {
  open: boolean;
  method: PaymentMethod | null;
  onClose: () => void;
  onSaved: (draft: PaymentMethod, isEdit: boolean) => void;
}) {
  const toast = useToast();
  const isEdit = !!method;

  const [draft, setDraft] = React.useState<PaymentMethod>(EMPTY_METHOD);
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDraft(method ?? EMPTY_METHOD);
    setError('');
  }, [open, method]);

  const patch = (p: Partial<PaymentMethod>) => setDraft((d) => ({ ...d, ...p }));

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
    return '';
  };

  const submit = async () => {
    const err = validate();
    setError(err);
    if (err) return;
    setSaving(true);
    try {
      await onSaved(draft, isEdit);
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
            /*
             * ⚠️ 下拉的第一項是「請選擇」（空字串），而 `PaymentMethodRow.methodType`
             * 不含空字串——那是刻意的：能存進資料庫的一定是六個列舉值之一。
             * 這裡的 cast 只發生在 draft 上，`validate()` 會在送出前擋掉沒選的情況。
             */
            onChange={(e) => patch({ methodType: e.target.value as MethodType })}
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
      {/*
        * ⚠️ 這裡原本是一個 `type="file"` 的選檔器，但它 **沒有接任何上傳**：
        * `onChange` 只做 `patch({ qrImageUrl: file.name })`，於是資料庫存進去的是
        * 「line-pay.png」這種字串，卡片上顯示的也是檔名，圖片本身從來沒有離開過
        * 這台電腦。店家會以為 QR 圖已經上傳好了——那是這一頁原本那種假成功的
        * 另一個形狀（2026-09-09 最終風險評估 MINOR-1）。
        *
        * 這一版改成誠實的圖片網址欄位：填什麼就存什麼、重新整理讀得回來。
        * app 內直接上傳（走 `/api/upload` 與一個新的 storage bucket）需要一支
        * storage migration，不在本次範圍內，已列為後續事項。
        */}
      {showQr ? (
        <FormGroup>
          <Label htmlFor="qrImageUrl">{t.form.qrCode}</Label>
          <Input
            id="qrImageUrl" type="url" inputMode="url"
            value={draft.qrImageUrl}
            placeholder={t.form.qrUrlPlaceholder}
            onChange={(e) => patch({ qrImageUrl: e.target.value })}
          />
          <FormText>{t.form.qrUrlHint}</FormText>
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
      {/*
        * ⚠️ 這裡原本是一整組金流設定：自有／示範帳號的單選、金流商下拉、Merchant ID、
        * HashKey、HashIV、沙箱勾選，外加「已驗證開通／尚未驗證」的狀態橫幅。
        *
        * **那些欄位沒有任何後端會儲存**——填了、按儲存、重整就消失；而旁邊的
        * 「實刷測試並開通」按了之後會把 gatewayVerified 設成 true 並顯示「已驗證開通」，
        * 實際上一次金流呼叫都沒發生。其他假成功頂多是資料沒存，這一個會讓店家
        * 對「能不能收到錢」做出錯誤判斷。
        *
        * 線上刷卡需要藍新／綠界的商店帳號（#9 第三步，與 #12／#32 綁定）。在那之前
        * 這一頁對它只做一件事：說實話。等第三步落地時，把下面這段 Alert 換回真正的
        * 設定欄位，並且必須同時證明「實刷測試」真的會呼叫金流商。
        */}
      {showGateway ? (
        <Alert tone="warning" className="mb-3">
          <div className="font-medium">{t.onlineNotReady.title}</div>
          <p className="form-text">{t.onlineNotReady.description}</p>
          <p className="form-text">{t.onlineNotReady.formNotice}</p>
        </Alert>
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
