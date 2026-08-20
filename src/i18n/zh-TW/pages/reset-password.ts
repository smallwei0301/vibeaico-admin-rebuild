/**
 * 重設密碼（/tenant/reset-password）文案
 * 逐字取自原站 docs/specs/reset-password.json。
 * 原站以 query string ?token=… 帶入重設 token，缺 token 時顯示「無效的重設連結」。
 */
export const resetPasswordPage = {
  title: '重設密碼',
  metaTitle: '重設密碼 - VibeAI',

  heading: 'VibeAI',
  subheading: '請設定新的登入密碼。',

  form: {
    newPassword: '新密碼',
    newPasswordPlaceholder: '請輸入新密碼（至少 8 位）',
    confirmPassword: '確認新密碼',
    confirmPasswordPlaceholder: '請再次輸入新密碼',
    showPassword: '顯示密碼',
    hidePassword: '隱藏密碼',
    submit: '重設密碼',
    submitting: '處理中...',
  },

  messages: {
    invalidLink: '無效的重設連結',
    requiredFields: '請填寫所有欄位',
    passwordMismatch: '兩次輸入的密碼不一致',
    success: '密碼重設成功！請使用新密碼登入。',
    failedPrefix: '重設失敗:',
    unknownError: '未知錯誤',
  },

  backToLogin: '返回登入',
} as const;
