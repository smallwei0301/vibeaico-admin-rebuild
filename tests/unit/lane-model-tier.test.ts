import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { routing } from '../../scripts/agents/astra-review-policy.mjs';

/**
 * Owner 2026-09-10 裁示：lane 決定層級、層級決定模型，Terra 一律用 Sonnet。
 *
 * 這條規則在此之前只存在於口頭——`model-routing.json` 只有 `gpt-5.6-*`，
 * 三份 Anthropic 模型名在整個 repo 是零命中，於是「Opus 佔著 TERRA_BUILD 施工」
 * 這件事在紀錄上讀起來是中性的。規則寫進文件仍會漂移，因此在這裡鎖住。
 */
const EXPECTED = { scout: 'claude-haiku-4-5', build: 'claude-sonnet-5', audit: 'claude-opus-5' } as const;
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('lane → model tier（Owner 2026-09-10）', () => {
  const map = routing.anthropicEquivalents as Record<string, string> | undefined;

  it('三個 lane 都有 Anthropic 對應，且逐字符合裁示', () => {
    expect(map).toBeTruthy();
    for (const [lane, model] of Object.entries(EXPECTED)) {
      expect(map?.[lane], `lane ${lane} 的 Anthropic 對應`).toBe(model);
    }
  });

  it('build 層是 Sonnet——不是 Opus，也不是 Haiku', () => {
    expect(map?.build).toBe('claude-sonnet-5');
    expect(map?.build).not.toBe(map?.audit);
    expect(map?.build).not.toBe(map?.scout);
  });

  it('三層互不相同：任兩層相同等於那一層的成本控制消失', () => {
    expect(new Set(Object.values(EXPECTED)).size).toBe(3);
    expect(new Set([map?.scout, map?.build, map?.audit]).size).toBe(3);
  });

  it('model ID 不帶日期後綴（官方型號表的字串本身即完整）', () => {
    for (const model of Object.values(map ?? {})) {
      if (typeof model !== 'string' || !model.startsWith('claude-')) continue;
      expect(model, `${model} 不應附加日期後綴`).not.toMatch(/-\d{8}$/);
    }
  });

  it('OpenAI 側三個 lane 仍在，對應表是新增而非取代', () => {
    expect(routing.models.scout).toBe('gpt-5.6-luna');
    expect(routing.models.build).toBe('gpt-5.6-terra');
    expect(routing.models.audit).toBe('gpt-5.6-sol');
  });

  it('三份 canonical 文件都載明對應，文件不得與設定脫節', () => {
    const DOCS = ['CLAUDE.md', 'docs/MODEL-ROUTING.md', 'docs/decisions/2026-09-10-owner-lane-model-tier.md'];
    for (const path of DOCS) {
      const text = read(path);
      for (const model of Object.values(EXPECTED)) {
        expect(text, `${path} 應載明 ${model}`).toContain(model);
      }
      expect(text, `${path} 應載明 Terra 一律用 Sonnet`).toMatch(/Terra 一律用 Sonnet/);
      // 一週前那份文件正是把 Haiku 寫成帶日期的變體，所以這裡連文件一起鎖。
      expect(text, `${path} 不應出現帶日期後綴的 model ID`).not.toMatch(/claude-[a-z0-9-]*-\d{8}/);
    }
  });
});
