import { describe, it, expect } from 'vitest';
import {
  mapBooking,
  mapCustomer,
  mapService,
  mapStaff,
  mapProduct,
  mapProductOrder,
  mapCoupon,
  mapMembershipLevel,
  mapPointTransaction,
  mapStaffPerformance,
  mapTenantSummary,
} from '@/server/mappers';

/* ------------------------------------------------------------------ Booking */
// 01 分冊 §5.5 的範例，照抄驗證。
describe('mapBooking (01 §5.5)', () => {
  it('snake_case row → camelCase Booking，全欄位比對', () => {
    const row = {
      id: 'bk_1',
      booking_no: 'B2608220001',
      customer_id: 'c_1',
      customer_name: '王小明',
      customer_phone: '0912345678',
      service_id: 's_1',
      service_name: '臉部保養',
      staff_id: 'st_1',
      staff_name: '陳師傅',
      start_at: '2026-08-22T02:00:00Z',
      end_at: '2026-08-22T03:00:00Z',
      duration_minutes: 60,
      price: 1200,
      final_price: 1000,
      status: 'CONFIRMED',
      payment_status: 'PAID_ONLINE',
      source: 'LINE',
      note: '需要停車位',
      created_at: '2026-08-20T00:00:00Z',
    };
    expect(mapBooking(row)).toEqual({
      id: 'bk_1',
      bookingNo: 'B2608220001',
      customerId: 'c_1',
      customerName: '王小明',
      customerPhone: '0912345678',
      serviceId: 's_1',
      serviceName: '臉部保養',
      staffId: 'st_1',
      staffName: '陳師傅',
      startAt: '2026-08-22T02:00:00Z',
      endAt: '2026-08-22T03:00:00Z',
      durationMinutes: 60,
      price: 1200,
      finalPrice: 1000,
      status: 'CONFIRMED',
      paymentStatus: 'PAID_ONLINE',
      source: 'LINE',
      note: '需要停車位',
      createdAt: '2026-08-20T00:00:00Z',
    });
  });

  it('staff_id / staff_name 為 null（未指定員工）→ 保留 null', () => {
    const row = {
      id: 'bk_2', booking_no: 'B2608220002', customer_id: 'c_1', customer_name: '王小明',
      customer_phone: '0912345678', service_id: 's_1', service_name: '臉部保養',
      staff_id: null, staff_name: null,
      start_at: '2026-08-22T02:00:00Z', end_at: '2026-08-22T03:00:00Z', duration_minutes: 60,
      price: 1200, final_price: 1000, status: 'PENDING', payment_status: 'UNPAID', source: 'PUBLIC_PAGE',
      note: null, created_at: '2026-08-20T00:00:00Z',
    };
    const r = mapBooking(row);
    expect(r.staffId).toBeNull();
    expect(r.staffName).toBeNull();
    expect(r.note).toBe('');
  });
});

/* ------------------------------------------------------------------ Customer */
describe('mapCustomer (02 §0004 customers / customers_view)', () => {
  const fullRow = {
    id: 'c_1',
    name: '林美麗',
    phone: '0922333444',
    email: 'meili@example.com',
    gender: 'FEMALE',
    birthday: '1990-05-01',
    note: 'VIP 顧客',
    line_user_id: 'U1234567890',
    line_display_name: 'Meili L',
    membership_level_id: 'ml_1',
    membership_level_name: '金卡會員',
    tags: ['常客', '護膚'],
    points: 350,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    // customers_view 衍生欄位
    booking_count: 12,
    total_spent: 45600,
    last_visit_at: '2026-08-01T03:00:00Z',
    at_risk: false,
  };

  it('全欄位比對', () => {
    expect(mapCustomer(fullRow)).toEqual({
      id: 'c_1',
      name: '林美麗',
      phone: '0922333444',
      email: 'meili@example.com',
      gender: 'FEMALE',
      birthday: '1990-05-01',
      note: 'VIP 顧客',
      lineUserId: 'U1234567890',
      lineDisplayName: 'Meili L',
      membershipLevelId: 'ml_1',
      membershipLevelName: '金卡會員',
      tags: ['常客', '護膚'],
      bookingCount: 12,
      totalSpent: 45600,
      points: 350,
      lastVisitAt: '2026-08-01T03:00:00Z',
      atRisk: false,
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('gender null（未填）→ 空字串（gender_type enum 註解：空值以 null 表示，mapper 轉 \'\'）', () => {
    expect(mapCustomer({ ...fullRow, gender: null }).gender).toBe('');
  });

  it('birthday null → 空字串（types.ts 為非 null string）', () => {
    expect(mapCustomer({ ...fullRow, birthday: null }).birthday).toBe('');
  });

  it('note null → 空字串', () => {
    expect(mapCustomer({ ...fullRow, note: null }).note).toBe('');
  });

  it('phone / email null → 空字串', () => {
    const r = mapCustomer({ ...fullRow, phone: null, email: null });
    expect(r.phone).toBe('');
    expect(r.email).toBe('');
  });

  it('line_user_id / line_display_name null（未綁定 LINE）→ 保留 null', () => {
    const r = mapCustomer({ ...fullRow, line_user_id: null, line_display_name: null });
    expect(r.lineUserId).toBeNull();
    expect(r.lineDisplayName).toBeNull();
  });

  it('membership_level_id / membership_level_name null（未設會員等級）→ 保留 null', () => {
    const r = mapCustomer({ ...fullRow, membership_level_id: null, membership_level_name: null });
    expect(r.membershipLevelId).toBeNull();
    expect(r.membershipLevelName).toBeNull();
  });

  it('last_visit_at null（從未消費）→ 保留 null', () => {
    expect(mapCustomer({ ...fullRow, last_visit_at: null }).lastVisitAt).toBeNull();
  });

  it('tags null → 空陣列', () => {
    expect(mapCustomer({ ...fullRow, tags: null }).tags).toEqual([]);
  });
});

/* ------------------------------------------------------------- Service */
describe('mapService (02 §0004 services)', () => {
  const fullRow = {
    id: 's_1',
    category_id: 'sc_1',
    category_name: '臉部護理',
    name: '深層清潔facial',
    description: '適合油性肌膚',
    duration_minutes: 90,
    price: 1800,
    image_url: 'https://cdn.example.com/s_1.jpg',
    active: true,
    line_featured: true,
    sort_order: 1,
  };

  it('全欄位比對', () => {
    expect(mapService(fullRow)).toEqual({
      id: 's_1',
      categoryId: 'sc_1',
      categoryName: '臉部護理',
      name: '深層清潔facial',
      description: '適合油性肌膚',
      durationMinutes: 90,
      price: 1800,
      imageUrl: 'https://cdn.example.com/s_1.jpg',
      active: true,
      lineFeatured: true,
      sortOrder: 1,
    });
  });

  it('category_id / category_name null（未分類）→ 保留 null', () => {
    const r = mapService({ ...fullRow, category_id: null, category_name: null });
    expect(r.categoryId).toBeNull();
    expect(r.categoryName).toBeNull();
  });

  it('description / image_url null → 空字串', () => {
    const r = mapService({ ...fullRow, description: null, image_url: null });
    expect(r.description).toBe('');
    expect(r.imageUrl).toBe('');
  });
});

/* --------------------------------------------------------------- Staff */
describe('mapStaff (02 §0004 staff / staff_services)', () => {
  const fullRow = {
    id: 'st_1',
    name: '陳師傅',
    phone: '0933444555',
    email: 'chen@example.com',
    title: '資深美容師',
    avatar_url: 'https://cdn.example.com/st_1.jpg',
    service_ids: ['s_1', 's_2'],
    bookable: true,
    active: true,
    sort_order: 2,
  };

  it('全欄位比對', () => {
    expect(mapStaff(fullRow)).toEqual({
      id: 'st_1',
      name: '陳師傅',
      phone: '0933444555',
      email: 'chen@example.com',
      title: '資深美容師',
      avatarUrl: 'https://cdn.example.com/st_1.jpg',
      serviceIds: ['s_1', 's_2'],
      bookable: true,
      active: true,
      sortOrder: 2,
    });
  });

  it('phone / email / title / avatar_url null → 空字串', () => {
    const r = mapStaff({ ...fullRow, phone: null, email: null, title: null, avatar_url: null });
    expect(r.phone).toBe('');
    expect(r.email).toBe('');
    expect(r.title).toBe('');
    expect(r.avatarUrl).toBe('');
  });

  it('service_ids null（尚未指派服務）→ 空陣列', () => {
    expect(mapStaff({ ...fullRow, service_ids: null }).serviceIds).toEqual([]);
  });
});

/* ------------------------------------------------------------- Product */
describe('mapProduct (02 §0004 products)', () => {
  const fullRow = {
    id: 'p_1',
    category_id: 'pc_1',
    category_name: '保養品',
    name: '玻尿酸精華液',
    description: '深層保濕',
    price: 990,
    stock: 40,
    safety_stock: 10,
    image_url: 'https://cdn.example.com/p_1.jpg',
    active: true,
    line_featured: false,
    sort_order: 3,
  };

  it('全欄位比對', () => {
    expect(mapProduct(fullRow)).toEqual({
      id: 'p_1',
      categoryId: 'pc_1',
      categoryName: '保養品',
      name: '玻尿酸精華液',
      description: '深層保濕',
      price: 990,
      stock: 40,
      safetyStock: 10,
      imageUrl: 'https://cdn.example.com/p_1.jpg',
      active: true,
      lineFeatured: false,
      sortOrder: 3,
    });
  });

  it('category_id / category_name null（未分類）→ 保留 null', () => {
    const r = mapProduct({ ...fullRow, category_id: null, category_name: null });
    expect(r.categoryId).toBeNull();
    expect(r.categoryName).toBeNull();
  });

  it('description / image_url null → 空字串', () => {
    const r = mapProduct({ ...fullRow, description: null, image_url: null });
    expect(r.description).toBe('');
    expect(r.imageUrl).toBe('');
  });
});

/* --------------------------------------------------------- ProductOrder */
describe('mapProductOrder (02 §0004 product_orders / product_order_items)', () => {
  const fullRow = {
    id: 'po_1',
    order_no: 'PO2608220001',
    customer_id: 'c_1',
    customer_name: '林美麗',
    items: [
      { product_id: 'p_1', product_name: '玻尿酸精華液', quantity: 2, price: 990 },
      { product_id: 'p_2', product_name: '保濕面膜', quantity: 1, price: 590 },
    ],
    total_amount: 2570,
    status: 'CONFIRMED',
    payment_status: 'PAID_OFFLINE',
    created_at: '2026-08-10T00:00:00Z',
  };

  it('全欄位比對，含 items 陣列逐項轉換', () => {
    expect(mapProductOrder(fullRow)).toEqual({
      id: 'po_1',
      orderNo: 'PO2608220001',
      customerId: 'c_1',
      customerName: '林美麗',
      items: [
        { productId: 'p_1', productName: '玻尿酸精華液', quantity: 2, price: 990 },
        { productId: 'p_2', productName: '保濕面膜', quantity: 1, price: 590 },
      ],
      totalAmount: 2570,
      status: 'CONFIRMED',
      paymentStatus: 'PAID_OFFLINE',
      createdAt: '2026-08-10T00:00:00Z',
    });
  });

  it('items null（查無明細）→ 空陣列', () => {
    expect(mapProductOrder({ ...fullRow, items: null }).items).toEqual([]);
  });
});

/* ------------------------------------------------------------- Coupon */
describe('mapCoupon (02 §0004 coupons / coupon_instances)', () => {
  const fullRow = {
    id: 'cp_1',
    name: '新客優惠券',
    description: '首次消費折100元',
    discount_type: 'AMOUNT',
    discount_value: 100,
    total_quantity: 500,
    issued_quantity: 120,
    redeemed_quantity: 45,
    start_at: '2026-08-01T00:00:00Z',
    end_at: '2026-09-01T00:00:00Z',
    status: 'PUBLISHED',
    min_order_amount: 1200,
    max_discount_amount: null,
    gift_item: '',
    limit_per_customer: 1,
    private_mode: true,
    last_redeemed_code: 'ABC12345',
  };

  it('全欄位比對', () => {
    expect(mapCoupon(fullRow)).toEqual({
      id: 'cp_1',
      name: '新客優惠券',
      description: '首次消費折100元',
      discountType: 'AMOUNT',
      discountValue: 100,
      totalQuantity: 500,
      issuedQuantity: 120,
      redeemedQuantity: 45,
      startAt: '2026-08-01T00:00:00Z',
      endAt: '2026-09-01T00:00:00Z',
      status: 'PUBLISHED',
      minOrderAmount: 1200,
      maxDiscountAmount: null,
      giftItem: '',
      limitPerCustomer: 1,
      privateMode: true,
      lastRedeemedCode: 'ABC12345',
    });
  });

  it('description null → 空字串', () => {
    expect(mapCoupon({ ...fullRow, description: null }).description).toBe('');
  });

  it('start_at / end_at null（未設期間，DB 該欄位可空）→ 空字串', () => {
    const r = mapCoupon({ ...fullRow, start_at: null, end_at: null });
    expect(r.startAt).toBe('');
    expect(r.endAt).toBe('');
  });

  it('issued_quantity / redeemed_quantity null（尚無發放紀錄的即時 count）→ 0', () => {
    const r = mapCoupon({ ...fullRow, issued_quantity: null, redeemed_quantity: null });
    expect(r.issuedQuantity).toBe(0);
    expect(r.redeemedQuantity).toBe(0);
  });
});

/* ------------------------------------------------------ MembershipLevel */
describe('mapMembershipLevel (02 §0004 membership_levels)', () => {
  const fullRow = {
    id: 'ml_1',
    name: '金卡會員',
    color: '#C9A961',
    threshold_spent: 20000,
    discount_percent: 5,
    point_rate_multiplier: 1.5,
    customer_count: 87,
    sort_order: 1,
    description: '金卡說明',
    active: true,
    is_default: true,
  };

  it('全欄位比對', () => {
    expect(mapMembershipLevel(fullRow)).toEqual({
      id: 'ml_1',
      name: '金卡會員',
      color: '#C9A961',
      thresholdSpent: 20000,
      discountPercent: 5,
      pointRateMultiplier: 1.5,
      customerCount: 87,
      sortOrder: 1,
      description: '金卡說明',
      active: true,
      isDefault: true,
    });
  });

  it('customer_count null（即時 count 查無資料）→ 0', () => {
    expect(mapMembershipLevel({ ...fullRow, customer_count: null }).customerCount).toBe(0);
  });
});

/* ------------------------------------------------------- PointTransaction */
describe('mapPointTransaction (02 §0004 tenant_point_transactions)', () => {
  const fullRow = {
    id: 'pt_1',
    type: 'TOPUP',
    amount: 1000,
    balance_after: 5000,
    description: '儲值加值',
    created_at: '2026-08-15T00:00:00Z',
  };

  it('全欄位比對', () => {
    expect(mapPointTransaction(fullRow)).toEqual({
      id: 'pt_1',
      type: 'TOPUP',
      amount: 1000,
      balanceAfter: 5000,
      description: '儲值加值',
      createdAt: '2026-08-15T00:00:00Z',
    });
  });

  it('description null → 空字串', () => {
    expect(mapPointTransaction({ ...fullRow, description: null }).description).toBe('');
  });
});

/* -------------------------------------------------------- StaffPerformance */
describe('mapStaffPerformance (報表彙總列，非資料表)', () => {
  it('全欄位比對', () => {
    const row = {
      staff_id: 'st_1',
      staff_name: '陳師傅',
      booking_count: 42,
      completion_rate: 0.95,
      revenue: 63000,
    };
    expect(mapStaffPerformance(row)).toEqual({
      staffId: 'st_1',
      staffName: '陳師傅',
      bookingCount: 42,
      completionRate: 0.95,
      revenue: 63000,
    });
  });
});

/* -------------------------------------------------------------- TenantSummary */
describe('mapTenantSummary (tenant_users join tenants；current 由呼叫端傳入的 activeTenantId 判斷)', () => {
  const fullRow = {
    tenant_id: 't_1',
    role: 'OWNER',
    tenants: {
      shop_code: 'demo-shop',
      name: '示範美學工作室',
      business_type: 'LOCAL_SHOP',
      extra_modules: ['GUIDE'],
    },
  };

  it('全欄位比對，current 依 activeTenantId 相符 → true', () => {
    expect(mapTenantSummary(fullRow, 't_1')).toEqual({
      id: 't_1',
      shopCode: 'demo-shop',
      name: '示範美學工作室',
      role: 'OWNER',
      current: true,
      businessType: 'LOCAL_SHOP',
      extraModules: ['GUIDE'],
    });
  });

  it('activeTenantId 不同 → current 為 false', () => {
    expect(mapTenantSummary(fullRow, 't_other').current).toBe(false);
  });

  it('未傳 activeTenantId → current 為 false', () => {
    expect(mapTenantSummary(fullRow).current).toBe(false);
  });

  it('business_type null（尚未跑 13 分冊 migration 的舊資料）→ businessType 為 undefined', () => {
    const row = { ...fullRow, tenants: { ...fullRow.tenants, business_type: null } };
    expect(mapTenantSummary(row, 't_1').businessType).toBeUndefined();
  });

  it('extra_modules null（非斜槓店家）→ extraModules 為 undefined', () => {
    const row = { ...fullRow, tenants: { ...fullRow.tenants, extra_modules: null } };
    expect(mapTenantSummary(row, 't_1').extraModules).toBeUndefined();
  });
});
