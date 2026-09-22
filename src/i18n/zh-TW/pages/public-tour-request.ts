/**
 * 旅客自助 REQUEST 申請旅程（`/s/{shopCode}/plans/{planId}/request` 與
 * `/s/{shopCode}/requests/{orderId}`）的文案 —— issue #46。
 *
 * ⚠️ `status.pendingTitle` 是這整片最重要的一句話：owner 規格明講「絕不能把
 * 『已送出申請』標成『預約成功』」——送出申請時完全沒有鎖任何名額，導遊按下
 * 「接受」的那一刻才真的鎖位。用詞寧可囉唆，也不能讓旅客誤以為已經訂到。
 */
export const publicTourRequestPage = {
  form: {
    metaTitle: (planName: string) => `線上申請 - ${planName}`,
    eyebrow: '線上申請（先申請，導遊確認後才鎖位）',
    disclaimer: '送出這份申請不會馬上鎖定名額，需要等待導遊確認後才正式成立。',
    planPriceUnit: {
      PER_PERSON: '／人',
      PER_GROUP: '／團',
    },
    partyRange: (min: number, max: number) => `此方案 ${min}–${max} 人成行`,
    departureLabel: '選擇希望的出發日期',
    departurePlaceholder: '請選擇一個日期',
    departureOption: (dateText: string, startTime: string, seatsLeft: number) =>
      `${dateText}${startTime ? ` ${startTime}` : ''}（剩 ${seatsLeft} 位）`,
    departuresEmpty: '這個方案目前沒有開放申請的日期，請改用下方聯絡方式詢問。',
    partyLabel: '人數',
    nameLabel: '姓名',
    contactSectionTitle: '聯絡方式（至少填寫一種）',
    contactHint: '導遊會透過您填寫的其中一種方式與您確認申請結果。',
    phoneLabel: '電話',
    lineLabel: 'LINE ID',
    emailLabel: 'Email',
    preferredNoteLabel: '偏好日期／時段補充（選填）',
    specialRequestLabel: '特殊需求（選填）',
    submit: '送出申請',
    submitting: '送出中…',
    cancellationPolicyTitle: '取消／退款政策',
    cancellationPolicy: {
      STANDARD: '標準：出發前 7 天可全額退款，出發前 3 天內不接受退款。',
      FLEXIBLE: '彈性：出發前 24 小時內皆可全額退款。',
      STRICT: '嚴格：訂購後恕不接受退款。',
    },
    cancellationPolicyNote: '此政策將於送出申請時一併記錄在您的訂單上，日後行程若更新政策不影響此筆申請。',
    backToShop: '返回店家頁',
  },

  errors: {
    notFound: '找不到此方案，或此方案目前未開放線上申請',
    loadFailed: '讀取失敗，請重新整理再試一次',
    validation: '請確認表單內容是否填寫完整',
    seatsUnavailable: '此團次名額已被搶先申請，請重新選擇日期',
    departureUnavailable: '此團次已不開放申請，請重新選擇日期',
    partySizeOutOfRange: '人數不在此方案的成團人數範圍內',
    featureLocked: '此店家目前未開放線上申請，請改用 LINE 或電話聯絡',
    generic: '申請送出失敗，請稍後再試，或改用 LINE／電話聯絡店家',
  },

  status: {
    metaTitle: '申請狀態',
    notFoundTitle: '找不到這筆申請',
    notFoundDescription: '請確認網址與申請時填寫的聯絡方式是否正確。',
    /**
     * ⚠️ 見檔頭——這一句絕對不能寫成「預約成功」。PENDING＝還在等導遊決定，
     * 名額目前沒有被鎖住，這是誠實的現況，不是客氣話。
     */
    pendingTitle: '已送出申請，等待導遊確認，尚未鎖位',
    pendingDescription: '導遊確認名額後會鎖定這個時段並通知您付款期限；在那之前，此名額仍可能被其他人申請走。',
    /**
     * #46：FIXED_DEPARTURE／INSTANT 訂單的 PENDING 與 REQUEST 完全不同——
     * 建單當下就已經真的鎖位（`create_tour_order` 的 `reserve_seats`），只是
     * 付款尚未完成。這裡絕對不能沿用上面 REQUEST 的「尚未鎖位」文案，那句話
     * 對這裡是假的；也不能寫成「已付款」，那同樣是假的（#12 金流尚未落地）。
     */
    pendingLockedTitle: '已為您預約，名額已鎖定，尚未付款',
    pendingLockedDescription: '店家會透過您填寫的聯絡方式與您確認付款方式與期限；在完成付款前，請留意店家通知。',
    confirmedTitle: '導遊已確認，名額已鎖定',
    confirmedDescription: (deadline: string) => `請於 ${deadline} 前完成付款，逾期名額將被釋放。`,
    confirmedNoDeadlineDescription: '導遊已確認此申請，請與店家確認付款方式與期限。',
    cancelledTitle: '此申請已取消',
    cancelledDescription: '導遊婉拒了這次申請，或申請已逾期未獲確認。您可以重新申請或改用 LINE／電話聯絡店家。',
    completedTitle: '行程已完成',
    completedDescription: '感謝您的參與！',
    fields: {
      orderNo: '申請編號',
      plan: '方案',
      trip: '行程',
      departsOn: '希望出發日期',
      party: '人數',
      submittedAt: '申請時間',
    },
    partyUnit: (n: number) => `${n} 人`,
    cancellationPolicyTitle: '本次申請適用的取消／退款政策',
    cancellationPolicyMissing: '政策未提供',
    backToShop: '返回店家頁',
    myOrdersLink: '查看我的所有訂單',
  },

  /**
   * `/s/{shopCode}/my-orders`——issue #650 起不再用聯絡方式當作本人證明。
   * 正式批次查單會由 #12 traveler identity + /api/public/me/orders 接手。
   */
  myOrders: {
    metaTitle: '我的訂單',
    title: '查詢我的訂單',
    description: '為保護您的訂單資料，查詢所有訂單需要先完成旅客身分驗證。',
    contactLabel: '電話 / LINE ID / Email',
    contactPlaceholder: '匿名聯絡方式查詢已停用',
    submit: '查詢',
    searching: '查詢中…',
    errors: {
      validation: '需要先完成旅客身分驗證',
      rateLimited: '查詢過於頻繁，請稍後再試',
      generic: '目前無法安全查詢所有訂單',
    },
    emptyTitle: '尚未完成身分驗證',
    emptyDescription: '請從原本的申請狀態連結查看單筆申請，或直接聯絡店家協助確認。',
    initialTitle: '需要先驗證旅客身分',
    initialDescription: '目前不再接受只輸入電話、LINE ID 或 Email 的匿名批次查詢。完整「我的訂單」會在旅客登入驗證完成後開放。',
    resultCount: (n: number) => `共 ${n} 筆`,
    status: {
      PENDING: '待確認',
      CONFIRMED: '已確認',
      CANCELLED: '已取消',
      COMPLETED: '已完成',
    },
    viewDetail: '查看詳情',
    backToShop: '返回店家頁',
  },
} as const;
