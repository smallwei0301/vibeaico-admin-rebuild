/**
 * 店面設計 / 公開頁面設計（/tenant/shop-design）文案
 * -----------------------------------------------------------------------------
 * 逐字取自原站 docs/specs/shop-design.json：6 個分頁（店家資訊 / 橫幅封面 /
 * 關於我們 / 圖片展示 / 主題外觀 / 社群連結）、所有 looseFields 的 label +
 * placeholder + help、按鈕與 40 餘條 inline JS 訊息。
 * 本頁設定的是「公開預約頁」的品牌外觀，對應 tenant_settings 的 branding 分組。
 */
export const shopDesignPage = {
  title: '公開頁面設計',
  metaTitle: '公開頁面設計 - 店家後台',
  subtitle: '設定顧客在公開預約頁看到的品牌外觀',

  actions: {
    preview: '預覽頁面',
    save: '儲存設定',
  },

  /* --------------------------------------------------------------- 分頁 */
  tabs: {
    profile: '店家資訊',
    banner: '橫幅封面',
    about: '關於我們',
    gallery: '圖片展示',
    theme: '主題外觀',
    social: '社群連結',
  },

  /* --------------------------------------------------------- 店家資訊 */
  profile: {
    cardTitle: '店家資訊',
    cardDesc: '設定顯示在公開頁面的店家名稱與頭像',
    shopName: '店家名稱',
    shopNamePlaceholder: '例如：Lucy Lin Beauty Studio',
    logo: '店家頭像 / Logo',
    logoUpload: '上傳頭像',
    logoRemove: '移除頭像',
    logoHelp:
      '支援 JPG / PNG / WebP / GIF（動態 WebP・GIF 會循環播放），建議 200x200 px 正方形；靜態最大 2MB、動態最大 5MB',
    logoHidden: '在公開頁隱藏 Logo',
  },

  /* --------------------------------------------------------- 橫幅封面 */
  banner: {
    cardTitle: '橫幅封面',
    cardDesc: '上傳一張橫幅圖片作為頁面封面（建議 1200x400 px）',
    uploadPrompt: '點擊上傳橫幅圖片',
    help:
      '支援 JPG / PNG / WebP / GIF（動態 WebP・GIF 會循環播放），建議 1200x400；靜態最大 2MB、動態最大 5MB',
    remove: '移除橫幅',

    videoTitle: '橫幅影片（選填）',
    videoUpload: '上傳影片',
    videoRemove: '移除影片',
    videoHelpLead: '支援 MP4 / MOV，最大 80MB（約可放 30 秒~1 分鐘）。影片顯示在公開頁橫幅',
    videoHelpStrong1: '下方的獨立區塊',
    videoHelpMiddle: '，進站',
    videoHelpStrong2: '自動靜音循環播放',
    videoHelpTail: '。建議橫幅圖也一起設作為封面。',
    videoSound: '顧客互動後自動開啟聲音（關閉＝永遠靜音，顧客可自行按影片喇叭鈕開聲）',
    videoSoundNote:
      '⚠️ 瀏覽器規定「顧客零互動不能有聲」，故無論如何進站當下都是靜音，顧客碰一下螢幕才會開聲（此為三大瀏覽器鐵則，所有網站皆然）。',

    announcementTitle: '公告文字',
    announcementPlaceholder: '例如：本週特惠活動進行中！',
    announcementHelp: '公告會顯示在頁面頂部，留空則不顯示',
  },

  /* --------------------------------------------------------- 關於我們 */
  about: {
    cardTitle: '關於我們',
    cardDesc: '向顧客介紹你的店家故事、理念與特色',
    titleLabel: '標題',
    titlePlaceholder: '例如：關於我們',
    contentLabel: '內容',
    contentPlaceholder: '分享你的店家故事...',
    contentMax: 2000,
    imageLabel: '介紹圖片',
    imageUploadPrompt: '點擊上傳圖片',
    imageHelp: '建議 800x600，最大 2MB',
    imageRemove: '移除圖片',
  },

  /* --------------------------------------------------------- 圖片展示 */
  gallery: {
    cardTitle: '圖片展示',
    cardDesc: '上傳店家環境、作品或活動照片（最多 9 張）',
    max: 9,
    counter: (used: number, max: number) => `${used}/${max}`,
    add: '新增圖片',
    caption: '圖片說明',
    delete: '刪除',
    emptyTitle: '尚未新增圖片',
    emptyDescription: '上傳店家環境、作品或活動照片，最多 9 張，可拖曳調整順序。',
    notAddedYet: (max: number) => `尚未新增（0 / ${max}）`,
    uploading: '上傳中…',
  },

  /* --------------------------------------------------------- 主題外觀 */
  theme: {
    cardTitle: '主題外觀',
    cardDesc: '選擇主題色，讓頁面更有品牌感',
    colorLabel: '主題色',
    reset: '重置',
    defaultPalette: '預設配色',
  },

  /* --------------------------------------------------------- 社群連結 */
  social: {
    cardTitle: '社群連結',
    cardDesc: '填入社群連結，讓顧客更容易找到你',
    facebook: 'Facebook',
    facebookPlaceholder: 'https://facebook.com/你的粉專',
    instagram: 'Instagram',
    instagramPlaceholder: 'https://instagram.com/你的帳號',
    line: 'LINE 官方帳號',
    linePlaceholder: 'https://line.me/R/ti/p/@你的帳號',
    lineDetectedLead: '偵測到已連接 LINE Bot，',
    lineDetectedLink: '點此自動填入連結',
    lineDetectedTail: '（填入後可自行修改）',
    threads: 'Threads',
    threadsPlaceholder: 'https://threads.net/@你的帳號',
    googleMaps: 'Google Maps',
    googleMapsPlaceholder: 'https://maps.google.com/...',
    email: 'Email',
    emailPlaceholder: 'your@company.com',
  },

  /* --------------------------------------------------------- 確認訊息 */
  confirm: {
    deleteImageTitle: '刪除圖片',
    deleteImage: '確定要刪除這張圖片？',
  },

  /* --------------------------------------------------------------- 訊息 */
  messages: {
    saved: '設定已儲存',
    saveFailed: '儲存失敗',
    loadFailed: '載入設定失敗',
    /**
     * ⚠️ 這兩則只改畫面上的草稿，要按右上角「儲存」才會寫進
     * `tenant_settings.branding`。原文「圖片已新增／圖片已刪除」講得像已經生效，
     * 但同一頁其他欄位（店名、公告…）改了都不會跳訊息，唯獨相簿跳，
     * 使用者很容易以為相簿是即時存的、其他是要按儲存的。改成講清楚時機。
     */
    imageAdded: '已加入相簿清單，按「儲存」後才會生效',
    imageDeleted: '已從相簿清單移除，按「儲存」後才會生效',
    imageTooLargePrefix: '圖片大小不可超過 ',
    imageTooLarge2mb: '圖片大小不可超過 2MB',
    imageUnreadable: '圖片無法讀取（可能是 HEIC 格式，請改存成 JPG/PNG 再上傳）',
    imageReadFailed: '讀取圖片失敗',
    imageReadFailedRetry: '讀取圖片失敗，請重試或換一張',
    galleryMax: '最多 9 張圖片',
    orderUpdated: '順序已更新',
    reorderFailed: '排序失敗',
    createFailed: '新增失敗',
    updateFailed: '更新失敗',
    deleteFailed: '刪除失敗',
    removeFailed: '移除失敗',
    clearFailed: '清除失敗',
    confirmFailed: '確認失敗',
    videoUploaded: '影片已上傳',
    videoRemoved: '影片已移除',
    videoUploadFailed: '影片上傳失敗',
    videoFormat: '影片只支援 MP4 / MOV 格式',
    videoTooLarge: '影片大小不可超過 80MB（手機拍攝請選較短或較低畫質）',
    lineLinkFilled: '已填入 LINE 連結，請確認後儲存',
    lineLinkFailed: '取得 LINE 連結失敗',
    lineLinkMissing: '無法取得 LINE 連結',
    presignFailed: '取得上傳網址失敗',
    r2FailedPrefix: '上傳到 R2 失敗（HTTP ',
    r2FailedSuffix: '），請確認 R2 CORS 設定',
    networkError: '連線錯誤，請稍後再試',
    unknownError: '未知錯誤',
  },
} as const;
