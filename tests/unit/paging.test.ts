import { describe, it, expect } from 'vitest';
import { pageRange, toPaged } from '@/server/paging';

describe('paging — pageRange (01 §5.6)', () => {
  it('page 0、預設 size：from=0, to=19', () => {
    const r = pageRange(0, 20);
    expect(r).toEqual({ from: 0, to: 19, page: 0, size: 20 });
  });

  it('page 上限 size：page=2, size=50 → from=100, to=149', () => {
    const r = pageRange(2, 50);
    expect(r).toEqual({ from: 100, to: 149, page: 2, size: 50 });
  });
});

describe('paging — toPaged', () => {
  it('總頁數整除：count=40, size=20 → totalPages=2', () => {
    const r = toPaged(['a', 'b'], 40, 0, 20);
    expect(r.totalPages).toBe(2);
    expect(r.totalElements).toBe(40);
    expect(r.number).toBe(0);
    expect(r.size).toBe(20);
    expect(r.content).toEqual(['a', 'b']);
  });

  it('總頁數有餘數：count=41, size=20 → totalPages=3', () => {
    const r = toPaged([], 41, 1, 20);
    expect(r.totalPages).toBe(3);
    expect(r.totalElements).toBe(41);
    expect(r.number).toBe(1);
  });

  it('count 為 null 時 totalElements=0、totalPages=0', () => {
    const r = toPaged([], null, 0, 20);
    expect(r.totalElements).toBe(0);
    expect(r.totalPages).toBe(0);
  });
});
