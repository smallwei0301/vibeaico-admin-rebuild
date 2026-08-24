'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  ChevronDown, ChevronLeft, ChevronRight, Eye, Image as ImageIcon, Layers,
  Lock, Palette, Plus, RotateCcw, Send, Sparkles, Trash2, Upload, X,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  FormGroup, FormText, Input, Label, Select, SwitchField, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { listFeatures } from '@/services/settings';
import { useBusinessType, useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { MODE_PRESETS } from '@/config/modes';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { richMenuDesignPage as t } from '@/i18n/zh-TW/pages/rich-menu-design';
import { cn } from '@/lib/utils';

/* ============================================================================
 * 選單設計 /tenant/rich-menu-design
 * ---------------------------------------------------------------------------
 * 原站這一頁的 inline JS 有 590 KB，是全站最大的一頁。骨架保留完整的資訊架構
 * 與所有文案（見 src/i18n/zh-TW/pages/rich-menu-design.ts），互動行為以本地
 * state 模擬；接真實後端時把下列 API 換進 src/services 即可：
 *   GET/PUT  /api/settings/line/rich-menu
 *   POST     /api/settings/line/rich-menu/create-advanced
 *   POST     /api/settings/line/rich-menu/create-scene
 *   POST     /api/settings/line/rich-menu/preview-advanced
 *   POST     /api/settings/line/rich-menu/restore-previous
 *   PUT      /api/settings/line/flex-menu
 *   PUT      /api/settings/line/booking-step-guide
 *
 * ⚠️ 下方的 hex 色碼是「要存進 tenant_settings 的資料值」（LINE 選單底圖配色），
 *    不是本後台的佈景 token，因此不受 CONVENTIONS 的「禁止硬編碼色碼」限制。
 * ========================================================================== */

const FEATURE_CODE = 'CUSTOM_RICH_MENU';

/** 主題風格 → LINE 選單底圖配色（資料值，非後台佈景色） */
const THEMES = [
  { key: 'BOUTIQUE', label: t.theme.options.BOUTIQUE, bg: '#8b6f47', fg: '#ffffff', advanced: true },
  { key: 'LINE_GREEN', label: t.theme.options.LINE_GREEN, bg: '#06c755', fg: '#ffffff', advanced: false },
  { key: 'OCEAN_BLUE', label: t.theme.options.OCEAN_BLUE, bg: '#2196f3', fg: '#ffffff', advanced: true },
  { key: 'ROYAL_PURPLE', label: t.theme.options.ROYAL_PURPLE, bg: '#7b1fa2', fg: '#ffffff', advanced: true },
  { key: 'SUNSET_ORANGE', label: t.theme.options.SUNSET_ORANGE, bg: '#ff7043', fg: '#ffffff', advanced: true },
  { key: 'DARK', label: t.theme.options.DARK, bg: '#212121', fg: '#ffffff', advanced: true },
] as const;

type ThemeKey = (typeof THEMES)[number]['key'];

/** 佈局：每行的格數 */
const LAYOUT_ROWS: Record<string, number[]> = {
  '3+4': [3, 4], '2x3': [3, 3], '2+3': [2, 3], '2x2': [2, 2],
  '1+2': [1, 2], '3+4+4': [3, 4, 4], '4+4': [4, 4],
};

type CellAction = 'OPEN_URL' | 'OPEN_URL_AD' | 'SEND_TEXT' | 'FLEX_POPUP';

type Cell = { label: string; action: CellAction; value: string; icon: string };

const DEFAULT_CELLS: Cell[] = [
  { label: '開始預約', action: 'SEND_TEXT', value: '預約', icon: '' },
  { label: '我的預約', action: 'SEND_TEXT', value: '我的預約', icon: '' },
  { label: '瀏覽商品', action: 'SEND_TEXT', value: '商品', icon: '' },
  { label: '作品展示', action: 'SEND_TEXT', value: '作品', icon: '' },
  { label: '領取票券', action: 'SEND_TEXT', value: '票券', icon: '' },
  { label: '我的票券', action: 'SEND_TEXT', value: '我的票券', icon: '' },
  { label: '會員資訊', action: 'SEND_TEXT', value: '會員', icon: '' },
  { label: '聯絡店家', action: 'SEND_TEXT', value: '聯絡', icon: '' },
  { label: '', action: 'SEND_TEXT', value: '', icon: '' },
  { label: '', action: 'SEND_TEXT', value: '', icon: '' },
  { label: '', action: 'SEND_TEXT', value: '', icon: '' },
];

/** 一頁式範本示範資料。原站是 inline JS 的完整範本庫；spec 只留下扁平字串，
 *  無法還原「哪一句屬於哪一個範本」，這裡以 library.* 的原文組出示範卡。 */
const SCENE_TEMPLATES = t.library.industries.slice(0, 6).map((industry, i) => ({
  id: `scene_${i}`,
  industry,
  name: t.library.sceneNames[i] ?? industry,
  tagline: t.library.industryTaglines[i] ?? '',
  style: t.library.styleDescriptions[i] ?? '',
  theme: THEMES[i % THEMES.length].key as ThemeKey,
}));

const QUICK_TEMPLATES = t.library.styleDescriptions.slice(0, 8).map((style, i) => ({
  id: `quick_${i}`,
  name: t.library.sceneNames[i + 6] ?? `${t.quickTemplates.templateWord} ${i + 1}`,
  style,
  theme: THEMES[(i + 2) % THEMES.length].key as ThemeKey,
}));

const ICON_SIZES = ['填滿', '大', '中', '小'] as const;
const TEXT_SIZES = ['大', '中', '小'] as const;

export default function RichMenuDesignPage() {
  const toast = useToast();
  const [tab, setTab] = React.useState<'richMenu' | 'flexMenu'>('richMenu');
  const [loading, setLoading] = React.useState(true);
  const [subscribed, setSubscribed] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const features = await listFeatures();
      setSubscribed(features.find((f) => f.code === FEATURE_CODE)?.active ?? false);
      setLoading(false);
    })();
  }, []);

  return (
    <>
      <PageHeader eyebrow={nav.navSystem} title={t.title} subtitle={t.subtitle} />

      {!loading && !subscribed && <FeatureLockBar />}

      <Tabs
        className="mb-4"
        value={tab}
        onChange={(k) => setTab(k as typeof tab)}
        items={[
          { key: 'richMenu', label: t.tabs.richMenu, icon: Layers },
          { key: 'flexMenu', label: t.tabs.flexMenu, icon: Sparkles },
        ]}
      />

      <TabPanel active={tab === 'richMenu'}>
        {loading ? <LoadingCard /> : <RichMenuTab subscribed={subscribed} toast={toast} />}
      </TabPanel>
      <TabPanel active={tab === 'flexMenu'}>
        {loading ? <LoadingCard /> : <FlexMenuTab subscribed={subscribed} toast={toast} />}
      </TabPanel>
    </>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardBody className="py-10 text-center text-muted">{common.loading}</CardBody>
    </Card>
  );
}

/** 未訂閱「進階自訂選單」時的頂部提示條 */
function FeatureLockBar() {
  return (
    <Alert
      tone="warning"
      className="mb-4"
      icon={<Lock size={18} className="mt-0.5 flex-shrink-0" />}
      action={
        <Link href="/tenant/feature-store?feature=CUSTOM_RICH_MENU" className="btn btn-primary btn-sm">
          {t.feature.goSubscribe}
        </Link>
      }
    >
      <span className="font-semibold">{t.feature.barLead}</span>
      {t.feature.barItems.map((item) => (
        <Badge key={item} tone="neutral" className="mx-1">{item}</Badge>
      ))}
      <span>{t.feature.barTail}</span>
    </Alert>
  );
}

/* ==========================================================================
 * Rich Menu（底部選單）
 * ======================================================================== */
function RichMenuTab({
  subscribed, toast,
}: { subscribed: boolean; toast: ReturnType<typeof useToast> }) {
  const SHOP_NAME = useCurrentTenant().name;
  const businessType = useBusinessType();

  /**
   * 這個業態實際會被發布的六格（MODE_PRESETS.richMenuCells）。
   * 與 /api/settings/line/rich-menu/create 讀的是同一份 preset，因此畫面預覽
   * 與顧客最後看到的選單一致——先前預覽固定是 DEFAULT_CELLS（美髮沙龍那組），
   * 嚮導看到的預覽跟發布結果對不起來。
   *
   * 必須在 render 期算：模組層取值會在 AppShell 設定業態之前就凍結。
   */
  const modeCells: Cell[] = React.useMemo(
    () => MODE_PRESETS[businessType].richMenuCells.map((c) => ({
      label: c.label, action: 'SEND_TEXT' as CellAction, value: c.text, icon: '',
    })),
    [businessType],
  );

  const [theme, setTheme] = React.useState<ThemeKey>('LINE_GREEN');
  const [layout, setLayout] = React.useState('3+4');
  const [bgUrl, setBgUrl] = React.useState('');
  const [cells, setCells] = React.useState<Cell[]>(DEFAULT_CELLS);
  // 業態一確定就把六格換成該模式的推薦範本（使用者要求「依進入模式不同，
  // 先預設好第一個範本」）。只在使用者還沒動過格子時套用，避免蓋掉他的編輯。
  const [cellsTouched, setCellsTouched] = React.useState(false);
  React.useEffect(() => {
    if (!cellsTouched) setCells(modeCells);
  }, [modeCells, cellsTouched]);
  const [activeCell, setActiveCell] = React.useState(0);
  const [sceneOpen, setSceneOpen] = React.useState(true);
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [introOpen, setIntroOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [confirm, setConfirm] = React.useState<null | 'publish' | 'restore' | 'delete' | 'apply'>(null);
  const [pendingName, setPendingName] = React.useState('');
  const [popupCell, setPopupCell] = React.useState<number | null>(null);
  const [hasBackup, setHasBackup] = React.useState(false);
  const [guideCard, setGuideCard] = React.useState(true);

  const rows = LAYOUT_ROWS[layout] ?? LAYOUT_ROWS['3+4'];
  const cellCount = rows.reduce((a, b) => a + b, 0);
  const themeDef = THEMES.find((x) => x.key === theme)!;
  const layoutDef = t.layout.options.find((l) => l.key === layout);
  const isLarge = rows.length >= 3;

  const updateCell = (i: number, patch: Partial<Cell>) => {
    // 使用者一旦動過格子，就不再被業態預設覆寫（見上面的 cellsTouched effect）
    setCellsTouched(true);
    setCells((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  };

  /** 發布前的驗證 —— 完整照原站規則 */
  const validate = (): string | null => {
    for (let i = 0; i < cellCount; i += 1) {
      const c = cells[i];
      if (!c) continue;
      if ((c.action === 'OPEN_URL' || c.action === 'OPEN_URL_AD')) {
        if (!c.value) return `${i + 1}${t.cells.urlRequiredPrefix}`;
        if (!/^https?:\/\//.test(c.value)) return t.cells.urlScheme;
      }
      if (c.action === 'SEND_TEXT') {
        if (!c.value) return `${i + 1}${t.cells.textRequiredPrefix}`;
        if (c.value.length > 300) return t.cells.textMaxLength;
      }
    }
    return null;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        {/* ------------------------------------------------ 使用說明 */}
        <Card>
          <CardHeader>
            <CardTitle><Sparkles size={16} className="text-primary" />{t.intro.title}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setIntroOpen((v) => !v)}>
              {t.scene.toggle}
              <ChevronDown size={14} className={cn('transition-transform', introOpen && 'rotate-180')} />
            </Button>
          </CardHeader>
          {introOpen && (
            <CardBody className="grid gap-6 md:grid-cols-2">
              <div>
                <h6 className="mb-1 text-base font-bold">{t.intro.richMenuTitle}</h6>
                <p className="form-text mb-2">
                  {t.intro.richMenuLead}
                  <strong className="text-dark">{t.intro.richMenuLeadStrong}</strong>
                  {t.intro.richMenuLeadTail}
                </p>
                <ol className="ml-4 list-decimal space-y-1 text-xs text-neutral-600">
                  {t.intro.richMenuSteps.map((s) => <li key={s}>{s}</li>)}
                </ol>
              </div>
              <div>
                <h6 className="mb-1 text-base font-bold">{t.intro.flexMenuTitle}</h6>
                <p className="form-text mb-2">{t.intro.flexMenuLead}</p>
                <ol className="ml-4 list-decimal space-y-1 text-xs text-neutral-600">
                  {t.intro.flexMenuSteps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                <p className="form-text mt-3">
                  <strong className="text-dark">{t.intro.popupTitle}</strong> {t.intro.popupText}
                </p>
              </div>
            </CardBody>
          )}
        </Card>

        {/* -------------------------------------- 一頁式設計範本 */}
        <Card>
          <CardHeader>
            <CardTitle><Palette size={16} className="text-primary" />{t.scene.cardTitle}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setSceneOpen((v) => !v)}>
              {t.scene.toggle}
              <ChevronDown size={14} className={cn('transition-transform', sceneOpen && 'rotate-180')} />
            </Button>
          </CardHeader>
          {sceneOpen && (
            <CardBody>
              <p className="form-text mb-2">
                {t.scene.lead}
                <strong className="text-dark">{t.scene.leadStrong}</strong>
                {t.scene.leadTail}
              </p>
              <ul className="mb-4 space-y-1 text-xs text-neutral-600">
                {t.scene.bullets.map((b) => (
                  <li key={b.strong}>
                    <strong className="text-dark">{b.strong}</strong>{b.text}
                  </li>
                ))}
              </ul>

              {hasBackup && (
                <Alert tone="info" className="mb-4" action={
                  <Button variant="outline" size="sm" onClick={() => setConfirm('restore')}>
                    <RotateCcw size={13} />{t.scene.restore}
                  </Button>
                }>
                  {t.scene.backupBar}
                </Alert>
              )}

              <div className="mb-3 flex flex-wrap gap-1.5">
                {t.library.industries.map((ind) => (
                  <Badge key={ind} tone="neutral" className="cursor-pointer hover:bg-neutral-250">{ind}</Badge>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {SCENE_TEMPLATES.map((s) => (
                  <div key={s.id} className="overflow-hidden rounded-lg border border-neutral-200">
                    <MenuPreview
                      theme={THEMES.find((x) => x.key === s.theme)!}
                      rows={[3, 4]}
                      cells={modeCells}
                      shopName={SHOP_NAME}
                      compact
                    />
                    <div className="space-y-1 p-3">
                      <div className="text-base font-bold">{s.name}</div>
                      <div className="form-text">{s.tagline}</div>
                      <div className="text-2xs text-secondary">{s.style}</div>
                      <div className="flex gap-1.5 pt-2">
                        <Button variant="outline" size="sm" onClick={() => toast.show(t.scene.previewCaption, 'info')}>
                          <Eye size={13} />{t.scene.previewBtn}
                        </Button>
                        <Button size="sm" onClick={() => { setPendingName(s.name); setConfirm('publish'); }}>
                          <Send size={13} />{t.publish.publish}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="form-text mt-3">{t.scene.previewSyncNote}</p>
            </CardBody>
          )}
        </Card>

        {/* ---------------------------------------- 快速套用範本 */}
        <Card>
          <CardHeader>
            <CardTitle><Layers size={16} className="text-primary" />{t.quickTemplates.cardTitle}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setQuickOpen((v) => !v)}>
              {t.quickTemplates.toggle}
              <ChevronDown size={14} className={cn('transition-transform', quickOpen && 'rotate-180')} />
            </Button>
          </CardHeader>
          {quickOpen && (
            <CardBody>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {QUICK_TEMPLATES.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className="rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:border-primary"
                    onClick={() => { setPendingName(q.name); setConfirm('apply'); }}
                  >
                    <div className="text-base font-semibold">{q.name}</div>
                    <div className="form-text">{q.style}</div>
                  </button>
                ))}
              </div>
            </CardBody>
          )}
        </Card>

        {/* ---------------------------------------------- 主題風格 */}
        <Card>
          <CardHeader><CardTitle>{t.theme.cardTitle}</CardTitle></CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {THEMES.map((th) => (
              <button
                key={th.key}
                type="button"
                onClick={() => setTheme(th.key)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-base transition-colors',
                  theme === th.key ? 'border-primary bg-[var(--primary-a10)] font-semibold' : 'border-neutral-200',
                )}
              >
                <span className="h-4 w-4 rounded-sm" style={{ backgroundColor: th.bg }} />
                {th.label}
                {th.advanced && !subscribed && <Badge tone="warning">{t.theme.advancedBadge}</Badge>}
              </button>
            ))}
          </CardBody>
        </Card>

        {/* -------------------------------------------------- 佈局 */}
        <Card>
          <CardHeader><CardTitle>{t.layout.cardTitle}</CardTitle></CardHeader>
          <CardBody>
            <div className="mb-2 flex flex-wrap gap-2">
              {t.layout.options.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLayout(l.key)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-base transition-colors',
                    layout === l.key ? 'border-primary bg-[var(--primary-a10)] font-semibold' : 'border-neutral-200',
                  )}
                >
                  {l.label}
                  <span className="text-xs text-secondary">{l.cells}</span>
                  {l.advanced && !subscribed && <Badge tone="warning">{t.layout.advancedBadge}</Badge>}
                </button>
              ))}
            </div>
            <FormText>{t.layout.note}</FormText>
          </CardBody>
        </Card>

        {/* ---------------------------------------------- 背景圖片 */}
        <Card>
          <CardHeader><CardTitle><ImageIcon size={16} />{t.background.cardTitle}</CardTitle></CardHeader>
          <CardBody>
            <FormGroup>
              <div className="input-group">
                <Input
                  value={bgUrl}
                  onChange={(e) => setBgUrl(e.target.value)}
                  placeholder={t.background.urlPlaceholder}
                />
                <Button variant="outline"><Upload size={14} />{t.background.uploadImage}</Button>
              </div>
              <FormText>{t.background.urlHint}</FormText>
            </FormGroup>
            <FormText>{t.background.help}</FormText>
            {bgUrl ? (
              <Button variant="outlineDanger" size="sm" className="mt-2" onClick={() => setBgUrl('')}>
                <X size={13} />{t.background.remove}
              </Button>
            ) : (
              <p className="form-text mt-2">{t.background.none}</p>
            )}
          </CardBody>
        </Card>

        {/* ---------------------------------------------- 每格設定 */}
        <Card>
          <CardHeader>
            <CardTitle>{t.cells.cardTitle}</CardTitle>
            <span className="form-text">{t.cells.hint}</span>
          </CardHeader>
          <CardBody className="p-0">
            {!subscribed && (
              <Alert tone="warning" className="m-4" icon={<Lock size={16} className="mt-0.5" />}>
                {t.cells.lockedHint}
              </Alert>
            )}
            {cellCount === 0 ? (
              <EmptyState title={t.layout.cardTitle} description={t.layout.note} />
            ) : (
              <div className="data-table-body">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '48px' }}>{t.cells.columns.index}</th>
                      <th>{t.cells.columns.label}</th>
                      <th style={{ width: '190px' }}>{t.cells.columns.action}</th>
                      <th style={{ width: '160px' }}>{t.cells.columns.icon}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: cellCount }, (_, i) => {
                      const c = cells[i] ?? { label: '', action: 'SEND_TEXT' as CellAction, value: '', icon: '' };
                      return (
                        <tr key={i} className={cn(activeCell === i && 'bg-[var(--primary-a10)]')}>
                          <td onClick={() => setActiveCell(i)}>{i + 1}</td>
                          <td className="!max-w-none">
                            <Input
                              className="form-control-sm"
                              value={c.label}
                              disabled={!subscribed}
                              onChange={(e) => updateCell(i, { label: e.target.value })}
                            />
                          </td>
                          <td className="!max-w-none">
                            <Select
                              className="form-select-sm"
                              value={c.action}
                              disabled={!subscribed}
                              onChange={(e) => updateCell(i, { action: e.target.value as CellAction })}
                            >
                              <option value="SEND_TEXT">{t.cells.actions.SEND_TEXT}</option>
                              <option value="OPEN_URL">{t.cells.actions.OPEN_URL}</option>
                              <option value="OPEN_URL_AD">{t.cells.actions.OPEN_URL_AD_SHORT}</option>
                              <option value="FLEX_POPUP">{t.cells.actions.FLEX_POPUP}</option>
                            </Select>
                            {c.action === 'FLEX_POPUP' ? (
                              <Button variant="ghost" size="sm" className="mt-1" onClick={() => setPopupCell(i)}>
                                {t.cells.clickToConfigure}
                              </Button>
                            ) : (
                              <Input
                                className="form-control-sm mt-1"
                                value={c.value}
                                disabled={!subscribed}
                                placeholder={
                                  c.action === 'SEND_TEXT' ? t.cells.labelPlaceholder : t.cells.urlSchemeShort
                                }
                                onChange={(e) => updateCell(i, { value: e.target.value })}
                              />
                            )}
                          </td>
                          <td className="!max-w-none">
                            <Select className="form-select-sm" disabled={!subscribed} defaultValue={ICON_SIZES[1]}>
                              {ICON_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </Select>
                            <Button variant="ghost" size="sm" className="mt-1" disabled={!subscribed}>
                              <Upload size={12} />{t.cells.iconUpload}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-neutral-200 p-4">
              <FormText>{t.cells.iconSizeHint}</FormText>
              <FormText>{t.cells.sendTextHint}</FormText>
            </div>
          </CardBody>
        </Card>

        {/* -------------------------------------- 預約流程步驟自訂 */}
        <Card>
          <CardHeader><CardTitle>{t.bookingSteps.cardTitle}</CardTitle></CardHeader>
          <CardBody>
            <p className="form-text mb-3">{t.bookingSteps.desc}</p>
            <SwitchField
              label={t.bookingSteps.guideLabel}
              description={t.bookingSteps.guideHelp}
              checked={guideCard}
              onCheckedChange={(v) => {
                setGuideCard(v);
                toast.show(v ? t.bookingSteps.guideOn : t.bookingSteps.guideOff);
              }}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {t.bookingSteps.steps.map((s) => (
                <div key={s} className="rounded-lg border border-neutral-200 p-3">
                  <Label>{s}</Label>
                  <div className="flex gap-2">
                    <Input type="color" defaultValue="#06c755" className="h-9 w-14 p-1" />
                    <Input className="form-control-sm" defaultValue={s} />
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* -------------------------------------- 功能頁面樣式自訂 */}
        <Card>
          <CardHeader><CardTitle>{t.featurePages.cardTitle}</CardTitle></CardHeader>
          <CardBody><p className="form-text">{t.featurePages.desc}</p></CardBody>
        </Card>
      </div>

      {/* ================================================== 右側預覽欄 */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader><CardTitle><Eye size={16} />{t.preview.cardTitle}</CardTitle></CardHeader>
          <CardBody>
            <MenuPreview
              theme={themeDef}
              rows={rows}
              cells={cells}
              shopName={SHOP_NAME}
              bgUrl={bgUrl}
              activeCell={activeCell}
              onCellClick={setActiveCell}
            />
            <p className="form-text mt-3">
              {t.preview.summary(
                themeDef.label,
                layoutDef?.label ?? layout,
                cellCount,
                isLarge ? t.layout.sizeLarge : t.layout.sizeStandard,
                bgUrl ? '' : ` / ${t.background.none}`,
              )}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-2">
            <Button
              block
              loading={publishing}
              loadingText={t.publish.publishing}
              onClick={() => {
                const err = validate();
                if (err) { toast.show(err, 'danger'); return; }
                setPendingName(themeDef.label);
                setConfirm('publish');
              }}
            >
              <Send size={15} />{t.publish.publish}
            </Button>
            <Button block variant="outline" onClick={() => toast.show(t.publish.draftSaved)}>
              {t.publish.saveDraft}
            </Button>
            <Button block variant="outlineDanger" onClick={() => setConfirm('delete')}>
              <Trash2 size={14} />{t.publish.deletePublished}
            </Button>
            <p className="form-text text-center">{t.publish.notPublished}</p>
          </CardBody>
        </Card>
      </div>

      {/* ==================================================== 對話框 */}
      <ConfirmModal
        open={confirm === 'publish'}
        title={t.publish.publish}
        message={`${t.scene.publishConfirmLead}${pendingName}${t.scene.publishConfirmTail}`}
        confirmText={t.publish.publish}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          setPublishing(true);
          await new Promise((r) => setTimeout(r, 500));
          setPublishing(false);
          setHasBackup(true);
          toast.show(subscribed ? t.publish.published : t.feature.freeFallbackNotice, subscribed ? 'success' : 'warning');
        }}
      />
      <ConfirmModal
        open={confirm === 'apply'}
        title={t.quickTemplates.cardTitle}
        message={`${t.quickTemplates.applyConfirmLead}${pendingName}${t.quickTemplates.applyConfirmTail}`}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          setHasBackup(true);
          toast.show(
            subscribed
              ? t.quickTemplates.appliedDraft(pendingName)
              : t.quickTemplates.appliedUnsubscribed(pendingName),
            subscribed ? 'success' : 'warning',
          );
        }}
      />
      <ConfirmModal
        open={confirm === 'restore'}
        title={t.scene.restore}
        message={t.scene.restoreConfirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); setHasBackup(false); toast.show(t.scene.restoreDone); }}
      />
      <ConfirmModal
        open={confirm === 'delete'}
        danger
        title={t.publish.deletePublished}
        message={t.publish.deleteConfirm}
        confirmText={common.delete}
        onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); toast.show(t.publish.deleted); }}
      />
      <FlexPopupModal
        open={popupCell !== null}
        onClose={() => setPopupCell(null)}
        onSave={() => { setPopupCell(null); toast.show(t.flex.popupSaved); }}
      />
    </div>
  );
}

/** LINE 底部選單預覽（純 CSS，無外部套件） */
function MenuPreview({
  theme, rows, cells, shopName, bgUrl, activeCell, onCellClick, compact,
}: {
  theme: (typeof THEMES)[number];
  rows: number[];
  cells: Cell[];
  shopName: string;
  bgUrl?: string;
  activeCell?: number;
  onCellClick?: (i: number) => void;
  compact?: boolean;
}) {
  let index = 0;
  return (
    <div
      className={cn('overflow-hidden rounded-lg', compact ? 'aspect-[5/2]' : 'aspect-[5/2.2]')}
      style={{
        backgroundColor: theme.bg,
        backgroundImage: bgUrl ? `url(${bgUrl})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div className="flex h-full flex-col">
        <div
          className={cn('flex items-center justify-center font-bold', compact ? 'py-1 text-2xs' : 'py-2 text-sm')}
          style={{ color: theme.fg }}
        >
          {shopName}
        </div>
        {rows.map((count, r) => (
          <div key={r} className="flex flex-1 gap-px">
            {Array.from({ length: count }, () => {
              const i = index;
              index += 1;
              const cell = cells[i];
              return (
                <button
                  key={i}
                  type="button"
                  onClick={onCellClick ? () => onCellClick(i) : undefined}
                  className={cn(
                    'flex flex-1 items-center justify-center border border-white/25 text-center leading-tight',
                    compact ? 'text-[7px]' : 'text-2xs',
                    activeCell === i && 'bg-white/25',
                  )}
                  style={{ color: theme.fg }}
                >
                  {cell?.label || `${i + 1}`}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Flex 彈窗卡片設定 */
function FlexPopupModal({
  open, onClose, onSave,
}: { open: boolean; onClose: () => void; onSave: () => void }) {
  const [type, setType] = React.useState('single');
  const [ratio, setRatio] = React.useState<string>(t.flex.popup.ratios[0].value);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t.flex.popup.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{common.cancel}</Button>
          <Button onClick={onSave}>{common.save}</Button>
        </>
      }
    >
      <p className="form-text mb-4">
        {t.flex.popup.lead}
        <strong className="text-dark">{t.flex.popup.leadStrong}</strong>
        {t.flex.popup.leadTail}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <FormGroup>
          <Label>{t.flex.popup.typeLabel}</Label>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="single">{t.flex.popup.typeSingle}</option>
            <option value="carousel">{t.flex.popup.typeCarousel}</option>
          </Select>
        </FormGroup>
        <FormGroup>
          <Label>{t.flex.popup.ratioLabel}</Label>
          <Select
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
            options={t.flex.popup.ratios.map((r) => ({ value: r.value, label: r.label }))}
          />
        </FormGroup>
      </div>
      <FormText>{t.flex.popup.note}</FormText>
    </Modal>
  );
}

/* ==========================================================================
 * Flex 主選單（氣泡選單）
 * ======================================================================== */
type FlexCard = { id: string; title: string; subtitle: string; imageUrl: string; ad: boolean };

const DEFAULT_FLEX_CARDS: FlexCard[] = [
  { id: 'fc_1', title: '開始預約', subtitle: '選擇服務與時段', imageUrl: '', ad: false },
  { id: 'fc_2', title: '我的預約', subtitle: '查詢或取消預約', imageUrl: '', ad: false },
  { id: 'fc_3', title: '瀏覽商品', subtitle: '線上選購', imageUrl: '', ad: false },
];

const MAX_FLEX_CARDS = 12;

function FlexMenuTab({
  subscribed, toast,
}: { subscribed: boolean; toast: ReturnType<typeof useToast> }) {
  const SHOP_NAME = useCurrentTenant().name;
  const [enabled, setEnabled] = React.useState(true);
  const [fallback, setFallback] = React.useState<'HINT' | 'SILENT'>('HINT');
  const [cards, setCards] = React.useState<FlexCard[]>(DEFAULT_FLEX_CARDS);
  const [page, setPage] = React.useState(0);
  const [confirm, setConfirm] = React.useState<null | 'reset' | 'delete' | 'deleteCard'>(null);
  const [target, setTarget] = React.useState<FlexCard | null>(null);
  const nextId = React.useRef(DEFAULT_FLEX_CARDS.length + 1);

  const addCard = (ad: boolean) => {
    if (cards.length >= MAX_FLEX_CARDS) { toast.show(t.flex.maxCards12, 'warning'); return; }
    nextId.current += 1;
    setCards((c) => [...c, {
      id: `fc_${nextId.current}`,
      title: ad ? t.flex.adCardLabel : t.flex.newCard,
      subtitle: '', imageUrl: '', ad,
    }]);
  };

  const current = cards[Math.min(page, cards.length - 1)];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <Card>
          <CardBody>
            <p className="form-text mb-4">{t.flex.intro}</p>
            <SwitchField
              label={t.flex.enabledLabel}
              checked={enabled}
              onCheckedChange={(v) => { setEnabled(v); toast.show(v ? t.flex.enabledOn : t.flex.enabledOff); }}
              description={
                <>
                  {t.flex.enabledOffLead}
                  <strong className="text-dark">{t.flex.enabledOffStrong}</strong>
                  {t.flex.enabledOffTail}
                  <br />
                  <strong className="text-dark">{t.flex.richMenuStillWorks}</strong>
                  {t.flex.richMenuStillWorksTail}
                </>
              }
            />
            {!enabled && (
              <div className="mt-4">
                <Label>{t.flex.fallbackLabel}</Label>
                {([['HINT', t.flex.fallbackHint], ['SILENT', t.flex.fallbackSilent]] as const).map(([k, label]) => (
                  <label key={k} className="mb-1 flex items-start gap-2 text-base">
                    <input
                      type="radio"
                      name="flexFallback"
                      className="mt-1"
                      checked={fallback === k}
                      onChange={() => {
                        setFallback(k);
                        toast.show(k === 'SILENT' ? t.flex.silentSet : t.flex.hintSet);
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.carouselPreview.cardTitle}</CardTitle>
            <span className="form-text">{t.flex.cardCountOfMax(cards.length, MAX_FLEX_CARDS)}</span>
          </CardHeader>
          <CardBody className="p-0">
            {cards.length === 0 ? (
              <EmptyState title={t.flex.minCards} description={t.carouselPreview.note} />
            ) : (
              <div className="data-table-body">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '48px' }}>{t.cells.columns.index}</th>
                      <th>{t.flex.popup.typeLabel}</th>
                      <th>{t.cells.columns.label}</th>
                      <th style={{ width: '80px' }}>{common.delete}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((c, i) => (
                      <tr key={c.id}>
                        <td>{i + 1}</td>
                        <td>{c.ad ? <Badge tone="warning">{t.flex.adBadge}</Badge> : <Badge tone="neutral">{t.flex.newCard}</Badge>}</td>
                        <td className="!max-w-none">
                          <Input
                            className="form-control-sm"
                            value={c.title}
                            onChange={(e) => setCards((cs) => cs.map((x) => x.id === c.id ? { ...x, title: e.target.value } : x))}
                          />
                          <Input
                            className="form-control-sm mt-1"
                            value={c.subtitle}
                            onChange={(e) => setCards((cs) => cs.map((x) => x.id === c.id ? { ...x, subtitle: e.target.value } : x))}
                          />
                        </td>
                        <td>
                          <Button
                            variant="outlineDanger" size="sm"
                            onClick={() => { setTarget(c); setConfirm('deleteCard'); }}
                          >
                            <Trash2 size={13} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-neutral-200 p-4">
              <Button variant="outline" size="sm" onClick={() => addCard(false)}>
                <Plus size={13} />{t.flex.addCard}
              </Button>
              <Button variant="outline" size="sm" onClick={() => addCard(true)}>
                <Plus size={13} />{t.flex.addAdCard}
              </Button>
              <span className="form-text ml-auto self-center">{t.flex.cardCount(cards.length)}</span>
            </div>
            <div className="border-t border-neutral-200 p-4">
              <FormText>{t.carouselPreview.note}</FormText>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader><CardTitle><Eye size={16} />{t.carouselPreview.cardTitle}</CardTitle></CardHeader>
          <CardBody>
            {current ? (
              <>
                <div className="overflow-hidden rounded-lg border border-neutral-200">
                  <div className="bg-line px-3 py-2 text-sm font-bold text-white">{SHOP_NAME}</div>
                  <div className="flex aspect-[20/13] items-center justify-center bg-neutral-100 text-secondary">
                    {current.imageUrl ? null : <ImageIcon size={28} />}
                  </div>
                  <div className="space-y-1 p-3">
                    <div className="text-base font-bold">{current.title}</div>
                    <div className="form-text">{current.subtitle}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Button variant="ghost" size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
                    <ChevronLeft size={14} />
                  </Button>
                  <span className="form-text">
                    {t.carouselPreview.indexPrefix}{page + 1}{t.carouselPreview.countSuffix}
                    {' · '}{t.flex.pageOf(page + 1, cards.length)}
                  </span>
                  <Button variant="ghost" size="sm" disabled={page >= cards.length - 1} onClick={() => setPage(page + 1)}>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </>
            ) : (
              <p className="form-text">{t.preview.waiting}</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-2">
            <Button block onClick={() => toast.show(subscribed ? t.flex.saved : t.feature.flexFreeFallback, subscribed ? 'success' : 'warning')}>
              <Send size={15} />{t.flex.publish}
            </Button>
            <Button block variant="outline" onClick={() => setConfirm('reset')}>
              <RotateCcw size={14} />{t.flex.reset}
            </Button>
            <Button block variant="outlineDanger" onClick={() => setConfirm('delete')}>
              <Trash2 size={14} />{t.flex.deletePublished}
            </Button>
          </CardBody>
        </Card>
      </div>

      <ConfirmModal
        open={confirm === 'reset'}
        title={t.flex.reset}
        message={t.flex.resetConfirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); setCards(DEFAULT_FLEX_CARDS); setPage(0); toast.show(t.flex.resetDone); }}
      />
      <ConfirmModal
        open={confirm === 'delete'}
        danger
        title={t.flex.deletePublished}
        message={t.flex.deletePublishedConfirm}
        confirmText={common.delete}
        onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); toast.show(t.flex.resetToDefault); }}
      />
      <ConfirmModal
        open={confirm === 'deleteCard'}
        danger
        title={common.delete}
        message={`${t.flex.deleteCardLead}${target?.title ?? ''}${t.flex.deleteCardTail}`}
        confirmText={common.delete}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (cards.length <= 1) { toast.show(t.flex.minCards, 'warning'); setConfirm(null); return; }
          setCards((c) => c.filter((x) => x.id !== target?.id));
          setPage(0);
          setConfirm(null);
        }}
      />
    </div>
  );
}
