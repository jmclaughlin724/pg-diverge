alter table "mortgage"."loan_cases" drop constraint "loan_cases_relationship_id_fkey";

alter table "real_estate"."transactions" drop constraint "transactions_relationship_id_fkey";

CREATE UNIQUE INDEX relationships_id_organization_id_key ON core.relationships USING btree (id, organization_id);

CREATE INDEX loan_cases_relationship_organization_idx ON mortgage.loan_cases USING btree (relationship_id, organization_id);

CREATE INDEX transactions_relationship_organization_idx ON real_estate.transactions USING btree (relationship_id, organization_id);

alter table "core"."relationships" add constraint "relationships_id_organization_id_key" UNIQUE using index "relationships_id_organization_id_key";

alter table "mortgage"."loan_cases" add constraint "loan_cases_relationship_id_organization_id_fkey" FOREIGN KEY (relationship_id, organization_id) REFERENCES core.relationships(id, organization_id) ON DELETE RESTRICT not valid;

alter table "mortgage"."loan_cases" validate constraint "loan_cases_relationship_id_organization_id_fkey";

alter table "real_estate"."transactions" add constraint "transactions_relationship_id_organization_id_fkey" FOREIGN KEY (relationship_id, organization_id) REFERENCES core.relationships(id, organization_id) ON DELETE RESTRICT not valid;

alter table "real_estate"."transactions" validate constraint "transactions_relationship_id_organization_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION api.has_permission(permission_key text, resource_organization_id uuid, resource_type text DEFAULT NULL::text, resource_id uuid DEFAULT NULL::uuid, resource_unit_id uuid DEFAULT NULL::uuid, resource_owner_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select authz.has_permission(
    $1,
    $2,
    $3,
    $4,
    $5,
    $6
  );
$function$
;
CREATE OR REPLACE FUNCTION authz.has_permission(permission_key text, resource_organization_id uuid, resource_type text DEFAULT NULL::text, resource_id uuid DEFAULT NULL::uuid, resource_unit_id uuid DEFAULT NULL::uuid, resource_owner_user_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from authz.memberships membership
    join authz.role_assignments assignment
      on assignment.membership_id = membership.id
      and assignment.organization_id = membership.organization_id
    join authz.role_permissions role_permission on role_permission.role_id = assignment.role_id
    join authz.permissions permission on permission.key = role_permission.permission_key
    where membership.user_id = (select auth.uid())
      and membership.organization_id = $2
      and membership.status = 'active'
      and permission.key = $1
      and assignment.valid_from <= now()
      and (assignment.valid_until is null or assignment.valid_until > now())
      and (
        assignment.scope = 'organization'
        or (assignment.scope = 'unit' and core.unit_is_descendant($5, assignment.unit_id))
        or (assignment.scope = 'own' and $6 = (select auth.uid()))
        or (
          assignment.scope = 'assigned'
          and exists (
            select 1 from authz.resource_assignments ra
            where ra.organization_id = $2
              and ra.resource_type = $3
              and ra.resource_id = $4
              and ra.user_id = (select auth.uid())
          )
        )
        or (
          assignment.scope = 'resource'
          and assignment.resource_type = $3
          and assignment.resource_id = $4
        )
      )
  );
$function$
;
