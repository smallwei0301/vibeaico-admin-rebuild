const escapeRegExp = (value) => value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

function canonicalField(body, key) {
  const match = body.match(new RegExp(
    '^\\s*' + escapeRegExp(key) + '\\s*:\\s*(.*)$',
    'im',
  ));
  return match?.[1]?.trim() ?? '';
}

function formField(body, heading) {
  const match = body.match(new RegExp(
    '^###\\s+' + escapeRegExp(heading) + '\\s*\\r?\\n([\\s\\S]*?)(?=^###\\s|\\s*$)',
    'im',
  ));
  if (!match) return '';
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^<!--/.test(line) && !/^_No response_$/i.test(line))
    .join('\n')
    .trim();
}

function fieldValue(body, key, heading) {
  return canonicalField(body, key) || formField(body, heading);
}

function classifyIssueProvenance(body = '') {
  const canonicalOrigin = canonicalField(body, 'ISSUE_ORIGIN');
  const formOrigin = formField(body, 'Issue origin');
  const isAgent = canonicalOrigin.toUpperCase() === 'AGENT_DISCOVERED'
    || formOrigin.toUpperCase() === 'AGENT_DISCOVERED';
  const fields = [
    ['PARENT_ISSUE / PR', 'Parent Issue / PR'],
    ['DISCOVERED_STAGE', 'Discovered stage'],
    ['SCOPE_FIREWALL_REASON', 'Scope Firewall reason'],
    ['WHY_SEPARATE_FROM_PARENT', 'Why this cannot remain in the parent Issue'],
    ['BLOCKS_CURRENT_GOAL', 'Blocks current goal'],
    ['EVIDENCE', 'Evidence'],
    ['REQUESTED_MODEL / ACTUAL_MODEL', 'Requested model / actual model'],
  ];
  const missing = isAgent
    ? fields.filter(([key, heading]) => !fieldValue(body, key, heading)).map(([, heading]) => heading)
    : [];
  return { isAgent, missing };
}

module.exports = { canonicalField, formField, classifyIssueProvenance };
