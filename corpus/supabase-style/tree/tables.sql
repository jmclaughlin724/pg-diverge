create sequence app.accounts_id_seq;

create table app.accounts (
  id BIGINT not null default nextval('app.accounts_id_seq'),
  tenant_id uuid not null,
  balance numeric not null,
  status text not null,
  note text
);

alter sequence app.accounts_id_seq owned by app.accounts.id;

alter table app.accounts enable row level security;
alter table only app.accounts force row level security;

create index accounts_tenant_id_idx on app.accounts (tenant_id);

grant select on app.accounts to authenticated;

comment on table app.accounts is 'Customer accounts';
