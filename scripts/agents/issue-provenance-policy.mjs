#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const ISSUE_ORIGIN_HEADINGS = Object.freeze([
  '## Issue origin',
  '### Issue origin',
]);

export const REQUIRED_AGENT_PROVENANCE_HEADINGS = Object.freeze([
  '### Parent Issue / PR',
  '### Discovered stage',
  '### Scope Firewall reason',
  '### Why this cannot remain in the parent Issue',
  '### Blocks current goal',
  '### Evidence',
  '### Requested model / actual model',
]);

const PLACEHOLDER = /^(?:none|n\/?a|tbd|todo|pending|unknown|-)$/i;
const VALID_BLOCKER_VALUES = new Set(['YES', 'NO', 'NO, BACKLOG ONLY']);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanLine(value) {
  return String(value)
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^`+|`+$/g, '')
    .trim();
}

function substantiveLines(section) {
  if (section === null || section === undefined) return [];
  return String(section)
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line && !/^```/.test(line));
}

function isSubstantive(section) {
  return substantiveLines(section).some((line) => !PLACEHOLDER.test(line));
}

export function readHeadingSection(body = '', heading = '') {
  const text = String(body ?? '');
  const matcher = new RegExp(`^${escapeRegExp(heading)}[ \\t]*$`, 'm');
  const match = matcher.exec(text);
  if (!match) return null;
  const remainder = text.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/\r?\n(?=#{1,6}[ \t]+\S)/);
  return (nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder).trim();
}

function issueOrigin(body) {
  for (const heading of ISSUE_ORIGIN_HEADINGS) {
    const section = readHeadingSection(body, heading);
    if (section === null) continue;
    const value = substantiveLines(section)[0] ?? '';
    return value.toUpperCase() === 'AGENT_DISCOVERED' ? 'agent' : 'owner-or-unknown';
  }
  return 'owner-or-unknown';
}

function validateModelLine(section) {
  const text = String(section ?? '');
  const requested = text.match(/(?:^|[;；\n])\s*requested\s*=\s*([^;；\n]+)/i)?.[1]?.trim() ?? '';
  const actual = text.match(/(?:^|[;；\n])\s*actual\s*=\s*([^;；\n]+)/i)?.[1]?.trim() ?? '';
  const errors = [];
  if (!requested || PLACEHOLDER.test(cleanLine(requested))) {
    errors.push('### Requested model / actual model must contain requested=<model or role>');
  }
  if (!actual || /^(?:none|n\/?a|tbd|todo|pending|-)$/i.test(cleanLine(actual))) {
    errors.push('### Requested model / actual model must contain actual=<model or unknown>');
  }
  return errors;
}

export function validateIssueProvenance(body = '') {
  const origin = issueOrigin(body);
  if (origin !== 'agent') {
    return {
      origin,
      isAgent: false,
      valid: true,
      missingHeadings: [],
      emptyHeadings: [],
      errors: [],
    };
  }

  const missingHeadings = [];
  const emptyHeadings = [];
  const errors = [];
  const sections = new Map();

  for (const heading of REQUIRED_AGENT_PROVENANCE_HEADINGS) {
    const section = readHeadingSection(body, heading);
    sections.set(heading, section);
    if (section === null) {
      missingHeadings.push(heading);
      errors.push(`missing required heading: ${heading}`);
    } else if (!isSubstantive(section)) {
      emptyHeadings.push(heading);
      errors.push(`${heading} must contain substantive non-placeholder content`);
    }
  }

  const blockerSection = sections.get('### Blocks current goal');
  if (blockerSection !== null) {
    const value = substantiveLines(blockerSection).join(' ').trim().toUpperCase();
    if (!VALID_BLOCKER_VALUES.has(value)) {
      errors.push('### Blocks current goal must be YES, NO, or NO, backlog only');
    }
  }

  const modelSection = sections.get('### Requested model / actual model');
  if (modelSection !== null) errors.push(...validateModelLine(modelSection));

  return {
    origin,
    isAgent: true,
    valid: errors.length === 0,
    missingHeadings,
    emptyHeadings,
    errors: [...new Set(errors)],
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    result[key] = value;
    index += 1;
  }
  return result;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.body) {
    throw new Error('Usage: issue-provenance-policy.mjs --body <issue-body.md>');
  }
  const bodyPath = path.resolve(args.body);
  if (!fs.existsSync(bodyPath) || !fs.statSync(bodyPath).isFile()) {
    throw new Error(`issue body file does not exist: ${bodyPath}`);
  }
  const result = validateIssueProvenance(fs.readFileSync(bodyPath, 'utf8'));
  if (!result.valid) {
    throw new Error(`ISSUE_PROVENANCE_FAILED\n${result.errors.map((error) => `- ${error}`).join('\n')}`);
  }
  console.log(`ISSUE_PROVENANCE_PASS origin=${result.origin}`);
  return result;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
