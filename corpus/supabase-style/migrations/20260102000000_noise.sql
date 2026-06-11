GRANT EXECUTE ON FUNCTION app.current_tenant() TO authenticated;

REVOKE ALL ON SCHEMA app FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE SELECT ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO service_role;

CREATE TYPE app.account_status AS ENUM ('active', 'closed');
GRANT USAGE ON TYPE app.account_status TO authenticated;

COMMENT ON TABLE app.accounts IS 'Customer accounts';
COMMENT ON FUNCTION app.current_tenant() IS 'Tenant resolver';
