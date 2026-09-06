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
import { listInventoryLogs, type InventoryLog, type InventoryLogType } from '@/services/products';
import { exportInventoryCsv } from '@/services/inventory-export';
import { listFeatures } from '@/services/settings';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { inventoryPage as t } from '@/i18n/zh-TW/pages/inventory';
import { formatDateTime, formatNumber } from '@/lib/utils';
import type { Product } from '@/lib/types';

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

export default function InventoryPage() {
  const toast = useToast();

  const [rows, setRows] = React.useState<InventoryLog[]>([]);
  const [products, setProducts] = React.useState<Product[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [featureActive, setFeatureActive] = React.useState(true);
  const [typeFilter, setTypeFilter] = React.useState('');
  const [productFilter, setProductFilter] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [total, setTotal] = React.useState(0);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await listInventoryLogs({
        productId: productFilter || undefined,
        page,
        size: PAGE_SIZE,
      });
      setRows(response.content);
      setTotal(response.totalElements);
    } catch (error) {
      toast.show(
        `${t.messages.loadLogsFailed}${error instanceof Error ? error.message : t.messages.unknownError}`,
        'danger',
      );
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [toast, productFilter, page]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    void (async () => {
      try {
        const [features, list] = await Promise.all([listFeatures(), listProducts()]);
        setFeatureActive(features.some((feature) => feature.code === 'INVENTORY' && feature.active));
        setProducts(list);
      } catch {
        toast.show(t.messages.connectionError, 'danger');
      }
    })();
  }, [toast]);

  const filtered = React.useMemo(
    () => (typeFilter ? rows.filter((log) => log.type === typeFilter) : rows),
    [rows, typeFilter],
  );
  const visible = filtered;
  const displayTotal = typeFilter ? filtered.length : total;

  const runExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportInventoryCsv({
        productId: productFilter || undefined,
        type: typeFilter || undefined,
      });
      if (!result.downloaded) {
        toast.show(t.messages.exportNotDownloaded, 'warning');
        return;
      }
      setExportOpen(false);
      toast.show(result.fileName ? t.messages.exportedAs(result.fileName) : t.messages.exported);
    } catch (error) {
      toast.show(
        `${t.messages.exportFailedPrefix}${error instanceof Error ? error.message : t.messages.unknownError}`,
        'danger',
      );
    } finally {
      setExporting(false);
    }
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
                onChange={(event) => { setTypeFilter(event.target.value); setPage(0); }}
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
                onChange={(event) => { setProductFilter(event.target.value); setPage(0); }}
              >
                <option value="">{t.filter.productAll}</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </Select>
            </span>

            <span className="data-table-info">{t.labels.totalCount(displayTotal)}</span>
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
          <Pagination page={page} size={PAGE_SIZE} total={displayTotal} onChange={setPage} />
        </DataTableFooter>
      </DataTableContainer>

      <ConfirmModal
        open={exportOpen}
        title={t.confirm.exportTitle}
        confirmText={t.actions.export}
        loading={exporting}
        message={t.confirm.export}
        onClose={() => setExportOpen(false)}
        onConfirm={() => { void runExport(); }}
      />
    </>
  );
}
