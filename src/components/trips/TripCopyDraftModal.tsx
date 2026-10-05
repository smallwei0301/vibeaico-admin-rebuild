'use client';
import * as React from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { FormGroup, FormText, Label, Textarea } from '@/components/ui/Form';
import { TripTextFieldMeta } from '@/components/trips/TripTextFieldMeta';
import {
  confirmTripCopyDraft, tripCopyDraftMeta,
  type TripCopyDraft, type TripTextFields,
  type TripTextField, type TripTextFieldError,
} from '@/lib/trip-field-limits';
import { tripsPage as t } from '@/i18n/zh-TW/pages/trips';

/**
 * 複製行程草稿：來源行程的五個文字欄位有超過上限者，帶「完整」來源值讓店家自行修正。
 * 錯誤依目前草稿即時計算；有任何錯誤時確認鈕停用。確認時由呼叫端再驗證一次並送出。
 * API 失敗由呼叫端保持本 Modal 開啟（draft 存在於本元件 state，不會被清掉）。
 */
export function TripCopyDraftModal<P extends TripTextFields>({
  open, source, initial, busy, onCancel, onConfirm,
}: {
  open: boolean;
  /** 完整複製 payload（來源值）；確認時未編輯的欄位原樣沿用它。 */
  source: P;
  initial: TripCopyDraft;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (payload: P) => void;
}) {
  const [draft, setDraft] = React.useState<TripCopyDraft>(initial);
  React.useEffect(() => { if (open) setDraft(initial); }, [open, initial]);

  // 計數與錯誤都來自與送出相同的 resolved 值，畫面顯示的就是實際會送出的內容。
  const { errors, display } = tripCopyDraftMeta(source, initial, draft);
  const errorOf = (field: TripTextField): TripTextFieldError | null =>
    errors.find((e) => e.field === field) ?? null;
  const set = (p: Partial<TripCopyDraft>) => setDraft((d) => ({ ...d, ...p }));

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={t.copyDraft.title}
      size="lg"
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{t.copyDraft.cancel}</Button>
          <Button
            loading={busy}
            disabled={errors.length > 0}
            onClick={() => {
              const result = confirmTripCopyDraft(source, initial, draft);
              if (result.ok) onConfirm(result.payload);
            }}
          >
            {t.copyDraft.confirm}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <Alert tone="warning">{t.copyDraft.intro}</Alert>
        <FormGroup>
          <Label>{t.form.descriptionLabel}</Label>
          <Textarea rows={8} value={draft.description} disabled={busy} onChange={(e) => set({ description: e.target.value })} />
          <TripTextFieldMeta field="description" value={display.description} error={errorOf('description')} />
        </FormGroup>
        <FormGroup>
          <Label>{t.form.inclusionsLabel}</Label>
          <Textarea rows={5} value={draft.inclusionsText} disabled={busy} onChange={(e) => set({ inclusionsText: e.target.value })} />
          <FormText>{t.form.listHelp}</FormText>
          <TripTextFieldMeta field="inclusions" value={display.inclusions} error={errorOf('inclusions')} />
        </FormGroup>
        <FormGroup>
          <Label>{t.form.exclusionsLabel}</Label>
          <Textarea rows={5} value={draft.exclusionsText} disabled={busy} onChange={(e) => set({ exclusionsText: e.target.value })} />
          <FormText>{t.form.listHelp}</FormText>
          <TripTextFieldMeta field="exclusions" value={display.exclusions} error={errorOf('exclusions')} />
        </FormGroup>
        <FormGroup>
          <Label>{t.form.noticesLabel}</Label>
          <Textarea rows={4} value={draft.noticesText} disabled={busy} onChange={(e) => set({ noticesText: e.target.value })} />
          <FormText>{t.form.listHelp}</FormText>
          <TripTextFieldMeta field="notices" value={display.notices} error={errorOf('notices')} />
        </FormGroup>
        <FormGroup>
          <Label>{t.form.safetyLabel}</Label>
          <Textarea rows={3} value={draft.safetyNotice} disabled={busy} onChange={(e) => set({ safetyNotice: e.target.value })} />
          <TripTextFieldMeta field="safetyNotice" value={display.safetyNotice} error={errorOf('safetyNotice')} />
        </FormGroup>
      </div>
    </Modal>
  );
}
