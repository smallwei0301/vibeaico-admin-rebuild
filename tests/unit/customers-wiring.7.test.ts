import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  bindLineUser, createCustomer, listCustomers, unbindLineUser, updateCustomer,
} from '@/services/customers';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf8');

const page = read('src/app/tenant/customers/page.tsx');

describe('customers page — real wiring for create/edit + LINE bind/unbind (#7)', () => {
  it('no longer fakes a successful save with a bare timeout', () => {
    // 原本三處假成功：新增/編輯表單、綁定 LINE 都是 `await new Promise((r) => setTimeout(r, 420))`
    // 且完全沒呼叫任何 service/API。
    expect(page).not.toContain('await new Promise((r) => setTimeout(r, 420))');
  });

  it('create/edit form actually calls createCustomer / updateCustomer', () => {
    expect(page).toContain(
      "bindLineUser, createCustomer, deleteCustomer, listCustomers, unbindLineUser, updateCustomer,",
    );
    expect(page).toContain('await updateCustomer(customer.id, payload);');
    expect(page).toContain('await createCustomer(payload);');
  });

  it('bind modal actually calls bindLineUser and surfaces the real error message', () => {
    expect(page).toContain('await bindLineUser(customer.id, u.id, u.displayName);');
    expect(page).toContain('t.messages.bindFailedPrefix}${e.message}');
  });

  it('unbind confirm actually calls unbindLineUser (not just a toast)', () => {
    expect(page).toContain('await unbindLineUser(unbindTarget.id);');
  });
});

describe('src/services/customers.ts — mock-mode round trip (NEXT_PUBLIC_USE_MOCK defaults true)', () => {
  it('createCustomer persists into the mock store so a reload sees it', async () => {
    const { id } = await createCustomer({ name: '測試顧客七號', phone: '0912345678' });
    expect(id).toBeTruthy();

    const after = await listCustomers({ page: 0, size: 500 });
    const found = after.content.find((c) => c.id === id);
    expect(found).toBeDefined();
    expect(found?.name).toBe('測試顧客七號');
  });

  it('updateCustomer mutates the mock store so a reload sees the change', async () => {
    const { id } = await createCustomer({ name: '待更新顧客', phone: '0900000000' });
    await updateCustomer(id, { name: '已更新顧客' });

    const after = await listCustomers({ page: 0, size: 500 });
    expect(after.content.find((c) => c.id === id)?.name).toBe('已更新顧客');
  });

  it('bindLineUser sets lineUserId and a reload reflects it', async () => {
    const { id } = await createCustomer({ name: '待綁定顧客', phone: '0911111111' });
    await bindLineUser(id, 'line_u_test_1', 'Test LINE 暱稱');

    const after = await listCustomers({ page: 0, size: 500 });
    const found = after.content.find((c) => c.id === id);
    expect(found?.lineUserId).toBe('line_u_test_1');
    expect(found?.lineDisplayName).toBe('Test LINE 暱稱');
  });

  it('bindLineUser rejects (409-shaped ApiError) when the LINE id is already bound to someone else', async () => {
    const a = await createCustomer({ name: '顧客甲', phone: '0922222222' });
    const b = await createCustomer({ name: '顧客乙', phone: '0933333333' });
    await bindLineUser(a.id, 'line_u_shared', '共用');

    await expect(bindLineUser(b.id, 'line_u_shared', '共用')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('unbindLineUser clears the binding and is idempotent when called again', async () => {
    const { id } = await createCustomer({ name: '待解綁顧客', phone: '0944444444' });
    await bindLineUser(id, 'line_u_test_2', '暱稱');
    await unbindLineUser(id);

    const after = await listCustomers({ page: 0, size: 500 });
    const found = after.content.find((c) => c.id === id);
    expect(found?.lineUserId).toBeNull();
    expect(found?.lineDisplayName).toBeNull();

    // 冪等：未綁定時再呼叫一次不應丟例外
    await expect(unbindLineUser(id)).resolves.toBeUndefined();
  });
});
