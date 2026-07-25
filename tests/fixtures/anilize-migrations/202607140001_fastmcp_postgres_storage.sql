do $$
begin
  create role anilize_mcp_runtime nologin;
exception when duplicate_object then null;
end
$$;

create table platform.fastmcp_key_value (
  collection text not null,
  key text not null,
  value jsonb not null,
  ttl double precision,
  created_at timestamptz,
  expires_at timestamptz,
  primary key (collection, key)
);

create index idx_fastmcp_key_value_expires_at
on platform.fastmcp_key_value (expires_at)
where expires_at is not null;

revoke all on platform.fastmcp_key_value from public, anon, authenticated;
grant usage on schema platform to anilize_mcp_runtime;
grant select, insert, update, delete on platform.fastmcp_key_value to anilize_mcp_runtime;
