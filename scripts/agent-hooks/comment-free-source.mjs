import fs from "node:fs";
import path from "node:path";
import { isJsTsCodeFile, jsTsComments } from "../lib/source-comments.mjs";

const editTools = new Set(["Edit", "MultiEdit", "Write", "apply_patch"]);
const addHeader = "*** Add File: ";
const updateHeader = "*** Update File: ";
const moveHeader = "*** Move to: ";

export function commentFreeSource(payload, context) {
  if (!editTools.has(payload?.tool_name)) {
    return {};
  }
  const input = payload?.tool_input;
  if (typeof input !== "object" || input === null) {
    return {};
  }
  const reason = addedCommentReason(payload.tool_name, input, context.root);
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
  return denyForAddedComments(rel, content, readTextIfExists(path.resolve(root, rel)));
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
  return denyForAddedComments(rel, postText, preText);
}

function patchReason(input, root) {
  const command = stringField(input, "command");
  if (command === undefined) {
    return;
  }
  for (const target of patchCodeTargets(command, root)) {
    const preText = target.isFullFile
      ? undefined
      : readTextIfExists(path.resolve(root, target.rel));
    const reason = denyForAddedComments(target.rel, target.addedText, preText);
    if (reason) {
      return reason;
    }
  }
}

function denyForAddedComments(rel, postText, preText) {
  const added = addedComments(rel, postText, preText);
  return added.length > 0 ? denyMessage(rel, added) : undefined;
}

function addedComments(fileName, postText, preText) {
  const preCounts = commentTextCounts(jsTsComments(fileName, preText ?? ""));
  const added = [];
  for (const comment of jsTsComments(fileName, postText)) {
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

function patchCodeTargets(command, root) {
  const targets = [];
  let rel;
  let isFullFile = false;
  const lines = [];
  const flush = () => {
    if (rel !== undefined) {
      targets.push({ rel, addedText: lines.join("\n"), isFullFile });
    }
    rel = undefined;
    isFullFile = false;
    lines.length = 0;
  };
  for (const line of command.split("\n")) {
    const header = patchHeader(line, root);
    if (header) {
      flush();
      rel = header.rel;
      isFullFile = header.isFullFile;
      continue;
    }
    if (rel !== undefined && line.startsWith("+") && !line.startsWith("+++")) {
      lines.push(line.slice(1));
    }
  }
  flush();
  return targets.filter((target) => isJsTsCodeFile(target.rel));
}

function patchHeader(line, root) {
  if (line.startsWith(addHeader) || line.startsWith(moveHeader)) {
    const slice = line.startsWith(addHeader) ? addHeader.length : moveHeader.length;
    return { rel: repoRelative(line.slice(slice).trim(), root), isFullFile: true };
  }
  if (line.startsWith(updateHeader)) {
    return {
      rel: repoRelative(line.slice(updateHeader.length).trim(), root),
      isFullFile: false,
    };
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
