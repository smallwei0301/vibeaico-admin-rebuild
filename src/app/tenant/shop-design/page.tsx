'use client';
import * as React from 'react';
import {
  Eye, Film, Image as ImageIcon, Images, Info, Lightbulb, Link2, Palette, Plus,
  Save, Share2, Trash2, Upload, UserCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Tabs, TabPanel, type TabItem } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmModal } from '@/components/ui/Modal';
import {
  CharCounter, FormGroup, FormText, Input, Label, SwitchField, Textarea,
} from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { getTenantSettings, saveTenantSettings } from '@/services/settings';
import { buildPublicBookingUrl } from '@/config/tenant-settings';
import type { TenantSettings } from '@/config/tenant-settings';
import { APP_URL } from '@/config/env';
import { byMode } from '@/mock';
import type { BusinessType } from '@/config/modes';
import { common } from '@/i18n/zh-TW/common';
import { nav } from '@/i18n/zh-TW/nav';
import { shopDesignPage as t } from '@/i18n/zh-TW/pages/shop-design';

/* -------------------------------------------------------------------------- */
/* 本頁專用常數與假資料（不寫進 src/mock，避免與其他頁面衝突）                    */
/* -------------------------------------------------------------------------- */

/**
 * 主題色候選。
 * ⚠️ 這些 hex 不是「設計 token」而是**資料值** —— 店家挑一個存進 tenant_settings
 *    的 branding.themeColor，用來渲染「公開預約頁」（不是本後台）的品牌色，
 *    因此不走 Tailwind token，比照 line-settings 的 THEME_PRESETS 處理。
 */
const THEME_COLOR_PRESETS = [
  '#6366f1', '#4361ee', '#0ea5e9', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6',
] as const;

/** 原站 themeColorPicker 的 value 預設值 */
const DEFAULT_THEME_COLOR = THEME_COLOR_PRESETS[0];

/** 原站 /api/settings/shop-page 回傳的公開頁設定；骨架階段以 module 常數提供 */
type GalleryImage = { id: string; url: string; caption: string };

type ShopPageConfig = {
  shopName: string;
  logoUrl: string;
  logoHidden: boolean;
  bannerUrl: string;
  bannerVideoUrl: string;
  bannerVideoSound: boolean;
  announcement: string;
  aboutTitle: string;
  aboutContent: string;
  aboutImageUrl: string;
  gallery: GalleryImage[];
  themeColor: string;
  facebook: string;
  instagram: string;
  line: string;
  threads: string;
  googleMaps: string;
  contactEmail: string;
};

const BLANK_SHOP_PAGE: ShopPageConfig = {
  shopName: '', logoUrl: '', logoHidden: false, bannerUrl: '', bannerVideoUrl: '',
  bannerVideoSound: true, announcement: '', aboutTitle: '', aboutContent: '',
  aboutImageUrl: '', gallery: [], themeColor: DEFAULT_THEME_COLOR,
  facebook: '', instagram: '', line: '', threads: '', googleMaps: '', contactEmail: '',
};

/** 三種業態的公開頁示範內容（見 docs/integration/13-BUSINESS-MODES.md） */
const SHOP_PAGE_BY_MODE: Record<BusinessType, ShopPageConfig> = {
  LOCAL_SHOP: {
    ...BLANK_SHOP_PAGE,
    shopName: '示範美髮沙龍',
    announcement: '8/25–8/28 公休，造型預約請提前於 LINE 預訂，感謝支持！',
    aboutTitle: '關於我們',
    aboutContent:
      '成立於 2018 年的小型沙龍，每位設計師一次只服務一位客人，'
      + '從頭皮檢測到造型建議都慢慢聊。使用低敏染劑與植萃護理，敏感頭皮也能安心。',
    gallery: [
      { id: 'g_1', url: '', caption: '一樓洗髮區' },
      { id: 'g_2', url: '', caption: '設計師工作台' },
      { id: 'g_3', url: '', caption: '護理專區' },
    ],
    instagram: 'https://instagram.com/demo_salon',
    line: 'https://line.me/R/ti/p/@demo1234',
    googleMaps: 'https://maps.example.com/demo-salon',
    contactEmail: 'hello@demo-salon.example.com',
  },
  GUIDE: {
    ...BLANK_SHOP_PAGE,
    shopName: '祕島嚮導工作室',
    announcement: '9 月賞鯨團次已開放報名，颱風季請留意出團前一日的最終確認通知。',
    aboutTitle: '關於祕島',
    aboutContent:
      '我們是一群在宜蘭、花蓮長大的在地嚮導，帶你走進觀光路線之外的祕境。'
      + '所有海域行程由持證船長領航，山域行程每 6 人配置 1 名教練，'
      + '全程投保高山嚮導責任險。人數不多，走得慢一點，看得多一點。',
    gallery: [
      { id: 'g_1', url: '', caption: '龜山島牛奶海' },
      { id: 'g_2', url: '', caption: '飛旋海豚出沒' },
      { id: 'g_3', url: '', caption: '砂婆礑溪谷' },
      { id: 'g_4', url: '', caption: '九份夜色' },
    ],
    themeColor: THEME_COLOR_PRESETS[1] ?? DEFAULT_THEME_COLOR,
    instagram: 'https://instagram.com/midao_guide',
    line: 'https://line.me/R/ti/p/@midao888',
    googleMaps: 'https://maps.example.com/wushi-harbor',
    contactEmail: 'hi@midao.example.com',
  },
  CLINIC: {
    ...BLANK_SHOP_PAGE,
    shopName: '示範診所',
    announcement:
      '流感疫苗開打中，公費對象請攜帶健保卡。中秋連假 9/25–9/27 休診，急診請至鄰近醫院。',
    aboutTitle: '門診資訊',
    aboutContent:
      '家庭醫學科、內科一般門診，附設健檢中心。'
      + '看診時間：週一至週五 09:00–12:00、14:00–17:30、18:30–21:00；週六上午診。'
      + '線上預約可查看即時看診號碼，減少現場等候。',
    gallery: [
      { id: 'g_1', url: '', caption: '候診區' },
      { id: 'g_2', url: '', caption: '健檢中心' },
    ],
    line: 'https://line.me/R/ti/p/@democlinic',
    googleMaps: 'https://maps.example.com/demo-clinic',
    contactEmail: 'service@demo-clinic.example.com',
  },
};

/** 偵測到已連接 LINE Bot 時，「點此自動填入連結」要填的網址前綴 */
const LINE_ADD_FRIEND_PREFIX = 'https://line.me/R/ti/p/';

type TabKey = 'profile' | 'banner' | 'about' | 'gallery' | 'theme' | 'social';

const TAB_ITEMS: TabItem[] = [
  { key: 'profile', label: t.tabs.profile, icon: UserCircle },
  { key: 'banner', label: t.tabs.banner, icon: ImageIcon },
  { key: 'about', label: t.tabs.about, icon: Info },
  { key: 'gallery', label: t.tabs.gallery, icon: Images },
  { key: 'theme', label: t.tabs.theme, icon: Palette },
  { key: 'social', label: t.tabs.social, icon: Share2 },
];

/* -------------------------------------------------------------------------- */

export default function ShopDesignPage() {
  const toast = useToast();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [tab, setTab] = React.useState<TabKey>('profile');
  const [settings, setSettings] = React.useState<TenantSettings | null>(null);
  const [config, setConfig] = React.useState<ShopPageConfig>(byMode(SHOP_PAGE_BY_MODE));
  const [deleteTarget, setDeleteTarget] = React.useState<GalleryImage | null>(null);

  /** 新增圖片的本地 id 產生器：render 期不可用 Date.now()／Math.random() */
  const nextImageId = React.useRef(1);

  React.useEffect(() => {
    void (async () => {
      try {
        const s = await getTenantSettings();
        setSettings(s);
        setConfig((c) => ({ ...c, shopName: c.shopName || s.basic.tenantName }));
      } catch {
        toast.show(t.messages.loadFailed, 'danger');
      } finally {
        setLoading(false);
      }
    })();
  }, [toast]);

  const patch = (p: Partial<ShopPageConfig>) => setConfig((c) => ({ ...c, ...p }));

  const publicUrl = settings
    ? buildPublicBookingUrl(APP_URL, settings.basic.shopCode)
    : '';
  const lineBasicId = settings?.line.lineBasicId ?? '';

  const save = async () => {
    setSaving(true);
    try {
      /* 骨架階段沿用 saveTenantSettings：真實後端為 /api/settings/shop-page */
      await saveTenantSettings({});
      toast.show(t.messages.saved);
    } catch (e) {
      toast.show(
        e instanceof Error ? e.message : t.messages.saveFailed,
        'danger',
      );
    } finally {
      setSaving(false);
    }
  };

  const addImage = () => {
    if (config.gallery.length >= t.gallery.max) {
      toast.show(t.messages.galleryMax, 'warning');
      return;
    }
    const id = `img_${nextImageId.current++}`;
    patch({ gallery: [...config.gallery, { id, url: '', caption: '' }] });
    toast.show(t.messages.imageAdded);
  };

  const removeImage = () => {
    if (!deleteTarget) return;
    patch({ gallery: config.gallery.filter((g) => g.id !== deleteTarget.id) });
    setDeleteTarget(null);
    toast.show(t.messages.imageDeleted);
  };

  const fillLineLink = () => {
    if (!lineBasicId) {
      toast.show(t.messages.lineLinkMissing, 'warning');
      return;
    }
    patch({ line: `${LINE_ADD_FRIEND_PREFIX}${lineBasicId}` });
    toast.show(t.messages.lineLinkFilled);
  };

  /* -------------------------------------------------------------- render */

  if (loading) {
    return (
      <>
        <PageHeader eyebrow={nav.navPublicPage} title={t.title} subtitle={t.subtitle} />
        <Card>
          <CardBody className="py-10 text-center text-muted">{common.loading}</CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={nav.navPublicPage}
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <a
              className="btn btn-outline btn-sm"
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Eye size={14} />
              {t.actions.preview}
            </a>
            <Button size="sm" loading={saving} loadingText={common.saving} onClick={() => void save()}>
              <Save size={14} />
              {t.actions.save}
            </Button>
          </>
        }
      />

      <Tabs
        items={TAB_ITEMS}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
        className="mb-4"
      />

      {/* ======================================================= 店家資訊 */}
      <TabPanel active={tab === 'profile'}>
        <Card>
          <CardHeader>
            <CardTitle>
              <UserCircle size={16} />
              {t.profile.cardTitle}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <FormText className="mb-4 mt-0">{t.profile.cardDesc}</FormText>

            <FormGroup>
              <Label htmlFor="shopNameInput">{t.profile.shopName}</Label>
              <Input
                id="shopNameInput"
                placeholder={t.profile.shopNamePlaceholder}
                value={config.shopName}
                onChange={(e) => patch({ shopName: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label>{t.profile.logo}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm">
                  <Upload size={13} />
                  {t.profile.logoUpload}
                </Button>
                {config.logoUrl ? (
                  <Button
                    variant="outlineDanger"
                    size="sm"
                    aria-label={t.profile.logoRemove}
                    title={t.profile.logoRemove}
                    onClick={() => patch({ logoUrl: '' })}
                  >
                    <Trash2 size={13} />
                  </Button>
                ) : null}
              </div>
              <FormText>{t.profile.logoHelp}</FormText>
            </FormGroup>

            <SwitchField
              label={t.profile.logoHidden}
              checked={config.logoHidden}
              onCheckedChange={(v) => patch({ logoHidden: v })}
            />
          </CardBody>
        </Card>
      </TabPanel>

      {/* ======================================================= 橫幅封面 */}
      <TabPanel active={tab === 'banner'}>
        <Card>
          <CardHeader>
            <CardTitle>
              <ImageIcon size={16} />
              {t.banner.cardTitle}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <FormText className="mb-3 mt-0">{t.banner.cardDesc}</FormText>

            <button
              type="button"
              className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-25 py-10 text-base text-secondary hover:border-primary hover:text-primary"
            >
              <Upload size={20} />
              {t.banner.uploadPrompt}
            </button>
            <FormText>{t.banner.help}</FormText>
            {config.bannerUrl ? (
              <Button
                variant="outlineDanger"
                size="sm"
                className="mt-2"
                onClick={() => patch({ bannerUrl: '' })}
              >
                <Trash2 size={13} />
                {t.banner.remove}
              </Button>
            ) : null}

            {/* ------------------------------------------------ 橫幅影片 */}
            <div className="divider my-5" />
            <h3 className="mb-2 flex items-center gap-2 text-md font-bold">
              <Film size={15} />
              {t.banner.videoTitle}
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm">
                <Upload size={13} />
                {t.banner.videoUpload}
              </Button>
              {config.bannerVideoUrl ? (
                <Button
                  variant="outlineDanger"
                  size="sm"
                  onClick={() => patch({ bannerVideoUrl: '' })}
                >
                  <Trash2 size={13} />
                  {t.banner.videoRemove}
                </Button>
              ) : null}
            </div>
            <FormText>
              {t.banner.videoHelpLead}
              <strong>{t.banner.videoHelpStrong1}</strong>
              {t.banner.videoHelpMiddle}
              <strong>{t.banner.videoHelpStrong2}</strong>
              {t.banner.videoHelpTail}
            </FormText>

            <div className="mt-3">
              <SwitchField
                label={t.banner.videoSound}
                checked={config.bannerVideoSound}
                onCheckedChange={(v) => patch({ bannerVideoSound: v })}
              />
            </div>
            <Alert tone="warning" className="mt-3 text-xs">{t.banner.videoSoundNote}</Alert>

            {/* ------------------------------------------------ 公告文字 */}
            <div className="divider my-5" />
            <h3 className="mb-2 flex items-center gap-2 text-md font-bold">
              <Lightbulb size={15} />
              {t.banner.announcementTitle}
            </h3>
            <Input
              id="announcementInput"
              placeholder={t.banner.announcementPlaceholder}
              value={config.announcement}
              onChange={(e) => patch({ announcement: e.target.value })}
            />
            <FormText>{t.banner.announcementHelp}</FormText>
          </CardBody>
        </Card>
      </TabPanel>

      {/* ======================================================= 關於我們 */}
      <TabPanel active={tab === 'about'}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Info size={16} />
              {t.about.cardTitle}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <FormText className="mb-4 mt-0">{t.about.cardDesc}</FormText>

            <FormGroup>
              <Label htmlFor="aboutTitleInput">{t.about.titleLabel}</Label>
              <Input
                id="aboutTitleInput"
                placeholder={t.about.titlePlaceholder}
                value={config.aboutTitle}
                onChange={(e) => patch({ aboutTitle: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="aboutContentInput">{t.about.contentLabel}</Label>
              <Textarea
                id="aboutContentInput"
                rows={6}
                maxLength={t.about.contentMax}
                placeholder={t.about.contentPlaceholder}
                value={config.aboutContent}
                onChange={(e) => patch({ aboutContent: e.target.value })}
              />
              <CharCounter value={config.aboutContent} max={t.about.contentMax} />
            </FormGroup>

            <FormGroup className="mb-0">
              <Label>{t.about.imageLabel}</Label>
              <button
                type="button"
                className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-25 py-8 text-base text-secondary hover:border-primary hover:text-primary"
              >
                <Upload size={18} />
                {t.about.imageUploadPrompt}
              </button>
              <FormText>{t.about.imageHelp}</FormText>
              {config.aboutImageUrl ? (
                <Button
                  variant="outlineDanger"
                  size="sm"
                  className="mt-2"
                  onClick={() => patch({ aboutImageUrl: '' })}
                >
                  <Trash2 size={13} />
                  {t.about.imageRemove}
                </Button>
              ) : null}
            </FormGroup>
          </CardBody>
        </Card>
      </TabPanel>

      {/* ======================================================= 圖片展示 */}
      <TabPanel active={tab === 'gallery'}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Images size={16} />
              {t.gallery.cardTitle}
              <Badge tone="neutral">
                {t.gallery.counter(config.gallery.length, t.gallery.max)}
              </Badge>
            </CardTitle>
            <Button size="sm" onClick={addImage}>
              <Plus size={14} />
              {t.gallery.add}
            </Button>
          </CardHeader>
          <CardBody>
            <FormText className="mb-4 mt-0">{t.gallery.cardDesc}</FormText>

            {config.gallery.length === 0 ? (
              <EmptyState
                icon={Images}
                title={t.gallery.emptyTitle}
                description={t.gallery.emptyDescription}
                action={
                  <Button size="sm" onClick={addImage}>
                    <Plus size={14} />
                    {t.gallery.add}
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {config.gallery.map((img) => (
                  <div key={img.id} className="rounded-md border border-neutral-200 p-2">
                    <div className="flex h-24 items-center justify-center rounded-sm bg-neutral-100 text-secondary">
                      <ImageIcon size={22} />
                    </div>
                    <Input
                      className="form-control-sm mt-2"
                      placeholder={t.gallery.caption}
                      value={img.caption}
                      onChange={(e) =>
                        patch({
                          gallery: config.gallery.map((g) =>
                            g.id === img.id ? { ...g, caption: e.target.value } : g,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="outlineDanger"
                      size="sm"
                      className="mt-2 w-full"
                      onClick={() => setDeleteTarget(img)}
                    >
                      <Trash2 size={13} />
                      {t.gallery.delete}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </TabPanel>

      {/* ======================================================= 主題外觀 */}
      <TabPanel active={tab === 'theme'}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Palette size={16} />
              {t.theme.cardTitle}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => patch({ themeColor: DEFAULT_THEME_COLOR })}
            >
              {t.theme.reset}
            </Button>
          </CardHeader>
          <CardBody>
            <FormText className="mb-4 mt-0">{t.theme.cardDesc}</FormText>

            <FormGroup>
              <Label htmlFor="themeColorHex">{t.theme.colorLabel}</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label={t.theme.colorLabel}
                  className="h-9 w-12 cursor-pointer rounded-sm border border-neutral-250 bg-neutral-0 p-1"
                  value={config.themeColor}
                  onChange={(e) => patch({ themeColor: e.target.value })}
                />
                <Input
                  id="themeColorHex"
                  className="max-w-[10rem] font-mono"
                  placeholder={DEFAULT_THEME_COLOR}
                  value={config.themeColor}
                  onChange={(e) => patch({ themeColor: e.target.value })}
                />
              </div>
            </FormGroup>

            <div>
              <FormText className="mb-2 mt-0">{t.theme.defaultPalette}</FormText>
              <div className="flex flex-wrap gap-2">
                {THEME_COLOR_PRESETS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={hex}
                    title={hex}
                    data-active={config.themeColor.toLowerCase() === hex}
                    className="h-8 w-8 rounded-pill border-2 border-neutral-0 shadow-sm data-[active=true]:ring-2 data-[active=true]:ring-primary"
                    style={{ backgroundColor: hex }}
                    onClick={() => patch({ themeColor: hex })}
                  />
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </TabPanel>

      {/* ======================================================= 社群連結 */}
      <TabPanel active={tab === 'social'}>
        <Card>
          <CardHeader>
            <CardTitle>
              <Share2 size={16} />
              {t.social.cardTitle}
            </CardTitle>
          </CardHeader>
          <CardBody>
            <FormText className="mb-4 mt-0">{t.social.cardDesc}</FormText>

            <FormGroup>
              <Label htmlFor="facebookInput">{t.social.facebook}</Label>
              <Input
                id="facebookInput" type="url"
                placeholder={t.social.facebookPlaceholder}
                value={config.facebook}
                onChange={(e) => patch({ facebook: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="instagramInput">{t.social.instagram}</Label>
              <Input
                id="instagramInput" type="url"
                placeholder={t.social.instagramPlaceholder}
                value={config.instagram}
                onChange={(e) => patch({ instagram: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="lineInput">{t.social.line}</Label>
              <Input
                id="lineInput" type="url"
                placeholder={t.social.linePlaceholder}
                value={config.line}
                onChange={(e) => patch({ line: e.target.value })}
              />
              {lineBasicId ? (
                <FormText>
                  {t.social.lineDetectedLead}
                  <button type="button" className="text-primary underline" onClick={fillLineLink}>
                    <Link2 size={12} className="inline" />
                    {t.social.lineDetectedLink}
                  </button>
                  {t.social.lineDetectedTail}
                </FormText>
              ) : null}
            </FormGroup>

            <FormGroup>
              <Label htmlFor="threadsInput">{t.social.threads}</Label>
              <Input
                id="threadsInput" type="url"
                placeholder={t.social.threadsPlaceholder}
                value={config.threads}
                onChange={(e) => patch({ threads: e.target.value })}
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="googleMapsInput">{t.social.googleMaps}</Label>
              <Input
                id="googleMapsInput" type="url"
                placeholder={t.social.googleMapsPlaceholder}
                value={config.googleMaps}
                onChange={(e) => patch({ googleMaps: e.target.value })}
              />
            </FormGroup>

            <FormGroup className="mb-0">
              <Label htmlFor="contactEmailInput">{t.social.email}</Label>
              <Input
                id="contactEmailInput" type="email"
                placeholder={t.social.emailPlaceholder}
                value={config.contactEmail}
                onChange={(e) => patch({ contactEmail: e.target.value })}
              />
            </FormGroup>
          </CardBody>
        </Card>
      </TabPanel>

      <div className="mt-4 flex justify-end">
        <Button loading={saving} loadingText={common.saving} onClick={() => void save()}>
          <Save size={15} />
          {t.actions.save}
        </Button>
      </div>

      <ConfirmModal
        open={!!deleteTarget}
        title={t.confirm.deleteImageTitle}
        message={t.confirm.deleteImage}
        danger
        confirmText={common.delete}
        onClose={() => setDeleteTarget(null)}
        onConfirm={removeImage}
      />
    </>
  );
}
