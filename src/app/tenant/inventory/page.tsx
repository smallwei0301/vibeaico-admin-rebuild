'use client';
import * as React from 'react';
import Link from 'next/link';
import { ClipboardList, Download } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody } from '@/components/ui/Card';
import {
  DataTable, DataTableContainer, DataTableFooter, DataTableHeader, type Column,
} from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listProducts } from '@/services/catalog';
import { listFeatures } from '@/services/settings';
import { byMode } from '@/mock';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { inventoryPage as t } from '@/i18n/zh-TW/pages/inventory';
import { formatDate, formatDateTime, formatNumber } from '@/lib/utils';
import type { Product } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* 本頁專用假資料（不寫進 src/mock，避免與其他頁面衝突）                          */
/* -------------------------------------------------------------------------- */

type InventoryLogType = keyof typeof t.types;

/** 原站 /api/inventory/logs */
type InventoryLog = {
  id: string;
  createdAt: string;
  productId: string;
  productName: string;
  type: InventoryLogType;
  /** 正數＝入庫，負數＝出庫 */
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  operator: string | null;
};

const INVENTORY_LOGS_LOCAL_SHOP: InventoryLog[] = [
  {
    id: 'il_1', createdAt: '2026-08-20T09:12:00+08:00',
    productId: 'p_1', productName: '修護洗髮精 500ml',
    type: 'SALE_OUT', quantity: -1, stockBefore: 25, stockAfter: 24,
    reason: '訂單 PO20260820001', operator: null,
  },
  {
    id: 'il_2', createdAt: '2026-08-19T16:40:00+08:00',
    productId: 'p_2', productName: '護髮油 100ml',
    type: 'SALE_OUT', quantity: -2, stockBefore: 6, stockAfter: 4,
    reason: '訂單 PO20260819004', operator: null,
  },
  {
    id: 'il_3', createdAt: '2026-08-18T11:05:00+08:00',
    productId: 'p_1', productName: '修護洗髮精 500ml',
    type: 'PURCHASE_IN', quantity: 12, stockBefore: 13, stockAfter: 25,
    reason: '進貨補充', operator: '小威',
  },
  {
    id: 'il_4', createdAt: '2026-08-17T18:22:00+08:00',
    productId: 'p_3', productName: '定型噴霧',
    type: 'STOCKTAKE', quantity: -3, stockBefore: 43, stockAfter: 40,
    reason: '盤點調整', operator: 'Amy',
  },
  {
    id: 'il_5', createdAt: '2026-08-16T10:30:00+08:00',
    productId: 'p_2', productName: '護髮油 100ml',
    type: 'DAMAGE', quantity: -1, stockBefore: 7, stockAfter: 6,
    reason: '損耗報廢', operator: 'Ben',
  },
  {
    id: 'il_6', createdAt: '2026-08-15T14:02:00+08:00',
    productId: 'p_1', productName: '修護洗髮精 500ml',
    type: 'RETURN_IN', quantity: 1, stockBefore: 12, stockAfter: 13,
    reason: '退貨入庫', operator: 'Amy',
  },
  {
    id: 'il_7', createdAt: '2026-08-14T20:15:00+08:00',
    productId: 'p_3', productName: '定型噴霧',
    type: 'ORDER_CANCELLED', quantity: 2, stockBefore: 41, stockAfter: 43,
    reason: '訂單取消', operator: null,
  },
  {
    id: 'il_8', createdAt: '2026-08-13T09:48:00+08:00',
    productId: 'p_2', productName: '護髮油 100ml',
    type: 'MANUAL', quantity: -2, stockBefore: 9, stockAfter: 7,
    reason: '手動調整', operator: '小威',
  },
];

const INVENTORY_LOGS_GUIDE: InventoryLog[] = [
  {
    id: 'il_1', createdAt: '2026-08-20T09:12:00+08:00',
    productId: 'p_1', productName: '防水袋 20L',
    type: 'SALE_OUT', quantity: -2, stockBefore: 20, stockAfter: 18,
    reason: '訂單 PO20260820011', operator: null,
  },
  {
    id: 'il_2', createdAt: '2026-08-19T16:40:00+08:00',
    productId: 'p_3', productName: '祕島明信片組（6 入）',
    type: 'SALE_OUT', quantity: -12, stockBefore: 72, stockAfter: 60,
    reason: '訂單 PO20260819008', operator: null,
  },
  {
    id: 'il_3', createdAt: '2026-08-18T11:05:00+08:00',
    productId: 'p_2', productName: '寬簷防曬帽',
    type: 'PURCHASE_IN', quantity: 3, stockBefore: 0, stockAfter: 3,
    reason: '進貨補充', operator: '小威',
  },
  {
    id: 'il_4', createdAt: '2026-08-17T18:22:00+08:00',
    productId: 'p_4', productName: '手繪路線地圖',
    type: 'STOCKTAKE', quantity: -5, stockBefore: 5, stockAfter: 0,
    reason: '盤點調整', operator: '阿海',
  },
  {
    id: 'il_5', createdAt: '2026-08-16T10:30:00+08:00',
    productId: 'p_1', productName: '防水袋 20L',
    type: 'DAMAGE', quantity: -1, stockBefore: 19, stockAfter: 18,
    reason: '出團途中破損', operator: '小雨',
  },
  {
    id: 'il_6', createdAt: '2026-08-15T14:02:00+08:00',
    productId: 'p_3', productName: '祕島明信片組（6 入）',
    type: 'RETURN_IN', quantity: 6, stockBefore: 54, stockAfter: 60,
    reason: '退貨入庫', operator: '阿海',
  },
  {
    id: 'il_7', createdAt: '2026-08-14T20:15:00+08:00',
    productId: 'p_2', productName: '寬簷防曬帽',
    type: 'ORDER_CANCELLED', quantity: 1, stockBefore: 2, stockAfter: 3,
    reason: '訂單取消', operator: null,
  },
  {
    id: 'il_8', createdAt: '2026-08-13T09:48:00+08:00',
    productId: 'p_1', productName: '防水袋 20L',
    type: 'MANUAL', quantity: -1, stockBefore: 19, stockAfter: 18,
    reason: '手動調整', operator: '小威',
  },
];

const INVENTORY_LOGS_CLINIC: InventoryLog[] = [
  {
    id: 'il_1', createdAt: '2026-08-20T09:12:00+08:00',
    productId: 'p_1', productName: '綜合維他命（90 錠）',
    type: 'SALE_OUT', quantity: -2, stockBefore: 34, stockAfter: 32,
    reason: '訂單 PO20260820021', operator: null,
  },
  {
    id: 'il_2', createdAt: '2026-08-19T16:40:00+08:00',
    productId: 'p_2', productName: '益生菌沖劑（30 包）',
    type: 'SALE_OUT', quantity: -1, stockBefore: 7, stockAfter: 6,
    reason: '訂單 PO20260819018', operator: null,
  },
  {
    id: 'il_3', createdAt: '2026-08-18T11:05:00+08:00',
    productId: 'p_1', productName: '綜合維他命（90 錠）',
    type: 'PURCHASE_IN', quantity: 24, stockBefore: 10, stockAfter: 34,
    reason: '進貨補充', operator: '小威',
  },
  {
    id: 'il_4', createdAt: '2026-08-17T18:22:00+08:00',
    productId: 'p_3', productName: '醫用口罩（50 入）',
    type: 'STOCKTAKE', quantity: -3, stockBefore: 7, stockAfter: 4,
    reason: '盤點調整', operator: '護理師 小美',
  },
  {
    id: 'il_5', createdAt: '2026-08-16T10:30:00+08:00',
    productId: 'p_2', productName: '益生菌沖劑（30 包）',
    type: 'DAMAGE', quantity: -1, stockBefore: 8, stockAfter: 7,
    reason: '包裝破損報廢', operator: '護理師 小美',
  },
  {
    id: 'il_6', createdAt: '2026-08-15T14:02:00+08:00',
    productId: 'p_1', productName: '綜合維他命（90 錠）',
    type: 'RETURN_IN', quantity: 2, stockBefore: 8, stockAfter: 10,
    reason: '退貨入庫', operator: '護理師 小美',
  },
  {
    id: 'il_7', createdAt: '2026-08-14T20:15:00+08:00',
    productId: 'p_3', productName: '醫用口罩（50 入）',
    type: 'ORDER_CANCELLED', quantity: 2, stockBefore: 5, stockAfter: 7,
    reason: '訂單取消', operator: null,
  },
  {
    id: 'il_8', createdAt: '2026-08-13T09:48:00+08:00',
    productId: 'p_2', productName: '益生菌沖劑（30 包）',
    type: 'MANUAL', quantity: -1, stockBefore: 9, stockAfter: 8,
    reason: '手動調整', operator: '小威',
  },
];

const TYPE_TONE: Record<InventoryLogType, 'success' | 'danger' | 'info' | 'warning' | 'neutral' | 'purple'> = {
  PURCHASE_IN: 'success',
  SALE_OUT: 'info',
  STOCKTAKE: 'warning',
  MANUAL: 'neutral',
  DAMAGE: 'danger',
  RETURN_IN: 'success',
  ORDER_CANCELLED: 'purple',
};

const TYPE_KEYS = Object.keys(t.types) as InventoryLogType[];

const PAGE_SIZE = 20;

/* -------------------------------------------------------------------------- */

export default function InventoryPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<InventoryLog[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [featureActive, setFeatureActive] = React.useState(true);

  const [typeFilter, setTypeFilter] = React.useState('');
  const [productFilter, setProductFilter] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [exportOpen, setExportOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 320));
      setRows(byMode({
        LOCAL_SHOP: INVENTORY_LOGS_LOCAL_SHOP, GUIDE: INVENTORY_LOGS_GUIDE, CLINIC: INVENTORY_LOGS_CLINIC,
      }));
    } catch (e) {
      toast.show(
        `${t.messages.loadLogsFailed}${e instanceof Error ? e.message : t.messages.unknownError}`,
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
        const [features, list] = await Promise.all([listFeatures(), listProducts()]);
        setFeatureActive(features.some((f) => f.code === 'INVENTORY' && f.active));
        setProducts(list);
      } catch {
        toast.show(t.messages.connectionError, 'danger');
      }
    })();
  }, [toast]);

  const filtered = React.useMemo(() => rows.filter((log) => {
    if (typeFilter && log.type !== typeFilter) return false;
    if (productFilter && log.productId !== productFilter) return false;
    return true;
  }), [rows, typeFilter, productFilter]);

  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const exportCsv = () => {
    /* 事件處理器內才取當下日期；render 期不碰 Date */
    const today = formatDate(new Date().toISOString()).replace(/\//g, '');
    setExportOpen(false);
    toast.show(`${t.messages.exported} ${t.exportFile.filename(today)}`);
  };

  const columns: Column<InventoryLog>[] = [
    {
      key: 'time', header: t.columns.time, width: '150px',
      render: (log) => formatDateTime(log.createdAt),
    },
    {
      key: 'product', header: t.columns.product,
      render: (log) => <span className="font-semibold text-dark">{log.productName}</span>,
    },
    {
      key: 'type', header: t.columns.type, width: '110px',
      render: (log) => <Badge tone={TYPE_TONE[log.type]}>{t.types[log.type]}</Badge>,
    },
    {
      key: 'quantity', header: t.columns.quantity, numeric: true, width: '90px',
      render: (log) => (
        <span className={log.quantity < 0 ? 'text-danger' : 'text-success'}>
          {log.quantity > 0 ? `+${formatNumber(log.quantity)}` : formatNumber(log.quantity)}
        </span>
      ),
    },
    {
      key: 'before', header: t.columns.before, numeric: true, width: '90px',
      render: (log) => formatNumber(log.stockBefore),
    },
    {
      key: 'after', header: t.columns.after, numeric: true, width: '90px',
      render: (log) => formatNumber(log.stockAfter),
    },
    {
      key: 'reason', header: t.columns.reason, width: '180px',
      render: (log) => log.reason || <span className="text-muted">{common.none}</span>,
    },
    {
      key: 'operator', header: t.columns.operator, width: '110px',
      render: (log) => log.operator ?? <span className="text-muted">{t.labels.system}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={nav.navOperation}
        title={t.title}
        actions={
          <Button variant="ghost" onClick={() => setExportOpen(true)}>
            <Download size={15} />{t.actions.export}
          </Button>
        }
      />

      {!featureActive ? (
        <Alert tone="warning" className="mb-3" title={t.feature.title}>
          {t.feature.lead}
          <strong>{t.feature.strong}</strong>
          {t.feature.tail}
          {' '}
          <Link className="underline" href="/tenant/feature-store">{t.feature.learnMore}</Link>
        </Alert>
      ) : null}

      <Card className="mb-3">
        <CardBody>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-700">{t.filter.typeLabel}</span>
              <Select
                className="form-select-sm w-auto"
                aria-label={t.filter.typeLabel}
                value={typeFilter}
                onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              >
                <option value="">{t.filter.typeAll}</option>
                {TYPE_KEYS.map((key) => (
                  <option key={key} value={key}>{t.types[key]}</option>
                ))}
              </Select>
            </span>

            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-700">{t.filter.productLabel}</span>
              <Select
                className="form-select-sm w-auto"
                aria-label={t.filter.productLabel}
                value={productFilter}
                onChange={(e) => { setProductFilter(e.target.value); setPage(0); }}
              >
                <option value="">{t.filter.productAll}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </span>

            <span className="data-table-info">{t.labels.totalCount(filtered.length)}</span>
          </div>
        </CardBody>
      </Card>

      <DataTableContainer>
        <DataTableHeader title={t.tableTitle} />

        <DataTable
          columns={columns}
          rows={visible}
          loading={loading}
          rowKey={(log) => log.id}
          scroll
          empty={
            <EmptyState
              icon={ClipboardList}
              title={t.empty.title}
              description={t.empty.description}
            />
          }
        />

        <DataTableFooter>
          <Pagination page={page} size={PAGE_SIZE} total={filtered.length} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      <ConfirmModal
        open={exportOpen}
        title={t.confirm.exportTitle}
        confirmText={t.actions.export}
        message={t.confirm.export}
        onClose={() => setExportOpen(false)}
        onConfirm={exportCsv}
      />
    </>
  );
}
