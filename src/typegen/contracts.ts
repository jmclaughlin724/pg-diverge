import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Diagnostic, SupaschemaConfig } from "../core.js";
import { hasErrors } from "../diagnostics.js";
import { extractSourceModel } from "../source/extract.js";
import { defaultTreeSource } from "../source/resolve.js";
import { generateDatabaseTypes } from "./database.js";
import { collectSchemaShapes } from "./model.js";
import { generateZodSchemas } from "./zod.js";

interface GeneratedContractsOptions {
  config: SupaschemaConfig;
  honorWorkflowPolicy?: boolean;
  out?: string;
  source?: string;
}

interface GeneratedContractsResult {
  diagnostics: Diagnostic[];
  skipped: string[];
  stdout?: string;
  written: string[];
}

export async function generateTypeContracts(
  options: GeneratedContractsOptions
): Promise<GeneratedContractsResult> {
  const source = options.source ?? defaultTreeSource(options.config);
  const target = options.out ?? options.config.typesFile;
  const typesPath = target === "stdout" ? "stdout" : resolve(process.cwd(), target);
  const zodPath = resolve(process.cwd(), options.config.zodFile);
  const typesPolicy = options.config.workflow.type_generation;
  const zodPolicy = options.config.workflow.zod_generation;
  const writeTypes =
    target !== "stdout" &&
    (await shouldWriteGeneratedOutput(typesPath, typesPolicy, options.honorWorkflowPolicy));
  const writeZod =
    target !== "stdout" &&
    (await shouldWriteGeneratedOutput(zodPath, zodPolicy, options.honorWorkflowPolicy));
  if (target !== "stdout" && !writeTypes && !writeZod) {
    return {
      diagnostics: [],
      skipped: skippedGeneratedOutputs(typesPath, typesPolicy, zodPath, zodPolicy),
      written: [],
    };
  }
  const model = await extractSourceModel(source, { config: options.config });
  if (hasErrors(model.diagnostics)) {
    return { diagnostics: model.diagnostics, skipped: [], written: [] };
  }
  const shapes = await collectSchemaShapes(model);
  const types = generateDatabaseTypes(shapes);
  if (target === "stdout") {
    return { diagnostics: model.diagnostics, skipped: [], stdout: types, written: [] };
  }
  const written: string[] = [];
  if (writeTypes) {
    written.push(await writeGeneratedOutput(typesPath, types));
  }
  if (writeZod) {
    written.push(await writeGeneratedOutput(zodPath, generateZodSchemas(shapes)));
  }
  return { diagnostics: model.diagnostics, skipped: [], written };
}

async function writeGeneratedOutput(path: string, contents: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
}

async function shouldWriteGeneratedOutput(
  path: string,
  policy: SupaschemaConfig["workflow"]["type_generation"],
  honorWorkflowPolicy: boolean | undefined
): Promise<boolean> {
  if (honorWorkflowPolicy !== true) {
    return true;
  }
  if (policy === "disabled") {
    return false;
  }
  if (policy === "create_or_refresh") {
    return true;
  }
  return await pathExists(path);
}

function skippedGeneratedOutputs(
  typesPath: string,
  typesPolicy: SupaschemaConfig["workflow"]["type_generation"],
  zodPath: string,
  zodPolicy: SupaschemaConfig["workflow"]["zod_generation"]
): string[] {
  const skipped: string[] = [];
  if (typesPolicy === "disabled") {
    skipped.push(`types: skipped ${typesPath} because workflow.type_generation is "disabled"`);
  } else if (typesPolicy === "refresh_existing") {
    skipped.push(`types: skipped ${typesPath} because it does not exist`);
  }
  if (zodPolicy === "disabled") {
    skipped.push(`zod: skipped ${zodPath} because workflow.zod_generation is "disabled"`);
  } else if (zodPolicy === "refresh_existing") {
    skipped.push(`zod: skipped ${zodPath} because it does not exist`);
  }
  return skipped;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
