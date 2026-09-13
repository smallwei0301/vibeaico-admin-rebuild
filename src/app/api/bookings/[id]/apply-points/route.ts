// POST /api/bookings/:id/apply-points — {points}：顧客點數折抵，1 點 = 1 元（04 §B-1）。
import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { createAdminSupabase } from '@/server/supabase';

const bodySchema = z.object({ points: z.number().int().positive('點數需為正整數') });

/**
 * issue #218：扣點、折價、點數帳本三件事改為**一筆資料庫交易**（`redeem_booking_points`）。
 *
 * 修改前這三步是三次獨立的 PostgREST 呼叫，有兩個缺口：
 *
 * **A. `final_price` 沒有 CAS。** 扣點那一步早就有 compare-and-swap（擋得住點數的
 *    lost update），但折價那一步用的是進函式時讀到的 `final_price`。兩個併發請求
 *    各折 30 點：CAS 讓兩次扣點都成功（100 → 70 → 40，**點數真的少了 60**），
 *    而兩邊都把 `final_price` 寫成「讀到的 100 − 30 = 70」。
 *    **顧客付出 60 點，只換到 30 元折扣。**
 *
 * **B. 三步不在同一交易。** 帳本 insert 或折價 update 失敗時，已扣掉的點數收不回來
 *    ——顧客的點數消失，卻沒有折扣、也沒有帳本紀錄可查。
 *
 * rpc 內以 `select … for update` 鎖住 booking 與 customer 兩列，折價寫成
 * `final_price = final_price - p_points`（由資料庫自己讀自己算），因此不可能有兩個
 * 請求各自從同一個舊值出發。任何一步 raise 都讓整筆回滾。
 *
 * ⚠️ 這裡改用 service role client：rpc 是 `security definer`，且已對
 * `anon, authenticated` 撤銷執行權（見 `0090`），只能由伺服器端呼叫。
 * 身分／租戶／`POINT_SYSTEM` 三道閘門**維持在 route 這一層、順序不變**，
 * 而 rpc 內部再以 `tenant_id = p_tenant` 過濾每一句，兩層都不倚賴對方。
 *
 * 回應格式與既有 `{ finalPrice, customerPoints }` 逐字相同（#218 驗收：不自行改
 * 商業規則、不改回應形狀）。
 */
export const POST = handle(async (req, { params }) => {
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'POINT_SYSTEM');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const admin = createAdminSupabase();
  const { data, error } = await admin.rpc('redeem_booking_points', {
    p_tenant: t.tenantId,
    p_booking: id,
    p_points: b.points,
  });

  if (error) {
    const message = String((error as any)?.message ?? '');
    // 業務結果各自對映到既有的狀態碼與錯誤碼，語意與修改前完全相同。
    if (message.includes('BOOKING_NOT_FOUND')) {
      throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
    }
    if (message.includes('CUSTOMER_NOT_FOUND')) {
      throw new ApiHttpError(404, '找不到此顧客', ERR.NOT_FOUND);
    }
    /**
     * issue #291：已完成／已取消／爽約的預約不得再折抵（Owner 2026-09-08 裁示）。
     *
     * 409 而不是 400：這不是「輸入不合法」——同一個 `points` 值換一筆待確認的預約
     * 就會成功。是**這筆預約目前的狀態**不接受這個操作，那是狀態衝突。
     *
     * 訊息要說得出「為什麼」與「怎麼辦」。只回「無法折抵」的話，店家看不出是狀態
     * 問題，會跑去改點數或改金額——那兩個地方都不是問題所在。
     */
    if (message.includes('BOOKING_NOT_ADJUSTABLE')) {
      throw new ApiHttpError(
        409,
        '此預約已完成、已取消或未到店，無法再折抵點數；如需補折抵請先將預約改回已確認',
        ERR.CONFLICT,
      );
    }
    // POINTS_001（錯誤碼總表：點數不足 409）。維持字面值，與修改前一致。
    if (message.includes('POINTS_INSUFFICIENT')) {
      throw new ApiHttpError(409, '顧客點數不足', 'POINTS_001');
    }
    // 折抵超過金額是「要求折太多」＝輸入不合法，不是狀態衝突（維持 400）。
    if (message.includes('AMOUNT_EXCEEDED')) {
      throw new ApiHttpError(400, '折抵點數不可超過預約金額', ERR.VALIDATION);
    }
    if (message.includes('POINTS_INVALID')) {
      throw new ApiHttpError(400, '點數需為正整數', ERR.VALIDATION);
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);

  return ok({
    finalPrice: Number((row as any).final_price),
    customerPoints: Number((row as any).customer_points),
  });
});
