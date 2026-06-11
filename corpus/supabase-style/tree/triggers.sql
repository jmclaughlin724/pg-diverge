create or replace trigger accounts_touch_audit
  before update on app.accounts
  for each row execute function app.touch_account_audit();
