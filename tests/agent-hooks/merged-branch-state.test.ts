import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const hasModule = existsSync(join(process.cwd(), "scripts/agent-hooks/merged-branch-state.mjs"));
let mergedTopicBranchContext: any;

if (hasModule) {
  ({ mergedTopicBranchContext } = await import(
    "../../scripts/agent-hooks/merged-branch-state.mjs"
  ));
}

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "merged-branch-state-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "hooks@example.com");
  git(dir, "config", "user.name", "Hook Tests");
  git(dir, "config", "commit.gpgsign", "false");
  await writeFile(join(dir, "base.txt"), "base\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "base");
  return dir;
}

async function squashMergedRepo(): Promise<{ dir: string; squash: string }> {
  const dir = await initRepo();
  const baseCommit = git(dir, "rev-parse", "HEAD");
  git(dir, "switch", "-c", "topic");
  await writeFile(join(dir, "feature.txt"), "one\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "feature one");
  await writeFile(join(dir, "feature.txt"), "two\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "feature two");
  const topicTree = git(dir, "rev-parse", "HEAD^{tree}");
  const squash = git(dir, "commit-tree", topicTree, "-p", baseCommit, "-m", "feature (#1)");
  git(dir, "update-ref", "refs/heads/main", squash);
  git(dir, "update-ref", "refs/remotes/origin/main", squash);
  return { dir, squash };
}

describe.skipIf(!hasModule)("merged-branch-state", () => {
  it("flags a squash-merged topic checkout with the closeout contract", async () => {
    const { dir, squash } = await squashMergedRepo();
    const result = mergedTopicBranchContext(dir);
    expect(result.contextParts).toHaveLength(1);
    expect(result.contextParts[0]).toContain("Merged-topic checkout detected");
    expect(result.contextParts[0]).toContain("'topic'");
    expect(result.contextParts[0]).toContain(squash);
    expect(result.contextParts[0]).toContain("21-source-control");
  });

  it("stays silent on the main checkout", async () => {
    const { dir } = await squashMergedRepo();
    git(dir, "switch", "main");
    expect(mergedTopicBranchContext(dir)).toEqual({});
  });

  it("stays silent on a fresh branch with no unique commits", async () => {
    const { dir } = await squashMergedRepo();
    git(dir, "switch", "main");
    git(dir, "switch", "-c", "fresh");
    expect(mergedTopicBranchContext(dir)).toEqual({});
  });

  it("stays silent when the topic has unmerged commits", async () => {
    const { dir } = await squashMergedRepo();
    await writeFile(join(dir, "extra.txt"), "unmerged\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "unmerged work");
    expect(mergedTopicBranchContext(dir)).toEqual({});
  });

  it("stays silent on a detached HEAD", async () => {
    const { dir } = await squashMergedRepo();
    git(dir, "switch", "--detach");
    expect(mergedTopicBranchContext(dir)).toEqual({});
  });

  it("stays silent without an origin/main ref", async () => {
    const dir = await initRepo();
    git(dir, "switch", "-c", "topic");
    await writeFile(join(dir, "feature.txt"), "one\n");
    git(dir, "add", ".");
    git(dir, "commit", "-m", "feature");
    expect(mergedTopicBranchContext(dir)).toEqual({});
  });

  it("stays silent outside a git repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merged-branch-state-plain-"));
    expect(mergedTopicBranchContext(dir)).toEqual({});
  });
});
