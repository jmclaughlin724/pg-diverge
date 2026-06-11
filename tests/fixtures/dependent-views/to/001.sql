CREATE SCHEMA app;

CREATE TABLE app.accounts (
  id bigint PRIMARY KEY
);

CREATE VIEW app.z_base AS
SELECT id FROM app.accounts;

CREATE VIEW app.a_dep AS
SELECT id FROM app.z_base;
