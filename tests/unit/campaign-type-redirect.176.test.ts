import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { campaignsPage } from '@/i18n/zh-TW/pages/campaigns';

/**
 * Issue #176 (b)：活動頁不再提供「生日／喚回」兩種類型的新增入口，導向通知設定頁。
 *
 * 為什麼要有這一份：生日祝福與顧客喚回真的每天在跑（cron），但發送內容讀的是
 * tenant_settings.notify（通知設定頁），不是這一頁存的 campaigns.content。在這裡
 * 新建一個生日活動，店家填的訊息永遠不會被讀到，而畫面顯示成功——是假成功。
 */
const page = readFileSync(
  resolve(process.cwd(), 'src/app/tenant/campaigns/page.tsx'),
  'utf8',
);

describe('Issue #176 (b) 活動類型導向通知設定', () => {
  it('宣告了要導向的兩型，且恰好是 BIRTHDAY 與 RECALL', () => {
    const m = page.match(/const REDIRECTED_TYPES: CampaignType\[\] = \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const listed = [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
    expect(listed).toEqual(['BIRTHDAY', 'RECALL']);
  });

  it('新增時的預設類型不得是被導向的兩型——否則 filter 的例外會讓它又冒出來', () => {
    // 這是本變更最容易寫錯的地方：filter 用 `o.value === type` 保留「編輯既有活動
    // 時它自己的類型」。若新增預設就是 BIRTHDAY，那條例外會讓 BIRTHDAY 出現在新增
    // 選單裡，過濾等於沒做。這條斷言就是釘住它。
    const initial = page.match(/useState<CampaignType>\('([A-Z_]+)'\)/);
    expect(initial).not.toBeNull();
    expect(['BIRTHDAY', 'RECALL']).not.toContain(initial![1]);

    const reset = page.match(/setType\(\(campaign\?\.type \|\| '([A-Z_]+)'\) as CampaignType\)/);
    expect(reset).not.toBeNull();
    expect(['BIRTHDAY', 'RECALL']).not.toContain(reset![1]);
  });

  it('類型下拉有過濾掉被導向的兩型，且保留編輯既有活動時的自身類型', () => {
    expect(page).toContain('.filter((o) => !REDIRECTED_TYPES.includes(o.value as CampaignType) || o.value === type)');
  });

  it('一個欄位都沒有移除——五種類型的顯示名稱與說明全部保留（復原而非取消）', () => {
    // 既有的 BIRTHDAY／RECALL 活動仍要顯示得出名稱，不能變成空白或 raw enum。
    for (const k of ['BIRTHDAY', 'NEW_CUSTOMER', 'SPENDING_THRESHOLD', 'LIMITED_TIME', 'RECALL']) {
      expect(campaignsPage.types).toHaveProperty(k);
      expect(campaignsPage.typeHelp).toHaveProperty(k);
    }
    // typeOptions 本身也不刪——過濾發生在渲染時，資料來源保持完整。
    const values = campaignsPage.form.typeOptions.map((o) => o.value).sort();
    expect(values).toEqual(
      ['BIRTHDAY', 'LIMITED_TIME', 'NEW_CUSTOMER', 'RECALL', 'SPENDING_THRESHOLD'],
    );
  });

  it('仍保有指向通知設定頁的說明（#220 的誠實標示不得被這次變更洗掉）', () => {
    // 連結指向 /tenant/settings（通知設定所在頁），這是 #220 實際採用的寫法。
    expect(page).toContain('href="/tenant/settings"');
  });
});
