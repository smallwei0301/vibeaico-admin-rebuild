import { createHash } from 'node:crypto';

const IDENTITY = '0135_issue_46_guide_interval_availability';
const PATH = `supabase/migrations/${IDENTITY}.sql`;
const CANONICAL_SHA256 = 'c798b1596d149d1f866553bf8736bea7214fc7bd0531ea750f2511a17d39a59d';
const TRANSPORT_SHA256 = '961e480475c488b484086a058f68391ca0e512e6aafcc64e13c3246acabefb87';
const digest = (value) => createHash('sha256').update(value).digest('hex');

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

/**
 * Pure transport adaptation for the one reviewed canonical wrapper. This does
 * not authorize execution or replace either caller's atomic-admission checks.
 * The release plan continues to identify the complete, unmodified source bytes.
 * Only its two outer commands are omitted: the caller owns the transaction,
 * advisory lock, ledger insertion and postchecks through the final COMMIT.
 * @param {{entry: {repoFile: string, path: string, sha256: string}, sql: string}} input
 */
export function canonicalMigrationTransport({ entry, sql }) {
  const canonicalSha256 = digest(sql);
  if (canonicalSha256 !== entry.sha256) {
    fail('MIGRATION_BYTES_MISMATCH', `${entry.path} differs from reviewed main bytes`);
  }
  if (entry.repoFile !== IDENTITY && entry.path !== PATH) {
    return { sql, canonicalSha256, transportSha256: canonicalSha256 };
  }
  if (entry.repoFile !== IDENTITY || entry.path !== PATH) {
    fail('CANONICAL_TRANSPORT_IDENTITY_MISMATCH', '0135 transport requires its exact identity and path');
  }
  if (canonicalSha256 !== CANONICAL_SHA256) {
    fail('CANONICAL_TRANSPORT_PIN_MISMATCH', '0135 source differs from the reviewed transport pin');
  }
  // Offsets are safe only after the complete source pin above. Do not turn this
  // into generic BEGIN/COMMIT stripping or split/rejoin source normalization.
  const begin = sql.indexOf('begin;');
  const commit = sql.lastIndexOf('commit;');
  const transportSql = sql.slice(0, begin) + sql.slice(begin + 6, commit) + sql.slice(commit + 7);
  const transportSha256 = digest(transportSql);
  if (transportSha256 !== TRANSPORT_SHA256) {
    fail('CANONICAL_TRANSPORT_PIN_MISMATCH', '0135 transport differs from the reviewed byte-preserving envelope');
  }
  return { sql: transportSql, canonicalSha256, transportSha256 };
}
