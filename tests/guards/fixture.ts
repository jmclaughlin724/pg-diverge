import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function tempGuardRepo(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "supa-guard-"));
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), source);
  }
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["add", "package.json"], { cwd: dir, stdio: "ignore" });
  return dir;
}
