-- Adjacent seed data: DML run by `supabase db reset` AFTER migrations apply.
-- supaschema never reads, diffs, or generates this file; it is here only so the
-- sample mirrors a real Supabase CLI project layout.
insert into app.accounts (name)
values ('Acme'),
       ('Globex')
on conflict do nothing;
