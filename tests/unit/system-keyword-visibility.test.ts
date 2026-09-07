/**
 * 「系統內建關鍵字的停用開關一律看得到」不可回歸測試（14 分冊 §8.19 擁有者裁決）
 * -----------------------------------------------------------------------------
 * 舊寫法把標了 `feature` 的組（行程／出團日期，TOUR_MODULE）從畫面上濾掉：
 *
 *   const visibleGroups = t.system.groups.filter(
 *     (g) => !('feature' in g) || activeFeatures.includes(g.feature),
 *   );
 *
 * 但 webhook 分支 ④ 對這些關鍵字**沒有任何 feature 閘門**——退訂之後顧客打「行程」，
 * bot 照樣回覆，而店家**看不到那個開關、關不掉**。
 *
 * 這與 §8.16（系統關鍵字）／§8.16-b（自訂關鍵字的停用與刪除）是**同一個原則**：
 * **收費擋的是「多做一件事」，不是「少做一件事」。** 一間退訂的店家沒辦法讓 bot
 * 閉嘴，在診所那種要求對外訊息由專人處理的業態是合規問題，不只是體驗問題。
 * 同一個原則在專案裡不能只執行一半。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { keywordRepliesPage as t } from '@/i18n/zh-TW/pages/keyword-replies';

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf-8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const page = stripComments(src('src/app/tenant/keyword-replies/page.tsx'));

describe('系統內建關鍵字：停用開關一律看得到（§8.19）', () => {
  it('visibleGroups 不再依訂閱狀態過濾', () => {
    expect(page).toContain('const visibleGroups = t.system.groups;');
    // 舊的過濾寫法不得回來
    expect(page, 'visibleGroups 又開始用 activeFeatures 過濾——退訂的店家會關不掉 bot')
      .not.toMatch(/visibleGroups[\s\S]{0,200}\.filter\([\s\S]{0,200}activeFeatures\.includes/);
  });

  it('未訂閱的模組組別會標示原因，不是無聲出現讓店家以為系統跑錯', () => {
    expect(page).toContain('t.system.unsubscribedModuleNote(');
    expect(page).toMatch(/!activeFeatures\.includes\(/);
  });

  it('那句說明講出「開關仍可用」這個關鍵事實', () => {
    const note = t.system.unsubscribedModuleNote('行程模組');
    expect(note).toContain('行程模組');
    expect(note).toMatch(/仍會回應|開關保持可用/);
  });

  it('標了 feature 的組確實存在（否則這條測試等於沒在測東西）', () => {
    const gated = t.system.groups.filter((g) => 'feature' in g);
    expect(gated.length).toBeGreaterThan(0);
    for (const g of gated) {
      const code = (g as { feature: string }).feature;
      expect(t.system.moduleNames[code], `${code} 沒有對應的中文模組名，畫面會直接印出代碼`)
        .toBeTruthy();
    }
  });
});
