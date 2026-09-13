/**
 * 平台管理者代登入相關文案（21 分冊）。
 *
 * ⚠️ 這一組文案的每一句都必須與實際發生的事一致。代入是「以別人的身分改別人的
 * 資料」，畫面上任何含糊或美化，成本都由店家承擔。
 */
export const impersonationPage = {
  confirm: {
    title: '進入店家後台',
    eyebrow: '平台管理者',
    intro: '你即將以平台管理者身分進入這家店的後台。這段期間你所做的每一次寫入都會留下紀錄，店家自己也看得到。',
    targetLabel: '你要進入的店家',
    reasonLabel: '進入原因（必填）',
    reasonPlaceholder: '例如：協助設定收款方式',
    reasonHint: '這句話會寫進稽核紀錄，店家看得到。',
    limitNotice: '代入時效 30 分鐘，時間到自動失效且不會續期；需要更久請重新進入。',
    submit: '開始代入',
    submitting: '進入中…',
  },
  errors: {
    notLoggedIn: '請先登入平台管理者帳號。',
    notPlatformAdmin: '這個頁面只有平台管理者能用。你目前的帳號沒有這個權限。',
    noTenantForGuide: '這位導遊尚未對應到 VibeAI 店家，因此沒有後台可以進入。',
    noTarget: '網址沒有指定要進入哪一家店。',
    failed: '無法開始代入，請稍後再試。',
  },
  banner: {
    label: '平台管理者代入模式',
    inShop: '目前正在',
    remaining: '剩餘',
    minuteSuffix: '分鐘',
    expired: '已逾時',
    end: '結束代入',
    ending: '結束中…',
  },
  log: {
    title: '平台協助紀錄',
    intro: '平台管理者曾經進入你的後台協助處理時，每一次進入與每一次寫入都會記在這裡。',
    empty: '目前沒有平台管理者進入過你的後台。',
    loadFailed: '紀錄讀取失敗，請重新整理再試一次。',
    sessionsTitle: '進入紀錄',
    actionsTitle: '操作紀錄',
    reason: '原因',
    startedAt: '進入時間',
    endedAt: '結束時間',
    stillActive: '進行中',
    autoExpired: '逾時自動結束',
    method: '動作',
    path: '端點',
    status: '結果',
    at: '時間',
    scopeNotice: '這份紀錄記的是「誰、什麼時候、動了哪一支端點」，不含送出的內容本身——那會等於多存一份你的顧客個資。',
  },
} as const;
