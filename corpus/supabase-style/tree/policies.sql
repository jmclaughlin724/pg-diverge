create policy accounts_select on app.accounts
  for select
  to authenticated
  using (tenant_id = (select app.current_tenant()) and balance >= 0);
