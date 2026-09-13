import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createCustomer, listCustomers } from '@/services/customers';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/customers/page.tsx');
const migration = read('supabase/migrations/0076_customer_source.sql');
const apiRoute = read('src/app/api/customers/route.ts');

describe('customers page — 自動建立徽章改依真實 source 顯示（#7）', () => {
  it('no longer hardcodes the badge onto a fixed customer id', () => {
    expect(page).not.toContain('AUTO_CREATED_CUSTOMER_IDS');
    expect(page).not.toContain("'c_2'");
  });

  it('badge now reads customer.source', () => {
    expect(page).toContain("c.source === 'LINE' || c.source === 'PUBLIC_BOOKING'");
  });
});

describe('supabase/migrations/0076_customer_source.sql — 冪等 + 預設值', () => {
  it('adds the column idempotently and defaults to MANUAL', () => {
    expect(migration).toContain('add column if not exists source text not null default \'MANUAL\'');
  });

  it('wraps the check constraint so a rerun (or drift) does not fail', () => {
    expect(migration).toMatch(/do \$\$[\s\S]*add constraint customers_source_check[\s\S]*exception[\s\S]*when duplicate_object then null;[\s\S]*end \$\$;/);
  });

  it('recreates customers_view so the new trailing-in-c.*-but-mid-view column is exposed', () => {
    // 0014 的教訓：c.* 在 CREATE VIEW 當下展開凍結，中段插入需要 drop + create，
    // create or replace 會被 Postgres 拒絕。
    expect(migration).toContain('drop view if exists customers_view');
    expect(migration).toContain('create view customers_view');
  });
});

describe('src/app/api/customers/route.ts — 寫入端明寫 source', () => {
  it('POST explicitly writes MANUAL (the only real insert path in this repo today)', () => {
    expect(apiRoute).toContain("source: 'MANUAL'");
  });

  it('GET response carries source (defaulting when the view row does not have it yet)', () => {
    expect(apiRoute).toContain('source: r.source ?? \'MANUAL\'');
  });
});

describe('src/services/customers.ts — mock 分支往返 + 延遲初始化', () => {
  it('createCustomer defaults the mock source to MANUAL and a reload reflects it', async () => {
    const { id } = await createCustomer({ name: '來源測試顧客', phone: '0966666666' });
    const after = await listCustomers({ page: 0, size: 500 });
    const found = after.content.find((c) => c.id === id);
    expect(found?.source).toBe('MANUAL');
  });

  it('existing mock customers (no recorded source) also default to MANUAL, not undefined', async () => {
    const after = await listCustomers({ page: 0, size: 500 });
    expect(after.content.length).toBeGreaterThan(0);
    for (const c of after.content) {
      expect(c.source).toBe('MANUAL');
    }
  });

  it('the mock source store is lazily initialized per MOCK_MODE, not read at module scope', () => {
    const source = read('src/services/customers.ts');
    // 不得在 module 頂層呼叫 byMode() 或直接讀 MOCK_MODE 建常數；store 必須是
    // 一個延遲查表的 Map，在函式內部（呼叫當下）才存取 MOCK_MODE。
    expect(source).toContain('mockCustomerSourceStore.has(MOCK_MODE)');
    expect(source).not.toMatch(/^const .*=.*MOCK_MODE.*;$/m);
  });
});
