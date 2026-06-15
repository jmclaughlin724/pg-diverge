<python_runtime_patterns> Use this reference for Python applications, CLIs, runtime behavior, diagnostics, and validation/configuration boundaries. Keep framework-specific choices subordinate to the repo's existing stack.

<cli_and_entry_points>

- Prefer `pyproject.toml` `[project.scripts]` for distributable console commands and keep each entry point as a small no-argument callable that delegates to testable code.
- Use `argparse` for stdlib CLIs; use Typer/Click only when the repo already uses them or when richer UX materially helps.
- Keep parsing, environment loading, side effects, and business logic separate so command behavior can be unit-tested without subprocess-only tests.
- Return process exit codes from a small `main()` wrapper; print user-facing output intentionally and send diagnostics to logging or stderr as appropriate.
- Test command behavior through direct parser/function calls first, then add one subprocess or console-script smoke test when packaging or shell integration changed. </cli_and_entry_points>

<async_and_concurrency>

- Use `asyncio.TaskGroup` for related async tasks when Python support allows it; it gives structured cancellation and exception handling.
- Do not block the event loop with CPU-bound work, sync network calls, sleep, file-heavy work, or large serialization. Move blocking work to an executor or make the dependency async.
- Use `asyncio.gather()` only when its failure/cancellation semantics are deliberately acceptable.
- Use `ThreadPoolExecutor` for blocking I/O; use `ProcessPoolExecutor` for CPU-bound pure-Python work when serialization cost and process startup are acceptable.
- Use executor context managers or explicit shutdown. Avoid submitting tasks that wait on futures from the same saturated pool.
- Bound fan-out with semaphores, queues, batch sizes, or worker limits. Unbounded task creation is a resource bug.
- Make cancellation explicit: propagate `CancelledError` after cleanup, close clients/sessions, and test timeout paths for long-running async workflows. </async_and_concurrency>

<logging_and_observability>

- Use stdlib `logging` as the base layer. Libraries should not configure global handlers at import time; applications should configure handlers once at startup.
- Prefer `logging.config.dictConfig()` for application logging when multiple handlers, levels, formatters, or environment-specific settings are needed.
- Log structured context at boundaries: request/job id, actor, operation, target resource, outcome, duration, and sanitized error details.
- Never log secrets, bearer tokens, credentials, private keys, raw PII, or unbounded payloads. Redact at the boundary before values enter logs or spans.
- Use OpenTelemetry when distributed tracing, metrics, or cross-service correlation is required. Keep instrumentation configuration in application startup, not in domain modules.
- Keep logs, traces, metrics, and error reporting aligned around the same operation names and correlation ids. </logging_and_observability>

<debugging_and_runtime_diagnostics>

- Use `breakpoint()` or `python -m pdb` for interactive local debugging; remove breakpoints before committing.
- Use post-mortem debugging (`pdb.pm()` or `python -m pdb`) when reproducing crash state is more valuable than stepping from process start.
- Enable `faulthandler` for hard crashes, native faults, deadlocks, or production-like smoke runs where Python tracebacks would otherwise be missing.
- Use `tracemalloc` snapshots for Python allocation growth; compare snapshots around the suspected operation and sort by traceback or line.
- Use `cProfile`/`profile` for CPU-path investigation before optimizing. Pair profiles with a benchmark or regression test when performance behavior matters.
- For async diagnostics, inspect pending tasks, timeouts, cancellation paths, and blocking sync calls before assuming scheduler or runtime bugs. </debugging_and_runtime_diagnostics>

<validation_and_configuration_boundaries>

- Treat Pydantic v2 models as typed validation/serialization at untrusted boundaries: HTTP payloads, CLI/env config, queue messages, external files, and third-party API responses.
- Keep validated boundary models separate from internal domain objects when persistence, API shape, or transport concerns would leak inward.
- Use `model_validate()` / `model_validate_json()` and `model_dump()` / `model_dump_json()` rather than v1-era parse/dict/json methods.
- Decide coercion deliberately. Use strict mode or field validators when silent conversion would change business meaning.
- For application configuration, validate once at startup and fail fast with actionable errors. Do not repeatedly parse environment variables deep inside domain logic. </validation_and_configuration_boundaries>

<optional_domain_escalation>

- For FastAPI, Flask, Django, SQLAlchemy, pandas, NumPy, Jupyter, or scikit-learn work, consult the official docs listed in `source-index.md` and the repo's dedicated skills or conventions first.
- For notebooks and model artifacts, treat execution and deserialization as security-sensitive. Do not load untrusted notebooks or pickle/joblib/cloudpickle model files without an explicit trust decision. </optional_domain_escalation> </python_runtime_patterns>
