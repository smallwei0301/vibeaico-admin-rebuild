/**
 * 旅客自助 FIXED_DEPARTURE 預約旅程（`/s/{shopCode}/plans/{planId}/book`）的
 * 文案——issue #46。
 *
 * ⚠️ 與 `public-tour-request.ts` 的關鍵差異：這裡送出當下就真的鎖位（見
 * `src/server/public-tour-booking.ts` 檔頭），所以文案用「已預約」而不是
 * 「已送出申請」，但同樣不能謊稱已付款——#12 金流 provider 尚未落地。
 */
export const publicTourBookingPage = {
  form: {
    metaTitle: (planName: string) => `線上預約 - ${planName}`,
    eyebrow: '固定團次（送出後立即為您保留名額）',
    disclaimer: '送出後會立即為您保留這個時段的名額；金流尚未串接，付款方式與期限請依店家後續通知或直接聯絡確認。',
    planPriceUnit: {
      PER_PERSON: '／人',
      PER_GROUP: '／團',
    },
    partyRange: (min: number, max: number) => `此方案 ${min}–${max} 人成行`,
    departureLabel: '選擇出發日期',
    departurePlaceholder: '請選擇一個日期',
    departureOption: (dateText: string, startTime: string, seatsLeft: number) =>
      `${dateText}${startTime ? ` ${startTime}` : ''}（剩 ${seatsLeft} 位）`,
    departuresEmpty: '這個方案目前沒有開放預約的日期，請改用下方聯絡方式詢問。',
    partyLabel: '人數',
    nameLabel: '姓名',
    contactSectionTitle: '聯絡方式（至少填寫一種）',
    contactHint: '店家會透過您填寫的其中一種方式與您確認付款方式與期限。',
    phoneLabel: '電話',
    lineLabel: 'LINE ID',
    emailLabel: 'Email',
    noteLabel: '備註（選填）',
    submit: '送出預約',
    submitting: '送出中…',
    cancellationPolicyTitle: '取消／退款政策',
    cancellationPolicy: {
      STANDARD: '標準：出發前 7 天可全額退款，出發前 3 天內不接受退款。',
      FLEXIBLE: '彈性：出發前 24 小時內皆可全額退款。',
      STRICT: '嚴格：訂購後恕不接受退款。',
    },
    cancellationPolicyNote: '此政策將於送出預約時一併記錄在您的訂單上，日後行程若更新政策不影響此筆預約。',
    backToShop: '返回店家頁',
  },

  errors: {
    notFound: '找不到此方案，或此方案目前未開放線上預約',
    loadFailed: '讀取失敗，請重新整理再試一次',
    validation: '請確認表單內容是否填寫完整',
    seatsUnavailable: '此團次名額已被搶先預約，請重新選擇日期',
    departureUnavailable: '此團次已不開放預約，請重新選擇日期',
    partySizeOutOfRange: '人數不在此方案的成團人數範圍內',
    featureLocked: '此店家目前未開放線上預約，請改用 LINE 或電話聯絡',
    generic: '預約送出失敗，請稍後再試，或改用 LINE／電話聯絡店家',
  },
} as const;
