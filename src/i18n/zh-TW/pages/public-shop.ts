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
