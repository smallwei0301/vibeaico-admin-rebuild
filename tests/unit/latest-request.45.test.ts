import { describe, expect, it } from 'vitest';
import { createLatestGuard } from '@/lib/latest-request';

describe('createLatestGuard（只套用最新一次請求）', () => {
  it('慢的舊請求晚於新請求回來時，舊回應不得套用', async () => {
    const g = createLatestGuard();
    let applied: string[] = [];
    const run = async (label: string, delay: number) => {
      const token = g.next();
      await new Promise((r) => setTimeout(r, delay));
      if (!g.isLatest(token)) return;
      applied.push(label);
    };
    await Promise.all([run('unfiltered-slow', 30), run('filtered-fast', 5)]);
    expect(applied).toEqual(['filtered-fast']);
  });

  it('invalidate（卸載）後進行中的回應全部作廢；之後的新請求仍可套用', () => {
    const g = createLatestGuard();
    const t1 = g.next();
    g.invalidate();
    expect(g.isLatest(t1)).toBe(false);
    const t2 = g.next();
    expect(g.isLatest(t2)).toBe(true);
  });
});
