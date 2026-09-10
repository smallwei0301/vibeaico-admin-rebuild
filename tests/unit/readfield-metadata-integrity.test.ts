import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AMBIGUOUS_FIELD, isPlaceholder, parseLaneMetadata, readField } from '../../scripts/agents/agent-wip-policy.mjs';
import { classifyAstra } from '../../scripts/agents/astra-review-policy.mjs';

/**
 * 守門靠 `readField()` 讀 PR 內文的中繼資料決定要不要送 Final Risk。它原本取**第一個**
 * 匹配，而 `.github/pull_request_template.md` 的示範區塊裡就有一組合法格式的欄位值。
 *
 * 結果：作者只要沒把範本樣板刪乾淨，他誠實填的高風險宣告就永遠讀不到——讀到的是示範值
 * `ASTRA_RISK: NONE`，於是 `required=false`。這是**靜默放行**：不報錯、不亮燈，只是少跑
 * 一道專門攔付款／跨店權限／不可逆資料的審查。
 *
 * 本檔鎖住兩層修正：
 *   1. fenced code block 不再被當成中繼資料；
 *   2. 同一欄位出現多個不同值時回傳哨兵值——這一層擋的是 fence 規則涵蓋不到的容器
 *      （未閉合的 fence、四個反引號、四空格縮排、HTML 註解）。
 */
const TEMPLATE = readFileSync(resolve(process.cwd(), '.github/pull_request_template.md'), 'utf8');
const HONEST = [
  'WORKSTREAM: PRODUCT_MAINLINE',
  'AGENT_LANE: TERRA_BUILD',
  'ASTRA_RISK: TENANT_AUTH_BOUNDARY',
  'ASTRA_RATIONALE: 跨店讀寫邊界，改動租戶解析。',
  'FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION',
].join('\n');

describe('readField 的中繼資料完整性', () => {
  it('真實範本 + 誠實的高風險宣告：不得被讀成 NONE', () => {
    const body = `${TEMPLATE}\n\n${HONEST}`;
    // 這是漏洞本體：修正前這裡是 'NONE'，作者宣告的 TENANT_AUTH_BOUNDARY 被吞掉。
    expect(readField(body, 'ASTRA_RISK')).not.toBe('NONE');
    const result = classifyAstra({ body, changedFiles: ['src/server/tenant.ts'], createdAt: '2026-09-10T09:00:00Z' });
    expect(result.risks).not.toEqual(['NONE']);
    // 不得靜默放行：要嘛讀到真實的高風險，要嘛明確報錯擋下。
    expect(result.errors.length > 0 || result.required).toBe(true);
  });

  it('fenced block 裡的欄位不再被當成宣告', () => {
    const body = '```text\nASTRA_RISK: NONE\n```\n\nASTRA_RISK: PAYMENT_CONSISTENCY';
    expect(readField(body, 'ASTRA_RISK')).toBe(AMBIGUOUS_FIELD);
    expect(readField('```text\nWORK_ORIGIN: OWNER\n```', 'WORK_ORIGIN')).toBe('');
    expect(readField('~~~\nWORK_ORIGIN: OWNER\n~~~', 'WORK_ORIGIN')).toBe('');
  });

  it('fence 規則涵蓋不到的四種容器，由「只能宣告一次」接住', () => {
    const containers = {
      '未閉合的 fence': '```text\nASTRA_RISK: NONE',
      '四個反引號': '````text\nASTRA_RISK: NONE\n````',
      '四空格縮排': '    ASTRA_RISK: NONE',
      'HTML 註解': '<!--\nASTRA_RISK: NONE\n-->',
    };
    for (const [label, container] of Object.entries(containers)) {
      const body = `${container}\n\nASTRA_RISK: TENANT_AUTH_BOUNDARY`;
      expect(readField(body, 'ASTRA_RISK'), label).toBe(AMBIGUOUS_FIELD);
      expect(isPlaceholder(readField(body, 'ASTRA_RISK')), `${label} 應被視為佔位符`).toBe(true);
    }
  });

  it('哨兵值走既有的 fail-closed 路徑，不需要每個消費者各自處理', () => {
    expect(isPlaceholder(AMBIGUOUS_FIELD)).toBe(true);
    const body = 'WORK_ORIGIN: AGENT\nAGENT_LANE: GOVERNANCE\nAGENT_LANE: TERRA_BUILD';
    expect(parseLaneMetadata({ body, number: 1 }).lane).toBe(AMBIGUOUS_FIELD.toUpperCase());
  });

  it('正常內文不受影響：宣告一次、或重複但同值', () => {
    expect(readField('ASTRA_RISK: NONE', 'ASTRA_RISK')).toBe('NONE');
    expect(readField('ASTRA_RISK: NONE\n\nASTRA_RISK: NONE', 'ASTRA_RISK')).toBe('NONE');
    expect(readField('- WORK_ORIGIN: AGENT', 'WORK_ORIGIN')).toBe('AGENT');
    expect(readField('沒有這個欄位', 'ASTRA_RISK')).toBe('');
  });

  it('每個治理消費者共用同一份 readField，不得各留私有副本', () => {
    for (const path of [
      'scripts/agents/governance-scope-budget.mjs',
      'scripts/agents/completion-truth.mjs',
      'scripts/agents/astra-review-policy.mjs',
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(source, `${path} 不應自行定義 readField`).not.toMatch(/function readField\s*\(/);
      expect(source, `${path} 應 import 共用實作`).toMatch(/import \{[^}]*readField[^}]*\} from ["']\.\/agent-wip-policy\.mjs["']/);
    }
  });
});
