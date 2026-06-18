const MASK = "[redacted]";

export function redactSecrets(text: string): string {
  return redactJwtTokens(
    redactSupabaseSecrets(redactSecretAssignments(redactUrlCredentials(text)))
  );
}

export function hasUnredactedSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}

function isUserinfoEnd(char: string): boolean {
  return (
    char === "@" || char === "/" || char === " " || char === "\t" || char === "\n" || char === "\r"
  );
}

function redactUrlCredentials(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const marker = value.indexOf("://", index);
    if (marker === -1) {
      result += value.slice(index);
      break;
    }
    const afterScheme = marker + 3;
    result += value.slice(index, afterScheme);
    let cursor = afterScheme;
    let colon = -1;
    while (cursor < value.length && !isUserinfoEnd(value[cursor] ?? "")) {
      if (value[cursor] === ":" && colon === -1) {
        colon = cursor;
      }
      cursor += 1;
    }
    if (value[cursor] === "@" && colon > afterScheme && cursor > colon + 1) {
      result += `${value.slice(afterScheme, colon + 1)}${MASK}`;
      index = cursor;
    } else {
      index = afterScheme;
    }
  }
  return result;
}

function redactSecretAssignments(value: string): string {
  let output = "";
  let index = 0;
  while (index < value.length) {
    const assignment = readSecretAssignment(value, index);
    if (assignment === undefined) {
      output += value[index] ?? "";
      index += 1;
      continue;
    }
    output += value.slice(index, assignment.secretStart);
    output += MASK;
    index = assignment.end;
  }
  return output;
}

function readSecretAssignment(
  value: string,
  index: number
): { end: number; secretStart: number } | undefined {
  const key = readSecretKey(value, index);
  if (key === undefined) {
    return;
  }
  const separator = skipInlineWhitespace(value, key.end);
  if (value[separator] !== ":" && value[separator] !== "=") {
    return;
  }
  let secretStart = skipInlineWhitespace(value, separator + 1);
  if (value[secretStart] === `"` || value[secretStart] === "'") {
    secretStart += 1;
  }
  const end = secretValueEnd(value, secretStart);
  return end > secretStart ? { end, secretStart } : undefined;
}

function skipInlineWhitespace(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length && isInlineWhitespace(value[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function secretValueEnd(value: string, start: number): number {
  let cursor = start;
  while (cursor < value.length && !isSecretValueEnd(value[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function readSecretKey(value: string, start: number): { end: number } | undefined {
  if (start > 0 && isKeyChar(value[start - 1] ?? "")) {
    return;
  }
  let end = start;
  while (end < value.length && isKeyChar(value[end] ?? "")) {
    end += 1;
  }
  if (end === start) {
    return;
  }
  const key = value.slice(start, end).toLowerCase();
  return isSensitiveKey(key) ? { end } : undefined;
}

function isSensitiveKey(key: string): boolean {
  const compact = key.split("_").join("").split("-").join("");
  return (
    key === "pwd" ||
    compact.includes("password") ||
    compact.endsWith("passwd") ||
    compact.endsWith("pass") ||
    compact.includes("token") ||
    compact.includes("secret") ||
    compact.includes("apikey") ||
    compact.includes("servicerolekey")
  );
}

function redactSupabaseSecrets(value: string): string {
  const prefix = "sb_secret_";
  let output = "";
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf(prefix, index);
    if (start === -1) {
      output += value.slice(index);
      break;
    }
    output += value.slice(index, start + prefix.length);
    let end = start + prefix.length;
    while (end < value.length && isTokenChar(value[end] ?? "")) {
      end += 1;
    }
    output += MASK;
    index = end;
  }
  return output;
}

function redactJwtTokens(value: string): string {
  let output = "";
  let index = 0;
  while (index < value.length) {
    const start = value.indexOf("eyJ", index);
    if (start === -1) {
      output += value.slice(index);
      break;
    }
    output += value.slice(index, start);
    let end = start;
    while (end < value.length && isJwtTokenChar(value[end] ?? "")) {
      end += 1;
    }
    const token = value.slice(start, end);
    if (isJwtToken(token)) {
      output += "[redacted-jwt]";
    } else {
      output += token;
    }
    index = end;
  }
  return output;
}

function isJwtToken(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 3 && parts.every((part) => part.length > 0 && [...part].every(isTokenChar))
  );
}

function isKeyChar(char: string): boolean {
  return isAsciiLetter(char) || isDigit(char) || char === "_" || char === "-";
}

function isTokenChar(char: string): boolean {
  return isAsciiLetter(char) || isDigit(char) || char === "_" || char === "-";
}

function isJwtTokenChar(char: string): boolean {
  return isTokenChar(char) || char === ".";
}

function isSecretValueEnd(char: string): boolean {
  return (
    char === "" ||
    char === " " ||
    char === "\n" ||
    char === "\r" ||
    char === "\t" ||
    char === "&" ||
    char === ";" ||
    char === `"` ||
    char === "'" ||
    char === "," ||
    char === ")" ||
    char === "]"
  );
}

function isInlineWhitespace(char: string): boolean {
  return char === " " || char === "\t";
}

function isAsciiLetter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}
