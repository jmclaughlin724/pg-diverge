CREATE OR REPLACE VIEW app.account_names AS
SELECT
  id,
  name
FROM
  app.accounts;
