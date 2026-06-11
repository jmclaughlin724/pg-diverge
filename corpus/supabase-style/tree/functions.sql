create function app.current_tenant() returns uuid
  language sql stable
  set search_path = ''
  as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

revoke execute on function app.current_tenant() from public;
grant execute on function app.current_tenant() to authenticated;

comment on function app.current_tenant() is 'Tenant resolver';

create function app.touch_account_audit() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
begin
  if NEW.status is distinct from OLD.status then
    NEW.status := lower(NEW.status);
  end if;
  return NEW;
end;
$$;

revoke all on function app.touch_account_audit() from public;
grant execute on function app.touch_account_audit() to service_role;

comment on function app.touch_account_audit() is 'Normalizes status on update';
