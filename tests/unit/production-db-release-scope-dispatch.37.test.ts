import { readFileSync } from 'node:fs';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const source = readFileSync('.github/workflows/ci.yml', 'utf8');
const workflow = parse(source);

describe('#37 / 0131+0134 G3 workflow dispatch scope', () => {
  it('admits the atomic RPC plus invoker repair through both dispatch gates', () => {
    expect(workflow.on.workflow_dispatch.inputs.production_db_release_scope.options)
      .toEqual(['FULL_PENDING_SET', 'ISSUES_17_680', 'ISSUE_37_0131_0134']);
    expect(source).toContain('case "$RELEASE_SCOPE" in FULL_PENDING_SET|ISSUES_17_680|ISSUE_37_0131_0134) ;; *) exit 1 ;; esac');
  });
});
