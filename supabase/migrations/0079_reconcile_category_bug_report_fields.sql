-- 0079 — Issue #197 historical drift reconciliation, slice 1.
--
-- Current main reads/writes these six fields, while the only source migration that
-- originally introduced them (historical 0018) never reached canonical main and is
-- currently staged only by the disposable local migration overlay. TEST and
-- Production already expose the same six columns with the same type/null/default
-- contract, verified read-only on 2026-09-07.
--
-- This file intentionally does NOT copy the rest of TEST into main. TEST contains
-- branch-only tables and fields that Production does not have. Reconciliation must
-- be sliced by current-main ownership and live Production evidence, not by treating
-- TEST as a template.
--
-- Existing rows keep the behavior users already see: description defaults to an
-- empty string, category active defaults true, and bug-report text fields default
-- to empty strings. Existing table-level RLS policies do not enumerate columns, so
-- no policy change is required.

alter table public.service_categories
  add column if not exists description text not null default '',
  add column if not exists active boolean not null default true;

alter table public.product_categories
  add column if not exists description text not null default '',
  add column if not exists active boolean not null default true;

alter table public.bug_reports
  add column if not exists subject text not null default '',
  add column if not exists contact_email text not null default '';
