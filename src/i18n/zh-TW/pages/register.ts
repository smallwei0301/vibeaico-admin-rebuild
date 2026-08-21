/**
 * 免費註冊（/tenant/register）文案
 * 逐字取自原站 docs/specs/register.json：8 個表單欄位（含 * 必填標記）、
 * 隱藏欄位 agentReferralCode 的 help text、第三方快速註冊按鈕與 19 條 inline JS 訊息。
 */
export const registerPage = {
  title: '免費註冊',
  metaTitle: '免費註冊 | VibeAI - 線上預約系統',
  metaDescription:
    '立即免費註冊VibeAI，5分鐘快速開通。整合 LINE 預約機器人，自動提醒、顧客管理、營運報表。適合美容美髮、按摩SPA、健身教練等服務業。超過 150+ 店家使用。',

  heading: 'VibeAI',
  /** 分享卡（og:title / og:description）文案 */
  shareTitle: '免費註冊VibeAI',
  shareDescription: '免費註冊VibeAI，整合 LINE 預約機器人，適合各種服務業。',

  /* ---------------------------------------------------------- 第三方註冊 */
  oauth: {
    line: '用 LINE 快速註冊',
    lineHref: '/api/auth/oauth/line/authorize',
    google: '用 Google 快速註冊',
    googleHref: '/api/auth/oauth/google/authorize',
    divider: '或使用以下方式註冊',
  },

  /* -------------------------------------------------------------- 表單 */
  /* -------------------------------------------------- 業態模式（13 分冊） */
  businessType: {
    label: '你的店家類型',
    help: '選一個最接近的，我們會依此配置你的後台。之後在設定裡隨時可以改，也可以再加開其他模組。',
    options: [
      {
        key: 'LOCAL_SHOP',
        name: '當地商店',
        summary: '美髮、美甲、按摩、攝影、餐飲…',
        detail: '用「服務項目」排預約，顧客選時段與服務人員。',
      },
      {
        key: 'GUIDE',
        name: '嚮導',
        summary: '在地導覽、體驗活動、旅遊行程',
        detail: '用「行程與方案」開團，顧客選出團日期與人數。',
      },
      {
        key: 'CLINIC',
        name: '醫院診所',
        summary: '診所、牙醫、獸醫、物理治療',
        detail: '用「診療項目」看診，支援看診號碼掛號。',
      },
    ],
  },

  form: {
    code: '店家代碼',
    codePlaceholder: '例如：my-shop',
    codeHelp: '僅限小寫英文、數字、連字號（-）；此代碼用於登入及 LINE Webhook URL',
    name: '店家名稱',
    namePlaceholder: '請輸入店家名稱',
    email: '電子郵件',
    emailPlaceholder: '請輸入電子郵件',
    sendCode: '發送驗證碼',
    sendingCode: '發送中...',
    resendCode: '重新發送',
    /** 倒數：`${n} 秒` */
    countdownSuffix: ' 秒',
    verificationCode: '驗證碼',
    verificationCodePlaceholder: '請輸入 6 位數驗證碼',
    phone: '聯絡電話',
    phonePlaceholder: '請輸入聯絡電話',
    password: '密碼',
    passwordPlaceholder: '請輸入密碼（至少 8 位）',
    confirmPassword: '確認密碼',
    confirmPasswordPlaceholder: '請再次輸入密碼',
    showPassword: '顯示密碼',
    hidePassword: '隱藏密碼',
    referralCode: '推薦碼',
    referralCodeOptional: '（選填）',
    referralCodePlaceholder: '輸入推薦碼',
    submit: '註冊',
    submitting: '註冊中...',
  },

  /* ------------------------------------------------------- 驗證 / 訊息 */
  messages: {
    requiredFields: '請填寫所有必填欄位',
    codeFormat: '店家代碼只能包含小寫英文、數字和連字號',
    passwordMismatch: '兩次輸入的密碼不一致',
    phone10: '請輸入 10 位數電話號碼',
    code6: '請輸入 6 位數驗證碼',
    emailFirst: '請先輸入電子郵件',
    codeSent: '驗證碼已發送，請查收信箱',
    /** `驗證碼已發送至 ${email}` */
    codeSentToPrefix: '驗證碼已發送至 ',
    sendCodeFailed: '發送失敗',
    sendCodeFailedRetry: '發送失敗，請稍後再試',
    sendCodeFailedPrefix: '發送驗證碼失敗:',
    registerFailedPrefix: '註冊失敗:',
    registerSuccess: '註冊成功！正在跳轉...',
    unknownError: '未知錯誤',
  },

  /* -------------------------------------------------------------- 登入區 */
  login: {
    prompt: '已經有帳號了？',
    link: '立即登入',
  },
} as const;
