import type { Client } from "pg";
import type { Diagnostic, ObjectRef } from "../core.js";
import { diagnostic } from "../diagnostics.js";

export async function preflightCapability(admin: Client): Promise<Diagnostic | undefined> {
  const result = await admin.query<{ can_create: boolean | null }>(
    "SELECT (rolcreatedb OR rolsuper) AS can_create FROM pg_catalog.pg_roles WHERE rolname = current_user"
  );
  if (result.rows[0]?.can_create === true) {
    return;
  }
  return diagnostic(
    "SUPA_VERIFY_ROLE_CAPABILITY",
    "error",
    "the verification role cannot CREATE DATABASE",
    {
      hint: "Use a role with CREATEDB. On a local Supabase stack, `postgres` lacks superuser for many extensions too — prefer `supabase_admin` (postgresql://supabase_admin:postgres@127.0.0.1:<db.port>/postgres).",
    }
  );
}

export const unreplayableVerificationObjects: readonly ObjectRef[] = [
  { kind: "extension", name: "pg_cron" },
];

export const supabaseAuthEnvironmentStubSql = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid,
  id uuid PRIMARY KEY,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token varchar(255),
  recovery_sent_at timestamptz,
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  phone_change text,
  phone_change_token varchar(255),
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz,
  email_change_token_current varchar(255),
  email_change_confirm_status smallint,
  banned_until timestamptz,
  reauthentication_token varchar(255),
  reauthentication_sent_at timestamptz,
  is_sso_user boolean DEFAULT false,
  deleted_at timestamptz,
  is_anonymous boolean DEFAULT false
);
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz,
  refreshed_at timestamp,
  user_agent text,
  ip inet
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.email', true), '')
$$;
`;

export const supabaseVaultEnvironmentStubSql = `
CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  description text NOT NULL DEFAULT '',
  secret text NOT NULL,
  key_id uuid,
  nonce bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, key_id, nonce, created_at, updated_at
  FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret text,
  new_name text DEFAULT NULL::text,
  new_description text DEFAULT ''::text,
  new_key_id uuid DEFAULT NULL::uuid
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO vault.secrets (secret, name, description, key_id)
  VALUES (new_secret, new_name, new_description, new_key_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;
CREATE OR REPLACE FUNCTION vault.update_secret(
  secret_id uuid,
  new_secret text DEFAULT NULL::text,
  new_name text DEFAULT NULL::text,
  new_description text DEFAULT NULL::text,
  new_key_id uuid DEFAULT NULL::uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vault.secrets
  SET secret = coalesce(new_secret, secret),
      name = coalesce(new_name, name),
      description = coalesce(new_description, description),
      key_id = coalesce(new_key_id, key_id),
      updated_at = now()
  WHERE id = secret_id;
END
$$;
`;

export const supabaseCronEnvironmentStubSql = `
CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigint PRIMARY KEY,
  schedule text,
  command text,
  nodename text,
  nodeport integer,
  database text,
  username text,
  active boolean DEFAULT true,
  jobname text
);
CREATE TABLE IF NOT EXISTS cron.job_run_details (
  jobid bigint,
  runid bigint PRIMARY KEY,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);
`;

export const supabaseEnvironmentStubSql = [
  supabaseAuthEnvironmentStubSql,
  supabaseVaultEnvironmentStubSql,
  supabaseCronEnvironmentStubSql,
].join("\n");
