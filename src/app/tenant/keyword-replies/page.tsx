'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle, MessageSquareQuote, Pencil, Plus, Settings, Trash2,
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
import { listFeatures } from '@/services/settings';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { keywordRepliesPage as t } from '@/i18n/zh-TW/pages/keyword-replies';

/* -------------------------------------------------------------------------- */
/* 本頁專用型別與假資料（不寫進 src/mock，避免與其他頁面衝突）                    */
/* -------------------------------------------------------------------------- */

type MatchType = 'EXACT' | 'CONTAINS';
type ActionType = 'REPLY_CONTENT' | 'START_PROFILE_COLLECTION';

/** 原站 /api/settings/line/keyword-replies 的自訂關鍵字結構 */
type KeywordReply = {
  id: string;
  keyword: string;
  matchType: MatchType;
  actionType: ActionType;
  replyText: string;
  imageUrl: string;
  linkUrl: string;
  linkLabel: string;
  enabled: boolean;
  /** 取代了哪一個系統內建關鍵字（空字串＝沒有取代） */
  overridesSystem: string;
};

const MOCK_KEYWORD_REPLIES: KeywordReply[] = [
  {
    id: 'kw_1', keyword: '停車', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
    replyText: '店門口有 3 個機車位，汽車可停巷口的收費停車場（每小時 30 元）。',
    imageUrl: '', linkUrl: '', linkLabel: '', enabled: true, overridesSystem: '',
  },
  {
    id: 'kw_2', keyword: '價格', matchType: 'CONTAINS', actionType: 'REPLY_CONTENT',
    replyText: t.custom.templates[0].reply,
    imageUrl: '', linkUrl: 'https://example.com/price', linkLabel: '查看更多',
    enabled: true, overridesSystem: '',
  },
  {
    id: 'kw_3', keyword: '會員', matchType: 'EXACT', actionType: 'START_PROFILE_COLLECTION',
    replyText: '', imageUrl: '', linkUrl: '', linkLabel: '',
    enabled: false, overridesSystem: '會員',
  },
];

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
  const [featureActive, setFeatureActive] = React.useState(true);

  /** 系統內建關鍵字：每組一個開關（true = 系統照常回應） */
  const [systemEnabled, setSystemEnabled] = React.useState<Record<string, boolean>>(
    Object.fromEntries(t.system.groups.map((g) => [g.key, true])),
  );
  const [disableTarget, setDisableTarget] = React.useState<string | null>(null);

  const [draft, setDraft] = React.useState<typeof EMPTY_DRAFT | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [formError, setFormError] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<KeywordReply | null>(null);

  /** 新關鍵字的本地 id 產生器：render 期不可用 Date.now()／Math.random() */
  const nextId = React.useRef(1);

  React.useEffect(() => {
    void (async () => {
      try {
        setRows(MOCK_KEYWORD_REPLIES);
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    void (async () => {
      try {
        const features = await listFeatures();
        setFeatureActive(features.some((f) => f.code === 'KEYWORD_REPLY' && f.active));
      } catch {
        toast.show(t.messages.connectionError, 'danger');
      }
    })();
  }, [toast]);

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
    setSaving(true);
    try {
      if (editing) {
        setRows((list) => list.map((r) => (r.id === draft.id ? { ...draft, keyword } : r)));
      } else {
        setRows((list) => [...list, { ...draft, keyword, id: `kw_new_${nextId.current++}` }]);
      }
      setDraft(null);
      toast.show(featureActive ? t.messages.saved : t.messages.savedNotActive);
    } catch {
      toast.show(t.messages.saveFailed, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!deleteTarget) return;
    setRows((list) => list.filter((r) => r.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast.show(t.messages.deleted);
  };

  const toggleRow = (row: KeywordReply) => {
    const next = !row.enabled;
    setRows((list) => list.map((r) => (r.id === row.id ? { ...r, enabled: next } : r)));
    toast.show(
      next
        ? featureActive ? t.messages.enabled : t.messages.enabledNotActive
        : t.messages.disabled,
    );
  };

  const requestSystemToggle = (key: string, next: boolean) => {
    if (next) {
      setSystemEnabled((s) => ({ ...s, [key]: true }));
      toast.show(t.messages.systemGroupRestored);
      return;
    }
    setDisableTarget(key);
  };

  const confirmSystemDisable = () => {
    if (!disableTarget) return;
    setSystemEnabled((s) => ({ ...s, [disableTarget]: false }));
    setDisableTarget(null);
    toast.show(featureActive ? t.messages.systemGroupDisabled : t.messages.savedDisabled);
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
        <Switch checked={r.enabled} onCheckedChange={() => toggleRow(r)} disabled={!featureActive} />
      ),
    },
    {
      key: 'actions', header: t.custom.columns.actions, width: '110px',
      render: (r) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm"
            aria-label={t.actions.edit} title={t.actions.edit}
            disabled={!featureActive}
            onClick={() => openEdit(r)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm"
            aria-label={t.actions.delete} title={t.actions.delete}
            disabled={!featureActive}
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
            <Button onClick={() => openCreate()} disabled={!featureActive}>
              <Plus size={15} />
              {t.actions.create}
            </Button>
          </>
        }
      />

      {!featureActive ? (
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
          <Button variant="outline" size="sm" disabled={!featureActive} onClick={() => openCreate()}>
            {t.actions.createShort}
          </Button>
        </CardHeader>
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
                          disabled={!featureActive}
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

          {!featureActive ? (
            <Alert tone="warning" className="my-3 text-xs">
              {t.feature.systemHint}
              <strong>{t.feature.systemHintStrong}</strong>
              {t.feature.systemHintTail}
            </Alert>
          ) : null}

          <div className="mt-3">
            {t.system.groups.map((g) => (
              <SwitchField
                key={g.key}
                label={g.label}
                description={
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.keywords.map((k) => (
                      <button
                        key={k}
                        type="button"
                        disabled={!featureActive}
                        className="badge badge-neutral disabled:opacity-60"
                        onClick={() => openCreate({ keyword: k, overridesSystem: k })}
                      >
                        {k}
                      </button>
                    ))}
                    {g.note ? <div className="form-text w-full">{g.note}</div> : null}
                  </div>
                }
                checked={systemEnabled[g.key] ?? true}
                onCheckedChange={(v) => requestSystemToggle(g.key, v)}
              />
            ))}
          </div>
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
            {!featureActive ? (
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
                  <Input type="file" accept="image/*" className="form-control-sm" />
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
        onConfirm={remove}
      />

      <ConfirmModal
        open={!!disableTarget}
        title={t.confirm.disableSystemTitle}
        danger
        message={
          <span className="whitespace-pre-line">
            {disableIsEscape && disableGroup
              ? t.confirm.disableEscape(disableGroup.keywords[0])
              : disableGroup
                ? t.confirm.disableNoReply(disableGroup.keywords[0])
                : ''}
            {!featureActive && disableGroup ? (
              <>
                {'\n\n'}
                <AlertTriangle size={13} className="inline" />
                {t.confirm.disableUnsubscribedLead}
                {disableGroup.keywords[0]}
                {t.confirm.disableUnsubscribedTail}
              </>
            ) : null}
          </span>
        }
        onClose={() => setDisableTarget(null)}
        onConfirm={confirmSystemDisable}
      />
    </>
  );
}
