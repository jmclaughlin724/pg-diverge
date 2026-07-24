import { execFileSync } from "node:child_process";

const closeoutRulePath = ".claude/rules/21-source-control.md";
const candidateCommitLimit = 200;
const gitTimeoutMs = 2000;

export function mergedTopicBranchContext(root) {
  const branch = gitLine(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD" || branch === "main") {
    return {};
  }
  const originMain = gitLine(root, ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]);
  if (!originMain) {
    return {};
  }
  const squashCommit = treeIdenticalCommit(root);
  if (!squashCommit) {
    return {};
  }
  return {
    contextParts: [
      [
        `Merged-topic checkout detected: the unique commits on '${branch}' are already contained in origin/main (tree-identical squash commit ${squashCommit}).`,
        "An ahead count on this branch does not mean unmerged content; it means Rule 21 post-merge closeout is pending: `git fetch --prune origin`, fast-forward local main, `git switch main`, then delete the merged topic only with explicit user approval.",
        `Owner: ${closeoutRulePath}.`,
      ].join("\n"),
    ],
  };
}

function treeIdenticalCommit(root) {
  if (gitSucceeds(root, ["merge-base", "--is-ancestor", "HEAD", "origin/main"])) {
    return;
  }
  const headTree = gitLine(root, ["rev-parse", "HEAD^{tree}"]);
  const base = gitLine(root, ["merge-base", "HEAD", "origin/main"]);
  if (!(headTree && base)) {
    return;
  }
  const rows = gitLines(root, [
    "log",
    "--format=%H %T",
    "-n",
    String(candidateCommitLimit),
    `${base}..origin/main`,
  ]);
  for (const row of rows) {
    const [commit, tree] = row.split(" ");
    if (tree === headTree) {
      return commit;
    }
  }
}

function gitLine(root, args) {
  const lines = gitLines(root, args);
  return lines.length > 0 ? lines[0] : undefined;
}

function gitLines(root, args) {
  try {
    const stdout = execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: gitTimeoutMs,
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

function gitSucceeds(root, args) {
  try {
    execFileSync("git", args, {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: gitTimeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}
