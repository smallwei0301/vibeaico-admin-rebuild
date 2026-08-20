/**
 * 忘記密碼（/tenant/forgot-password）文案
 * 逐字取自原站 docs/specs/forgot-password.json。
 */
export const forgotPasswordPage = {
  title: '忘記密碼',
  metaTitle: '忘記密碼 - VibeAI',

  heading: 'VibeAI',
  subheading: '輸入註冊時使用的電子郵件，我們會寄送重設密碼連結給您。',

  form: {
    email: '電子郵件',
    emailPlaceholder: '請輸入電子郵件',
    submit: '發送重設連結',
    submitting: '發送中...',
  },

  messages: {
    emailRequired: '請輸入電子郵件',
    sent: '重設密碼連結已發送到您的信箱，請查收。',
    sendFailedPrefix: '發送失敗:',
    unknownError: '未知錯誤',
  },

  backToLogin: '返回登入',
} as const;
