import type { Client } from "pg";
import type { Diagnostic } from "../core.js";
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

export const supabaseEnvironmentStubSql = `
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
