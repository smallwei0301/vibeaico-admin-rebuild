-- 0038_tenant_payment_methods.sql — issue #9 tenant-owned payment credentials
--
-- Source-only migration. Do not apply to TEST or Production without the
-- Owner's explicit authorization. Secrets are encrypted application values;
-- they are never exposed by the read API or stored in config JSON.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_method_type') then
    create type payment_method_type as enum
      ('LINE_PAY','JKOPAY','BANK_TRANSFER','CASH','ONLINE_PAYMENT','OTHER');
  end if;
  if not exists (select 1 from pg_type where typname = 'gateway_provider') then
    create type gateway_provider as enum ('NEWEBPAY','ECPAY');
  end if;
end;
$$;

create table tenant_payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  method_type payment_method_type not null,
  display_name text not null default '',
  qr_image_url text not null default '',
  config jsonb not null default '{}',
  gateway_provider gateway_provider,
  gateway_merchant_id text not null default '',
  gateway_hash_key_enc text not null default '',
  gateway_hash_iv_enc text not null default '',
  gateway_verified_at timestamptz,
  connection_verified_at timestamptz,
  e2e_verified_at timestamptz,
  verification_error text,
  last_verified_at timestamptz,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tenant_payment_methods_tenant_sort_idx
  on tenant_payment_methods (tenant_id, sort_order, created_at);

create trigger tenant_payment_methods_updated_at
  before update on tenant_payment_methods
  for each row execute function set_updated_at();

alter table tenant_payment_methods enable row level security;

create policy p_tenant_payment_methods_s on tenant_payment_methods
  for select using (is_tenant_member(tenant_id));
create policy p_tenant_payment_methods_i on tenant_payment_methods
  for insert with check (is_tenant_member(tenant_id));
create policy p_tenant_payment_methods_u on tenant_payment_methods
  for update using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
create policy p_tenant_payment_methods_d on tenant_payment_methods
  for delete using (is_tenant_member(tenant_id));

comment on table tenant_payment_methods is
  'Tenant-owned payment methods; *_enc columns contain SETTINGS_ENCRYPTION_KEY encrypted secrets.';
comment on column tenant_payment_methods.gateway_verified_at is
  'Compatibility timestamp for complete checkout/callback verification; never set by connection-only checks.';
comment on column tenant_payment_methods.connection_verified_at is
  'Provider credential connection check only; does not authorize customer checkout.';
comment on column tenant_payment_methods.e2e_verified_at is
  'Set only by the #12 checkout/callback test using this tenant and this method.';
