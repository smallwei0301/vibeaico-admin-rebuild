'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Boxes, ChevronDown, ChevronUp, FolderPlus, Globe, Package, Pencil, Plus,
  RefreshCcw, Sparkles, Star, Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import {
  FormError, FormGroup, FormText, Input, Label, Select, Switch, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listProducts } from '@/services/catalog';
import {
  adjustProductStock, createProduct, createProductCategory, deleteProduct, deleteProductCategory,
  listProductCategories, reorderProductCategories, reorderProducts, reorderProductsLine,
  toggleProductLineFeatured,
  updateProduct, type ProductCategory,
} from '@/services/products';
import { listFeatures } from '@/services/settings';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { productsPage as t } from '@/i18n/zh-TW/pages/products';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { nextOrderValue, type CatalogPosition } from '@/lib/catalog-order';
import type { Product } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

/**
 * 原站 Product 另有「是否追蹤庫存 / 單次限購 / 草稿」等欄位，尚未收錄進
 * lib/types.ts 的 Product，骨架階段用本頁常數補齊。
 * （公開頁排序已不在此列：0017 之後它就是 API 的 sortOrder。）
 */
type ProductExtras = {
  trackInventory: boolean;
  maxPerOrder: number | null;
  draft: boolean;
  extraImages: string[];
};

const DEFAULT_EXTRAS: ProductExtras = {
  trackInventory: true,
  maxPerOrder: null,
  draft: false,
  extraImages: [],
};

const MOCK_PRODUCT_EXTRAS: Record<string, Partial<ProductExtras>> = {
  p_1: { maxPerOrder: 5 },
  p_3: { trackInventory: false, draft: true },
};

/** LINE 精選最多顯示的件數（原站硬性上限） */
const LINE_FEATURED_MAX = 11;
/** 其他圖片上限 */
const EXTRA_IMAGE_MAX = 8;

const CATEGORY_ALL = '';
const CATEGORY_NONE = 'none';

/* -------------------------------------------------------------------------- */

type ProductRow = Product & ProductExtras & { lineSortOrder: number };

const toRow = (p: Product): ProductRow => ({
  ...p,
  ...DEFAULT_EXTRAS,
  ...(MOCK_PRODUCT_EXTRAS[p.id] ?? {}),
  lineSortOrder: p.lineSortOrder ?? p.sortOrder,
});

/**
 * 篩選中的相鄰項目交換後，把交換結果放回完整清單的原本槽位。
 * reorder API 收完整租戶清單，隱藏列因此不會留下重複 rank。
 */
function moveWithinFullOrder<T extends { id: string }>(
  allRows: T[],
  visibleRows: T[],
  index: number,
  delta: number,
  orderOf: (row: T) => number,
): T[] | null {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= visibleRows.length) return null;
  const swapped = [...visibleRows];
  [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
  const visibleIds = new Set(visibleRows.map((row) => row.id));
  let visibleIndex = 0;
  return [...allRows]
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map((row) => (visibleIds.has(row.id) ? swapped[visibleIndex++] : row));
}

type SortMode = 'line' | 'public';

type ProductStatus = 'ACTIVE' | 'SOLD_OUT' | 'INACTIVE' | 'DRAFT';

const statusOf = (p: ProductRow): ProductStatus => {
  if (p.draft) return 'DRAFT';
  if (!p.active) return 'INACTIVE';
  if (p.trackInventory && p.stock <= 0) return 'SOLD_OUT';
  return 'ACTIVE';
};

const isLowStock = (p: ProductRow) => p.trackInventory && p.stock <= p.safetyStock;

export default function ProductsPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<ProductRow[]>([]);
  const [categories, setCategories] = React.useState<ProductCategory[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [tipsOpen, setTipsOpen] = React.useState(true);
  const [salesFeature, setSalesFeature] = React.useState(true);
  const [inventoryFeature, setInventoryFeature] = React.useState(true);

  const [categoryFilter, setCategoryFilter] = React.useState<string>(CATEGORY_ALL);
  const [lowStockOnly, setLowStockOnly] = React.useState(false);
  const [sortMode, setSortMode] = React.useState<SortMode>('line');

  /* 4 個 modal */
  const [formTarget, setFormTarget] = React.useState<ProductRow | null | undefined>(undefined);
  const [stockTarget, setStockTarget] = React.useState<ProductRow | null>(null);
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<ProductRow | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<ProductRow | null>(null);
  const [syncOpen, setSyncOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([listProducts(), listProductCategories()]);
      setRows(list.map(toRow));
      setCategories(cats);
    } catch (e) {
      toast.show(
        `${t.messages.loadProductsFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    void (async () => {
      try {
        const features = await listFeatures();
        setSalesFeature(features.some((f) => f.code === 'PRODUCT_SALES' && f.active));
        setInventoryFeature(features.some((f) => f.code === 'INVENTORY' && f.active));
      } catch {
        toast.show(t.messages.retryLater, 'danger');
      }
    })();
  }, [toast]);

  const orderOf = React.useCallback(
    (p: ProductRow) => (sortMode === 'line' ? p.lineSortOrder : p.sortOrder),
    [sortMode],
  );

  const visible = React.useMemo(() => {
    let filtered = categoryFilter === CATEGORY_ALL
      ? rows
      : categoryFilter === CATEGORY_NONE
        ? rows.filter((p) => !p.categoryId)
        : rows.filter((p) => p.categoryId === categoryFilter);
    if (lowStockOnly) filtered = filtered.filter(isLowStock);
    return [...filtered].sort((a, b) => orderOf(a) - orderOf(b));
  }, [rows, categoryFilter, lowStockOnly, orderOf]);

  const lineFeaturedCount = rows.filter((p) => p.lineFeatured).length;
  const uncategorizedCount = rows.filter((p) => !p.categoryId).length;
  const lowStockCount = rows.filter(isLowStock).length;

  const move = async (index: number, delta: number) => {
    const reordered = moveWithinFullOrder(rows, visible, index, delta, orderOf);
    if (!reordered) return;
    const orderById = new Map(reordered.map((p, i) => [p.id, i]));
    const nextRows = rows.map((p) => {
      const order = orderById.get(p.id);
      if (order === undefined) return p;
      return sortMode === 'line' ? { ...p, lineSortOrder: order } : { ...p, sortOrder: order };
    });
    try {
      await (sortMode === 'line' ? reorderProductsLine : reorderProducts)(reordered.map((p) => p.id));
      setRows(nextRows);
      toast.show(sortMode === 'line' ? t.messages.lineOrderUpdated : t.messages.publicOrderUpdated);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.sortFailed, 'danger');
    }
  };

  const toggleLine = async (p: ProductRow) => {
    if (!p.lineFeatured && lineFeaturedCount >= LINE_FEATURED_MAX) {
      toast.show(`${t.form.limitReachedPrefix}${LINE_FEATURED_MAX}`, 'warning');
      return;
    }
    try {
      const { lineFeatured } = await toggleProductLineFeatured(p.id, !p.lineFeatured);
      setRows((list) => list.map((x) => (x.id === p.id ? { ...x, lineFeatured } : x)));
      toast.show(lineFeatured ? t.messages.lineShown : t.messages.lineHidden);
    } catch (e) {
      toast.show(
        `${t.messages.toggleFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    }
  };

  const upsert = (draft: ProductRow) => {
    setRows((list) => (list.some((p) => p.id === draft.id)
      ? list.map((p) => (p.id === draft.id ? draft : p))
      : [...list, draft]));
  };

  const fromLabel = sortMode === 'line' ? t.toolbar.lineLabel : t.toolbar.publicLabel;
  const toModeLabel = sortMode === 'line' ? t.toolbar.publicShort : t.toolbar.lineShort;
  const toggleActionText = toggleTarget?.active ? t.actions.unpublish : t.actions.publish;

  /* ------------------------------------------------------------------ 欄位 */

  const columns: Column<ProductRow>[] = [
    {
      key: 'name', header: t.columns.name,
      render: (p, i) => (
        <div className="flex items-start gap-2">
          <span className="btn-group">
            <Button
              variant="ghost" size="sm" title={t.labels.moveUp} aria-label={t.labels.moveUp}
              disabled={i === 0} onClick={() => void move(i, -1)}
            >
              <ChevronUp size={13} />
            </Button>
            <Button
              variant="ghost" size="sm" title={t.labels.moveDown} aria-label={t.labels.moveDown}
              disabled={i === visible.length - 1} onClick={() => void move(i, 1)}
            >
              <ChevronDown size={13} />
            </Button>
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-dark">{p.name}</div>
            {p.description ? <div className="text-xs text-secondary">{p.description}</div> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'category', header: t.columns.category, width: '120px',
      render: (p) => (p.categoryName
        ? <Badge tone="neutral">{p.categoryName}</Badge>
        : <span className="text-muted">{t.toolbar.uncategorized}</span>),
    },
    {
      key: 'price', header: t.columns.price, numeric: true, width: '120px',
      render: (p) => formatCurrency(p.price),
    },
    {
      key: 'stock', header: t.columns.stock, numeric: true, width: '120px',
      render: (p) => (!p.trackInventory ? (
        <span className="text-muted">{t.labels.stockUntracked}</span>
      ) : (
        <div>
          <div>{formatNumber(p.stock)}</div>
          {isLowStock(p) ? (
            <div className="text-2xs text-danger">{t.stock.belowSafety}</div>
          ) : null}
        </div>
      )),
    },
    {
      key: 'status', header: t.columns.status, width: '110px',
      render: (p) => {
        const status = statusOf(p);
        return (
          <Button
            variant="ghost" size="sm"
            title={p.active ? t.labels.clickUnpublish : t.labels.clickPublish}
            aria-label={p.active ? t.labels.clickUnpublish : t.labels.clickPublish}
            onClick={() => setToggleTarget(p)}
          >
            {status === 'ACTIVE' ? <Badge tone="success">{t.labels.active}</Badge> : null}
            {status === 'SOLD_OUT' ? <Badge tone="warning">{t.labels.soldOut}</Badge> : null}
            {status === 'INACTIVE' ? <Badge tone="neutral">{t.labels.inactive}</Badge> : null}
            {status === 'DRAFT' ? <Badge tone="info">{t.labels.draft}</Badge> : null}
          </Button>
        );
      },
    },
    {
      key: 'line', header: t.columns.line, width: '80px',
      render: (p) => (
        <Button
          variant="ghost" size="sm"
          title={p.lineFeatured ? t.labels.lineShown : t.labels.lineHidden}
          aria-label={p.lineFeatured ? t.labels.lineShown : t.labels.lineHidden}
          onClick={() => void toggleLine(p)}
        >
          <Star size={15} className={p.lineFeatured ? 'text-warning' : 'text-neutral-400'} />
        </Button>
      ),
    },
    {
      key: 'actions', header: t.columns.actions, width: '150px',
      render: (p) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.actions.edit} aria-label={t.actions.edit}
            onClick={() => setFormTarget(p)}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.actions.adjustStock} aria-label={t.actions.adjustStock}
            onClick={() => setStockTarget(p)}
          >
            <Boxes size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={t.actions.delete} aria-label={t.actions.delete}
            onClick={() => setDeleteTarget(p)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <>
            <Button
              variant={lowStockOnly ? 'warning' : 'outline'}
              onClick={() => setLowStockOnly((v) => !v)}
            >
              <AlertTriangle size={15} />{t.actions.lowStock(lowStockCount)}
            </Button>
            <Button variant="outline" onClick={() => setCategoryOpen(true)}>
              <FolderPlus size={15} />{t.actions.manageCategory}
            </Button>
            <Button onClick={() => setFormTarget(null)}>
              <Plus size={15} />{t.actions.create}
            </Button>
          </>
        }
      />

      {/* ---------------------------------------------------- 功能訂閱提示 */}
      {!salesFeature ? (
        <Alert tone="warning" className="mb-3" title={t.feature.productSales}>
          {t.feature.productSalesLead}
          <strong>{t.feature.productSalesStrong}</strong>
          {t.feature.productSalesTail}
          {' '}
          <Link className="underline" href="/tenant/feature-store">{t.feature.learnMore}</Link>
        </Alert>
      ) : null}

      {!inventoryFeature ? (
        <Alert tone="info" className="mb-3" title={t.feature.inventory}>
          {t.feature.inventoryLead}
          <strong>{t.feature.inventoryStrong}</strong>
          {t.feature.inventoryTail}
          {' '}
          <Link className="underline" href="/tenant/feature-store">{t.feature.learnMore}</Link>
        </Alert>
      ) : null}

      {/* ------------------------------------------------------ 使用小提醒卡 */}
      <Card className="mb-3">
        <CardBody>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-base font-bold text-dark">
              <Sparkles size={15} />{t.tips.title}
            </div>
            <Button
              variant="ghost" size="sm"
              aria-expanded={tipsOpen}
              aria-label={t.tips.title}
              onClick={() => setTipsOpen((v) => !v)}
            >
              {tipsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </div>
          {tipsOpen ? (
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-neutral-700">
              {t.tips.items.map((item) => (
                <li key={item.term}>
                  <strong>{item.term}</strong>{item.text}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {/* --------------------------------------------------- 篩選 / 排序模式 */}
      <Card className="mb-3">
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-neutral-700">{t.toolbar.filterLabel}</span>
            <Button
              size="sm" variant={categoryFilter === CATEGORY_ALL ? 'primary' : 'outline'}
              onClick={() => setCategoryFilter(CATEGORY_ALL)}
            >
              {t.toolbar.filterAll}
              <span className="badge badge-neutral">{t.toolbar.filterCount(rows.length)}</span>
            </Button>
            {categories.map((c) => (
              <Button
                key={c.id} size="sm"
                variant={categoryFilter === c.id ? 'primary' : 'outline'}
                onClick={() => setCategoryFilter(c.id)}
              >
                {c.name}
              </Button>
            ))}
            {uncategorizedCount > 0 ? (
              <Button
                size="sm" variant={categoryFilter === CATEGORY_NONE ? 'primary' : 'outline'}
                onClick={() => setCategoryFilter(CATEGORY_NONE)}
              >
                {t.toolbar.uncategorized}
                <span className="badge badge-neutral">{t.toolbar.filterCount(uncategorizedCount)}</span>
              </Button>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-neutral-700">{t.toolbar.sortModeLabel}</span>
            <div className="btn-group">
              <Button
                size="sm" variant={sortMode === 'line' ? 'primary' : 'outline'}
                onClick={() => setSortMode('line')}
              >
                <Sparkles size={13} />{t.toolbar.sortModeLine}
              </Button>
              <Button
                size="sm" variant={sortMode === 'public' ? 'primary' : 'outline'}
                onClick={() => setSortMode('public')}
              >
                <Globe size={13} />{t.toolbar.sortModePublic}
              </Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)}>
              <RefreshCcw size={13} />
              {sortMode === 'line' ? t.toolbar.syncToPublic : t.toolbar.syncToLine}
            </Button>
          </div>

          <p className="form-text">
            {t.toolbar.lineFeaturedLead}
            <strong>{t.toolbar.lineFeaturedCount(lineFeaturedCount)}</strong>
            {t.toolbar.lineFeaturedMax}
          </p>
          {lineFeaturedCount > LINE_FEATURED_MAX ? (
            <p className="form-error">{t.toolbar.lineFeaturedOver}</p>
          ) : null}
          {sortMode === 'public' ? (
            <p className="form-text">{t.toolbar.publicOrderHint}</p>
          ) : null}
        </CardBody>
      </Card>

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />

        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(p) => p.id}
          scroll
          empty={
            lowStockOnly ? (
              <EmptyState
                icon={AlertTriangle}
                title={t.lowStock.title}
                description={t.lowStock.description}
                action={
                  <Button variant="outline" onClick={() => setLowStockOnly(false)}>
                    {t.toolbar.filterAll}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Package}
                title={t.empty.title}
                description={t.empty.description}
                action={
                  <Button onClick={() => setFormTarget(null)}>
                    <Plus size={15} />{t.actions.create}
                  </Button>
                }
              />
            )
          }
        />

        <DataTableFooter>
          <div className="data-table-info">{t.toolbar.totalCount(visible.length)}</div>
        </DataTableFooter>
      </DataTableContainer>

      {/* -------------------------------------------- modal 1：新增/編輯商品 */}
      <ProductFormModal
        open={formTarget !== undefined}
        product={formTarget ?? null}
        categories={categories}
        onOpenCategory={() => setCategoryOpen(true)}
        onClose={() => setFormTarget(undefined)}
        onSaved={(draft, isEdit, positions) => {
          const categoryName = categories.find((c) => c.id === draft.categoryId)?.name ?? null;
          upsert({
            ...draft,
            categoryName,
            sortOrder: isEdit
              ? draft.sortOrder
              : positions?.sortOrder ?? nextOrderValue(rows.map((row) => row.sortOrder)),
            lineSortOrder: isEdit
              ? draft.lineSortOrder
              : positions?.lineSortOrder ?? nextOrderValue(rows.map((row) => row.lineSortOrder)),
          });
          setFormTarget(undefined);
          toast.show(isEdit ? t.messages.updated : t.messages.created);
        }}
      />

      {/* ------------------------------------------------ modal 2：調整庫存 */}
      <StockModal
        product={stockTarget}
        onClose={() => setStockTarget(null)}
        onAdjusted={(product, stock) => {
          setRows((list) => list.map((p) => (p.id === product.id ? { ...p, stock } : p)));
          setStockTarget(null);
        }}
      />

      {/* ------------------------------------------------ modal 3：管理分類 */}
      <CategoryModal
        open={categoryOpen}
        categories={categories}
        onClose={() => setCategoryOpen(false)}
        onChange={setCategories}
      />

      {/* ---------------------------------------- modal 4：上架/下架、排序、刪除 */}
      <ConfirmModal
        open={!!toggleTarget}
        title={t.confirm.toggleTitle}
        confirmText={toggleActionText}
        message={t.confirm.toggle(toggleActionText)}
        onClose={() => setToggleTarget(null)}
        onConfirm={async () => {
          if (!toggleTarget) return;
          const actionText = toggleActionText;
          try {
            await updateProduct(toggleTarget.id, { active: !toggleTarget.active });
            setRows((list) => list.map((p) => (p.id === toggleTarget.id
              ? { ...p, active: !p.active, draft: false }
              : p)));
            setToggleTarget(null);
            toast.show(t.messages.toggled(actionText));
          } catch (e) {
            toast.show(
              `${t.messages.toggleFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
              'danger',
            );
          }
        }}
      />

      <ConfirmModal
        open={syncOpen}
        title={sortMode === 'line' ? t.toolbar.syncToPublic : t.toolbar.syncToLine}
        message={t.confirm.syncOrder(fromLabel, toModeLabel)}
        onClose={() => setSyncOpen(false)}
        onConfirm={async () => {
          const source = [...rows].sort((a, b) => (sortMode === 'line'
            ? a.lineSortOrder - b.lineSortOrder
            : a.sortOrder - b.sortOrder));
          const targetMode: SortMode = sortMode === 'line' ? 'public' : 'line';
          const rankById = new Map(source.map((p, i) => [p.id, i]));
          try {
            await (targetMode === 'line' ? reorderProductsLine : reorderProducts)(source.map((p) => p.id));
            setRows(rows.map((p) => {
              const rank = rankById.get(p.id);
              if (rank === undefined) return p;
              return targetMode === 'line' ? { ...p, lineSortOrder: rank } : { ...p, sortOrder: rank };
            }));
            setSyncOpen(false);
            toast.show(t.messages.orderApplied(toModeLabel));
          } catch (e) {
            toast.show(
              `${t.messages.syncFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
              'danger',
            );
          }
        }}
      />

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
            const res = await deleteProduct(deleteTarget.id);
            if (res?.deactivated) {
              /* 後端因訂單紀錄改軟刪（active=false）→ 保留列，僅改為下架 */
              setRows((list) => list.map((p) => (p.id === deleteTarget.id
                ? { ...p, active: false }
                : p)));
              toast.show(t.messages.toggled(t.actions.unpublish));
            } else {
              setRows((list) => list.filter((p) => p.id !== deleteTarget.id));
              toast.show(t.messages.deleted);
            }
            setDeleteTarget(null);
          } catch (e) {
            toast.show(
              `${t.messages.deleteProductFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
/* modal 1：新增 / 編輯商品                                                     */
/* ========================================================================== */

const EMPTY_PRODUCT: ProductRow = {
  id: '', categoryId: null, categoryName: null, name: '', description: '',
  price: 0, stock: 0, safetyStock: 0, imageUrl: '', active: true, lineFeatured: false,
  sortOrder: 0, lineSortOrder: 0, ...DEFAULT_EXTRAS,
};

function ProductFormModal({
  open, product, categories, onOpenCategory, onClose, onSaved,
}: {
  open: boolean;
  product: ProductRow | null;
  categories: ProductCategory[];
  onOpenCategory: () => void;
  onClose: () => void;
  onSaved: (draft: ProductRow, isEdit: boolean, positions?: Partial<CatalogPosition>) => void;
}) {
  const toast = useToast();
  const isEdit = !!product;

  const [draft, setDraft] = React.useState<ProductRow>(EMPTY_PRODUCT);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setErrors([]);
    setDraft(product ?? EMPTY_PRODUCT);
  }, [open, product]);

  const patch = (p: Partial<ProductRow>) => setDraft((d) => ({ ...d, ...p }));

  const validate = (): string[] => {
    const list: string[] = [];
    if (!draft.name.trim()) list.push(t.form.nameInvalid);
    if (!draft.categoryId) list.push(t.form.categoryInvalid);
    if (!(draft.price >= 0)) list.push(t.form.priceInvalid);
    return list;
  };

  const submit = async () => {
    const list = validate();
    setErrors(list);
    if (list.length) { toast.show(t.messages.checkFields, 'warning'); return; }
    setSaving(true);
    try {
      /* ProductExtras（trackInventory / maxPerOrder / draft…）後端未落地，不隨 payload 送出；
         新增時兩套排序由 server 計算；排序一律使用列表排序控制。 */
      const payload = {
        name: draft.name,
        categoryId: draft.categoryId ?? '',
        description: draft.description,
        price: draft.price,
        stock: draft.stock,
        safetyStock: draft.safetyStock,
        imageUrl: draft.imageUrl,
        active: draft.active,
        lineFeatured: draft.lineFeatured,
      };
      if (isEdit) {
        await updateProduct(draft.id, payload);
        onSaved(draft, true);
      } else {
        const result = await createProduct(payload);
        onSaved({ ...draft, id: result.id }, false, result);
      }
    } catch (e) {
      toast.show(
        `${t.messages.saveFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const addExtraImage = () => {
    if (draft.extraImages.length >= EXTRA_IMAGE_MAX) {
      toast.show(
        `${t.form.limitReachedPrefix}${EXTRA_IMAGE_MAX}${t.form.limitReachedSuffix}`,
        'warning',
      );
      return;
    }
    patch({ extraImages: [...draft.extraImages, `extra-${draft.extraImages.length + 1}`] });
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
          <Label required htmlFor="productName">{t.form.name}</Label>
          <Input
            id="productName" value={draft.name} placeholder={t.form.namePlaceholder}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </FormGroup>

        <FormGroup>
          <div className="flex items-center justify-between">
            <Label required htmlFor="productCategory">{t.form.category}</Label>
            <Button variant="ghost" size="sm" onClick={onOpenCategory}>
              <FolderPlus size={13} />{t.form.categoryManage}
            </Button>
          </div>
          <Select
            id="productCategory" value={draft.categoryId ?? ''}
            onChange={(e) => patch({ categoryId: e.target.value || null })}
          >
            <option value="">{t.form.categoryPlaceholder}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <FormText>{t.form.categoryHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label required htmlFor="productPrice">{t.form.price}</Label>
          <div className="input-group">
            <span className="form-control w-auto flex-none">{t.form.priceUnit}</span>
            <Input
              id="productPrice" type="number" value={draft.price}
              onChange={(e) => patch({ price: Number(e.target.value) })}
            />
          </div>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="productStock">{t.form.stockQuantity}</Label>
          <Input
            id="productStock" type="number" value={draft.stock}
            onChange={(e) => patch({ stock: Number(e.target.value) })}
          />
          <FormText>{t.form.stockQuantityHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="productSafetyStock">{t.form.safetyStock}</Label>
          <Input
            id="productSafetyStock" type="number" value={draft.safetyStock}
            placeholder={t.form.safetyStockPlaceholder}
            onChange={(e) => patch({ safetyStock: Number(e.target.value) })}
          />
          <FormText>{t.form.safetyStockHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="productTrackInventory">{t.form.trackInventoryTitle}</Label>
          <div className="flex items-center gap-2">
            <Switch
              id="productTrackInventory"
              checked={draft.trackInventory}
              onCheckedChange={(v) => patch({ trackInventory: v })}
            />
            <span className="text-base text-neutral-700">{t.form.trackInventory}</span>
          </div>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="productMaxPerOrder">{t.form.maxPerOrder}</Label>
          <Input
            id="productMaxPerOrder" type="number"
            value={draft.maxPerOrder ?? ''}
            placeholder={t.form.maxPerOrderPlaceholder}
            onChange={(e) => patch({ maxPerOrder: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <FormText>{t.form.maxPerOrderHelp}</FormText>
        </FormGroup>

        <FormGroup>
          <Label htmlFor="productSortOrder">{t.form.sortOrder}</Label>
          <Input
            id="productSortOrder" type="number" value={draft.sortOrder} disabled
            onChange={(e) => patch({ sortOrder: Number(e.target.value) })}
          />
          <FormText>{t.form.sortOrderManaged}</FormText>
        </FormGroup>
      </div>

      <FormGroup>
        <Label htmlFor="productMainImage">{t.form.mainImage}</Label>
        <div className="flex items-center gap-2">
          <Input id="productMainImage" type="file" accept="image/*" />
          {draft.imageUrl ? (
            <Button variant="outline" size="sm" onClick={() => patch({ imageUrl: '' })}>
              {t.form.mainImageRemove}
            </Button>
          ) : null}
        </div>
        <FormText>{t.form.mainImageHelp}</FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="productExtraImages">{t.form.extraImages}</Label>
        <div className="flex items-center gap-2">
          <Input id="productExtraImages" type="file" accept="image/*" multiple onChange={addExtraImage} />
        </div>
        <FormText>{t.form.extraImagesHelp}</FormText>
        {draft.extraImages.length === 0 ? (
          <p className="form-text">{t.form.extraImagesEmpty(0, EXTRA_IMAGE_MAX)}</p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="form-text">
              {t.form.extraImagesCount(draft.extraImages.length, EXTRA_IMAGE_MAX)}
            </span>
            {draft.extraImages.map((img) => (
              <Button
                key={img} variant="outline" size="sm"
                onClick={() => patch({ extraImages: draft.extraImages.filter((x) => x !== img) })}
              >
                {t.labels.remove}
              </Button>
            ))}
          </div>
        )}
      </FormGroup>

      <FormGroup>
        <Label htmlFor="productDescription">{t.form.description}</Label>
        <Textarea
          id="productDescription" rows={3} value={draft.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </FormGroup>

      {errors.map((err) => <FormError key={err}>{err}</FormError>)}
    </Modal>
  );
}

/* ========================================================================== */
/* modal 2：調整庫存                                                           */
/* ========================================================================== */

function StockModal({
  product, onClose, onAdjusted,
}: {
  product: ProductRow | null;
  onClose: () => void;
  onAdjusted: (product: ProductRow, stock: number) => void;
}) {
  const toast = useToast();
  const [qty, setQty] = React.useState('0');
  const [reason, setReason] = React.useState('');
  const [otherReason, setOtherReason] = React.useState('');
  const [error, setError] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!product) return;
    setQty('0');
    setReason('');
    setOtherReason('');
    setError('');
  }, [product]);

  const delta = Number(qty);
  const valid = qty.trim() !== '' && Number.isFinite(delta) && delta !== 0;
  const after = product ? product.stock + (Number.isFinite(delta) ? delta : 0) : 0;

  const bump = (n: number) => setQty(String((Number.isFinite(delta) ? delta : 0) + n));

  const submit = async () => {
    if (!product) return;
    if (!valid) { setError(t.stock.qtyInvalid); return; }
    if (after < 0) { setError(t.stock.negativeStock); return; }
    setError('');
    setSaving(true);
    try {
      const reasonText = reason === t.stock.otherValue ? otherReason.trim() : reason;
      const { stock } = await adjustProductStock(
        product.id, { delta, reason: reasonText }, after,
      );
      toast.show(t.stock.success(delta > 0 ? `+${delta}` : `${delta}`, stock));
      onAdjusted(product, stock);
    } catch (e) {
      toast.show(
        `${t.stock.adjustFailedPrefix}${e instanceof Error ? e.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      title={t.stock.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button loading={saving} loadingText={t.stock.submitting} onClick={() => void submit()}>
            {t.stock.submit}
          </Button>
        </>
      }
    >
      <dl className="mb-4 grid grid-cols-3 gap-2 text-base">
        <dt className="text-secondary">{t.stock.productName}</dt>
        <dd className="col-span-2 font-semibold text-dark">{product?.name}</dd>
        <dt className="text-secondary">{t.stock.currentStock}</dt>
        <dd className="col-span-2 tabular-nums">{formatNumber(product?.stock ?? 0)}</dd>
        <dt className="text-secondary">{t.stock.safetyStock}</dt>
        <dd className="col-span-2 tabular-nums">{formatNumber(product?.safetyStock ?? 0)}</dd>
      </dl>

      {product && isLowStock(product) ? (
        <Alert tone="warning" className="mb-4">{t.stock.belowSafety}</Alert>
      ) : null}

      <FormGroup>
        <Label required htmlFor="stockAdjustQty">{t.stock.adjustQty}</Label>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => bump(-10)}>{t.stock.quickMinus10}</Button>
          <Button variant="outline" size="sm" onClick={() => bump(-1)}>{t.stock.quickMinus1}</Button>
          <Button variant="outline" size="sm" onClick={() => bump(1)}>{t.stock.quickPlus1}</Button>
          <Button variant="outline" size="sm" onClick={() => bump(10)}>{t.stock.quickPlus10}</Button>
        </div>
        <Input
          id="stockAdjustQty" type="number" className="text-center" value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <FormText>
          {t.stock.afterAdjust}
          {valid ? formatNumber(after) : t.stock.afterAdjustEmpty}
        </FormText>
      </FormGroup>

      <FormGroup>
        <Label htmlFor="stockReasonSelect">{t.stock.reason}</Label>
        <Select
          id="stockReasonSelect" value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">{t.stock.reasonPlaceholder}</option>
          {t.stock.reasonOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </FormGroup>

      {reason === t.stock.otherValue ? (
        <FormGroup>
          <Label htmlFor="stockReason">{t.stock.otherReason}</Label>
          <Input
            id="stockReason" value={otherReason} placeholder={t.stock.otherReasonPlaceholder}
            onChange={(e) => setOtherReason(e.target.value)}
          />
        </FormGroup>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}
    </Modal>
  );
}

/* ========================================================================== */
/* modal 3：商品分類管理                                                        */
/* ========================================================================== */

function CategoryModal({
  open, categories, onClose, onChange,
}: {
  open: boolean;
  categories: ProductCategory[];
  onClose: () => void;
  onChange: (list: ProductCategory[]) => void;
}) {
  const toast = useToast();

  const [name, setName] = React.useState('');
  const [sortOrder, setSortOrder] = React.useState('0');
  const [active, setActive] = React.useState(true);
  const [error, setError] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<ProductCategory | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setSortOrder('0');
    setActive(true);
    setError('');
  }, [open]);

  const reset = () => {
    setName('');
    setSortOrder('0');
    setActive(true);
    setError('');
  };

  const create = async () => {
    if (!name.trim()) {
      setError(t.category.nameRequired);
      return;
    }
    setError('');
    try {
      /* 後端只收 name（sort_order 自動取最大值+1、無 active 欄位）；排序值與啟用僅前端狀態 */
      const { id } = await createProductCategory(name.trim());
      onChange([
        ...categories,
        {
          id,
          name: name.trim(),
          active,
          sortOrder: Number(sortOrder) || categories.length + 1,
        },
      ]);
      reset();
      toast.show(t.category.created);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.unknownError, 'danger');
    }
  };

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await reorderProductCategories(next.map((c) => c.id));
      onChange(next.map((c, i) => ({ ...c, sortOrder: i + 1 })));
      toast.show(t.category.reordered);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : t.messages.unknownError, 'danger');
    }
  };

  const columns: Column<ProductCategory>[] = [
    { key: 'name', header: t.category.columns.name, render: (c) => c.name },
    {
      key: 'status', header: t.category.columns.status, width: '90px',
      render: (c) => (c.active
        ? <Badge tone="success">{t.labels.enabled}</Badge>
        : <Badge tone="neutral">{t.labels.disabled}</Badge>),
    },
    {
      key: 'actions', header: t.category.columns.actions, width: '160px',
      render: (c, i) => (
        <div className="btn-group">
          <Button
            variant="outline" size="sm" title={t.labels.moveUp} aria-label={t.labels.moveUp}
            disabled={i === 0} onClick={() => void move(i, -1)}
          >
            <ChevronUp size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={t.labels.moveDown} aria-label={t.labels.moveDown}
            disabled={i === categories.length - 1} onClick={() => void move(i, 1)}
          >
            <ChevronDown size={13} />
          </Button>
          <Button
            variant="outline" size="sm" title={common.edit} aria-label={common.edit}
            onClick={() => {
              onChange(categories.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
              toast.show(t.category.updated);
            }}
          >
            <Pencil size={13} />
          </Button>
          <Button
            variant="outlineDanger" size="sm" title={common.delete} aria-label={common.delete}
            onClick={() => setDeleteTarget(c)}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={t.category.title}
        footer={<Button variant="secondary" onClick={onClose}>{common.close}</Button>}
      >
        <p className="form-text mb-3">{t.category.intro}</p>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <Label required htmlFor="catName">{t.category.name}</Label>
            <Input
              id="catName" className="form-control-sm" value={name}
              placeholder={t.category.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="w-24">
            <Label htmlFor="catSortOrder">{t.category.sortOrder}</Label>
            <Input
              id="catSortOrder" type="number" className="form-control-sm" value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch id="catIsActive" checked={active} onCheckedChange={setActive} />
            <span className="text-base text-neutral-700">{t.category.active}</span>
          </div>
          <div className="btn-group pb-1">
            <Button size="sm" onClick={() => void create()}>
              <Plus size={13} />{t.category.create}
            </Button>
            <Button size="sm" variant="outline" onClick={reset}>{t.category.clear}</Button>
          </div>
        </div>
        {error ? <FormError>{error}</FormError> : null}

        <p className="form-text mb-2 mt-3">{t.category.dragHint}</p>

        <DataTableContainer>
          <DataTable
            columns={columns}
            rows={categories}
            rowKey={(c) => c.id}
            empty={<EmptyState icon={FolderPlus} title={t.category.empty} />}
          />
        </DataTableContainer>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        danger
        title={common.delete}
        confirmText={common.delete}
        message={t.category.deleteConfirm}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteProductCategory(deleteTarget.id);
            onChange(categories.filter((c) => c.id !== deleteTarget.id));
            setDeleteTarget(null);
            toast.show(t.category.deleted);
          } catch (e) {
            toast.show(e instanceof Error ? e.message : t.messages.unknownError, 'danger');
          }
        }}
      />
    </>
  );
}
