CREATE SCHEMA app;

CREATE TYPE app.mood AS ENUM ('it''s fine', 'won''t do', 'ok');

CREATE TABLE app."MixedCase" (
  id bigint PRIMARY KEY,
  "quoted col" text DEFAULT 'o''brien',
  current app.mood DEFAULT 'it''s fine'
);

CREATE INDEX "MixedCase_idx" ON app."MixedCase" (id);

ALTER TABLE app."MixedCase" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select policy" ON app."MixedCase" FOR SELECT USING (id > 0);

COMMENT ON TABLE app."MixedCase" IS 'it''s a "hostile" comment';

COMMENT ON COLUMN app."MixedCase"."quoted col" IS 'quoted column comment';

GRANT SELECT ON TABLE app."MixedCase" TO PUBLIC;
