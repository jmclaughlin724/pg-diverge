GRANT INSERT ON app.accounts TO anon;
REVOKE INSERT ON app.accounts FROM anon;

REVOKE EXECUTE ON FUNCTION app.current_tenant() FROM PUBLIC;
