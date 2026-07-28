#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readCommands = new Set([
  "awk",
  "bat",
  "cat",
  "egrep",
  "fgrep",
  "grep",
  "head",
  "less",
  "more",
  "nl",
  "rg",
  "sed",
  "tail",
]);
const secretFlagNames = new Set(["--api-key", "--password", "--secret", "--token", "--value"]);
const safeEnvTemplates = new Set([
  ".env.default",
  ".env.defaults",
  ".env.example",
  ".env.sample",
  ".env.template",
]);

export function isReadCommandName(name) {
  return readCommands.has(name);
}
export function evaluateBashPolicy(input, env = process.env, options = {}) {
  if (!isBashPayload(input)) {
    return allowResult();
  }

  const command = commandFromPayload(input);
  if (!command.trim()) {
    return allowResult();
  }

  for (const check of [checkSecretArgv, checkSecretEnvFileRead, checkRawSqlDdlCommand]) {
    const result = check(command, env);
    if (result.action !== "allow") {
      return result;
    }
  }

  return checkDangerousGitAndShellWrites(command, options);
}

function isBashPayload(input) {
  return input?.tool_name === "Bash";
}

function commandFromPayload(input) {
  const toolInput = input?.tool_input ?? {};
  if (typeof toolInput.command === "string") {
    return toolInput.command;
  }
  return "";
}

function allowResult() {
  return { action: "allow" };
}

function block(message) {
  return { action: "block", message };
}

function checkSecretArgv(command) {
  const scanned = stripHeredocs(command);
  const hits = [];

  for (const tokens of commandSegments(scanned)) {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      if (hasDbUrlWithInlinePassword(token)) {
        hits.push(describeHit("DB connection URL with inline password", token));
      }
      const assignment = envAssignment(token);
      if (assignment && secretName(assignment.name) && literalSecretValue(assignment.value)) {
        hits.push(describeHit(`inline secret env ${assignment.name}=<literal>`, token));
        continue;
      }

      const flagHit = secretFlagValue(tokens, index);
      if (flagHit && literalSecretValue(flagHit.value)) {
        hits.push(describeHit(`${flagHit.name} literal in argv`, flagHit.preview));
      }
    }
  }

  if (hits.length === 0) {
    return allowResult();
  }

  return block(
    "BLOCKED: Secret material detected in Bash argv.\n\n" +
      `Matched patterns:\n  - ${hits.join("\n  - ")}\n\n` +
      "Use env-var references, stdin, or a secure file/secret-manager handoff. Do not put secrets in command argv."
  );
}

function checkSecretEnvFileRead(command) {
  const matches = [];
  for (const tokens of commandSegments(stripHeredocs(command))) {
    const start = commandStart(tokens);
    if (!isReadCommandName(tokens[start] ?? "")) {
      continue;
    }
    for (const token of tokens.slice(start + 1)) {
      const fileName = envFileName(token);
      if (fileName && !safeEnvTemplates.has(fileName)) {
        matches.push(fileName);
      }
    }
  }

  if (matches.length === 0) {
    return allowResult();
  }

  return block(
    "BLOCKED: Bash read/search of secret-bearing env files is prohibited.\n\n" +
      `Matched env file(s): ${[...new Set(matches)].join(", ")}\n\n` +
      "Use env-var references, a targeted non-secret example file, or an approved secret manager command."
  );
}

function checkRawSqlDdlCommand(command) {
  for (const tokens of commandSegments(stripHeredocs(command))) {
    if (!isRawSqlCliSegment(tokens)) {
      continue;
    }
    const keyword = sqlDdlKeyword(stripSqlComments(rawSqlPayload(tokens)));
    if (keyword) {
      return block(
        `BLOCKED: raw SQL DDL through Bash detected: ${keyword}.\n\n` +
          "Structural database changes must go through the declarative schema and generated migration workflow. Use `supaschema diff` and `supaschema check` for durable schema changes."
      );
    }
  }
  return allowResult();
}

const simpleGitWriteBlocks = new Map([
  ["stash", "BLOCKED: git stash is prohibited. Preserve unrelated work without stash."],
  ["clean", "BLOCKED: git clean is prohibited. Preserve unrelated untracked work."],
  [
    "checkout",
    "BLOCKED: git checkout is prohibited. Keep work on the current branch and use git diff/git show for comparisons.",
  ],
  ["reset", "BLOCKED: git reset is prohibited. Ask the user before running reset."],
]);

const scopedGitSubcommandChecks = new Map([
  ["branch", checkGitBranch],
  ["config", checkGitConfig],
  ["worktree", checkGitWorktree],
]);

function checkGitWriteSubcommand(gitArgs, ast, tokens, options) {
  const subcommand = gitArgs[0] ?? "";
  const scopedCheck = scopedGitSubcommandChecks.get(subcommand);
  if (scopedCheck) {
    return scopedCheck(gitArgs.slice(1), options);
  }
  const simple = simpleGitWriteBlocks.get(subcommand);
  if (simple) {
    return block(simple);
  }
  if (subcommand === "switch") {
    return checkGitSwitch(gitArgs.slice(1), options);
  }
  const activeBranchBypass = checkActiveBranchBypass(subcommand, gitArgs, options);
  if (activeBranchBypass.action === "block") {
    return activeBranchBypass;
  }
  if (subcommand === "merge" && gitArgs.includes("--squash")) {
    return block(
      "BLOCKED: local `git merge --squash` is prohibited for PR merges. Use the hosted PR squash flow instead."
    );
  }
  if (subcommand === "commit" && gitArgs.includes("--no-verify")) {
    return block("BLOCKED: --no-verify is prohibited. Fix the hook failure instead.");
  }
  if (subcommand === "push") {
    return checkGitPush(gitArgs, ast, tokens);
  }
  if (
    subcommand === "restore" &&
    gitArgs.some((arg) => arg === "-s" || arg.startsWith("--source"))
  ) {
    return block(
      "BLOCKED: git restore --source is prohibited. It overwrites local files with content from another branch. Use git diff or git show for read-only comparisons."
    );
  }
  return allowResult();
}

function checkGitPush(gitArgs, ast, tokens) {
  if (isProhibitedPush(gitArgs)) {
    return block(
      "BLOCKED: force pushes and push --no-verify are prohibited. Publish a new topic commit and keep pre-push verification enabled."
    );
  }
  if (isPushToMain(gitArgs)) {
    return block(
      "BLOCKED: direct pushes to main are prohibited. Push a topic branch and merge its protected pull request."
    );
  }
  if (gitArgs.includes("HEAD")) {
    return block(
      "BLOCKED: symbolic HEAD pushes are ambiguous. Push an explicit topic branch or explicit HEAD:<topic> refspec."
    );
  }
  if (isImplicitPush(gitArgs)) {
    return block(
      "BLOCKED: implicit pushes are ambiguous. Push an explicit topic branch or use --dry-run for remote negotiation."
    );
  }
  if (isDiagnosticPush(ast, tokens, gitArgs)) {
    return block(
      "BLOCKED: Do not use `git push` as a diagnostic or inventory probe. Use the repo pre-push check or `git push --dry-run` only when remote negotiation must be tested."
    );
  }
  return allowResult();
}

function checkActiveBranchBypass(subcommand, gitArgs, options) {
  if (!options.enforceActiveBranch) {
    return allowResult();
  }
  if (["checkout-index", "clone", "init", "read-tree", "update-ref"].includes(subcommand)) {
    return block(
      `BLOCKED: git ${subcommand} can create another checkout or bypass the active-branch boundary. Stay in the current repository and branch.`
    );
  }
  if (subcommand === "symbolic-ref" && isSymbolicRefMutation(gitArgs.slice(1))) {
    return block(
      "BLOCKED: mutating Git HEAD through symbolic-ref bypasses the active-branch boundary. Use an explicitly authorized `git switch` form."
    );
  }
  if (subcommand === "submodule" && isGitSubmoduleCheckoutMutation(gitArgs)) {
    return block(
      "BLOCKED: this git submodule form can create or mutate another checkout. All work must remain in this repository checkout. Use `git submodule status` for read-only inspection."
    );
  }
  return allowResult();
}

const readOnlyGitSubmoduleSubcommands = new Set(["status"]);

function isGitSubmoduleCheckoutMutation(gitArgs) {
  return !readOnlyGitSubmoduleSubcommands.has(gitArgs[1] ?? "");
}

function checkGitConfig(args) {
  if (!configWritesAlias(args)) {
    return allowResult();
  }
  return block(
    "BLOCKED: Git alias configuration cannot bypass source-control policy. Invoke the canonical Git subcommand directly."
  );
}

function checkGitBranch(args) {
  if (
    args.length === 2 &&
    ["-d", "-D", "--delete"].includes(args[0] ?? "") &&
    isTopicBranch(args[1])
  ) {
    return allowResult();
  }
  return block(
    "BLOCKED: git branch is limited to deleting one verified merged topic branch after explicit approval. Use git rev-parse for discovery and git switch for transactional branch creation."
  );
}

function checkGitWorktree(args, options = {}) {
  if (options.blockAllWorktrees) {
    return blockGitWorktree(options);
  }
  if (args.length === 3 && args[0] === "list" && args[1] === "--porcelain" && args[2] === "-z") {
    return allowResult();
  }
  return blockGitWorktree();
}

function blockGitWorktree(options = {}) {
  if (options.blockAllWorktrees) {
    return block(
      "BLOCKED: all Git worktree commands are prohibited for this repository, including inventory and mutation. Continue in the active primary checkout."
    );
  }
  return block(
    "BLOCKED: git worktree is limited to `git worktree list --porcelain -z` for stable read-only inventory. Use host-managed isolation for worktree creation or mutation."
  );
}

function checkGitSwitch(args) {
  if (args.length === 1 && args[0] === "main") {
    return allowResult();
  }
  if (
    args.length === 3 &&
    args[0] === "-c" &&
    isTopicBranch(args[1]) &&
    args[2] === "origin/main"
  ) {
    return allowResult();
  }
  if (
    args.length === 2 &&
    args[0] === "--track" &&
    args[1].startsWith("origin/") &&
    isTopicBranch(args[1].slice("origin/".length))
  ) {
    return allowResult();
  }
  return block(
    "BLOCKED: git switch is limited to `git switch main` after verified PR merge, `git switch -c <topic> origin/main`, or `git switch --track origin/<topic>` after the Rule 21 PR preflight."
  );
}

function isSymbolicRefMutation(args) {
  if (args.includes("--delete")) {
    return true;
  }
  return args.filter((arg) => !arg.startsWith("-")).length > 1;
}

function isTopicBranch(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "HEAD" &&
    value !== "main" &&
    value !== "master" &&
    value !== "origin/main" &&
    !value.startsWith("-") &&
    !value.startsWith("refs/")
  );
}

function checkDangerousGitAndShellWrites(command, options = {}) {
  const ast = { segments: commandSegmentObjects(stripHeredocs(command)) };
  if (ast.segments.some((segment) => segment.nestedCommandLimitReached)) {
    return block(
      "BLOCKED: nested shell command depth exceeded the safety parser limit. Run the governed command directly."
    );
  }
  if (
    ast.segments.some(
      (segment) =>
        commandName(segment.words) === "rm" &&
        rmArgsIncludeRecursiveForce(commandArgs(segment.words))
    )
  ) {
    return block(
      "BLOCKED: `rm -rf` and equivalent recursive+force rm invocations are prohibited. Use explicit, reviewed file operations instead."
    );
  }

  for (let index = 0; index < ast.segments.length; index += 1) {
    const result = checkDangerousCommandSegment(ast, index, options);
    if (result.action !== "allow") {
      return result;
    }
  }

  return allowResult();
}

function checkDangerousCommandSegment(ast, index, options) {
  const segment = ast.segments[index];
  const tokens = segment.words;
  const name = commandName(tokens);
  const dynamicGitInvocation = parseDynamicGitInvocation(ast.segments, index);
  if (dynamicGitInvocation) {
    if (dynamicGitInvocation.args[0] === "worktree") {
      return blockGitWorktree(options);
    }
    return checkGitWriteSubcommand(dynamicGitInvocation.args, ast, tokens, options);
  }
  if (name === "git-worktree") {
    return blockGitWorktree(options);
  }
  if (name === "gh") {
    return checkGhPrMerge(commandArgs(tokens), options);
  }
  if (name !== "git") {
    return allowResult();
  }
  const invocation = parseGitInvocation(tokens);
  if (invocation.invokesAlias) {
    return block(
      "BLOCKED: Git aliases cannot bypass source-control policy. Invoke the canonical Git subcommand directly."
    );
  }
  if (invocation.hasGlobalOptions && invocation.args[0] === "worktree") {
    return blockGitWorktree(options);
  }
  return checkGitWriteSubcommand(invocation.args, ast, tokens, options);
}

function checkGhPrMerge(args, options = {}) {
  if (options.enforceActiveBranch && args[0] === "pr" && args[1] === "checkout") {
    return block(
      "BLOCKED: `gh pr checkout` bypasses the active-branch policy. Use an explicitly authorized Rule 21 `git switch --track` command."
    );
  }
  if (args[0] !== "pr" || args[1] !== "merge") {
    return allowResult();
  }
  const mergeArgs = args.slice(2);
  if (mergeArgs.some((arg) => arg === "--help" || arg === "-h")) {
    return allowResult();
  }
  const blocked = mergeArgs.find((arg) =>
    ["--merge", "--rebase", "--admin", "--disable-auto"].includes(arg)
  );
  if (blocked) {
    return block(
      `BLOCKED: gh pr merge ${blocked} is prohibited. Use \`gh pr merge <number> --squash --delete-branch\`.`
    );
  }
  if (!(mergeArgs.includes("--squash") && mergeArgs.includes("--delete-branch"))) {
    return block(
      "BLOCKED: gh pr merge must use the repo policy method: `gh pr merge <number> --squash --delete-branch`."
    );
  }
  return allowResult();
}

function commandSegments(command) {
  return commandSegmentObjects(command).map((segment) => segment.words);
}

export function commandSegmentObjects(command) {
  return expandShellSegments(parseShellAst(command));
}

function expandShellSegments(ast, depth = 0) {
  const segments = [];
  for (const segment of ast.segments) {
    const nestedCommands = [
      nestedShellCommand(segment.words),
      nestedEnvSplitCommand(segment.words),
    ].filter((command) => typeof command === "string" && command.length > 0);
    segments.push({
      ...segment,
      nestedCommandLimitReached: depth >= 3 && nestedCommands.length > 0,
    });
    if (depth < 3) {
      for (const nestedCommand of nestedCommands) {
        segments.push(...expandShellSegments(parseShellAst(nestedCommand), depth + 1));
      }
    }
  }
  return segments;
}

function nestedShellCommand(tokens) {
  if (!["bash", "sh", "zsh"].includes(commandName(tokens))) {
    return;
  }
  const args = commandArgs(tokens);
  for (let index = 0; index < args.length - 1; index += 1) {
    if (shellCommandOption(args[index] ?? "")) {
      const commandIndex = nestedShellCommandIndex(args, index + 1);
      return args[commandIndex];
    }
  }
}

function nestedEnvSplitCommand(tokens) {
  let index = 0;
  while (index < tokens.length && envAssignment(tokens[index])) {
    index += 1;
  }
  if (executableName(tokens[index] ?? "") !== "env") {
    return;
  }
  const args = tokens.slice(index + 1);
  for (let argIndex = 0; argIndex < args.length; argIndex += 1) {
    const arg = args[argIndex] ?? "";
    if (arg === "-S" || arg === "--split-string") {
      return [args[argIndex + 1], ...args.slice(argIndex + 2)].filter(Boolean).join(" ");
    }
    for (const prefix of ["-S", "--split-string="]) {
      if (arg.startsWith(prefix) && arg.length > prefix.length) {
        return [arg.slice(prefix.length), ...args.slice(argIndex + 1)].join(" ");
      }
    }
  }
}

function shellCommandOption(value) {
  return value.startsWith("-") && value.slice(1).includes("c");
}

function nestedShellCommandIndex(args, start) {
  let index = start;
  while (args[index] === "--") {
    index += 1;
  }
  return index;
}

function parseShellAst(command) {
  const segments = [];
  let current = [];
  let nextOperator = "";
  for (const token of shellTokens(command)) {
    if (token.kind === "operator") {
      if (current.length > 0) {
        segments.push({ operatorBefore: nextOperator, words: current });
        current = [];
      }
      nextOperator = token.value;
      continue;
    }
    current.push(token.value);
  }
  if (current.length > 0) {
    segments.push({ operatorBefore: nextOperator, words: current });
  }
  return { segments };
}

function shellTokens(command) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;

  const pushToken = () => {
    if (token.length > 0) {
      tokens.push({ kind: "word", value: token });
      token = "";
    }
  };

  for (const char of command) {
    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      token += quote ? "" : "\\";
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        token += char;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (isWhitespace(char)) {
      pushToken();
      continue;
    }
    if (
      char === ";" ||
      char === "|" ||
      char === ">" ||
      char === "<" ||
      char === "&" ||
      char === "(" ||
      char === ")"
    ) {
      pushToken();
      tokens.push({ kind: "operator", value: char });
      continue;
    }
    token += char;
  }
  pushToken();
  return tokens;
}

const commandWrappers = new Map([
  ["env", new Set(["-C", "-S", "-u", "-P"])],
  ["exec", new Set(["-a"])],
  ["command", new Set()],
  [
    "sudo",
    new Set([
      "--chdir",
      "--close-from",
      "--group",
      "--host",
      "--prompt",
      "--role",
      "--type",
      "--user",
      "-C",
      "-D",
      "-g",
      "-h",
      "-p",
      "-R",
      "-r",
      "-T",
      "-t",
      "-u",
    ]),
  ],
]);

function commandStart(tokens) {
  let index = 0;
  while (index < tokens.length && envAssignment(tokens[index])) {
    index += 1;
  }
  while (commandWrappers.has(executableName(tokens[index] ?? ""))) {
    index = skipCommandWrapper(tokens, index);
  }
  return index;
}

function skipCommandWrapper(tokens, start) {
  const valueOptions = commandWrappers.get(executableName(tokens[start] ?? ""));
  let index = start + 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "--") {
      index += 1;
      break;
    }
    if (envAssignment(token)) {
      index += 1;
      continue;
    }
    if (typeof token === "string" && token.startsWith("-") && token !== "-") {
      index += 1;
      if (valueOptions.has(token) && index < tokens.length) {
        index += 1;
      }
      continue;
    }
    break;
  }
  return index;
}

const gitGlobalValueOptions = new Set([
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--super-prefix",
  "--work-tree",
  "-C",
  "-c",
]);

function parseGitInvocation(tokens) {
  const start = commandStart(tokens);
  const aliases = configuredGitAliases(tokens.slice(0, start));
  const args = tokens.slice(start + 1);
  let index = 0;
  let hasGlobalOptions = false;
  while (index < args.length) {
    const arg = args[index];
    if (typeof arg !== "string" || !arg.startsWith("-") || arg === "-") {
      break;
    }
    hasGlobalOptions = true;
    index += 1;
    if ((arg === "-c" || arg === "--config-env") && index < args.length) {
      addGitAlias(aliases, args[index] ?? "");
    } else if (arg.startsWith("--config-env=")) {
      addGitAlias(aliases, arg.slice("--config-env=".length));
    } else if (arg.startsWith("-c") && arg.length > 2) {
      addGitAlias(aliases, arg.slice(2));
    }
    if (gitGlobalValueOptions.has(arg) && index < args.length) {
      index += 1;
    }
  }
  const commandArgs = args.slice(index);
  return {
    args: commandArgs,
    hasGlobalOptions,
    invokesAlias: aliases.has((commandArgs[0] ?? "").toLowerCase()),
  };
}

function configuredGitAliases(tokens) {
  const aliases = new Set();
  for (const token of tokens) {
    const assignment = envAssignment(token);
    if (assignment?.name.startsWith("GIT_CONFIG_KEY_")) {
      addGitAlias(aliases, assignment.value);
    }
  }
  return aliases;
}

function addGitAlias(aliases, config) {
  const alias = gitAliasName(config);
  if (alias) {
    aliases.add(alias);
  }
}

function gitAliasName(config) {
  const equals = config.indexOf("=");
  const name = (equals === -1 ? config : config.slice(0, equals)).toLowerCase();
  if (!name.startsWith("alias.")) {
    return "";
  }
  const alias = name.slice("alias.".length);
  return alias.endsWith(".command") ? alias.slice(0, -".command".length) : alias;
}

function configWritesAlias(args) {
  const aliasIndex = args.findIndex((arg) => gitAliasName(arg));
  return aliasIndex !== -1 && aliasIndex < args.length - 1;
}

function parseDynamicGitInvocation(segments, index) {
  const segment = segments[index];
  const tokens = segment.words;
  const start = commandStart(tokens);
  const rawName = tokens[start] ?? "";
  const dynamicInvocation = parseGitInvocation(["git", ...tokens.slice(start + 1)]);
  if (isDynamicExecutable(rawName)) {
    return dynamicInvocation;
  }
  const substitutionTail = parseGitInvocation(["git", ...tokens]);
  if (segment.operatorBefore !== ")") {
    return;
  }
  for (let openIndex = index - 1; openIndex > 0; openIndex -= 1) {
    if (segments[openIndex].operatorBefore !== "(") {
      continue;
    }
    const owner = segments[openIndex - 1].words;
    const ownerStart = commandStart(owner);
    return owner[ownerStart] === "$" && owner.length === ownerStart + 1
      ? substitutionTail
      : undefined;
  }
}

function isDynamicExecutable(value) {
  return value.startsWith("$") || [...value].some(isWhitespace);
}

function executableName(value) {
  const separator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  const basename = value.slice(separator + 1);
  return basename.endsWith(".exe") ? basename.slice(0, -".exe".length) : basename;
}

export function commandName(tokens) {
  return executableName(tokens[commandStart(tokens)] ?? "");
}

export function commandArgs(tokens) {
  return tokens.slice(commandStart(tokens) + 1);
}

function envAssignment(token) {
  const equals = token.indexOf("=");
  if (equals <= 0) {
    return;
  }
  const name = token.slice(0, equals);
  if (!isIdentifierName(name)) {
    return;
  }
  return { name, value: token.slice(equals + 1) };
}

function secretName(name) {
  const upper = name.toUpperCase();
  return (
    upper.includes("SECRET") ||
    upper.includes("TOKEN") ||
    upper.includes("PASSWORD") ||
    upper.includes("KEY") ||
    upper.includes("CREDENTIAL") ||
    upper.includes("PASSWD") ||
    upper.includes("PASS")
  );
}

function literalSecretValue(value) {
  return value.length >= 16 && !looksMasked(value) && value[0] !== "$";
}

function secretFlagValue(tokens, index) {
  const token = tokens[index] ?? "";
  const equals = token.indexOf("=");
  if (equals > 0) {
    const name = token.slice(0, equals);
    if (secretFlagNames.has(name)) {
      return { name, preview: token, value: token.slice(equals + 1) };
    }
    return;
  }
  if (secretFlagNames.has(token) && typeof tokens[index + 1] === "string") {
    return {
      name: token,
      preview: `${token} ${tokens[index + 1]}`,
      value: tokens[index + 1],
    };
  }
}

function envFileName(token) {
  const cleaned = trimShellPunctuation(token);
  const fileName = cleaned.split("/").pop() ?? "";
  if (fileName === ".envrc" || fileName === ".env" || fileName.startsWith(".env.")) {
    return fileName;
  }
}

function isRawSqlCliSegment(tokens) {
  const start = commandStart(tokens);
  const command = tokens[start] ?? "";
  if (command === "psql") {
    return true;
  }
  return (
    command === "supabase" &&
    tokens[start + 1] === "db" &&
    ["execute", "query"].includes(tokens[start + 2] ?? "")
  );
}

function rawSqlPayload(tokens) {
  const start = commandStart(tokens);
  const command = tokens[start] ?? "";
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if ((command === "psql" && ["-c", "--command"].includes(token)) || token === "--sql") {
      return tokens[index + 1] ?? "";
    }
    const sqlFlag = "--sql=";
    if (token.startsWith(sqlFlag)) {
      return token.slice(sqlFlag.length);
    }
  }
  return tokens.slice(start + 1).join(" ");
}

function rmArgsIncludeRecursiveForce(args) {
  let recursive = false;
  let force = false;
  for (const arg of args) {
    if (arg === "--") {
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      continue;
    }
    if (arg === "--recursive") {
      recursive = true;
    } else if (arg === "--force") {
      force = true;
    } else if (!arg.startsWith("--")) {
      recursive ||= containsAny(arg, ["r", "R"]);
      force ||= arg.includes("f");
    }
    if (recursive && force) {
      return true;
    }
  }
  return false;
}

function isPushToMain(args) {
  return args.some((arg) => {
    const refspec = arg.startsWith("+") ? arg.slice(1) : arg;
    return (
      refspec === "main" ||
      refspec === "refs/heads/main" ||
      refspec.endsWith(":main") ||
      refspec.endsWith(":refs/heads/main")
    );
  });
}

function isProhibitedPush(args) {
  return (
    args.some(
      (arg) =>
        arg === "--no-verify" ||
        hasShortForceFlag(arg) ||
        arg === "--force" ||
        arg === "--force-if-includes" ||
        arg.startsWith("--force-with-lease")
    ) || pushRefspecs(args).some((refspec) => refspec.startsWith("+"))
  );
}

function hasShortForceFlag(arg) {
  if (!arg.startsWith("-") || arg.startsWith("--")) {
    return false;
  }
  const flags = arg.slice(1).split("o", 1)[0];
  return flags.includes("f");
}

function isImplicitPush(args) {
  if (args.some((arg) => arg === "--dry-run" || arg === "-n" || arg === "--help" || arg === "-h")) {
    return false;
  }
  return pushRefspecs(args).length === 0;
}

function pushRefspecs(args) {
  const valueOptions = new Set(["--exec", "--push-option", "--receive-pack", "--repo", "-o"]);
  const positionals = [];
  let repositoryProvidedByOption = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const optionName = arg.split("=", 1)[0];
    if (optionName === "--recurse-submodules") {
      if (!arg.includes("=") && ["check", "on-demand", "no"].includes(args[index + 1] ?? "")) {
        index += 1;
      }
      continue;
    }
    if (valueOptions.has(optionName)) {
      repositoryProvidedByOption ||= optionName === "--repo";
      if (!arg.includes("=")) {
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    positionals.push(arg);
  }
  return repositoryProvidedByOption ? positionals : positionals.slice(1);
}

function isDiagnosticPush(ast, gitPushTokens, args) {
  if (args.some((arg) => arg === "--dry-run" || arg === "-n")) {
    return false;
  }
  const index = ast.segments.findIndex((segment) => segment.words === gitPushTokens);
  if (index === -1) {
    return false;
  }
  const next = ast.segments[index + 1];
  return (
    next?.operatorBefore === "|" &&
    ["awk", "grep", "head", "sed", "tail", "wc"].includes(commandName(next.words))
  );
}

function stripHeredocs(command) {
  const lines = command.split("\n");
  const out = [];
  let marker = "";
  for (const line of lines) {
    if (marker) {
      if (line.trim() === marker) {
        out.push("HEREDOC");
        marker = "";
      }
      continue;
    }
    const heredoc = heredocMarker(line);
    if (heredoc) {
      marker = heredoc;
      out.push("<<HEREDOC");
      out.push("[heredoc body stripped]");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function looksMasked(value) {
  const lower = value.toLowerCase();
  return (
    lower.includes("[redacted]") ||
    lower.includes("<password>") ||
    lower.includes("<secret>") ||
    lower.includes("<token>") ||
    value.includes("***") ||
    lower.includes("xxx")
  );
}

function describeHit(kind, match) {
  const preview = match.length > 44 ? `${match.slice(0, 16)}...${match.slice(-6)}` : match;
  return `${kind}: ${preview}`;
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function hasDbUrlWithInlinePassword(value) {
  const schemeEnd = value.indexOf("://");
  if (schemeEnd <= 0) {
    return false;
  }
  const scheme = value.slice(0, schemeEnd).toLowerCase();
  if (!["mysql", "postgres", "postgresql"].includes(scheme)) {
    return false;
  }
  const authorityStart = schemeEnd + 3;
  const authorityEnd = firstIndexOfAny(value, ["/", "?", "#"], authorityStart);
  const authority = value.slice(authorityStart, authorityEnd === -1 ? value.length : authorityEnd);
  const at = authority.lastIndexOf("@");
  if (at <= 0) {
    return false;
  }
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon <= 0) {
    return false;
  }
  const password = userinfo.slice(colon + 1);
  return password.length >= 12 && !looksMasked(password);
}

function sqlDdlKeyword(sql) {
  const tokens = sqlTokens(sql);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1] ?? "";
    const third = tokens[index + 2] ?? "";
    const fourth = tokens[index + 3] ?? "";
    if (token === "GRANT" || token === "REVOKE" || token === "TRUNCATE") {
      return token;
    }
    if (token === "ENABLE" && next === "ROW" && third === "LEVEL" && fourth === "SECURITY") {
      return "ENABLE ROW LEVEL SECURITY";
    }
    if (token === "CREATE" && createKinds(tokens, index + 1)) {
      return `CREATE ${createKinds(tokens, index + 1)}`;
    }
    if (token === "ALTER" && alterKinds(tokens, index + 1)) {
      return `ALTER ${alterKinds(tokens, index + 1)}`;
    }
    if (token === "DROP" && dropKinds(tokens, index + 1)) {
      return `DROP ${dropKinds(tokens, index + 1)}`;
    }
  }
}

function createKinds(tokens, index) {
  const first = tokens[index] ?? "";
  const second = tokens[index + 1] ?? "";
  if (first === "MATERIALIZED" && second === "VIEW") {
    return "MATERIALIZED VIEW";
  }
  return [
    "EXTENSION",
    "FUNCTION",
    "INDEX",
    "POLICY",
    "ROLE",
    "SCHEMA",
    "SEQUENCE",
    "TABLE",
    "TRIGGER",
    "TYPE",
    "VIEW",
  ].includes(first)
    ? first
    : "";
}

function alterKinds(tokens, index) {
  const first = tokens[index] ?? "";
  return ["FUNCTION", "POLICY", "ROLE", "SCHEMA", "SEQUENCE", "TABLE", "TYPE"].includes(first)
    ? first
    : "";
}

function dropKinds(tokens, index) {
  const first = tokens[index] ?? "";
  const second = tokens[index + 1] ?? "";
  if (first === "MATERIALIZED" && second === "VIEW") {
    return "MATERIALIZED VIEW";
  }
  return [
    "EXTENSION",
    "FUNCTION",
    "INDEX",
    "POLICY",
    "ROLE",
    "SCHEMA",
    "SEQUENCE",
    "TABLE",
    "TRIGGER",
    "TYPE",
    "VIEW",
  ].includes(first)
    ? first
    : "";
}

function sqlTokens(sql) {
  const tokens = [];
  let token = "";
  let quote = "";
  const push = () => {
    if (token) {
      tokens.push(token.toUpperCase());
      token = "";
    }
  };

  for (const char of sql) {
    if (quote) {
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      push();
      quote = char;
      continue;
    }
    if (isIdentifierChar(char)) {
      token += char;
      continue;
    }
    push();
  }
  push();
  return tokens;
}

function skipSqlLineComment(sql, start) {
  let index = start + 2;
  while (index < sql.length && !["\n", "\r"].includes(sql[index] ?? "")) {
    index += 1;
  }
  return index;
}

function skipSqlBlockComment(sql, start) {
  let index = start + 2;
  while (index < sql.length && !((sql[index] ?? "") === "*" && (sql[index + 1] ?? "") === "/")) {
    index += 1;
  }
  return index + 2;
}

function stripSqlComments(sql) {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (char === "-" && next === "-") {
      index = skipSqlLineComment(sql, index);
      out += " ";
      continue;
    }
    if (char === "/" && next === "*") {
      index = skipSqlBlockComment(sql, index);
      out += " ";
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function heredocMarker(line) {
  const markerStart = line.indexOf("<<");
  if (markerStart === -1) {
    return "";
  }
  let index = markerStart + 2;
  if (line[index] === "-") {
    index += 1;
  }
  while (index < line.length && isWhitespace(line[index] ?? "")) {
    index += 1;
  }
  const quote = line[index] === "'" || line[index] === '"' ? line[index] : "";
  if (quote) {
    index += 1;
  }
  let marker = "";
  while (index < line.length) {
    const char = line[index] ?? "";
    if (
      (quote && char === quote) ||
      (!quote && (isWhitespace(char) || [";", "|", "&"].includes(char)))
    ) {
      break;
    }
    marker += char;
    index += 1;
  }
  return marker;
}

function trimShellPunctuation(value) {
  let start = 0;
  let end = value.length;
  const leading = new Set(["<", ">", '"', "'"]);
  const trailing = new Set(["<", ">", '"', "'", ",", ":", ";", "|", ")"]);
  while (start < end && leading.has(value[start] ?? "")) {
    start += 1;
  }
  while (end > start && trailing.has(value[end - 1] ?? "")) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isIdentifierName(value) {
  if (!value) {
    return false;
  }
  if (!(isAsciiLetter(value[0] ?? "") || value[0] === "_")) {
    return false;
  }
  for (const char of value.slice(1)) {
    if (!(isAsciiLetter(char) || isDigit(char) || char === "_")) {
      return false;
    }
  }
  return true;
}

function isIdentifierChar(char) {
  return isAsciiLetter(char) || isDigit(char) || char === "_";
}

function isAsciiLetter(char) {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function containsAny(value, candidates) {
  return candidates.some((candidate) => value.includes(candidate));
}

function firstIndexOfAny(value, chars, start) {
  let found = -1;
  for (const char of chars) {
    const index = value.indexOf(char, start);
    if (index !== -1 && (found === -1 || index < found)) {
      found = index;
    }
  }
  return found;
}

function main() {
  let payload = {};
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw.trim() ? JSON.parse(raw) : {};
    const result = evaluateBashPolicy(payload);
    if (result.action === "block") {
      process.stderr.write(`${result.message}\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(
      `bash-policy-checks hook failed closed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(2);
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(modulePath);
  } catch {
    return entry === modulePath;
  }
}

if (isMainModule()) {
  main();
}
