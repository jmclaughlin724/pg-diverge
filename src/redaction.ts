/**
 * Secret redaction (plan `40-rule-engine-foundation.md`, task S1; also the K0
 * "redaction via S1" follow-on). The free `scan` / badge flow can surface
 * diagnostic text publicly (PR comments, a public result page), so connection
 * strings and credentials must be masked before output leaves the machine. This is
 * text redaction over transport strings, the one case Rule 07 reserves for regex
 * (credential-pattern detection), not SQL-structure analysis.
 */

const MASK = "***";

// regex-ok: credential redaction — mask `password=...`, `passwd=...`, `pwd=...`, and
// prefixed variants (`pgpassword`, `pg_password`, `db_password`) as key/value pairs in
// connection text and error output. Bounded prefix/value lengths keep matching linear.
const PASSWORD_KV = /\b([a-z_]{0,16}pass(?:word|wd)|pwd)(\s*[=:]\s*)[^\s&;"']{1,256}/gi;

/** Mask credentials in arbitrary text before it is displayed or shared. */
export function redactSecrets(text: string): string {
  return redactUrlCredentials(text).replace(PASSWORD_KV, `$1$2${MASK}`);
}

/**
 * True when the text contains a recognizable credential. Defined as "redaction
 * changes the text" so there is one source of truth for what counts as a secret,
 * and so it reads `false` on already-redacted text (masking is idempotent: the
 * `***` mask does not re-trigger a change). This also avoids the `/g` +
 * `RegExp.test` `lastIndex` footgun by never calling `test`.
 */
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
