create view app.account_summary as
  select tenant_id, count(*) as account_count, sum(balance) as total_balance
  from app.accounts
  group by tenant_id;

grant select on app.account_summary to authenticated;
