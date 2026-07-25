create extension if not exists pgcrypto with schema extensions;

create schema if not exists core;
create schema if not exists authz;
create schema if not exists crm;
create schema if not exists sites;
create schema if not exists real_estate;
create schema if not exists mortgage;
create schema if not exists audit;
create schema if not exists platform;
create schema if not exists api;

do $$
begin
  create role anilize_portal_runtime nologin;
exception when duplicate_object then null;
end
$$;

create type core.organization_kind as enum ('real_estate', 'mortgage');
create type core.organization_status as enum (
  'draft',
  'verification_pending',
  'active',
  'suspended',
  'closed'
);
create type core.unit_kind as enum ('team', 'branch');
create type core.relationship_kind as enum ('real_estate', 'mortgage');
create type core.relationship_status as enum ('invited', 'active', 'closed');
create type core.consent_state as enum ('pending', 'granted', 'revoked');
create type authz.scope_type as enum ('organization', 'unit', 'own', 'assigned', 'resource');
create type authz.membership_status as enum ('invited', 'active', 'suspended', 'revoked');
create type sites.site_owner_type as enum ('organization', 'professional');
create type sites.site_status as enum ('draft', 'published', 'archived');
create type sites.domain_status as enum ('pending', 'active', 'revoked');
create type sites.surface_kind as enum ('public_site', 'portal');
create type sites.portal_kind as enum (
  'identity',
  'corporate_admin',
  'realtor_portal',
  'loan_officer_portal',
  'contact_portal'
);
create type mortgage.retention_status as enum ('active', 'legal_hold', 'eligible_for_disposal', 'disposed');
create type audit.outcome as enum ('success', 'failure', 'denied');

create table core.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  kind core.organization_kind not null,
  name text not null check (char_length(name) between 2 and 160),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status core.organization_status not null default 'draft',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index organizations_slug_unique on core.organizations (lower(slug));

create table core.organization_units (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete cascade,
  parent_id uuid,
  kind core.unit_kind not null,
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (parent_id, organization_id)
    references core.organization_units(id, organization_id) on delete restrict
);
create index organization_units_organization_id_idx on core.organization_units(organization_id);
create index organization_units_parent_id_idx on core.organization_units(parent_id);

create table core.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.people (
  id uuid primary key default extensions.gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table core.relationships (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete restrict,
  person_id uuid not null references core.people(id) on delete restrict,
  professional_user_id uuid references auth.users(id) on delete set null,
  kind core.relationship_kind not null,
  status core.relationship_status not null default 'invited',
  consent core.consent_state not null default 'pending',
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index relationships_organization_id_idx on core.relationships(organization_id);
create index relationships_person_id_idx on core.relationships(person_id);

create table authz.permissions (
  key text primary key,
  product text not null check (product in ('system', 'real_estate', 'mortgage', 'shared')),
  description text not null,
  tenant_assignable boolean not null default true
);

create table authz.memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status authz.membership_status not null default 'invited',
  is_tenant_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (id, organization_id)
);
create index memberships_user_id_idx on authz.memberships(user_id);
create index memberships_organization_id_idx on authz.memberships(organization_id);

create table authz.role_templates (
  key text primary key,
  name text not null,
  product text not null check (product in ('system', 'real_estate', 'mortgage')),
  default_scope authz.scope_type not null
);

create table authz.role_template_permissions (
  role_template_key text not null references authz.role_templates(key) on delete cascade,
  permission_key text not null references authz.permissions(key) on delete cascade,
  primary key (role_template_key, permission_key)
);

create table authz.roles (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete cascade,
  template_key text references authz.role_templates(key) on delete set null,
  name text not null,
  description text,
  is_system_managed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name)
);
create index roles_organization_id_idx on authz.roles(organization_id);

create table authz.role_permissions (
  role_id uuid not null references authz.roles(id) on delete cascade,
  permission_key text not null references authz.permissions(key) on delete restrict,
  primary key (role_id, permission_key)
);
create index role_permissions_permission_key_idx on authz.role_permissions(permission_key);

create table authz.role_assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete cascade,
  membership_id uuid not null,
  role_id uuid not null,
  scope authz.scope_type not null,
  unit_id uuid,
  resource_type text,
  resource_id uuid,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  foreign key (membership_id, organization_id)
    references authz.memberships(id, organization_id) on delete cascade,
  foreign key (role_id, organization_id)
    references authz.roles(id, organization_id) on delete cascade,
  foreign key (unit_id, organization_id)
    references core.organization_units(id, organization_id) on delete cascade,
  check ((scope = 'unit') = (unit_id is not null)),
  check ((scope = 'resource') = (resource_id is not null and resource_type is not null)),
  check (valid_until is null or valid_until > valid_from)
);
create index role_assignments_membership_id_idx on authz.role_assignments(membership_id);
create index role_assignments_role_id_idx on authz.role_assignments(role_id);
create index role_assignments_resource_idx on authz.role_assignments(resource_type, resource_id);

create table authz.resource_assignments (
  organization_id uuid not null references core.organizations(id) on delete cascade,
  resource_type text not null,
  resource_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, resource_type, resource_id, user_id)
);
create index resource_assignments_user_id_idx on authz.resource_assignments(user_id);

create table crm.contact_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete cascade,
  person_id uuid references core.people(id) on delete set null,
  assigned_professional_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  source text,
  status text not null default 'lead' check (status in ('lead', 'active', 'archived')),
  tags text[] not null default '{}',
  private_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index contact_profiles_organization_id_idx on crm.contact_profiles(organization_id);
create index contact_profiles_person_id_idx on crm.contact_profiles(person_id);

create table sites.tenant_sites (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete cascade,
  owner_type sites.site_owner_type not null,
  owner_id uuid not null,
  product core.organization_kind not null,
  slug text not null,
  status sites.site_status not null default 'draft',
  display_name text not null,
  theme jsonb not null default '{}',
  content jsonb not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, owner_type, owner_id),
  unique (id, organization_id)
);
create index tenant_sites_organization_id_idx on sites.tenant_sites(organization_id);

create table sites.domains (
  id uuid primary key default extensions.gen_random_uuid(),
  hostname text not null,
  organization_id uuid references core.organizations(id) on delete cascade,
  site_id uuid,
  product core.organization_kind,
  surface sites.surface_kind not null,
  portal sites.portal_kind,
  status sites.domain_status not null default 'pending',
  verification_token_hash text,
  vercel_project_id text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (site_id, organization_id)
    references sites.tenant_sites(id, organization_id) on delete cascade,
  check ((surface = 'public_site') = (site_id is not null)),
  check ((surface = 'portal') = (portal is not null))
);
create unique index domains_hostname_unique on sites.domains(lower(hostname));
create index domains_organization_id_idx on sites.domains(organization_id);

create table platform.portal_oauth_clients (
  domain_id uuid primary key references sites.domains(id) on delete cascade,
  client_id text not null unique,
  secret_ciphertext text not null,
  secret_iv text not null,
  secret_tag text not null,
  redirect_uri text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table authz.portal_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references core.organizations(id) on delete cascade,
  domain_id uuid not null references sites.domains(id) on delete cascade,
  client_id text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_tag text not null,
  aal text not null check (aal in ('aal1', 'aal2')),
  access_token_expires_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index portal_sessions_user_id_idx on authz.portal_sessions(user_id);
create index portal_sessions_domain_id_idx on authz.portal_sessions(domain_id);

grant usage on schema sites, platform, authz to anilize_portal_runtime;
grant select on sites.domains, platform.portal_oauth_clients to anilize_portal_runtime;
grant insert on authz.portal_sessions to anilize_portal_runtime;
grant select(id, token_hash, user_id, organization_id, domain_id, aal, expires_at, revoked_at)
on authz.portal_sessions to anilize_portal_runtime;

create table real_estate.transactions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete cascade,
  relationship_id uuid not null references core.relationships(id) on delete restrict,
  unit_id uuid,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'prospect' check (status in ('prospect', 'active', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (unit_id, organization_id)
    references core.organization_units(id, organization_id) on delete restrict
);
create index transactions_organization_id_idx on real_estate.transactions(organization_id);

create table mortgage.loan_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references core.organizations(id) on delete cascade,
  relationship_id uuid not null references core.relationships(id) on delete restrict,
  unit_id uuid,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'prospect'
    check (status in ('prospect', 'application', 'processing', 'underwriting', 'closed')),
  sensitive_payload jsonb,
  retention_status mortgage.retention_status not null default 'active',
  retain_until timestamptz,
  disposed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (unit_id, organization_id)
    references core.organization_units(id, organization_id) on delete restrict,
  check ((retention_status = 'disposed') = (disposed_at is not null))
);
create index loan_cases_organization_id_idx on mortgage.loan_cases(organization_id);

create table audit.events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid references core.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  elevation_session_id uuid,
  source_surface text not null,
  source_domain text not null,
  action text not null,
  resource_type text,
  resource_id uuid,
  reason text,
  outcome audit.outcome not null,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_events_organization_created_idx on audit.events(organization_id, created_at desc);
create index audit_events_actor_created_idx on audit.events(actor_user_id, created_at desc);

create table platform.staff_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  roles text[] not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table platform.elevation_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  staff_user_id uuid not null references platform.staff_memberships(user_id) on delete cascade,
  organization_id uuid not null references core.organizations(id) on delete cascade,
  reason text not null,
  ticket_reference text not null,
  capabilities text[] not null default '{}',
  read_only boolean not null default true,
  approved_by uuid references platform.staff_memberships(user_id) on delete restrict,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (expires_at > created_at)
);
alter table audit.events
  add constraint audit_events_elevation_session_fk
  foreign key (elevation_session_id) references platform.elevation_sessions(id) on delete set null;

create or replace function core.unit_is_descendant(candidate_id uuid, ancestor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive unit_tree as (
    select id, parent_id from core.organization_units where id = candidate_id
    union all
    select parent.id, parent.parent_id
    from core.organization_units parent
    join unit_tree child on child.parent_id = parent.id
  )
  select exists(select 1 from unit_tree where id = ancestor_id);
$$;

create or replace function authz.has_permission(
  permission_key text,
  resource_organization_id uuid,
  resource_type text default null,
  resource_id uuid default null,
  resource_unit_id uuid default null,
  resource_owner_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from authz.memberships membership
    join authz.role_assignments assignment
      on assignment.membership_id = membership.id
      and assignment.organization_id = membership.organization_id
    join authz.role_permissions role_permission on role_permission.role_id = assignment.role_id
    join authz.permissions permission on permission.key = role_permission.permission_key
    where membership.user_id = (select auth.uid())
      and membership.organization_id = resource_organization_id
      and membership.status = 'active'
      and permission.key = permission_key
      and assignment.valid_from <= now()
      and (assignment.valid_until is null or assignment.valid_until > now())
      and (
        assignment.scope = 'organization'
        or (assignment.scope = 'unit' and core.unit_is_descendant(resource_unit_id, assignment.unit_id))
        or (assignment.scope = 'own' and resource_owner_user_id = (select auth.uid()))
        or (
          assignment.scope = 'assigned'
          and exists (
            select 1 from authz.resource_assignments ra
            where ra.organization_id = resource_organization_id
              and ra.resource_type = resource_type
              and ra.resource_id = resource_id
              and ra.user_id = (select auth.uid())
          )
        )
        or (
          assignment.scope = 'resource'
          and assignment.resource_type = resource_type
          and assignment.resource_id = resource_id
        )
      )
  );
$$;

create or replace function api.has_permission(
  permission_key text,
  resource_organization_id uuid,
  resource_type text default null,
  resource_id uuid default null,
  resource_unit_id uuid default null,
  resource_owner_user_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select authz.has_permission(
    permission_key,
    resource_organization_id,
    resource_type,
    resource_id,
    resource_unit_id,
    resource_owner_user_id
  );
$$;

revoke all on function core.unit_is_descendant(uuid, uuid)
from public, anon, authenticated;
revoke all on function authz.has_permission(text, uuid, text, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function authz.has_permission(text, uuid, text, uuid, uuid, uuid)
to authenticated;
revoke all on function api.has_permission(text, uuid, text, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function api.has_permission(text, uuid, text, uuid, uuid, uuid)
to authenticated;

create or replace function audit.reject_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit events are immutable';
end;
$$;

create trigger audit_events_immutable
before update or delete on audit.events
for each row execute function audit.reject_event_mutation();

alter table core.people enable row level security;
alter table core.relationships enable row level security;
alter table crm.contact_profiles enable row level security;
alter table sites.tenant_sites enable row level security;
alter table real_estate.transactions enable row level security;
alter table mortgage.loan_cases enable row level security;
alter table audit.events enable row level security;

create policy people_self_read on core.people
for select to authenticated
using (auth_user_id = (select auth.uid()));

create policy relationships_contact_read on core.relationships
for select to authenticated
using (
  exists (
    select 1 from core.people person
    where person.id = relationships.person_id and person.auth_user_id = (select auth.uid())
  )
  or authz.has_permission('contact.read', organization_id, 'relationship', id, null, professional_user_id)
);

create policy contacts_authorized_read on crm.contact_profiles
for select to authenticated
using (authz.has_permission('contact.read', organization_id, 'contact', id, null, assigned_professional_id));

create policy contacts_authorized_insert on crm.contact_profiles
for insert to authenticated
with check (authz.has_permission('contact.create', organization_id, 'contact', id, null, assigned_professional_id));

create policy contacts_authorized_update on crm.contact_profiles
for update to authenticated
using (authz.has_permission('contact.update', organization_id, 'contact', id, null, assigned_professional_id))
with check (authz.has_permission('contact.update', organization_id, 'contact', id, null, assigned_professional_id));

create policy published_sites_public_read on sites.tenant_sites
for select to anon
using (status = 'published');

create policy tenant_sites_authenticated_read on sites.tenant_sites
for select to authenticated
using (
  status = 'published'
  or authz.has_permission('site.manage', organization_id, 'site', id, null, owner_id)
);

create policy tenant_sites_insert on sites.tenant_sites
for insert to authenticated
with check (authz.has_permission('site.manage', organization_id, 'site', id, null, owner_id));

create policy tenant_sites_update on sites.tenant_sites
for update to authenticated
using (authz.has_permission('site.manage', organization_id, 'site', id, null, owner_id))
with check (authz.has_permission('site.manage', organization_id, 'site', id, null, owner_id));

create policy transactions_authorized_read on real_estate.transactions
for select to authenticated
using (authz.has_permission('transaction.read', organization_id, 'transaction', id, unit_id, owner_user_id));

create policy transactions_authorized_insert on real_estate.transactions
for insert to authenticated
with check (authz.has_permission('transaction.create', organization_id, 'transaction', id, unit_id, owner_user_id));

create policy transactions_authorized_update on real_estate.transactions
for update to authenticated
using (authz.has_permission('transaction.update', organization_id, 'transaction', id, unit_id, owner_user_id))
with check (authz.has_permission('transaction.update', organization_id, 'transaction', id, unit_id, owner_user_id));

create policy loans_require_mfa on mortgage.loan_cases
as restrictive for all to authenticated
using (((select auth.jwt())->>'aal') = 'aal2')
with check (((select auth.jwt())->>'aal') = 'aal2');

create policy loans_authorized_read on mortgage.loan_cases
for select to authenticated
using (authz.has_permission('loan.read', organization_id, 'loan', id, unit_id, owner_user_id));

create policy loans_authorized_insert on mortgage.loan_cases
for insert to authenticated
with check (authz.has_permission('loan.create', organization_id, 'loan', id, unit_id, owner_user_id));

create policy loans_authorized_update on mortgage.loan_cases
for update to authenticated
using (authz.has_permission('loan.update', organization_id, 'loan', id, unit_id, owner_user_id))
with check (authz.has_permission('loan.update', organization_id, 'loan', id, unit_id, owner_user_id));

create policy audit_tenant_read on audit.events
for select to authenticated
using (organization_id is not null and authz.has_permission('audit.read', organization_id));

create or replace view api.public_sites
with (security_invoker = true)
as
select id, organization_id, owner_type, owner_id, product, slug, display_name, theme, content, published_at
from sites.tenant_sites
where status = 'published';

grant usage on schema api, sites to anon;
grant usage on schema api, core, crm, sites, real_estate, mortgage, audit to authenticated;
grant select on api.public_sites to anon, authenticated;
grant execute on function api.has_permission(text, uuid, text, uuid, uuid, uuid) to authenticated;
revoke all on all tables in schema core, authz, crm, sites, real_estate, mortgage, audit, platform from anon, authenticated;
grant select on core.people, core.relationships to authenticated;
grant select, insert, update on crm.contact_profiles to authenticated;
grant select on sites.tenant_sites to anon;
grant select, insert, update on sites.tenant_sites to authenticated;
grant select, insert, update on real_estate.transactions to authenticated;
grant select, insert, update on mortgage.loan_cases to authenticated;
grant select on audit.events to authenticated;

insert into authz.permissions(key, product, description, tenant_assignable) values
  ('audit.read', 'shared', 'Read tenant audit events', true),
  ('billing.manage', 'system', 'Manage tenant billing', false),
  ('billing.read', 'system', 'Read tenant billing', false),
  ('contact.assign', 'shared', 'Assign contacts', true),
  ('contact.create', 'shared', 'Create contacts', true),
  ('contact.export', 'shared', 'Export contacts', true),
  ('contact.read', 'shared', 'Read contacts', true),
  ('contact.update', 'shared', 'Update contacts', true),
  ('domain.manage', 'shared', 'Manage tenant domains', true),
  ('loan.assign', 'mortgage', 'Assign loans', true),
  ('loan.create', 'mortgage', 'Create loans', true),
  ('loan.document.read', 'mortgage', 'Read loan documents', true),
  ('loan.document.upload', 'mortgage', 'Upload loan documents', true),
  ('loan.export', 'mortgage', 'Export loan data', true),
  ('loan.read', 'mortgage', 'Read loans', true),
  ('loan.read_sensitive', 'mortgage', 'Read sensitive borrower fields', true),
  ('loan.update', 'mortgage', 'Update loans', true),
  ('loan.update_sensitive', 'mortgage', 'Update sensitive borrower fields', true),
  ('member.invite', 'shared', 'Invite tenant members', true),
  ('member.manage', 'shared', 'Manage tenant members', true),
  ('organization.close', 'system', 'Close the tenant', false),
  ('organization.manage', 'shared', 'Manage organization settings', true),
  ('role.manage', 'shared', 'Manage tenant roles', true),
  ('site.manage', 'shared', 'Manage public sites', true),
  ('site.publish', 'shared', 'Publish public sites', true),
  ('transaction.assign', 'real_estate', 'Assign transactions', true),
  ('transaction.create', 'real_estate', 'Create transactions', true),
  ('transaction.document.read', 'real_estate', 'Read transaction documents', true),
  ('transaction.document.upload', 'real_estate', 'Upload transaction documents', true),
  ('transaction.read', 'real_estate', 'Read transactions', true),
  ('transaction.update', 'real_estate', 'Update transactions', true)
on conflict (key) do update set description = excluded.description;

insert into authz.role_templates(key, name, product, default_scope) values
  ('tenant_owner', 'Tenant owner', 'system', 'organization'),
  ('broker', 'Broker', 'real_estate', 'organization'),
  ('team_leader', 'Team leader', 'real_estate', 'unit'),
  ('transaction_coordinator', 'Transaction coordinator', 'real_estate', 'assigned'),
  ('assistant', 'Assistant', 'real_estate', 'assigned'),
  ('realtor', 'Realtor', 'real_estate', 'own'),
  ('company_manager', 'Company manager', 'mortgage', 'organization'),
  ('branch_manager', 'Branch manager', 'mortgage', 'unit'),
  ('loan_officer', 'Loan officer', 'mortgage', 'own'),
  ('in_house_processor', 'In-house processor', 'mortgage', 'assigned'),
  ('third_party_processor', 'Third-party processor', 'mortgage', 'resource')
on conflict (key) do update set name = excluded.name;

insert into authz.role_template_permissions(role_template_key, permission_key)
select template.key, permission.key
from authz.role_templates template
join authz.permissions permission on
  (template.key = 'tenant_owner' and permission.key in ('billing.manage', 'billing.read', 'organization.close'))
  or (template.key = 'broker' and permission.product in ('shared', 'real_estate'))
  or (template.key = 'company_manager' and permission.product in ('shared', 'mortgage'))
  or (template.key = 'team_leader' and permission.key in ('contact.assign', 'contact.create', 'contact.read', 'contact.update', 'member.manage', 'transaction.assign', 'transaction.create', 'transaction.document.read', 'transaction.document.upload', 'transaction.read', 'transaction.update'))
  or (template.key = 'transaction_coordinator' and permission.key in ('contact.read', 'transaction.document.read', 'transaction.document.upload', 'transaction.read', 'transaction.update'))
  or (template.key = 'assistant' and permission.key in ('contact.create', 'contact.read', 'contact.update', 'transaction.read'))
  or (template.key = 'realtor' and permission.key in ('contact.create', 'contact.read', 'contact.update', 'site.manage', 'site.publish', 'transaction.create', 'transaction.document.read', 'transaction.document.upload', 'transaction.read', 'transaction.update'))
  or (template.key = 'branch_manager' and permission.key in ('contact.assign', 'contact.create', 'contact.read', 'contact.update', 'loan.assign', 'loan.create', 'loan.document.read', 'loan.document.upload', 'loan.read', 'loan.read_sensitive', 'loan.update', 'loan.update_sensitive', 'member.manage'))
  or (template.key = 'loan_officer' and permission.key in ('contact.create', 'contact.read', 'contact.update', 'loan.create', 'loan.document.read', 'loan.document.upload', 'loan.read', 'loan.read_sensitive', 'loan.update', 'loan.update_sensitive', 'site.manage', 'site.publish'))
  or (template.key = 'in_house_processor' and permission.key in ('contact.read', 'loan.document.read', 'loan.document.upload', 'loan.read', 'loan.read_sensitive', 'loan.update', 'loan.update_sensitive'))
  or (template.key = 'third_party_processor' and permission.key in ('loan.document.read', 'loan.document.upload', 'loan.read', 'loan.read_sensitive', 'loan.update'))
on conflict do nothing;

create or replace function api.create_organization(
  organization_name text,
  organization_slug text,
  organization_kind core.organization_kind
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid;
  new_membership_id uuid;
  owner_role_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  insert into core.organizations(kind, name, slug)
  values (organization_kind, organization_name, organization_slug)
  returning id into new_organization_id;

  insert into authz.memberships(organization_id, user_id, status, is_tenant_owner)
  values (new_organization_id, auth.uid(), 'active', true)
  returning id into new_membership_id;

  insert into authz.roles(organization_id, template_key, name, is_system_managed)
  select new_organization_id, template.key, template.name, template.key = 'tenant_owner'
  from authz.role_templates template
  where template.product in ('system', organization_kind::text);

  insert into authz.role_permissions(role_id, permission_key)
  select role.id, template_permission.permission_key
  from authz.roles role
  join authz.role_template_permissions template_permission
    on template_permission.role_template_key = role.template_key
  where role.organization_id = new_organization_id;

  select id into owner_role_id from authz.roles
  where organization_id = new_organization_id and template_key = 'tenant_owner';

  insert into authz.role_assignments(organization_id, membership_id, role_id, scope)
  values (new_organization_id, new_membership_id, owner_role_id, 'organization');

  insert into sites.tenant_sites(
    organization_id, owner_type, owner_id, product, slug, display_name
  ) values (
    new_organization_id, 'organization', new_organization_id,
    organization_kind, organization_slug, organization_name
  );

  insert into audit.events(
    organization_id, actor_user_id, source_surface, source_domain,
    action, resource_type, resource_id, outcome
  ) values (
    new_organization_id, auth.uid(), 'self_service_onboarding', 'canonical',
    'organization.created', 'organization', new_organization_id, 'success'
  );

  return new_organization_id;
end;
$$;

revoke all on function api.create_organization(text, text, core.organization_kind)
from public, anon, authenticated;
grant execute on function api.create_organization(text, text, core.organization_kind) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('loan-documents', 'loan-documents', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png']),
  ('transaction-documents', 'transaction-documents', false, 52428800, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false;

create policy loan_documents_require_mfa on storage.objects
as restrictive for all to authenticated
using (bucket_id <> 'loan-documents' or ((select auth.jwt())->>'aal') = 'aal2')
with check (bucket_id <> 'loan-documents' or ((select auth.jwt())->>'aal') = 'aal2');

create policy tenant_document_read on storage.objects
for select to authenticated
using (
  bucket_id in ('loan-documents', 'transaction-documents')
  and authz.has_permission(
    case when bucket_id = 'loan-documents' then 'loan.document.read' else 'transaction.document.read' end,
    ((storage.foldername(name))[1])::uuid,
    case when bucket_id = 'loan-documents' then 'loan' else 'transaction' end,
    ((storage.foldername(name))[2])::uuid
  )
);

create policy tenant_document_upload on storage.objects
for insert to authenticated
with check (
  bucket_id in ('loan-documents', 'transaction-documents')
  and authz.has_permission(
    case when bucket_id = 'loan-documents' then 'loan.document.upload' else 'transaction.document.upload' end,
    ((storage.foldername(name))[1])::uuid,
    case when bucket_id = 'loan-documents' then 'loan' else 'transaction' end,
    ((storage.foldername(name))[2])::uuid
  )
);
