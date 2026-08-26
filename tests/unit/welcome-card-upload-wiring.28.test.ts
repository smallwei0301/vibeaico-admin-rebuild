/**
 * 歡迎卡片圖片上傳的接線靜態鎖 — issue #28 ⑥
 * -----------------------------------------------------------------------------
 * 修改前 `src/app/tenant/settings/page.tsx` 那顆「上傳圖片」鈕的 onClick
 * **整個內容**就是 `() => toast.show(t.notification.welcomeCardImageUpdated)`
 * （「歡迎卡片圖片已更新」）：不開檔案選擇器、不上傳、不改任何 state。
 * 全站最赤裸的一筆假成功。
 *
 * 修好之後的鏈路（與 issue #7 的 rich-menu 底圖同一條路）：
 *   選檔 → uploadImage(file,'welcome-card-images') → POST /api/upload
 *        → saveTenantSettings({notify}) → PUT /api/settings → toast
 *
 * 本檔鎖：
 *   ① 上傳鈕改成觸發隱藏的 <input type="file">，不是直接 toast
 *   ② handler 內 `await uploadImage` 與 `await saveTenantSettings` 都在成功
 *      訊息之前——只上傳不存回資料庫的話，重整就沒了，而畫面已說「已更新」
 *   ③ 移除鈕同樣要真的存回去（原本只清本地 state 就報「已移除」）
 *   ④ 新 bucket 三處一致：/api/upload 白名單、LINE 去向白名單、services 型別
 *
 * 變異驗證（實跑確認會轉紅，輸出貼在 issue #28 留言）：
 *   - 把上傳鈕的 onClick 改回只 toast → ① 紅
 *   - 拿掉 handler 裡的 `await saveTenantSettings({ notify })` → ② 紅
 *   - 把 welcome-card-images 從 LINE_BOUND_BUCKETS 拿掉 → ④ 紅
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SETTINGS_PAGE = 'src/app/tenant/settings/page.tsx';
const page = withoutComments(src(SETTINGS_PAGE));

/** 抓某個 `const <name> = async (…) => { … };`（頂層兩格縮排的收尾） */
function asyncFn(code: string, name: string): string | undefined {
  const re = new RegExp(`const ${name} = async \\([\\s\\S]*?\\n  \\};`);
  return code.match(re)?.[0];
}

describe('① 上傳鈕真的開檔案選擇器，不是直接跳成功', () => {
  it('按鈕的 onClick 觸發隱藏的 file input（welcomeImageFileRef）', () => {
    expect(page).toContain('welcomeImageFileRef.current?.click()');
    expect(page).toMatch(/ref=\{welcomeImageFileRef\}[\s\S]{0,200}type="file"/);
  });

  it('沒有任何地方直接 toast「歡迎卡片圖片已更新」而不上傳', () => {
    expect(page).not.toMatch(/onClick=\{\(\) => toast\.show\(t\.notification\.welcomeCardImageUpdated\)\}/);
  });

  it('accept 只收 JPEG / PNG（去向是 LINE，見 /api/upload 的 LINE_BOUND_BUCKETS）', () => {
    expect(page).toMatch(/accept="image\/jpeg,image\/png"/);
  });
});

describe('② 成功訊息排在「上傳」與「存回資料庫」兩個 await 之後', () => {
  const handler = asyncFn(page, 'uploadWelcomeCardImage');

  it('handler 存在且呼叫 uploadImage(file, \'welcome-card-images\')', () => {
    expect(handler).toBeTruthy();
    expect(handler!).toContain("await uploadImage(file, 'welcome-card-images')");
  });

  it('await saveTenantSettings({ notify }) 在 toast 之前（重整後圖片還在的原因）', () => {
    const uploadAt = handler!.indexOf('await uploadImage');
    const saveAt = handler!.indexOf('await saveTenantSettings({ notify })');
    const toastAt = handler!.indexOf('toast.show(t.notification.welcomeCardImageUpdated)');
    expect(uploadAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(uploadAt);
    expect(toastAt).toBeGreaterThan(saveAt);
  });

  it('整組送出（PUT /api/settings 是整組覆蓋，只送一個欄位會把同組打回預設值）', () => {
    expect(handler!).toContain('const notify = { ...draft.notify, welcomeCardImageUrl: url };');
  });
});

describe('③ 移除鈕也真的存回資料庫', () => {
  const handler = asyncFn(page, 'removeWelcomeCardImage');

  it('handler 存在，且 toast 排在 await saveTenantSettings 之後', () => {
    expect(handler).toBeTruthy();
    const saveAt = handler!.indexOf('await saveTenantSettings({ notify })');
    const toastAt = handler!.indexOf('toast.show(t.notification.welcomeCardImageRemoved)');
    expect(saveAt).toBeGreaterThan(-1);
    expect(toastAt).toBeGreaterThan(saveAt);
  });

  it('移除鈕不再只 patchNotify 就宣告已移除', () => {
    expect(page).not.toMatch(/onClick=\{\(\) => \{\s*patchNotify\(\{ welcomeCardImageUrl: '' \}\);/);
  });
});

describe('④ welcome-card-images bucket 三處一致', () => {
  /*
   * ⚠️ 上傳的驗證與落地邏輯在 issue #19 從 `src/app/api/upload/route.ts` 抽到
   * `src/server/upload.ts`（三支上傳端點共用同一支 `uploadToBucket()`，
   * 06 分冊 §6.2.8）。**規則本身一字未改**，只是換了檔案，所以這裡跟著改路徑，
   * 斷言內容維持原樣——放寬斷言才是不可以做的事。
   */
  const route = src('src/server/upload.ts');

  it('/api/upload 的 ALLOWED_BUCKETS 有它', () => {
    const allowed = route.slice(route.indexOf('const ALLOWED_BUCKETS'), route.indexOf('const MAX_BYTES'));
    expect(allowed).toContain("'welcome-card-images'");
  });

  it('/api/upload 的 LINE_BOUND_BUCKETS 有它（只收 JPEG/PNG，不放行 WebP）', () => {
    expect(route).toMatch(/const LINE_BOUND_BUCKETS = new Set\(\[[^\]]*'welcome-card-images'[^\]]*\]\)/);
  });

  it('不在 LINE_PREVIEW_BUCKETS（歡迎卡片沒有 previewImageUrl 可指，多產一張是浪費）', () => {
    expect(route).toMatch(/const LINE_PREVIEW_BUCKETS = new Set\(\['chat-images'\]\)/);
  });

  it('services/upload.ts 的 UploadBucket 型別有它', () => {
    expect(src('src/services/upload.ts')).toContain("| 'welcome-card-images'");
  });

  it('migration 0023 建的是 public bucket，並重建兩條列舉式 storage policy', () => {
    const sql = src('supabase/migrations/0024_welcome_card_images_bucket.sql');
    expect(sql).toContain("('welcome-card-images', 'welcome-card-images', true)");
    expect(sql).toMatch(/create policy p_storage_write[\s\S]*welcome-card-images/);
    expect(sql).toMatch(/create policy p_storage_read[\s\S]*welcome-card-images/);
  });
});
