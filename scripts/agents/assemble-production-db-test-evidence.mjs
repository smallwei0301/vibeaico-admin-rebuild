#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { buildProductionDbTestEvidence } from './production-db-test-evidence.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const [planPath, rawPath, releasePlanPath, cleanupPath, coveragePath, postTestSchemaPath, outputPath] = process.argv.slice(2);
  if (!planPath || !rawPath || !releasePlanPath || !cleanupPath || !coveragePath || !postTestSchemaPath || !outputPath) {
    console.error('usage: assemble-production-db-test-evidence.mjs <plan.json> <raw.json> <test-release-plan.json> <cleanup.json> <coverage.json> <post-test-schema.json> <output.json>');
    process.exitCode = 1;
    return;
  }
  try {
    const evidence = buildProductionDbTestEvidence({
      plan: readJson(planPath),
      rawRunEvidence: readJson(rawPath),
      releasePlanEvidence: readJson(releasePlanPath),
      cleanupEvidence: readJson(cleanupPath),
      coverageEvidence: readJson(coveragePath),
      postTestSchemaEvidence: readJson(postTestSchemaPath),
    });
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
