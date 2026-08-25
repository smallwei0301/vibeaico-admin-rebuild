/**
 * 回報問題的截圖上傳 —— 靜態接線不可回歸測試（GitHub issue #30）
 * -----------------------------------------------------------------------------
 * 由來：issue #28 ① 把 modal 的四個文字欄位接真了，但截圖欄位當時只做到
 * 誠實化（停用＋畫面上說明尚未建置），因為三塊都缺：`bug_reports` 沒有附件
 * 欄位、Storage 白名單沒有可用的 bucket、`/api/bug-report` 契約沒有附件。
 * 14 分冊 §8.14 是擁有者裁決「現在就補」。migration 0019 補齊前兩塊。
 *
 * 這一檔鎖住的是**兩個容易被下一位施工者悄悄弄壞的設計決定**，兩個都不是
 * 風格偏好，而是有具體代價的：
 *
 *  1. `bug-report-attachments` **不是** LINE 去向的 bucket，所以**不得**被加進
 *     `LINE_BOUND_BUCKETS`。回報截圖只會被平台端看，不會變成 LINE image
 *     message，把它塞進 LINE 白名單只會無謂地砍掉 WebP（同畫質更小）。
 *     `tests/unit/upload-line-bound-types.test.ts` 鎖的是反方向（不准為了 LINE
 *     全站砍 WebP），這裡鎖的是「不准為了保險把不相干的 bucket 也一起砍」。
 *
 *  2. bucket **必須是 private**，且端點回的是**簽名 URL**、資料庫存的是
 *     **storage 路徑**而不是 URL。理由見 0019 檔頭與 06 分冊 §8.5：
 *     `chat-images` 之所以 public 是被 LINE 抓圖逼的，代價是「網址即權限、
 *     無身分檢查、外流即失守」。回報截圖沒有那個限制，而敏感度更高
 *     （使用者在畫面出問題的當下截圖，幾乎必然含當時螢幕上的顧客資料）。
 *
 * ⚠️ 為什麼是「讀原始碼」而不是 render / 呼叫測試：本專案沒有安裝
 *    @testing-library/react，單元測試跑在 node 環境（vitest.config.mts）。
 *    「檔案真的上傳成功、bug_reports 的欄位真的指向存在的 storage 物件」由
 *    tests/integration/api/bug-report-attachment.30.test.ts 負責。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { common } from '@/i18n/zh-TW/common';

const MODAL = 'src/components/layout/BugReportModal.tsx';
const UPLOAD_ROUTE = 'src/app/api/upload/route.ts';
const UPLOAD_SERVICE = 'src/services/upload.ts';
const REPORT_ROUTE = 'src/app/api/bug-report/route.ts';
const REPORT_SERVICE = 'src/services/bug-report.ts';

const src = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8');

/** 去掉註解，避免「解釋為什麼不能這樣寫」的說明被誤判成違規程式碼 */
const withoutComments = (code: string): string =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const BUCKET = 'bug-report-attachments';

describe('/api/upload：bug-report-attachments 是白名單內、但不是 LINE 去向的 bucket', () => {
  const code = withoutComments(src(UPLOAD_ROUTE));

  it('bucket 在 ALLOWED_BUCKETS 內（否則端點會擋在「不允許的 bucket」）', () => {
    const table = code.slice(code.indexOf('const ALLOWED_BUCKETS'), code.indexOf('const MAX_BYTES'));
    expect(table).toContain(`'${BUCKET}'`);
  });

  it('bucket **不在** LINE_BOUND_BUCKETS 內（回報截圖不會送去 LINE，WebP 必須保留）', () => {
    const lineSet = code.slice(
      code.indexOf('const LINE_BOUND_BUCKETS'),
      code.indexOf('const WEB_TYPES'),
    );
    expect(lineSet).not.toContain(BUCKET);
  });

  it('bucket 被標記為 private，且 private bucket 回簽名 URL 而不是 getPublicUrl', () => {
    expect(code).toMatch(
      new RegExp(`PRIVATE_BUCKETS\\s*=\\s*new Set\\(\\[[^\\]]*'${BUCKET}'[^\\]]*\\]\\)`),
    );
    expect(code).toMatch(/PRIVATE_BUCKETS\.has\(bucket\)/);
    expect(code).toMatch(/createSignedUrl\(/);
  });

  it('回應多帶 path（資料庫要存路徑而不是會過期的簽名 URL）', () => {
    expect(code).toMatch(/ok\(\{[\s\S]{0,200}path[\s\S]{0,200}\}\)/);
  });
});

describe('services/upload.ts：新 bucket 進型別、且拿得到 path（DoD 10 的第三段）', () => {
  const code = withoutComments(src(UPLOAD_SERVICE));

  it('UploadBucket union 含 bug-report-attachments', () => {
    const union = code.slice(code.indexOf('export type UploadBucket'), code.indexOf('export async'));
    expect(union).toContain(`'${BUCKET}'`);
  });

  it('有回傳 path 的上傳函式（uploadImage 只回 url，存不了路徑）', () => {
    expect(code).toMatch(/export async function uploadFile/);
    expect(code).toMatch(/path: string/);
    expect(code).toMatch(/fetch\(`\$\{base\}\/api\/upload`/);
  });
});

describe('/api/bug-report：契約收 attachmentPath，且不憑空相信用戶端給的路徑', () => {
  const code = withoutComments(src(REPORT_ROUTE));

  it('bodySchema 有 attachmentPath', () => {
    const schema = code.slice(code.indexOf('const bodySchema'), code.indexOf('export const POST'));
    expect(schema).toMatch(/attachmentPath:\s*z\.string\(\)/);
  });

  it('寫進 bug_reports.attachment_path（0019 的欄位）', () => {
    expect(code).toMatch(/attachment_path:/);
  });

  it('附件路徑必須是自己租戶的資料夾（不得指向別家店的物件）', () => {
    expect(code).toMatch(/startsWith\(`\$\{t\.tenantId\}\/`\)/);
  });

  it('附件路徑必須真的存在於 storage 才寫進去（不准存一個指向空氣的路徑）', () => {
    expect(code).toMatch(/storage\s*\n?\s*\.from\(BUG_REPORT_ATTACHMENT_BUCKET\)|storage\.from\(BUG_REPORT_ATTACHMENT_BUCKET\)/);
    expect(code).toMatch(/\.info\(/);
  });
});

describe('services/bug-report.ts：BugReportInput 帶 attachmentPath', () => {
  const code = withoutComments(src(REPORT_SERVICE));

  it('型別有 attachmentPath?（否則 modal 傳了也編譯不過／送不出去）', () => {
    expect(code).toMatch(/attachmentPath\?: string/);
  });
});

describe('BugReportModal：截圖欄位真的會上傳（issue #30；取代 #28 的誠實化狀態）', () => {
  const code = withoutComments(src(MODAL));

  it('截圖欄位不再 disabled', () => {
    const tagStart = code.indexOf('id="bugShot"');
    expect(tagStart, '找不到 id="bugShot"').toBeGreaterThan(-1);
    const tag = code.slice(tagStart, code.indexOf('/>', tagStart));
    expect(tag).not.toMatch(/disabled/);
    expect(tag).toMatch(/onChange=\{/);
  });

  it('「尚未建置」的說明與字典鍵都已移除（留著就是新的假的已知：功能已經有了）', () => {
    expect(code).not.toMatch(/screenshotNotBuilt/);
    expect(common.bugReport).not.toHaveProperty('screenshotNotBuilt');
  });

  it('選到的檔案有 state，且送出時經 services 的 uploadFile 上傳', () => {
    expect(code).toMatch(/const \[screenshot, setScreenshot\] = React\.useState/);
    expect(code).toMatch(/import \{ uploadFile \} from '@\/services\/upload'/);
    const submit = code.slice(code.indexOf('const submit'), code.indexOf('return ('));
    expect(submit).toMatch(/await uploadFile\(\s*screenshot,\s*'bug-report-attachments'\s*\)/);
    expect(submit).toMatch(/attachmentPath/);
  });

  it('上傳在成功訊息之前（鐵則 12：成功訊息不得早於動作），失敗走 danger', () => {
    const submit = code.slice(code.indexOf('const submit'), code.indexOf('return ('));
    expect(submit.indexOf('await uploadFile(')).toBeGreaterThan(-1);
    expect(submit.indexOf('await uploadFile(')).toBeLessThan(submit.indexOf('toast.show(t.submitted)'));
    expect(submit.indexOf('await submitBugReport(')).toBeLessThan(submit.indexOf('toast.show(t.submitted)'));
    expect(submit).toMatch(/catch[\s\S]*toast\.show\([\s\S]*'danger'\)/);
  });

  it('元件不自己 fetch（CLAUDE.md「Pages never fetch」）', () => {
    expect(code).not.toMatch(/fetch\(/);
  });

  it('前端先擋格式與大小，訊息走 i18n（鐵則 1：零硬編碼中文）', () => {
    expect(code).toMatch(/screenshotTooLarge/);
    expect(code).toMatch(/screenshotBadType/);
    expect(common.bugReport.screenshotTooLarge).toMatch(/5MB/);
    expect(common.bugReport.screenshotBadType).toMatch(/WebP/);
    const cjk = code.match(/[一-鿿　-〿＀-￯]/g);
    expect(cjk ?? [], `仍有中文字面量：${(cjk ?? []).join('')}`).toEqual([]);
  });

  it('畫面上說得出「這張圖不會公開」（隱私承諾要寫在使用者讀得到的地方）', () => {
    expect(code).toMatch(/t\.screenshotHint/);
    expect(common.bugReport.screenshotHint).toMatch(/不公開|不會公開/);
  });
});
