'use client';
import * as React from 'react';
import { Bell, ShieldCheck, ShieldAlert, Star, Trash2, UserPlus } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/Modal';
import { SwitchField, FormGroup, Label } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { lineSettingsPage as t } from '@/i18n/zh-TW/pages/line-settings';
import { common } from '@/i18n/zh-TW/common';
import {
  confirmOwnerNotifyBind, getOwnerNotifyOverview, initiateOwnerNotifyBind,
  listOwnerNotifyLineUsers, removeAllOwnerNotifyRecipients, removeOwnerNotifyRecipient,
  updateOwnerNotifyRecipient,
  type OwnerNotifyLineUserCandidate, type OwnerNotifyOverview,
} from '@/services/owner-notify';
import { ApiError } from '@/lib/api';

const oT = t.ownerNotify;

/**
 * 老闆通知（Issue #18）——鐵則 6：loading／EmptyState／ConfirmModal／成功 toast 齊全。
 * 這個區塊管自己的載入與寫入狀態，只透過 `@/services/owner-notify` 存取資料，
 * 不直接 fetch（鐵則：頁面／區塊只認 services，見 CLAUDE.md「Pages never fetch」）。
 */
export function OwnerNotifySection() {
  const toast = useToast();
  const [loading, setLoading] = React.useState(true);
  const [overview, setOverview] = React.useState<OwnerNotifyOverview | null>(null);
  const [candidates, setCandidates] = React.useState<OwnerNotifyLineUserCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = React.useState('');
  const [inviting, setInviting] = React.useState(false);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [removeAllOpen, setRemoveAllOpen] = React.useState(false);
  const [removingAll, setRemovingAll] = React.useState(false);
  const [rechecking, setRechecking] = React.useState(false);

  const load = React.useCallback(async () => {
    const [ov, cands] = await Promise.all([getOwnerNotifyOverview(), listOwnerNotifyLineUsers()]);
    setOverview(ov);
    setCandidates(cands);
  }, []);

  React.useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reportError(e: unknown, prefix: string) {
    toast.show(`${prefix}${e instanceof ApiError ? e.message : String(e)}`, 'danger');
  }

  async function handleInvite() {
    if (!selectedCandidate) return;
    setInviting(true);
    try {
      await initiateOwnerNotifyBind(selectedCandidate);
      toast.show(oT.inviteSent);
      setSelectedCandidate('');
      await load();
    } catch (e) {
      reportError(e, oT.actionFailedPrefix);
    } finally {
      setInviting(false);
    }
  }

  /** Demo/測試用：模擬本人已在 LINE 上按下確認（見 services/owner-notify.ts 檔頭）。 */
  async function handleConfirmForDemo(candidate: OwnerNotifyLineUserCandidate) {
    if (!candidate.pendingBindRequestId) return;
    setConfirmingId(candidate.lineUserId);
    try {
      await confirmOwnerNotifyBind(candidate.pendingBindRequestId, candidate.lineUserId);
      toast.show(oT.recipientAdded);
      await load();
    } catch (e) {
      reportError(e, oT.actionFailedPrefix);
    } finally {
      setConfirmingId(null);
    }
  }

  async function handleToggle(id: string, patch: { notifyNewBooking?: boolean; notifyCancel?: boolean }) {
    try {
      await updateOwnerNotifyRecipient(id, patch);
      toast.show(oT.toggleUpdated);
      await load();
    } catch (e) {
      reportError(e, oT.actionFailedPrefix);
    }
  }

  async function handleSetPrimary(id: string) {
    try {
      await updateOwnerNotifyRecipient(id, { isPrimary: true });
      toast.show(oT.primaryUpdated);
      await load();
    } catch (e) {
      reportError(e, oT.actionFailedPrefix);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await removeOwnerNotifyRecipient(id);
      toast.show(oT.recipientRemoved);
      await load();
    } catch (e) {
      reportError(e, oT.actionFailedPrefix);
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRemoveAll() {
    setRemovingAll(true);
    try {
      await removeAllOwnerNotifyRecipients();
      toast.show(oT.allRemoved);
      setRemoveAllOpen(false);
      await load();
    } catch (e) {
      reportError(e, oT.actionFailedPrefix);
    } finally {
      setRemovingAll(false);
    }
  }

  async function handleRecheckHealth() {
    setRechecking(true);
    try {
      const ov = await getOwnerNotifyOverview();
      setOverview(ov);
    } catch (e) {
      reportError(e, oT.actionFailedPrefix);
    } finally {
      setRechecking(false);
    }
  }

  const recipients = overview?.recipients ?? [];
  const maxRecipients = overview?.maxRecipients ?? 3;
  const atLimit = recipients.length >= maxRecipients;

  return (
    <Card data-testid="owner-notify-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell size={18} /> {oT.title}
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        <p className="text-sm text-muted">{oT.description}</p>

        {loading ? (
          <div className="text-sm text-muted">{common.loading}</div>
        ) : (
          <>
            {/* provider 連線狀態：實測結果，不是「有存 Token 就宣稱已連線」 */}
            <div className="flex items-center justify-between gap-3">
              <Badge tone={overview?.providerHealthy ? 'success' : 'warning'}>
                {overview?.providerHealthy
                  ? <span className="inline-flex items-center gap-1"><ShieldCheck size={14} /> {oT.providerHealthyBadge}</span>
                  : <span className="inline-flex items-center gap-1"><ShieldAlert size={14} /> {oT.providerUnhealthyBadge}</span>}
              </Badge>
              <Button size="sm" variant="secondary" loading={rechecking} onClick={handleRecheckHealth}>
                {oT.recheckHealth}
              </Button>
            </div>
            {overview?.providerHealthReason ? (
              <p className="text-xs text-muted">{overview.providerHealthReason}</p>
            ) : null}

            <Alert tone="info">{oT.maxRecipientsNote(maxRecipients)}</Alert>
            {atLimit ? <Alert tone="warning">{oT.limitReached}</Alert> : null}

            {/* 候選好友挑選 + 發起邀請 */}
            <FormGroup>
              <Label>{oT.pickCandidate}</Label>
              <div className="flex flex-wrap gap-2">
                <select
                  className="input"
                  data-testid="owner-notify-candidate-select"
                  value={selectedCandidate}
                  onChange={(e) => setSelectedCandidate(e.target.value)}
                  disabled={atLimit || candidates.length === 0}
                >
                  <option value="">{candidates.length === 0 ? oT.noCandidates : oT.pickCandidate}</option>
                  {candidates.map((c) => (
                    <option key={c.lineUserId} value={c.lineUserId}>
                      {c.displayName || '(LINE 用戶)'}{c.pendingBindRequestId ? `（${oT.pendingBadge}）` : ''}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!selectedCandidate || atLimit}
                  loading={inviting}
                  onClick={handleInvite}
                >
                  <UserPlus size={14} className="mr-1" /> {oT.invite}
                </Button>
              </div>
            </FormGroup>

            {/* 進行中的邀請：Demo 模擬確認按鈕 */}
            {candidates.filter((c) => c.pendingBindRequestId).map((c) => (
              <div key={c.lineUserId} className="flex items-center justify-between rounded-md border border-dashed p-2 text-sm">
                <span>{c.displayName || '(LINE 用戶)'} — {oT.pendingBadge}</span>
                <Button
                  size="sm" variant="secondary"
                  loading={confirmingId === c.lineUserId}
                  onClick={() => handleConfirmForDemo(c)}
                >
                  {oT.confirmForDemo}
                </Button>
              </div>
            ))}

            {/* 正式名單 */}
            {recipients.length === 0 ? (
              <EmptyState icon={Bell} title={oT.empty} />
            ) : (
              <div className="space-y-3">
                {recipients.map((r) => (
                  <div
                    key={r.id}
                    data-testid={`owner-notify-recipient-${r.lineUserId}`}
                    className="rounded-md border p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-medium">
                        {r.displayName || '(LINE 用戶)'}
                        {r.isPrimary ? (
                          <Badge tone="primary"><Star size={12} className="mr-1 inline" />{oT.primaryBadge}</Badge>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {!r.isPrimary ? (
                          <Button size="sm" variant="secondary" onClick={() => handleSetPrimary(r.id)}>
                            {oT.setPrimary}
                          </Button>
                        ) : null}
                        <Button
                          size="sm" variant="danger"
                          loading={removingId === r.id}
                          onClick={() => handleRemove(r.id)}
                        >
                          <Trash2 size={14} className="mr-1" /> {oT.remove}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <div data-testid={`owner-notify-toggle-newBooking-${r.lineUserId}`}>
                        <SwitchField
                          label={oT.eventNewBooking}
                          checked={r.notifyNewBooking}
                          onCheckedChange={(v) => handleToggle(r.id, { notifyNewBooking: v })}
                        />
                      </div>
                      <div data-testid={`owner-notify-toggle-cancel-${r.lineUserId}`}>
                        <SwitchField
                          label={oT.eventCancel}
                          checked={r.notifyCancel}
                          onCheckedChange={(v) => handleToggle(r.id, { notifyCancel: v })}
                        />
                      </div>
                      <SwitchField label={oT.eventSubscriptionExpiry} checked={r.isPrimary} onCheckedChange={() => {}} disabled />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted">{oT.quotaNote}</p>

            {recipients.length > 0 ? (
              <div className="flex justify-end">
                <Button variant="danger" size="sm" onClick={() => setRemoveAllOpen(true)}>
                  {oT.removeAll}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardBody>

      <ConfirmModal
        open={removeAllOpen}
        onClose={() => setRemoveAllOpen(false)}
        onConfirm={handleRemoveAll}
        title={oT.removeAllConfirmTitle}
        message={oT.removeAllConfirmMessage}
        danger
        loading={removingAll}
      />
    </Card>
  );
}
