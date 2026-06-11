export function skippedResult(adapter, fixture, reason) {
  return {
    adapter: adapter.id,
    fixture: fixture.name,
    mode: adapter.mode,
    outputFormat: adapter.output,
    reason,
    skipped: true,
  };
}

export function unsupportedResult(adapter, fixture, reason) {
  return {
    adapter: adapter.id,
    fixture: fixture.name,
    mode: adapter.mode,
    outputFormat: adapter.output,
    reason,
    skipped: false,
    unsupported: true,
  };
}

export function failedResult(adapter, fixture, warmup, iteration, error) {
  const message = errorMessage(error);
  return {
    adapter: adapter.id,
    appliesOnce: false,
    appliesTwice: false,
    attempts: 0,
    commandFailed: true,
    elapsedMs: 0,
    exitCode: 1,
    fixture: fixture.name,
    matchesTargetAfterFirstApply: false,
    matchesTargetAfterSecondApply: false,
    matchesTargetFingerprint: false,
    mode: adapter.mode,
    outputBytes: 0,
    outputFormat: adapter.output,
    skipped: false,
    stderrBytes: Buffer.byteLength(message),
    stderrPreview: preview(redactSecrets(message)),
    timedOut: false,
    totalElapsedMs: 0,
    verificationReason: message,
    warmup,
    iteration,
  };
}

export function combineExecutions(executions) {
  const latest = executions.at(-1) ?? {
    exitCode: 1,
    stderr: "command was not executed",
    stdout: "",
    timedOut: false,
  };
  return {
    ...latest,
    stderr: executions
      .map((item, index) =>
        index === 0 ? item.stderr : `--- retry ${index + 1} ---\n${item.stderr}`,
      )
      .filter(Boolean)
      .join("\n"),
    timedOut: executions.some((item) => item.timedOut),
  };
}

export function preview(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
}

export function redactSecrets(value) {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi, "$1***:***@");
}

export function summary(payload) {
  const runnable = payload.results.filter((item) => !item.skipped && !item.unsupported);
  const skipped = payload.results.filter((item) => item.skipped);
  const unsupported = payload.results.filter((item) => item.unsupported);
  const failed = runnable.filter((item) => item.commandFailed ?? item.exitCode !== 0);
  return `comparison benchmark: ${runnable.length} runs, ${unsupported.length} unsupported, ${skipped.length} skips, ${failed.length} command failures`;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
