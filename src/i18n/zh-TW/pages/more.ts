/**
 * GUIDE 手機五大父層級之「更多」頁（/tenant/more）文案。
 *
 * 對應 `docs/integration/20-GUIDE-RESPONSIVE-UI.md` §7：低頻功能的分組目錄，
 * 不是垃圾桶。本頁只把既有 `src/config/nav.ts` 葉節點依 `GUIDE_MORE_GROUPS`
 * 重新分組顯示，不建立第二套路由或資料模型（Issue #66「明確禁止」章節）。
 */
export const morePage = {
  title: '更多',
  metaTitle: '更多 - 店家後台',
  subtitle: '低頻設定、方案、收款、團隊、行銷與擴充功能都在這裡，依使用頻率分組。',

  groups: {
    operations: '行程與營運',
    payments: '收款',
    customerGrowth: '旅客經營',
    lineAutomation: 'LINE 與自動化',
    marketing: '曝光與行銷',
    platform: '平台與帳號',
  },

  empty: {
    title: '目前沒有可顯示的功能',
    description: '此業態模式下「更多」沒有額外的低頻功能項目。',
  },
} as const;
