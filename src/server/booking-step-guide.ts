/**
 * src/server/booking-step-guide.ts — 預約步驟引導卡
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6.2.9
 *
 * 七個步驟的 key 與預設值**逐字取自** `docs/specs/line-settings.json` 的
 * `looseFields[20..33]`：`placeholder` 是原站的預設標題，`value` 是原站的預設色。
 * 這一組是少數真的還原得回來的東西（每個欄位的 `help` 都寫著它屬於哪一步），
 * 與同一區的 `flexShowTip` 恰恰相反（見 §6.2.10）。
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️ **這張卡目前存得到、但顧客收不到。**                               ║
 * ║ 原站的引導卡是「預約 carousel **最前面**那張『👈 往左滑動 ＋ 步驟清單』║
 * ║ 指引卡」（REBUILD-SPEC 的 `bookingStepGuideToggle` label 逐字）。      ║
 * ║ **本專案沒有那個 carousel**：`line-events.ts` 的 `replyServiceList()` ║
 * ║ 對「預約 / 服務 / 服務項目」回的是**純文字服務清單**，不是 Flex。     ║
 * ║                                                                      ║
 * ║ 所以引導卡沒有可以被插在前面的東西。設定會被存下來、讀得回來、        ║
 * ║ payload 也過 LINE 驗證，**但顧客端不會因為這個開關而看到任何變化**。   ║
 * ║ 畫面上必須明講——把設定存起來是誠實的，顯示「顧客現在會看到引導卡」   ║
 * ║ 則是編造（CLAUDE.md：absence of data ≠ invented data）。              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */
import { z } from 'zod';
import { buildStepGuideBubble, type LineMessage } from './flex-menu';

/** LINE 只收 `#RRGGBB` / `#RRGGBBAA` */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const BOOKING_STEP_KEYS = [
  'SERVICE', 'DATE', 'STAFF', 'TIME', 'NOTE', 'CONFIRM', 'SUCCESS',
] as const;
export type BookingStepKey = (typeof BOOKING_STEP_KEYS)[number];

/**
 * 原站預設值。出處逐欄對得上 `docs/specs/line-settings.json`：
 *
 * | key | spec 欄位 | placeholder（→ title） | value（→ color） |
 * |---|---|---|---|
 * | SERVICE | stepServiceTitle / stepServiceColor | ✂️ 選擇您的服務 | #4A90D9 |
 * | DATE    | stepDateTitle / stepDateColor       | 📅 選擇預約日期 | #1DB446 |
 * | STAFF   | stepStaffTitle / stepStaffColor     | 👤 選擇服務人員 | #4A90D9 |
 * | TIME    | stepTimeTitle / stepTimeColor       | ⏰ 選擇時段     | #4A90D9 |
 * | NOTE    | stepNoteTitle / stepNoteColor       | 📝 備註事項     | #5C6BC0 |
 * | CONFIRM | stepConfirmTitle / stepConfirmColor | 📋 確認預約資訊 | #1DB446 |
 * | SUCCESS | stepSuccessColor（title 欄在原站是唯讀提示「（使用系統預設標題）」） | （空） | #1DB446 |
 *
 * ⚠️ `SUCCESS` 的預設標題是**空字串**而不是「（使用系統預設標題）」——那句是原站
 * 用來說明「這一格不能填」的提示文字，不是標題內容。把提示文字當值存下去，
 * 顧客就會在卡片上看到一句對他毫無意義的後台說明。
 */
export const BOOKING_STEP_DEFAULTS: Record<BookingStepKey, { title: string; color: string }> = {
  SERVICE: { title: '✂️ 選擇您的服務', color: '#4A90D9' },
  DATE: { title: '📅 選擇預約日期', color: '#1DB446' },
  STAFF: { title: '👤 選擇服務人員', color: '#4A90D9' },
  TIME: { title: '⏰ 選擇時段', color: '#4A90D9' },
  NOTE: { title: '📝 備註事項', color: '#5C6BC0' },
  CONFIRM: { title: '📋 確認預約資訊', color: '#1DB446' },
  SUCCESS: { title: '', color: '#1DB446' },
};

/** 引導卡上對顧客說的話（server 端 zh-TW 常數，與 flex-menu.ts 的 MSG 同一層） */
const MSG = {
  guideTitle: '預約流程',
  guideHint: '👈 往左滑動查看每一步',
} as const;

export const bookingStepSchema = z.object({
  key: z.enum(BOOKING_STEP_KEYS),
  title: z.string().trim().max(100, '步驟標題最多 100 字').default(''),
  color: z.string().trim().regex(HEX_COLOR, '色碼格式需為 #RRGGBB').default('#1DB446'),
});

export const bookingStepGuideSchema = z.object({
  enabled: z.boolean().default(true),
  steps: z.array(bookingStepSchema).max(BOOKING_STEP_KEYS.length).default([]),
});
export type BookingStepGuide = z.infer<typeof bookingStepGuideSchema>;

/**
 * 把存下來的（可能不完整的）設定補成七步。缺的用原站預設值，
 * `title` 留空的也用預設——空標題在 LINE 的 text 元件會被整包退回 400。
 */
export function normalizeBookingStepGuide(raw: unknown): BookingStepGuide {
  const parsed = bookingStepGuideSchema.safeParse(raw ?? {});
  const base = parsed.success ? parsed.data : { enabled: true, steps: [] };
  const byKey = new Map(base.steps.map((s) => [s.key, s]));

  return {
    enabled: base.enabled,
    steps: BOOKING_STEP_KEYS.map((key) => {
      const saved = byKey.get(key);
      const fallback = BOOKING_STEP_DEFAULTS[key];
      return {
        key,
        title: saved?.title || fallback.title,
        color: saved?.color || fallback.color,
      };
    }),
  };
}

/**
 * 引導卡的 Flex bubble。
 *
 * ⚠️ **實際的 Flex JSON 組裝在 `src/server/flex-menu.ts`**（`buildStepGuideBubble()`）。
 * 本專案有一條守門測試釘住「src/ 底下只有 flex-menu.ts 會組 bubble / carousel」，
 * 而那條規則的理由（Flex 組裝散出去之後守門就只能靠白名單維持）在這裡一樣成立。
 * 這一支只負責把「七步設定」翻成 `buildStepGuideBubble()` 要的形狀。
 */
export function buildBookingStepGuideCard(guide: BookingStepGuide): LineMessage {
  return buildStepGuideBubble(guide.steps, { title: MSG.guideTitle, hint: MSG.guideHint });
}
