create type app.account_status as enum ('active', 'closed');
grant usage on type app.account_status to authenticated;
