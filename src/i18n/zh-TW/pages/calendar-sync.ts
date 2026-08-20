/**
 * 行事曆同步（/tenant/calendar-sync）文案
 * 說明區塊逐字取自原站 DOM；toast／確認訊息取自 inline JS。
 */
export const calendarSyncPage = {
  title: '行事曆同步',
  metaTitle: '行事曆同步 - 店家後台',

  /** 訂閱網址卡 */
  subscribe: {
    urlLabel: '訂閱網址（ICS）',
    google: '加入 Google Calendar',
    copy: '複製訂閱網址',
    regenerate: '重新產生網址',
    lastSync: '最後同步',
    neverSynced: '尚未同步',
    regenerateConfirm:
      '確定重新產生？\n\n舊網址會立即失效，已在 Google Calendar 訂閱的日曆會停止更新（需重新加入）。',
    regenerated: '已產生新網址，請重新加入 Google Calendar',
    regenerateFailed: '重新產生失敗',
    copied: '已複製訂閱網址',
  },

  /** 教學卡：如何加入 Google Calendar */
  howTo: {
    title: '如何加入 Google Calendar',
    steps: [
      '電腦開啟 calendar.google.com （手機 App 無法直接訂閱）',
      '左側「其他日曆」旁邊的 + 按鈕 → 選「 以網址加入 」',
      '貼上訂閱網址 → 點「 加入日曆 」',
      '完成！手機 Google Calendar App 會自動跟著顯示',
    ],
    frequencyTitle: '同步頻率',
    frequencyBody:
      'Google / Apple Calendar 約每 5 分鐘 ~ 幾小時 同步一次（不是即時）。即時資料請看 VibeAI 後台。',
    staffTitle: '員工個人行事曆',
    staffBody: '每位員工的「員工專屬連結」頁面底部也有同步按鈕，他們可以同步自己的預約。',
  },

  /** 匯入外部行事曆卡 */
  external: {
    title: '匯入外部行事曆',
    description:
      '貼上 Google 日曆的「密鑰 iCal 網址」等外部 ICS，事件會以 唯讀灰色 顯示在 後台行事曆 上供核對名單（約每 15 分鐘更新，不可在此編輯外部事件）。',
    name: '名稱',
    namePlaceholder: '例如：Booking.com 名單',
    url: 'ICS 網址（https）',
    urlPlaceholder: 'https://calendar.google.com/calendar/ical/.../basic.ics',
    color: '顏色',
    defaultColor: '#9aa0a6',
    add: '新增',
    enable: '啟用',
    disable: '停用',
    empty: '尚未匯入任何外部行事曆。',
    eventCount: (n: number) => `✓ ${n} 筆`,
    syncError: '⚠ 同步異常',
    neverSynced: '尚未同步',
    nameRequired: '請填名稱',
    urlRequired: '請填 ICS 網址',
    added: '已新增，行事曆稍後會顯示外部事件',
    deleted: '已刪除',
    deleteConfirm: (name: string) =>
      `確定刪除「${name}」？\n後台行事曆將不再顯示這個來源的事件。`,
  },

  /** 教學卡：怎麼拿 Google 的 ICS 網址 */
  icsHowTo: {
    title: '怎麼拿 Google 的 ICS 網址',
    steps: [
      '電腦開 Google 日曆 → 該日曆「設定」',
      '下滑到「 整合日曆 」',
      '複製「 密鑰 iCal 格式網址 」（含 .ics）',
      '貼到左邊「ICS 網址」→ 新增',
    ],
    warning: '密鑰網址等同憑證，本系統 加密儲存 ，請勿外流。',
  },

  messages: {
    copied: '已複製',
    loadFailed: '載入失敗',
    loadFailedPrefix: '載入失敗：',
    unknownError: '未知錯誤',
    networkError: '連線錯誤，請稍後再試',
  },
} as const;
