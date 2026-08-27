/**
 * 行事曆同步（/tenant/calendar-sync）文案
 * 說明區塊逐字取自原站 DOM；toast／確認訊息取自 inline JS。
 */
export const calendarSyncPage = {
  title: '行事曆同步',
  metaTitle: '行事曆同步 - 店家後台',

  /* ---------------------------------------- 尚未建置：誠實告示（不可省略） */
  /**
   * ⚠️ 這一區塊是「誠實化」文案，對應 CLAUDE.md「Never fabricate a known」。
   * 本頁兩個功能的後端都不存在：
   *   1. ICS 訂閱：`/ics/{shopCode}/{token}.ics` 這條路由在 src/app 底下不存在，
   *      也沒有 `/api/settings/calendar`，因此畫面上那串「訂閱網址」誰去訂都拿不到資料。
   *      舊實作更嚴重：「重新產生網址」只是從一個硬編碼陣列輪替下一個假 token，
   *      店家會以為舊的訂閱連結已經被撤銷（假的安全操作），實際上什麼都沒有失效。
   *   2. 外部行事曆匯入：沒有任何端點，新增／停用／刪除只改瀏覽器內的 React state。
   */
  notBuilt: {
    title: '行事曆同步後端尚未建置，本頁的訂閱網址與外部行事曆都不會生效',
    body:
      'ICS 訂閱端點（/ics/…）尚未建置，因此系統目前無法產生可用的訂閱網址，Google Calendar 也訂閱不到任何預約。下方「匯入外部行事曆」清單為示範資料，不是你實際匯入的來源。',
    securityBody:
      '「重新產生網址」已停用：在訂閱端點建置完成前，系統無從撤銷或換發任何網址，若保留該按鈕會讓你誤以為舊連結已失效（實際上沒有）。',
    urlUnavailable: '尚未開通',
    disabledHint: 'ICS 訂閱端點尚未建置，目前沒有可用的訂閱網址',
    externalBody:
      '外部行事曆匯入後端尚未建置：在這裡新增、停用或刪除的來源都只存在於這個瀏覽器分頁，重新整理就會回到示範資料，後台行事曆也不會顯示這些外部事件。',
    externalAdded:
      '未新增外部行事曆：匯入後端尚未建置，這個來源沒有寫入資料庫，後台行事曆不會顯示它的事件。',
    externalDeleted:
      '未刪除外部行事曆：匯入後端尚未建置，這筆資料沒有從資料庫移除，重新整理後仍會回到原本的清單。',
    externalToggled:
      '未變更啟用狀態：匯入後端尚未建置，這個切換沒有寫入資料庫，重新整理後就會還原。',
  },

  /** 訂閱網址卡 */
  subscribe: {
    urlLabel: '訂閱網址（ICS）',
    google: '加入 Google Calendar',
    copy: '複製訂閱網址',
    regenerate: '重新產生網址',
    lastSync: '最後同步',
    neverSynced: '尚未同步',
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
    deleteConfirm: (name: string) =>
      `外部行事曆匯入後端尚未建置：按下確定不會從資料庫刪除「${name}」，也不會改變後台行事曆的內容（後台本來就沒有顯示這個來源的事件）。`,
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
    warning: '密鑰網址等同憑證，請勿外流。匯入後端尚未建置，目前貼上的網址不會被儲存到任何地方，也不會被讀取。',
  },

  messages: {
    copied: '已複製',
    loadFailed: '載入失敗',
    loadFailedPrefix: '載入失敗：',
    unknownError: '未知錯誤',
    networkError: '連線錯誤，請稍後再試',
  },
} as const;
