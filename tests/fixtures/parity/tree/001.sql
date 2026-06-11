CREATE SCHEMA app;

CREATE TYPE app.mood AS ENUM ('happy', 'sad');

CREATE TYPE app.pair AS (left_value integer, right_value text);

CREATE DOMAIN app.email AS text NOT NULL CHECK (char_length(VALUE) > 0);

CREATE SEQUENCE app.invoice_seq START 100 INCREMENT 5 CACHE 10;

CREATE TABLE app.accounts (
  id bigint PRIMARY KEY,
  label text NOT NULL,
  current app.mood DEFAULT 'happy',
  contact app.email,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX accounts_label_idx ON app.accounts (label);

CREATE UNIQUE INDEX accounts_lower_label_idx ON app.accounts (lower(label));

CREATE INDEX accounts_happy_idx ON app.accounts (id) WHERE id > 0;

ALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_select ON app.accounts FOR SELECT USING (id > 0);

CREATE FUNCTION app.account_count() RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT count(*) FROM app.accounts $$;

CREATE FUNCTION app.touch() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_touch
BEFORE UPDATE ON app.accounts
FOR EACH ROW
EXECUTE FUNCTION app.touch();

GRANT ALL ON TABLE app.accounts TO app_parity_role;

GRANT USAGE ON SCHEMA app TO app_parity_role;

GRANT EXECUTE ON FUNCTION app.account_count() TO app_parity_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO app_parity_role;

COMMENT ON TABLE app.accounts IS 'Account registry';

COMMENT ON COLUMN app.accounts.label IS 'Display label';

COMMENT ON FUNCTION app.account_count() IS 'Counts accounts';

COMMENT ON SCHEMA app IS 'Application schema';

COMMENT ON INDEX app.accounts_label_idx IS 'Label lookup';

COMMENT ON POLICY accounts_select ON app.accounts IS 'Read access';

COMMENT ON TYPE app.mood IS 'Mood enum';

COMMENT ON SEQUENCE app.invoice_seq IS 'Invoice numbers';
