import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #197 對帳 migration 的契約測試。
 *
 * 這三支是「補帳本」用的：對應的變更已經套在正式庫上，本檔案的存在是為了讓
 * `supabase/migrations/**` 能重現正式庫的狀態。它們有兩個非談判性的性質，
 * 而兩者都是**看不出來的**——少了任何一個，測試仍然全綠、CI 仍然通過，
 * 只有在真的重建資料庫時才會爆：
 *
 *   1. **可重入**：乾淨帳本重建出來的資料庫沒有這些 drift，migration 必須是
 *      no-op 而不是報錯。
 *   2. **雙向自我驗證**（PB-033）：撤權與加權在風險結構上對稱。只斷言「已撤掉」
 *      而不斷言「service_role 沒被誤撤」，會讓一次寫錯的 revoke 把整站打成 403
 *      而 migration 回報成功。
 */
const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8');

/**
 * 否定斷言（「這份 SQL 不得含有 X」）必須只看可執行語句。
 * 第一版沒有剝掉註解，於是 0098 檔頭那句「刻意**不 drop 這兩欄**：drop column
 * 不可逆」讓「不得出現 drop column」的斷言紅了——測試抓到的是它自己的解釋文字。
 * 一個會被說明文字觸發的守門，日後只會逼人改註解來讓 CI 變綠。
 */
const executable = (sql: string) =>
  sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

const ACL = '0097_close_server_only_rpc_public_execute.sql';
const CONTACT = '0098_reconcile_tour_orders_legacy_contact_columns.sql';
const OVERLOAD = '0099_drop_legacy_create_tour_order_overload.sql';

const SERVER_ONLY_RPCS = [
  'subscribe_feature',
  'subscribe_bundle',
  'user_id_by_email',
  'email_exists',
  'next_tour_order_no',
];

describe('#197 正式庫對帳 migration', () => {
  describe('0097 — server-only RPC 的 PUBLIC EXECUTE', () => {
    const sql = read(ACL);

    it.each(SERVER_ONLY_RPCS)('撤掉 %s 的 PUBLIC，而不是只撤 anon/authenticated', (fn) => {
      // 只 revoke anon/authenticated 是 PB-028 的經典錯誤：那兩個角色仍從 PUBLIC 繼承。
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public;`, 'i'));
    });

    it.each(SERVER_ONLY_RPCS)('把 %s 的執行權留給 service_role', (fn) => {
      // 反向：service_role 被誤撤的話所有 server route 全面 403。
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`, 'i'));
    });

    it('自我驗證同時檢查兩個方向，而不是只檢查撤掉了沒', () => {
      expect(sql).toContain('service_role=X');
      expect(sql).toMatch(/proacl 為 NULL/);
      expect(sql).toMatch(/service_role 執行權被誤撤/);
    });
  });

  describe('0098 — tour_orders 的遺留聯絡欄位', () => {
    const sql = read(CONTACT);

    it('放寬約束，但絕不移除欄位（drop column 不可逆）', () => {
      expect(sql).toMatch(/alter column customer_name\s+drop not null/i);
      expect(sql).toMatch(/alter column customer_phone\s+drop not null/i);
      expect(executable(sql)).not.toMatch(/drop column/i);
    });

    it('欄位不存在時整段跳過，乾淨重建不會報錯', () => {
      expect(sql).toMatch(/if exists \(\s*select 1 from information_schema\.columns/i);
      // 斷言必須容許「0 個」——乾淨帳本重建出來的資料庫本來就沒有這兩欄。
      expect(sql).toMatch(/not in \(0, 2\)/);
    });
  });

  describe('0099 — 舊簽章的 create_tour_order overload', () => {
    const sql = read(OVERLOAD);

    it('用 drop if exists，且只點名舊簽章的型別清單', () => {
      expect(sql).toMatch(/drop function if exists public\.create_tour_order\(/i);
      expect(sql).toMatch(/uuid, uuid, integer, text, text, public\.tour_order_source, text, uuid, uuid, timestamptz/i);
    });

    it('斷言留下來的恰好是一支、且是 0087 的 canonical 簽章', () => {
      // 只斷言「舊的不見了」不夠：真正會壞的情況是兩支並存 → PGRST203。
      expect(sql).toMatch(/實際 % 個/);
      expect(sql).toContain('p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer');
    });
  });

  it('三支都不得改動 0084 刻意授予 authenticated 的 catalog RPC 權限', () => {
    // #242 明文把 reserve_catalog_positions / reorder_catalog_items 授權給 authenticated，
    // 且該決定由 catalog-position-bridge.242.test.ts 鎖住。對帳 migration 不得順手動它。
    for (const name of [ACL, CONTACT, OVERLOAD]) {
      expect(executable(read(name))).not.toMatch(/reserve_catalog_positions|reorder_catalog_items/);
    }
  });
});
