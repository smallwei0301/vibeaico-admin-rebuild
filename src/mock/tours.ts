/**
 * Mock 資料 — 導遊模組（行程 / 方案 / 團次 / 加購 / 旅遊訂單）
 * 骨架模式專用；換真實後端時整包可刪。資料以「祕島嚮導」情境撰寫，
 * 刻意涵蓋各種狀態組合（草稿、Midao 審核中、已退回、方案送審、額滿團次…），
 * 方便一眼檢視所有 UI 狀態。
 */
import type {
  Trip, TripAddon, TripDeparture, TripPlan, TourOrder,
} from '@/lib/types';

/* ------------------------------------------------------------------ 行程 */
export const MOCK_TRIPS: Trip[] = [
  {
    id: 'tp_1',
    slug: 'turtle-island-whale',
    title: '龜山島賞鯨半日遊',
    tagline: '跟著在地船長，找到那群飛旋海豚',
    summary: '從烏石港出發，繞行龜山島並尋找鯨豚蹤跡，全程約 3 小時，適合親子同行。',
    description:
      '08:30 烏石港遊客中心集合，導覽當日海況與注意事項\n'
      + '09:00 登船出發，沿途解說龜山島地質與火山口地形\n'
      + '09:40 進入鯨豚熱區，尋找飛旋海豚與熱帶斑海豚\n'
      + '11:00 繞島一周，經過牛奶海與硫磺噴氣孔\n'
      + '11:30 返港，導遊協助拍照與行程回顧',
    region: '宜蘭 頭城',
    category: '海上活動',
    coverImageUrl: '',
    galleryUrls: [],
    meetingPoint: '烏石港遊客中心大門口',
    meetingPointMapUrl: 'https://maps.example.com/wushi',
    inclusions: ['船票與港口清潔費', '專業導覽解說', '救生衣與保險', '礦泉水一瓶'],
    exclusions: ['個人消費', '往返烏石港交通', '暈船藥'],
    notices: ['出發前 30 分鐘完成報到', '海況不佳時將協助改期或全額退費', '孕婦與 3 歲以下幼兒不建議參加'],
    safetyNotice: '全程須著救生衣，聽從船長與導遊指示。',
    refundPolicyType: 'STANDARD',
    status: 'PUBLISHED',
    midaoListing: 'LISTED',
    midaoListingNote: '',
    planCount: 3,
    upcomingDepartureCount: 12,
    minPrice: 1280,
    updatedAt: '2026-08-18T09:12:00+08:00',
  },
  {
    id: 'tp_2',
    slug: 'jiufen-night-walk',
    title: '九份山城夜訪散策',
    tagline: '避開人潮，走一趟只有在地人知道的巷弄',
    summary: '傍晚出發，避開觀光人潮，走訪豎崎路旁的靜巷與老茶館，含一杯特色茶飲。',
    description:
      '16:30 九份老街入口集合\n'
      + '17:00 走訪輕便路與廢棄礦坑遺址，聊聊金瓜石的採金歲月\n'
      + '18:30 登上少人知道的觀景平台，等待華燈初上\n'
      + '19:30 老茶館歇腳，附一壺東方美人茶\n'
      + '20:30 行程結束，可自由續留老街',
    region: '新北 瑞芳',
    category: '文化導覽',
    coverImageUrl: '',
    galleryUrls: [],
    meetingPoint: '九份老街入口 7-11 前',
    meetingPointMapUrl: '',
    inclusions: ['專業導覽解說', '老茶館茶飲一份', '旅遊平安保險'],
    exclusions: ['交通接駁', '個人餐食'],
    notices: ['山區日夜溫差大，建議攜帶薄外套', '全程步行約 3 公里，請穿好走的鞋'],
    safetyNotice: '部分路段階梯陡峭，行動不便者請事先告知。',
    refundPolicyType: 'FLEXIBLE',
    status: 'PUBLISHED',
    midaoListing: 'PENDING',
    midaoListingNote: '',
    planCount: 2,
    upcomingDepartureCount: 8,
    minPrice: 890,
    updatedAt: '2026-08-19T16:40:00+08:00',
  },
  {
    id: 'tp_3',
    slug: 'hualien-river-tracing',
    title: '花蓮砂婆礑溯溪體驗',
    tagline: '清澈見底的秘境溪谷，一日往返',
    summary: '專業教練帶隊的入門溯溪路線，含全套裝備，未接觸過溯溪也能參加。',
    description: '含裝備配戴教學、溪谷地形解說、天然滑水道體驗與跳水點（可選）。',
    region: '花蓮 秀林',
    category: '山林探索',
    coverImageUrl: '',
    galleryUrls: [],
    meetingPoint: '花蓮火車站前廣場',
    meetingPointMapUrl: '',
    inclusions: ['溯溪鞋、頭盔、防寒衣全套裝備', '專業教練帶隊', '高山嚮導責任險', '行動糧與飲水'],
    exclusions: ['個人保險加保', '午餐'],
    notices: ['需自備泳衣與替換衣物', '雨季溪水暴漲時將取消並全額退費'],
    safetyNotice: '每 6 人配置 1 名教練，未滿 12 歲不開放參加。',
    refundPolicyType: 'STRICT',
    status: 'PUBLISHED',
    midaoListing: 'REJECTED',
    midaoListingNote: '請補上教練證照資訊與保險額度說明，並將封面照片換成清楚呈現溪谷的橫幅照片。',
    planCount: 2,
    upcomingDepartureCount: 5,
    minPrice: 2200,
    updatedAt: '2026-08-20T11:05:00+08:00',
  },
  {
    id: 'tp_4',
    slug: 'tainan-breakfast-tour',
    title: '台南早餐吃透透',
    tagline: '',
    summary: '',
    description: '',
    region: '台南 中西區',
    category: '美食體驗',
    coverImageUrl: '',
    galleryUrls: [],
    meetingPoint: '',
    meetingPointMapUrl: '',
    inclusions: [],
    exclusions: [],
    notices: [],
    safetyNotice: '',
    refundPolicyType: 'STANDARD',
    status: 'DRAFT',
    midaoListing: 'NONE',
    midaoListingNote: '',
    planCount: 1,
    upcomingDepartureCount: 0,
    minPrice: 680,
    updatedAt: '2026-08-21T08:30:00+08:00',
  },
];

/* ------------------------------------------------------------------ 方案 */
export const MOCK_TRIP_PLANS: TripPlan[] = [
  {
    id: 'pl_1', tripId: 'tp_1', name: '標準團（共乘）',
    description: '與其他旅客共乘一艘船，最經濟的選擇。',
    durationMinutes: 180, priceType: 'PER_PERSON', basePrice: 1280, childPrice: 980,
    minParticipants: 1, maxParticipants: 8, bookingType: 'SCHEDULED',
    depositMode: 'FULL', depositValue: 0,
    active: true, yearRound: false,
    seasons: [
      { id: 'ss_1', name: '賞鯨旺季', startMonth: 4, startDay: 1, endMonth: 9, endDay: 30, priceOverride: null, active: true },
      { id: 'ss_2', name: '淡季優惠', startMonth: 10, startDay: 1, endMonth: 11, endDay: 30, priceOverride: 980, active: true },
    ],
    reviewState: 'NONE', reviewNote: '', sortOrder: 1,
  },
  {
    id: 'pl_2', tripId: 'tp_1', name: '包船專案',
    description: '整艘船只有你們一行人，可調整航線與出發時間。',
    durationMinutes: 240, priceType: 'PER_GROUP', basePrice: 18000, childPrice: null,
    minParticipants: 4, maxParticipants: 20, bookingType: 'REQUEST',
    depositMode: 'DEPOSIT_FIXED', depositValue: 5000,
    active: true, yearRound: true, seasons: [],
    reviewState: 'PENDING', reviewNote: '', sortOrder: 2,
  },
  {
    id: 'pl_3', tripId: 'tp_1', name: '攝影特別團',
    description: '延長停留在鯨豚熱區的時間，適合帶長焦鏡頭的旅客。',
    durationMinutes: 240, priceType: 'PER_PERSON', basePrice: 2480, childPrice: null,
    minParticipants: 2, maxParticipants: 6, bookingType: 'SCHEDULED',
    depositMode: 'FULL', depositValue: 0,
    active: false, yearRound: true, seasons: [],
    reviewState: 'CHANGES_REQUESTED',
    reviewNote: '售價高於同類方案 2 倍，請補充方案差異說明，或調整為合理級距。',
    sortOrder: 3,
  },
  {
    id: 'pl_4', tripId: 'tp_2', name: '小團導覽（4 人成行）',
    description: '', durationMinutes: 240, priceType: 'PER_PERSON', basePrice: 890, childPrice: 690,
    minParticipants: 2, maxParticipants: 10, bookingType: 'SCHEDULED',
    depositMode: 'FULL', depositValue: 0,
    active: true, yearRound: true, seasons: [],
    reviewState: 'NONE', reviewNote: '', sortOrder: 1,
  },
  {
    id: 'pl_5', tripId: 'tp_2', name: '私人包團',
    description: '可指定日期與集合地點。', durationMinutes: 240,
    priceType: 'PER_GROUP', basePrice: 6800, childPrice: null,
    minParticipants: 2, maxParticipants: 8, bookingType: 'REQUEST',
    depositMode: 'DEPOSIT_PERCENT', depositValue: 30,
    active: true, yearRound: true, seasons: [],
    reviewState: 'NONE', reviewNote: '', sortOrder: 2,
  },
  {
    id: 'pl_6', tripId: 'tp_3', name: '一日溯溪體驗',
    description: '', durationMinutes: 420, priceType: 'PER_PERSON', basePrice: 2200, childPrice: null,
    minParticipants: 2, maxParticipants: 12, bookingType: 'SCHEDULED',
    depositMode: 'DEPOSIT_FIXED', depositValue: 500,
    active: true, yearRound: false,
    seasons: [
      { id: 'ss_3', name: '溯溪季', startMonth: 5, startDay: 1, endMonth: 10, endDay: 15, priceOverride: null, active: true },
    ],
    reviewState: 'NONE', reviewNote: '', sortOrder: 1,
  },
  {
    id: 'pl_7', tripId: 'tp_3', name: '包團（含接送）',
    description: '花蓮市區飯店來回接送。', durationMinutes: 480,
    priceType: 'PER_GROUP', basePrice: 24000, childPrice: null,
    minParticipants: 4, maxParticipants: 12, bookingType: 'REQUEST',
    depositMode: 'DEPOSIT_PERCENT', depositValue: 50,
    active: true, yearRound: false,
    seasons: [
      { id: 'ss_4', name: '溯溪季', startMonth: 5, startDay: 1, endMonth: 10, endDay: 15, priceOverride: null, active: true },
    ],
    reviewState: 'NONE', reviewNote: '', sortOrder: 2,
  },
  {
    id: 'pl_8', tripId: 'tp_4', name: '經典早餐路線',
    description: '', durationMinutes: 150, priceType: 'PER_PERSON', basePrice: 680, childPrice: null,
    minParticipants: 2, maxParticipants: 8, bookingType: 'INSTANT',
    depositMode: 'NONE', depositValue: 0,
    active: true, yearRound: true, seasons: [],
    reviewState: 'NONE', reviewNote: '', sortOrder: 1,
  },
];

/* ------------------------------------------------------------------ 團次 */
export const MOCK_TRIP_DEPARTURES: TripDeparture[] = [
  { id: 'dp_1', tripId: 'tp_1', planId: 'pl_1', planName: '標準團（共乘）', departsOn: '2026-08-23', startTime: '09:00', capacity: 8, seatsBooked: 8, status: 'OPEN', note: '' },
  { id: 'dp_2', tripId: 'tp_1', planId: 'pl_1', planName: '標準團（共乘）', departsOn: '2026-08-24', startTime: '09:00', capacity: 8, seatsBooked: 5, status: 'OPEN', note: '' },
  { id: 'dp_3', tripId: 'tp_1', planId: 'pl_1', planName: '標準團（共乘）', departsOn: '2026-08-25', startTime: '09:00', capacity: 8, seatsBooked: 2, status: 'OPEN', note: '船班已確認' },
  { id: 'dp_4', tripId: 'tp_1', planId: 'pl_1', planName: '標準團（共乘）', departsOn: '2026-08-26', startTime: '13:30', capacity: 8, seatsBooked: 0, status: 'OPEN', note: '' },
  { id: 'dp_5', tripId: 'tp_1', planId: 'pl_3', planName: '攝影特別團', departsOn: '2026-08-27', startTime: '06:00', capacity: 6, seatsBooked: 1, status: 'CLOSED', note: '方案審核中暫停銷售' },
  { id: 'dp_6', tripId: 'tp_1', planId: 'pl_1', planName: '標準團（共乘）', departsOn: '2026-08-28', startTime: '09:00', capacity: 8, seatsBooked: 0, status: 'CANCELLED', note: '颱風假' },
  { id: 'dp_7', tripId: 'tp_2', planId: 'pl_4', planName: '小團導覽（4 人成行）', departsOn: '2026-08-23', startTime: '16:30', capacity: 10, seatsBooked: 6, status: 'OPEN', note: '' },
  { id: 'dp_8', tripId: 'tp_2', planId: 'pl_4', planName: '小團導覽（4 人成行）', departsOn: '2026-08-30', startTime: '16:30', capacity: 10, seatsBooked: 3, status: 'OPEN', note: '' },
  { id: 'dp_9', tripId: 'tp_3', planId: 'pl_6', planName: '一日溯溪體驗', departsOn: '2026-08-24', startTime: '08:00', capacity: 12, seatsBooked: 9, status: 'OPEN', note: '' },
  { id: 'dp_10', tripId: 'tp_3', planId: 'pl_6', planName: '一日溯溪體驗', departsOn: '2026-08-31', startTime: '08:00', capacity: 12, seatsBooked: 0, status: 'OPEN', note: '' },
];

/* ------------------------------------------------------------------ 加購 */
export const MOCK_TRIP_ADDONS: TripAddon[] = [
  { id: 'ad_1', tripId: 'tp_1', name: '專業攝影紀錄（含 30 張精修）', price: 1500, unit: 'PER_GROUP', stock: 2, active: true, sortOrder: 1 },
  { id: 'ad_2', tripId: 'tp_1', name: '暈船藥', price: 50, unit: 'PER_PERSON', stock: null, active: true, sortOrder: 2 },
  { id: 'ad_3', tripId: 'tp_1', name: '烏石港接駁（羅東車站往返）', price: 200, unit: 'PER_PERSON', stock: 8, active: false, sortOrder: 3 },
  { id: 'ad_4', tripId: 'tp_2', name: '茶點升級套餐', price: 180, unit: 'PER_PERSON', stock: null, active: true, sortOrder: 1 },
  { id: 'ad_5', tripId: 'tp_3', name: '防水袋租借', price: 100, unit: 'PER_PERSON', stock: 20, active: true, sortOrder: 1 },
];

/* ------------------------------------------------------------- 旅遊訂單 */
export const MOCK_TOUR_ORDERS: TourOrder[] = [
  {
    id: 'to_1', orderNo: 'T2608210001', tripId: 'tp_1', tripTitle: '龜山島賞鯨半日遊',
    planName: '標準團（共乘）', departsOn: '2026-08-24', startTime: '09:00',
    customerName: '陳彥廷', customerPhone: '0912-345-678', partySize: 2,
    unitPrice: 1280, totalAmount: 2560, depositAmount: 0, status: 'PENDING', paymentStatus: 'UNPAID',
    paymentMethodLabel: '國泰世華銀行轉帳', paymentRef: '', source: 'MIDAO',
    holdExpiresAt: '2026-08-24T23:59:00+08:00', note: '希望坐船艙外面',
    createdAt: '2026-08-21T09:14:00+08:00',
  },
  {
    id: 'to_2', orderNo: 'T2608200008', tripId: 'tp_1', tripTitle: '龜山島賞鯨半日遊',
    planName: '標準團（共乘）', departsOn: '2026-08-23', startTime: '09:00',
    customerName: '林巧薇', customerPhone: '0922-118-903', partySize: 4,
    unitPrice: 1280, totalAmount: 5120, depositAmount: 0, status: 'CONFIRMED', paymentStatus: 'PAID',
    paymentMethodLabel: '線上刷卡付款', paymentRef: 'ECPay 2608200008771',
    source: 'VIBEAI_SHOP', holdExpiresAt: null, note: '',
    createdAt: '2026-08-20T20:31:00+08:00',
  },
  {
    id: 'to_3', orderNo: 'T2608200005', tripId: 'tp_2', tripTitle: '九份山城夜訪散策',
    planName: '小團導覽（4 人成行）', departsOn: '2026-08-23', startTime: '16:30',
    customerName: '吳孟儒', customerPhone: '0955-620-114', partySize: 2,
    unitPrice: 890, totalAmount: 1780, depositAmount: 0, status: 'CONFIRMED', paymentStatus: 'PAID',
    paymentMethodLabel: '國泰世華銀行轉帳', paymentRef: '後五碼 33914',
    source: 'LINE', holdExpiresAt: null, note: '從 LINE 詢問後改期一次',
    createdAt: '2026-08-20T14:02:00+08:00',
  },
  {
    id: 'to_4', orderNo: 'T2608190012', tripId: 'tp_3', tripTitle: '花蓮砂婆礑溯溪體驗',
    planName: '一日溯溪體驗', departsOn: '2026-08-24', startTime: '08:00',
    customerName: '黃思穎', customerPhone: '0987-441-256', partySize: 5,
    unitPrice: 2200, totalAmount: 11000, depositAmount: 0, status: 'CONFIRMED', paymentStatus: 'PAID',
    paymentMethodLabel: '線上刷卡付款', paymentRef: 'ECPay 2608190012043',
    source: 'MIDAO', holdExpiresAt: null, note: '團體中有兩位第一次溯溪',
    createdAt: '2026-08-19T11:47:00+08:00',
  },
  {
    id: 'to_5', orderNo: 'T2608180003', tripId: 'tp_1', tripTitle: '龜山島賞鯨半日遊',
    planName: '包船專案', departsOn: '2026-08-22', startTime: '09:00',
    customerName: '張家豪', customerPhone: '0933-702-889', partySize: 12,
    unitPrice: 18000, totalAmount: 18000, depositAmount: 5000, status: 'CONFIRMED', paymentStatus: 'PAID',
    paymentMethodLabel: '國泰世華銀行轉帳', paymentRef: '後五碼 88210',
    source: 'MANUAL', holdExpiresAt: null, note: '公司員工旅遊，需要統編發票',
    createdAt: '2026-08-18T10:20:00+08:00',
  },
  {
    id: 'to_6', orderNo: 'T2608150019', tripId: 'tp_2', tripTitle: '九份山城夜訪散策',
    planName: '私人包團', departsOn: '2026-08-16', startTime: '16:30',
    customerName: '李宛儒', customerPhone: '0966-330-771', partySize: 6,
    unitPrice: 6800, totalAmount: 6800, depositAmount: 0, status: 'COMPLETED', paymentStatus: 'PAID',
    paymentMethodLabel: '線上刷卡付款', paymentRef: 'ECPay 2608150019556',
    source: 'VIBEAI_SHOP', holdExpiresAt: null, note: '',
    createdAt: '2026-08-15T09:05:00+08:00',
  },
  {
    id: 'to_7', orderNo: 'T2608140002', tripId: 'tp_1', tripTitle: '龜山島賞鯨半日遊',
    planName: '標準團（共乘）', departsOn: '2026-08-15', startTime: '09:00',
    customerName: '鄭立群', customerPhone: '0911-208-664', partySize: 3,
    unitPrice: 1280, totalAmount: 3840, depositAmount: 0, status: 'CANCELLED', paymentStatus: 'REFUNDED',
    paymentMethodLabel: '線上刷卡付款', paymentRef: 'ECPay 2608140002119',
    source: 'MIDAO', holdExpiresAt: null, note: '因海況取消，已全額退款',
    createdAt: '2026-08-14T16:38:00+08:00',
  },
];
