CREATE POLICY accounts_select ON app.accounts
  FOR SELECT TO public
    USING (true);
