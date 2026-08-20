/**
 * 店家登入（/tenant/login）文案
 * 逐字取自原站 docs/specs/login.json（headings / forms / buttons / alerts / jsStrings）。
 * spec 只抓得到表單與按鈕，樣板中的純文字連結（忘記密碼？／或使用第三方登入／
 * 還沒有帳號？立即註冊）依原站畫面補齊，措辭未改寫。
 */
export const loginPage = {
  title: '店家登入',
  metaTitle: '店家登入 | VibeAI管理系統',
  metaDescription:
    '登入VibeAI店家後台，管理您的預約、顧客、員工和營運報表。免費線上預約系統，整合 LINE 預約機器人。立即免費試用！',

  /** h1 —— 原站登入卡片上方的產品標語 */
  heading: 'LINE 智慧預約系統',
  subheading: '店家後台管理系統',

  /* ------------------------------------------------------------ 登入表單 */
  form: {
    username: '帳號',
    usernamePlaceholder: '請輸入帳號',
    password: '密碼',
    passwordPlaceholder: '請輸入密碼',
    showPassword: '顯示密碼',
    hidePassword: '隱藏密碼',
    forgotPassword: '忘記密碼？',
    submit: '登入',
    submitting: '登入中...',
  },

  /* ---------------------------------------------------------- 第三方登入 */
  oauth: {
    divider: '或使用第三方登入',
    line: '用 LINE 登入',
    lineHref: '/api/auth/oauth/line/authorize',
    google: '用 Google 登入',
    googleHref: '/api/auth/oauth/google/authorize',
    /** #oauthErrorBox：第三方導回失敗時顯示 */
    failedPrefix: '第三方登入失敗：',
  },

  /* -------------------------------------------------------------- 註冊區 */
  register: {
    prompt: '還沒有帳號？',
    link: '立即註冊',
  },

  /* -------------------------------------------------- 訊息（inline JS）*/
  messages: {
    usernameRequired: '請輸入帳號',
    passwordRequired: '請輸入密碼',
    /** 超管「模擬登入」連結（/api/auth/impersonate）的錯誤文案 */
    impersonateFailedPrefix: '模擬登入失敗:',
    impersonateFailedRetry: '模擬登入失敗：請稍後再試，或回超管後台重新產生連結。',
    impersonateExpired:
      '模擬登入失敗：連結可能已過期，請回超管後台重新產生模擬登入連結。',
    loginFailed: '登入失敗，請確認帳號密碼',
    unknownError: '未知錯誤',
  },
} as const;
