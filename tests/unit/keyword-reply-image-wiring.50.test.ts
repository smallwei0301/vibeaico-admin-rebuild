/**
 * 關鍵字回覆「附加圖片」接線 — 單元測試（GitHub issue #50）
 * -----------------------------------------------------------------------------
 * 這一檔釘的是**一段在此之前完全沒有作用的 UI**：`/tenant/keyword-replies` 的
 * 附加圖片欄位是一個 `disabled` 的 `<input type="file">`，畫面上寫著「尚未建置」。
 *
 * ⚠️ 值得寫下來的是**缺口有多小**：webhook 端早就會送圖
 * （`keywordReplyMessage()` 在 `reply_type='IMAGE'` 且 `content.imageUrl` 有值時
 * 組 LINE image message）、service 層 `toApiPayload()` 也早就會依 `imageUrl`
 * 把 `replyType` 設成 `'IMAGE'`、`keyword-reply-images` 這個 storage bucket
 * 也早就在 `0073_restore_keyword_reply_storage_write.sql` 的寫入允許清單裡。
 * **唯一缺的是 `/api/upload` 的 ALLOWED_BUCKETS 沒有它。** 一個白名單漏一項，
 * 讓整條鏈路對使用者呈現為「這個功能不存在」。
 *
 * 所以本檔的斷言集中在「那條鏈路的每一節是否真的接上」，而不是畫面長相。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { keywordRepliesPage } from '@/i18n/zh-TW/pages/keyword-replies';
import { toApiPayload, type KeywordReplyRow } from '@/services/keyword-replies';

const ROOT = process.cwd();
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

const PAGE = 'src/app/tenant/keyword-replies/page.tsx';
const UPLOAD_ROUTE = 'src/app/api/upload/route.ts';
const UPLOAD_SERVICE = 'src/services/upload.ts';
const BUCKET = 'keyword-reply-images';

describe('bucket 白名單：缺這一項就等於整個功能不存在', () => {
  it('/api/upload 的 ALLOWED_BUCKETS 收 keyword-reply-images', () => {
    const src = read(UPLOAD_ROUTE);
    const block = src.slice(src.indexOf('const ALLOWED_BUCKETS'), src.indexOf('const MAX_BYTES'));
    expect(block).toContain(`'${BUCKET}'`);
  });

  it('UploadBucket 型別也有它（型別與端點是同一份白名單的兩半）', () => {
    expect(read(UPLOAD_SERVICE)).toContain(`| '${BUCKET}'`);
  });

  it('storage 寫入政策允許這個 bucket', () => {
    const policy = read('supabase/migrations/0073_restore_keyword_reply_storage_write.sql');
    expect(policy).toContain(BUCKET);
  });

  /**
   * ⚠️ **這一條是被 CI 逼出來的，而且它擋的正是我犯過的那個推論錯誤。**
   *
   * 我原本看到 `0072`/`0073` 的 `p_storage_write` 允許清單裡列了這個 bucket，
   * 就推論「bucket 本來就存在」。**政策提到一個 bucket，不代表那個 bucket 存在**
   * ——授權規則與物件本身是兩回事，`bucket_id in (...)` 只是字串比對，
   * Postgres 不會因為引用了不存在的 bucket 而抱怨。
   *
   * 實查三個環境：canonical TEST 有（來自一條從未併回 main 的分支 migration）、
   * 正式庫沒有、從 0001 全新建起也沒有。於是上傳在 local-isolated 回 500 SYS_001，
   * 而在 TEST 上會「看起來正常」——最容易騙過人的組合。
   *
   * 所以這裡驗的是**有沒有哪一支 canonical migration 真的 insert 進 storage.buckets**，
   * 不是「有沒有被提到」。
   */
  it('**有 canonical migration 真的建立這個 bucket**（政策提到它不等於它存在）', () => {
    const dir = resolve(ROOT, 'supabase/migrations');
    const creators = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => {
        const sql = readFileSync(resolve(dir, f), 'utf8');
        const insertAt = sql.search(/insert\s+into\s+storage\.buckets/i);
        if (insertAt < 0) return false;
        // 只看 insert 之後那一段，避免把檔頭註解裡提到的 bucket 名字算進去
        return sql.slice(insertAt).includes(`'${BUCKET}'`);
      });
    expect(
      creators,
      `沒有任何 canonical migration 建立 ${BUCKET}——政策允許清單提到它不算`,
    ).not.toEqual([]);
  });

  it('bucket 必須是 public（LINE 要能直接抓圖，抓不到會整則訊息被退）', () => {
    const dir = resolve(ROOT, 'supabase/migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(resolve(dir, f), 'utf8'))
      .find((body) => {
        const at = body.search(/insert\s+into\s+storage\.buckets/i);
        return at >= 0 && body.slice(at).includes(`'${BUCKET}'`);
      })!;
    const at = sql.search(/insert\s+into\s+storage\.buckets/i);
    expect(sql.slice(at)).toMatch(
      new RegExp(`'${BUCKET}'\\s*,\\s*'${BUCKET}'\\s*,\\s*true`),
    );
  });
});

describe('頁面接線：選檔真的會上傳，而且只在成功後才寫進 draft', () => {
  const page = read(PAGE);

  it('從 @/services/upload 匯入 uploadImage（不自組第二套上傳）', () => {
    const m = page.match(/import\s*\{([^}]*)\}\s*from\s*'@\/services\/upload'/);
    expect(m, '頁面沒有從 @/services/upload 匯入任何東西').not.toBeNull();
    expect(m![1].split(',').map((x) => x.trim())).toContain('uploadImage');
  });

  it('上傳時指定的正是 keyword-reply-images', () => {
    expect(page).toContain(`uploadImage(file, '${BUCKET}')`);
  });

  it('file input 已不再 disabled，且有 onChange（原本兩者皆缺）', () => {
    const start = page.indexOf('<Input\n                    type="file"');
    expect(start, 'file input 不見了').toBeGreaterThan(-1);
    const input = page.slice(start, page.indexOf('/>', start));
    expect(input).toContain('onChange=');
    // 只在上傳中才停用；不得是無條件 disabled
    expect(input).toContain('disabled={imageUploading}');
    expect(input).not.toMatch(/disabled\s*\/?>/);
  });

  it('accept 與端點的 ALLOWED_TYPES 一致，不是 image/*', () => {
    // image/* 會讓使用者選得到 HEIC 之類端點會退的格式，選了才被拒是多一次白工
    expect(page).toContain('accept="image/jpeg,image/png,image/webp"');
    const route = read(UPLOAD_ROUTE);
    for (const mime of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(route).toContain(`'${mime}'`);
    }
  });

  it('**只有上傳成功才設 imageUrl**：setDraft 在 await uploadImage 之後、catch 之外', () => {
    const fn = page.slice(page.indexOf('const onPickImage'), page.indexOf('const openCreate'));
    const uploadAt = fn.indexOf('await uploadImage(');
    const setAt = fn.indexOf('imageUrl: url');
    const catchAt = fn.indexOf('} catch');
    expect(uploadAt).toBeGreaterThan(-1);
    expect(setAt, 'setDraft 不在 await uploadImage 之後 = 樂觀寫入').toBeGreaterThan(uploadAt);
    expect(setAt, 'setDraft 落在 catch 之後 = 失敗也會寫進去').toBeLessThan(catchAt);
    // 失敗時顯示後端真實訊息，不是一句自己編的「失敗」
    expect(fn).toContain('e instanceof ApiError ? e.message');
  });

  it('預覽用的是已上傳的真實 URL，不是本機 ObjectURL', () => {
    // 看得到圖就代表 LINE 抓得到同一個網址；ObjectURL 只在這台瀏覽器有效
    expect(page).toContain('src={draft.imageUrl}');
    expect(page).not.toContain('URL.createObjectURL');
  });
});

describe('文案：不得再宣稱「尚未建置」', () => {
  it('imageNotBuilt 這個鍵已經不存在', () => {
    expect(Object.keys(keywordRepliesPage.form)).not.toContain('imageNotBuilt');
  });

  it('全 src 沒有任何一處還寫著附加圖片尚未建置', () => {
    // 註解裡回顧歷史可以，畫面文案不行——所以比對的是字典值，不是原始碼
    const values = JSON.stringify(keywordRepliesPage);
    expect(values).not.toContain('尚未建置');
  });

  it('上傳失敗的文案只有一份（沿用 messages.imageUploadFailedPrefix）', () => {
    // 同一句話存兩份，改了其中一份就會兩處不一致，而且沒有任何測試會紅
    expect(Object.keys(keywordRepliesPage.form)).not.toContain('imageUploadFailedPrefix');
    expect(keywordRepliesPage.messages.imageUploadFailedPrefix).toBeTruthy();
  });
});

describe('契約：有圖就是 IMAGE 回覆（這一段本來就在，這裡釘住不被改壞）', () => {
  const row = (imageUrl: string): Omit<KeywordReplyRow, 'id'> => ({
    keyword: '優惠',
    matchType: 'EXACT',
    actionType: 'REPLY_CONTENT',
    replyText: '本月優惠',
    imageUrl,
    linkUrl: '',
    linkLabel: '',
    enabled: true,
    overridesSystem: '',
  });

  it('有 imageUrl → replyType 變成 IMAGE，且 URL 進 content', () => {
    const payload = toApiPayload(row('https://example.com/a.png'));
    expect(payload.replyType).toBe('IMAGE');
    expect((payload.content as any).imageUrl).toBe('https://example.com/a.png');
  });

  it('沒有 imageUrl → 維持 TEXT（移除圖片後不得還宣告成 IMAGE）', () => {
    expect(toApiPayload(row('')).replyType).toBe('TEXT');
  });
});
