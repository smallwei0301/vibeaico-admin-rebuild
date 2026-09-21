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

  /** `/s/{shopCode}/my-orders`——旅客用送出申請時填的聯絡方式查自己的所有訂單。 */
  myOrders: {
    metaTitle: '我的訂單',
    title: '查詢我的訂單',
    description: '輸入您申請時填寫的電話、LINE ID 或 Email 其中一種，即可查詢在這家店送出過的所有申請與訂單。',
    contactLabel: '電話 / LINE ID / Email',
    contactPlaceholder: '請輸入其中一種聯絡方式',
    submit: '查詢',
    searching: '查詢中…',
    errors: {
      validation: '請輸入查詢用的聯絡方式',
      rateLimited: '查詢過於頻繁，請稍後再試',
      generic: '查詢失敗，請稍後再試',
    },
    emptyTitle: '查無符合的訂單',
    emptyDescription: '請確認輸入的聯絡方式與申請時填寫的是否一致；若確定曾經申請過，請改用 LINE／電話聯絡店家確認。',
    initialTitle: '輸入聯絡方式開始查詢',
    initialDescription: '查詢結果只會顯示這家店的訂單，且僅比對您輸入的聯絡方式。',
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
