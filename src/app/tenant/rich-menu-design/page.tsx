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
import {
  listFeatures, getTenantSettings, createRichMenu, deleteRichMenu, saveFlexMenu,
  saveLineSettings,
  // issue #19：進階設計器的 11 支端點（06 分冊 §6.2）
  createAdvancedRichMenu, createSceneRichMenu, previewSceneRichMenu, previewAdvancedRichMenu,
  previewSceneFlex,
  restorePreviousRichMenu, getAdvancedConfig, saveAdvancedConfig,
  getBookingStepGuide, saveBookingStepGuide,
  type RichMenuDesignPayload, type RichMenuPreview, type BookingStepGuidePayload,
} from '@/services/settings';
import { uploadImage, uploadRichMenuBackground, uploadRichMenuCellIcon } from '@/services/upload';
import { MAX_FLEX_CARDS, isAllowedFlexLinkUrl, type FlexCard } from '@/config/tenant-settings';
import { ApiError } from '@/lib/api';
import { useBusinessType, useCurrentTenant } from '@/components/layout/BusinessTypeContext';
import { MODE_PRESETS } from '@/config/modes';
import { SCENE_TEMPLATES as SHARED_SCENE_TEMPLATES } from '@/config/rich-menu-scenes';
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
/**
 * Rich menu 底圖大小上限 —— **1 MB，比 `/api/upload` 自己的 5 MB 嚴**。
 *
 * LINE 官方「Requirements for rich menu image」寫明 Max file size: 1 MB，而
 * `/api/settings/line/rich-menu/create` 是把這張圖的位元組**原樣**上傳給 LINE。
 * 放 2 MB 進來的話上傳會過、儲存會過，然後在「發布」那一刻才失敗——失敗被推遲到
 * 使用者已經離開這個畫面、也不再握著那個檔案的時候。當場擋下才換得掉。
 */
const RICH_MENU_BG_MAX_BYTES = 1024 * 1024;

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

/**
 * 一頁式範本。issue #19 起改由 `src/config/rich-menu-scenes.ts` 提供——
 * `POST …/rich-menu/create-scene` 與 `…/preview-scene` 要用**同一份** id → 設定
 * 的對應，各留一份的話畫面上按的那張卡與後端建立的那一份會分岔。
 *
 * ⚠️ 內容一字未動（仍是 `t.library.industries.slice(0, 6)` 那六張），只是搬檔。
 */
const SCENE_TEMPLATES = SHARED_SCENE_TEMPLATES;

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
        {loading ? <LoadingCard /> : <FlexMenuTab toast={toast} />}
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
  const [confirm, setConfirm] = React.useState<null | 'publish' | 'publishScene' | 'delete'>(null);
  const [pendingName, setPendingName] = React.useState('');
  const [pendingTheme, setPendingTheme] = React.useState<ThemeKey>('LINE_GREEN');
  /** 「發布這個情境範本」確認視窗指向的那一張卡 */
  const [pendingScene, setPendingScene] =
    React.useState<null | (typeof SCENE_TEMPLATES)[number]>(null);
  const [popupCell, setPopupCell] = React.useState<number | null>(null);
  const [richMenuId, setRichMenuId] = React.useState('');
  const [bgUploading, setBgUploading] = React.useState(false);
  const [bgSaving, setBgSaving] = React.useState(false);
  /** 網址輸入框的草稿值（尚未存進 tenant_settings）；bgUrl 才是已落地的值 */
  const [bgUrlDraft, setBgUrlDraft] = React.useState('');
  const bgFileRef = React.useRef<HTMLInputElement>(null);

  /* ---------------------------------------------- issue #19 接上的後端狀態
   * ⚠️ 這一整組在 #19 之前不存在，所以「還原前次發布」「儲存草稿」「情境範本預覽」
   *    「單格圖示上傳」「預約步驟引導」都只能顯示誠實的「尚未建置」。現在有端點了。
   *
   * ⚠️ 三態，不是兩態：`null` = **還不知道**（正在載入），與「已載入且沒有」不同。
   *    載入中把「沒有還原點」顯示成事實，是拿一個我們還沒查到的答案當已知
   *    （CLAUDE.md：不知道就渲染未知，不要顯示一個看起來合理的值）。
   */
  const [configLoading, setConfigLoading] = React.useState(true);
  const [restorePointAt, setRestorePointAt] = React.useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = React.useState<string | null>(null);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [restoring, setRestoring] = React.useState(false);
  /** 情境範本預覽視窗（preview-scene 的結果；null = 沒開） */
  const [scenePreview, setScenePreview] = React.useState<
    null | { name: string; loading: boolean; data: RichMenuPreview | null }
  >(null);
  /** 「看實際會推送的圖」視窗（preview-advanced 的結果；null = 沒開） */
  const [actualPreview, setActualPreview] = React.useState<
    null | { loading: boolean; data: RichMenuPreview | null }
  >(null);
  /** 單格圖示上傳中的那一格（null = 沒有正在上傳的） */
  const [iconUploading, setIconUploading] = React.useState<number | null>(null);
  const iconFileRef = React.useRef<HTMLInputElement>(null);
  const iconTargetCell = React.useRef<number>(0);
  /** 預約步驟引導（booking-step-guide，§6.2.9） */
  const [guideCard, setGuideCard] = React.useState(true);
  const [guideSteps, setGuideSteps] = React.useState<BookingStepGuidePayload['steps']>([]);
  const [savingGuide, setSavingGuide] = React.useState(false);

  /** 目前畫面上的設定 → 端點要的那一份設計（草稿、預覽、發布共用同一個轉換） */
  const designPayload = React.useCallback((): RichMenuDesignPayload => ({
    theme,
    layout,
    cells: cells.slice(0, LAYOUT_ROWS[layout]?.reduce((a, b) => a + b, 0) ?? cells.length)
      .map((c) => ({ label: c.label, action: c.action, value: c.value, icon: c.icon })),
    bgImageUrl: bgUrl,
    /*
     * ⚠️ `chatBarText` 刻意**不從這裡送**：那是顧客在 LINE 聊天室下方看到的字，
     * 預設值由 `richMenuDesignSchema` 決定（server 端 zh-TW，與 flex-menu.ts 的
     * MSG 同一層）。在頁面寫一個中文字面量會違反鐵則 1，放進頁面 i18n 又會讓
     * 「顧客看到的字」與「後台介面的字」混在同一本字典裡。這一頁目前也沒有
     * 讓店家編輯它的欄位——有了再談。
     */
    name: '',
  }), [theme, layout, cells, bgUrl]);

  // 進頁面時把店家上次實際發布的主題／底圖／發布狀態讀回來，畫面才不會跟 LINE 端的
  // 真實狀態脫節（例如已經發布過，卻一直顯示「未發布」的假狀態）。
  React.useEffect(() => {
    void (async () => {
      const settings = await getTenantSettings().catch(() => null);
      if (!settings) return;
      const savedTheme = settings.line.richMenuTheme as ThemeKey | undefined;
      if (savedTheme && THEMES.some((th) => th.key === savedTheme)) setTheme(savedTheme);
      // 底圖同樣要讀回來：發布時真正被用的就是 tenant_settings.line.richMenuBgImageUrl，
      // 欄位卻永遠空白的話，店家會以為自己沒設過底圖（畫面與事實不符）。
      if (settings.line.richMenuBgImageUrl) {
        setBgUrl(settings.line.richMenuBgImageUrl);
        setBgUrlDraft(settings.line.richMenuBgImageUrl);
      }
      if (settings.line.richMenuId) setRichMenuId(settings.line.richMenuId);
    })();
  }, []);

  /*
   * 草稿／已發布／還原點（GET advanced-config）與預約步驟引導。
   *
   * ⚠️ 有草稿就以草稿為準：店家上次按了「儲存草稿」，這一頁再打開卻是別的設定，
   *    等於那顆按鈕又變成假的。已發布的設定只在沒有草稿時當起點。
   * ⚠️ 失敗時**不要**把狀態當成「沒有」——`configLoading` 留在 true，
   *    畫面顯示未知而不是「沒有可還原的設計」（那句話會是編出來的）。
   */
  React.useEffect(() => {
    void (async () => {
      try {
        const [config, guide] = await Promise.all([
          getAdvancedConfig(),
          getBookingStepGuide().catch(() => null),
        ]);
        setRestorePointAt(config.restorePoint?.updatedAt ?? '');
        setDraftSavedAt(config.draft?.updatedAt ?? '');
        const source = config.draft ?? config.published?.config ?? null;
        if (source) {
          if (THEMES.some((th) => th.key === source.theme)) setTheme(source.theme as ThemeKey);
          if (LAYOUT_ROWS[source.layout]) setLayout(source.layout);
          if (source.cells?.length) {
            setCellsTouched(true);
            setCells(source.cells.map((c) => ({
              label: c.label, action: c.action as CellAction, value: c.value, icon: c.icon ?? '',
            })));
          }
        }
        if (guide) {
          setGuideCard(guide.enabled);
          setGuideSteps(guide.steps);
        }
        setConfigLoading(false);
      } catch {
        // 讀不到就停在「未知」——不要退回一個看起來合理的預設值
        setConfigLoading(false);
        setRestorePointAt(null);
      }
    })();
  }, []);

  /**
   * 底圖上傳 —— `/api/upload`，bucket `richmenu-assets`（issue #7 (乙)）。
   *
   * 為什麼上傳完要**接著寫進 tenant_settings**：發布端點
   * `/api/settings/line/rich-menu/create` 的 loadBackgroundImage() 讀的是
   * `line.richMenuBgImageUrl`，**不是**這個請求的 body。只把網址放進 React state
   * 就 toast「上傳成功」，等於再造一個假成功——發布出去的還是主題底圖。
   *
   * ⚠️ 大小上限這裡卡 1 MB，比 `/api/upload` 自己的 5 MB 嚴：LINE 的
   * rich menu 圖片上限就是 1 MB（Messaging API「Requirements for rich menu image」），
   * 而 create 端點是把這張圖的**位元組原樣**丟給 LINE。放 2 MB 進來的話，上傳會成功、
   * 儲存會成功，然後在「發布」那一刻才失敗——失敗被推遲到使用者已經離開這個畫面、
   * 手上也不再握著那個檔案的時候。當場擋下才換得掉。
   * 格式同理只收 JPEG/PNG：`/api/upload` 的 LINE_BOUND_BUCKETS 已經擋掉 WebP，
   * 這裡的 accept 只是讓使用者在選檔對話框就看得到，不是重複驗證。
   */
  const uploadBackground = async (file: File) => {
    if (file.size > RICH_MENU_BG_MAX_BYTES) {
      toast.show(t.background.tooLarge, 'warning');
      return;
    }
    setBgUploading(true);
    try {
      /*
       * issue #19：改走 `POST …/rich-menu/upload-image`，它在**同一個請求裡**
       * 上傳並寫進 `tenant_settings.line.richMenuBgImageUrl`。
       * 原本是 `uploadImage()` + `saveLineSettings()` 兩段——中間只成功一半時
       * （圖進了 bucket、設定沒寫）畫面已經顯示「上傳成功」，而發布出去的還是
       * 主題底圖。一個請求做完就沒有那個中間狀態。
       */
      const { url } = await uploadRichMenuBackground(file);
      setBgUrl(url);
      setBgUrlDraft(url);
      toast.show(t.background.uploaded);
    } catch (e) {
      toast.show(
        `${t.background.uploadFailedPrefix}${e instanceof ApiError ? e.message : ''}`,
        'danger',
      );
    } finally {
      setBgUploading(false);
      if (bgFileRef.current) bgFileRef.current.value = '';
    }
  };

  /** 把網址欄位（貼上的外部網址或剛上傳的網址）存進 tenant_settings，發布才用得到 */
  const saveBackgroundUrl = async (url: string) => {
    setBgSaving(true);
    try {
      await saveLineSettings({ richMenuBgImageUrl: url });
      setBgUrl(url);
      setBgUrlDraft(url);
      toast.show(url ? t.background.saved : t.background.removed);
    } catch (e) {
      toast.show(
        `${t.background.saveFailedPrefix}${e instanceof Error ? e.message : ''}`,
        'danger',
      );
    } finally {
      setBgSaving(false);
    }
  };

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

  /* ══════════════════════════ issue #19 接上的動作（06 分冊 §6.2）
   *
   * ⚠️ 共同紀律：**成功訊息一律 await-first**。每一支都是先 `await` 端點回來、
   *    確定成功，才 `toast.show(...)`。這一頁在 #19 之前有六處是反過來做的
   *    （改本地 state → 立刻顯示成功），那正是本專案在清的假成功。
   */

  /** 儲存草稿（PUT advanced-config）。⚠️ 草稿不是發布，文案不得寫成「已上線」。 */
  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      const { updatedAt } = await saveAdvancedConfig(designPayload());
      setDraftSavedAt(updatedAt);
      toast.show(t.publish.draftSaved, 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : t.publish.draftSaveFailed, 'danger');
    } finally {
      setSavingDraft(false);
    }
  };

  /**
   * 還原上一次發布（POST restore-previous）。
   *
   * 沒有還原點時端點回 404，訊息說明「為什麼沒有」——這裡照原文顯示，
   * 不吞掉、也不改寫成含糊的「操作失敗」。
   */
  const restorePrevious = async () => {
    setRestoring(true);
    try {
      const result = await restorePreviousRichMenu();
      setRichMenuId(result.richMenuId);
      // 還原之後，剛被換下來的那一份成為新的還原點（可以再還原回去一次來回）
      setRestorePointAt(new Date().toISOString());
      toast.show(t.scene.restoreDone, 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : t.scene.restoreFailed, 'danger');
    } finally {
      setRestoring(false);
    }
  };

  /** 情境範本預覽（POST preview-scene）。⚠️ 這一支不會發布任何東西。 */
  const openScenePreview = async (scene: { id: string; name: string }) => {
    setScenePreview({ name: scene.name, loading: true, data: null });
    try {
      const data = await previewSceneRichMenu(scene.id);
      setScenePreview({ name: scene.name, loading: false, data });
    } catch (e) {
      setScenePreview(null);
      toast.show(e instanceof ApiError ? e.message : t.scene.previewFailed, 'danger');
    }
  };

  /**
   * 「看實際會推送的圖」（POST preview-advanced）。
   * ⚠️ 這一支不會發布任何東西——與 openScenePreview 同一條紀律。
   */
  const openActualPreview = async () => {
    setActualPreview({ loading: true, data: null });
    try {
      const data = await previewAdvancedRichMenu(designPayload());
      setActualPreview({ loading: false, data });
    } catch (e) {
      setActualPreview(null);
      toast.show(e instanceof ApiError ? e.message : t.scene.previewFailed, 'danger');
    }
  };

  /** 單格圖示上傳（POST upload-cell-icon）。⚠️ 存得到，但不會畫進 LINE 選單底圖。 */
  const uploadCellIcon = async (file: File, index: number) => {
    if (file.size > RICH_MENU_BG_MAX_BYTES) {
      toast.show(t.background.tooLarge, 'warning');
      return;
    }
    setIconUploading(index);
    try {
      const { url } = await uploadRichMenuCellIcon(file, index);
      updateCell(index, { icon: url });
      // ⚠️ 逐字說出真實效果：已存進草稿、但顧客的選單上看不到它
      toast.show(t.cells.iconUploaded, 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : t.cells.iconUploadFailed, 'danger');
    } finally {
      setIconUploading(null);
      if (iconFileRef.current) iconFileRef.current.value = '';
    }
  };

  /** 預約步驟引導（PUT booking-step-guide）。⚠️ 存得到，但顧客端目前收不到。 */
  const saveGuide = async (next: { enabled: boolean; steps: BookingStepGuidePayload['steps'] }) => {
    setSavingGuide(true);
    try {
      const saved = await saveBookingStepGuide(next);
      setGuideCard(saved.enabled);
      setGuideSteps(saved.steps);
      toast.show(t.bookingSteps.saved, 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : t.bookingSteps.saveFailed, 'danger');
    } finally {
      setSavingGuide(false);
    }
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

              {/*
                * 還原前次發布（issue #19 接上 `POST …/rich-menu/restore-previous`）。
                *
                * ⚠️ 三態，不是兩態：
                *   configLoading      → **還不知道**，顯示載入中，不寫「沒有可還原的」
                *   restorePointAt===''→ 已查過，確實沒有（第一次發布之後本來就沒有上一次）
                *   restorePointAt有值 → 有還原點，按鈕可用
                * 載入中把「沒有」當事實顯示出來，就是拿一個還沒查到的答案冒充已知。
                */}
              {configLoading ? (
                <Alert tone="info" className="mb-4">{t.scene.restoreLoading}</Alert>
              ) : restorePointAt ? (
                <Alert tone="info" className="mb-4" action={
                  <Button
                    variant="outline" size="sm"
                    loading={restoring}
                    loadingText={t.scene.restoring}
                    onClick={() => void restorePrevious()}
                  >
                    <RotateCcw size={13} />{t.scene.restore}
                  </Button>
                }>
                  {t.scene.restoreAvailable}
                </Alert>
              ) : (
                <Alert tone="info" className="mb-4">{t.scene.restoreNonePoint}</Alert>
              )}

              {/*
                * ⚠️ 預覽與實際推送物不一致的常駐告示：卡片縮圖是 MenuPreview 用 CSS
                * 畫的（店名＋每格標籤），但 create route 直接上傳底圖原圖，圖上沒有
                * 任何文字。只改文案不夠——店家是看著縮圖按下發布的，說明必須放在
                * 縮圖旁邊。⚠️ 不准改成去實作文字疊圖（Phase 6+ 進階設計器）。
                */}
              <Alert tone="warning" className="mb-3">{t.preview.notActualNote}</Alert>

              {/*
                * ⚠️ 行業分類 Badge 沒有任何 onClick，也沒有任何篩選狀態：舊樣式給了
                * cursor-pointer + hover 變色，看起來像可以按的篩選鈕，按下去卻什麼
                * 都不會發生（假互動）。本輪只做誠實化，因此移除那組「可按」的外觀，
                * 不新增篩選功能。禁止把 cursor-pointer / hover 加回來。
                */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {t.library.industries.map((ind) => (
                  <Badge key={ind} tone="neutral">{ind}</Badge>
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
                        {/*
                          * issue #19：接上 `POST …/rich-menu/preview-scene`。
                          * ⚠️ 那支端點**一行都不碰 LINE**（06 分冊 §6.2.5），
                          *    整合測試斷言 mock LINE 的 richmenu 建立次數為 0。
                          *    這裡絕對不可以順手改叫 create-scene——按預覽把顧客的
                          *    選單換掉，畫面上看起來會一模一樣。
                          */}
                        <Button
                          variant="outline" size="sm"
                          onClick={() => void openScenePreview(s)}
                        >
                          <Eye size={13} />{t.scene.previewBtn}
                        </Button>
                        {/*
                          * issue #19：範本發布改走 `POST …/rich-menu/create-scene`
                          * （原本借用基本 create，只送 theme，範本 id 根本沒到後端）。
                          */}
                        <Button size="sm" onClick={() => { setPendingScene(s); setConfirm('publishScene'); }}>
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
              {/*
                * ⚠️ 範本套用沒有任何後端，也沒有任何前端副作用：舊實作只是
                * setHasBackup(true) + toast「已套用並暫存！Flex 主選單已上線」，
                * 但每格設定、主題與 Flex 卡片一個都沒變，LINE 端也毫無動靜。
                * 依 CLAUDE.md「Never fabricate a known」改為誠實提示。禁止復原。
                */}
              <Alert tone="warning" className="mb-3">{t.quickTemplates.notBuiltBody}</Alert>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {QUICK_TEMPLATES.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    className="rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:border-primary"
                    onClick={() => toast.show(t.quickTemplates.applyNotEffective(q.name), 'warning')}
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
          <CardBody>
            {/*
              * ⚠️ 「進階」徽章暗示未訂閱就發不出這些主題，但 create route 對主題
              * 沒有任何功能閘門（bodySchema 收全部六個 key，只檢查 MANAGER）。
              * 徽章保留，但要說清楚它不擋發布。禁止復原成沒有說明的樣子。
              */}
            {!subscribed && (
              <Alert tone="info" className="mb-3">{t.theme.advancedBadgeNote}</Alert>
            )}
            <div className="flex flex-wrap gap-2">
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
            </div>
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
            {/*
              * ⚠️ 佈局沒有接上發布：create route 的 CELLS 常數寫死 3×2 六格、
              * 2500×1686，發布請求也只帶 { theme }。畫面卻讓店家挑 7 格／11 格
              * 並標「進階」徽章 —— 必須在挑選處就說明選了也不會生效。禁止復原。
              */}
            <Alert tone="warning" className="mt-3">{t.layout.publishFixedNote}</Alert>
          </CardBody>
        </Card>

        {/* ---------------------------------------------- 背景圖片 */}
        <Card>
          <CardHeader><CardTitle><ImageIcon size={16} />{t.background.cardTitle}</CardTitle></CardHeader>
          <CardBody>
            {/*
              * issue #7 (乙)：底圖真的接上了。兩條路徑都**寫進 tenant_settings.line
              * .richMenuBgImageUrl**，因為 `/api/settings/line/rich-menu/create` 的
              * loadBackgroundImage() 讀的是那個欄位，不是發布請求的 body：
              *   上傳 → uploadImage(file,'richmenu-assets') → POST /api/upload
              *        → saveLineSettings({richMenuBgImageUrl}) → PUT /api/settings/line
              *   貼網址 → 「儲存底圖」→ saveLineSettings(...) → PUT /api/settings/line
              * 只改 React state 就 toast 成功（先前的狀態）＝發布出去的仍是主題底圖。
              * 禁止把任一條改回只動 state。
              */}
            <FormGroup>
              <div className="input-group">
                <Input
                  value={bgUrlDraft}
                  onChange={(e) => setBgUrlDraft(e.target.value)}
                  placeholder={t.background.urlPlaceholder}
                />
                <Button
                  variant="outline"
                  disabled={bgUploading || bgSaving || bgUrlDraft === bgUrl}
                  onClick={() => void saveBackgroundUrl(bgUrlDraft.trim())}
                >
                  {t.background.saveUrl}
                </Button>
                <Button
                  variant="outline"
                  disabled={bgUploading || bgSaving}
                  onClick={() => bgFileRef.current?.click()}
                >
                  <Upload size={14} />
                  {bgUploading ? common.loading : t.background.uploadImage}
                </Button>
              </div>
              <input
                ref={bgFileRef}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadBackground(file);
                }}
              />
              <FormText>{t.background.urlHint}</FormText>
            </FormGroup>
            <FormText>{t.background.help}</FormText>
            {bgUrlDraft !== bgUrl ? (
              <Alert tone="warning" className="mt-3">{t.background.unsavedDraft}</Alert>
            ) : null}
            {bgUrl ? (
              <Button
                variant="outlineDanger" size="sm" className="mt-2"
                disabled={bgUploading || bgSaving}
                onClick={() => void saveBackgroundUrl('')}
              >
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
            <Alert tone="info" className="m-4">{t.cells.publishUsesPreset}</Alert>
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
                            {/*
                              * issue #19：上傳鈕接上 `POST …/rich-menu/upload-cell-icon`
                              * （圖進 bucket、網址存進草稿的那一格、下次開頁面讀得回來）。
                              *
                              * ⚠️ **圖示不會出現在 LINE 選單的底圖上**——本專案沒有影像
                              *    合成能力，發布上傳的是底圖原圖。這件事寫在表格下方的
                              *    常駐說明與成功 toast 裡，不是只寫在註解（CLAUDE.md：
                              *    註解保護的是下一個開發者，被誤導的還是店家）。
                              *
                              * ⚠️ 圖示**尺寸**下拉仍然沒有任何程式碼會讀它，發布端點也沒有
                              *    對應欄位 → 維持停用。接了上傳就順手把尺寸也「看起來能用」，
                              *    等於再造一顆假開關。
                              */}
                            <Select className="form-select-sm" disabled defaultValue={ICON_SIZES[1]}>
                              {ICON_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </Select>
                            <Button
                              variant="ghost" size="sm" className="mt-1"
                              disabled={!subscribed}
                              loading={iconUploading === i}
                              onClick={() => {
                                iconTargetCell.current = i;
                                iconFileRef.current?.click();
                              }}
                            >
                              <Upload size={12} />{t.cells.iconUpload}
                            </Button>
                            {c.icon && (
                              <FormText className="break-all">{t.cells.iconUploadedShort}</FormText>
                            )}
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
              {/*
                * ⚠️ 常駐說明（issue #19 更新）：圖示現在**真的會上傳並存進草稿**，
                * 但**不會被畫進 LINE 選單的底圖**，尺寸下拉也還沒有對應的後端欄位。
                * 這句話必須留在店家讀得到的地方——他上傳完看到「已上傳」，
                * 合理預期它會出現在選單上。
                */}
              <Alert tone="warning" className="mt-3">{t.cells.iconNotComposed}</Alert>
              {/* 圖示檔案選擇器（共用一個 input，目標格子記在 iconTargetCell） */}
              <input
                ref={iconFileRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadCellIcon(file, iconTargetCell.current);
                }}
              />
            </div>
          </CardBody>
        </Card>

        {/* -------------------------------------- 預約流程步驟自訂 */}
        <Card>
          <CardHeader><CardTitle>{t.bookingSteps.cardTitle}</CardTitle></CardHeader>
          <CardBody>
            <p className="form-text mb-3">{t.bookingSteps.desc}</p>
            {/*
              * issue #19：接上 `PUT /api/settings/line/booking-step-guide`
              * （路徑**不在 rich-menu/ 底下**，規格逐字如此，06 分冊 §6.2.0 第 (2) 點）。
              *
              * ⚠️ 設定真的存得進 `tenant_settings.line.bookingStepGuide`、讀得回來、
              *    產出的卡片 payload 也過 LINE 驗證——**但顧客目前收不到它**。
              *    原站的引導卡插在「預約 carousel」最前面，而本專案的「預約」回的是
              *    純文字服務清單，沒有那個 carousel（`line-events.ts` 的
              *    `replyServiceList()`）。這句話必須留在畫面上：把設定存起來是誠實的，
              *    顯示「顧客現在會看到引導卡」則是編造（06 分冊 §6.2.9）。
              */}
            <Alert tone="warning" className="mb-3">{t.bookingSteps.savedButNotDelivered}</Alert>
            <SwitchField
              label={t.bookingSteps.guideLabel}
              description={t.bookingSteps.guideHelp}
              checked={guideCard}
              disabled={savingGuide}
              onCheckedChange={(v) => {
                // 成功訊息 await-first：先送出、成功了才顯示（saveGuide 內部處理）
                void saveGuide({ enabled: v, steps: guideSteps });
              }}
            />
            {configLoading ? (
              /* ⚠️ 載入中顯示「載入中」，不要先畫出一組預設值當成店家存過的設定 */
              <p className="form-text mt-4">{t.bookingSteps.loading}</p>
            ) : (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {guideSteps.map((s, i) => (
                    <div key={s.key} className="rounded-lg border border-neutral-200 p-3">
                      <Label>{t.bookingSteps.stepLabels[s.key] ?? s.key}</Label>
                      <div className="flex gap-2">
                        <Input
                          type="color" className="h-9 w-14 p-1" value={s.color}
                          onChange={(e) => setGuideSteps(
                            (prev) => prev.map((x, xi) => (xi === i ? { ...x, color: e.target.value } : x)),
                          )}
                        />
                        <Input
                          className="form-control-sm" value={s.title}
                          placeholder={t.bookingSteps.stepTitlePlaceholder}
                          onChange={(e) => setGuideSteps(
                            (prev) => prev.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)),
                          )}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <Button
                  className="mt-3"
                  variant="outline"
                  loading={savingGuide}
                  onClick={() => void saveGuide({ enabled: guideCard, steps: guideSteps })}
                >
                  {t.bookingSteps.save}
                </Button>
              </>
            )}
          </CardBody>
        </Card>

        {/* -------------------------------------- 功能頁面樣式自訂 */}
        <Card>
          <CardHeader><CardTitle>{t.featurePages.cardTitle}</CardTitle></CardHeader>
          <CardBody>
            <p className="form-text">{t.featurePages.desc}</p>
            {/* ⚠️ 本區從來沒有任何可編輯欄位，後端也沒有對應設定：必須明說尚未建置 */}
            <Alert tone="warning" className="mt-3">{t.featurePages.notBuiltBody}</Alert>
          </CardBody>
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
              bgUrl={bgUrlDraft}
              activeCell={activeCell}
              onCellClick={setActiveCell}
            />
            <p className="form-text mt-3">
              {t.preview.summary(
                themeDef.label,
                layoutDef?.label ?? layout,
                cellCount,
                isLarge ? t.layout.sizeLarge : t.layout.sizeStandard,
                bgUrlDraft ? '' : ` / ${t.background.none}`,
              )}
            </p>
            {/*
              * ⚠️ 這塊預覽把店名與每格標籤用 CSS 畫在色塊上，但 create route 上傳的是
              * 底圖原圖 —— 圖上沒有店名、沒有格子文字、沒有格線。店家是看著這塊預覽
              * 按下「發布到 LINE」的，所以說明必須貼在預覽底下，不能只寫在註解裡
              * （CLAUDE.md：placeholder 要在使用者讀得到的地方講）。
              * ⚠️ 不准改成去實作文字疊圖來「讓預覽變成真的」——那是 Phase 6+ 的範圍。
              */}
            <Alert tone="warning" className="mt-3">{t.preview.notActualNote}</Alert>
            {/*
              * 「看實際會推送的圖」——`POST …/rich-menu/preview-advanced`。
              *
              * 上面那塊 CSS 預覽畫的是**版位示意**（店名與格子文字是本頁畫上去的）；
              * 這顆按鈕拿回來的是**伺服器真的會上傳給 LINE 的那張圖**。
              * 一句「這不是實際推送物」的告示解釋得了落差，但看不到落差本身；
              * 兩張圖擺在一起，店家才真的知道差在哪。
              *
              * ⚠️ 它呼叫的是 preview，不是 create——按「看實際圖」把顧客的選單換掉，
              *    畫面上會完全看不出來。
              */}
            <Button
              block variant="outline" className="mt-3"
              loading={actualPreview?.loading ?? false}
              onClick={() => void openActualPreview()}
            >
              <Eye size={14} />{t.preview.showActualBtn}
            </Button>
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
                setPendingTheme(theme);
                setConfirm('publish');
              }}
            >
              <Send size={15} />{t.publish.publish}
            </Button>
            {/*
              * issue #19：接上 `PUT …/rich-menu/advanced-config`。
              * ⚠️ **草稿不是發布**：存成功只代表下次打開這一頁看得到同樣的設定，
              *    顧客的選單一點都沒變。成功文案必須這樣寫（鐵則 12）。
              */}
            <Button
              block variant="outline"
              loading={savingDraft}
              onClick={() => void saveDraft()}
            >
              {t.publish.saveDraft}
            </Button>
            <Button block variant="outlineDanger" onClick={() => setConfirm('delete')}>
              <Trash2 size={14} />{t.publish.deletePublished}
            </Button>
            {/*
              * ⚠️ 三態：載入中不要顯示「尚未發布」——那是一個我們還沒查到的答案。
              *    「未發布」與「還不知道」在店家眼裡是兩件事。
              */}
            <p className="form-text text-center">
              {configLoading
                ? t.publish.statusLoading
                : richMenuId ? t.publish.publishedStatus : t.publish.notPublished}
            </p>
            {!configLoading && draftSavedAt && (
              <p className="form-text text-center">{t.publish.draftStatus}</p>
            )}
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
          try {
            /*
             * issue #19：訂閱了就走 `create-advanced`（版型、每格設定、底圖全部
             * 真的送出去，並維護還原點）；沒訂閱的維持基本 `create`——進階端點
             * 擋 CUSTOM_RICH_MENU（09 分冊 §5），基本 5 主題不擋，
             * 直接打進階端點只會拿到 403，等於把免費店家的發布鈕弄壞。
             */
            const result = subscribed
              ? await createAdvancedRichMenu(designPayload())
              : await createRichMenu(pendingTheme);
            setRichMenuId(result.richMenuId);
            if (!subscribed) setTheme(pendingTheme);
            // 這次發布把「剛被換下來的那一份」變成還原點
            if (subscribed) setRestorePointAt(new Date().toISOString());
            toast.show(
              subscribed ? t.publish.published : t.feature.freeFallbackNotice,
              subscribed ? 'success' : 'warning',
            );
          } catch (e) {
            toast.show(e instanceof ApiError ? e.message : t.publish.publishFailed, 'danger');
          } finally {
            setPublishing(false);
          }
        }}
      />
      {/*
        * 情境範本發布（`POST …/rich-menu/create-scene`）。
        * ⚠️ 確認文案必須說出「範本只帶主題配色、六格文案是業態預設」——
        *    店家看到「海鮮餐廳」範本，合理預期會拿到海鮮餐廳的六格文案，
        *    而原站那份對應已遺失且不得憑空補回（REBUILD-SPEC §9.3 第 1 點）。
        */}
      <ConfirmModal
        open={confirm === 'publishScene'}
        title={t.publish.publish}
        message={`${t.scene.publishConfirmLead}${pendingScene?.name ?? ''}${t.scene.sceneConfirmTail}`}
        confirmText={t.publish.publish}
        onClose={() => { setConfirm(null); setPendingScene(null); }}
        onConfirm={async () => {
          const scene = pendingScene;
          setConfirm(null);
          setPendingScene(null);
          if (!scene) return;
          setPublishing(true);
          try {
            const result = await createSceneRichMenu(scene.id);
            setRichMenuId(result.richMenuId);
            setTheme(scene.theme as ThemeKey);
            setRestorePointAt(new Date().toISOString());
            toast.show(t.publish.published, 'success');
          } catch (e) {
            toast.show(e instanceof ApiError ? e.message : t.publish.publishFailed, 'danger');
          } finally {
            setPublishing(false);
          }
        }}
      />
      {/*
        * 情境範本預覽視窗（`POST …/rich-menu/preview-scene`）。
        * ⚠️ 預覽圖是**純色底圖**：沒有店名、沒有格子文字、沒有格線——因為發布真的
        *    上傳給 LINE 的就是這樣一張圖。視窗裡必須照實說，不然這個視窗本身
        *    就變成新的「預覽與實際不一致」。
        */}
      <Modal
        open={scenePreview !== null}
        title={scenePreview?.name ?? t.scene.previewBtn}
        onClose={() => setScenePreview(null)}
      >
        {scenePreview?.loading ? (
          <p className="form-text">{t.scene.previewLoading}</p>
        ) : scenePreview?.data ? (
          <div className="space-y-3">
            <img
              src={scenePreview.data.imageDataUrl}
              alt={scenePreview.name}
              className="w-full rounded-lg border border-neutral-200"
            />
            <Alert tone="warning">{t.scene.previewFlatColorNote}</Alert>
            {scenePreview.data.cellsAreModeDefaults && (
              <Alert tone="info">{t.scene.previewModeDefaultsNote}</Alert>
            )}
            <ul className="space-y-1 text-xs text-neutral-600">
              {scenePreview.data.areas.map((a, i) => (
                <li key={i}>
                  {i + 1}. {String((a.action as { label?: string })?.label ?? '')}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
      <ConfirmModal
        open={confirm === 'delete'}
        danger
        title={t.publish.deletePublished}
        message={t.publish.deleteConfirm}
        confirmText={common.delete}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          try {
            await deleteRichMenu();
            setRichMenuId('');
            toast.show(t.publish.deleted);
          } catch (e) {
            toast.show(e instanceof ApiError ? e.message : t.publish.publishFailed, 'danger');
          }
        }}
      />
      {/*
        * ⚠️ 假成功：舊實作按「儲存」toast「Flex 彈窗已儲存」，但視窗內的類型與圖片
        * 比例只存在 FlexPopupModal 的 local state——沒有端點、沒有 service，也不會
        * 寫回 cells，關掉視窗就沒了。依 CLAUDE.md「成功 toast 是一項事實主張」，
        * 改為誠實提示（尚未生效）。禁止復原成「已儲存」。
        */}
      {/*
        * 「看實際會推送的圖」的視窗。內容與範本預覽同一組說明——因為那句話
        * 在這裡更該講：店家剛剛才看過上面那塊有店名的 CSS 預覽。
        */}
      <Modal
        open={actualPreview !== null}
        title={t.preview.showActualBtn}
        onClose={() => setActualPreview(null)}
      >
        {actualPreview?.loading ? (
          <p className="form-text">{t.scene.previewLoading}</p>
        ) : actualPreview?.data ? (
          <div className="space-y-3">
            <img
              src={actualPreview.data.imageDataUrl}
              alt={t.preview.showActualBtn}
              className="w-full rounded-lg border border-neutral-200"
            />
            <Alert tone="warning">{t.scene.previewFlatColorNote}</Alert>
            <ul className="space-y-1 text-xs text-neutral-600">
              {actualPreview.data.areas.map((a, i) => (
                <li key={i}>
                  {i + 1}. {String((a.action as { label?: string })?.label ?? '')}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
      <FlexPopupModal
        open={popupCell !== null}
        onClose={() => setPopupCell(null)}
        onSave={() => { setPopupCell(null); toast.show(t.cells.flexPopupNotEffective, 'warning'); }}
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
/**
 * 編輯器裡的一列。`id` 只是 React key（送出前會被剝掉）——存進
 * `tenant_settings.line.flexCards` 的形狀由 `flexCardSchema` 定義，
 * 就是 06 分冊 §6 契約的 `{title, subtitle, imageUrl, ad, linkUrl?}`，
 * 這裡不得自行多存東西。
 */
type EditorCard = FlexCard & { id: string };

/**
 * 「恢復預設」用的示範卡片。
 * ⚠️ 這是**編輯器的起始內容**，不是「系統預設樣式」——按下「恢復預設」只會把
 * 編輯器換成這三張，要按「發布」才會寫進店家設定（`t.flex.resetConfirm` 逐字
 * 講了這件事）。三張卡的文字對應 LOCAL_SHOP 的既有關鍵字，按下去打得到 handler。
 */
const DEFAULT_FLEX_CARDS: EditorCard[] = [
  { id: 'fc_1', title: '預約', subtitle: '選擇服務與時段', imageUrl: '', ad: false, linkUrl: '' },
  { id: 'fc_2', title: '我的預約', subtitle: '查詢或取消預約', imageUrl: '', ad: false, linkUrl: '' },
  { id: 'fc_3', title: '商品', subtitle: '線上選購', imageUrl: '', ad: false, linkUrl: '' },
];

/**
 * Flex 主選單分頁。
 *
 * ⚠️ issue #6 之前這整個元件是**假的**（14 分冊 §1 根因 A）：卡片、開關、
 * fallback 全在 React state 裡，「發布」只是 `toast.show(t.flex.saved)`，
 * 沒有呼叫任何端點，重新整理就全部消失，而店家看到的是「主選單已儲存」。
 *
 * 現在的三段鏈路（DoD 10）：
 *   載入  loadFlexMenu() → getTenantSettings() → GET  /api/settings（回 line.flexCards）
 *   發布  publish()      → saveFlexMenu()      → POST /api/settings/line/flex-menu
 *   清除  clearPublished() → saveFlexMenu({ flexCards: [] }) → 同上
 *   傳圖  onPickImage()  → uploadImage(file, 'richmenu-assets') → POST /api/upload
 *
 * 「恢復預設」與「刪除卡片」刻意**只動編輯器**（文案逐字說了「要按發布才會存檔
 * 生效」），所以那兩顆按鈕不呼叫端點——這不是漏接，是與畫面上的承諾一致。
 */
function FlexMenuTab({
  toast,
}: { toast: ReturnType<typeof useToast> }) {
  const SHOP_NAME = useCurrentTenant().name;
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [flexPreviewLoading, setFlexPreviewLoading] = React.useState(false);

  /**
   * 「顧客實際會收到什麼」——問伺服器要一份 `buildFlexMenuOutcome()` 的結果。
   *
   * ⚠️ 讀的是**已儲存**的設定，不是畫面上還沒發布的草稿：說的是「顧客現在會收到
   * 什麼」，不是「你按發布之後會收到什麼」。文案必須跟著這樣寫，不然它就變成
   * 一個看起來像預覽、實際上答非所問的按鈕。
   */
  const previewCustomerMessages = async () => {
    setFlexPreviewLoading(true);
    try {
      const result = await previewSceneFlex();
      toast.show(t.flex.previewCustomerResult(result.messageCount, result.bubbleCount), 'success');
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : t.flex.previewCustomerFailed, 'danger');
    } finally {
      setFlexPreviewLoading(false);
    }
  };
  const [enabled, setEnabled] = React.useState(true);
  const [fallback, setFallback] = React.useState<'HINT' | 'SILENT'>('HINT');
  const [cards, setCards] = React.useState<EditorCard[]>([]);
  const [page, setPage] = React.useState(0);
  const [confirm, setConfirm] = React.useState<null | 'reset' | 'delete' | 'deleteCard'>(null);
  const [target, setTarget] = React.useState<EditorCard | null>(null);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  const nextId = React.useRef(DEFAULT_FLEX_CARDS.length + 1);

  const newId = () => { nextId.current += 1; return `fc_${nextId.current}`; };

  /** 已存的設定（真實來源是 tenant_settings.line，不是本地預設值） */
  React.useEffect(() => {
    void (async () => {
      try {
        const s = await getTenantSettings();
        setEnabled(s.line.flexMenuEnabled);
        setFallback(s.line.flexMenuFallback);
        setCards((s.line.flexCards ?? []).map((c) => ({ ...c, id: newId() })));
      } catch (e) {
        toast.show(
          `${t.flex.loadStateFailedPrefix}${e instanceof ApiError ? e.message : ''}`,
          'danger',
        );
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 編輯器的列 → 端點契約的欄位（id 是 React key，不進資料庫） */
  const toPayload = (rows: EditorCard[]): FlexCard[] =>
    rows.map(({ title, subtitle, imageUrl, ad, linkUrl }) =>
      ({ title, subtitle, imageUrl, ad, linkUrl }));

  const addCard = (ad: boolean) => {
    if (cards.length >= MAX_FLEX_CARDS) {
      toast.show(t.flex.maxCards(MAX_FLEX_CARDS), 'warning');
      return;
    }
    setCards((c) => [...c, {
      id: newId(),
      title: ad ? t.flex.adCardLabel : t.flex.newCard,
      subtitle: '', imageUrl: '', ad, linkUrl: '',
    }]);
  };

  const onPickImage = async (id: string, file: File) => {
    setUploadingId(id);
    try {
      // richmenu-assets：public bucket（網址永久有效，LINE 抓得到）且已在
      // /api/upload 的 LINE_BOUND_BUCKETS 內＝只收 JPEG/PNG，正是 Flex 主圖的限制。
      const url = await uploadImage(file, 'richmenu-assets');
      setCards((cs) => cs.map((x) => (x.id === id ? { ...x, imageUrl: url } : x)));
      toast.show(t.flex.imageUploaded);
    } catch (e) {
      toast.show(
        `${t.flex.uploadFailedPrefix}${e instanceof ApiError ? e.message : ''}`,
        'danger',
      );
    } finally {
      setUploadingId(null);
    }
  };

  /**
   * 發布＝真的把卡片與開關寫進 tenant_settings.line。
   * 送出前先擋空標題：標題同時是卡片按鈕上的字，空字串會被端點的 zod 退回，
   * 在這裡先講清楚哪裡沒填，比讓店家看一句 400 的原文有用。
   */
  const publish = async () => {
    if (cards.some((c) => !c.title.trim())) {
      toast.show(t.flex.titleRequired, 'warning');
      return;
    }
    /*
     * 連結網址的可用 scheme 走 `isAllowedFlexLinkUrl()`——與端點 zod、webhook
     * 讀取路徑**同一支函式**（唯一出處 src/config/tenant-settings.ts）。
     * 這裡先擋一次是為了讓店家看到中文的哪裡錯，而不是一句 400 的原文
     * ——與上面擋空標題同一個理由；**不是**另寫一份判斷。
     */
    if (cards.some((c) => c.linkUrl.trim() !== '' && !isAllowedFlexLinkUrl(c.linkUrl))) {
      toast.show(t.flex.linkUrlScheme, 'warning');
      return;
    }
    setSaving(true);
    try {
      await saveFlexMenu({
        flexMenuEnabled: enabled,
        flexMenuFallback: fallback,
        flexCards: toPayload(cards),
      });
      toast.show(t.flex.saved, 'success');
    } catch (e) {
      toast.show(
        `${t.flex.saveFailedPrefix}${e instanceof ApiError ? e.message : ''}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  /** 清除已發布：把 flexCards 存成空陣列（webhook 因此落回文字關鍵字清單） */
  const clearPublished = async () => {
    setConfirm(null);
    setSaving(true);
    try {
      await saveFlexMenu({ flexCards: [] });
      setCards([]);
      setPage(0);
      toast.show(t.flex.resetToDefault);
    } catch (e) {
      toast.show(
        `${t.flex.saveFailedPrefix}${e instanceof ApiError ? e.message : ''}`,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingCard />;

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
              onCheckedChange={setEnabled}
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
                      onChange={() => setFallback(k)}
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
                          <label className="mt-1 inline-flex cursor-pointer items-center gap-1 text-sm text-secondary">
                            <input
                              type="file"
                              accept="image/jpeg,image/png"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = '';
                                if (file) void onPickImage(c.id, file);
                              }}
                            />
                            <Upload size={12} />
                            {uploadingId === c.id ? common.loading : t.flex.uploadImage}
                          </label>
                          {c.imageUrl && (
                            <span className="ml-2 text-sm text-success">{t.flex.imageUploaded}</span>
                          )}
                          {/*
                            連結網址（14 分冊 §8.20）。所有卡片都給，不只廣告卡——
                            契約把 linkUrl 定在卡片層級，只讓廣告卡填會造出一個
                            「存得下但畫面設不了」的隱形欄位。
                          */}
                          <Input
                            className="form-control-sm mt-1"
                            type="url"
                            inputMode="url"
                            value={c.linkUrl}
                            placeholder={t.flex.linkUrlPlaceholder}
                            aria-label={t.flex.linkUrl}
                            onChange={(e) => setCards((cs) => cs.map((x) => x.id === c.id ? { ...x, linkUrl: e.target.value } : x))}
                          />
                          {c.linkUrl.trim() !== '' && (
                            <span className="form-text">
                              {isAllowedFlexLinkUrl(c.linkUrl)
                                ? t.flex.linkUrlSet
                                : t.flex.linkUrlScheme}
                            </span>
                          )}
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
              <FormText>{t.flex.imageTypeHint}</FormText>
              <FormText>{t.flex.linkUrlHint}</FormText>
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
                    {current.imageUrl
                      ? <img src={current.imageUrl} alt="" className="h-full w-full object-cover" />
                      : <ImageIcon size={28} />}
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
            <Button block disabled={saving} onClick={() => void publish()}>
              <Send size={15} />{t.flex.publish}
            </Button>
            <Button block variant="outline" disabled={saving} onClick={() => setConfirm('reset')}>
              <RotateCcw size={14} />{t.flex.reset}
            </Button>
            <Button block variant="outlineDanger" disabled={saving} onClick={() => setConfirm('delete')}>
              <Trash2 size={14} />{t.flex.deletePublished}
            </Button>
            {/*
              * 「顧客實際會收到什麼」——`POST …/rich-menu/preview-scene-flex`。
              *
              * 它回的是**同一支** `buildFlexMenuOutcome()` 組出來的那一包，不是另外
              * 為預覽組一份 JSON（issue #6 的單一事實來源要求）。所以
              * `flexShowTip` 開著時這裡會顯示「2 則」——店家在這裡看到幾則，
              * 顧客就會收到幾則。左邊的卡片預覽看不出「會不會多送一則提示」。
              *
              * ⚠️ 一行都不碰 LINE，也不會發布。
              */}
            <Button
              block variant="outline"
              loading={flexPreviewLoading}
              onClick={() => void previewCustomerMessages()}
            >
              <Eye size={14} />{t.flex.previewCustomerBtn}
            </Button>
          </CardBody>
        </Card>
      </div>

      <ConfirmModal
        open={confirm === 'reset'}
        title={t.flex.reset}
        message={t.flex.resetConfirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null);
          setCards(DEFAULT_FLEX_CARDS.map((c) => ({ ...c, id: newId() })));
          setPage(0);
          toast.show(t.flex.resetDone);
        }}
      />
      <ConfirmModal
        open={confirm === 'delete'}
        danger
        title={t.flex.deletePublished}
        message={t.flex.deletePublishedConfirm}
        confirmText={common.delete}
        onClose={() => setConfirm(null)}
        onConfirm={() => void clearPublished()}
      />
      <ConfirmModal
        open={confirm === 'deleteCard'}
        danger
        title={common.delete}
        message={`${t.flex.deleteCardLead}${target?.title ?? ''}${t.flex.deleteCardTail}`}
        confirmText={common.delete}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setCards((c) => c.filter((x) => x.id !== target?.id));
          setPage(0);
          setConfirm(null);
        }}
      />
    </div>
  );
}
