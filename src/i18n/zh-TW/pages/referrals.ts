/**
 * 推薦好友（/tenant/referrals）文案
 * 推薦碼卡、統計卡、推薦機制說明、推薦歷史表格與所有 toast
 * 均逐字取自原站 DOM 與 inline JS（docs/specs/referrals.json）。
 */
export const referralsPage = {
  title: '推薦好友',
  metaTitle: '推薦好友 - 店家後台',

  /* ---------------------------------------- 尚未建置：誠實告示（不可省略） */
  /**
   * ⚠️ 這一區塊是「誠實化」文案，對應 CLAUDE.md「Never fabricate a known」。
   * 推薦碼後端尚未建置：本店沒有任何真正配發的推薦碼。舊實作用硬編碼的
   * 'VIBE-DEMO-8421' 組出註冊連結給店家複製去分享 —— 店家會發出一條無效連結，
   * 對方註冊也不會算成推薦。因此推薦碼／連結一律顯示「尚未開通」，複製與分享停用。
   */
  notBuilt: {
    title: '推薦碼功能尚未開通',
    body:
      '推薦碼後端尚未建置，本店尚未取得任何推薦碼，也還沒有可用的推薦連結，因此複製與 LINE 分享已停用 —— 這是為了避免你發出一條無法追蹤、對方註冊也不會算成推薦的連結。下方統計與推薦歷史為示範資料。',
    codeUnavailable: '尚未開通',
    linkUnavailable: '尚未開通（推薦連結需由後端配發）',
    disabledHint: '推薦碼尚未開通，無法複製或分享',
    /**
     * 未知態顯示值。CLAUDE.md：值不知道就顯示不知道，絕不填一個看起來合理的假值。
     * 推薦數與累計獎勵點數是平台對店家的獎勵陳述，後端不存在就不得給數字
     * （舊值是 MOCK_REFERRALS 五筆假記錄推算出來的 5／2／2／1000 點）。
     */
    unknownValue: '--',
    historyEmptyTitle: '推薦歷史尚未開通',
    historyEmptyDescription:
      '推薦碼後端尚未建置，目前查不到任何推薦記錄；這裡不會放示範記錄，以免看起來像真的推薦成功過。',
  },

  /* ------------------------------------------------------------ 推薦碼卡 */
  code: {
    heading: '您的推薦碼',
    copyCode: '複製推薦碼',
    linkLabel: '推薦連結',
    copyLink: '複製',
    shareLine: 'LINE 分享',
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
    loadReferralsFailed: '載入推薦資料失敗:',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },

} as const;
