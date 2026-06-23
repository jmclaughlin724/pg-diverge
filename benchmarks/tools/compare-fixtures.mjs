import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../..");
const { makeRealisticSqlFixture, realisticFixtureManifest } = await import(
  join(packageRoot, "dist/benchmark/fixtures.js")
);

export async function discoverFixtures(fixtureRoot) {
  const entries = await readdir(fixtureRoot, { withFileTypes: true });
  const fixtures = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) {
      continue;
    }
    fixtures.push(await fixtureFromDirectory(join(fixtureRoot, entry.name), entry.name));
  }

  const extraDirs = (process.env.SUPASCHEMA_COMPARE_FIXTURE_DIRS ?? "")
    .split(",")
    .flatMap((value) => value.split(":"))
    .map((value) => value.trim())
    .filter(Boolean);
  for (const directory of extraDirs) {
    fixtures.push(await fixtureFromDirectory(resolve(directory), basename(resolve(directory))));
  }
  return fixtures;
}

async function fixtureFromDirectory(directory, name) {
  const fixture = {
    directory,
    fromSqlPath: join(directory, "from.sql"),
    name,
    toDirectory: directory,
    toSqlPath: join(directory, "to.sql"),
  };
  const config = await readJson(join(directory, "fixture.json"));
  if (config !== undefined) {
    if (Array.isArray(config.schemas) && config.schemas.length > 0) {
      fixture.schemas = config.schemas.map(String);
    }
    if (typeof config.supaschemaAdapter === "string") {
      fixture.supaschemaAdapter = config.supaschemaAdapter;
    }
  }
  const manifest = await readJson(join(directory, "manifest.json"));
  if (manifest !== undefined && Array.isArray(manifest)) {
    fixture.manifest = manifest;
  }
  return fixture;
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return;
  }
}

export async function materializeGeneratedFixtures(tempRoot, xlTables, xxlTables = 0) {
  const generated = [{ name: "realistic", tableCount: 50 }];
  if (xlTables > 0) {
    generated.push({ name: "xl", tableCount: xlTables });
  }
  if (xxlTables > 0) {
    generated.push({ name: "xxl", tableCount: xxlTables });
  }
  const fixtures = [];
  for (const { name, tableCount } of generated) {
    const directory = join(tempRoot, `${name}-fixture`);
    await mkdir(directory, { recursive: true });
    const sql = makeRealisticSqlFixture(tableCount);
    const fromSqlPath = join(directory, "from.sql");
    const toSqlPath = join(directory, "to.sql");
    await writeFile(fromSqlPath, sql.from, "utf8");
    await writeFile(toSqlPath, sql.to, "utf8");
    fixtures.push({
      directory,
      fromSqlPath,
      manifest: realisticFixtureManifest(tableCount),
      name,
      toDirectory: directory,
      toSqlPath,
    });
  }
  return fixtures;
}
