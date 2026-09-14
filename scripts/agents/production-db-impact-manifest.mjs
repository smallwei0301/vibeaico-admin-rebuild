export const PRODUCTION_DB_IMPACT_MANIFEST_SCHEMA_VERSION = 1;

const SURFACES = new Set([
  'columns', 'constraints', 'indexes', 'views', 'policies', 'routines', 'triggers', 'acl',
]);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

export function normalizeProductionDbImpactManifest(manifest = {}) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest?.entries)) {
    fail('INVALID_IMPACT_MANIFEST', 'schemaVersion 1 entries are required');
  }
  const seenFiles = new Set();
  const entries = manifest.entries.map((entry, index) => {
    const repoFile = String(entry?.repoFile ?? '').trim();
    if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(repoFile) || repoFile.endsWith('.sql')) {
      fail('INVALID_IMPACT_REPO_FILE', `entries[${index}].repoFile is invalid`);
    }
    if (seenFiles.has(repoFile)) fail('DUPLICATE_IMPACT_MIGRATION', `${repoFile} is duplicated`);
    seenFiles.add(repoFile);
    if (!Array.isArray(entry?.impacts)) fail('INVALID_IMPACT_LIST', `${repoFile}.impacts must be an array`);
    const seenImpacts = new Set();
    const impacts = entry.impacts.map((impact) => {
      const surface = String(impact?.surface ?? '').trim();
      const objectKey = String(impact?.objectKey ?? '').trim();
      if (!SURFACES.has(surface) || !objectKey || objectKey.includes('*') || objectKey.includes('?')) {
        fail('INVALID_IMPACT_OBJECT', `${repoFile} has a non-exact impact key`);
      }
      const identity = `${surface}:${objectKey}`;
      if (seenImpacts.has(identity)) fail('DUPLICATE_IMPACT_OBJECT', identity);
      seenImpacts.add(identity);
      return { surface, objectKey };
    });
    return { repoFile, impacts };
  });
  return { schemaVersion: 1, entries };
}
