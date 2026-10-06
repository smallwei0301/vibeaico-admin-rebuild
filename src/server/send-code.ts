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
 * 寄信失敗 parity 視窗（#754／#758／#763 枚舉防護）：設定類或服務層級的「該寄卻寄失敗」之後，
 * 在視窗內「所有」請求（不論 email 是否已註冊、不論 purpose 對應的分支）都在最前面短路回同一個
 * 503 `MAIL_001`——不查 DB、不寫驗證碼、不呼叫 provider。視窗只由 TTL 結束，SENT 不會提前清除
 * （視窗內根本不會寄信）；否則 provider 在視窗內恢復時，寄信分支的位址會寄成功回 200，不寄信分支的位址
 * 仍回 503，形成枚舉 oracle（#763 Codex P1 #2）。檢查必須在 60 秒重寄冷卻（429，只對真的寄過信的
 * 位址成立）與 email_exists 分支之前，否則兩條分支的回應會不同。
 * TTL：設定類（含 MAIL_FROM 錯誤與其餘無法證明是收件人造成的 4xx，fail-closed）10 分鐘；
 * 服務層級（5xx／429／網路）60 秒；可證明為 to 欄位的 4xx 拒絕（recipient）不開窗、不延伸、
 * 不清除，且對外回 200（與不寄信分支一致，見下方 recipient 說明）。
 * 多次失敗以 Math.max 延伸，不縮短既有較長視窗。
 *
 * 可用性代價：服務層級失敗後，本 instance 暫停寄信至多 60 秒（Resend 429 突發也會造成 60 秒暫停，
 * #764）；設定類失敗暫停到 TTL 結束或重新部署。
 *
 * 已知殘餘（文件化，best-effort；不保證兩種 email 回應完全相同，#764）：
 * - 視窗存於本 instance 記憶體，serverless 各 instance 獨立、不跨 instance 共享；
 *   每個 instance「第一個」失敗請求之前（視窗尚未建立）仍可能洩漏差異。
 * - 持續故障時視窗自「最後一次失敗寄送」起算，service 60 秒／config 10 分鐘到期，無 grace period；
 *   到期後到下一次失敗前，不寄信分支回 200、寄信分支才失敗回 503，每次到期都重新暴露。
 * - check-then-set 競態：視窗開啟當下已通過檢查的並行請求照常完成。
 * - 正常運作時的既有差異：60 秒冷卻（429）只對真的寄過信的位址成立，且 send-verification-code 不吞 429
 *   （forgot-password 才吞）；若刪碼失敗殘留一筆，也只有寄信分支的位址會 429。
 *   已使用的碼只標 consumed_at、不刪除，冷卻查詢不排除；碼建立後 60 秒內帳號狀態改變的任何情況都會出現此差異：
 *   完成註冊者於碼建立後 60 秒內再次 REGISTER 仍回 429；帳號被刪除（例如系統外刪除）後 RESET_PASSWORD 碼仍在，
 *   send-verification-code 對已不存在的位址回 429（forgot-password 吞 429，回 200）；register 建店失敗的 deleteUser 補償回滾後，
 *   已使用的 REGISTER 碼仍在、60 秒內重新註冊回 429，但位址已回到寄信分支，與寄信分支 60 秒內 429 一致，非新差異。
 */
export const MAIL_CONFIG_FAILURE_TTL_MS = 10 * 60_000;
export const MAIL_TRANSIENT_FAILURE_TTL_MS = 60_000;
let configFailureUntil = 0;
const mailUnavailable = () => new ApiHttpError(503, MAIL_UNAVAILABLE_MESSAGE, ERR.MAIL_UNAVAILABLE);

/** 僅供測試：重置旗標。 */
export function __resetMailConfigFailureFlag() { configFailureUntil = 0; }

export async function dispatchVerificationCode(email: string, purpose: 'REGISTER' | 'RESET_PASSWORD') {
  // parity 視窗內：兩條分支一律在最前面短路成同一個 503（見上方說明）。
  if (Date.now() < configFailureUntil) throw mailUnavailable();

  const admin = createAdminSupabase();

  const { data: recent } = await admin.from('auth_verification_codes')
    .select('created_at').eq('email', email).eq('purpose', purpose)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (recent && Date.now() - new Date(recent.created_at).getTime() < 60_000)
    throw new ApiHttpError(429, '請稍候再重新發送驗證碼', ERR.CONFLICT);

  // email 是否已註冊（枚舉防護：不論結果都當作已寄送處理，只是不真的寄信）
  const exists = !!(await admin.rpc('email_exists', { p_email: email })).data;
  if ((purpose === 'REGISTER') === exists) {
    return; // 不寄信的路徑（視窗內已在最前面短路）
  }

  const code = String(randomInt(100000, 999999));
  await admin.from('auth_verification_codes').insert({
    email, code, purpose, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const { result, failureKind } = await sendVerificationCodeEmail(email, code, purpose);
  if (result === 'SENT') return; // 視窗內不會走到這裡，故 SENT 不清除視窗

  // 沒寄出：讓剛插入的碼失效（刪除；也不會留下 60 秒冷卻擋住使用者重試），再回明確錯誤。
  const { error: delErr } = await admin.from('auth_verification_codes')
    .delete().eq('email', email).eq('purpose', purpose).eq('code', code);
  if (delErr) console.error('[send-code] 無法刪除未寄出的驗證碼', delErr);
  // recipient（可證明為 to 欄位的 4xx 拒絕，如 "Invalid `to` field"）：對外必須與「不寄信分支」無法區分（#763 P1 #3）——
  // 碼已刪除、只寫 server log、不開啟／延伸／清除視窗，並**正常返回**（route 回 200 {sent:true}），
  // 不得丟 503：否則攻擊者可用 provider 會拒絕的位址反覆探測（不寄信分支 → 200、寄信分支 → 503）。
  // 理由：被 provider 拒絕的位址，等同「受理後退信」的不可投遞位址（使用者看到已寄出、信不會到）；
  // #754 的誠實回報保留給 provider／設定層級的真實故障（config／service → 503 + 視窗）。
  // 冷卻檢查：碼已刪除，故寄信分支的位址再次請求不會被 429 擋下，與不寄信分支的位址（從無碼）一致；
  // 唯一例外是刪除碼本身失敗（delErr，只留 log）時才會殘留一筆而觸發 429，屬資料庫故障的極端邊界。
  if (failureKind === 'recipient') {
    console.error('[send-code] 收件人專屬拒絕（對外回 200，不開視窗）');
    return;
  }
  const ttl = failureKind === 'config' ? MAIL_CONFIG_FAILURE_TTL_MS : MAIL_TRANSIENT_FAILURE_TTL_MS;
  configFailureUntil = Math.max(configFailureUntil, Date.now() + ttl); // 不縮短既有較長視窗
  throw mailUnavailable();
}
