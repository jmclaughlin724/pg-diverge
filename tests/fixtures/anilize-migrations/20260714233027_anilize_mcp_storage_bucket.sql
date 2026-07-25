insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'anilize-mcp-storage',
  'anilize-mcp-storage',
  false,
  10485760,
  array[
    'application/json',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
