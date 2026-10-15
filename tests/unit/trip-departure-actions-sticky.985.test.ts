import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/app/tenant/trips/[id]/page.tsx', 'utf8');
// 取出 departureColumns 內的 actions 欄區塊（到該欄 render 結尾）
const start = src.indexOf('const departureColumns');
const actionsAt = src.indexOf("key: 'actions'", start);
const block = src.slice(actionsAt, actionsAt + 400);

describe('#985 團次表操作欄固定右側並可換行', () => {
  it('departureColumns 的 actions 欄設定 sticky: right', () => {
    expect(start).toBeGreaterThan(-1);
    expect(actionsAt).toBeGreaterThan(start);
    expect(src.slice(actionsAt, src.indexOf('\n', actionsAt))).toMatch(/sticky: 'right'/);
  });

  it('操作欄容器 class 為 btn-group btn-group-wrap', () => {
    expect(block).toContain('btn-group btn-group-wrap');
  });
});
