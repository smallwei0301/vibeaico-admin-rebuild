import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';

/*
 * 靜態計算「integration / E2E 會載入到的檔案集合」，供 classify-changes 判斷
 * 某次 main push 的 scripts/agents、scripts/metrics 變更是否真的碰不到共用 TEST。
 *
 * 原則：任何解析不確定（讀檔失敗、動態 import/require 的非字面量 specifier、
 * 相對 import 解析不到、以 path.join 拆字拼出 scripts/agents 路徑）一律 throw，
 * 由呼叫端 fail closed（tooling_only=false）。寧可多跑一次 TEST，不可漏掉會被載入的檔案。
 */

const JS_EXTS = ['.mjs', '.js', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.jsx'];
const RESOLVE_EXTS = [...JS_EXTS, '.json'];
const TOOLING_DIR_RE = /^scripts\/(?:agents|metrics)\//;
const SCRIPT_REF_RE = /\bscripts\/[A-Za-z0-9_./-]+/g;
const CI_WORKFLOW = '.github/workflows/ci.yml';
const CONFIG_ROOTS = ['vitest.integration.config.mts', 'playwright.config.ts'];
const TEST_ROOT_DIRS = ['tests/integration', 'tests/e2e'];

export class ReachabilityUncertain extends Error {}

const toPosix = (p) => p.split(sep).join('/');

function isJsLike(path) {
  return JS_EXTS.some((ext) => path.endsWith(ext));
}

function walk(root, dir, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const rel = posix.join(dir, name);
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(root, rel, out);
    else out.push(rel);
  }
  return out;
}

/** The integration job text of ci.yml: from `  integration:` to EOF / next top-level job. */
export function integrationJobText(ciYml) {
  const lines = String(ciYml).split('\n');
  const start = lines.findIndex((line) => /^ {2}integration:\s*$/.test(line));
  if (start < 0) throw new ReachabilityUncertain('ci.yml has no integration job');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

function resolveCandidate(root, base) {
  const isFile = (p) => existsSync(join(root, p)) && statSync(join(root, p)).isFile();
  if (isFile(base)) return base;
  for (const ext of RESOLVE_EXTS) if (isFile(base + ext)) return base + ext;
  // TS style `./x.js` that really is x.ts / x.tsx / x.mts
  const m = base.match(/^(.*)\.(?:m|c)?js$/);
  if (m) for (const ext of ['.ts', '.tsx', '.mts', '.cts']) if (isFile(m[1] + ext)) return m[1] + ext;
  for (const ext of RESOLVE_EXTS) if (isFile(posix.join(base, `index${ext}`))) return posix.join(base, `index${ext}`);
  return null;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Returns { imports:[specifier], loose:[string literal] } or throws when a dynamic specifier is not a literal. */
function scanSource(file, rawSource) {
  const source = stripComments(rawSource);
  const imports = new Set();
  const patterns = [
    /\bimport\s+(?:[^'";]*?\s+from\s+)?(['"])([^'"\n]+)\1/g,
    /\bexport\s+[^'";]*?\s+from\s+(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g,
    /\brequire\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g,
    /\brequire\.resolve\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) imports.add(m[2]);
  // Dynamic import()/require() whose argument is not a plain string literal.
  for (const m of source.matchAll(/\b(?:import|require)\s*\(\s*([^)]{0,80})/g)) {
    const arg = m[1].trim();
    if (!/^(['"])[^'"\n]*\1\s*$/.test(arg) && !/^(['"`])[^'"`\n$]*\1\s*(?:,|$)/.test(arg)) {
      throw new ReachabilityUncertain(`${file}: non-literal dynamic import/require`);
    }
  }
  if (/['"]scripts['"]\s*,\s*['"](?:agents|metrics)['"]/.test(source)) {
    throw new ReachabilityUncertain(`${file}: scripts/agents path assembled from split segments`);
  }
  const loose = new Set();
  for (const m of source.matchAll(/(['"`])(\.{1,2}\/[^'"`\n$]*)\1/g)) loose.add(m[2]);
  const refs = new Set(source.match(SCRIPT_REF_RE) ?? []);
  return { imports: [...imports], loose: [...loose], refs: [...refs] };
}

function pythonSiblings(root, file, source) {
  const out = [];
  for (const m of source.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][\w]*)/gm)) {
    const cand = posix.join(posix.dirname(file), `${m[1]}.py`);
    if (existsSync(join(root, cand))) out.push(cand);
  }
  return out;
}

/**
 * @returns {Set<string>} posix repo-relative paths reachable from integration/E2E.
 * @throws {ReachabilityUncertain} when reachability cannot be established statically.
 */
export function computeIntegrationReachableSet(root = process.cwd()) {
  const reachable = new Set();
  const queue = [];
  const enqueue = (path) => {
    const p = toPosix(path).replace(/^\.\//, '');
    if (reachable.has(p)) return;
    reachable.add(p);
    if (existsSync(join(root, p)) && statSync(join(root, p)).isFile()) queue.push(p);
  };
  const enqueueDirTooling = (dir) => {
    for (const f of walk(root, dir)) enqueue(f);
  };

  for (const dir of TEST_ROOT_DIRS) {
    const files = walk(root, dir);
    if (files.length === 0 && dir === 'tests/integration') throw new ReachabilityUncertain('tests/integration is empty or missing');
    for (const f of files) enqueue(f);
  }
  for (const cfg of CONFIG_ROOTS) {
    if (!existsSync(join(root, cfg))) throw new ReachabilityUncertain(`${cfg} is missing`);
    enqueue(cfg);
  }
  // Test-run package scripts may shell out to tooling before/after vitest/playwright.
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      if (/(^|:)(test|pretest|posttest)|integration|e2e/.test(name)) {
        for (const ref of String(cmd).match(SCRIPT_REF_RE) ?? []) enqueue(ref);
      }
    }
  } catch { throw new ReachabilityUncertain('package.json could not be parsed'); }
  // Everything the integration job of ci.yml names is reachable (and followed).
  let ciYml;
  try { ciYml = readFileSync(join(root, CI_WORKFLOW), 'utf8'); } catch { throw new ReachabilityUncertain('ci.yml unreadable'); }
  for (const ref of integrationJobText(ciYml).match(SCRIPT_REF_RE) ?? []) enqueue(ref.replace(/[.,;:)]+$/, ''));

  while (queue.length) {
    const file = queue.shift();
    if (file.endsWith('.py')) {
      let src;
      try { src = readFileSync(join(root, file), 'utf8'); } catch { throw new ReachabilityUncertain(`${file}: unreadable`); }
      for (const sib of pythonSiblings(root, file, src)) enqueue(sib);
      continue;
    }
    if (!isJsLike(file)) continue; // json/yml/etc. are leaves
    let source;
    try { source = readFileSync(join(root, file), 'utf8'); } catch { throw new ReachabilityUncertain(`${file}: unreadable`); }
    const { imports, loose, refs } = scanSource(file, source);
    for (const ref of refs) {
      const clean = ref.replace(/[.,;:)]+$/, '');
      enqueue(clean);
      if (existsSync(join(root, clean)) && statSync(join(root, clean)).isDirectory()) enqueueDirTooling(clean);
    }
    for (const spec of imports) {
      let base;
      if (spec.startsWith('./') || spec.startsWith('../')) base = posix.join(posix.dirname(file), spec);
      else if (spec.startsWith('@/')) base = posix.join('src', spec.slice(2));
      else continue; // bare package / node: builtin
      const resolved = resolveCandidate(root, base);
      if (!resolved) throw new ReachabilityUncertain(`${file}: cannot resolve import ${spec}`);
      enqueue(resolved);
      if (resolved.endsWith('.mjs') || resolved.endsWith('.mts')) {
        const dts = resolved.replace(/\.(mjs|mts)$/, '.d.mts');
        if (existsSync(join(root, dts))) enqueue(dts);
      }
    }
    for (const lit of loose) {
      const base = posix.join(posix.dirname(file), lit);
      if (TOOLING_DIR_RE.test(base) || /^scripts\/?$/.test(base) || base === 'scripts/agents' || base === 'scripts/metrics') {
        enqueue(base);
        if (existsSync(join(root, base)) && statSync(join(root, base)).isDirectory()) enqueueDirTooling(base);
      }
      const resolved = resolveCandidate(root, base);
      if (resolved && isJsLike(resolved)) enqueue(resolved);
      else if (!resolved && existsSync(join(root, base)) && statSync(join(root, base)).isDirectory()) {
        if (/^scripts(?:\/(?:agents|metrics))?$/.test(base)) enqueueDirTooling(base);
      }
    }
  }
  return reachable;
}

export function relativeToRoot(root, abs) {
  return toPosix(relative(root, abs));
}
