export const GUIDE_UI_TOKENS = Object.freeze({
  typography: {
    pageTitlePx: 30,
    sectionTitlePx: 22,
    cardTextPx: 18,
    bodyPx: 16,
    secondaryPx: 14,
  },
  spacing: {
    mobilePagePaddingPx: 16,
    mobilePagePaddingWidePx: 20,
    cardPaddingPx: 16,
    cardPaddingWidePx: 20,
    rowGapPx: 10,
    sectionGapPx: 20,
  },
  radius: {
    cardPx: 18,
    pillPx: 999,
  },
  touch: {
    minTargetPx: 44,
    bottomNavMinPx: 64,
    bottomNavMaxPx: 72,
  },
  color: {
    forest: '#173F35',
    forestStrong: '#103229',
    sage: '#8DAA9D',
    sageSoft: '#E8F0EC',
    warmWhite: '#FAF8F3',
    surface: '#FFFFFF',
    text: '#1D2A26',
    muted: '#63726C',
    attention: '#C46A2D',
    attentionSoft: '#FFF0E4',
    destructive: '#B42318',
    destructiveSoft: '#FEE4E2',
    positive: '#237A57',
    positiveSoft: '#E5F5ED',
    border: '#DCE5E0',
  },
} as const);

export const GUIDE_UI_CLASSES = Object.freeze({
  page: 'mx-auto w-full max-w-3xl px-4 pb-24 pt-5 sm:px-5',
  pageTitle: 'text-[30px] leading-tight font-bold tracking-tight text-[#173F35]',
  sectionTitle: 'text-[22px] leading-tight font-bold tracking-tight text-[#173F35]',
  cardText: 'text-[18px] leading-normal font-semibold text-[#1D2A26]',
  body: 'text-[16px] leading-normal text-[#1D2A26]',
  bodyMuted: 'text-[16px] leading-normal text-[#63726C]',
  secondary: 'text-[14px] leading-normal text-[#63726C]',
  card: 'rounded-[18px] border border-[#DCE5E0] bg-white shadow-sm',
  cardPadding: 'p-4 sm:p-5',
  interactiveCard:
    'rounded-[18px] border border-[#DCE5E0] bg-white p-4 text-left transition-[border-color,box-shadow,transform] duration-150 hover:border-[#8DAA9D] hover:shadow-sm active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 sm:p-5',
  quietSurface: 'rounded-[18px] border border-[#DCE5E0] bg-[#FAF8F3] p-4 sm:p-5',
  avatarSurface: 'bg-[#E8F0EC] text-[#173F35]',
  focusAttentionSurface: 'bg-[#FFF0E4] text-[#9B4F1F]',
  focusDangerSurface: 'bg-[#FEE4E2] text-[#B42318]',
  subtleSurface: 'bg-[#FAF8F3]',
  divider: 'divide-[#DCE5E0] border-[#DCE5E0]',
  settingsLink: 'text-[#1D2A26] transition-colors hover:bg-[#FAF8F3]',
  mutedIcon: 'text-[#63726C]',
  navShell: 'border-[#DCE5E0] bg-white/95',
  navActive: 'bg-[#E8F0EC] text-[#173F35]',
  navInactive: 'text-[#63726C]',
  calendarDayActive: 'bg-[#173F35] text-white',
  calendarDayIdle: 'bg-[#F3F6F4] text-[#1D2A26]',
  touchTarget: 'min-h-[44px] min-w-[44px]',
  sectionGap: 'space-y-5',
  rowGap: 'gap-2.5',
} as const);

export type GuideStatusTone = 'neutral' | 'positive' | 'attention' | 'danger' | 'info';

export const GUIDE_STATUS_CLASSES: Readonly<Record<GuideStatusTone, string>> = Object.freeze({
  neutral: 'border-[#DCE5E0] bg-[#F3F6F4] text-[#52615B]',
  positive: 'border-[#CDE8DA] bg-[#E5F5ED] text-[#237A57]',
  attention: 'border-[#F7D8BF] bg-[#FFF0E4] text-[#9B4F1F]',
  danger: 'border-[#F5C7C2] bg-[#FEE4E2] text-[#B42318]',
  info: 'border-[#CFE1D8] bg-[#E8F0EC] text-[#173F35]',
});
