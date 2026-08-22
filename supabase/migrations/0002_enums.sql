-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0002（逐字轉錄，不可自行更動）
create type tenant_role as enum ('OWNER','MANAGER','STAFF');
create type booking_status as enum ('PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW');
create type payment_status as enum ('UNPAID','PAID_ONLINE','PAID_OFFLINE','REFUNDED');
create type booking_source as enum ('LINE','PUBLIC_PAGE','MANUAL','RECURRING');
create type product_order_status as enum ('PENDING','CONFIRMED','COMPLETED','CANCELLED');
create type coupon_status as enum ('DRAFT','PUBLISHED','PAUSED','EXPIRED');
create type discount_type as enum ('AMOUNT','PERCENT','GIFT');
create type gender_type as enum ('MALE','FEMALE','OTHER');       -- 空值以 null 表示，mapper 轉 ''
create type point_tx_type as enum ('TOPUP','CONSUME','TRANSFER_IN','TRANSFER_OUT','REFUND');
create type verification_purpose as enum ('REGISTER','RESET_PASSWORD');

-- FeatureCode 不做 enum（未來會加碼），用 text + check 即可。
