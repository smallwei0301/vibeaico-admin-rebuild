/**
 * 功能閘門的共用常數（前後端都會用到，所以放 src/lib 而不是 src/server）。
 *
 * 後端 `requireFeature()` 用它當 403 FEAT_001 的 message；前端 ToastProvider 用
 * 它辨識「這則提示屬於未訂閱通知」，好套用「每天最多提示一次」的節流——
 * 沒有這個共用常數的話，前端只能字串比對硬寫一份中文，兩邊會各自漂移。
 */
export const FEATURE_LOCKED_MESSAGE = '此功能尚未訂閱，請至功能商店開通';
