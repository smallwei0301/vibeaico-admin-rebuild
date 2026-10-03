/**
 * src/server/send-code.ts — 驗證碼寄送共用邏輯
 *
 * 抽出此檔是對 03-AUTH.md 的一處結構性偏離：規格原文把 §2 的驗證碼寄送邏輯
 * 直接寫在 send-verification-code route 內；03 §4 尾談到 forgot-password 時
 * 明講「實作方式：把共用邏輯抽成 src/server/send-code.ts 或直接在 forgot
 * route 內重複 send-verification-code 的邏輯皆可」，此處選擇抽出共用函式，
 * 讓 send-verification-code 與 forgot-password 兩個 route 都呼叫它，避免
 * 複製貼上兩份會漂移的邏輯。函式內容仍是 03 §2 程式碼的逐字搬移（僅刪除
 * 未使用的 `listUsers` 死碼，理由見 send-verification-code route 的註解）。
 *
 * 命中 60 秒重寄節流時丟出 `ApiHttpError(429, …)`：
 * - send-verification-code route 讓它直接往外拋，經 `handle()` 轉成 429 回應。
 * - forgot-password route 依規格「一律回 ok({sent:true})」的要求，catch 這個
 *   錯誤並吞掉（見該 route 註解）。
 */

import { randomInt } from 'crypto';
import { ApiHttpError, ERR } from './http';
import { createAdminSupabase } from './supabase';
import { sendVerificationCodeEmail } from './email/send';

/** 使用者可讀訊息：provider 細節只進 server log，不回給 client。 */
const MAIL_UNAVAILABLE_MESSAGE = '驗證信暫時無法寄出，請稍後再試或聯絡我們';

/**
 * 設定類失敗旗標（#754 枚舉防護）：偵測到 provider 設定錯誤後的這段時間內，連「email 已存在
 * 所以本來不寄信」的路徑也回 503，讓已註冊／未註冊 email 在服務異常時回應一致。
 * 存放於本 instance 記憶體（serverless 各 instance 獨立，best-effort；不跨 instance 共享）。
 */
export const MAIL_CONFIG_FAILURE_TTL_MS = 10 * 60_000;
let configFailureUntil = 0;
const mailUnavailable = () => new ApiHttpError(503, MAIL_UNAVAILABLE_MESSAGE, ERR.MAIL_UNAVAILABLE);

/** 僅供測試：重置旗標。 */
export function __resetMailConfigFailureFlag() { configFailureUntil = 0; }

export async function dispatchVerificationCode(email: string, purpose: 'REGISTER' | 'RESET_PASSWORD') {
  const admin = createAdminSupabase();

  const { data: recent } = await admin.from('auth_verification_codes')
    .select('created_at').eq('email', email).eq('purpose', purpose)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000)
    throw new ApiHttpError(429, '請稍候再重新發送驗證碼', ERR.CONFLICT);

  // email 是否已註冊（枚舉防護：不論結果都當作已寄送處理，只是不真的寄信）
  const exists = !!(await admin.rpc('email_exists', { p_email: email })).data;
  if ((purpose === 'REGISTER') === exists) {
    // 不寄信的路徑：服務處於設定類失敗狀態時也回同一個 503，避免洩漏 email 是否已註冊。
    if (Date.now() < configFailureUntil) throw mailUnavailable();
    return;
  }

  const code = String(randomInt(100000, 999999));
  await admin.from('auth_verification_codes').insert({
    email, code, purpose, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const { result, configFailure } = await sendVerificationCodeEmail(email, code, purpose);
  if (result === 'SENT') {
    configFailureUntil = 0; // 已恢復
    return;
  }

  // 沒寄出：讓剛插入的碼失效（刪除；也不會留下 60 秒冷卻擋住使用者重試），再回明確錯誤。
  const { error: delErr } = await admin.from('auth_verification_codes')
    .delete().eq('email', email).eq('purpose', purpose).eq('code', code);
  if (delErr) console.error('[send-code] 無法刪除未寄出的驗證碼', delErr);
  if (configFailure) configFailureUntil = Date.now() + MAIL_CONFIG_FAILURE_TTL_MS;
  throw mailUnavailable();
}
