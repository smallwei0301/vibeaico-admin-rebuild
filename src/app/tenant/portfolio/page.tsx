'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight, ChevronDown, ChevronUp, Eye, EyeOff, Globe, Image as ImageIcon,
  Images, Pencil, Plus, Sparkles, Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, SwitchField, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listFeatures } from '@/services/settings';
import { byMode } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { portfolioPage as t } from '@/i18n/zh-TW/pages/portfolio';
import { formatNumber } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/** 原站 /api/portfolios 的作品結構（LINE 與公開頁各有一組排序） */
type PortfolioItem = {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string;
  extraImageCount: number;
  /** 公開頁排序（數字越小排越前面） */
  sortOrder: number;
  /** LINE 作品瀏覽的排序，與公開頁互不影響 */
  lineSortOrder: number;
  lineFeatured: boolean;
  active: boolean;
};

const PORTFOLIO_LOCAL_SHOP: PortfolioItem[] = [
  {
    id: 'pf_1', title: '韓系空氣感層次燙', description: '微捲弧度搭配低彩度霧棕，適合細軟髮質',
    coverImageUrl: '', extraImageCount: 4, sortOrder: 1, lineSortOrder: 1,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_2', title: '冷霧灰藍挑染', description: '雙色挑染，退色後仍有層次',
    coverImageUrl: '', extraImageCount: 6, sortOrder: 2, lineSortOrder: 2,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_3', title: '新娘白紗造型', description: '',
    coverImageUrl: '', extraImageCount: 8, sortOrder: 3, lineSortOrder: 4,
    lineFeatured: false, active: true,
  },
  {
    id: 'pf_4', title: '男士短髮修剪', description: '兩側推高、上方保留厚度',
    coverImageUrl: '', extraImageCount: 2, sortOrder: 4, lineSortOrder: 3,
    lineFeatured: true, active: false,
  },
];

const PORTFOLIO_GUIDE: PortfolioItem[] = [
  {
    id: 'pf_1', title: '龜山島牛奶海空拍', description: '硫磺噴氣孔染出的乳白海域，只有繞島時看得到',
    coverImageUrl: '', extraImageCount: 6, sortOrder: 1, lineSortOrder: 1,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_2', title: '飛旋海豚追蹤紀錄', description: '2026 年 6 月，一次遇上三群共約 200 隻',
    coverImageUrl: '', extraImageCount: 12, sortOrder: 2, lineSortOrder: 2,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_3', title: '砂婆礑溪谷天然滑水道', description: '',
    coverImageUrl: '', extraImageCount: 8, sortOrder: 3, lineSortOrder: 3,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_4', title: '九份夜色與礦坑遺址', description: '避開人潮的觀景平台，華燈初上那 20 分鐘',
    coverImageUrl: '', extraImageCount: 5, sortOrder: 4, lineSortOrder: 4,
    lineFeatured: false, active: true,
  },
  {
    id: 'pf_5', title: '企業包團紀錄：員工旅遊', description: '12 人包船，客製航線',
    coverImageUrl: '', extraImageCount: 3, sortOrder: 5, lineSortOrder: 5,
    lineFeatured: false, active: false,
  },
];

const PORTFOLIO_CLINIC: PortfolioItem[] = [
  {
    id: 'pf_1', title: '健檢中心環境', description: '獨立診間與更衣空間',
    coverImageUrl: '', extraImageCount: 4, sortOrder: 1, lineSortOrder: 1,
    lineFeatured: true, active: true,
  },
  {
    id: 'pf_2', title: '醫療團隊介紹', description: '',
    coverImageUrl: '', extraImageCount: 3, sortOrder: 2, lineSortOrder: 2,
    lineFeatured: false, active: true,
  },
];

type SortMode = 'line' | 'public';

const EMPTY_DRAFT = {
  id: '',
  title: '',
  description: '',
  sortOrder: 0,
  active: true,
};

/* -------------------------------------------------------------------------- */

export default function PortfolioPage() {
  const toast = useToast();

  const [items, setItems] = React.useState<PortfolioItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [featureActive, setFeatureActive] = React.useState(true);
  const [sortMode, setSortMode] = React.useState<SortMode>('line');

  const [draft, setDraft] = React.useState<typeof EMPTY_DRAFT | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [titleError, setTitleError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<PortfolioItem | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<PortfolioItem | null>(null);
  const [syncConfirm, setSyncConfirm] = React.useState(false);

  /** 新作品的本地 id 產生器：render 期不可用 Date.now()／Math.random() */
  const nextId = React.useRef(1);

  React.useEffect(() => {
    void (async () => {
      try {
        /* 骨架階段作品資料在頁面內，真實後端為 /api/portfolios */
        setItems(byMode({ LOCAL_SHOP: PORTFOLIO_LOCAL_SHOP, GUIDE: PORTFOLIO_GUIDE, CLINIC: PORTFOLIO_CLINIC }));
      } catch {
        toast.show(t.messages.loadPortfolioFailed, 'danger');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  React.useEffect(() => {
    void (async () => {
      try {
        const features = await listFeatures();
        setFeatureActive(features.some((f) => f.code === 'PORTFOLIO_SHOWCASE' && f.active));
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      }
    })();
  }, [toast]);

  /* ------------------------------------------------------------ 衍生值 */

  const activeCount = items.filter((i) => i.active).length;
  const inactiveCount = items.length - activeCount;
  const lineFeaturedCount = items.filter((i) => i.lineFeatured).length;
  const overLineLimit = lineFeaturedCount > t.sort.lineMaxFeatured;

  const ordered = React.useMemo(
    () =>
      [...items].sort((a, b) =>
        sortMode === 'line' ? a.lineSortOrder - b.lineSortOrder : a.sortOrder - b.sortOrder,
      ),
    [items, sortMode],
  );

  const fromLabel = sortMode === 'line' ? t.sort.lineMode : t.sort.publicMode;
  const toModeLabel = sortMode === 'line' ? t.sort.publicLabel : t.sort.lineMode;

  /* -------------------------------------------------------------- 動作 */

  const openCreate = () => {
    setEditing(false);
    setTitleError('');
    setDraft({ ...EMPTY_DRAFT, sortOrder: items.length + 1 });
  };

  const openEdit = (item: PortfolioItem) => {
    setEditing(true);
    setTitleError('');
    setDraft({
      id: item.id,
      title: item.title,
      description: item.description,
      sortOrder: item.sortOrder,
      active: item.active,
    });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      setTitleError(t.messages.titleRequired);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        setItems((list) =>
          list.map((i) =>
            i.id === draft.id
              ? { ...i, title: draft.title.trim(), description: draft.description, sortOrder: draft.sortOrder, active: draft.active }
              : i,
          ),
        );
        toast.show(t.messages.updated);
      } else {
        const id = `pf_new_${nextId.current++}`;
        setItems((list) => [
          ...list,
          {
            id,
            title: draft.title.trim(),
            description: draft.description,
            coverImageUrl: '',
            extraImageCount: 0,
            sortOrder: draft.sortOrder,
            lineSortOrder: list.length + 1,
            lineFeatured: false,
            active: draft.active,
          },
        ]);
        toast.show(t.messages.created);
      }
      setDraft(null);
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!deleteTarget) return;
    setItems((list) => list.filter((i) => i.id !== deleteTarget.id));
    setDeleteTarget(null);
    toast.show(t.messages.deleted);
  };

  const toggleActive = () => {
    if (!toggleTarget) return;
    const nextActive = !toggleTarget.active;
    setItems((list) =>
      list.map((i) => (i.id === toggleTarget.id ? { ...i, active: nextActive } : i)),
    );
    setToggleTarget(null);
    toast.show(t.messages.toggled(nextActive ? t.actions.enable : t.actions.disable));
  };

  const toggleLineFeatured = (item: PortfolioItem) => {
    const next = !item.lineFeatured;
    setItems((list) =>
      list.map((i) => (i.id === item.id ? { ...i, lineFeatured: next } : i)),
    );
    toast.show(next ? t.messages.lineShown : t.messages.lineHidden);
  };

  /** 上／下移：改的是目前排序模式對應的欄位，兩組排序互不影響 */
  const move = (item: PortfolioItem, delta: -1 | 1) => {
    const list = ordered;
    const index = list.findIndex((i) => i.id === item.id);
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const a = list[index];
    const b = list[target];
    setItems((all) =>
      all.map((i) => {
        if (sortMode === 'line') {
          if (i.id === a.id) return { ...i, lineSortOrder: b.lineSortOrder };
          if (i.id === b.id) return { ...i, lineSortOrder: a.lineSortOrder };
          return i;
        }
        if (i.id === a.id) return { ...i, sortOrder: b.sortOrder };
        if (i.id === b.id) return { ...i, sortOrder: a.sortOrder };
        return i;
      }),
    );
    toast.show(sortMode === 'line' ? t.sort.lineOrderUpdated : t.sort.publicOrderUpdated);
  };

  const syncOrder = () => {
    setItems((all) =>
      all.map((i) =>
        sortMode === 'line'
          ? { ...i, sortOrder: i.lineSortOrder }
          : { ...i, lineSortOrder: i.sortOrder },
      ),
    );
    setSyncConfirm(false);
    toast.show(t.sort.syncDone(toModeLabel));
  };

  /* -------------------------------------------------------------- render */

  return (
    <>
      <PageHeader
        eyebrow={nav.navPublicPage}
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <Button onClick={openCreate} disabled={!featureActive}>
            <Plus size={15} />
            {t.actions.create}
          </Button>
        }
      />

      {!featureActive ? (
        <Alert tone="warning" className="mb-4">
          {t.feature.lockedHtmlLead}
          <strong>{t.feature.lockedStrong}</strong>
          {t.feature.lockedTail}
          <Link href="/tenant/feature-store" className="ml-2 font-semibold">
            {t.feature.goToStore}
          </Link>
        </Alert>
      ) : null}

      {/* --------------------------------------------------------- 統計卡 */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label={t.stats.total} value={formatNumber(items.length)} icon={Images} />
        <StatCard label={t.stats.active} value={formatNumber(activeCount)} icon={Eye} tone="success" />
        <StatCard label={t.stats.inactive} value={formatNumber(inactiveCount)} icon={EyeOff} tone="neutral" />
      </div>

      {/* ----------------------------------------------------- 排序模式卡 */}
      <Card className="mb-4">
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{t.sort.modeLabel}</span>
            <div className="btn-group">
              <Button
                variant={sortMode === 'line' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setSortMode('line')}
              >
                <Sparkles size={13} />
                {t.sort.lineMode}
              </Button>
              <Button
                variant={sortMode === 'public' ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setSortMode('public')}
              >
                <Globe size={13} />
                {t.sort.publicMode}
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSyncConfirm(true)}>
              <ArrowLeftRight size={13} />
              {sortMode === 'line' ? t.sort.syncToPublic : t.sort.syncToLine}
            </Button>
          </div>

          <FormText className="mt-3">
            {t.sort.introLead}
            <strong>{t.sort.introStrong}</strong>
            {t.sort.introTail}
          </FormText>

          {sortMode === 'line' ? (
            <>
              <FormText>
                {t.sort.lineHintLead}
                <strong>{t.sort.lineHintStrong}</strong>
                {t.sort.lineHintTail}
                {t.sort.lineHintToggle}
                <strong>{t.sort.lineHintToggleStrong}</strong>
                {t.sort.lineHintToggleTail}
                <strong>{t.sort.lineHintOrderStrong}</strong>
              </FormText>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={overLineLimit ? 'warning' : 'primary'}>
                  {t.sort.lineFeaturedCount(lineFeaturedCount)}
                </Badge>
                {overLineLimit ? (
                  <span className="text-xs text-danger">{t.sort.lineOverLimit}</span>
                ) : null}
              </div>
            </>
          ) : (
            <FormText>
              <strong>{t.sort.publicHintLead}</strong>
              {t.sort.publicHintMiddle}
              <strong>{t.sort.publicHintStrong}</strong>
              {t.sort.publicHintTail}
            </FormText>
          )}
        </CardBody>
      </Card>

      {/* --------------------------------------------------------- 作品牆 */}
      {loading ? (
        <Card>
          <CardBody className="py-10 text-center text-muted">{common.loading}</CardBody>
        </Card>
      ) : ordered.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={Images}
              title={t.empty.title}
              description={t.empty.description}
              action={
                <Button onClick={openCreate} disabled={!featureActive}>
                  <Plus size={15} />
                  {t.actions.create}
                </Button>
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map((item, index) => (
            <Card key={item.id}>
              <CardBody>
                <div className="mb-3 flex h-32 items-center justify-center rounded-md bg-neutral-100 text-secondary">
                  <ImageIcon size={26} />
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-dark">{item.title}</div>
                    <div className="truncate text-xs text-secondary">
                      {item.description || t.labels.noDescription}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={item.lineFeatured ? t.actions.lineShown : t.actions.lineHidden}
                    aria-label={item.lineFeatured ? t.actions.lineShown : t.actions.lineHidden}
                    onClick={() => toggleLineFeatured(item)}
                  >
                    <Sparkles
                      size={15}
                      className={item.lineFeatured ? 'text-primary' : 'text-neutral-400'}
                    />
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={item.active ? 'success' : 'neutral'}>
                    {item.active ? t.labels.active : t.labels.inactive}
                  </Badge>
                  <Badge tone={item.lineFeatured ? 'primary' : 'neutral'}>
                    {item.lineFeatured ? t.labels.lineShown : t.labels.lineHiddenBadge}
                  </Badge>
                  <span className="text-xs text-secondary tabular-nums">
                    {formatNumber(item.extraImageCount)}
                    {t.labels.imageCountSuffix}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1">
                  <Button
                    variant="outline" size="sm"
                    aria-label={common.prev} title={common.prev}
                    disabled={index === 0}
                    onClick={() => move(item, -1)}
                  >
                    <ChevronUp size={13} />
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    aria-label={common.next} title={common.next}
                    disabled={index === ordered.length - 1}
                    onClick={() => move(item, 1)}
                  >
                    <ChevronDown size={13} />
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={!featureActive}
                    onClick={() => openEdit(item)}
                  >
                    <Pencil size={13} />
                    {common.edit}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={!featureActive}
                    onClick={() => setToggleTarget(item)}
                  >
                    {item.active ? t.actions.disable : t.actions.enable}
                  </Button>
                  <Button
                    variant="outlineDanger" size="sm"
                    aria-label={t.actions.delete} title={t.actions.delete}
                    disabled={!featureActive}
                    onClick={() => setDeleteTarget(item)}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* -------------------------------------------------- modal：新增/編輯 */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        size="lg"
        title={editing ? t.form.editTitle : t.form.createTitle}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDraft(null)}>{common.cancel}</Button>
            <Button loading={saving} loadingText={common.saving} onClick={() => void save()}>
              {common.save}
            </Button>
          </>
        }
      >
        {draft ? (
          <>
            <FormGroup>
              <Label htmlFor="titleInput" required>{t.form.titleLabel}</Label>
              <Input
                id="titleInput"
                placeholder={t.form.titlePlaceholder}
                value={draft.title}
                onChange={(e) => {
                  setDraft({ ...draft, title: e.target.value });
                  setTitleError('');
                }}
              />
              {titleError ? <FormError>{titleError}</FormError> : null}
            </FormGroup>

            <FormGroup>
              <Label htmlFor="descriptionInput">{t.form.description}</Label>
              <Textarea
                id="descriptionInput"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label>{t.form.coverImage}</Label>
              <Input type="file" accept="image/*" />
              <FormText>{t.form.coverImageHelp}</FormText>
            </FormGroup>

            <FormGroup>
              <Label>{t.form.extraImages}</Label>
              <Input type="file" accept="image/*" multiple />
              <FormText>{t.form.extraImagesHelp}</FormText>
            </FormGroup>

            <FormGroup>
              <Label htmlFor="sortOrderInput">{t.form.sortOrder}</Label>
              <Input
                id="sortOrderInput"
                type="number"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
              />
              <FormText>{t.form.sortOrderHelp}</FormText>
            </FormGroup>

            <SwitchField
              label={t.form.enabled}
              checked={draft.active}
              onCheckedChange={(v) => setDraft({ ...draft, active: v })}
            />
          </>
        ) : null}
      </Modal>

      {/* ------------------------------------------------------- 確認彈窗 */}
      <ConfirmModal
        open={!!deleteTarget}
        title={t.confirm.deleteTitle}
        message={t.confirm.delete}
        danger
        confirmText={common.delete}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />

      <ConfirmModal
        open={!!toggleTarget}
        title={t.confirm.toggleTitle}
        message={t.confirm.toggle(
          toggleTarget?.active ? t.actions.disable : t.actions.enable,
        )}
        onClose={() => setToggleTarget(null)}
        onConfirm={toggleActive}
      />

      <ConfirmModal
        open={syncConfirm}
        title={t.confirm.syncTitle}
        message={
          <span className="whitespace-pre-line">
            {t.sort.syncConfirm(fromLabel, toModeLabel)}
          </span>
        }
        onClose={() => setSyncConfirm(false)}
        onConfirm={syncOrder}
      />
    </>
  );
}
