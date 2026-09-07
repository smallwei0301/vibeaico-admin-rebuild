/**
 * Rich Menu 六格文字 × 系統內建關鍵字 15 組 —— webhook 覆蓋率不可回歸測試
 * （GitHub issue #5 「修復-3」第 ③ ④ 項驗收）
 * -----------------------------------------------------------------------------
 * 為什麼需要這一份：
 *   `/api/settings/line/rich-menu/create` 發布出去的六格全是 **message action**，
 *   顧客按下去等於在聊天室送出 `MODE_PRESETS[businessType].richMenuCells[i].text`
 *   那段文字。那段文字若沒有任何 handler 認得，顧客按了選單就是**沒反應**
 *   （14 分冊 §2 根因 B）。三業態 × 六格 ＝ 18 段，每一段都必須被
 *   `resolveBuiltinIntent()` 解析到一個意圖，而該意圖必須在
 *   `replyBuiltin()` 裡有 `case`。
 *
 * ⚠️ 刻意用**程式化列舉**（走訪 MODE_PRESETS / i18n 的 system.groups）而不是手寫
 *    18 段字面值：以後有人在 `modes.ts` 加一格、或在 i18n 加一個同義詞卻忘了補
 *    handler，這份測試會自動轉紅。手寫清單則會跟著漏掉，測試永遠綠、顧客永遠
 *    按了沒反應。
 *
 * 範圍界線：這裡驗的是「認不認得」（純函式，可在 node 環境跑）。
 *   「認得之後真的回了一則非 defaultReply 的訊息」需要 DB + mock LINE，
 *   由 tests/integration/api/keyword-replies.05.test.ts 的
 *   「三業態 18 格 rich menu 文字逐一打 webhook」負責。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BUSINESS_TYPES, MODE_PRESETS } from '@/config/modes';
import { keywordRepliesPage } from '@/i18n/zh-TW/pages/keyword-replies';
import {
  RICH_MENU_TEXT_INTENT,
  SYSTEM_KEYWORD_GROUPS,
  resolveBuiltinIntent,
} from '@/server/line-events';

const LINE_EVENTS_SRC = readFileSync(
  fileURLToPath(new URL('../../src/server/line-events.ts', import.meta.url)),
  'utf-8',
);

/** `replyBuiltin()` 的 switch 真的有這個 case（沒有 case = 落到 default → 不回應） */
function hasReplyBranch(intent: string): boolean {
  return new RegExp(`case '${intent}':`).test(LINE_EVENTS_SRC);
}

describe('Rich Menu 六格文字全部有 handler（issue #5 ③；06 §3 補列規格）', () => {
  // 三業態 × 六格 = 18 段，逐格列舉（it.each 讓紅燈直接指出是哪一格）
  const cells = BUSINESS_TYPES.flatMap((bt) =>
    MODE_PRESETS[bt].richMenuCells.map((c, i) => ({ bt, i, label: c.label, text: c.text })),
  );

  it('三業態各六格、共 18 格（少一格代表 modes.ts 被改動，發布出去的選單會缺格）', () => {
    expect(cells).toHaveLength(18);
    for (const bt of BUSINESS_TYPES) expect(MODE_PRESETS[bt].richMenuCells).toHaveLength(6);
  });

  it.each(cells)('$bt 第 $i 格「$label」送出的「$text」→ webhook 認得', ({ text }) => {
    const hit = resolveBuiltinIntent(text);
    expect(hit, `richMenuCells 的「${text}」沒有任何 handler：顧客按這一格會完全沒反應`)
      .not.toBeNull();
    expect(hasReplyBranch(hit!.intent), `replyBuiltin() 沒有 case '${hit!.intent}'`).toBe(true);
  });

  it('每一格的文字都收錄在 RICH_MENU_TEXT_INTENT 或系統關鍵字 15 組（兩邊同一份常數）', () => {
    for (const { text } of cells) {
      const inRichMenuTable = text in RICH_MENU_TEXT_INTENT;
      const inSystemGroups = Object.values(SYSTEM_KEYWORD_GROUPS).some((ws) => ws.includes(text));
      expect(inRichMenuTable || inSystemGroups, `「${text}」兩張表都查不到`).toBe(true);
    }
  });

  it('尚未建置的功能（GUIDE 團次／我的訂單、CLINIC 看診進度）仍解析得到意圖', () => {
    // 這三格對應 Phase 8b 尚未落地的資料表；規格要求「誠實回覆功能準備中」而非沉默，
    // 所以它們一樣必須解析成功並有 case（回覆內容由整合測試驗）。
    expect(resolveBuiltinIntent('團次')?.intent).toBe('DEPARTURE');
    expect(resolveBuiltinIntent('我的訂單')?.intent).toBe('ORDER');
    expect(resolveBuiltinIntent('看診進度')?.intent).toBe('CLINIC_QUEUE');
    for (const intent of ['DEPARTURE', 'ORDER', 'CLINIC_QUEUE']) {
      expect(hasReplyBranch(intent)).toBe(true);
    }
  });
});

describe('系統內建關鍵字 15 組含全部同義詞（issue #5 ④；06 §3 補列規格）', () => {
  const groups = keywordRepliesPage.system.groups;
  const synonyms = groups.flatMap((g) => g.keywords.map((k) => ({ key: g.key, label: g.label, k })));

  it('SYSTEM_KEYWORD_GROUPS 直接由 i18n 的 system.groups 組出（不得在 webhook 複寫一份）', () => {
    expect(Object.keys(SYSTEM_KEYWORD_GROUPS)).toHaveLength(15);
    expect(Object.keys(SYSTEM_KEYWORD_GROUPS)).toEqual(groups.map((g) => g.key));
    for (const g of groups) expect(SYSTEM_KEYWORD_GROUPS[g.key]).toEqual(g.keywords);
    // 後台頁面列出來的每一組都得有 handler，否則頁面上那顆開關管的是空氣
    for (const g of groups) expect(hasReplyBranch(g.key), `replyBuiltin() 缺 case '${g.key}'`).toBe(true);
  });

  it.each(synonyms)('$label 組的同義詞「$k」→ 命中 $key 且掛在可停用的組上', ({ key, k }) => {
    const hit = resolveBuiltinIntent(k);
    expect(hit, `系統關鍵字「${k}」webhook 不認得`).not.toBeNull();
    // group 非 null＝這個字受 keyword-replies 頁那顆開關管；null 代表停用開關對它無效
    expect(hit!.group, `「${k}」解析後 group 是 ${hit!.group}，停用開關會失效`).toBe(key);
  });

  it('不認得的字回 null（才會落到 ⑤ AI / ⑥ defaultReply，而不是被內建指令吃掉）', () => {
    expect(resolveBuiltinIntent('請問今天有空位嗎')).toBeNull();
    expect(resolveBuiltinIntent('')).toBeNull();
  });
});
