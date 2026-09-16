-- Issue #22 Part A — banner-videos bucket seed (size/MIME-type/public config).
--
-- Split out of 0114_issue_22_banner_video_uploads.sql on 2026-09-16 (PR #455
-- TERRA_BUILD round): the original single file mixed this BACKFILL-risk
-- `INSERT ... ON CONFLICT DO UPDATE` on an existing storage.buckets row with
-- an AUTHZ-risk `ENABLE ROW LEVEL SECURITY` on a new table.
-- `scripts/agents/production-db-release-plan.mjs`'s `inferMigrationRiskTier`
-- fails closed on a migration mixing two specialized risk tiers in one file
-- ("split migration by risk class before v1 apply"), so this statement —
-- byte-for-byte identical to the original — now lives in its own bounded
-- migration. 0114 keeps only the AUTHZ half (the pending-uploads table + RLS).
--
-- Design decision, unchanged by the split (see 0114's header for full
-- context): `banner-videos` bucket is public=true (public-page `<video>` must
-- play directly), file_size_limit=52428800 (50 MiB), allowed_mime_types
-- limited to video/mp4 and video/webm — all three match the `presign`
-- endpoint's own server-side re-check (the bucket layer is the last line of
-- defense, not the only one).
--
-- Release-scoping note: `supabase/ledger-alias-map.json` marks this file
-- NOT_APPLIED / VERIFIED_NOT_APPLIED rather than PENDING_APPLY for now — it is
-- deliberately held out of the current AUTHZ-tier PENDING_APPLY batch so that
-- batch can build one single-risk-tier release plan
-- (`buildProductionDbReleasePlan`'s `assertSingleRiskTier` requires every
-- PENDING_APPLY migration in a release to share one risk tier). This file
-- becomes PENDING_APPLY again once it is bundled into its own BACKFILL-tier
-- release (or one grouped with other BACKFILL-tier work, e.g.
-- 0119_issue_402_keyword_reply_images_bucket_limits.sql) with that release's
-- own G3 evidence.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('banner-videos', 'banner-videos', true, 52428800, array['video/mp4', 'video/webm']::text[])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
