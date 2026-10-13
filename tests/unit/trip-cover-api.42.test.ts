import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tripUpdateSchema } from '@/server/tour-domain';

describe('#42 行程更新 API 接受封面', () => {
  it('schema 接受網址與空字串', () => {
    expect(tripUpdateSchema.parse({ coverImageUrl: 'https://x/c.png' }).coverImageUrl).toBe('https://x/c.png');
    expect(tripUpdateSchema.parse({ coverImageUrl: '' }).coverImageUrl).toBe('');
  });
  it('PUT route 映射 cover_image_url 且維持 tenant 範圍', () => {
    const src = readFileSync('src/app/api/trips/[id]/route.ts', 'utf8');
    expect(src).toContain('patch.cover_image_url = body.coverImageUrl');
    expect(src).toMatch(/\.update\(patch\)\s*\.eq\('tenant_id', t\.tenantId\)\.eq\('id', id\)/);
  });
  it('只有含封面的 patch 才加 LISTED 條件；其他欄位更新不受影響', () => {
    const src = readFileSync('src/app/api/trips/[id]/route.ts', 'utf8');
    expect(src.match(/query\.neq\('midao_listing', 'LISTED'\)/g)).toHaveLength(1);
    expect(src).toMatch(/if \(coverTouched\) query = query\.neq/);
  });
});
