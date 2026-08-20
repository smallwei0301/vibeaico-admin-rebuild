/**
 * AI 客服設定（/tenant/ai-settings）文案
 * -----------------------------------------------------------------------------
 * 逐字取自原站 docs/specs/ai-settings.json：4 張卡片的完整內文、兩個開關的
 * 說明、提示詞 textarea 的 placeholder／help，以及 30 條 inline JS 訊息。
 * ⚠️ 7 個行業範本的「提示詞內容」是 inline JS 的資料，spec 只抓得到範本名稱；
 *    骨架階段範本內容留空由店家自行填寫，見頁面內的 TEMPLATE_KEYS 註解。
 */
export const aiSettingsPage = {
  title: 'AI 客服設定',
  metaTitle: 'AI 客服設定 - 店家後台',
  subtitle: '設定 LINE Bot 的 AI 自動回覆行為與提示詞',

  /* --------------------------------------------------------- 行業範本卡 */
  templates: {
    cardTitle: '快速套用行業範本',
    cardDesc: '選擇最接近您行業的範本，一鍵套用後再依需求修改',
    apply: '套用範本',
    items: {
      pet: { button: '🐾 寵物美容', name: '寵物美容' },
      nail: { button: '💅 美容美甲', name: '美容美甲' },
      hair: { button: '✂️ 髮廊', name: '髮廊' },
      clinic: { button: '🏥 醫美診所', name: '醫美診所' },
      gym: { button: '💪 健身房', name: '健身房' },
      restaurant: { button: '🍽️ 餐廳', name: '餐廳' },
      spa: { button: '🧖 SPA 按摩', name: 'SPA 按摩' },
    },
    confirm: (name: string) =>
      `確定要套用「${name}」範本嗎？\n\n目前的提示詞會被取代，套用後可以自由修改。`,
    confirmTitle: '套用範本',
  },

  /* --------------------------------------------------------- 自訂提示詞 */
  prompt: {
    cardTitle: '自訂提示詞',
    clear: '清空',
    clearTitle: '清空提示詞',
    clearConfirm: '確定要清空提示詞嗎？',

    enabledLabel: '啟用 AI 自動回覆',
    enabledHelp: '關閉後，LINE Bot 不會自動用 AI 回覆訊息（其他選單功能不受影響）。',
    strictLabel: '嚴格模式：閒聊 / 亂碼 由專人處理',
    strictHelp:
      '開啟後，顧客若打純數字（如 1822）、亂碼、單字、符號等「明顯非詢問」訊息，AI 完全不回覆，讓店家專人親自接。正常詢問（價格/時間/地址）AI 仍會正常回答。',

    placeholder: '選擇上方行業範本，或直接輸入您的自訂提示詞...',
    help: '套用範本後可自由修改，儲存後立即生效',
    max: 2000,
    rows: 12,
    save: '儲存設定',
    saving: '儲存中...',
  },

  /* --------------------------------------------------------- AI 如何回覆 */
  how: {
    cardTitle: 'AI 如何回覆？',
    lead: 'AI 客服會自動結合以下資訊回覆顧客：',
    items: [
      '您的店家名稱、電話、地址',
      '所有服務項目與價格',
      '顧客的姓名與預約記錄',
      '您填寫的自訂提示詞',
    ],
    tipLabel: '小技巧：',
    tipText:
      '寫得越具體，AI 回覆越精準。例如「停車場在巷口左轉 50 公尺」比「附近有停車場」好。',
  },

  /* ------------------------------------------------------------ 撰寫建議 */
  writing: {
    cardTitle: '撰寫建議',
    items: [
      '每條重點用「-」開頭，一行一個',
      '寫 5-15 條效果最好',
      '加入促銷活動與優惠資訊',
      '寫下顧客最常問的問題答案',
      '指定語氣風格（親切/專業/活潑）',
      '註明不提供的服務，避免誤答',
    ],
  },

  /* ------------------------------------------------------------ 功能訂閱 */
  feature: {
    lockedLead: '未訂閱時 ',
    lockedStrong: 'AI 不會回覆顧客的任何問題',
    lockedTail: '，此頁設定可以儲存但不會生效。',
    goToStore: '前往功能商店訂閱 →',
    name: 'AI 客服',
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    savedEnabled: 'AI 客服設定已儲存（已啟用）',
    savedDisabled: 'AI 客服已關閉',
    saveFailedPrefix: '儲存失敗：',
    loadFailed: '載入 AI 設定失敗',
    connectionError: '連線錯誤，請稍後再試',
    retryLater: '請稍後再試',
    unknownError: '未知錯誤',
  },
} as const;
