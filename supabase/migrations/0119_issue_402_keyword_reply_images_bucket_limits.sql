-- #402 — keyword-reply-images bucket size/MIME-type limits.
--
-- Split out of 0112_keyword_reply_images_upload_acl.sql on 2026-09-16 (PR #455
-- TERRA_BUILD round): the original single file mixed this BACKFILL-risk direct
-- DML update (existing bucket row) with an AUTHZ-risk CREATE POLICY change.
-- `scripts/agents/production-db-release-plan.mjs`'s `inferMigrationRiskTier`
-- fails closed on a migration that mixes two specialized risk tiers in one
-- file ("split migration by risk class before v1 apply"), so this statement —
-- byte-for-byte identical to the original — now lives in its own bounded
-- migration. 0112 keeps only the ACL half.
--
-- Owner decision (Issue #402, 2026-09-15 comment), unchanged by the split:
--   - keyword-reply-images stays public=true (LINE needs direct HTTPS read).
--   - file_size_limit fixed at 5 MiB (5242880 bytes).
--   - allowed_mime_types: image/jpeg, image/png, image/webp.
--   - Forward-only migration; local verification only. Not authorized for
--     canonical TEST or Production application in this change.
--
-- Release-scoping note: `supabase/ledger-alias-map.json` marks this file
-- NOT_APPLIED / VERIFIED_NOT_APPLIED rather than PENDING_APPLY for now — it is
-- deliberately held out of the current AUTHZ-tier PENDING_APPLY batch so that
-- batch can build one single-risk-tier release plan
-- (`buildProductionDbReleasePlan`'s `assertSingleRiskTier` requires every
-- PENDING_APPLY migration in a release to share one risk tier). This file
-- becomes PENDING_APPLY again once it is bundled into its own BACKFILL-tier
-- release (or one grouped with other BACKFILL-tier work) with that release's
-- own G3 evidence.

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
 where id = 'keyword-reply-images';
