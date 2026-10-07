import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';

/**
 * Owner 2026-09-10 裁示：lane 決定層級、層級決定模型，Terra 一律用 Sonnet。
 *
 * 這條規則在此之前只存在於口頭——`model-routing.json` 只有 `gpt-5.6-*`，
 * 三份 Anthropic 模型名在整個 repo 是零命中，於是「Opus 佔著 TERRA_BUILD 施工」
 * 這件事在紀錄上讀起來是中性的。規則寫進文件仍會漂移，因此在這裡鎖住。
 */
const EXPECTED = { scout: 'claude-haiku-4-5', build: 'claude-sonnet-5-5', audit: 'claude-opus-5-5' } as const;
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('lane → model tier（Owner 2026-09-30 版本更新）', () => {
  const map = routing.anthropicEquivalents as Record<string, string> | undefined;

  it('三個 lane 都有 Anthropic 對應，且逐字符合裁示', () => {
    expect(map).toBeTruthy();
    for (const [lane, model] of Object.entries(EXPECTED)) {
      expect(map?.[lane], `lane ${lane} 的 Anthropic 對應`).toBe(model);
    }
  });

  it('build 層是 Sonnet——不是 Opus，也不是 Haiku', () => {
    expect(map?.build).toBe('claude-sonnet-5-5');
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
    expect(routing.models.scout).toBe('gpt-6-luna');
    expect(routing.models.build).toBe('gpt-6.1-sol');
    expect(routing.models.audit).toBe('gpt-6.1-sol');
  });

  it('開工摘要不能把不同 role 概括成單一 OpenAI model family', () => {
    const text = read('CLAUDE.md');
    const intro = text.split('## Lane → model tier')[1].split('| Lane |')[0];
    expect(intro).toContain('scripts/agents/model-routing.json');
    expect(intro).not.toMatch(/gpt-[\d.]+-\*/);
  });

  it('Luna 開工委派是 provider-local，Product 施工一律保留 build tier', () => {
    const text = read('CLAUDE.md');
    const startup = text.split('### 1. 真實盤點')[1].split('### 2.')[0];
    const scout = text.split('### 文件與盤點的 scout 歸屬')[1].split('## Final Risk')[0];
    for (const section of [startup, scout]) {
      expect(section).toContain('OpenAI: `gpt-6-luna`');
      expect(section).toContain('Claude: `claude-haiku-4-5`');
    }
    const index = read('docs/OWNER-DECISIONS.md').split('Lane 對應的模型層級')[1].split('\n')[0];
    expect(index).toContain('PROVIDER_FIRST');
    expect(index).toContain('gpt-6-luna');
    expect(index).toContain('claude-sonnet-5-5');
    const policy = read('docs/AGENT-EXECUTION.md');
    expect(policy).toContain('不得用 scout 或未獲 build 授權的 audit 層模型做任何 Product 施工');
  });

  it('Product B+ 操作段落不將純治理契約測試誤判為 Product builder', () => {
    const text = read('CLAUDE.md');
    const scope = text.split('## B+ delivery loop')[1].split('### 1.')[0];
    expect(scope).toContain('本節六步只適用 `PRODUCT_MAINLINE`');
    expect(scope).toContain('MODEL_GOVERNANCE');
    expect(scope).toContain('§1.2');
    expect(scope).toContain('不借用 Product Run');
  });

  it('目前模型決策依實際日期登錄，歷史版本不被倒改', () => {
    const index = read('docs/OWNER-DECISIONS.md');
    expect(index).toContain('最後更新：2026-10-01');
    expect(index.split('## 2026-09-30 已裁示')[1].split('## 2026-09-17')[0]).toContain('PROVIDER_FIRST');
    const history = index.split('## 2026-09-10 已裁示')[1].split('## 2026-09-09')[0];
    expect(history).toContain('Terra=`claude-sonnet-5`');
    expect(history).toContain('原文保留為歷史');
    expect(read('docs/AGENT-EXECUTION.md')).toContain('最近更新：2026-10-07');
  });

  it('OpenAI 同 ID 角色仍須獨立 actor，不改歷史 identity 或審查 policy version', () => {
    expect(routing.models.finalRisk).toBe('gpt-6-astra');
    expect(routing.models.finalRiskAllowedModels).toContain('claude-fable-5-1');
    expect(routing.models.build).toBe(routing.models.audit);
    expect(routing.openaiBuilderDecision.effectiveAt).toBe('2026-10-01T00:01:00Z');
    expect(routing.openaiBuilderDecision.independentReviewerRequired).toBe(true);
    expect(routing.openaiBuilderDecision.historicalIdentityRewriteAllowed).toBe(false);
    expect(routing.version).toBe('2026-09-08.4');
    for (const file of ['CLAUDE.md', 'docs/AGENT-EXECUTION.md', 'docs/MODEL-ROUTING.md']) {
      expect(read(file)).toMatch(/不同 actor／session|different actors\/sessions/);
    }
    expect(read(routing.openaiBuilderDecision.ownerDecision)).toContain('Sentinel_254c7297e58c819183454711263dde7c');
  });

  it('build 與 audit 同模型不豁免 Product Auth Final Risk', () => {
    const result = classifyAstra({
      body: 'WORKSTREAM: PRODUCT_MAINLINE\nASTRA_RISK: TENANT_AUTH_BOUNDARY\nASTRA_RATIONALE: Auth registration upstream error classification',
      changedFiles: ['src/app/api/auth/tenant/register/route.ts'],
    });
    expect(result.errors).toEqual([]);
    expect(result.required).toBe(true);
  });

  it('目前開工文件先判 provider，再選本地角色模型，不要求跨 provider 依賴', () => {
    for (const file of ['CLAUDE.md', 'docs/AGENT-EXECUTION.md', 'docs/MODEL-ROUTING.md']) {
      const text = read(file);
      expect(text).toContain('PROVIDER_FIRST');
      expect(text).toContain('runtime catalog');
      expect(text).toContain('requested');
      expect(text).toContain('actual');
    }
  });

  it('目前開工文件都載明對應，歷史決策不改寫', () => {
    const DOCS = ['CLAUDE.md', 'docs/MODEL-ROUTING.md', 'docs/AGENT-EXECUTION.md'];
    for (const path of DOCS) {
      const text = read(path);
      for (const model of Object.values(EXPECTED)) {
        expect(text, `${path} 應載明 ${model}`).toContain(model);
      }
      expect(text, `${path} 應載明 build 層限制`).toMatch(path === 'docs/AGENT-EXECUTION.md' ? /Terra 一律使用 build 層/ : /Terra 一律用 Sonnet/);
      expect(text).toContain(routing.models.scout);
      expect(text).toContain(routing.models.audit);
      // 一週前那份文件正是把 Haiku 寫成帶日期的變體，所以這裡連文件一起鎖。
      expect(text, `${path} 不應出現帶日期後綴的 model ID`).not.toMatch(/claude-[a-z0-9-]*-\d{8}/);
    }
  });
});
