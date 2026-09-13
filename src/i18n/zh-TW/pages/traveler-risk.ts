/**
 * 旅客風險政策 modal（issue #44，GUIDE 顧客管理頁內嵌）文案。
 * `src/app/tenant/customers/page.tsx` 的 `TravelerRiskPolicyModal` 專用。
 */
export const travelerRiskPage = {
  action: '旅客風險政策',
  modalTitle: (name: string) => `旅客風險政策 — ${name}`,

  loading: '載入中...',
  loadFailed: '載入政策失敗，請稍後再試',

  currentTitle: '目前政策',
  currentEmpty: {
    title: '尚未套用任何政策',
    description: '此旅客目前依平台預設規則下單，未被特別限制。',
  },
  depositLabel: (mode: string, value: string) => `訂金：${mode} ${value}`,
  appliedBy: (actor: string, date: string) => `由 ${actor} 於 ${date} 設定`,
  reasonPrefix: '原因：',

  historyTitle: '歷史紀錄',
  historyEmpty: '尚無歷史紀錄',

  formTitle: '套用新政策',
  managerOnlyNotice: '需 MANAGER 以上權限才能套用或變更政策；下方僅供檢視。',
  form: {
    policy: '政策',
    depositMode: '訂金方式',
    depositValue: '訂金數值',
    depositValuePlaceholderFixed: '例如：500（新台幣）',
    depositValuePlaceholderPercent: '例如：50（1–100）',
    reason: '原因',
    reasonPlaceholder: '請說明套用此政策的原因（至少 4 個字）...',
    reasonMax: 500,
    actorLabel: '操作者',
    actorLabelPlaceholder: '請輸入你的姓名',
    submit: '套用政策',
    submitting: '套用中...',
    reset: {
      title: '解除限制政策',
      description: '將此旅客的政策改回一般（DEFAULT），不會刪除歷史紀錄。',
      submit: '解除為一般',
    },
  },

  messages: {
    assigned: '政策已套用',
    assignFailed: '套用政策失敗',
    reasonRequired: '請填寫原因（至少 4 個字）',
    actorLabelRequired: '請填寫操作者',
    depositRequired: '強制訂金需要填寫訂金方式與數值',
    depositFixedInvalid: '固定金額必須大於 0',
    depositPercentInvalid: '比例必須介於 1 到 100 之間',
  },
} as const;
