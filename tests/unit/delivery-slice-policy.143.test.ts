import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const policy = read('docs/DELIVERY-OUTCOME-V2.md');
const issueForm = read('.github/ISSUE_TEMPLATE/delivery-slice.yml');
const prTemplate = read('.github/pull_request_template.md');

describe('Issue #143 Delivery Slice boundary', () => {
  it('separates planning Epics from independently shipped Product units', () => {
    expect(policy).toContain('Epic、Delivery Slice 與 standalone Issue');
    expect(policy).toContain('最後關閉 Epic只是專案整理，**不得再增加 shipped unit**');
    expect(policy).toContain('父 Epic 保持 open 不妨礙一張已驗證 Slice 關閉並計入 shipped unit');
  });

  it('requires one usable and persistent outcome that can close in the same Run', () => {
    for (const required of [
      '只對應一個主要使用者結果',
      '有明確的真實資料／API／持久化結果',
      '能在同一 Run 內關閉',
      '同一 Slice 同時只能有一張 active implementation PR',
    ]) {
      expect(policy).toContain(required);
    }
  });

  it('prevents parent, child and retrospective bookkeeping from double counting', () => {
    expect(policy).toContain('父 Epic 與已計數子 Slice');
    expect(policy).toContain('RETROACTIVE_TRACKING_MIGRATION: true');
    expect(policy).toContain('COUNT_IN_DELIVERY_OUTCOME: false');
    expect(policy).toContain('不得回寫舊 Run');
  });

  it('provides a required Issue form for the exact delivery metadata', () => {
    for (const field of [
      'label: DELIVERY_UNIT_TYPE',
      'label: PARENT_EPIC',
      'label: COUNT_IN_DELIVERY_OUTCOME',
      'label: RETROACTIVE_TRACKING_MIGRATION',
      'label: One user-visible outcome',
      'label: Real side effect / persistence',
      'label: Bounded acceptance',
      'label: FILE_OWNERSHIP',
    ]) {
      expect(issueForm).toContain(field);
    }
  });

  it('makes Product PRs point at the closable Slice rather than the parent Epic', () => {
    expect(prTemplate).toContain('## Delivery Unit boundary');
    expect(prTemplate).toContain('- DELIVERY_UNIT_TYPE: SLICE | STANDALONE | EPIC | GOVERNANCE');
    expect(prTemplate).toContain('A Product PR lifecycle `issue:` points to its closable Slice／standalone Issue');
    expect(prTemplate).toContain('Epic closeout uses a non-delivery claim and adds no shipped unit');
  });
});
