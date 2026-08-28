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
import { uploadFile } from '@/services/upload';
import { getTenantSettings, listFeatures, saveLineSettings } from '@/services/settings';
import {
  createKeywordReply, deleteKeywordReply, discardKeywordReplyImage, listKeywordReplies,
  setKeywordReplyActive, updateKeywordReply,
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
  imageStorageRef: undefined,
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
  /** 內建關鍵字組可帶 feature 條件（例：行程組標了 TOUR_MODULE） */
  const [activeFeatures, setActiveFeatures] = React.useState<string[]>([]);

  /**
   * ⚠️ **所有系統內建關鍵字組一律顯示，不依訂閱狀態過濾**（14 分冊 §8.19 擁有者裁決）。
   *
   * 舊寫法會把標了 `feature` 的組（行程／出團日期，TOUR_MODULE）從畫面上濾掉。
   * 但 webhook 分支 ④ 對這些關鍵字**沒有任何 feature 閘門**——退訂之後顧客打
   * 「行程」，bot 照樣回覆，而店家**看不到那個開關、關不掉**。
   *
   * 這與 §8.16／§8.16-b 是同一個原則：**收費擋的是「多做一件事」，不是「少做一件事」。**
   * 一間退訂的店家沒辦法讓 bot 閉嘴，在某些業態是合規問題而不只是體驗問題。
   * 同一個原則在專案裡不能只執行一半。
   *
   * `activeFeatures` 保留，但改成只用來**標示**「此組屬 XX 模組、你尚未訂閱、
   * 但開關仍可用」（見下方 `unsubscribedModuleNote`），不再用來決定「看不看得到」。
   */
  const visibleGroups = t.system.groups;

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
  // state commit 前也要立刻生效：使用者按儲存後同一個 event turn 點到背景/X 時，
  // 只看 `saving` closure 仍可能是 false，進而刪掉即將被 POST/PUT 引用的 provisional image。
  const savingRef = React.useRef(false);
  const [imageUploadState, setImageUploadState] = React.useState<'idle' | 'uploading' | 'uploaded' | 'failed'>('idle');
  const persistedImageRefRef = React.useRef<KeywordReply['imageStorageRef']>(undefined);
  const provisionalImageRef = React.useRef<KeywordReply['imageStorageRef']>(undefined);
  const draftSessionRef = React.useRef(0);
  const uploadGenerationRef = React.useRef(0);
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
    draftSessionRef.current += 1;
    uploadGenerationRef.current += 1;
    provisionalImageRef.current = undefined;
    setEditing(false);
    setFormError('');
    setDraft({ ...EMPTY_DRAFT, ...preset });
    setImageUploadState(preset?.imageUrl ? 'uploaded' : 'idle');
    persistedImageRefRef.current = undefined;
  };

  const openEdit = (row: KeywordReply) => {
    draftSessionRef.current += 1;
    uploadGenerationRef.current += 1;
    provisionalImageRef.current = undefined;
    setEditing(true);
    setFormError('');
    setDraft({ ...row });
    setImageUploadState(row.imageUrl ? 'uploaded' : 'idle');
    persistedImageRefRef.current = row.imageStorageRef;
  };

  const discardProvisionalImage = (ref: KeywordReply['imageStorageRef']) => {
    if (!ref || ref.path === persistedImageRefRef.current?.path) return;
    void discardKeywordReplyImage(ref).catch(() => {
      // Server has already queued a retry when Storage delete fails. The modal is closing, so
      // there is no longer a useful inline position for this recoverable cleanup notice.
    });
  };

  const closeDraft = () => {
    // Modal 的 Cancel、backdrop、Escape、X 全都匯入這支；寫入完成前不得收掉圖片。
    if (savingRef.current) return;
    draftSessionRef.current += 1;
    uploadGenerationRef.current += 1;
    discardProvisionalImage(provisionalImageRef.current);
    provisionalImageRef.current = undefined;
    setDraft(null);
    persistedImageRefRef.current = undefined;
    setImageUploadState('idle');
  };

  const uploadKeywordReplyImage = async (file: File) => {
    const session = draftSessionRef.current;
    const generation = ++uploadGenerationRef.current;
    setImageUploadState('uploading');
    setFormError('');
    try {
      const uploaded = await uploadFile(file, 'keyword-reply-images');
      const uploadedRef = uploaded.storageRef as NonNullable<KeywordReply['imageStorageRef']>;
      if (draftSessionRef.current !== session || uploadGenerationRef.current !== generation) {
        // Modal 已關閉或較新的 upload 已取得 ownership：這個完成結果必須自行收尾，
        // 不能依賴已消失/已被覆蓋的 React state。
        discardProvisionalImage(uploadedRef);
        return;
      }
      discardProvisionalImage(provisionalImageRef.current);
      provisionalImageRef.current = uploadedRef;
      setDraft((current) => current ? {
        ...current,
        imageUrl: uploaded.url,
        imageStorageRef: uploadedRef,
      } : current);
      setImageUploadState('uploaded');
    } catch (e) {
      if (draftSessionRef.current !== session || uploadGenerationRef.current !== generation) return;
      setImageUploadState('failed');
      setFormError(errorMessage(e));
    }
  };

  const applyTemplate = (index: number) => {
    const tpl = t.custom.templates[index];
    openCreate({ keyword: tpl.keyword, replyText: tpl.reply });
    toast.show(`${t.custom.templatePrefix}${tpl.keyword}`, 'info');
  };

  const save = async () => {
    if (!draft || imageUploadState === 'uploading') return;
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
    savingRef.current = true;
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
      persistedImageRefRef.current = payload.imageStorageRef;
      provisionalImageRef.current = undefined;
      uploadGenerationRef.current += 1;
      setDraft(null);
      toast.show(t.messages.saved);
    } catch (e) {
      toast.show(errorMessage(e), 'danger');
    } finally {
      savingRef.current = false;
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
                      {'feature' in g
                        && !activeFeatures.includes((g as { feature: string }).feature) ? (
                          <div className="form-text w-full">
                            {t.system.unsubscribedModuleNote(
                              t.system.moduleNames[(g as { feature: string }).feature]
                                ?? (g as { feature: string }).feature,
                            )}
                          </div>
                        ) : null}
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
        onClose={closeDraft}
        size="lg"
        title={editing ? t.form.editTitle : t.form.createTitle}
        footer={
          <>
            <Button variant="secondary" size="sm" disabled={saving} onClick={closeDraft}>
              {common.cancel}
            </Button>
            <Button size="sm" loading={saving || imageUploadState === 'uploading'} loadingText={common.saving} onClick={() => void save()}>
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
                  <Input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="form-control-sm"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void uploadKeywordReplyImage(file);
                    }}
                  />
                  <FormText>
                    {imageUploadState === 'uploading' ? t.form.imageUploading
                      : imageUploadState === 'uploaded' ? t.form.imageUploaded
                        : imageUploadState === 'failed' ? t.form.imageFailed : t.form.imageHelp}
                  </FormText>
                  {draft.imageUrl ? (
                    <div className="mt-2 space-y-2">
                      <img src={draft.imageUrl} alt={t.form.imagePreviewAlt} className="max-h-40 w-full rounded-lg object-contain" />
                      <Button
                        variant="outlineDanger"
                        size="sm"
                        onClick={() => {
                          uploadGenerationRef.current += 1;
                          discardProvisionalImage(provisionalImageRef.current);
                          provisionalImageRef.current = undefined;
                          setDraft({ ...draft, imageUrl: '', imageStorageRef: undefined });
                          setImageUploadState('idle');
                        }}
                      >
                        {t.form.imageRemove}
                      </Button>
                    </div>
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
