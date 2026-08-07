import fs from "node:fs";
import path from "node:path";
import { isJsTsCodeFile, jsTsComments } from "../lib/source-comments.mjs";

const editTools = new Set(["Edit", "MultiEdit", "Write", "apply_patch"]);
const addHeader = "*** Add File: ";
const updateHeader = "*** Update File: ";
const moveHeader = "*** Move to: ";

export async function commentFreeSource(payload, context) {
  if (!editTools.has(payload?.tool_name)) {
    return {};
  }
  const input = payload?.tool_input;
  if (typeof input !== "object" || input === null) {
    return {};
  }
  const reason = await addedCommentReason(payload.tool_name, input, context.root);
  return reason ? { deny: reason } : {};
}

function addedCommentReason(toolName, input, root) {
  if (toolName === "Write") {
    return writeReason(input, root);
  }
  if (toolName === "Edit" || toolName === "MultiEdit") {
    return editReason(toolName, input, root);
  }
  return patchReason(input, root);
}

function writeReason(input, root) {
  const filePath = stringField(input, "file_path");
  const content = stringField(input, "content");
  if (filePath === undefined || content === undefined) {
    return;
  }
  const rel = repoRelative(filePath, root);
  if (!isJsTsCodeFile(rel)) {
    return;
  }
  return denyForAddedComments(rel, content, [readTextIfExists(path.resolve(root, rel))]);
}

function editReason(toolName, input, root) {
  const filePath = stringField(input, "file_path");
  if (filePath === undefined) {
    return;
  }
  const rel = repoRelative(filePath, root);
  if (!isJsTsCodeFile(rel)) {
    return;
  }
  const preText = readTextIfExists(path.resolve(root, rel));
  let postText = preText ?? "";
  for (const edit of collectEdits(toolName, input)) {
    postText = applyEdit(postText, edit);
  }
  return denyForAddedComments(rel, postText, [preText]);
}

async function patchReason(input, root) {
  const command = stringField(input, "command");
  if (command === undefined) {
    return;
  }
  for (const target of patchCodeTargets(command, root)) {
    const reason = await denyForPatchTarget(target, root);
    if (reason) {
      return reason;
    }
  }
}

function denyForPatchTarget(target, root) {
  if (target.moveDest !== undefined) {
    const sourcePreText = readTextIfExists(path.resolve(root, target.rel));
    const destPreText = readTextIfExists(path.resolve(root, target.moveDest));
    const postText = applyHunk(sourcePreText ?? "", target.hunk);
    return denyForAddedComments(target.moveDest, postText, [sourcePreText, destPreText]);
  }
  if (target.isAddFile) {
    const postText = target.hunk
      .filter((operation) => operation.kind === "add")
      .map((operation) => operation.line)
      .join("\n");
    return denyForAddedComments(target.rel, postText, []);
  }
  const preText = readTextIfExists(path.resolve(root, target.rel));
  const postText = applyHunk(preText ?? "", target.hunk);
  return denyForAddedComments(target.rel, postText, [preText]);
}

async function denyForAddedComments(rel, postText, preTexts) {
  const added = await addedComments(rel, postText, preTexts);
  return added.length > 0 ? denyMessage(rel, added) : undefined;
}

async function addedComments(fileName, postText, preTexts) {
  let preTextList;
  if (preTexts === undefined) {
    preTextList = [];
  } else if (Array.isArray(preTexts)) {
    preTextList = preTexts;
  } else {
    preTextList = [preTexts];
  }
  const preComments = (
    await Promise.all(preTextList.map((text) => jsTsComments(fileName, text ?? "")))
  ).flat();
  const preCounts = commentTextCounts(preComments);
  const added = [];
  for (const comment of await jsTsComments(fileName, postText)) {
    const remaining = preCounts.get(comment.text) ?? 0;
    if (remaining > 0) {
      preCounts.set(comment.text, remaining - 1);
    } else {
      added.push(comment);
    }
  }
  return added;
}

function commentTextCounts(comments) {
  const counts = new Map();
  for (const comment of comments) {
    counts.set(comment.text, (counts.get(comment.text) ?? 0) + 1);
  }
  return counts;
}

function collectEdits(toolName, input) {
  if (toolName === "MultiEdit") {
    return readArray(input.edits).map((edit) => editFields(edit));
  }
  return [editFields(input)];
}

function editFields(edit) {
  return {
    oldString: stringField(edit, "old_string") ?? "",
    newString: stringField(edit, "new_string") ?? "",
    replaceAll: edit?.replace_all === true,
  };
}

function applyEdit(text, edit) {
  if (edit.oldString === "") {
    return text;
  }
  return edit.replaceAll
    ? text.replaceAll(edit.oldString, edit.newString)
    : text.replace(edit.oldString, edit.newString);
}

function applyHunk(preText, hunk) {
  const preLines = preText.split("\n");
  const postLines = [];
  let preIndex = 0;

  for (const operation of hunk) {
    if (operation.kind === "context" || operation.kind === "remove") {
      const found = findLine(preLines, operation.line, preIndex);
      if (found >= 0) {
        postLines.push(
          ...preLines.slice(preIndex, operation.kind === "remove" ? found : found + 1)
        );
        preIndex = found + 1;
      }
    } else if (operation.kind === "add") {
      postLines.push(operation.line);
    }
  }

  postLines.push(...preLines.slice(preIndex));
  return postLines.join("\n");
}

function findLine(lines, line, startIndex) {
  const direct = lines.indexOf(line, startIndex);
  if (direct >= 0 || line.length === 0) {
    return direct;
  }
  const stripped = line.startsWith(" ") ? line.slice(1) : line;
  return stripped === line ? -1 : lines.indexOf(stripped, startIndex);
}

function patchCodeTargets(command, root) {
  const targets = [];
  let current;
  const flush = () => {
    if (current !== undefined) {
      targets.push(current);
      current = undefined;
    }
  };
  for (const line of command.split("\n")) {
    const header = patchHeader(line, root);
    if (header !== undefined) {
      if (header.kind === "move") {
        if (current === undefined) {
          current = { rel: header.rel, hunk: [], isAddFile: false };
        } else {
          current.moveDest = header.rel;
        }
      } else {
        flush();
        current = { rel: header.rel, hunk: [], isAddFile: header.kind === "add" };
      }
      continue;
    }
    if (current === undefined) {
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.hunk.push({ kind: "add", line: line.slice(1) });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.hunk.push({ kind: "remove", line: line.slice(1) });
    } else if (!current.isAddFile) {
      current.hunk.push({ kind: "context", line });
    }
  }
  flush();
  return targets.filter((target) => isJsTsCodeFile(target.moveDest ?? target.rel));
}

function patchHeader(line, root) {
  if (line.startsWith(addHeader)) {
    return { kind: "add", rel: repoRelative(line.slice(addHeader.length).trim(), root) };
  }
  if (line.startsWith(updateHeader)) {
    return { kind: "update", rel: repoRelative(line.slice(updateHeader.length).trim(), root) };
  }
  if (line.startsWith(moveHeader)) {
    return { kind: "move", rel: repoRelative(line.slice(moveHeader.length).trim(), root) };
  }
}

function denyMessage(rel, added) {
  const first = added[0];
  const tally = added.length === 1 ? "a comment" : `${added.length} comments`;
  return `${rel}:${first.line}:${first.character}: tracked JS/TS source is comment-free (rule 07); this edit adds ${tally}. Move the explanation to an intent-carrying name, a diagnostic hint, a test name, or the owning rule.`;
}

function stringField(value, key) {
  const field = value?.[key];
  return typeof field === "string" ? field : undefined;
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function readTextIfExists(absolutePath) {
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : undefined;
}

function repoRelative(filePath, root) {
  const posix = filePath.replaceAll("\\", "/");
  const absolute = path.isAbsolute(posix) ? posix : path.resolve(root, posix);
  return path.relative(root, absolute).replaceAll("\\", "/");
}
