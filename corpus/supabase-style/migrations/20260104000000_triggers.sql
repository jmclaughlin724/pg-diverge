CREATE FUNCTION app.touch_account_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status := lower(NEW.status);
  END IF;
  RETURN NEW;
END;
$function$;
COMMENT ON FUNCTION app.touch_account_audit() IS 'Normalizes status on update';
REVOKE ALL ON FUNCTION app.touch_account_audit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.touch_account_audit() TO service_role;
CREATE OR REPLACE TRIGGER accounts_touch_audit BEFORE UPDATE ON app.accounts FOR EACH ROW EXECUTE FUNCTION app.touch_account_audit();
