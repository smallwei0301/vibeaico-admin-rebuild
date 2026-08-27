/**
 * 靜態鎖：CLINIC 的三個名詞統一（14 分冊 §8.17，擁有者裁決）
 * -----------------------------------------------------------------------------
 * 依據：`docs/integration/14-GAP-AUDIT.md` §8.17（解開 §8.13-b「CLINIC 四個
 * 名字」的懸案）：
 *
 *   目錄（賣什麼） → 診療項目
 *   訂單（誰買了） → 掛號紀錄
 *   員工           → 醫師
 *
 * §8.13-b 盤出同一個東西在診所眼裡曾有四個名字（側邊欄「診療項目」／開店步驟
 * 「看診項目」／LINE 選單 label「看診項目」／LINE 選單送出文字與預約表單「服務
 * 項目」）。本檔鎖住收斂後的結果，避免有人日後又改回其中一個舊名。
 *
 * ⚠️ 這裡刻意不重複 `tests/unit/line-keyword-coverage.test.ts` 已經鎖住的
 * `richMenuCells[].text`（LINE 送出文字，webhook 依賴，不可動）——只鎖使用者
 * 看得到的 `label` 與其餘文案。text 是否仍對得上 handler，交給那份測試把關。
 */
import { describe, expect, it } from 'vitest';

import { MODE_PRESETS } from '@/config/modes';
import { catalogLabel, navLabel, ordersLabel, resolveNavTerms } from '@/i18n/zh-TW/nav';
import { dashboardPage, setupStepLabel } from '@/i18n/zh-TW/pages/dashboard';
import { bookingsPage } from '@/i18n/zh-TW/pages/bookings';
import { clinicQueuePage } from '@/i18n/zh-TW/pages/clinic-queue';

describe('§8.17 CLINIC 三個名詞：診療項目／掛號紀錄／醫師', () => {
  it('目錄：catalogLabel 三模式互不相同，CLINIC 是「診療項目」', () => {
    expect(catalogLabel('LOCAL_SHOP')).toBe('服務項目');
    expect(catalogLabel('GUIDE')).toBe('行程與方案');
    expect(catalogLabel('CLINIC')).toBe('診療項目');
  });

  it('訂單：ordersLabel 三模式互不相同，CLINIC 是「掛號紀錄」（§8.13 當時暫借 LOCAL_SHOP 的「預約列表」已由 §8.17 收斂）', () => {
    expect(ordersLabel('LOCAL_SHOP')).toBe('預約列表');
    expect(ordersLabel('GUIDE')).toBe('旅遊訂單');
    expect(ordersLabel('CLINIC')).toBe('掛號紀錄');
  });

  it('員工：CLINIC 的 staffTerm 與側邊欄 staff 標籤都是「醫師」', () => {
    expect(MODE_PRESETS.CLINIC.staffTerm).toBe('醫師');
    expect(navLabel('staff', 'CLINIC')).toBe('醫師管理');
  });

  it('LINE 圖文選單：CLINIC 第 2 格 label 為「診療項目」；text 維持「服務項目」不動（webhook 依賴，見 line-keyword-coverage.test.ts）', () => {
    const cell = MODE_PRESETS.CLINIC.richMenuCells[2];
    expect(cell.label).toBe('診療項目');
    expect(cell.text).toBe('服務項目');
  });

  it('開店步驟：CLINIC 的「設定{catalog}」展開為「設定診療項目」，不再是舊名「設定看診項目」', () => {
    expect(setupStepLabel('SERVICE', 'CLINIC')).toBe('設定診療項目');
    expect(setupStepLabel('SERVICE', 'LOCAL_SHOP')).toBe('設定服務項目');
    expect(setupStepLabel('SERVICE', 'GUIDE')).toBe('設定行程與方案');
    // CLINIC 已不再對 SERVICE 步驟做字面覆寫（{catalog} 展開已經是對的）
    expect(dashboardPage.stepOverrides.CLINIC).not.toHaveProperty('SERVICE');
  });

  it('預約表單：新增／編輯 modal 的服務欄位對 CLINIC 展開為「診療項目 *」', () => {
    expect(resolveNavTerms(bookingsPage.createModal.service, 'CLINIC')).toBe('診療項目 *');
    expect(resolveNavTerms(bookingsPage.editModal.service, 'CLINIC')).toBe('診療項目 *');
    expect(resolveNavTerms(bookingsPage.createModal.serviceInvalid, 'CLINIC')).toBe('請選擇診療項目');
    // LOCAL_SHOP／GUIDE 不因本輪改動而變（誤傷檢查）
    expect(resolveNavTerms(bookingsPage.createModal.service, 'LOCAL_SHOP')).toBe('服務項目 *');
    expect(resolveNavTerms(bookingsPage.createModal.service, 'GUIDE')).toBe('行程與方案 *');
  });

  it('看診號碼掛號頁：使用步驟卡引用目錄頁時展開為「診療項目」', () => {
    expect(resolveNavTerms(clinicQueuePage.guide.alsoInServicesLead, 'CLINIC')).toBe(
      '看診項目也會出現在「診療項目」頁（進階設定可去那裡改）；',
    );
  });
});
