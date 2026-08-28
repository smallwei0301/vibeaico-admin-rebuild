import { ApiHttpError, ERR } from '@/server/http';

/** Turns source-only availability RPC failures into the API's stable contract. */
export function throwAvailabilityRpcError(error: any): never {
  const message = String(error?.message ?? '');
  if (error?.code === 'P0002') {
    throw new ApiHttpError(404, '找不到指定的資料', ERR.NOT_FOUND);
  }
  if (error?.code === '23505' || message.startsWith('DEPARTURE_DUPLICATE')) {
    throw new ApiHttpError(409, '同方案同日期同時間的團次已存在', ERR.CONFLICT);
  }
  if (message.startsWith('DEPARTURE_CAPACITY_BELOW_BOOKED')) {
    throw new ApiHttpError(409, '名額不得少於已報名人數', ERR.CONFLICT);
  }
  if (message.startsWith('GUIDE_ONBOARDING_REQUIRED')) {
    throw new ApiHttpError(409, '尚無可指派導遊，請先完成導遊建檔', ERR.CONFLICT);
  }
  if (message.startsWith('PRIMARY_STAFF_REQUIRED')) {
    throw new ApiHttpError(409, '請選擇主要導遊', ERR.CONFLICT);
  }
  if (message.startsWith('AVAILABILITY_')) {
    throw new ApiHttpError(409, '人員在該時段不可用（班表、預約、封鎖或團次衝突）', ERR.CONFLICT);
  }
  if (message.startsWith('TOUR_ORDER_COMPLETE_STATE')) {
    throw new ApiHttpError(409, '此訂單目前無法結案', ERR.CONFLICT);
  }
  if (message.startsWith('TOUR_ORDER_PRIMARY_STAFF_REQUIRED')) {
    throw new ApiHttpError(409, '團次尚未指派主要導遊，無法凍結加購業績', ERR.CONFLICT);
  }
  throw error;
}
