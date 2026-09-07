-- 0081 — reconcile product_orders' two coupon columns into the migration
-- ledger. Companion to 0074, which did exactly this for the block_times half
-- of the same drift; the product_orders half was never reconciled.
--
-- Schema drift note (2026-09-07): both TEST (nmwhwngojosmagjuvxol) and
-- PRODUCTION (egehnijjpgijmccagxac) already carry product_orders.coupon_discount
-- and product_orders.coupon_instance_id, verified by direct
-- information_schema.columns query on each project:
--
--   product_orders.coupon_discount    | numeric | is_nullable=YES
--   product_orders.coupon_instance_id | uuid    | is_nullable=YES
--
-- They were applied outside the ledger as part of issue #33's
-- "0027_block_times_weekly_and_product_order_coupon.sql", whose code was
-- never merged — the migration reached both databases but the file never
-- reached main. So a database built fresh from 0001..0079 does NOT have these
-- columns, while TEST and Production do. That split is exactly what breaks
-- the local-isolated CI lane: code that writes these columns passes against
-- canonical TEST and fails against a fresh build, or vice versa.
--
-- This file's job on TEST and Production is to be a true no-op that lets the
-- repo's migration history match live schema — NOT to change Production.
-- Every statement is idempotent (add column if not exists; the FK guarded by
-- an existence check), so a fresh database, TEST and Production all converge
-- on the identical result whether or not the columns were already there.
--
-- Nullability is copied verbatim from what is live (both nullable, no
-- default). Do not "improve" them to `not null default 0` here: that would
-- make a freshly-built database's schema stop matching TEST/Production, which
-- is the very drift this migration exists to end. NULL means "no coupon was
-- applied to this order" and is read as such by
-- src/app/api/product-orders/[id]/apply-coupon/route.ts.
--
-- Semantics:
--   coupon_discount    — the amount this order was discounted by, in the same
--                        currency unit as total_amount. total_amount is
--                        already net of it; this column exists so the order
--                        detail can still show the breakdown after a reload.
--   coupon_instance_id — which redeemed coupon_instances row did it, so the
--                        discount is auditable back to a specific instance
--                        rather than being an unattributable number.

alter table public.product_orders
  add column if not exists coupon_discount numeric;

alter table public.product_orders
  add column if not exists coupon_instance_id uuid;

-- The FK is added only when absent, and only when it is safe to do so, so
-- this stays a no-op on databases that already have it under this name.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_orders_coupon_instance_id_fkey'
      and conrelid = 'public.product_orders'::regclass
  ) then
    alter table public.product_orders
      add constraint product_orders_coupon_instance_id_fkey
      foreign key (coupon_instance_id)
      references public.coupon_instances (id)
      on delete set null;
  end if;
end
$$;

comment on column public.product_orders.coupon_discount is
  'Amount discounted by a redeemed coupon. total_amount is already net of this. NULL = no coupon applied.';
comment on column public.product_orders.coupon_instance_id is
  'The coupon_instances row that produced coupon_discount. NULL = no coupon applied.';
