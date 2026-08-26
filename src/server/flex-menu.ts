/**
 * src/server/flex-menu.ts — Flex 主選單的**唯一**組裝處（GitHub issue #6）
 * 規格：docs/integration/06-LINE-INTEGRATION.md §6
 *      「POST /api/settings/line/flex-menu 儲存 flex 設定（jsonb）；
 *        webhook 的「選單」關鍵字回這份 Flex Message」
 *
 * ⚠️ **全專案只有這一支檔案會產生 Flex bubble / carousel 的 JSON。**
 * issue #6 明列這是「單一事實來源」的要求，理由是這批工作已經反覆抓到同型缺陷
 * （分類的四顆按鈕、`move` 在兩頁各寫一份、頁面送 size:200 而端點收 max:100）：
 * 同一件事寫兩份，短期看起來一樣，長期一定分岔，而分岔的那一天沒有任何測試會紅。
 * 因此：
 *
 *   顧客打「選單」  ─┐
 *                    ├─→ resolveBuiltinIntent → 'MENU' → replyFlexMenu()
 *   Rich Menu 格子   ─┘                                      └→ buildFlexMenuOutcome()（本檔）
 *   設 FLEX_POPUP
 *
 * Rich Menu 的格子是 **message action**（顧客按下去＝在聊天室送出一段文字），
 * LINE 沒有「按一格直接跳出 Flex」的 action 型別，所以 FLEX_POPUP 的實現方式
 * 就是讓那一格送出 `FLEX_POPUP_TRIGGER_TEXT`，由 webhook 用**同一支**
 * `buildFlexMenuOutcome()` 回覆。`richMenuCellAction()` 是那個綁定的唯一出處。
 *
 * ⚠️ 誠實標註（比照 14 分冊 §8.8 對 `/api/bookings/available-slots` 的處理）：
 * `richMenuCellAction()` 的 FLEX_POPUP 分支**目前沒有任何設定能觸發**——
 * Rich Menu 的每格自訂尚未有儲存後端（屬 issue #7），`MODE_PRESETS.richMenuCells`
 * 也沒有一格標成 FLEX_POPUP。它是「已實作、已單元測試、刻意尚未被使用」，
 * **不是**已經生效的功能，頁面不得宣稱每格設定會隨發布送出。
 */
import {
  MAX_FLEX_CARDS, flexCardSchema, isAllowedFlexLinkUrl, type FlexCard,
} from '@/config/tenant-settings';

/* ------------------------------------------------------------------ 文案 */
/**
 * Bot 對「顧客」說的話 — server 端 zh-TW 常數。
 * 與 `src/server/line-events.ts` 的 `MSG`、`src/server/email/templates.ts` 同一層：
 * 鐵則 1 管的是後台頁面元件的 copy，這裡不是後台畫面。
 */
const MSG = {
  /**
   * `flexMenuEnabled=false` 且 `flexMenuFallback='HINT'` 時回的提示文字。
   * 與 rich-menu-design 頁那顆單選鈕的說明逐字一致
   * （`t.flex.fallbackHint`：回提示文字「請點選下方選單使用 👇」）——
   * 畫面上寫會回什麼，顧客就要收到什麼。
   */
  fallbackHint: '請點選下方選單使用 👇',
  /** 廣告卡上的標示。台灣《公平交易法》與 LINE 的廣告規範都要求可辨識。 */
  adBadge: '廣告',
  /**
   * `flexShowTip=true` 時，carousel 之**後**多送的那一則使用提示（14 分冊 §8.22-c、
   * 06 分冊 §6.2.10）。
   *
   * ⚠️ **這句話的語意是我們選的，不是從原站還原的。**
   * 原站規格對 `flexShowTip` 只留下一行 label「顯示使用提示」，`help` 是空字串，
   * `jsStrings` 全文沒有任何一句提到它，`grep '顯示使用提示' docs/specs/` 全站只命中
   * 欄位定義本身。**它原本顯示什麼文字、出現在哪裡，救不回來。**
   * 後來的人不要把這句話當考據結果引用。
   *
   * （**判定得出來的部分**：這個欄位屬於 Flex 主選單那一組，**不屬於**步驟引導——
   *  id 前綴 `flex*` vs `step*`、CSS class 只有 `form-check-input` 而七組步驟欄位
   *  一律帶 `flex-step-*`、`help` 為空而每個步驟欄位的 `help` 都寫著它屬於哪一步、
   *  步驟引導在另一頁已經有自己的開關 `bookingStepGuideToggle`。詳見 §6.2.10。）
   */
  usageTip: '💡 點選卡片上的按鈕即可繼續，或直接輸入文字告訴我們您的需求。',
} as const;

/** Flex 訊息的 altText（通知列與不支援 Flex 的環境會顯示這一句） */
const ALT_TEXT_MAX = 400;

/* ------------------------------------------------------------------ 型別 */
/** LINE Messaging API 的訊息物件；欄位形狀由 LINE 決定，這裡不再自訂型別樹。 */
export type LineMessage = Record<string, unknown>;

/**
 * ⚠️ `messages` 是**陣列**，呼叫端必須整包送（`lineReply(token, replyToken, outcome.messages)`）。
 *
 * 它原本是單數 `message`，而 `line-events.ts` 寫死 `lineReply(..., [outcome.message])`。
 * `flexShowTip` 要在 carousel 之後多送一則，單數欄位裝不下第二則——留著不改，
 * 就會出現「開關開了、第二則沒送出去」：**換一種寫法的同一顆假開關**
 * （14 分冊 §8.22-c、06 分冊 §6.2.10）。
 *
 * 守門測試 `grep` 全專案不得再出現 `[outcome.message]` 這種只送第一則的寫法。
 */
export type FlexMenuOutcome =
  /** 有卡片且已啟用 → 回 Flex carousel（＋ flexShowTip 開啟時的第二則提示）。 */
  | { kind: 'FLEX'; messages: LineMessage[]; bubbleCount: number }
  /** 已關閉且 fallback=HINT → 回一句提示文字 */
  | { kind: 'HINT'; messages: LineMessage[] }
  /** 已關閉且 fallback=SILENT → **完全不回**（呼叫端一則請求都不准發） */
  | { kind: 'SILENT' }
  /** 已啟用但店家一張卡片都還沒編 → 交還給呼叫端決定（不得憑空生一張卡） */
  | { kind: 'NO_CARDS' };

/**
 * Rich Menu 每一格的設定形狀。`action` 省略＝送出 `text`。
 *
 * `OPEN_URL` 是 issue #19 的進階設計器加的（`src/server/rich-menu.ts`）：
 * 那一格按下去由 LINE 開啟 `uri`。**組裝仍然留在本檔**——本專案有一條守門測試
 * 釘住「src/ 底下只有 flex-menu.ts 會組 uri action」，而那條規則的理由
 * （同一件事兩份實作、長期一定分岔）對 rich menu 的格子一樣成立。
 */
export type RichMenuCell = {
  label: string;
  text: string;
  action?: 'SEND_TEXT' | 'FLEX_POPUP' | 'OPEN_URL';
  /** `action === 'OPEN_URL'` 時的目的地。呼叫端要先過 `isAllowedFlexLinkUrl()`。 */
  uri?: string;
};

/**
 * FLEX_POPUP 格子按下去送出的文字。
 *
 * 必須是 `resolveBuiltinIntent()` 解析得到 `MENU` 的字之一
 * （`src/i18n/zh-TW/pages/keyword-replies.ts` 的 system.groups MENU 組：
 * 主選單／選單／功能）。`tests/unit/flex-menu.06.test.ts` 有一條把這個
 * 對應關係釘死——改壞了就是顧客按那一格完全沒反應（issue #5 抓到 14 格
 * 沒反應的那個缺陷，同一個失敗模式）。
 */
export const FLEX_POPUP_TRIGGER_TEXT = '選單';

/* -------------------------------------------------------------- 小工具 */

/** LINE 只收 `#RRGGBB` / `#RRGGBBAA`；存進 jsonb 的是自由字串，這裡是最後一道防線。 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
/** `flexHeaderColor` 的 schema 預設值；色碼壞掉時回退到它而不是送一個 LINE 會拒的值。 */
const DEFAULT_HEADER_COLOR = '#06C755';

function safeColor(value: unknown): string {
  const v = typeof value === 'string' ? value.trim() : '';
  return HEX_COLOR.test(v) ? v : DEFAULT_HEADER_COLOR;
}

/** `{shopName}` 樣板替換（06 §6 規格；header 標題／副標都適用）。 */
export function applyShopName(template: unknown, shopName: string): string {
  return typeof template === 'string' ? template.replaceAll('{shopName}', shopName) : '';
}

/**
 * 把 jsonb 讀出來的 `flexCards` 轉成可用的卡片陣列。
 *
 * 這是**讀取路徑**，與端點的寫入驗證刻意不同調，兩者的失敗代價不一樣：
 * - 寫入時（`flexCardSchema` 在 `POST /api/settings/line/flex-menu`）一張不合規
 *   就整包 400，店家當場看得到哪裡錯、可以改。
 * - 讀取時已經來不及叫任何人來改了，顧客正在等回覆。所以這裡**先搶救再放棄**：
 *   圖片網址不是 https（LINE 只收 HTTPS）→ 只丟掉那張圖，卡片留著；
 *   連結網址不在白名單（`isAllowedFlexLinkUrl()`，14 分冊 §8.20-b）→
 *   只丟掉那個連結，卡片留著，按鈕退回 message action（顧客還是按得動，只是不開網址）；
 *   連標題都沒有 → 那張卡真的畫不出來（標題同時是按鈕文字），才跳過它。
 *   讓一個壞掉的網址帶走整張卡，店家會看到後台卡片好好的、顧客那邊卻少一張。
 *
 * 同時硬切到 `MAX_FLEX_CARDS`——carousel 超過 12 個 bubble 會被 LINE 整包退回，
 * 那是「一張都收不到」而不是「少收幾張」。
 */
export function normalizeFlexCards(raw: unknown): FlexCard[] {
  if (!Array.isArray(raw)) return [];
  const out: FlexCard[] = [];
  for (const item of raw) {
    const url = (item as { imageUrl?: unknown })?.imageUrl;
    const usable = typeof url === 'string' && url.trim().startsWith('https://') ? url : '';
    /*
     * 白名單與寫入驗證共用 `isAllowedFlexLinkUrl()`（唯一出處在
     * `src/config/tenant-settings.ts`）。存進去的是 **trim 後**的值：
     * LINE 對前置空白的網址回 400，留著空白等於把整份 carousel 送去被退。
     */
    const link = (item as { linkUrl?: unknown })?.linkUrl;
    const usableLink = isAllowedFlexLinkUrl(link) ? (link as string).trim() : '';
    const parsed = flexCardSchema.safeParse({
      ...(item as object), imageUrl: usable, linkUrl: usableLink,
    });
    if (parsed.success) out.push(parsed.data);
    if (out.length >= MAX_FLEX_CARDS) break;
  }
  return out;
}

/* ------------------------------------------------------------ 組裝：bubble */
/**
 * 一張卡片 → 一個 bubble。
 *
 * 刻意省略而不是填假值的地方（CLAUDE.md：不知道就不要編）：
 * - `imageUrl` 是空的或不是 https → **整個 hero 省略**，不塞一張佔位圖
 * - `subtitle` 是空的 → 那個 text 元件不存在（LINE 的 text 元件不接受空字串，
 *   塞空字串整包會被退回 400）
 * - header 兩行都空 → 整個 header 區塊省略
 * - `linkUrl` 是空的或不在白名單 → 按鈕**退回 message action**（送出 title），
 *   不生一個假的網址、也不把按鈕拿掉。卡片不會因為沒填網址就變成一張壞卡。
 *
 * 底部按鈕**永遠只有一個 action**（14 分冊 §8.20 的實作選擇，見本檔下方 `cardAction()`）。
 */
function buildBubble(
  card: FlexCard,
  header: { title: string; subtitle: string; color: string },
): LineMessage {
  const bubble: Record<string, unknown> = { type: 'bubble' };

  const headerContents: LineMessage[] = [];
  if (header.title) {
    headerContents.push({
      type: 'text', text: header.title, color: '#FFFFFF',
      weight: 'bold', size: 'sm', wrap: true,
    });
  }
  if (header.subtitle) {
    headerContents.push({
      type: 'text', text: header.subtitle, color: '#FFFFFF', size: 'xs', wrap: true,
    });
  }
  if (headerContents.length) {
    bubble.header = {
      type: 'box', layout: 'vertical', spacing: 'none',
      paddingAll: '12px', backgroundColor: header.color, contents: headerContents,
    };
  }

  if (card.imageUrl.startsWith('https://')) {
    bubble.hero = {
      type: 'image', url: card.imageUrl,
      size: 'full', aspectRatio: '20:13', aspectMode: 'cover',
    };
  }

  const bodyContents: LineMessage[] = [];
  if (card.ad) {
    bodyContents.push({ type: 'text', text: MSG.adBadge, size: 'xxs', color: '#999999' });
  }
  bodyContents.push({ type: 'text', text: card.title, weight: 'bold', size: 'md', wrap: true });
  if (card.subtitle) {
    bodyContents.push({ type: 'text', text: card.subtitle, size: 'sm', color: '#666666', wrap: true });
  }
  bubble.body = { type: 'box', layout: 'vertical', spacing: 'sm', contents: bodyContents };

  bubble.footer = {
    type: 'box', layout: 'vertical',
    contents: [{
      type: 'button', style: 'primary', height: 'sm', color: header.color,
      action: cardAction(card),
    }],
  };

  return bubble;
}

/**
 * 一張卡片 → 底部按鈕的 action（14 分冊 §8.20：卡片契約多了 optional `linkUrl`）。
 *
 * 兩種 action 擇一，**不並存**：
 * - 有 `linkUrl`（白名單內的 scheme）→ `uri`，顧客按下去由 LINE 開啟它
 *   （`https://`／`http://` 進內建瀏覽器，`line://` 跳 LINE 內頁，
 *    `tel:` 撥號，`mailto:` 開郵件 app）。
 * - 沒有 → 維持原本的 `message`，label 與 text 都是 title：按鈕上寫什麼、
 *   按下去就送出什麼（schema 已把 title 限制在 LINE 的 label 上限 20 字內）。
 *
 * ⚠️ 為什麼是「擇一」而不是「按鈕開網址、卡面再掛一個 bubble 層的 action」：
 * 一張卡兩個目的地，顧客按同一張卡會依按到哪裡得到不同結果，而店家在後台
 * 只填了一個網址、看不出還有第二個行為。一張卡一個動作，畫面上承諾什麼就做什麼。
 *
 * ⚠️ 可用的 scheme 由 `isAllowedFlexLinkUrl()` 的**白名單**決定，內容完全等於
 * LINE 的 `uri` action 實測收下的那一組（14 分冊 §8.20-b 擁有者裁決「廣告卡全開」）：
 * `https://`／`http://`／`line://`／`tel:`／`mailto:`。
 * 實測退回的 `sms:`／`javascript:`／`data:`／`ftp:`／`file://`／無 scheme 不在內。
 * 完整回應碼見 `FLEX_LINK_URL_SCHEMES` 的說明與 `scripts/verify/flex-menu-validate.cjs`。
 * （hero 圖的 `url` 才是 https-only，那是另一個欄位——§8.20 曾把兩者混為一談。）
 *
 * 這裡再過濾一次是**讀取路徑**的最後一道防線，理由與 imageUrl 那一段相同：
 * jsonb 是自由格式，繞過端點寫進來的網址可能是 LINE 真的會退的 scheme
 * （實測 `javascript:` → 400 `invalid uri scheme`），而那一退是整包 carousel
 * 被退回——顧客一張卡都收不到，不是少一個連結。
 */
function cardAction(card: FlexCard): LineMessage {
  if (isAllowedFlexLinkUrl(card.linkUrl)) {
    return { type: 'uri', label: card.title, uri: card.linkUrl };
  }
  return { type: 'message', label: card.title, text: card.title };
}

/* ------------------------------------------------------------ 對外主函式 */
/**
 * 依店家的 line 設定組出「選單」關鍵字該回什麼。
 *
 * @param lineConfig `tenant_settings.line` 的 jsonb 原文（未經 zod 整包 parse，
 *                   因為 webhook 那一側拿到的就是原始物件）
 * @param shopName   店名，用來替換 `{shopName}`
 */
export function buildFlexMenuOutcome(
  lineConfig: Record<string, unknown>,
  shopName: string,
): FlexMenuOutcome {
  // 只有明確存成 false 才算關閉（schema 預設 true；老資料沒有這個鍵＝啟用）
  if (lineConfig.flexMenuEnabled === false) {
    if (lineConfig.flexMenuFallback === 'SILENT') return { kind: 'SILENT' };
    // ⚠️ HINT 不受 flexShowTip 影響：fallback 本身就是一句提示，再補一句是重複。
    return { kind: 'HINT', messages: [{ type: 'text', text: MSG.fallbackHint }] };
  }

  const cards = normalizeFlexCards(lineConfig.flexCards);
  if (cards.length === 0) return { kind: 'NO_CARDS' };

  const title = applyShopName(lineConfig.flexHeaderTitle ?? '✨ {shopName}', shopName);
  const subtitle = applyShopName(lineConfig.flexHeaderSubtitle, shopName);
  const header = { title, subtitle, color: safeColor(lineConfig.flexHeaderColor) };

  const bubbles = cards.map((c) => buildBubble(c, header));
  // altText 是通知列文字：用 header 標題（＝店名），沒有就退回第一張卡的標題。
  // 不編造第三個字串——這兩者都是店家自己輸入的內容。
  const altText = (title || cards[0].title).slice(0, ALT_TEXT_MAX);

  const carousel: LineMessage = {
    type: 'flex', altText, contents: { type: 'carousel', contents: bubbles },
  };

  /*
   * `flexShowTip`（06 分冊 §6.2.10，語意是我們選的——見 MSG.usageTip 的說明）：
   * 開啟時在 carousel **之後**多送一則純文字提示。
   *
   * ⚠️ 只有明確存成 false 才算關閉（schema 預設 true；老資料沒有這個鍵＝開啟），
   *    寫法與上面的 flexMenuEnabled 一致。
   * ⚠️ **只在 FLEX 生效**：HINT 本身就是一句提示、SILENT 是店家明講「完全不回」，
   *    NO_CARDS 交給呼叫端決定——在那三種情況加東西就是把開關做假。
   * ⚠️ **不做成「carousel 最前面插一張提示卡」**：carousel 上限 12 bubbles
   *    （MAX_FLEX_CARDS），店家編滿 12 張時提示卡會擠掉第 12 張，要嘛整包被 LINE 退
   *    （顧客一張都收不到），要嘛我們自己砍一張而畫面說已儲存。
   */
  const showTip = lineConfig.flexShowTip !== false;
  const messages = showTip
    ? [carousel, { type: 'text', text: MSG.usageTip } as LineMessage]
    : [carousel];

  return { kind: 'FLEX', bubbleCount: bubbles.length, messages };
}

/* ------------------------------------------------- Rich Menu 格子的 action */
/**
 * Rich Menu 一格 → LINE 的 action 物件。
 *
 * `POST /api/settings/line/rich-menu/create` 唯一的 action 產生處。
 * FLEX_POPUP 的格子送出 `FLEX_POPUP_TRIGGER_TEXT`，於是它跟顧客自己打「選單」
 * 走**完全相同**的路徑，回覆由本檔的 `buildFlexMenuOutcome()` 產生——
 * 兩處不會有兩份 Flex 組裝邏輯可以分岔。
 */
export function richMenuCellAction(cell: RichMenuCell): LineMessage {
  if (cell.action === 'OPEN_URL') {
    return { type: 'uri', label: cell.label, uri: cell.uri ?? '' };
  }
  return {
    type: 'message',
    label: cell.label,
    text: cell.action === 'FLEX_POPUP' ? FLEX_POPUP_TRIGGER_TEXT : cell.text,
  };
}

/* ------------------------------------------------- 預約步驟引導卡的 bubble */
/**
 * 預約步驟引導卡（06 分冊 §6.2.9）的 bubble。
 *
 * ⚠️ **為什麼組裝在這裡而不是 `src/server/booking-step-guide.ts`：**
 * 本專案有一條守門測試釘住「src/ 底下只有 flex-menu.ts 會組 bubble / carousel」。
 * 引導卡確實是一種新的卡片、不是主選單卡的第二份，但把 Flex JSON 的組裝散出去
 * 之後，那條守門就只能靠白名單維持——白名單一開，下一個人加第三個檔案時
 * 不會有任何東西攔他。步驟資料與 schema 留在 booking-step-guide.ts，
 * **只有「變成 Flex JSON」這一步在本檔**。
 *
 * `title` 為空的步驟**跳過不畫**：LINE 的 text 元件不接受空字串，塞空字串整包會被
 * 退回 400——那是「顧客一則都收不到」而不是「少一行」（同上面 subtitle 的處理）。
 * 原站的 `SUCCESS` 那一格就是空的（規格裡它是唯讀提示，不是可填欄位）。
 */
export function buildStepGuideBubble(
  steps: { title: string; color: string }[],
  header: { title: string; hint: string },
): LineMessage {
  const visible = steps.filter((s) => s.title);
  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical', paddingAll: '12px',
      backgroundColor: safeColor(visible[0]?.color),
      contents: [
        { type: 'text', text: header.title, color: '#FFFFFF', weight: 'bold', size: 'sm', wrap: true },
        { type: 'text', text: header.hint, color: '#FFFFFF', size: 'xs', wrap: true },
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: visible.map((s, i) => ({
        type: 'box', layout: 'baseline', spacing: 'sm',
        contents: [
          { type: 'text', text: String(i + 1), color: safeColor(s.color), size: 'sm', flex: 1, weight: 'bold' },
          { type: 'text', text: s.title, size: 'sm', color: '#333333', flex: 9, wrap: true },
        ],
      })),
    },
  };
}
