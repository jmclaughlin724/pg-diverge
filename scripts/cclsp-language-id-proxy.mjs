#!/usr/bin/env node
import { spawn } from "node:child_process";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

const separatorIndex = process.argv.indexOf("--");
const commandArgs =
  separatorIndex === -1 ? process.argv.slice(2) : process.argv.slice(separatorIndex + 1);

const [command, ...args] = commandArgs;
if (!command) {
  process.stderr.write("usage: node scripts/cclsp-language-id-proxy.mjs -- <command> [args...]\n");
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: ["pipe", "pipe", "inherit"],
});

child.on("error", (error) => {
  process.stderr.write(`cclsp-language-id-proxy: failed to start ${command}: ${error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.stdout.pipe(process.stdout);

let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  flushClientMessages();
});

process.stdin.on("end", () => {
  child.stdin.end();
});

function flushClientMessages() {
  for (;;) {
    const frame = takeFrame();
    if (!frame) {
      return;
    }
    child.stdin.write(transformFrame(frame));
  }
}

function takeFrame() {
  const headerEnd = inputBuffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) {
    return;
  }

  const headers = inputBuffer.subarray(0, headerEnd).toString("ascii").split("\r\n");
  const contentLength = readContentLength(headers);
  if (contentLength === undefined) {
    throw new Error("missing Content-Length header");
  }

  const bodyStart = headerEnd + 4;
  const frameEnd = bodyStart + contentLength;
  if (inputBuffer.length < frameEnd) {
    return;
  }

  const frame = {
    body: inputBuffer.subarray(bodyStart, frameEnd),
    raw: inputBuffer.subarray(0, frameEnd),
  };
  inputBuffer = inputBuffer.subarray(frameEnd);
  return frame;
}

function readContentLength(headers) {
  for (const header of headers) {
    const delimiter = header.indexOf(":");
    if (delimiter === -1) {
      continue;
    }
    const name = header.slice(0, delimiter).trim().toLowerCase();
    if (name !== "content-length") {
      continue;
    }
    const value = Number.parseInt(header.slice(delimiter + 1).trim(), 10);
    return Number.isFinite(value) ? value : undefined;
  }
}

function transformFrame(frame) {
  let message;
  try {
    message = JSON.parse(frame.body.toString("utf8"));
  } catch {
    return frame.raw;
  }

  if (message?.method === "textDocument/didOpen") {
    const languageId = languageIdForUri(message.params?.textDocument?.uri);
    if (languageId) {
      message.params.textDocument.languageId = languageId;
    }
  }

  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

function languageIdForUri(uri) {
  const extension = extensionForUri(uri);
  if (extension === "mjs" || extension === "cjs") {
    return "javascript";
  }
  if (extension === "mts" || extension === "cts") {
    return "typescript";
  }
}

function extensionForUri(uri) {
  if (typeof uri !== "string") {
    return "";
  }

  if (uri.startsWith("file:")) {
    try {
      return extname(fileURLToPath(uri)).slice(1).toLowerCase();
    } catch {
      return extname(uri).slice(1).toLowerCase();
    }
  }

  return extname(uri).slice(1).toLowerCase();
}
