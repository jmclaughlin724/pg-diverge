import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configJsonSchema } from "./config.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "supaschema configuration",
  ...configJsonSchema(),
};
await writeFile(
  resolve(packageRoot, "config-schema.json"),
  `${JSON.stringify(schema, null, 2)}\n`,
  "utf8",
);
