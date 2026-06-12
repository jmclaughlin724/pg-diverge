import type { Client } from "pg";
import type { Diagnostic } from "./core.js";
import { diagnostic } from "./diagnostics.js";

export async function preflightCapability(admin: Client): Promise<Diagnostic | undefined> {
  const result = await admin.query<{ can_create: boolean | null }>(
    "SELECT (rolcreatedb OR rolsuper) AS can_create FROM pg_catalog.pg_roles WHERE rolname = current_user",
  );
  if (result.rows[0]?.can_create === true) {
    return undefined;
  }
  return diagnostic(
    "SUPA_VERIFY_ROLE_CAPABILITY",
    "error",
    "the verification role cannot CREATE DATABASE",
    {
      hint: "Use a role with CREATEDB. On a local Supabase stack, `postgres` lacks superuser for many extensions too — prefer `supabase_admin` (postgresql://supabase_admin:postgres@127.0.0.1:<db.port>/postgres).",
    },
  );
}

export const supabaseEnvironmentStubSql = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz DEFAULT now()
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
