/**
 * src/server/demo-seed.ts — 新店家的示範資料（依業態）
 *
 * 需求：新註冊的店家一進後台不該是全空白，要照他選的業態先鋪好可以直接看、
 * 直接改的範例；同時首頁要有「一鍵清空」讓他把示範資料整批移除，換成自己的。
 *
 * 兩個設計重點：
 *
 * 1. **示範資料要標記得出來**，清空才不會誤刪店家自己建的東西。做法是在每一筆
 *    的文字欄位塞 DEMO_TAG 前綴（`[示範]`）——不加欄位、不動 migration，
 *    清空時以該前綴比對即可。之所以不另開 `is_demo` 欄位：這批資料的定位是
 *    「可以直接改成自己的」，一旦店家改了名字它就不該再被當成示範資料清掉，
 *    用名稱前綴剛好有這個語意（改掉前綴 = 認養這筆資料）。
 *
 * 2. **業態決定內容**：嚮導模式的「服務」其實是行程（trips + trip_plans），
 *    與商店/診所的 services 是兩套不同的庫存模型（CLAUDE.md 明訂不可合併），
 *    因此這裡分開產生，而不是把同一批資料換個名字。
 */
import { createAdminSupabase } from './supabase';
import type { BusinessType } from '@/config/modes';

/** 示範資料的識別前綴；一鍵清空以此比對。 */
export const DEMO_TAG = '[示範]';

const tag = (s: string) => `${DEMO_TAG} ${s}`;

/* ---------------------------------------------------------------- 服務／行程 */

/** 商店 / 診所：三個示範服務。 */
const SERVICES: Record<'LOCAL_SHOP' | 'CLINIC', Array<{
  name: string; description: string; durationMinutes: number; price: number;
}>> = {
  LOCAL_SHOP: [
    { name: '洗剪吹', description: '洗髮、精剪、造型吹整', durationMinutes: 60, price: 800 },
    { name: '染髮（單色）', description: '含護髮，長髮酌收', durationMinutes: 120, price: 2200 },
    { name: '頭皮深層護理', description: '去角質＋按摩，改善出油', durationMinutes: 45, price: 1200 },
  ],
  CLINIC: [
    { name: '初診諮詢', description: '病史詢問與基礎檢查', durationMinutes: 30, price: 500 },
    { name: '複診追蹤', description: '療程效果評估與調整', durationMinutes: 20, price: 300 },
    { name: '健康檢查（基礎）', description: '抽血、血壓、身體組成', durationMinutes: 60, price: 3500 },
  ],
};

/**
 * 嚮導：三個示範行程，每個帶一個方案。
 * 方案刻意帶 planItinerary（每站可放照片），示範這個與 tour-platform 對齊的欄位。
 */
const TRIPS = [
  {
    title: '柴山半日健行',
    tagline: '走進高雄人的後花園',
    summary: '難度親民的市區近郊路線，適合第一次爬山的旅客。',
    region: '高雄市',
    category: 'mountain',
    durationMinutes: 240,
    meetingPoint: '柴山登山口（龍泉寺）',
    inclusions: ['專業嚮導帶隊', '保險', '礦泉水一瓶'],
    exclusions: ['個人裝備', '往返交通'],
    plan: {
      name: '標準團（每人計價）',
      basePrice: 1200,
      durationMinutes: 240,
      minParticipants: 2,
      maxParticipants: 10,
      highlights: ['小溪貝塚地質解說', '獼猴生態觀察', '登高望港灣'],
      planItinerary: [
        { icon: '🚩', title: '龍泉寺集合', duration: '約 15 分鐘', description: '裝備檢查與行前說明', imageUrl: '' },
        { icon: '🥾', title: '雅座步道', duration: '約 90 分鐘', description: '沿途地質與植物解說', imageUrl: '' },
        { icon: '🐒', title: '獼猴觀察點', duration: '約 40 分鐘', description: '安全距離觀察與拍照', imageUrl: '' },
        { icon: '🌅', title: '小坪頂眺望', duration: '約 30 分鐘', description: '俯瞰高雄港與市區', imageUrl: '' },
      ],
    },
  },
  {
    title: '愛河夜間獨木舟',
    tagline: '從水面看城市燈火',
    summary: '零經驗可參加，教練全程隨行的城市水上體驗。',
    region: '高雄市',
    category: 'river',
    durationMinutes: 120,
    meetingPoint: '愛河之心碼頭',
    inclusions: ['獨木舟與槳', '救生衣', '防水袋', '教練指導'],
    exclusions: ['交通', '個人替換衣物'],
    plan: {
      name: '雙人舟（每團計價）',
      basePrice: 2400,
      durationMinutes: 120,
      minParticipants: 2,
      maxParticipants: 2,
      highlights: ['夜景航線', '教練隨行', '免經驗'],
      planItinerary: [
        { icon: '🦺', title: '岸上教學', duration: '約 20 分鐘', description: '槳法與安全須知', imageUrl: '' },
        { icon: '🛶', title: '愛河下水', duration: '約 70 分鐘', description: '沿河道緩航，欣賞兩岸燈光', imageUrl: '' },
        { icon: '📸', title: '拍照與返航', duration: '約 30 分鐘', description: '定點拍照後回到碼頭', imageUrl: '' },
      ],
    },
  },
  {
    title: '左營舊城文化導覽',
    tagline: '走一圈三百年的城牆',
    summary: '從東門到北門，聽這座城的故事。',
    region: '高雄市',
    category: 'culture',
    durationMinutes: 180,
    meetingPoint: '鳳山縣舊城東門',
    inclusions: ['導覽解說', '導覽耳機', '保險'],
    exclusions: ['餐食', '交通'],
    plan: {
      name: '小團導覽（每人計價）',
      basePrice: 800,
      durationMinutes: 180,
      minParticipants: 4,
      maxParticipants: 12,
      highlights: ['現存最完整的清代城池', '在地文史工作者帶路', '含蓮池潭步行'],
      planItinerary: [
        { icon: '🏯', title: '東門集合', duration: '約 20 分鐘', description: '舊城的興建背景', imageUrl: '' },
        { icon: '🧱', title: '城牆步道', duration: '約 60 分鐘', description: '沿牆走訪礮台與馬道', imageUrl: '' },
        { icon: '⛩️', title: '北門與鎮福社', duration: '約 50 分鐘', description: '門神彩繪與信仰空間', imageUrl: '' },
        { icon: '🌊', title: '蓮池潭', duration: '約 50 分鐘', description: '龍虎塔與潭畔廟宇群', imageUrl: '' },
      ],
    },
  },
];

/**
 * 三種業態共用：一位示範員工（職稱用該業態的稱呼，對應 MODE_PRESETS.staffTerm）。
 * staff 表沒有 bio 欄位（只有 name/phone/email/title/avatar_url…），因此不放簡介。
 */
const STAFF_BY_MODE: Record<BusinessType, { name: string; title: string }> = {
  LOCAL_SHOP: { name: '王小美', title: '資深設計師' },
  GUIDE: { name: '李阿明', title: '特約嚮導' },
  CLINIC: { name: '陳大文', title: '主治醫師' },
};

/** 三種業態共用：三個示範商品。 */
const PRODUCTS_BY_MODE: Record<BusinessType, Array<{
  name: string; description: string; price: number; stock: number;
}>> = {
  LOCAL_SHOP: [
    { name: '洗髮精（500ml）', description: '溫和胺基酸配方', price: 680, stock: 20 },
    { name: '護髮油', description: '免沖洗，抗毛躁', price: 880, stock: 15 },
    { name: '寬齒梳', description: '濕髮適用', price: 280, stock: 30 },
  ],
  GUIDE: [
    { name: '登山杖（單支）', description: '鋁合金三節伸縮', price: 900, stock: 10 },
    { name: '防水袋 10L', description: '溯溪、獨木舟適用', price: 450, stock: 25 },
    { name: '在地手繪地圖', description: '嚮導私房路線圖', price: 150, stock: 50 },
  ],
  CLINIC: [
    { name: '綜合維他命（60 錠）', description: '每日一錠', price: 800, stock: 40 },
    { name: '醫療級口罩（50 入）', description: '雙鋼印', price: 250, stock: 60 },
    { name: '電子體溫計', description: '額溫、耳溫兩用', price: 1200, stock: 12 },
  ],
};

/* ---------------------------------------------------------------- 產生列 */

export function demoStaffRow(tenantId: string, businessType: BusinessType) {
  const s = STAFF_BY_MODE[businessType];
  return {
    tenant_id: tenantId,
    name: tag(s.name),
    title: s.title,
    active: true,
    bookable: true,
    sort_order: 0,
  };
}

export function demoProductRows(tenantId: string, businessType: BusinessType) {
  return PRODUCTS_BY_MODE[businessType].map((p, i) => ({
    tenant_id: tenantId,
    name: tag(p.name),
    description: p.description,
    price: p.price,
    stock: p.stock,
    active: true,
    sort_order: i,
  }));
}

export function demoServiceRows(tenantId: string, businessType: 'LOCAL_SHOP' | 'CLINIC') {
  return SERVICES[businessType].map((s, i) => ({
    tenant_id: tenantId,
    name: tag(s.name),
    description: s.description,
    duration_minutes: s.durationMinutes,
    price: s.price,
    active: true,
    sort_order: i,
  }));
}

/** 嚮導模式：回傳 [{ trip 列, plan 列（缺 trip_id，插入後補）}]。 */
export function demoTripRows(tenantId: string) {
  return TRIPS.map((t, i) => ({
    trip: {
      tenant_id: tenantId,
      slug: `demo-trip-${i + 1}`,
      title: tag(t.title),
      tagline: t.tagline,
      summary: t.summary,
      description: '',
      region: t.region,
      category: t.category,
      duration_minutes: t.durationMinutes,
      meeting_point: t.meetingPoint,
      inclusions: t.inclusions,
      exclusions: t.exclusions,
      status: 'DRAFT' as const,
    },
    plan: {
      tenant_id: tenantId,
      slug: `demo-plan-${i + 1}`,
      name: t.plan.name,
      duration_minutes: t.plan.durationMinutes,
      price_type: t.plan.maxParticipants === 2 ? 'PER_GROUP' : 'PER_PERSON',
      base_price: t.plan.basePrice,
      min_participants: t.plan.minParticipants,
      max_participants: t.plan.maxParticipants,
      booking_type: 'REQUEST',
      highlights: t.plan.highlights,
      plan_itinerary: t.plan.planItinerary,
      active: true,
      sort_order: 0,
    },
  }));
}

/* ---------------------------------------------------------------- 寫入 */

/**
 * 依業態鋪示範資料。
 *
 * 用 service role：這支同時被註冊流程呼叫，而註冊當下使用者的 session cookie
 * 還沒建立（鐵則 7 允許 auth 註冊流程使用 service role）。
 */
export async function seedDemoData(tenantId: string, businessType: BusinessType) {
  const admin = createAdminSupabase();

  if (businessType === 'GUIDE') {
    // 嚮導：行程 + 方案。services 表不是嚮導的庫存模型（CLAUDE.md 明訂兩者
    // 是不同的資料模型、不可合併），因此嚮導不鋪 services。
    for (const { trip, plan } of demoTripRows(tenantId)) {
      const { data, error } = await admin.from('trips').insert(trip).select('id').single();
      if (error) throw error;
      const { error: perr } = await admin.from('trip_plans')
        .insert({ ...plan, trip_id: data.id });
      if (perr) throw perr;
    }
  } else {
    const { error } = await admin.from('services')
      .insert(demoServiceRows(tenantId, businessType));
    if (error) throw error;
  }

  const { error: serr } = await admin.from('staff').insert(demoStaffRow(tenantId, businessType));
  if (serr) throw serr;

  const { error: perr } = await admin.from('products')
    .insert(demoProductRows(tenantId, businessType));
  if (perr) throw perr;
}
