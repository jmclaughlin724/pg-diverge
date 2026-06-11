import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

let portCursor = Number(process.env.PG_DIVERGE_COMPARE_PORT_BASE ?? 55_400);

export async function prepareSupabaseWorkdir(context, adapter, iteration) {
  if (!adapter.id.startsWith("supabase-")) {
    return;
  }
  const [dbPort, shadowPort] = await availablePortPair();
  const supabaseDirectory = join(context.runRoot, "supabase");
  const projectId = stableProjectId(context.fixture.name, adapter.id, iteration);
  await mkdir(supabaseDirectory, { recursive: true });
  await writeFile(
    join(supabaseDirectory, "config.toml"),
    `project_id = "${projectId}"

[db]
port = ${dbPort}
shadow_port = ${shadowPort}
major_version = 17
`,
    "utf8",
  );
  context.supabaseConfig = {
    dbPort,
    projectId,
    shadowPort,
  };
}

async function availablePortPair() {
  const first = await availablePort(portCursor);
  const second = await availablePort(first + 1);
  portCursor = second + 1;
  return [first, second];
}

async function availablePort(start) {
  for (let port = start; port < 65_535; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`could not find an available local port from ${start}`);
}

function isPortAvailable(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolvePort(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolvePort(true));
    });
  });
}

function stableProjectId(fixtureName, adapterId, iteration) {
  const source = `${fixtureName}:${adapterId}:${iteration}:${process.pid}`;
  let hash = 0;
  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `pg-diverge-${hash.toString(36)}`;
}
