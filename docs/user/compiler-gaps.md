# Compiler gaps in user examples

Run `bun docs/tools/check-snippets.ts` from the repository root. The checker
compiles each page once with the native compiler and checks every marked gap.
A gap that no longer produces an unexpected error or misses its expected
error fails the check until its marker is removed. The checker reports Markdown
line numbers and can write full per-block diagnostics with `--json path`.

This inventory records language/compiler disagreements, not new language rules.
The rule references are in `docs/design/history/DECISIONS.md`. A `// fragment` example
instead omits a fixture or contains an incomplete integration sketch. Type
checking does not prove runtime behavior; the native smoke suite covers that.

## Evidence and scope

Each row identifies the missing contract, resource, producer, or value-call
behavior and the exact diagnostic observed.

The tooling gaps are separate: distribution uses local file dependencies and a
local VSIX, Vite uses compiler subprocesses, declaration emit has no `$direct`
metadata, and the compiler has no custom migration refactors or mechanical ES
code actions. See the Devtools guide and design chapters 27 and 28. No Oxlint
configuration package is shipped.

## Checked blocks

No checked block has a compiler gap. Record a new one in a table with the
columns page and block, first code line, diagnostic, and rule and
disagreement.

## Editor transport compatibility

`setup/zed.md` was tested with Zed 0.195.3. The configured server starts and
receives `.vibe` documents with language id `typescript`, but Zed sends
`previousResultId: null` in `textDocument/diagnostic`. Both the published 0.0.1
server and the local compiler reject the request with -32602 (`InvalidParams`).
The field is optional but nonnullable in LSP 3.17; the shared protocol decoder
intentionally rejects null for such fields. A request that omits the field
returns the expected TS2322 diagnostic, and hover requests work. Use
`npx vibelang --noEmit` for diagnostics in that Zed version. This is a transport
compatibility issue, so it has no snippet-level `compiler-gap` marker.

## Runtime disagreements

These examples type-check. A `compiler-gap` header would be stale because the
snippet checker uses that marker for diagnostic disagreements, so the affected
pages state the runtime limitation in prose.

### Timeout discards failures from interrupted cleanup

`error-management/019-timing-out.md`, "Limiting execution duration": Effect
4.0.5's `timeout`, `timeoutOption`, and `timeoutOrElse` wait for the interrupted
source's cleanup but discard failures from that cleanup. Both a `finally` that
dies and a `using` release that dies reproduce this. A plain `timeout` reports
only `TimeoutError`. D256 resolves the scope of D15: cleanup VibeLang itself runs
keeps its failures, while Effect operators retain Effect's semantics under D22,
including dropping a loser's cleanup failure. VibeLang does not fork `timeout`;
surfacing the loser's finalizer failure is an upstream Effect follow-up.
