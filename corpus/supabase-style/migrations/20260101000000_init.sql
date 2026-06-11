CREATE SCHEMA app;
GRANT USAGE ON SCHEMA app TO authenticated, anon;

CREATE FUNCTION app.current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = ''
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE app.accounts (
  id bigint NOT NULL,
  tenant_id uuid NOT NULL,
  balance numeric NOT NULL,
  status text NOT NULL
);

CREATE SEQUENCE app.accounts_id_seq;
ALTER SEQUENCE app.accounts_id_seq OWNED BY app.accounts.id;
ALTER TABLE app.accounts ALTER COLUMN id SET DEFAULT nextval('"app"."accounts_id_seq"');

ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY app.accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY accounts_select ON app.accounts
  FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT app.current_tenant()) AND balance >= 0);

GRANT SELECT ON app.accounts TO authenticated;
