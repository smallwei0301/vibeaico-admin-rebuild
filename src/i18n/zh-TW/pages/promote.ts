/**
 * 推廣中心（/tenant/promote）文案
 * 公開預約頁連結、QR Code、各通路教學步驟、推廣成效表格與所有 toast
 * 均逐字取自原站 DOM 與 inline JS（docs/specs/promote.json）。
 */
export const promotePage = {
  title: '推廣中心',
  metaTitle: '推廣中心 - 店家後台',

  /* ------------------------------------------------------ 卡片 1：預約頁 */
  publicUrl: {
    heading: '你的線上預約頁',
    loading: '載入中...',
    copy: '複製',
    open: '開啟',
    description:
      '這是顧客「自己上網預約」的入口。把它貼到下方各個通路，新客就能不透過 LINE 直接找到你並預約。',
    notConfigured: '尚未設定店家代碼',
    notConfiguredHint: '請先到「店家設定」設定店家代碼，才會有公開預約頁。',
  },

  /* ------------------------------------ 尚未建置：誠實告示（不可省略） */
  /**
   * ⚠️ 這一區塊是「誠實化」文案，對應 CLAUDE.md「Never fabricate a known」。
   * QR Code 已在 issue #16 補齊為真的前端產生（見下方 `qr` 區塊），此處只剩
   * 「推廣成效」仍是示範資料：MOCK_PROMOTION_STATS 是本檔寫死的示範數字，
   * 不是實際流量——流量統計後端尚未建置。
   */
  notBuilt: {
    title: '下方「推廣成效」為示範資料',
    statsBody:
      '下方「推廣成效」的瀏覽數字是本頁內建的示範資料，不是你的實際流量統計——流量統計後端尚未建置。',
    /**
     * ⚠️ 以下兩個鍵已不再被本頁任何地方引用（QR 已補齊為真的產生，不再是
     * 「不能掃描」的佔位圖示）。保留只是為了讓
     * `tests/unit/honest-not-built-interactions.test.ts`（舊前提：這裡不准有
     * QR）在主導者依 issue #16 驗收條件同步改寫前仍能通過型別檢查——
     * 那份測試的斷言前提已改變，依專案規則（15 分冊「測試前提變更一律
     * Opus」）本輪不動它，留給主導者處理，故先留著空殼鍵避免 tsc 炸裂。
     * 這兩個字串從未渲染到畫面上，不構成使用者可見的假宣稱。
     */
    qrPlaceholder: 'QR 產生功能尚未建置（此圖示不能掃描）',
    downloadDisabledHint: 'QR Code 產生尚未建置：本頁沒有可下載的 QR 圖檔',
  },

  /* ---------------------------------------------------------- 卡片 2：QR */
  /**
   * QR Code：issue #16（補齊-1）補上真的產生與下載，經 `src/lib/qr.ts`
   * （擁有者裁決安裝 `qrcode` 套件，見 14 分冊 §8.2）。內容＝上方那個
   * 公開預約網址逐字編碼，不是佔位圖示。
   */
  qr: {
    heading: '預約 QR Code',
    download: '下載 QR（印門口 / 名片）',
    generating: '產生中...',
    notReady: 'QR 尚未產生',
    generateFailed: 'QR Code 產生失敗，請稍後重試',
    downloadFailed: 'QR Code 下載失敗，請稍後重試',
    downloaded: 'QR Code 已下載',
    alt: '預約頁 QR Code',
    filename: '預約QRcode.png',
  },

  /* ------------------------------------------------------ 卡片 3：各通路 */
  channels: {
    heading: '把預約頁放上各通路（複製即用）',
    utmHint: {
      lead: '每個通路的連結都已自動加上來源標記（',
      code: '?utm_source=...',
      tail: '），方便你在下方「推廣成效」看出哪個通路最有效。',
    },
    platformHint:
      '各平台（Google／FB／IG）介面偶有調整，若選項位置與步驟不同，於該平台搜尋「預約連結 / Book Now」即可找到。',
    loading: '載入中...',
    copyLink: '複製',
    items: [
      {
        key: 'google',
        name: 'Google 商家檔案',
        utmSource: 'google',
        summary: 'CP 值最高：客人在 Google 搜尋你的店名 / 地圖上就能看到「預約」連結。',
        note: '',
        steps: [
          '用「管理這個商家的 Google 帳號」在 Google 搜尋你的店名（或開 Google 地圖 App 點你的商家）',
          '點「編輯商家檔案」→「聯絡資訊」→ 找到「預約連結 / Appointment links」（部分行業類別沒有此欄位，改貼到「網站」欄位即可）',
          '貼上下方網址（需 https）→ 儲存，數分鐘內生效（最久 24 小時）',
        ],
      },
      {
        key: 'facebook',
        name: 'Facebook 粉專按鈕',
        utmSource: 'facebook',
        summary: '粉專首頁加一顆「立即預訂」按鈕（也可在 Meta Business Suite 設定）。',
        note: '',
        steps: [
          '粉專封面照片下方點「＋ 新增按鈕」（已有按鈕則點「編輯」，或 ⋯ → 編輯行動呼籲按鈕）',
          '選「立即預訂 / Book Now」→ 貼上下方網址',
          '儲存。一個粉專同時只能有一顆按鈕，會顯示在首頁封面下方',
        ],
      },
      {
        key: 'instagram',
        name: 'Instagram 個人簡介',
        utmSource: 'instagram',
        summary: '把預約頁放進 IG 個人簡介的網站欄，貼文 / 限動都能導流。',
        note: '',
        steps: [
          '個人檔案 →「編輯個人檔案」',
          '把下方網址貼到「網站」欄位（多個連結可用 bio 連結工具）',
          '限時動態 / 貼文也可加「連結」貼紙導到這個網址',
        ],
      },
      {
        key: 'line',
        name: 'LINE 圖文選單',
        utmSource: 'line',
        summary: '在 LINE 選單放一格直接打開預約頁（適合想用網頁版預約流程的店家）。',
        note: '',
        steps: [
          '後台「選單設計」新增 / 編輯一格',
          '動作選「打開網址」，貼上下方網址',
          '發布到 LINE。顧客點該格就進入網頁預約頁',
        ],
      },
      {
        key: 'email',
        name: 'Email 簽名檔 / 自動回覆',
        utmSource: 'email',
        summary: '每封信都順手帶上預約入口。',
        note: '寄預約確認 / 行銷信時自然帶上預約連結',
        steps: [
          '複製下方網址',
          '貼進 Email 簽名檔或自動回覆內容',
        ],
      },
    ],
  },

  /* ------------------------------------------------------ 卡片 4：推廣成效 */
  stats: {
    heading: '推廣成效（各通路帶來的瀏覽）',
    daysOptions: [
      { value: '7', label: '最近 7 天' },
      { value: '30', label: '最近 30 天' },
      { value: '90', label: '最近 90 天' },
    ],
    columns: {
      source: '通路來源',
      pv: '瀏覽次數 (PV)',
      uv: '不重複訪客 (UV)',
    },
    loading: '載入中...',
    loadFailed: '載入失敗，請稍後再試',
    directLabel: '直接造訪',
    footnote:
      '「直接造訪」= 沒有經由帶標記的推廣連結進來（例如直接輸入網址、書籤、或你貼的是未加標記的舊連結）。多用上方「複製即用」的連結，這份報表就會越準。',
    emptyTitle: '這段期間還沒有瀏覽資料，把上方連結貼出去看看吧！',
    emptyDescription: '把上方「複製即用」的連結貼到 Google、FB、IG 或 Email 簽名檔，數據就會開始累積。',
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    copied: '已複製',
    urlCopied: '網址已複製',
    copyFailed: '複製失敗，請手動複製',
    loadPromotionFailed: '載入推廣資料失敗:',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },
} as const;
