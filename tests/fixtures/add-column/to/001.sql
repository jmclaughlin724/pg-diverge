CREATE SCHEMA app;

CREATE TABLE app.accounts (
  id bigint PRIMARY KEY,
  name text DEFAULT ''::text NOT NULL
);
