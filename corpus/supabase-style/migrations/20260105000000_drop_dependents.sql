CREATE VIEW app.v_account_drop_probe AS
  SELECT id, status FROM app.accounts;
GRANT SELECT ON TABLE app.v_account_drop_probe TO authenticated;
COMMENT ON VIEW app.v_account_drop_probe IS 'Transient probe relation for the drop-dependent cascade';
DROP VIEW app.v_account_drop_probe;

CREATE MATERIALIZED VIEW app.mv_account_drop_probe AS
  SELECT tenant_id, count(*) AS account_count FROM app.accounts GROUP BY tenant_id;
GRANT SELECT ON TABLE app.mv_account_drop_probe TO authenticated;
COMMENT ON MATERIALIZED VIEW app.mv_account_drop_probe IS 'Transient probe matview for the drop-dependent cascade';
DROP MATERIALIZED VIEW app.mv_account_drop_probe;

CREATE FUNCTION app.fn_account_drop_probe() RETURNS bigint
  LANGUAGE sql
  SECURITY INVOKER
  SET search_path TO ''
AS $function$ SELECT count(*) FROM app.accounts $function$;
REVOKE ALL ON FUNCTION app.fn_account_drop_probe() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_account_drop_probe() TO authenticated;
COMMENT ON FUNCTION app.fn_account_drop_probe() IS 'Transient probe routine for the drop-dependent cascade';
DROP FUNCTION app.fn_account_drop_probe();

CREATE SEQUENCE app.seq_account_drop_probe;
GRANT USAGE ON SEQUENCE app.seq_account_drop_probe TO authenticated;
COMMENT ON SEQUENCE app.seq_account_drop_probe IS 'Transient probe sequence for the drop-dependent cascade';
DROP SEQUENCE app.seq_account_drop_probe;
