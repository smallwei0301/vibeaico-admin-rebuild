'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  MessageSquareQuote, Pencil, Plus, Settings, Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, Select, Switch, SwitchField, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/lib/api';
import { getTenantSettings, listFeatures, saveLineSettings } from '@/services/settings';
import {
  createKeywordReply, deleteKeywordReply, listKeywordReplies, setKeywordReplyActive,
  updateKeywordReply,
  type KeywordActionType as ActionType, type KeywordMatchType as MatchType,
  type KeywordReplyRow as KeywordReply,
} from '@/services/keyword-replies';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { keywordRepliesPage as t } from '@/i18n/zh-TW/pages/keyword-replies';

/* -------------------------------------------------------------------------- */
/* 本頁的資料進出口一律走 src/services/keyword-replies.ts                        */
/*                                                                            */
/* ⚠️ 這一頁原本整頁 CRUD 都只有 setState + 「已儲存」toast，清單讀頁內的         */
/*    MOCK_KEYWORD_REPLIES 常數（14 分冊 §1 根因 A）。端點與 webhook 分支 ②       */
/*    （src/server/line-events.ts）明明都在跑，店家設好的關鍵字卻永遠進不了 DB    */
/*    ——顧客在 LINE 打那個字一輩子不會有回應。示範資料已移到 service 的 mock     */
/*    分支（依業態各一份），頁面只認得 service 函式。                             */
/* -------------------------------------------------------------------------- */

/** 建議的最短「包含」關鍵字長度（原站 inline JS 規則） */
const MIN_CONTAINS_LENGTH = 2;
/** 逃生口關鍵字：停用前要特別確認 */
const ESCAPE_KEYWORDS = ['取消', '選單', '主選單'];

const EMPTY_DRAFT: Omit<KeywordReply, 'id'> & { id: string } = {
  id: '',
  keyword: '',
  matchType: 'CONTAINS',
  actionType: 'REPLY_CONTENT',
  replyText: '',
  imageUrl: '',
  linkUrl: '',
  linkLabel: '',
  enabled: true,
  overridesSystem: '',
};

/* -------------------------------------------------------------------------- */

export default function KeywordRepliesPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<KeywordReply[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadFailed, setLoadFailed] = React.useState(false);
  /**
   * KEYWORD_REPLY 訂閱狀態，三態：
   *   true  已訂閱
   *   false 未訂閱 → **只**鎖住「自訂關鍵字」的 CRUD（端點 requireFeature 回 403，
   *         畫面的鎖與後端一致）。**不影響**下方系統內建關鍵字的停用開關——
   *         14 分冊 §8.16 擁有者裁決：停用一律生效，付費閘門只擋「自訂內容」。
   *   null  **不知道**（listFeatures 失敗）。不知道就不上鎖，讓使用者按下去由端點
   *         回真正的答案（200 或 403），而不是靠猜的畫面狀態代它宣告結果。
   */
  const [featureActive, setFeatureActive] = React.useState<boolean | null>(null);
  /** 內建關鍵字組可帶 feature 條件（例：行程組只給訂閱 TOUR_MODULE 的導遊型店家） */
  const [activeFeatures, setActiveFeatures] = React.useState<string[]>([]);
  const visibleGroups = React.useMemo(
    () => t.system.groups.filter(
      (g) => !('feature' in g) || activeFeatures.includes((g as { feature: string }).feature),
    ),
    [activeFeatures],
  );

  /**
   * 被停用的系統內建關鍵字組（開關關掉的那些）。
   * 儲存位置：`tenant_settings.line.systemKeywordGroupsDisabled`（jsonb），
   * 由 `PUT /api/settings/line` 局部合併寫入；webhook 分支 ④
   * （src/server/line-events.ts 的 isSystemGroupDisabled）讀的就是這個鍵。
   */
  const [disabledGroups, setDisabledGroups] = React.useState<string[]>([]);
  const [systemLoaded, setSystemLoaded] = React.useState(false);
  const [systemLoadFailed, setSystemLoadFailed] = React.useState(false);
  const [systemSaving, setSystemSaving] = React.useState(false);
  const [disableTarget, setDisableTarget] = React.useState<string | null>(null);

  const [draft, setDraft] = React.useState<typeof EMPTY_DRAFT | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [formError, setFormError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<KeywordReply | null>(null);

  /** 未訂閱時才真的鎖住自訂關鍵字的 CRUD（端點也 requireFeature，鎖與後端一致） */
  const featureLocked = featureActive === false;

  /*
   * ⚠️ 這裡原本有三個依 featureActive 三態挑文案的 helper
   * （savedMessage / enabledMessage / disabledGroupMessage），全部拿掉了。
   * 14 分冊 §8.16（擁有者裁決）之後它們講的都不是我們真的知道的事：
   *
   * - 系統關鍵字的停用 → 一律生效，webhook 的 isSystemGroupDisabled 已無閘門，
   *   所以只有一種結果可講：「已停用該組系統關鍵字」。
   * - 自訂關鍵字的儲存/啟用 → 寫入端點帶 requireFeature('KEYWORD_REPLY')，
   *   **能走到 toast 這一行就代表端點回了 200 ＝ 訂閱有效**；未訂閱會是 403，
   *   由 catch 顯示錯誤。再掛一句「尚未生效／無法確認訂閱狀態」是捏造出來的
   *   不確定性（CLAUDE.md：不知道才顯示不知道；已經知道就別裝不知道）。
   */
  const errorMessage = (e: unknown) =>
    e instanceof ApiError && e.message ? e.message : t.messages.saveFailed;

  const reload = React.useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setRows(await listKeywordReplies());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    void (async () => {
      try {
        const features = await listFeatures();
        setFeatureActive(features.some((f) => f.code === 'KEYWORD_REPLY' && f.active));
        setActiveFeatures(features.filter((f) => f.active).map((f) => f.code));
      } catch {
        setFeatureActive(null); // 查不到就維持「未知」，不要退回「已訂閱」的樂觀猜測
        toast.show(t.messages.connectionError, 'danger');
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    void (async () => {
      try {
        const settings = await getTenantSettings();
        setDisabledGroups([...(settings.line.systemKeywordGroupsDisabled ?? [])]);
        setSystemLoaded(true);
      } catch {
        // 讀不到就不顯示開關：全部畫成「開啟」會讓店家以為先前的停用設定不見了，
        // 隨手一動就把整份清單覆寫掉（t.system.loadFailed 這句文案講的正是這件事）。
        setSystemLoadFailed(true);
      }
    })();
  }, []);

  /* -------------------------------------------------------------- 動作 */

  const openCreate = (preset?: Partial<typeof EMPTY_DRAFT>) => {
    setEditing(false);
    setFormError('');
    setDraft({ ...EMPTY_DRAFT, ...preset });
  };

  const openEdit = (row: KeywordReply) => {
    setEditing(true);
    setFormError('');
    setDraft({ ...row });
  };

  const applyTemplate = (index: number) => {
    const tpl = t.custom.templates[index];
    openCreate({ keyword: tpl.keyword, replyText: tpl.reply });
    toast.show(`${t.custom.templatePrefix}${tpl.keyword}`, 'info');
  };

  const save = async () => {
    if (!draft) return;
    const keyword = draft.keyword.trim();
    if (!keyword) {
      setFormError(t.messages.keywordRequired);
      return;
    }
    if (draft.matchType === 'CONTAINS' && keyword.length < MIN_CONTAINS_LENGTH) {
      setFormError(t.form.minLength);
      return;
    }
    if (draft.actionType === 'REPLY_CONTENT' && !draft.replyText.trim()) {
      setFormError(t.messages.replyRequired);
      return;
    }
    // id 不進 body：新增沒有 id，編輯的 id 走路徑參數
    const { id, ...payload } = { ...draft, keyword };
    setSaving(true);
    try {
      if (editing) {
        await updateKeywordReply(id, payload);
        setRows((list) => list.map((r) => (r.id === id ? { ...payload, id } : r)));
      } else {
        // 20 組上限（409）與未訂閱（403 FEAT_001）都由端點判定，訊息原樣顯示
        const created = await createKeywordReply(payload);
        setRows((list) => [...list, { ...payload, id: created.id }]);
      }
      setDraft(null);
      toast.show(t.messages.saved);
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteKeywordReply(target.id);
      setRows((list) => list.filter((r) => r.id !== target.id));
      setDeleteTarget(null);
      toast.show(t.messages.deleted);
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    }
  };

  const toggleRow = async (row: KeywordReply) => {
    const next = !row.enabled;
    try {
      await setKeywordReplyActive(row.id, next);
      setRows((list) => list.map((r) => (r.id === row.id ? { ...r, enabled: next } : r)));
      toast.show(next ? t.messages.enabled : t.messages.disabled);
    } catch (e) {
      // 失敗就不要動畫面上的開關：切了卻沒存進去 = 又一個假成功
      toast.show(errorMessage(e), 'danger');
    }
  };

  /**
   * 把整份停用清單寫回 `tenant_settings.line.systemKeywordGroupsDisabled`。
   * 寫入成功才更新畫面上的開關；失敗維持原狀並顯示錯誤。
   */
  const persistSystemDisabled = async (next: string[], restoring: boolean) => {
    setSystemSaving(true);
    try {
      await saveLineSettings({ systemKeywordGroupsDisabled: next });
      setDisabledGroups(next);
      toast.show(restoring ? t.messages.systemGroupRestored : t.messages.systemGroupDisabled);
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      setSystemSaving(false);
    }
  };

  const requestSystemToggle = (key: string, next: boolean) => {
    // 恢復（打開）不需要確認；停用（關閉）要先跳確認視窗
    if (next) {
      void persistSystemDisabled(disabledGroups.filter((k) => k !== key), true);
      return;
    }
    setDisableTarget(key);
  };

  const confirmSystemDisable = () => {
    if (!disableTarget) return;
    const key = disableTarget;
    setDisableTarget(null);
    void persistSystemDisabled([...new Set([...disabledGroups, key])], false);
  };

  /* ------------------------------------------------------------ 表格欄 */

  const columns: Column<KeywordReply>[] = [
    {
      key: 'keyword', header: t.custom.columns.keyword,
      render: (r) => (
        <div className="min-w-0">
          <div className="font-semibold text-dark">{r.keyword}</div>
          {r.overridesSystem ? (
            <Badge tone="warning">{`${t.system.overridePrefix}${r.overridesSystem}`}</Badge>
          ) : null}
          {!r.enabled ? (
            <span className="ml-1 text-xs text-secondary">{t.system.disabledSuffix}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'matchType', header: t.custom.columns.matchType, width: '130px',
      render: (r) => <Badge tone="neutral">{t.form.matchTypeShort[r.matchType]}</Badge>,
    },
    {
      key: 'actionType', header: t.custom.columns.action, width: '140px',
      render: (r) => <span className="text-base">{t.form.actionTypeShort[r.actionType]}</span>,
    },
    {
      key: 'enabled', header: t.custom.columns.enabled, width: '80px',
      render: (r) => (
        <Switch checked={r.enabled} onCheckedChange={() => void toggleRow(r)} disabled={featureLocked} />
      ),
    },
    {
      key: 'actions', header: t.custom.columns.actions, width: '110px',
      render: (r) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm"
            aria-label={t.actions.edit} title={t.actions.edit}
            disabled={featureLocked}
            onClick={() => openEdit(r)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm"
            aria-label={t.actions.delete} title={t.actions.delete}
            disabled={featureLocked}
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  const disableGroup = t.system.groups.find((g) => g.key === disableTarget);
  const disableIsEscape = !!disableGroup?.keywords.some((k) => ESCAPE_KEYWORDS.includes(k));

  /* -------------------------------------------------------------- render */

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <>
            <Badge tone="purple">{t.priceBadge}</Badge>
            <Button onClick={() => openCreate()} disabled={featureLocked}>
              <Plus size={15} />
              {t.actions.create}
            </Button>
          </>
        }
      />

      {featureLocked ? (
        <Alert tone="warning" className="mb-4">
          {t.feature.hint}
          <strong>{t.feature.hintStrong}</strong>
          {t.feature.hintTail}
          <Link href="/tenant/feature-store" className="ml-2 font-semibold">
            {t.feature.goToStore}
          </Link>
        </Alert>
      ) : null}

      {/* ================================================ 我的自訂關鍵字 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <MessageSquareQuote size={16} />
            {t.custom.cardTitle}
          </CardTitle>
          <Button variant="outline" size="sm" disabled={featureLocked} onClick={() => openCreate()}>
            {t.actions.createShort}
          </Button>
        </CardHeader>
        {loadFailed ? (
          <CardBody className="pb-0">
            {/* 載入失敗要說出來：靜靜顯示「還沒有自訂關鍵字」會讓店家以為設定被清空了 */}
            <Alert tone="danger" className="mb-0">
              {t.custom.loadFailed}
              <Button variant="outline" size="sm" className="ml-2" onClick={() => void reload()}>
                {t.custom.retry}
              </Button>
              {t.custom.retryTail}
            </Alert>
          </CardBody>
        ) : null}
        <CardBody className="p-0">
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                icon={MessageSquareQuote}
                title={t.empty.title}
                description={
                  <>
                    <div>{t.custom.emptyLead}</div>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {t.custom.templates.map((tpl, i) => (
                        <Button
                          key={tpl.keyword}
                          variant="outline"
                          size="sm"
                          disabled={featureLocked}
                          onClick={() => applyTemplate(i)}
                        >
                          {tpl.button}
                        </Button>
                      ))}
                    </div>
                  </>
                }
              />
            }
          />
        </CardBody>
        <CardBody className="pt-0">
          <FormText>
            {t.custom.tipLead}
            <strong>{t.custom.tipStrong}</strong>
            {t.custom.tipTail}
          </FormText>
          <FormText>
            {t.custom.oaTipLead}
            <strong>{t.custom.oaTipStrong}</strong>
            {t.custom.oaTipTail}
          </FormText>
        </CardBody>
      </Card>

      {/* ================================================ 系統內建關鍵字 */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            <Settings size={16} />
            {t.system.cardTitle}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <FormText className="mt-0">
            {t.system.introLead}
            <strong>{t.system.introStrong}</strong>
            {t.system.introTail}
          </FormText>
          <FormText>
            {t.system.offLead}
            <strong>{t.system.offStrong1}</strong>
            {t.system.offMiddle}
            <strong>{t.system.offStrong2}</strong>
            {t.system.offMiddle2}
            {t.system.offTail}
            <strong>{t.system.overrideLead}</strong>
            {t.system.overrideTail}
          </FormText>
          <FormText>{t.system.campaignNote}</FormText>
          <FormText>{t.system.subscribeNote}</FormText>

          {featureLocked ? (
            <Alert tone="warning" className="my-3 text-xs">
              {t.feature.systemHint}
              <strong>{t.feature.systemHintStrong}</strong>
              {t.feature.systemHintTail}
            </Alert>
          ) : null}

          {systemLoadFailed ? (
            <Alert tone="danger" className="my-3">{t.system.loadFailed}</Alert>
          ) : !systemLoaded ? (
            <FormText>{t.custom.loading}</FormText>
          ) : (
            <div className="mt-3">
              {visibleGroups.map((g) => (
                <SwitchField
                  key={g.key}
                  label={g.label}
                  description={
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.keywords.map((k) => (
                        <button
                          key={k}
                          type="button"
                          disabled={featureLocked}
                          className="badge badge-neutral disabled:opacity-60"
                          onClick={() => openCreate({ keyword: k, overridesSystem: k })}
                        >
                          {k}
                        </button>
                      ))}
                      {g.note ? <div className="form-text w-full">{g.note}</div> : null}
                    </div>
                  }
                  checked={!disabledGroups.includes(g.key)}
                  disabled={systemSaving}
                  onCheckedChange={(v) => requestSystemToggle(g.key, v)}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* --------------------------------------------- modal：自訂關鍵字 */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        size="lg"
        title={editing ? t.form.editTitle : t.form.createTitle}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
              {common.cancel}
            </Button>
            <Button size="sm" loading={saving} loadingText={common.saving} onClick={() => void save()}>
              {common.save}
            </Button>
          </>
        }
      >
        {draft ? (
          <>
            {featureLocked ? (
              <Alert tone="warning" className="mb-3 text-xs">
                {t.form.unsubscribedLead}
                <Link href="/tenant/feature-store" className="font-semibold">
                  {t.form.unsubscribedLink}
                </Link>
                {t.form.unsubscribedTail}
              </Alert>
            ) : null}

            <FormGroup>
              <Label htmlFor="kwKeyword" required>{t.form.keyword}</Label>
              <Input
                id="kwKeyword"
                className="form-control-sm"
                placeholder={t.form.keywordPlaceholder}
                value={draft.keyword}
                onChange={(e) => {
                  setDraft({ ...draft, keyword: e.target.value });
                  setFormError('');
                }}
              />
              {draft.keyword ? (
                <FormText>
                  {draft.matchType === 'EXACT'
                    ? t.form.exactHint(draft.keyword)
                    : t.form.containsExample(draft.keyword)}
                </FormText>
              ) : null}
              {draft.overridesSystem ? (
                <Alert tone="warning" className="mt-2 text-xs" title={t.form.overrideSystemTitle}>
                  {t.form.overrideSystemLead}
                  {draft.overridesSystem}
                  {t.form.overrideSystemTail}
                </Alert>
              ) : null}
            </FormGroup>

            <FormGroup>
              <Label htmlFor="kwMatchType">{t.form.matchType}</Label>
              <Select
                id="kwMatchType"
                className="form-select-sm"
                value={draft.matchType}
                onChange={(e) => setDraft({ ...draft, matchType: e.target.value as MatchType })}
                options={[
                  { value: 'EXACT', label: t.form.matchTypes.EXACT },
                  { value: 'CONTAINS', label: t.form.matchTypes.CONTAINS },
                ]}
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="kwActionType">{t.form.actionType}</Label>
              <Select
                id="kwActionType"
                className="form-select-sm"
                value={draft.actionType}
                onChange={(e) => setDraft({ ...draft, actionType: e.target.value as ActionType })}
                options={[
                  { value: 'REPLY_CONTENT', label: t.form.actionTypes.REPLY_CONTENT },
                  {
                    value: 'START_PROFILE_COLLECTION',
                    label: t.form.actionTypes.START_PROFILE_COLLECTION,
                  },
                ]}
              />
            </FormGroup>

            {draft.actionType === 'REPLY_CONTENT' ? (
              <>
                <FormGroup>
                  <Label htmlFor="kwReplyText" required>{t.form.replyText}</Label>
                  <Textarea
                    id="kwReplyText"
                    className="form-control-sm"
                    rows={3}
                    placeholder={t.form.replyTextPlaceholder}
                    value={draft.replyText}
                    onChange={(e) => {
                      setDraft({ ...draft, replyText: e.target.value });
                      setFormError('');
                    }}
                  />
                </FormGroup>

                <FormGroup>
                  <Label>{t.form.image}</Label>
                  {/* 上傳尚未建置：停用欄位並在畫面上說明（理由見 i18n 的 imageNotBuilt） */}
                  <Input type="file" accept="image/*" className="form-control-sm" disabled />
                  <FormText>{t.form.imageNotBuilt}</FormText>
                  {draft.imageUrl ? (
                    <Button
                      variant="outlineDanger"
                      size="sm"
                      className="mt-2"
                      onClick={() => setDraft({ ...draft, imageUrl: '' })}
                    >
                      {t.form.imageRemove}
                    </Button>
                  ) : null}
                </FormGroup>

                <FormGroup>
                  <Label htmlFor="kwLinkUrl">{t.form.linkUrl}</Label>
                  <Input
                    id="kwLinkUrl"
                    type="url"
                    className="form-control-sm"
                    placeholder={t.form.linkUrlPlaceholder}
                    value={draft.linkUrl}
                    onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
                  />
                </FormGroup>

                <FormGroup>
                  <Label htmlFor="kwLinkLabel">{t.form.linkLabel}</Label>
                  <Input
                    id="kwLinkLabel"
                    className="form-control-sm"
                    placeholder={t.form.linkLabelPlaceholder}
                    value={draft.linkLabel}
                    onChange={(e) => setDraft({ ...draft, linkLabel: e.target.value })}
                  />
                </FormGroup>
              </>
            ) : null}

            <SwitchField
              label={t.form.enabled}
              checked={draft.enabled}
              onCheckedChange={(v) => setDraft({ ...draft, enabled: v })}
            />

            {formError ? <FormError>{formError}</FormError> : null}
          </>
        ) : null}
      </Modal>

      {/* ------------------------------------------------------- 確認彈窗 */}
      <ConfirmModal
        open={!!deleteTarget}
        title={t.confirm.deleteTitle}
        message={`${t.confirm.deleteLead}${deleteTarget?.keyword ?? ''}${t.confirm.deleteTail}`}
        danger
        confirmText={common.delete}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
      />

      <ConfirmModal
        open={!!disableTarget}
        title={t.confirm.disableSystemTitle}
        danger
        message={
          // ⚠️ 這裡原本還有一段 `featureLocked &&` 的提醒（「這個停用設定會先儲存但
          //「不會生效」…訂閱後才會讓顧客打這些字時完全沒有回應」）。§8.16 拆掉閘門
          // 之後那段話是反過來的謊言——停用一律生效，再警告一次只會讓店家不敢用一個
          // 其實已經可用的功能。上面 disableNoReply 那句現在對兩種訂閱狀態都成立。
          <span className="whitespace-pre-line">
            {disableIsEscape && disableGroup
              ? t.confirm.disableEscape(disableGroup.keywords[0])
              : disableGroup
                ? t.confirm.disableNoReply(disableGroup.keywords[0])
                : ''}
          </span>
        }
        onClose={() => setDisableTarget(null)}
        onConfirm={confirmSystemDisable}
      />
    </>
  );
}
