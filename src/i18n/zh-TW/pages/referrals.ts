/**
 * 推薦好友（/tenant/referrals）文案
 * 推薦碼卡、統計卡、推薦機制說明、推薦歷史表格與所有 toast
 * 均逐字取自原站 DOM 與 inline JS（docs/specs/referrals.json）。
 */
export const referralsPage = {
  title: '推薦好友',
  metaTitle: '推薦好友 - 店家後台',

  /* ------------------------------------------------------------ 推薦碼卡 */
  code: {
    heading: '您的推薦碼',
    copyCode: '複製推薦碼',
    linkLabel: '推薦連結',
    copyLink: '複製',
    shareLine: 'LINE 分享',
    shareText:
      '我正在使用VibeAI管理店家預約，推薦你也來試試！註冊並完成首次儲值後，雙方各獲得 500 點。\n',
    shareConfirmTitle: 'LINE 分享',
    shareConfirmMessage: '將開啟 LINE 分享視窗，把推薦連結傳給其他店家。',
  },

  /* ------------------------------------------------------------ 機制說明 */
  explain: {
    label: '推薦機制說明：',
    lead: '將推薦碼或推薦連結分享給其他店家，對方註冊成功',
    strong: '並完成首次儲值',
    tail: '後，雙方各獲得 500 點獎勵（註冊當下尚不會發放）。點數可用於訂閱付費功能。',
  },

  /* -------------------------------------------------------------- 統計卡 */
  stats: {
    total: '總推薦數',
    completed: '已完成',
    pending: '待完成',
    earnedPoints: '累計獲得點數',
  },

  /* -------------------------------------------------------------- 表格 */
  tableTitle: '推薦歷史',
  columns: {
    shopName: '被推薦店家',
    shopCode: '店家代碼',
    status: '狀態',
    rewardPoints: '獎勵點數',
    referredAt: '推薦時間',
    completedAt: '完成時間',
  },

  status: {
    COMPLETED: '已完成',
    PENDING: '待完成',
    EXPIRED: '已過期',
  },

  labels: {
    notCompleted: '—',
    points: (n: number) => `${n} 點`,
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    codeCopied: '推薦碼已複製',
    linkCopied: '推薦連結已複製',
    copyFailed: '複製失敗，請手動複製',
    loadReferralsFailed: '載入推薦資料失敗:',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

  empty: {
    title: '還沒有推薦記錄',
    description: '把推薦碼或推薦連結分享給其他店家，對方註冊並完成首次儲值後，雙方各獲得 500 點。',
  },
} as const;
