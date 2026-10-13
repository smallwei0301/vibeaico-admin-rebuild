/**
 * 旅客自助 REQUEST 申請旅程（`/s/{shopCode}/plans/{planId}/request` 與
 * `/s/{shopCode}/requests/{orderId}`）的文案 —— issue #46。
 *
 * ⚠️ `status.pendingTitle` 是這整片最重要的一句話：owner 規格明講「絕不能把
 * 『已送出申請』標成『預約成功』」——送出申請時完全沒有鎖任何名額，導遊按下
 * 「接受」的那一刻才真的鎖位。用詞寧可囉唆，也不能讓旅客誤以為已經訂到。
 */
/** 備註類自由文字欄位字數上限（與 server zod 的 max(500) 一致）。 */
export const NOTE_MAX_LENGTH = 500;

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
    seasonalContactHeadline: '價格依出發日期而定，請洽店家',
    seasonalHeadline: '依出發日期而定',
    departurePrice: (amount: string, unit: string) => ` · ${amount}${unit}`,
    totalLabel: '實際金額',
    totalPerPerson: (unit: string, party: number, total: string) => `${unit} × ${party} 人 ＝ ${total}`,
    totalPerGroup: (total: string) => `${total}（整團一口價）`,
    priceChangedTitle: '價格已更新',
    priceChangedDescription: (unitText: string, totalText: string) =>
      `頁面載入後店家調整了價格。目前實際金額為 ${totalText}（單價 ${unitText}），請確認新的金額後再送出。`,
    submitConfirmNewPrice: '確認新金額並送出',
    totalUnknown: '目前無法確認此日期的金額，請聯絡店家或改選其他日期。',
    departurePlaceholder: '請選擇一個日期',
    departureOption: (dateText: string, startTime: string, seatsLeft: number) =>
      `${dateText}${startTime ? ` ${startTime}` : ''}（剩 ${seatsLeft} 位）`,
    departuresEmpty: '這個方案目前沒有開放申請的日期，請點下方「返回店家頁」，用店家頁上的聯絡方式詢問。',
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
    partySizeOutOfRange: (min: number, max: number) => `此方案的人數需介於 ${min}–${max} 人，請調整人數`,
    priceChangedNoQuote: '價格已更新，請重新整理頁面確認最新金額後再送出',
    priceUnverifiable: '線上價格暫時無法確認，請直接聯絡店家',
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
     * 訂單仍待確認。不能沿用 REQUEST 的「尚未鎖位」；付款進度另依 paymentStatus 顯示。
     */
    pendingLockedTitle: '已為您預約，名額已鎖定',
    pendingLockedDescription: '店家會透過您填寫的聯絡方式與您確認付款方式與期限；在完成付款前，請留意店家通知。',
    pendingLockedPaymentDescription: '目前訂單仍待確認，請留意店家後續通知；付款進度請以下方付款狀態為準。',
    confirmedPaymentDescription: '導遊已確認此申請，付款進度請以下方付款狀態為準。',
    /** created=1 才顯示。REQUEST 沒鎖位、也沒付款，措辭不得出現「預約成功」。 */
    createdRequestTitle: '申請已送出',
    createdRequestDescription: '店家已收到您的申請，正等待導遊確認；確認前不會鎖位，也不需要付款。請留意您填寫的聯絡方式。',
    createdBookingTitle: '訂單已送出',
    createdBookingDescription: '店家已收到您的預約並為您保留名額；付款方式與期限會由店家透過您填寫的聯絡方式通知，請以下方付款狀態為準。',
    paymentTitle: '付款狀態',
    paymentState: {
      UNPAID: '尚未付款',
      PARTIAL: '已付部分款項',
      PAID: '已全額付款',
      REFUND_PENDING: '退款處理中，尚未完成',
      REFUNDED: '已退款',
    },
    paymentDescription: {
      UNPAID: '此訂單尚未收到付款。',
      PARTIAL: '已收到部分款項，尚未全額付清；實際已付金額、待付金額與期限請向店家確認。',
      PAID: '此訂單已全額付清。',
      REFUND_PENDING: '退款仍在處理中，尚未完成；退款進度請向店家確認。',
      REFUNDED: '此訂單已退款；實際退款金額請向店家確認。',
    },
    confirmedTitle: '導遊已確認，名額已鎖定',
    confirmedDescription: (deadline: string) => `請於 ${deadline} 前完成付款，逾期名額將被釋放。`,
    confirmedNoDeadlineDescription: '導遊已確認此申請，請與店家確認付款方式與期限。',
    cancelledTitle: '此申請已取消',
    cancelledDescription: '導遊婉拒了這次申請，或申請已逾期未獲確認。您可以重新申請或改用 LINE／電話聯絡店家。',
    /** #917：已付款（PAID／PARTIAL／REFUND_PENDING）的取消單不可說「導遊婉拒」。 */
    cancelledPaidDescription: '此訂單已取消。您已付款的部分，退款事宜請與店家確認。',
    cancelledRefundedDescription: '此訂單已取消並已退款。',
    completedTitle: '行程已完成',
    completedDescription: '感謝您的參與！',
    fields: {
      orderNo: '申請編號',
      plan: '方案',
      trip: '行程',
      departsOn: '希望出發日期',
      party: '人數',
      submittedAt: '申請時間',
      depositPaid: '已付訂金',
      refunded: '已退金額',
    },
    /** #917：有實際金額時不再要求旅客向店家確認金額（金額已格式化為字串）。 */
    paymentPartialWithAmount: (paid: string) => `已收到部分款項，已付 ${paid}，尚未全額付清；待付款期限請向店家確認。`,
    paymentRefundedWithAmount: (refunded: string) => `此訂單已退款，退款金額 ${refunded}。`,
    paymentRefundPendingWithAmount: (refunded: string) => `退款仍在處理中，已退 ${refunded}；其餘退款進度請向店家確認。`,
    partyUnit: (n: number) => `${n} 人`,
    cancellationPolicyTitle: '本次申請適用的取消／退款政策',
    cancellationPolicyMissing: '政策未提供',
    backToShop: '返回店家頁',
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
