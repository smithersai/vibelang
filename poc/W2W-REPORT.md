# W2-W Typed Worker Report

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

Status: provisional library lowering for the concurrency design direction. No `spawn module {}` syntax was added.

## API surface

- `TypedWorker.spawn<Contract>(moduleUrl, options)` returns `Promise<TypedWorkerHandle<Contract>>` after the worker module and requested exports are ready.
- `options.functions` is the explicit export allowlist. Reserved/prototype-sensitive names and duplicates are rejected.
- `options.maxConcurrency` bounds active calls (default `8`); excess calls wait in a FIFO queue.
- `options.timeoutMs` is the default wall-clock call timeout (default `30_000ms`). A proxy method accepts an optional `{ timeoutMs }` override.
- `options.maxMessageBytes` bounds each transport message (default and hard maximum `1_048_576` bytes).
- `options.startupTimeoutMs` bounds worker startup (default `10_000ms`).
- Each allowlisted proxy method has the provisional shape `(input, options?) => Promise<Result<A, E>>`. A plain worker return is lifted to Result success; an existing Result is retained.
- `await worker.terminate()` is explicit and idempotent. `WorkerTerminated`, `WorkerCrashed`, `WorkerCallTimeout`, and `WorkerProtocolError` are registered nominal Errors.
- `TYPED_WORKER_API_STATUS` is the literal `"provisional"`.

## Wire and lifecycle behavior

Bun 1.2.20 exposes `node:worker_threads`, but an actual `MessageChannel` transfer/round-trip through that compatibility API timed out. The implementation therefore uses Bun's Web Worker API, which passed the transferred-port and exit-context probes. RPC runs over a private `MessageChannel`; the public Worker channel is not used for calls.

Every request input is a strict successful Result wire envelope, and every normal response is a strict Result wire envelope using `runtime/wire.ts`. Nested Result and Optional values use `encodeResult`/`decodeResult` and `encodeOptional`/`decodeOptional`; Error values use `encodeError`/`decodeError`. Plain payloads use a recursive canonical codec supporting null, undefined, booleans, finite numbers, strings, ordinary arrays, and plain/null-prototype records. Decoded records have null prototypes. Functions, symbols, bigint, accessors, sparse arrays, cycles, custom prototypes, non-finite numbers, and unregistered/non-transportable Errors are rejected rather than structured-cloned as a fallback.

Outer protocol messages are canonical JSON strings with exact-field validation, a protocol version, and cryptographically random per-call UUIDs. Unknown fields, malformed/non-canonical JSON, unknown or replayed IDs, unsupported message kinds, and oversized messages fail closed. JSON records are rebuilt with null prototypes. The private port is retained only inside the bootstrap closure and removed from the bootstrap record before the user module loads, containing malformed/forged/flood traffic sent through the public worker channel.

Calls are queued FIFO behind the configured active-call bound. Timeouts include queue time. A timed-out active operation is not assumed cancellable and continues occupying its slot until it replies or the worker terminates. Termination first rejects all unsettled active and queued calls with nominal `WorkerTerminated`, then stops the worker and waits for its close event. Unexpected errors/exits reject all calls with nominal `WorkerCrashed`; its context includes module URL, event kind, exit code when available, and detail. Internal rejection observers and worker error handling prevent lifecycle failures from becoming unhandled rejections.

Nominal domain Error identity is preserved when the Error declaration/codec registration executes in both realms. In the POC, the caller imports the declaration module and the worker imports its worker module; decoded Errors are reconstructed with the caller-realm constructor, so `error.is(...)` and `error.match(...)` work.

## Verification

- `bun test src/concurrency/`: **18 passed, 0 failed, 64 assertions** across the existing concurrency suite and the new worker suite. The worker suite contributes 11 tests.
- Repeated stress run (`--rerun-each 3`): **36 passed, 0 failed, 128 assertions** as reported by Bun.
- `bun examples/concurrency/demo.ts`: passed; the demo joined ordinary work, mapped with a concurrency bound, called the typed analytics worker, and terminated it explicitly.
- `bun run check`: the owned concurrency and example files are clean. The repository-wide command remains nonzero only for the concurrent in-flux `src/durable/source-compiler.ts` reference to `FunctionLowerer.lowerLoopCall`.
- `git diff --check` for owned tracked files: clean.

## Limitations

- SharedArrayBuffer shared structs/shared data are **not implemented**.
- The future `spawn module {}` syntax and compiler lowering are not implemented.
- Automatic compiler-derived codecs and specialized typed-array/transferable codecs are not implemented; the provisional recursive value codec is intentionally narrower.
- Worker modules are isolation realms, not security sandboxes. The private transport contains unsolicited public-channel messages, but code in a worker can still consume CPU/memory or use host APIs available to it.
- Timed-out active functions are not cooperatively cancelled.
- Contracts are supplied as TypeScript generics plus a runtime function allowlist; runtime schema generation from Smithers types is future compiler work.
- Domain Error registration metadata is not automatically split/imported into the caller realm; both realms must execute the corresponding registration.

SOURCE SETTLED
