# #589 Stage 2 source candidate: ACL and notified constraint reconciliation

## Exact scope

`0127_issue_589_authz_constraint_reconciliation.sql` is a forward-only, source-only candidate for two existing public tables:

- `booking_addons`: authenticated tenant-scoped `SELECT` only; service role retains `ALL`; legacy insert/update/delete policies are removed.
- `owner_notify_recipients`: authenticated tenant-scoped CRUD and service-role `ALL`; legacy four-policy shape is replaced with the one authenticated `FOR ALL` policy.
- `booking_addons.notified`: the named check is replaced only after the table proves its column is `text NOT NULL DEFAULT 'NONE'` and every existing value is one of the six canonical `0082` values.

It does not write, delete, convert, or backfill data. A `PENDING` row blocks the migration; it is not converted to `NONE`.

## Transaction and safety boundary

The G3/G6 runner supplies the one outer transaction and its five-second lock and sixty-second statement limits; this migration must not be run bare and contains no `BEGIN` or `COMMIT`. Within that transaction it takes `ACCESS EXCLUSIVE` locks in the fixed order `booking_addons`, then `owner_notify_recipients`, before every precheck and mutation. It enables RLS without changing existing FORCE RLS state.

Unknown policy names, any column-level ACL, and table ACL grantees other than the table owner, PUBLIC, anon, authenticated, or service_role fail closed. The candidate cannot safely infer how to preserve an unknown grant.

## Verification needed after canonical merge and new TEST authorization

- Run the migration through the outer transaction and roll it back after each negative fixture: `PENDING`, an unknown policy, an unknown table role, and a column ACL must leave no persisted change.
- Verify effective privileges and RLS, not migration text: anon is denied; authenticated can only read its tenant's addons; authenticated has tenant-scoped owner-notify CRUD; service role retains the required RPC/admin paths; cross-tenant reads and writes are denied.
- Exercise concurrent insertion of a `PENDING` value while the migration holds its lock, then confirm the check is either safely blocked or installed against the post-lock value.

## Explicitly remaining G2 blockers

This candidate does not reconcile the other constraint, FK, index, trigger, enum, or storage-policy differences. The r18 TEST snapshot is missing the observed `booking_addons_performance_staff_id_fkey` constraint identity; separately, the observer has no storage-schema policy capture for `0126`. No G2 completion, TEST PASS, or Production authorization follows from this source diff.
