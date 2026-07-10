export function ok(token) {
  process.stdout.write(`${token}\n`);
}

export function fail(message) {
  throw new Error(message);
}

export function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}
