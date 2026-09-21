/**
 * 公開店家頁（`/s/{shopCode}`）的文案。
 *
 * ⚠️ 這一頁的讀者是**顧客**，不是店家。用詞要避開後台術語：沒有「租戶」「團次」
 * 「方案」這種內部說法出現在顧客看得到的地方時，要換成他們懂的講法。
 */
export const publicShopPage = {
  /** 目前無法線上下單——這一段的每一個字都不能暗示可以 */
  booking: {
    title: '想預約嗎？',
    /**
     * ⚠️ 這句是本頁最重要的一句話。
     *
     * 線上下單與付款（#12／#32）目前還沒有建，所以這一頁**只能看、不能訂**。
     * 與其放一顆按了沒反應的「立即預約」，不如明確說要怎麼預約——那是顧客真正
     * 需要知道的事，而假按鈕只會讓他以為訂好了。
     */
    howTo: '目前請透過以下方式與我們聯絡完成預約，線上直接下單功能正在準備中。',
    viaLine: '用 LINE 聯絡我們',
    viaPhone: (phone: string) => `撥打 ${phone}`,
    viaEmail: (email: string) => `寄信到 ${email}`,
    /** 店家連一個聯絡方式都沒填時——不要假裝有 */
    noContact: '這家店尚未提供聯絡方式，請直接與店家確認。',
    /** #46 第三片：已經送過申請的顧客，用這個入口查自己的訂單狀態。 */
    myOrdersLink: '之前申請過？查詢我的訂單',
  },

  trips: {
    title: '行程',
    empty: '這家店還沒有上架的行程。',
    /** 顯示在行程卡片上的方案價格區間 */
    priceFrom: (amount: string) => `${amount} 起`,
    partyRange: (min: number, max: number) => `${min}–${max} 人成行`,
    durationHours: (hours: number) => `約 ${hours} 小時`,
    departuresTitle: '近期出團',
    /** 沒有可報名的團次時的誠實說法——不要顯示成「已額滿」，那是兩件事 */
    departuresEmpty: '目前沒有開放報名的日期，請與店家確認。',
    seatsLeft: (n: number) => `剩 ${n} 位`,
    /** 沒有指定出發時間的團次 */
    noStartTime: '時間未定',
    /**
     * #46：先申請再確認（REQUEST）模式的方案，是這一版唯一真的能線上送出的
     * 旅程，其餘方案仍只能透過上方的聯絡方式詢問。徽章與連結文字都要誠實
     * 反映「申請」而不是「預約成功」——送出申請不等於已經訂到。
     */
    requestBadge: '可線上申請',
    requestCta: '線上申請（先申請，導遊確認後才鎖位）',
    /**
     * #46：下單前顯示現行取消／退款政策——與
     * `src/i18n/zh-TW/pages/public-tour-request.ts` 的 `cancellationPolicy`
     * 同一份商業條件，這裡用單行摘要（整頁列多個行程，逐一展開完整條文太長）；
     * 完整條文顧客點進「線上申請」表單頁時看得到同一份值。
     */
    cancellationPolicyLabel: '取消／退款政策',
    cancellationPolicy: {
      STANDARD: '標準：出發前 7 天可全額退款',
      FLEXIBLE: '彈性：出發前 24 小時內皆可全額退款',
      STRICT: '嚴格：訂購後恕不接受退款',
    },
  },

  services: {
    title: '服務項目',
    empty: '這家店還沒有上架的服務項目。',
    minutes: (n: number) => `${n} 分鐘`,
  },

  /** 整家店都沒有任何可公開內容時 */
  emptyShop: {
    title: '這家店還在準備中',
    description: '目前還沒有上架任何行程或服務項目。',
  },

  notFound: {
    title: '找不到這家店',
    description: '這個網址可能輸入錯誤，或這家店已經不再營業。',
  },

  contact: {
    title: '聯絡資訊',
    phone: '電話',
    email: 'Email',
    address: '地址',
  },
} as const;
